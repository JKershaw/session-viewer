import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { getDispatchConfig, createDispatchClient } from '../../../src/dispatch/client.js';
import { createTestQueueItem } from './helpers.js';

describe('Dispatch Client', () => {
  describe('getDispatchConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    test('returns null when DISPATCH_TOKEN not set', () => {
      delete process.env.DISPATCH_TOKEN;
      delete process.env.DISPATCH_URL;

      const config = getDispatchConfig();

      assert.strictEqual(config, null);
    });

    test('returns config with default URL when only token set', () => {
      process.env.DISPATCH_TOKEN = 'test-token';
      delete process.env.DISPATCH_URL;

      const config = getDispatchConfig();

      assert.ok(config);
      assert.strictEqual(config.token, 'test-token');
      assert.strictEqual(config.baseUrl, 'https://projects.jkershaw.com');
    });

    test('returns config when both vars set', () => {
      process.env.DISPATCH_TOKEN = 'test-token';
      process.env.DISPATCH_URL = 'https://custom.example.com';

      const config = getDispatchConfig();

      assert.ok(config);
      assert.strictEqual(config.token, 'test-token');
      assert.strictEqual(config.baseUrl, 'https://custom.example.com');
    });
  });

  describe('createDispatchClient', () => {
    const testConfig = {
      token: 'test-token',
      baseUrl: 'https://test.example.com'
    };

    describe('poll', () => {
      test('fetches available items with Bearer auth', async () => {
        const testItems = [createTestQueueItem({ id: 'item-1' }), createTestQueueItem({ id: 'item-2' })];
        let capturedRequest: { url: string; options: RequestInit } | null = null;

        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
          capturedRequest = { url: url as string, options: options as RequestInit };
          return {
            ok: true,
            json: async () => testItems
          } as Response;
        }) as typeof fetch;

        try {
          const client = createDispatchClient(testConfig);
          const result = await client.poll();

          assert.strictEqual(capturedRequest?.url, 'https://test.example.com/api/dispatch/poll');
          assert.strictEqual(capturedRequest?.options.method, 'GET');
          assert.strictEqual(
            (capturedRequest?.options.headers as Record<string, string>)['Authorization'],
            'Bearer test-token'
          );
          assert.strictEqual(result.length, 2);
          assert.strictEqual(result[0].id, 'item-1');
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      test('throws on API error', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async () => {
          return {
            ok: false,
            status: 500,
            text: async () => 'Internal server error'
          } as Response;
        }) as typeof fetch;

        try {
          const client = createDispatchClient(testConfig);
          await assert.rejects(
            client.poll(),
            /Dispatch poll error: 500/
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });

    describe('take', () => {
      test('claims item with correct endpoint', async () => {
        const testItem = createTestQueueItem({ id: 'claimed-item' });
        let capturedRequest: { url: string; options: RequestInit } | null = null;

        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async (url: string, options?: RequestInit) => {
          capturedRequest = { url: url as string, options: options as RequestInit };
          return {
            ok: true,
            // API returns { item: {...} }
            json: async () => ({ item: testItem })
          } as Response;
        }) as typeof fetch;

        try {
          const client = createDispatchClient(testConfig);
          const result = await client.take('item-123');

          assert.strictEqual(capturedRequest?.url, 'https://test.example.com/api/dispatch/take/item-123');
          assert.strictEqual(capturedRequest?.options.method, 'POST');
          assert.strictEqual(
            (capturedRequest?.options.headers as Record<string, string>)['Authorization'],
            'Bearer test-token'
          );
          assert.strictEqual(result.id, 'claimed-item');
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      test('throws "already claimed" on 404', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async () => {
          return {
            ok: false,
            status: 404,
            text: async () => 'Not found'
          } as Response;
        }) as typeof fetch;

        try {
          const client = createDispatchClient(testConfig);
          await assert.rejects(
            client.take('item-123'),
            /Item already claimed or not found/
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      });

      test('throws generic error on other failures', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async () => {
          return {
            ok: false,
            status: 503,
            text: async () => 'Service unavailable'
          } as Response;
        }) as typeof fetch;

        try {
          const client = createDispatchClient(testConfig);
          await assert.rejects(
            client.take('item-123'),
            /Dispatch take error: 503/
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });
  });
});
