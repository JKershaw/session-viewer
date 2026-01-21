import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import express from 'express';
import { createDispatchRoutes } from '../../../src/api/routes/dispatch.js';
import { createDispatchRepository, type DispatchRepository } from '../../../src/db/dispatch.js';
import { createDispatchSettingsRepository, type DispatchSettingsRepository } from '../../../src/db/dispatch-settings.js';
import { createAutoClaimPoller, type AutoClaimPoller } from '../../../src/dispatch/auto-claim-poller.js';
import type { DispatchClient } from '../../../src/dispatch/client.js';
import { closeClient } from '../../../src/db/client.js';
import { createTestQueueItem } from '../dispatch/helpers.js';

const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Use unique data dir per test run to avoid conflicts
const getTestDataDir = () => `./test-dispatch-settings-api-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('Dispatch Settings API', () => {
  let server: Server;
  let dispatchRepo: DispatchRepository;
  let settingsRepo: DispatchSettingsRepository;
  let autoClaimPoller: AutoClaimPoller;
  let mockClient: DispatchClient;
  let pollMock: ReturnType<typeof mock.fn>;
  let takeMock: ReturnType<typeof mock.fn>;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.DISPATCH_TOKEN = 'test-token';

    dispatchRepo = createDispatchRepository(TEST_DATA_DIR, 'test-dispatch-api');
    settingsRepo = createDispatchSettingsRepository(TEST_DATA_DIR, 'test-settings');

    pollMock = mock.fn(async () => []);
    takeMock = mock.fn(async (id: string) => createTestQueueItem({ id }));

    mockClient = {
      poll: pollMock as () => Promise<ReturnType<typeof createTestQueueItem>[]>,
      take: takeMock as (id: string) => Promise<ReturnType<typeof createTestQueueItem>>
    };

    autoClaimPoller = createAutoClaimPoller({
      dispatchClient: mockClient,
      dispatchRepo,
      settingsRepo
    });

    const app = express();
    app.use(express.json());
    app.use('/api/dispatch', createDispatchRoutes({
      dispatchRepo,
      settingsRepo,
      autoClaimPoller
    }));

    server = app.listen(TEST_PORT);
  });

  afterEach(async () => {
    process.env = originalEnv;
    autoClaimPoller.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('GET /api/dispatch/settings', () => {
    test('returns current settings', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/settings`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.enabled, false);
      assert.strictEqual(data.pollingIntervalMs, 30000);
      assert.strictEqual(data.maxClaimsPerPoll, 1);
      assert.strictEqual(data.pollerRunning, false);
    });

    test('includes pollerRunning status', async () => {
      await settingsRepo.updateSettings({ enabled: true, pollingIntervalMs: 100000 });
      await autoClaimPoller.start();

      const response = await fetch(`${BASE_URL}/api/dispatch/settings`);
      const data = await response.json();

      assert.strictEqual(data.pollerRunning, true);
    });
  });

  describe('PUT /api/dispatch/settings', () => {
    test('updates enabled state', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.enabled, true);

      // Verify persisted
      const settings = await settingsRepo.getSettings();
      assert.strictEqual(settings.enabled, true);
    });

    test('updates pollingIntervalMs', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollingIntervalMs: 60000 })
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.pollingIntervalMs, 60000);
    });

    test('updates maxClaimsPerPoll', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxClaimsPerPoll: 5 })
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.maxClaimsPerPoll, 5);
    });

    test('validates pollingIntervalMs minimum', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollingIntervalMs: 1000 })
      });
      const data = await response.json();

      // Should ignore invalid value
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.pollingIntervalMs, 30000); // Default
    });

    test('validates maxClaimsPerPoll minimum', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxClaimsPerPoll: 0 })
      });
      const data = await response.json();

      // Should ignore invalid value
      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.maxClaimsPerPoll, 1); // Default
    });

    test('starts poller when enabled', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true })
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.pollerRunning, true);
    });

    test('stops poller when disabled', async () => {
      await settingsRepo.updateSettings({ enabled: true, pollingIntervalMs: 100000 });
      await autoClaimPoller.start();

      const response = await fetch(`${BASE_URL}/api/dispatch/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.pollerRunning, false);
    });
  });

  describe('POST /api/dispatch/settings/toggle', () => {
    test('toggles from disabled to enabled', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/settings/toggle`, {
        method: 'POST'
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.enabled, true);
      assert.strictEqual(data.pollerRunning, true);
    });

    test('toggles from enabled to disabled', async () => {
      await settingsRepo.updateSettings({ enabled: true, pollingIntervalMs: 100000 });
      await autoClaimPoller.start();

      const response = await fetch(`${BASE_URL}/api/dispatch/settings/toggle`, {
        method: 'POST'
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.enabled, false);
      assert.strictEqual(data.pollerRunning, false);
    });
  });

  describe('GET /api/dispatch/events', () => {
    test('returns SSE stream', async () => {
      const controller = new AbortController();
      const response = await fetch(`${BASE_URL}/api/dispatch/events`, {
        signal: controller.signal
      });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('Content-Type'), 'text/event-stream');

      controller.abort();
    });
  });
});
