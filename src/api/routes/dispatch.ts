/**
 * Dispatch API Routes
 *
 * Endpoints for polling available prompts, claiming them, and managing claimed prompts.
 */

import { Router, type Request, type Response } from 'express';
import type { DispatchRepository } from '../../db/dispatch.js';
import type { DispatchSettingsRepository } from '../../db/dispatch-settings.js';
import type { ClaimedPrompt, DispatchQueueItem, AutoClaimSettings } from '../../types/index.js';
import {
  getDispatchConfig,
  createDispatchClient,
  type DispatchClient
} from '../../dispatch/client.js';
import type { AutoClaimPoller } from '../../dispatch/auto-claim-poller.js';

export interface DispatchRoutesConfig {
  dispatchRepo: DispatchRepository;
  settingsRepo?: DispatchSettingsRepository;
  autoClaimPoller?: AutoClaimPoller;
}

export const createDispatchRoutes = (config: DispatchRoutesConfig): Router => {
  const { dispatchRepo, settingsRepo, autoClaimPoller } = config;
  const router = Router();

  // Lazily create client when needed
  let dispatchClient: DispatchClient | null = null;

  const getClient = (): DispatchClient | null => {
    if (dispatchClient) return dispatchClient;

    const dispatchConfig = getDispatchConfig();
    if (!dispatchConfig) return null;

    dispatchClient = createDispatchClient(dispatchConfig);
    return dispatchClient;
  };

  /**
   * GET /api/dispatch/status
   * Check if dispatch is configured
   */
  router.get('/status', (_req: Request, res: Response) => {
    const config = getDispatchConfig();
    res.json({
      configured: !!config,
      baseUrl: config?.baseUrl || null
    });
  });

  /**
   * GET /api/dispatch/available
   * Proxy to LinearViewer poll endpoint
   */
  router.get('/available', async (_req: Request, res: Response) => {
    try {
      const client = getClient();
      if (!client) {
        res.status(503).json({ error: 'Dispatch not configured. Set DISPATCH_TOKEN environment variable.' });
        return;
      }

      const items = await client.poll();
      res.json(items);
    } catch (error) {
      console.error('Dispatch poll error:', error);
      res.status(500).json({ error: 'Failed to poll dispatch queue' });
    }
  });

  /**
   * POST /api/dispatch/claim/:itemId
   * Claim an item and save locally
   */
  router.post('/claim/:itemId', async (req: Request, res: Response) => {
    try {
      const client = getClient();
      if (!client) {
        res.status(503).json({ error: 'Dispatch not configured. Set DISPATCH_TOKEN environment variable.' });
        return;
      }

      const itemId = Array.isArray(req.params.itemId)
        ? req.params.itemId[0]
        : req.params.itemId;

      // Try to claim the item from LinearViewer
      let claimedItem: DispatchQueueItem;
      try {
        claimedItem = await client.take(itemId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message.includes('already claimed')) {
          res.status(409).json({ error: 'Item already claimed or not found' });
          return;
        }
        throw error;
      }

      // Transform to ClaimedPrompt and save locally
      const claimedPrompt: ClaimedPrompt = {
        id: claimedItem.id,
        prompt: claimedItem.prompt,
        promptName: claimedItem.promptName,
        issueId: claimedItem.issueId,
        issueIdentifier: claimedItem.issueIdentifier,
        issueTitle: claimedItem.issueTitle,
        issueUrl: claimedItem.issueUrl,
        workspaceUrlKey: claimedItem.workspace.urlKey,
        claimedAt: new Date().toISOString()
      };

      await dispatchRepo.saveClaimedPrompt(claimedPrompt);

      res.json(claimedPrompt);
    } catch (error) {
      console.error('Dispatch claim error:', error);
      res.status(500).json({ error: 'Failed to claim dispatch item' });
    }
  });

  /**
   * GET /api/dispatch/claimed
   * List all locally claimed prompts
   */
  router.get('/claimed', async (_req: Request, res: Response) => {
    try {
      const prompts = await dispatchRepo.getAllClaimedPrompts();
      res.json(prompts);
    } catch (error) {
      console.error('Get claimed prompts error:', error);
      res.status(500).json({ error: 'Failed to get claimed prompts' });
    }
  });

  /**
   * DELETE /api/dispatch/claimed/:id
   * Delete a claimed prompt
   */
  router.delete('/claimed/:id', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;
      const deleted = await dispatchRepo.deleteClaimedPrompt(id);

      if (!deleted) {
        res.status(404).json({ error: 'Claimed prompt not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Delete claimed prompt error:', error);
      res.status(500).json({ error: 'Failed to delete claimed prompt' });
    }
  });

  /**
   * GET /api/dispatch/settings
   * Get current auto-claim settings
   */
  router.get('/settings', async (_req: Request, res: Response) => {
    try {
      if (!settingsRepo) {
        res.status(503).json({ error: 'Settings repository not configured' });
        return;
      }

      const settings = await settingsRepo.getSettings();
      const pollerRunning = autoClaimPoller?.isRunning() ?? false;

      res.json({ ...settings, pollerRunning });
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  /**
   * PUT /api/dispatch/settings
   * Update auto-claim settings
   */
  router.put('/settings', async (req: Request, res: Response) => {
    try {
      if (!settingsRepo) {
        res.status(503).json({ error: 'Settings repository not configured' });
        return;
      }

      const updates: Partial<AutoClaimSettings> = {};

      if (typeof req.body.enabled === 'boolean') {
        updates.enabled = req.body.enabled;
      }
      if (typeof req.body.pollingIntervalMs === 'number' && req.body.pollingIntervalMs >= 1000) {
        updates.pollingIntervalMs = req.body.pollingIntervalMs;
      }
      if (typeof req.body.maxClaimsPerPoll === 'number' && req.body.maxClaimsPerPoll >= 1) {
        updates.maxClaimsPerPoll = req.body.maxClaimsPerPoll;
      }

      const settings = await settingsRepo.updateSettings(updates);

      // Start/stop poller based on enabled state
      if (autoClaimPoller) {
        if (settings.enabled && !autoClaimPoller.isRunning()) {
          await autoClaimPoller.start();
        } else if (!settings.enabled && autoClaimPoller.isRunning()) {
          autoClaimPoller.stop();
        }
      }

      const pollerRunning = autoClaimPoller?.isRunning() ?? false;
      res.json({ ...settings, pollerRunning });
    } catch (error) {
      console.error('Update settings error:', error);
      res.status(500).json({ error: 'Failed to update settings' });
    }
  });

  /**
   * POST /api/dispatch/settings/toggle
   * Quick toggle for enabled state
   */
  router.post('/settings/toggle', async (_req: Request, res: Response) => {
    try {
      if (!settingsRepo) {
        res.status(503).json({ error: 'Settings repository not configured' });
        return;
      }

      const current = await settingsRepo.getSettings();
      const settings = await settingsRepo.updateSettings({ enabled: !current.enabled });

      // Start/stop poller based on new enabled state
      if (autoClaimPoller) {
        if (settings.enabled && !autoClaimPoller.isRunning()) {
          await autoClaimPoller.start();
        } else if (!settings.enabled && autoClaimPoller.isRunning()) {
          autoClaimPoller.stop();
        }
      }

      const pollerRunning = autoClaimPoller?.isRunning() ?? false;
      res.json({ ...settings, pollerRunning });
    } catch (error) {
      console.error('Toggle settings error:', error);
      res.status(500).json({ error: 'Failed to toggle settings' });
    }
  });

  /**
   * GET /api/dispatch/events
   * SSE endpoint for real-time auto-claim notifications
   */
  router.get('/events', (req: Request, res: Response) => {
    if (!autoClaimPoller) {
      res.status(503).json({ error: 'Auto-claim poller not configured' });
      return;
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    // Subscribe to poller events
    const unsubscribe = autoClaimPoller.onEvent((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Handle client disconnect
    req.on('close', () => {
      unsubscribe();
    });
  });

  return router;
};
