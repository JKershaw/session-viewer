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
});
