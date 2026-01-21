import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { createAutoClaimPoller, type AutoClaimPoller } from '../../../src/dispatch/auto-claim-poller.js';
import { createDispatchRepository, type DispatchRepository } from '../../../src/db/dispatch.js';
import { createDispatchSettingsRepository, type DispatchSettingsRepository } from '../../../src/db/dispatch-settings.js';
import { closeClient } from '../../../src/db/client.js';
import type { DispatchClient } from '../../../src/dispatch/client.js';
import type { AutoClaimEvent } from '../../../src/types/index.js';
import { createTestQueueItem } from './helpers.js';

const TEST_DATA_DIR = './test-data-auto-claim-poller';

describe('AutoClaimPoller', () => {
  let poller: AutoClaimPoller;
  let dispatchRepo: DispatchRepository;
  let settingsRepo: DispatchSettingsRepository;
  let mockClient: DispatchClient;
  let pollMock: ReturnType<typeof mock.fn>;
  let takeMock: ReturnType<typeof mock.fn>;

  beforeEach(async () => {
    dispatchRepo = createDispatchRepository(TEST_DATA_DIR, 'test-claimed-prompts');
    settingsRepo = createDispatchSettingsRepository(TEST_DATA_DIR, 'test-settings');

    pollMock = mock.fn(async () => []);
    takeMock = mock.fn(async (id: string) => createTestQueueItem({ id }));

    mockClient = {
      poll: pollMock as () => Promise<ReturnType<typeof createTestQueueItem>[]>,
      take: takeMock as (id: string) => Promise<ReturnType<typeof createTestQueueItem>>
    };

    poller = createAutoClaimPoller({
      dispatchClient: mockClient,
      dispatchRepo,
      settingsRepo
    });
  });

  afterEach(async () => {
    poller.stop();
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('poll', () => {
    test('does nothing when disabled', async () => {
      await settingsRepo.updateSettings({ enabled: false });

      await poller.poll();

      assert.strictEqual(pollMock.mock.calls.length, 0);
    });

    test('polls and claims when enabled', async () => {
      await settingsRepo.updateSettings({ enabled: true });
      pollMock.mock.mockImplementationOnce(async () => [createTestQueueItem({ id: 'item-1' })]);

      await poller.poll();

      assert.strictEqual(pollMock.mock.calls.length, 1);
      assert.strictEqual(takeMock.mock.calls.length, 1);
      assert.strictEqual(takeMock.mock.calls[0].arguments[0], 'item-1');

      // Verify it was saved
      const claimed = await dispatchRepo.getClaimedPrompt('item-1');
      assert.ok(claimed);
      assert.strictEqual(claimed.id, 'item-1');
    });

    test('respects maxClaimsPerPoll', async () => {
      await settingsRepo.updateSettings({ enabled: true, maxClaimsPerPoll: 2 });
      pollMock.mock.mockImplementationOnce(async () => [
        createTestQueueItem({ id: 'item-1' }),
        createTestQueueItem({ id: 'item-2' }),
        createTestQueueItem({ id: 'item-3' })
      ]);

      await poller.poll();

      // Should only claim 2 items
      assert.strictEqual(takeMock.mock.calls.length, 2);
    });

    test('emits claim events', async () => {
      await settingsRepo.updateSettings({ enabled: true });
      pollMock.mock.mockImplementationOnce(async () => [createTestQueueItem({ id: 'event-item' })]);

      const events: AutoClaimEvent[] = [];
      poller.onEvent((event) => events.push(event));

      await poller.poll();

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'claim');
      assert.strictEqual((events[0].data as { id: string }).id, 'event-item');
    });

    test('emits error events on failure', async () => {
      await settingsRepo.updateSettings({ enabled: true });
      pollMock.mock.mockImplementationOnce(async () => {
        throw new Error('Connection failed');
      });

      const events: AutoClaimEvent[] = [];
      poller.onEvent((event) => events.push(event));

      await poller.poll();

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'error');
      assert.strictEqual((events[0].data as { error: string }).error, 'Connection failed');
    });

    test('handles already claimed items gracefully', async () => {
      await settingsRepo.updateSettings({ enabled: true });
      pollMock.mock.mockImplementationOnce(async () => [createTestQueueItem({ id: 'taken-item' })]);
      takeMock.mock.mockImplementationOnce(async () => {
        throw new Error('Item already claimed or not found');
      });

      // Should not throw
      await poller.poll();

      // Should still record the poll
      const settings = await settingsRepo.getSettings();
      assert.ok(settings.lastPollAt);
    });

    test('updates settings on poll', async () => {
      await settingsRepo.updateSettings({ enabled: true });

      await poller.poll();

      const settings = await settingsRepo.getSettings();
      assert.ok(settings.lastPollAt);
    });

    test('updates claim count on successful claim', async () => {
      await settingsRepo.updateSettings({ enabled: true });
      pollMock.mock.mockImplementationOnce(async () => [createTestQueueItem({ id: 'count-item' })]);

      await poller.poll();

      const settings = await settingsRepo.getSettings();
      assert.strictEqual(settings.totalClaimedCount, 1);
      assert.ok(settings.lastClaimAt);
    });
  });

  describe('start/stop', () => {
    test('isRunning returns false initially', () => {
      assert.strictEqual(poller.isRunning(), false);
    });

    test('does not start when disabled', async () => {
      await settingsRepo.updateSettings({ enabled: false });

      await poller.start();

      assert.strictEqual(poller.isRunning(), false);
    });

    test('starts when enabled', async () => {
      await settingsRepo.updateSettings({ enabled: true, pollingIntervalMs: 100000 });

      await poller.start();

      assert.strictEqual(poller.isRunning(), true);
    });

    test('stop clears interval', async () => {
      await settingsRepo.updateSettings({ enabled: true, pollingIntervalMs: 100000 });

      await poller.start();
      poller.stop();

      assert.strictEqual(poller.isRunning(), false);
    });

    test('emits status_change on start', async () => {
      await settingsRepo.updateSettings({ enabled: true, pollingIntervalMs: 100000 });

      const events: AutoClaimEvent[] = [];
      poller.onEvent((event) => events.push(event));

      await poller.start();

      const statusEvent = events.find(e => e.type === 'status_change');
      assert.ok(statusEvent);
      assert.strictEqual((statusEvent.data as { enabled: boolean }).enabled, true);
    });

    test('emits status_change on stop', async () => {
      await settingsRepo.updateSettings({ enabled: true, pollingIntervalMs: 100000 });

      await poller.start();

      const events: AutoClaimEvent[] = [];
      poller.onEvent((event) => events.push(event));

      poller.stop();

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'status_change');
      assert.strictEqual((events[0].data as { enabled: boolean }).enabled, false);
    });
  });

  describe('onEvent', () => {
    test('returns unsubscribe function', async () => {
      await settingsRepo.updateSettings({ enabled: true });
      pollMock.mock.mockImplementation(async () => [createTestQueueItem({ id: 'unsub-item' })]);

      const events: AutoClaimEvent[] = [];
      const unsubscribe = poller.onEvent((event) => events.push(event));

      await poller.poll();
      assert.strictEqual(events.length, 1);

      unsubscribe();

      await poller.poll();
      // Should still be 1 since we unsubscribed
      assert.strictEqual(events.length, 1);
    });
  });
});
