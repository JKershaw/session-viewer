/**
 * Unit tests for trust analyzer functions
 *
 * Tests steering metrics extraction, task characteristics, outcome metrics,
 * and trust score computation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractSteeringMetrics,
  extractTaskCharacteristics,
  extractOutcomeMetrics,
  computeTrustScore,
  analyzeSessionTrust
} from '../../../src/analysis/trust-analyzer.js';
import {
  createTestSession,
  createTestEvent,
  createTestAnnotation,
  createTestSessionOutcomes,
  createAutonomousSession,
  createSteeredSession
} from '../../fixtures/sessions.js';

describe('extractSteeringMetrics', () => {
  it('counts zero interventions when only one user message', () => {
    const session = createTestSession({
      events: [
        createTestEvent({ type: 'user_message', timestamp: '2026-01-01T10:00:00Z' }),
        createTestEvent({ type: 'assistant_message', timestamp: '2026-01-01T10:01:00Z' }),
        createTestEvent({ type: 'tool_call', timestamp: '2026-01-01T10:02:00Z' })
      ]
    });

    const metrics = extractSteeringMetrics(session);

    assert.strictEqual(metrics.interventionCount, 0);
    assert.strictEqual(metrics.firstInterventionProgress, null);
    assert.strictEqual(metrics.timeToFirstIntervention, null);
  });

  it('counts interventions correctly', () => {
    const session = createTestSession({
      startTime: '2026-01-01T10:00:00Z',
      endTime: '2026-01-01T11:00:00Z',
      events: [
        createTestEvent({ type: 'user_message', timestamp: '2026-01-01T10:00:00Z' }),
        createTestEvent({ type: 'assistant_message', timestamp: '2026-01-01T10:01:00Z' }),
        createTestEvent({ type: 'user_message', timestamp: '2026-01-01T10:30:00Z' }),
        createTestEvent({ type: 'assistant_message', timestamp: '2026-01-01T10:31:00Z' }),
        createTestEvent({ type: 'user_message', timestamp: '2026-01-01T10:45:00Z' })
      ]
    });

    const metrics = extractSteeringMetrics(session);

    assert.strictEqual(metrics.interventionCount, 2);
  });

  it('calculates first intervention progress correctly', () => {
    const session = createTestSession({
      startTime: '2026-01-01T10:00:00Z',
      endTime: '2026-01-01T11:00:00Z',
      events: [
        createTestEvent({ type: 'user_message', timestamp: '2026-01-01T10:00:00Z' }),
        createTestEvent({ type: 'assistant_message', timestamp: '2026-01-01T10:01:00Z' }),
        createTestEvent({ type: 'user_message', timestamp: '2026-01-01T10:30:00Z' })
      ]
    });

    const metrics = extractSteeringMetrics(session);

    assert.strictEqual(metrics.interventionCount, 1);
    assert.strictEqual(metrics.firstInterventionProgress, 0.5);
    assert.strictEqual(metrics.timeToFirstIntervention, 30 * 60 * 1000);
  });

  it('calculates intervention density correctly', () => {
    const session = createTestSession({
      totalTokens: 10000,
      events: [
        createTestEvent({ type: 'user_message', timestamp: '2026-01-01T10:00:00Z' }),
        createTestEvent({ type: 'user_message', timestamp: '2026-01-01T10:30:00Z' })
      ]
    });

    const metrics = extractSteeringMetrics(session);

    assert.strictEqual(metrics.interventionDensity, 1);
  });

  it('counts goal shifts from annotations', () => {
    const session = createTestSession({
      events: [createTestEvent({ type: 'user_message' })],
      annotations: [
        createTestAnnotation({ type: 'goal_shift', summary: 'Changed direction' }),
        createTestAnnotation({ type: 'goal_shift', summary: 'Another shift' }),
        createTestAnnotation({ type: 'blocker', summary: 'Got stuck' })
      ]
    });

    const metrics = extractSteeringMetrics(session);

    assert.strictEqual(metrics.goalShiftCount, 2);
  });

  it('handles empty events gracefully', () => {
    const session = createTestSession({ events: [] });
    const metrics = extractSteeringMetrics(session);

    assert.strictEqual(metrics.interventionCount, 0);
    assert.strictEqual(metrics.goalShiftCount, 0);
    assert.strictEqual(metrics.interventionDensity, 0);
  });
});

describe('extractTaskCharacteristics', () => {
  it('extracts codebase area from tool calls', () => {
    const session = createTestSession({
      folder: '/home/user/project',
      events: [
        createTestEvent({ type: 'user_message' }),
        createTestEvent({
          type: 'tool_call',
          raw: {
            type: 'tool_use',
            tool_name: 'Read',
            input: { file_path: '/home/user/project/src/auth/login.ts' }
          }
        }),
        createTestEvent({
          type: 'tool_call',
          raw: {
            type: 'tool_use',
            tool_name: 'Read',
            input: { file_path: '/home/user/project/src/auth/utils.ts' }
          }
        })
      ]
    });

    const characteristics = extractTaskCharacteristics(session);

    assert.strictEqual(characteristics.codebaseArea, 'src/auth');
    assert.strictEqual(characteristics.projectPath, '/home/user/project');
  });

  it('classifies branch types correctly', () => {
    const testCases: [string, string][] = [
      ['feature/add-login', 'feature'],
      ['fix/bug-123', 'fix'],
      ['hotfix/critical', 'hotfix'],
      ['refactor/cleanup', 'refactor'],
      ['claude/task-abc', 'claude'],
      ['main', 'main'],
      ['random-branch', 'other']
    ];

    for (const [branch, expected] of testCases) {
      const session = createTestSession({
        branch,
        events: [createTestEvent({ type: 'user_message' })]
      });
      const characteristics = extractTaskCharacteristics(session);
      assert.strictEqual(
        characteristics.branchType,
        expected,
        `Branch "${branch}" should be "${expected}"`
      );
    }
  });

  it('handles null branch', () => {
    const session = createTestSession({
      branch: null,
      events: [createTestEvent({ type: 'user_message' })]
    });
    const characteristics = extractTaskCharacteristics(session);
    assert.strictEqual(characteristics.branchType, null);
  });

  it('extracts ticket metadata when provided', () => {
    const session = createTestSession({
      events: [createTestEvent({ type: 'user_message' })]
    });

    const characteristics = extractTaskCharacteristics(session, 'bug', ['urgent', 'frontend']);

    assert.strictEqual(characteristics.ticketType, 'bug');
    assert.ok(characteristics.ticketLabels.includes('urgent'));
    assert.ok(characteristics.ticketLabels.includes('frontend'));
  });

  it('calculates tool diversity correctly', () => {
    const session = createTestSession({
      events: [
        createTestEvent({ type: 'user_message' }),
        createTestEvent({ type: 'tool_call', raw: { type: 'tool_use', tool_name: 'Read' } }),
        createTestEvent({ type: 'tool_call', raw: { type: 'tool_use', tool_name: 'Read' } }),
        createTestEvent({ type: 'tool_call', raw: { type: 'tool_use', tool_name: 'Write' } }),
        createTestEvent({ type: 'tool_call', raw: { type: 'tool_use', tool_name: 'Bash' } })
      ]
    });

    const characteristics = extractTaskCharacteristics(session);

    assert.strictEqual(characteristics.toolDiversity, 3);
  });

  it('does not mutate the input ticketLabels array', () => {
    const session = createTestSession({
      events: [createTestEvent({ type: 'user_message' })],
      ticketReferences: [
        { ticketId: 'LIN-123', relationship: 'worked', sources: [] }
      ]
    });
    const originalLabels = ['label1', 'label2'];
    const labelsCopy = [...originalLabels];

    extractTaskCharacteristics(session, 'bug', originalLabels);

    assert.deepStrictEqual(originalLabels, labelsCopy);
  });
});

describe('extractOutcomeMetrics', () => {
  it('uses session.outcomes when available', () => {
    const session = createTestSession({
      events: [createTestEvent({ type: 'user_message' })],
      outcomes: createTestSessionOutcomes({
        commits: [
          { message: 'First', ticketIds: [], timestamp: '', eventIndex: 0 },
          { message: 'Second', ticketIds: [], timestamp: '', eventIndex: 1 }
        ],
        pushes: [{ branch: 'main', remote: 'origin', timestamp: '', eventIndex: 2 }]
      })
    });

    const outcome = extractOutcomeMetrics(session);

    assert.strictEqual(outcome.hasCommit, true);
    assert.strictEqual(outcome.commitCount, 2);
    assert.strictEqual(outcome.hasPush, true);
  });

  it('falls back to parsing git events when no outcomes', () => {
    const session = createTestSession({
      events: [
        createTestEvent({ type: 'user_message' }),
        createTestEvent({
          type: 'git_op',
          raw: {
            type: 'tool_use',
            tool_name: 'Bash',
            input: { command: 'git commit -m "test"' }
          }
        }),
        createTestEvent({
          type: 'git_op',
          raw: {
            type: 'tool_use',
            tool_name: 'Bash',
            input: { command: 'git push origin main' }
          }
        })
      ]
    });

    const outcome = extractOutcomeMetrics(session);

    assert.strictEqual(outcome.hasCommit, true);
    assert.strictEqual(outcome.commitCount, 1);
    assert.strictEqual(outcome.hasPush, true);
  });

  it('counts errors and calculates density', () => {
    const session = createTestSession({
      totalTokens: 10000,
      events: [
        createTestEvent({ type: 'user_message' }),
        createTestEvent({ type: 'error' }),
        createTestEvent({ type: 'error' })
      ]
    });

    const outcome = extractOutcomeMetrics(session);

    assert.strictEqual(outcome.errorCount, 2);
    assert.strictEqual(outcome.errorDensity, 2);
  });

  it('detects if session ended with error', () => {
    const sessionWithError = createTestSession({
      events: [
        createTestEvent({ type: 'user_message' }),
        createTestEvent({ type: 'assistant_message' }),
        createTestEvent({ type: 'error' })
      ]
    });

    const sessionWithoutError = createTestSession({
      events: [
        createTestEvent({ type: 'user_message' }),
        createTestEvent({ type: 'error' }),
        createTestEvent({ type: 'assistant_message' }),
        createTestEvent({ type: 'tool_call' }),
        createTestEvent({ type: 'tool_call' }),
        createTestEvent({ type: 'tool_call' }),
        createTestEvent({ type: 'tool_call' }),
        createTestEvent({ type: 'assistant_message' })
      ]
    });

    assert.strictEqual(extractOutcomeMetrics(sessionWithError).endedWithError, true);
    assert.strictEqual(extractOutcomeMetrics(sessionWithoutError).endedWithError, false);
  });

  it('counts annotation types correctly', () => {
    const session = createTestSession({
      events: [createTestEvent({ type: 'user_message' })],
      annotations: [
        createTestAnnotation({ type: 'blocker' }),
        createTestAnnotation({ type: 'blocker' }),
        createTestAnnotation({ type: 'rework' }),
        createTestAnnotation({ type: 'decision' })
      ]
    });

    const outcome = extractOutcomeMetrics(session);

    assert.strictEqual(outcome.blockerCount, 2);
    assert.strictEqual(outcome.reworkCount, 1);
    assert.strictEqual(outcome.decisionCount, 1);
  });
});

describe('computeTrustScore', () => {
  it('gives high score for autonomous session with good outcome', () => {
    const steering = {
      interventionCount: 0,
      firstInterventionProgress: null,
      interventionDensity: 0,
      goalShiftCount: 0,
      timeToFirstIntervention: null
    };
    const outcome = {
      hasCommit: true,
      commitCount: 1,
      hasPush: true,
      blockerCount: 0,
      reworkCount: 0,
      decisionCount: 1,
      errorCount: 0,
      errorDensity: 0,
      durationMs: 3600000,
      totalTokens: 10000,
      endedWithError: false
    };

    const score = computeTrustScore(steering, outcome);

    assert.ok(score >= 0.7, `Expected high score (>=0.7), got ${score}`);
  });

  it('gives low score for heavily steered session with issues', () => {
    const steering = {
      interventionCount: 5,
      firstInterventionProgress: 0.1,
      interventionDensity: 5,
      goalShiftCount: 2,
      timeToFirstIntervention: 60000
    };
    const outcome = {
      hasCommit: false,
      commitCount: 0,
      hasPush: false,
      blockerCount: 3,
      reworkCount: 2,
      decisionCount: 1,
      errorCount: 5,
      errorDensity: 5,
      durationMs: 3600000,
      totalTokens: 10000,
      endedWithError: true
    };

    const score = computeTrustScore(steering, outcome);

    assert.ok(score <= 0.3, `Expected low score (<=0.3), got ${score}`);
  });

  it('score is always between 0 and 1', () => {
    const extremeSteering = {
      interventionCount: 100,
      firstInterventionProgress: 0,
      interventionDensity: 100,
      goalShiftCount: 50,
      timeToFirstIntervention: 0
    };
    const extremeOutcome = {
      hasCommit: false,
      commitCount: 0,
      hasPush: false,
      blockerCount: 100,
      reworkCount: 100,
      decisionCount: 0,
      errorCount: 100,
      errorDensity: 100,
      durationMs: 100,
      totalTokens: 100,
      endedWithError: true
    };

    const lowScore = computeTrustScore(extremeSteering, extremeOutcome);
    assert.ok(lowScore >= 0 && lowScore <= 1, `Score ${lowScore} out of bounds`);

    const perfectSteering = {
      interventionCount: 0,
      firstInterventionProgress: null,
      interventionDensity: 0,
      goalShiftCount: 0,
      timeToFirstIntervention: null
    };
    const perfectOutcome = {
      hasCommit: true,
      commitCount: 5,
      hasPush: true,
      blockerCount: 0,
      reworkCount: 0,
      decisionCount: 0,
      errorCount: 0,
      errorDensity: 0,
      durationMs: 3600000,
      totalTokens: 10000,
      endedWithError: false
    };

    const highScore = computeTrustScore(perfectSteering, perfectOutcome);
    assert.ok(highScore >= 0 && highScore <= 1, `Score ${highScore} out of bounds`);
  });
});

describe('analyzeSessionTrust', () => {
  it('produces complete analysis with all fields', () => {
    const session = createAutonomousSession();

    const analysis = analyzeSessionTrust(session, 'feature', ['frontend']);

    assert.ok(analysis.sessionId);
    assert.ok(analysis.analyzedAt);
    assert.ok(analysis.steering);
    assert.ok(analysis.characteristics);
    assert.ok(analysis.outcome);
    assert.ok(typeof analysis.trustScore === 'number');
    assert.ok(typeof analysis.autonomous === 'boolean');
  });

  it('marks session as autonomous with 0-1 interventions', () => {
    const autonomousSession = createAutonomousSession();
    const steeredSession = createSteeredSession();

    const autonomousAnalysis = analyzeSessionTrust(autonomousSession);
    const steeredAnalysis = analyzeSessionTrust(steeredSession);

    assert.strictEqual(autonomousAnalysis.autonomous, true);
    assert.strictEqual(steeredAnalysis.autonomous, false);
  });

  it('includes ticket metadata in characteristics', () => {
    const session = createTestSession({
      events: [createTestEvent({ type: 'user_message' })]
    });

    const analysis = analyzeSessionTrust(session, 'bug', ['critical', 'backend']);

    assert.strictEqual(analysis.characteristics.ticketType, 'bug');
    assert.ok(analysis.characteristics.ticketLabels.includes('critical'));
    assert.ok(analysis.characteristics.ticketLabels.includes('backend'));
  });
});
