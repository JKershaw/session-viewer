import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createApp } from '../../../src/api/app.js';
import { closeClient } from '../../../src/db/client.js';
import { createSessionRepository, type SessionRepository } from '../../../src/db/sessions.js';
import { createTrustRepository, type TrustRepository } from '../../../src/db/trust.js';
import type { Session, Event } from '../../../src/types/index.js';

const TEST_DATA_DIR = './test-trust-api-data';
const TEST_PORT = 3098;
const BASE_URL = `http://localhost:${TEST_PORT}`;

const createTestSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'test-session-1',
  parentSessionId: null,
  startTime: '2026-01-01T10:00:00Z',
  endTime: '2026-01-01T11:00:00Z',
  durationMs: 3600000,
  totalTokens: 5000,
  branch: 'feature/test',
  folder: '/home/user/project',
  linearTicketId: null,
  analyzed: false,
  events: [
    {
      type: 'user_message',
      timestamp: '2026-01-01T10:00:00Z',
      tokenCount: 100,
      raw: { type: 'message', message: { role: 'user', content: 'Initial prompt' } }
    },
    {
      type: 'assistant_message',
      timestamp: '2026-01-01T10:01:00Z',
      tokenCount: 500,
      raw: { type: 'message', message: { role: 'assistant', content: 'Response' } }
    },
    {
      type: 'tool_call',
      timestamp: '2026-01-01T10:02:00Z',
      tokenCount: 50,
      raw: { type: 'tool_use', tool_name: 'Read', input: { file_path: '/project/src/auth/login.ts' } }
    }
  ] as Event[],
  annotations: [],
  ...overrides
});

describe('Trust API', () => {
  let server: Server;
  let sessionRepo: SessionRepository;
  let trustRepo: TrustRepository;

  beforeEach(async () => {
    sessionRepo = await createSessionRepository(TEST_DATA_DIR);
    trustRepo = await createTrustRepository(TEST_DATA_DIR);
    const app = createApp(
      { sessions: sessionRepo, trust: trustRepo },
      { logsDir: './non-existent-for-test' }
    );
    server = app.listen(TEST_PORT);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('GET /api/trust/session/:id', () => {
    test('returns trust analysis for existing session', async () => {
      await sessionRepo.upsertSession(createTestSession({ id: 'session-123' }));

      const response = await fetch(`${BASE_URL}/api/trust/session/session-123`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.sessionId, 'session-123');
      assert.ok('trustScore' in data);
      assert.ok('autonomous' in data);
      assert.ok('steering' in data);
      assert.ok('characteristics' in data);
      assert.ok('outcome' in data);
    });

    test('returns 404 for non-existent session', async () => {
      const response = await fetch(`${BASE_URL}/api/trust/session/non-existent`);

      assert.strictEqual(response.status, 404);
    });

    test('caches analysis after first computation', async () => {
      await sessionRepo.upsertSession(createTestSession({ id: 'session-456' }));

      // First request computes and caches
      const response1 = await fetch(`${BASE_URL}/api/trust/session/session-456`);
      const data1 = await response1.json();

      // Verify it was cached
      const cached = await trustRepo.getSessionAnalysis('session-456');
      assert.ok(cached);
      assert.strictEqual(cached.sessionId, 'session-456');

      // Second request should return same data
      const response2 = await fetch(`${BASE_URL}/api/trust/session/session-456`);
      const data2 = await response2.json();

      assert.strictEqual(data1.trustScore, data2.trustScore);
    });

    test('returns correct steering metrics', async () => {
      // Session with multiple interventions
      const session = createTestSession({
        id: 'session-steered',
        events: [
          { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 100, raw: { type: 'message', message: { role: 'user' } } },
          { type: 'assistant_message', timestamp: '2026-01-01T10:01:00Z', tokenCount: 200, raw: { type: 'message', message: { role: 'assistant' } } },
          { type: 'user_message', timestamp: '2026-01-01T10:30:00Z', tokenCount: 100, raw: { type: 'message', message: { role: 'user' } } },  // Intervention
          { type: 'assistant_message', timestamp: '2026-01-01T10:31:00Z', tokenCount: 200, raw: { type: 'message', message: { role: 'assistant' } } },
          { type: 'user_message', timestamp: '2026-01-01T10:45:00Z', tokenCount: 100, raw: { type: 'message', message: { role: 'user' } } },  // Another intervention
        ] as Event[]
      });
      await sessionRepo.upsertSession(session);

      const response = await fetch(`${BASE_URL}/api/trust/session/session-steered`);
      const data = await response.json();

      assert.strictEqual(data.steering.interventionCount, 2);
      assert.strictEqual(data.autonomous, false);
    });
  });

  describe('GET /api/trust/map', () => {
    test('returns empty map when no sessions', async () => {
      const response = await fetch(`${BASE_URL}/api/trust/map`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.global.totalSessions, 0);
      assert.deepStrictEqual(data.byArea, []);
    });

    test('auto-computes map from sessions if missing', async () => {
      await sessionRepo.upsertSession(createTestSession({ id: 'session-1' }));
      await sessionRepo.upsertSession(createTestSession({ id: 'session-2' }));

      const response = await fetch(`${BASE_URL}/api/trust/map`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.global.totalSessions, 2);
    });
  });

  describe('POST /api/trust/compute', () => {
    test('computes trust map from all sessions', async () => {
      await sessionRepo.upsertSession(createTestSession({
        id: 'session-1',
        folder: '/project/auth'
      }));
      await sessionRepo.upsertSession(createTestSession({
        id: 'session-2',
        folder: '/project/api'
      }));
      await sessionRepo.upsertSession(createTestSession({
        id: 'session-3',
        folder: '/project/auth'
      }));

      const response = await fetch(`${BASE_URL}/api/trust/compute`, { method: 'POST' });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(data.sessionsAnalyzed, 3);
      assert.ok(data.trustMap);
      assert.strictEqual(data.trustMap.global.totalSessions, 3);
    });

    test('returns insights with computed map', async () => {
      // Create sessions with varying characteristics
      for (let i = 0; i < 10; i++) {
        await sessionRepo.upsertSession(createTestSession({
          id: `session-${i}`,
          events: i < 5
            ? createTestSession().events  // First 5 are simple
            : [  // Last 5 have interventions
              { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 100, raw: { type: 'message', message: { role: 'user' } } },
              { type: 'user_message', timestamp: '2026-01-01T10:30:00Z', tokenCount: 100, raw: { type: 'message', message: { role: 'user' } } },
              { type: 'user_message', timestamp: '2026-01-01T10:45:00Z', tokenCount: 100, raw: { type: 'message', message: { role: 'user' } } },
            ] as Event[]
        }));
      }

      const response = await fetch(`${BASE_URL}/api/trust/compute`, { method: 'POST' });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(data.insights));
    });
  });

  describe('POST /api/trust/predict', () => {
    test('predicts trust for given characteristics', async () => {
      // First, create some sessions and compute trust map
      for (let i = 0; i < 5; i++) {
        await sessionRepo.upsertSession(createTestSession({
          id: `session-${i}`,
          branch: 'feature/test'
        }));
      }
      await fetch(`${BASE_URL}/api/trust/compute`, { method: 'POST' });

      // Now predict
      const response = await fetch(`${BASE_URL}/api/trust/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchType: 'feature'
        })
      });
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.ok(['high', 'medium', 'low'].includes(data.predictedTrust));
      assert.ok(typeof data.confidenceScore === 'number');
      assert.ok(Array.isArray(data.factors));
      assert.ok(typeof data.recommendation === 'string');
    });

    test('returns error when trust map not computed', async () => {
      const response = await fetch(`${BASE_URL}/api/trust/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codebaseArea: 'src/auth' })
      });

      assert.strictEqual(response.status, 400);
    });
  });

  describe('GET /api/trust/insights', () => {
    test('returns insights from trust map', async () => {
      // Create sessions and compute
      for (let i = 0; i < 5; i++) {
        await sessionRepo.upsertSession(createTestSession({ id: `session-${i}` }));
      }
      await fetch(`${BASE_URL}/api/trust/compute`, { method: 'POST' });

      const response = await fetch(`${BASE_URL}/api/trust/insights`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(data.insights));
      assert.ok(data.global);
      assert.ok(data.computedAt);
    });

    test('returns empty insights when no trust map', async () => {
      const response = await fetch(`${BASE_URL}/api/trust/insights`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(data.insights, []);
    });
  });

  describe('GET /api/trust/areas', () => {
    test('returns trust statistics by area', async () => {
      // Create sessions with different areas
      await sessionRepo.upsertSession(createTestSession({
        id: 'session-1',
        events: [
          { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 100, raw: { type: 'message', message: { role: 'user' } } },
          { type: 'tool_call', timestamp: '2026-01-01T10:01:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Read', input: { file_path: '/project/src/auth/file.ts' } } }
        ] as Event[]
      }));
      await sessionRepo.upsertSession(createTestSession({
        id: 'session-2',
        events: [
          { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 100, raw: { type: 'message', message: { role: 'user' } } },
          { type: 'tool_call', timestamp: '2026-01-01T10:01:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Read', input: { file_path: '/project/src/api/file.ts' } } }
        ] as Event[]
      }));

      await fetch(`${BASE_URL}/api/trust/compute`, { method: 'POST' });

      const response = await fetch(`${BASE_URL}/api/trust/areas`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.ok(Array.isArray(data.areas));
      assert.ok(data.global);
    });

    test('returns empty areas when no trust map', async () => {
      const response = await fetch(`${BASE_URL}/api/trust/areas`);
      const data = await response.json();

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(data.areas, []);
    });
  });
});
