import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createApp } from '../../../src/api/app.js';
import { closeClient } from '../../../src/db/client.js';
import { createSessionRepository, type SessionRepository } from '../../../src/db/sessions.js';
import type { Session } from '../../../src/types/index.js';

const TEST_DATA_DIR = './test-api-data';
const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

const createTestSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'test-session-1',
  parentSessionId: null,
  startTime: '2026-01-01T10:00:00Z',
  endTime: '2026-01-01T11:00:00Z',
  durationMs: 3600000,
  totalTokens: 5000,
  branch: 'main',
  folder: '/home/user/project',
  linearTicketId: null,
  analyzed: false,
  events: [],
  annotations: [],
  ...overrides
});

describe('API', () => {
  let server: Server;
  let repo: SessionRepository;

  beforeEach(async () => {
    repo = await createSessionRepository(TEST_DATA_DIR);
    const app = createApp({ sessions: repo }, { logsDir: './non-existent-for-test' });
    server = app.listen(TEST_PORT);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  test('GET /api/sessions returns paginated response when no sessions', async () => {
    const response = await fetch(`${BASE_URL}/api/sessions`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(data.data, []);
    assert.strictEqual(data.total, 0);
  });

  test('GET /api/sessions returns paginated sessions', async () => {
    await repo.upsertSession(createTestSession({ id: 'session-1' }));
    await repo.upsertSession(createTestSession({ id: 'session-2' }));

    const response = await fetch(`${BASE_URL}/api/sessions`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.data.length, 2);
    assert.strictEqual(data.total, 2);
  });

  test('GET /api/sessions/:id returns single session', async () => {
    await repo.upsertSession(createTestSession({ id: 'session-123', totalTokens: 9999 }));

    const response = await fetch(`${BASE_URL}/api/sessions/session-123`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.id, 'session-123');
    assert.strictEqual(data.totalTokens, 9999);
  });

  test('GET /api/sessions/:id returns 404 for non-existent session', async () => {
    const response = await fetch(`${BASE_URL}/api/sessions/non-existent`);

    assert.strictEqual(response.status, 404);
  });

  test('POST /api/refresh scans and stores sessions', async () => {
    const response = await fetch(`${BASE_URL}/api/refresh`, { method: 'POST' });
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(typeof data.count, 'number');
  });

  test('GET /api/sessions with limit param returns paginated response', async () => {
    // Insert 5 sessions
    for (let i = 1; i <= 5; i++) {
      await repo.upsertSession(
        createTestSession({
          id: `session-${i}`,
          startTime: `2026-01-0${i}T10:00:00Z`
        })
      );
    }

    const response = await fetch(`${BASE_URL}/api/sessions?limit=2`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.data.length, 2);
    assert.strictEqual(data.total, 5);
    assert.strictEqual(data.limit, 2);
    assert.strictEqual(data.offset, 0);
    assert.strictEqual(data.hasMore, true);
    assert.strictEqual(data.page, 1);
    assert.strictEqual(data.totalPages, 3);
  });

  test('GET /api/sessions with offset param returns correct page', async () => {
    // Insert 5 sessions
    for (let i = 1; i <= 5; i++) {
      await repo.upsertSession(
        createTestSession({
          id: `session-${i}`,
          startTime: `2026-01-0${i}T10:00:00Z`
        })
      );
    }

    const response = await fetch(`${BASE_URL}/api/sessions?limit=2&offset=2`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.data.length, 2);
    assert.strictEqual(data.offset, 2);
    assert.strictEqual(data.page, 2);
  });

  test('GET /api/sessions with dateFrom filters results', async () => {
    await repo.upsertSession(
      createTestSession({
        id: 'old-session',
        startTime: '2025-12-01T10:00:00Z'
      })
    );
    await repo.upsertSession(
      createTestSession({
        id: 'new-session',
        startTime: '2026-01-15T10:00:00Z'
      })
    );

    const response = await fetch(
      `${BASE_URL}/api/sessions?limit=10&dateFrom=2026-01-01`
    );
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.data.length, 1);
    assert.strictEqual(data.data[0].id, 'new-session');
  });

  test('GET /api/sessions allows large limits for loading all sessions', async () => {
    const response = await fetch(`${BASE_URL}/api/sessions?limit=500`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.limit, 500);
  });

  test('GET /api/sessions handles negative offset by clamping to 0', async () => {
    await repo.upsertSession(createTestSession({ id: 'session-1' }));

    const response = await fetch(`${BASE_URL}/api/sessions?limit=10&offset=-5`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.offset, 0);
  });

  test('GET /api/sessions ignores invalid dateFrom', async () => {
    await repo.upsertSession(createTestSession({ id: 'session-1' }));

    const response = await fetch(
      `${BASE_URL}/api/sessions?limit=10&dateFrom=invalid-date`
    );
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.data.length, 1);
  });

  test('GET /api/sessions excludes events by default, returns eventCount', async () => {
    const rawEntry = { type: 'message', timestamp: '2026-01-01T10:00:00Z' };
    await repo.upsertSession(
      createTestSession({
        id: 'session-with-events',
        events: [
          { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 100, raw: rawEntry },
          { type: 'assistant_message', timestamp: '2026-01-01T10:00:01Z', tokenCount: 500, raw: rawEntry }
        ],
        annotations: [
          { type: 'blocker', summary: 'Test blocker', confidence: 0.9 }
        ]
      })
    );

    const response = await fetch(`${BASE_URL}/api/sessions`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.data.length, 1);
    assert.strictEqual(data.data[0].events, undefined);
    assert.strictEqual(data.data[0].annotations, undefined);
    assert.strictEqual(data.data[0].eventCount, 2);
    assert.strictEqual(data.data[0].annotationCount, 1);
  });

  test('GET /api/sessions with includeEvents=true returns events and annotations', async () => {
    const rawEntry = { type: 'message', timestamp: '2026-01-01T10:00:00Z' };
    await repo.upsertSession(
      createTestSession({
        id: 'session-with-events',
        events: [
          { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 100, raw: rawEntry },
          { type: 'assistant_message', timestamp: '2026-01-01T10:00:01Z', tokenCount: 500, raw: rawEntry },
          { type: 'tool_call', timestamp: '2026-01-01T10:00:02Z', tokenCount: 200, raw: rawEntry }
        ],
        annotations: [
          { type: 'blocker', summary: 'Test blocker', confidence: 0.9 },
          { type: 'decision', summary: 'Test decision', confidence: 0.8 }
        ]
      })
    );

    const response = await fetch(`${BASE_URL}/api/sessions?includeEvents=true`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.data.length, 1);
    assert.strictEqual(Array.isArray(data.data[0].events), true);
    assert.strictEqual(data.data[0].events.length, 3);
    assert.strictEqual(data.data[0].events[0].type, 'user_message');
    assert.strictEqual(data.data[0].events[1].type, 'assistant_message');
    assert.strictEqual(data.data[0].events[2].type, 'tool_call');
    assert.strictEqual(Array.isArray(data.data[0].annotations), true);
    assert.strictEqual(data.data[0].annotations.length, 2);
    assert.strictEqual(data.data[0].eventCount, undefined);
    assert.strictEqual(data.data[0].annotationCount, undefined);
  });

  test('GET /api/sessions with includeEvents=false excludes events', async () => {
    const rawEntry = { type: 'message', timestamp: '2026-01-01T10:00:00Z' };
    await repo.upsertSession(
      createTestSession({
        id: 'session-with-events',
        events: [
          { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 100, raw: rawEntry }
        ]
      })
    );

    const response = await fetch(`${BASE_URL}/api/sessions?includeEvents=false`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.data[0].events, undefined);
    assert.strictEqual(data.data[0].eventCount, 1);
  });
});
