import type { DispatchClient } from './client.js';
import type { DispatchRepository } from '../db/dispatch.js';
import type { DispatchSettingsRepository } from '../db/dispatch-settings.js';
import type { AutoClaimEvent, ClaimedPrompt, DispatchQueueItem } from '../types/index.js';

export interface AutoClaimPoller {
  start: () => Promise<void>;
  stop: () => void;
  poll: () => Promise<void>;
  isRunning: () => boolean;
  onEvent: (handler: (event: AutoClaimEvent) => void) => () => void;
}

export interface AutoClaimPollerConfig {
  dispatchClient: DispatchClient;
  dispatchRepo: DispatchRepository;
  settingsRepo: DispatchSettingsRepository;
}

export const createAutoClaimPoller = (config: AutoClaimPollerConfig): AutoClaimPoller => {
  const { dispatchClient, dispatchRepo, settingsRepo } = config;

  let intervalId: NodeJS.Timeout | null = null;
  let polling = false;
  const eventHandlers = new Set<(event: AutoClaimEvent) => void>();

  const emitEvent = (event: AutoClaimEvent): void => {
    eventHandlers.forEach(handler => {
      try {
        handler(event);
      } catch (err) {
        console.error('[AutoClaimPoller] Event handler error:', err);
      }
    });
  };

  const poll = async (): Promise<void> => {
    if (polling) return;

    const settings = await settingsRepo.getSettings();

    // Don't poll if disabled
    if (!settings.enabled) {
      return;
    }

    polling = true;

    try {
      // Fetch available items
      const available = await dispatchClient.poll();

      if (available.length === 0) {
        await settingsRepo.recordPoll();
        polling = false;
        return;
      }

      // Claim up to maxClaimsPerPoll items
      const toClaim = available.slice(0, settings.maxClaimsPerPoll);
      let claimedCount = 0;

      for (const item of toClaim) {
        try {
          const claimedItem: DispatchQueueItem = await dispatchClient.take(item.id);

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
          await settingsRepo.recordClaim();
          claimedCount++;

          console.log(`[AutoClaimPoller] Claimed prompt: ${claimedPrompt.id}`);

          // Emit claim event
          emitEvent({
            type: 'claim',
            timestamp: new Date().toISOString(),
            data: claimedPrompt
          });
        } catch (claimError) {
          const message = claimError instanceof Error ? claimError.message : 'Unknown error';
          // Item might have been claimed by someone else - not a critical error
          if (message.includes('already claimed')) {
            console.log(`[AutoClaimPoller] Item ${item.id} already claimed by another client`);
          } else {
            console.error(`[AutoClaimPoller] Failed to claim item ${item.id}:`, claimError);
          }
        }
      }

      await settingsRepo.recordPoll();

      if (claimedCount > 0) {
        console.log(`[AutoClaimPoller] Poll complete: claimed ${claimedCount} item(s)`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[AutoClaimPoller] Poll error:', error);

      await settingsRepo.recordPoll(errorMessage);

      // Emit error event
      emitEvent({
        type: 'error',
        timestamp: new Date().toISOString(),
        data: { error: errorMessage }
      });
    } finally {
      polling = false;
    }
  };

  const start = async (): Promise<void> => {
    if (intervalId) return;

    const settings = await settingsRepo.getSettings();

    if (!settings.enabled) {
      console.log('[AutoClaimPoller] Not starting - auto-claim is disabled');
      return;
    }

    console.log(`[AutoClaimPoller] Starting (polling every ${settings.pollingIntervalMs}ms)`);
    intervalId = setInterval(poll, settings.pollingIntervalMs);

    // Emit status change
    emitEvent({
      type: 'status_change',
      timestamp: new Date().toISOString(),
      data: { enabled: true }
    });

    // Poll immediately on start
    poll();
  };

  const stop = (): void => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log('[AutoClaimPoller] Stopped');

      // Emit status change
      emitEvent({
        type: 'status_change',
        timestamp: new Date().toISOString(),
        data: { enabled: false }
      });
    }
  };

  const isRunning = (): boolean => intervalId !== null;

  const onEvent = (handler: (event: AutoClaimEvent) => void): (() => void) => {
    eventHandlers.add(handler);
    return () => {
      eventHandlers.delete(handler);
    };
  };

  return { start, stop, poll, isRunning, onEvent };
};
