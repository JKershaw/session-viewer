import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { createSessionRepository, type SessionRepository } from './sessions.js';
import type { Session } from '../types/index.js';
import { closeClient } from './client.js';

const TEST_DATA_DIR = './test-data';

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

describe('SessionRepository', () => {
  let repo: SessionRepository;

  beforeEach(async () => {
    repo = await createSessionRepository(TEST_DATA_DIR);
  });

  afterEach(async () => {
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  test('upsertSession inserts a new session', async () => {
    const session = createTestSession();

    await repo.upsertSession(session);

    const found = await repo.getSession('test-session-1');
    assert.strictEqual(found?.id, 'test-session-1');
    assert.strictEqual(found?.totalTokens, 5000);
  });

  test('upsertSession updates existing session', async () => {
    const session = createTestSession();
    await repo.upsertSession(session);

    const updated = createTestSession({ totalTokens: 7500 });
    await repo.upsertSession(updated);

    const found = await repo.getSession('test-session-1');
    assert.strictEqual(found?.totalTokens, 7500);
  });

  test('getAllSessions returns all sessions', async () => {
    await repo.upsertSession(createTestSession({ id: 'session-1' }));
    await repo.upsertSession(createTestSession({ id: 'session-2' }));
    await repo.upsertSession(createTestSession({ id: 'session-3' }));

    const sessions = await repo.getAllSessions();

    assert.strictEqual(sessions.length, 3);
  });

  test('getSession returns null for non-existent session', async () => {
    const found = await repo.getSession('non-existent');
    assert.strictEqual(found, null);
  });

  test('deleteSession removes a session', async () => {
    const session = createTestSession();
    await repo.upsertSession(session);

    await repo.deleteSession('test-session-1');

    const found = await repo.getSession('test-session-1');
    assert.strictEqual(found, null);
  });
});
