/**
 * Dispatch API Routes
 *
 * Endpoints for polling available prompts, claiming them, and managing claimed prompts.
 */

import { Router, type Request, type Response } from 'express';
import type { DispatchRepository } from '../../db/dispatch.js';
import type { ClaimedPrompt, DispatchQueueItem } from '../../types/index.js';
import {
  getDispatchConfig,
  createDispatchClient,
  type DispatchClient
} from '../../dispatch/client.js';

export interface DispatchRoutesConfig {
  dispatchRepo: DispatchRepository;
}

export const createDispatchRoutes = (config: DispatchRoutesConfig): Router => {
  const { dispatchRepo } = config;
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

  return router;
};
