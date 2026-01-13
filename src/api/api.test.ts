import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { closeClient } from '../db/client.js';
import { createSessionRepository, type SessionRepository } from '../db/sessions.js';
import type { Session } from '../types/index.js';

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
    const app = createApp(repo, { logsDir: './non-existent-for-test' });
    server = app.listen(TEST_PORT);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  test('GET /api/sessions returns empty array when no sessions', async () => {
    const response = await fetch(`${BASE_URL}/api/sessions`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.deepStrictEqual(data, []);
  });

  test('GET /api/sessions returns all sessions', async () => {
    await repo.upsertSession(createTestSession({ id: 'session-1' }));
    await repo.upsertSession(createTestSession({ id: 'session-2' }));

    const response = await fetch(`${BASE_URL}/api/sessions`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.length, 2);
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

  test('GET /api/sessions without pagination params returns legacy array', async () => {
    await repo.upsertSession(createTestSession({ id: 'session-1' }));

    const response = await fetch(`${BASE_URL}/api/sessions`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(Array.isArray(data), true);
    assert.strictEqual(data.length, 1);
    // Legacy format should not have pagination metadata
    assert.strictEqual(data.total, undefined);
  });

  test('GET /api/sessions caps limit at 100', async () => {
    const response = await fetch(`${BASE_URL}/api/sessions?limit=500`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.limit, 100);
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
});
