import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { createSessionRepository, type SessionRepository } from '../../../src/db/sessions.js';
import type { Session } from '../../../src/types/index.js';
import { closeClient } from '../../../src/db/client.js';

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

  test('getSessions returns paginated results', async () => {
    // Insert 5 sessions
    for (let i = 1; i <= 5; i++) {
      await repo.upsertSession(
        createTestSession({
          id: `session-${i}`,
          startTime: `2026-01-0${i}T10:00:00Z`
        })
      );
    }

    const result = await repo.getSessions({ limit: 2, offset: 0 });

    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.data.length, 2);
    assert.strictEqual(result.limit, 2);
    assert.strictEqual(result.offset, 0);
  });

  test('getSessions with offset skips results', async () => {
    // Insert 5 sessions
    for (let i = 1; i <= 5; i++) {
      await repo.upsertSession(
        createTestSession({
          id: `session-${i}`,
          startTime: `2026-01-0${i}T10:00:00Z`
        })
      );
    }

    const result = await repo.getSessions({ limit: 2, offset: 2 });

    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.data.length, 2);
    assert.strictEqual(result.offset, 2);
  });

  test('getSessions filters by dateFrom', async () => {
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

    const result = await repo.getSessions({
      dateFrom: '2026-01-01T00:00:00Z'
    });

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.data[0].id, 'new-session');
  });

  test('getSessions filters by dateTo', async () => {
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

    const result = await repo.getSessions({
      dateTo: '2025-12-31T23:59:59Z'
    });

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.data[0].id, 'old-session');
  });

  test('getSessions sorts by startTime descending', async () => {
    await repo.upsertSession(
      createTestSession({
        id: 'first-session',
        startTime: '2026-01-01T10:00:00Z'
      })
    );
    await repo.upsertSession(
      createTestSession({
        id: 'last-session',
        startTime: '2026-01-10T10:00:00Z'
      })
    );
    await repo.upsertSession(
      createTestSession({
        id: 'middle-session',
        startTime: '2026-01-05T10:00:00Z'
      })
    );

    const result = await repo.getSessions({});

    assert.strictEqual(result.data[0].id, 'last-session');
    assert.strictEqual(result.data[1].id, 'middle-session');
    assert.strictEqual(result.data[2].id, 'first-session');
  });

  test('getSessions uses default limit when not specified', async () => {
    const result = await repo.getSessions({});

    assert.strictEqual(result.limit, 50);
    assert.strictEqual(result.offset, 0);
  });

  test('getSessions filters by both dateFrom and dateTo', async () => {
    await repo.upsertSession(
      createTestSession({
        id: 'early-session',
        startTime: '2025-12-01T10:00:00Z'
      })
    );
    await repo.upsertSession(
      createTestSession({
        id: 'middle-session',
        startTime: '2026-01-15T10:00:00Z'
      })
    );
    await repo.upsertSession(
      createTestSession({
        id: 'late-session',
        startTime: '2026-02-01T10:00:00Z'
      })
    );

    const result = await repo.getSessions({
      dateFrom: '2026-01-01T00:00:00Z',
      dateTo: '2026-01-31T23:59:59Z'
    });

    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.data[0].id, 'middle-session');
  });
});
