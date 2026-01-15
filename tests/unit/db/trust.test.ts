import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { createTrustRepository, type TrustRepository } from '../../../src/db/trust.js';
import type { SessionTrustAnalysis, TrustMap } from '../../../src/types/index.js';
import { closeClient } from '../../../src/db/client.js';

const TEST_DATA_DIR = './test-data-trust';

const createTestAnalysis = (overrides: Partial<SessionTrustAnalysis> = {}): SessionTrustAnalysis => ({
  sessionId: 'test-session-1',
  analyzedAt: '2024-01-01T10:00:00Z',
  steering: {
    interventionCount: 1,
    firstInterventionProgress: 0.3,
    interventionDensity: 0.5,
    goalShiftCount: 0,
    timeToFirstIntervention: 1800000
  },
  characteristics: {
    codebaseArea: 'src/auth',
    projectPath: '/project',
    branchType: 'feature',
    ticketType: 'bug',
    ticketLabels: ['frontend'],
    initialPromptTokens: 500,
    subtaskCount: 3,
    toolDiversity: 5,
    filePatterns: ['src/auth', 'src/utils']
  },
  outcome: {
    hasCommit: true,
    commitCount: 1,
    hasPush: false,
    blockerCount: 1,
    reworkCount: 0,
    decisionCount: 2,
    errorCount: 1,
    errorDensity: 0.5,
    durationMs: 3600000,
    totalTokens: 10000,
    endedWithError: false
  },
  trustScore: 0.65,
  autonomous: false,
  ...overrides
});

const createTestTrustMap = (overrides: Partial<TrustMap> = {}): TrustMap => ({
  byArea: [
    {
      category: 'src/auth',
      categoryType: 'area',
      totalSessions: 10,
      autonomousSessions: 6,
      autonomousRate: 0.6,
      avgTrustScore: 0.7,
      avgInterventionCount: 1.2,
      avgInterventionDensity: 0.8,
      commitRate: 0.9,
      reworkRate: 0.1,
      errorRate: 0.2,
      avgFirstInterventionProgress: 0.4,
      confidence: 0.8,
      updatedAt: '2024-01-01T10:00:00Z'
    }
  ],
  byTicketType: [],
  byBranchType: [],
  byLabel: [],
  byProject: [],
  global: {
    totalSessions: 10,
    autonomousRate: 0.6,
    avgTrustScore: 0.7,
    avgInterventionCount: 1.2
  },
  computedAt: '2024-01-01T10:00:00Z',
  ...overrides
});

describe('TrustRepository', () => {
  let repo: TrustRepository;

  beforeEach(async () => {
    repo = await createTrustRepository(TEST_DATA_DIR);
  });

  afterEach(async () => {
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('Session Trust Analyses', () => {
    test('upsertSessionAnalysis inserts a new analysis', async () => {
      const analysis = createTestAnalysis();

      await repo.upsertSessionAnalysis(analysis);

      const found = await repo.getSessionAnalysis('test-session-1');
      assert.strictEqual(found?.sessionId, 'test-session-1');
      assert.strictEqual(found?.trustScore, 0.65);
      assert.strictEqual(found?.autonomous, false);
    });

    test('upsertSessionAnalysis updates existing analysis', async () => {
      const analysis = createTestAnalysis();
      await repo.upsertSessionAnalysis(analysis);

      const updated = createTestAnalysis({ trustScore: 0.85, autonomous: true });
      await repo.upsertSessionAnalysis(updated);

      const found = await repo.getSessionAnalysis('test-session-1');
      assert.strictEqual(found?.trustScore, 0.85);
      assert.strictEqual(found?.autonomous, true);
    });

    test('upsertSessionAnalyses handles bulk inserts', async () => {
      const analyses = [
        createTestAnalysis({ sessionId: 'session-1', trustScore: 0.5 }),
        createTestAnalysis({ sessionId: 'session-2', trustScore: 0.6 }),
        createTestAnalysis({ sessionId: 'session-3', trustScore: 0.7 })
      ];

      const count = await repo.upsertSessionAnalyses(analyses);

      assert.strictEqual(count, 3);

      const all = await repo.getAllSessionAnalyses();
      assert.strictEqual(all.length, 3);
    });

    test('upsertSessionAnalyses returns 0 for empty array', async () => {
      const count = await repo.upsertSessionAnalyses([]);
      assert.strictEqual(count, 0);
    });

    test('getSessionAnalysis returns null for non-existent session', async () => {
      const found = await repo.getSessionAnalysis('non-existent');
      assert.strictEqual(found, null);
    });

    test('getAllSessionAnalyses returns all analyses', async () => {
      await repo.upsertSessionAnalyses([
        createTestAnalysis({ sessionId: 'session-1' }),
        createTestAnalysis({ sessionId: 'session-2' })
      ]);

      const all = await repo.getAllSessionAnalyses();

      assert.strictEqual(all.length, 2);
      const ids = all.map(a => a.sessionId).sort();
      assert.deepStrictEqual(ids, ['session-1', 'session-2']);
    });

    test('preserves nested steering metrics', async () => {
      const analysis = createTestAnalysis({
        steering: {
          interventionCount: 5,
          firstInterventionProgress: 0.2,
          interventionDensity: 2.5,
          goalShiftCount: 2,
          timeToFirstIntervention: 300000
        }
      });

      await repo.upsertSessionAnalysis(analysis);

      const found = await repo.getSessionAnalysis(analysis.sessionId);
      assert.strictEqual(found?.steering.interventionCount, 5);
      assert.strictEqual(found?.steering.firstInterventionProgress, 0.2);
      assert.strictEqual(found?.steering.goalShiftCount, 2);
    });

    test('preserves nested characteristics', async () => {
      const analysis = createTestAnalysis({
        characteristics: {
          codebaseArea: 'src/api',
          projectPath: '/my/project',
          branchType: 'fix',
          ticketType: 'feature',
          ticketLabels: ['backend', 'urgent'],
          initialPromptTokens: 1000,
          subtaskCount: 5,
          toolDiversity: 8,
          filePatterns: ['src/api', 'tests']
        }
      });

      await repo.upsertSessionAnalysis(analysis);

      const found = await repo.getSessionAnalysis(analysis.sessionId);
      assert.strictEqual(found?.characteristics.codebaseArea, 'src/api');
      assert.strictEqual(found?.characteristics.branchType, 'fix');
      assert.deepStrictEqual(found?.characteristics.ticketLabels, ['backend', 'urgent']);
    });

    test('preserves nested outcome metrics', async () => {
      const analysis = createTestAnalysis({
        outcome: {
          hasCommit: true,
          commitCount: 3,
          hasPush: true,
          blockerCount: 2,
          reworkCount: 1,
          decisionCount: 4,
          errorCount: 0,
          errorDensity: 0,
          durationMs: 7200000,
          totalTokens: 20000,
          endedWithError: false
        }
      });

      await repo.upsertSessionAnalysis(analysis);

      const found = await repo.getSessionAnalysis(analysis.sessionId);
      assert.strictEqual(found?.outcome.commitCount, 3);
      assert.strictEqual(found?.outcome.hasPush, true);
      assert.strictEqual(found?.outcome.reworkCount, 1);
    });
  });

  describe('Trust Map', () => {
    test('saveTrustMap stores the map', async () => {
      const map = createTestTrustMap();

      await repo.saveTrustMap(map);

      const found = await repo.getTrustMap();
      assert.ok(found);
      assert.strictEqual(found.global.totalSessions, 10);
    });

    test('saveTrustMap replaces existing map', async () => {
      const map1 = createTestTrustMap({ global: { ...createTestTrustMap().global, totalSessions: 10 } });
      await repo.saveTrustMap(map1);

      const map2 = createTestTrustMap({ global: { ...createTestTrustMap().global, totalSessions: 50 } });
      await repo.saveTrustMap(map2);

      const found = await repo.getTrustMap();
      assert.strictEqual(found?.global.totalSessions, 50);
    });

    test('getTrustMap returns null when no map exists', async () => {
      const found = await repo.getTrustMap();
      assert.strictEqual(found, null);
    });

    test('preserves byArea aggregates', async () => {
      const map = createTestTrustMap({
        byArea: [
          {
            category: 'src/auth',
            categoryType: 'area',
            totalSessions: 15,
            autonomousSessions: 10,
            autonomousRate: 0.67,
            avgTrustScore: 0.75,
            avgInterventionCount: 0.8,
            avgInterventionDensity: 0.5,
            commitRate: 0.95,
            reworkRate: 0.05,
            errorRate: 0.1,
            avgFirstInterventionProgress: 0.6,
            confidence: 0.9,
            updatedAt: '2024-01-01T12:00:00Z'
          },
          {
            category: 'src/api',
            categoryType: 'area',
            totalSessions: 8,
            autonomousSessions: 4,
            autonomousRate: 0.5,
            avgTrustScore: 0.6,
            avgInterventionCount: 1.5,
            avgInterventionDensity: 1.0,
            commitRate: 0.8,
            reworkRate: 0.2,
            errorRate: 0.15,
            avgFirstInterventionProgress: 0.3,
            confidence: 0.75,
            updatedAt: '2024-01-01T12:00:00Z'
          }
        ]
      });

      await repo.saveTrustMap(map);

      const found = await repo.getTrustMap();
      assert.strictEqual(found?.byArea.length, 2);
      assert.strictEqual(found?.byArea[0].category, 'src/auth');
      assert.strictEqual(found?.byArea[0].totalSessions, 15);
      assert.strictEqual(found?.byArea[1].category, 'src/api');
    });

    test('preserves global statistics', async () => {
      const map = createTestTrustMap({
        global: {
          totalSessions: 100,
          autonomousRate: 0.72,
          avgTrustScore: 0.68,
          avgInterventionCount: 1.1
        }
      });

      await repo.saveTrustMap(map);

      const found = await repo.getTrustMap();
      assert.strictEqual(found?.global.totalSessions, 100);
      assert.strictEqual(found?.global.autonomousRate, 0.72);
      assert.strictEqual(found?.global.avgTrustScore, 0.68);
      assert.strictEqual(found?.global.avgInterventionCount, 1.1);
    });

    test('preserves computedAt timestamp', async () => {
      const map = createTestTrustMap({ computedAt: '2024-06-15T08:30:00Z' });

      await repo.saveTrustMap(map);

      const found = await repo.getTrustMap();
      assert.strictEqual(found?.computedAt, '2024-06-15T08:30:00Z');
    });
  });
});
