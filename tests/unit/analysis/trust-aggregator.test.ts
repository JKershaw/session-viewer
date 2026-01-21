/**
 * Unit tests for trust aggregator functions
 *
 * Tests trust map building, prediction, and comparative insights.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildTrustMap,
  predictTrust,
  generateComparativeInsights
} from '../../../src/analysis/trust-aggregator.js';
import {
  createTestTrustAnalysis,
  createTestSteeringMetrics,
  createTestTaskCharacteristics,
  createTestOutcomeMetrics
} from '../../fixtures/sessions.js';
import type { SessionTrustAnalysis } from '../../../src/types/trust.js';

// Helper to create analysis with specific characteristics
const createAnalysis = (overrides: Partial<SessionTrustAnalysis> = {}): SessionTrustAnalysis => {
  return createTestTrustAnalysis(overrides);
};

describe('buildTrustMap', () => {
  it('returns empty map for empty analyses', () => {
    const map = buildTrustMap([]);

    assert.deepStrictEqual(map.byArea, []);
    assert.deepStrictEqual(map.byTicketType, []);
    assert.deepStrictEqual(map.byBranchType, []);
    assert.deepStrictEqual(map.byLabel, []);
    assert.deepStrictEqual(map.byProject, []);
    assert.strictEqual(map.global.totalSessions, 0);
    assert.strictEqual(map.global.autonomousRate, 0);
  });

  it('aggregates by codebase area', () => {
    const analyses = [
      createAnalysis({
        sessionId: 's1',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/auth' }),
        trustScore: 0.8,
        autonomous: true
      }),
      createAnalysis({
        sessionId: 's2',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/auth' }),
        trustScore: 0.6,
        autonomous: false
      }),
      createAnalysis({
        sessionId: 's3',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/api' }),
        trustScore: 0.9,
        autonomous: true
      })
    ];

    const map = buildTrustMap(analyses);

    assert.strictEqual(map.byArea.length, 2);

    const authArea = map.byArea.find(a => a.category === 'src/auth');
    assert.ok(authArea);
    assert.strictEqual(authArea.totalSessions, 2);
    assert.strictEqual(authArea.autonomousSessions, 1);
    assert.strictEqual(authArea.autonomousRate, 0.5);
  });

  it('aggregates by ticket type', () => {
    const analyses = [
      createAnalysis({
        sessionId: 's1',
        characteristics: createTestTaskCharacteristics({ ticketType: 'bug' }),
        autonomous: true
      }),
      createAnalysis({
        sessionId: 's2',
        characteristics: createTestTaskCharacteristics({ ticketType: 'bug' }),
        autonomous: true
      }),
      createAnalysis({
        sessionId: 's3',
        characteristics: createTestTaskCharacteristics({ ticketType: 'feature' }),
        autonomous: false
      })
    ];

    const map = buildTrustMap(analyses);

    const bugType = map.byTicketType.find(a => a.category === 'bug');
    assert.ok(bugType);
    assert.strictEqual(bugType.totalSessions, 2);
    assert.strictEqual(bugType.autonomousRate, 1);
  });

  it('aggregates by branch type', () => {
    const analyses = [
      createAnalysis({
        sessionId: 's1',
        characteristics: createTestTaskCharacteristics({ branchType: 'feature' })
      }),
      createAnalysis({
        sessionId: 's2',
        characteristics: createTestTaskCharacteristics({ branchType: 'fix' })
      })
    ];

    const map = buildTrustMap(analyses);

    assert.strictEqual(map.byBranchType.length, 2);
  });

  it('aggregates by labels (sessions can have multiple)', () => {
    const analyses = [
      createAnalysis({
        sessionId: 's1',
        characteristics: createTestTaskCharacteristics({ ticketLabels: ['urgent', 'frontend'] }),
        autonomous: true
      }),
      createAnalysis({
        sessionId: 's2',
        characteristics: createTestTaskCharacteristics({ ticketLabels: ['frontend', 'backend'] }),
        autonomous: false
      })
    ];

    const map = buildTrustMap(analyses);

    const frontendLabel = map.byLabel.find(a => a.category === 'frontend');
    assert.ok(frontendLabel);
    assert.strictEqual(frontendLabel.totalSessions, 2);
    assert.strictEqual(frontendLabel.autonomousSessions, 1);

    const urgentLabel = map.byLabel.find(a => a.category === 'urgent');
    assert.ok(urgentLabel);
    assert.strictEqual(urgentLabel.totalSessions, 1);
  });

  it('calculates global statistics correctly', () => {
    const analyses = [
      createAnalysis({ sessionId: 's1', trustScore: 0.8, autonomous: true }),
      createAnalysis({ sessionId: 's2', trustScore: 0.6, autonomous: true }),
      createAnalysis({ sessionId: 's3', trustScore: 0.4, autonomous: false }),
      createAnalysis({ sessionId: 's4', trustScore: 0.2, autonomous: false })
    ];

    const map = buildTrustMap(analyses);

    assert.strictEqual(map.global.totalSessions, 4);
    assert.strictEqual(map.global.autonomousRate, 0.5);
    assert.ok(Math.abs(map.global.avgTrustScore - 0.5) < 0.001, `avgTrustScore should be ~0.5, got ${map.global.avgTrustScore}`);
  });

  it('calculates outcome rates correctly', () => {
    const analyses = [
      createAnalysis({
        sessionId: 's1',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/test' }),
        outcome: createTestOutcomeMetrics({ hasCommit: true, reworkCount: 0, endedWithError: false })
      }),
      createAnalysis({
        sessionId: 's2',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/test' }),
        outcome: createTestOutcomeMetrics({ hasCommit: true, reworkCount: 1, endedWithError: false })
      }),
      createAnalysis({
        sessionId: 's3',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/test' }),
        outcome: createTestOutcomeMetrics({ hasCommit: false, reworkCount: 0, endedWithError: true })
      })
    ];

    const map = buildTrustMap(analyses);

    const testArea = map.byArea.find(a => a.category === 'src/test');
    assert.ok(testArea);
    assert.ok(Math.abs(testArea.commitRate - 2/3) < 0.01);
    assert.ok(Math.abs(testArea.reworkRate - 1/3) < 0.01);
    assert.ok(Math.abs(testArea.errorRate - 1/3) < 0.01);
  });

  it('calculates confidence based on sample size', () => {
    const analyses = Array.from({ length: 20 }, (_, i) =>
      createAnalysis({
        sessionId: `s${i}`,
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/main' })
      })
    );

    const map = buildTrustMap(analyses);

    const mainArea = map.byArea.find(a => a.category === 'src/main');
    assert.ok(mainArea);
    assert.ok(mainArea.confidence > 0.8, 'Confidence should be high with 20 samples');
  });

  it('sorts aggregates by total sessions (most data first)', () => {
    const analyses = [
      ...Array.from({ length: 10 }, (_, i) =>
        createAnalysis({
          sessionId: `s-main-${i}`,
          characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/main' })
        })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        createAnalysis({
          sessionId: `s-util-${i}`,
          characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/utils' })
        })
      )
    ];

    const map = buildTrustMap(analyses);

    assert.strictEqual(map.byArea[0].category, 'src/main');
    assert.strictEqual(map.byArea[1].category, 'src/utils');
  });
});

describe('predictTrust', () => {
  it('predicts high trust for historically successful areas', () => {
    const analyses = Array.from({ length: 10 }, (_, i) =>
      createAnalysis({
        sessionId: `s${i}`,
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/safe' }),
        trustScore: 0.9,
        autonomous: true
      })
    );

    const map = buildTrustMap(analyses);
    const prediction = predictTrust(map, { codebaseArea: 'src/safe' });

    assert.strictEqual(prediction.predictedTrust, 'high');
    // With 10 samples, confidence ~0.73, and confidenceScore = totalWeight/2 ≈ 0.365
    assert.ok(prediction.confidenceScore > 0.3, `Expected confidence > 0.3, got ${prediction.confidenceScore}`);
  });

  it('predicts low trust for historically problematic areas', () => {
    const analyses = Array.from({ length: 10 }, (_, i) =>
      createAnalysis({
        sessionId: `s${i}`,
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/risky' }),
        steering: createTestSteeringMetrics({ interventionCount: 5 }),
        trustScore: 0.2,
        autonomous: false
      })
    );

    const map = buildTrustMap(analyses);
    const prediction = predictTrust(map, { codebaseArea: 'src/risky' });

    assert.strictEqual(prediction.predictedTrust, 'low');
  });

  it('includes factors that contributed to prediction', () => {
    const analyses = Array.from({ length: 5 }, (_, i) =>
      createAnalysis({
        sessionId: `s${i}`,
        characteristics: createTestTaskCharacteristics({
          codebaseArea: 'src/test',
          ticketType: 'bug'
        }),
        trustScore: 0.7
      })
    );

    const map = buildTrustMap(analyses);
    const prediction = predictTrust(map, {
      codebaseArea: 'src/test',
      ticketType: 'bug'
    });

    assert.ok(prediction.factors.length >= 2);
    assert.ok(prediction.factors.some(f => f.source.startsWith('area:')));
    assert.ok(prediction.factors.some(f => f.source.startsWith('type:')));
  });

  it('falls back to global baseline when no matches', () => {
    const analyses = Array.from({ length: 5 }, (_, i) =>
      createAnalysis({
        sessionId: `s${i}`,
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/known' }),
        trustScore: 0.6
      })
    );

    const map = buildTrustMap(analyses);
    const prediction = predictTrust(map, { codebaseArea: 'src/unknown' });

    assert.ok(prediction.confidenceScore < 0.5);
    assert.strictEqual(prediction.factors.length, 0);
  });

  it('generates recommendation based on trust level', () => {
    const highTrustAnalyses = Array.from({ length: 5 }, (_, i) =>
      createAnalysis({
        sessionId: `s${i}`,
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/easy' }),
        trustScore: 0.9,
        autonomous: true
      })
    );

    const map = buildTrustMap(highTrustAnalyses);
    const prediction = predictTrust(map, { codebaseArea: 'src/easy' });

    assert.ok(prediction.recommendation);
    assert.strictEqual(prediction.suggestedApproach, 'autonomous');
  });

  it('ignores categories with insufficient data', () => {
    const analyses = [
      createAnalysis({
        sessionId: 's1',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/rare' }),
        trustScore: 0.1
      }),
      createAnalysis({
        sessionId: 's2',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/rare' }),
        trustScore: 0.1
      })
    ];

    const map = buildTrustMap(analyses);
    const prediction = predictTrust(map, { codebaseArea: 'src/rare' });

    assert.strictEqual(prediction.factors.length, 0);
  });
});

describe('generateComparativeInsights', () => {
  it('identifies areas that need more steering than average', () => {
    const analyses = [
      ...Array.from({ length: 10 }, (_, i) =>
        createAnalysis({
          sessionId: `good-${i}`,
          characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/easy' }),
          steering: createTestSteeringMetrics({ interventionCount: 0 }),
          autonomous: true
        })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        createAnalysis({
          sessionId: `hard-${i}`,
          characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/hard' }),
          steering: createTestSteeringMetrics({ interventionCount: 5 }),
          autonomous: false
        })
      )
    ];

    const map = buildTrustMap(analyses);
    const insights = generateComparativeInsights(map);

    assert.ok(
      insights.some(i => i.includes('src/hard') && i.includes('more steering')),
      'Should identify hard area needs more steering'
    );
  });

  it('highlights areas with high autonomous completion', () => {
    const analyses = [
      ...Array.from({ length: 10 }, (_, i) =>
        createAnalysis({
          sessionId: `auto-${i}`,
          characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/auto' }),
          autonomous: true
        })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        createAnalysis({
          sessionId: `manual-${i}`,
          characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/manual' }),
          autonomous: false
        })
      )
    ];

    const map = buildTrustMap(analyses);
    const insights = generateComparativeInsights(map);

    assert.ok(
      insights.some(i => i.includes('src/auto') && i.includes('autonomous')),
      'Should highlight high autonomous area'
    );
  });

  it('returns empty array for maps without enough data', () => {
    const analyses = [
      createAnalysis({
        sessionId: 's1',
        characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/test' })
      })
    ];

    const map = buildTrustMap(analyses);
    const insights = generateComparativeInsights(map);

    assert.strictEqual(insights.length, 0);
  });

  it('identifies high rework rate categories', () => {
    const analyses = [
      ...Array.from({ length: 10 }, (_, i) =>
        createAnalysis({
          sessionId: `rework-${i}`,
          characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/messy' }),
          outcome: createTestOutcomeMetrics({ reworkCount: 2 }),
          autonomous: true
        })
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        createAnalysis({
          sessionId: `clean-${i}`,
          characteristics: createTestTaskCharacteristics({ codebaseArea: 'src/clean' }),
          outcome: createTestOutcomeMetrics({ reworkCount: 0 }),
          autonomous: true
        })
      )
    ];

    const map = buildTrustMap(analyses);
    const insights = generateComparativeInsights(map);

    assert.ok(
      insights.some(i => i.includes('src/messy') && i.includes('rework')),
      'Should identify high rework area'
    );
  });
});
