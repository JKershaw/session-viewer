import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import express from 'express';
import { createDispatchRoutes } from '../../../src/api/routes/dispatch.js';
import { createDispatchRepository, type DispatchRepository } from '../../../src/db/dispatch.js';
import { closeClient } from '../../../src/db/client.js';
import { createTestQueueItem, createTestClaimedPrompt } from '../dispatch/helpers.js';

const TEST_DATA_DIR = './test-dispatch-api-data';
const TEST_PORT = 3097;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Dispatch API', () => {
  let server: Server;
  let dispatchRepo: DispatchRepository;
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    dispatchRepo = createDispatchRepository(TEST_DATA_DIR, 'test-dispatch-api');

    const app = express();
    app.use(express.json());
    app.use('/api/dispatch', createDispatchRoutes({ dispatchRepo }));

    server = app.listen(TEST_PORT);
  });

  afterEach(async () => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('GET /api/dispatch/status', () => {
    test('returns configured: false when no token', async () => {
      delete process.env.DISPATCH_TOKEN;

      const response = await fetch(`${BASE_URL}/api/dispatch/status`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.configured, false);
      assert.strictEqual(data.baseUrl, null);
    });

    test('returns configured: true when token is set', async () => {
      process.env.DISPATCH_TOKEN = 'test-token';
      process.env.DISPATCH_URL = 'https://custom.example.com';

      const response = await fetch(`${BASE_URL}/api/dispatch/status`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.configured, true);
      assert.strictEqual(data.baseUrl, 'https://custom.example.com');
    });
  });

  describe('GET /api/dispatch/available', () => {
    test('returns 503 when not configured', async () => {
      delete process.env.DISPATCH_TOKEN;

      const response = await fetch(`${BASE_URL}/api/dispatch/available`);
      const data = await response.json();

      assert.strictEqual(response.status, 503);
      assert.ok(data.error.includes('not configured'));
    });

    test('returns items when configured', async () => {
      process.env.DISPATCH_TOKEN = 'test-token';
      process.env.DISPATCH_URL = 'https://test.example.com';

      const testItems = [createTestQueueItem({ id: 'item-1' }), createTestQueueItem({ id: 'item-2' })];
      globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        // Only mock external dispatch API calls, not local server calls
        if (urlStr.includes('test.example.com') && urlStr.includes('/api/dispatch/poll')) {
          return {
            ok: true,
            json: async () => testItems
          } as Response;
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const response = await fetch(`${BASE_URL}/api/dispatch/available`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.length, 2);
      assert.strictEqual(data[0].id, 'item-1');
    });
  });

  describe('POST /api/dispatch/claim/:id', () => {
    test('returns 503 when not configured', async () => {
      delete process.env.DISPATCH_TOKEN;

      const response = await fetch(`${BASE_URL}/api/dispatch/claim/item-123`, {
        method: 'POST'
      });
      const data = await response.json();

      assert.strictEqual(response.status, 503);
      assert.ok(data.error.includes('not configured'));
    });

    test('saves and returns claimed prompt on success', async () => {
      process.env.DISPATCH_TOKEN = 'test-token';
      process.env.DISPATCH_URL = 'https://test.example.com';

      const testItem = createTestQueueItem({ id: 'claim-me' });
      globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        // Only mock external dispatch API calls - API returns { item: {...} }
        if (urlStr.includes('test.example.com') && urlStr.includes('/api/dispatch/take/')) {
          return {
            ok: true,
            json: async () => ({ item: testItem })
          } as Response;
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const response = await fetch(`${BASE_URL}/api/dispatch/claim/claim-me`, {
        method: 'POST'
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.id, 'claim-me');
      assert.ok(data.claimedAt);

      // Verify it was saved
      const saved = await dispatchRepo.getClaimedPrompt('claim-me');
      assert.ok(saved);
      assert.strictEqual(saved.id, 'claim-me');
    });

    test('returns 409 when item already claimed', async () => {
      process.env.DISPATCH_TOKEN = 'test-token';
      process.env.DISPATCH_URL = 'https://test.example.com';

      globalThis.fetch = mock.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        // Only mock external dispatch API calls
        if (urlStr.includes('test.example.com') && urlStr.includes('/api/dispatch/take/')) {
          return {
            ok: false,
            status: 404,
            text: async () => 'Not found'
          } as Response;
        }
        return originalFetch(url, init);
      }) as typeof fetch;

      const response = await fetch(`${BASE_URL}/api/dispatch/claim/already-taken`, {
        method: 'POST'
      });
      const data = await response.json();

      assert.strictEqual(response.status, 409);
      assert.ok(data.error.includes('already claimed'));
    });
  });

  describe('GET /api/dispatch/claimed', () => {
    test('returns all claimed prompts', async () => {
      await dispatchRepo.saveClaimedPrompt(createTestClaimedPrompt({ id: 'claimed-1' }));
      await dispatchRepo.saveClaimedPrompt(createTestClaimedPrompt({ id: 'claimed-2' }));

      const response = await fetch(`${BASE_URL}/api/dispatch/claimed`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.length, 2);
    });

    test('returns empty array when no claimed prompts', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/claimed`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(data, []);
    });
  });

  describe('DELETE /api/dispatch/claimed/:id', () => {
    test('deletes claimed prompt', async () => {
      await dispatchRepo.saveClaimedPrompt(createTestClaimedPrompt({ id: 'delete-me' }));

      const response = await fetch(`${BASE_URL}/api/dispatch/claimed/delete-me`, {
        method: 'DELETE'
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.success, true);

      const found = await dispatchRepo.getClaimedPrompt('delete-me');
      assert.strictEqual(found, null);
    });

    test('returns 404 for non-existent prompt', async () => {
      const response = await fetch(`${BASE_URL}/api/dispatch/claimed/not-found`, {
        method: 'DELETE'
      });

      assert.strictEqual(response.status, 404);
    });
  });
});
