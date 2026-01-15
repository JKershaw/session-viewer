import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractSteeringMetrics,
  extractTaskCharacteristics,
  extractOutcomeMetrics,
  computeTrustScore,
  analyzeSessionTrust
} from '../../../src/analysis/trust-analyzer.js';
import type { Session, Event } from '../../../src/types/index.js';

// Helper to create a minimal session
const createSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'test-session',
  parentSessionId: null,
  startTime: '2024-01-01T10:00:00Z',
  endTime: '2024-01-01T11:00:00Z',
  durationMs: 3600000,
  totalTokens: 10000,
  branch: 'feature/test',
  folder: '/home/user/project',
  linearTicketId: null,
  analyzed: false,
  events: [],
  annotations: [],
  ...overrides
});

// Helper to create events
const createEvent = (type: Event['type'], timestamp: string, tokenCount = 100): Event => ({
  type,
  timestamp,
  tokenCount,
  raw: { type: type === 'user_message' ? 'message' : 'tool_use', message: { role: type === 'user_message' ? 'user' : 'assistant' } }
});

describe('Trust Analyzer', () => {
  describe('extractSteeringMetrics', () => {
    it('counts zero interventions when only one user message', () => {
      const session = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          createEvent('assistant_message', '2024-01-01T10:01:00Z'),
          createEvent('tool_call', '2024-01-01T10:02:00Z')
        ]
      });

      const metrics = extractSteeringMetrics(session);
      assert.strictEqual(metrics.interventionCount, 0);
      assert.strictEqual(metrics.firstInterventionProgress, null);
      assert.strictEqual(metrics.timeToFirstIntervention, null);
    });

    it('counts interventions correctly', () => {
      const session = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),  // Initial prompt
          createEvent('assistant_message', '2024-01-01T10:01:00Z'),
          createEvent('user_message', '2024-01-01T10:30:00Z'),  // Intervention 1
          createEvent('assistant_message', '2024-01-01T10:31:00Z'),
          createEvent('user_message', '2024-01-01T10:45:00Z'),  // Intervention 2
        ]
      });

      const metrics = extractSteeringMetrics(session);
      assert.strictEqual(metrics.interventionCount, 2);
    });

    it('calculates first intervention progress correctly', () => {
      const session = createSession({
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T11:00:00Z',  // 1 hour duration
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),  // Initial
          createEvent('assistant_message', '2024-01-01T10:01:00Z'),
          createEvent('user_message', '2024-01-01T10:30:00Z'),  // 30 min in = 50%
        ]
      });

      const metrics = extractSteeringMetrics(session);
      assert.strictEqual(metrics.interventionCount, 1);
      assert.strictEqual(metrics.firstInterventionProgress, 0.5);
      assert.strictEqual(metrics.timeToFirstIntervention, 30 * 60 * 1000); // 30 minutes
    });

    it('calculates intervention density correctly', () => {
      const session = createSession({
        totalTokens: 10000,
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          createEvent('user_message', '2024-01-01T10:30:00Z'),  // 1 intervention
        ]
      });

      const metrics = extractSteeringMetrics(session);
      // 1 intervention per 10000 tokens = 1 per 10k tokens
      assert.strictEqual(metrics.interventionDensity, 1);
    });

    it('counts goal shifts from annotations', () => {
      const session = createSession({
        events: [createEvent('user_message', '2024-01-01T10:00:00Z')],
        annotations: [
          { type: 'goal_shift', summary: 'Changed direction', confidence: 0.8 },
          { type: 'goal_shift', summary: 'Another shift', confidence: 0.7 },
          { type: 'blocker', summary: 'Got stuck', confidence: 0.9 }
        ]
      });

      const metrics = extractSteeringMetrics(session);
      assert.strictEqual(metrics.goalShiftCount, 2);
    });

    it('handles empty events gracefully', () => {
      const session = createSession({ events: [] });
      const metrics = extractSteeringMetrics(session);

      assert.strictEqual(metrics.interventionCount, 0);
      assert.strictEqual(metrics.goalShiftCount, 0);
      assert.strictEqual(metrics.interventionDensity, 0);
    });
  });

  describe('extractTaskCharacteristics', () => {
    it('extracts codebase area from tool calls', () => {
      const session = createSession({
        folder: '/home/user/project',
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          {
            type: 'tool_call',
            timestamp: '2024-01-01T10:01:00Z',
            tokenCount: 50,
            raw: { type: 'tool_use', tool_name: 'Read', input: { file_path: '/home/user/project/src/auth/login.ts' } }
          },
          {
            type: 'tool_call',
            timestamp: '2024-01-01T10:02:00Z',
            tokenCount: 50,
            raw: { type: 'tool_use', tool_name: 'Read', input: { file_path: '/home/user/project/src/auth/utils.ts' } }
          }
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
        const session = createSession({ branch, events: [createEvent('user_message', '2024-01-01T10:00:00Z')] });
        const characteristics = extractTaskCharacteristics(session);
        assert.strictEqual(characteristics.branchType, expected, `Branch "${branch}" should be "${expected}"`);
      }
    });

    it('handles null branch', () => {
      const session = createSession({ branch: null, events: [createEvent('user_message', '2024-01-01T10:00:00Z')] });
      const characteristics = extractTaskCharacteristics(session);
      assert.strictEqual(characteristics.branchType, null);
    });

    it('extracts ticket metadata when provided', () => {
      const session = createSession({
        events: [createEvent('user_message', '2024-01-01T10:00:00Z')]
      });

      const characteristics = extractTaskCharacteristics(session, 'bug', ['urgent', 'frontend']);
      assert.strictEqual(characteristics.ticketType, 'bug');
      assert.deepStrictEqual(characteristics.ticketLabels, ['urgent', 'frontend']);
    });

    it('calculates tool diversity correctly', () => {
      const session = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          { type: 'tool_call', timestamp: '2024-01-01T10:01:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Read' } },
          { type: 'tool_call', timestamp: '2024-01-01T10:02:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Read' } },
          { type: 'tool_call', timestamp: '2024-01-01T10:03:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Write' } },
          { type: 'tool_call', timestamp: '2024-01-01T10:04:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Bash' } },
          { type: 'git_op', timestamp: '2024-01-01T10:05:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Bash' } }
        ]
      });

      const characteristics = extractTaskCharacteristics(session);
      // Read, Write, Bash = 3 unique tools (git_op also uses Bash)
      assert.strictEqual(characteristics.toolDiversity, 3);
    });

    it('counts subtasks from planning events', () => {
      const session = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          {
            type: 'planning_mode',
            timestamp: '2024-01-01T10:01:00Z',
            tokenCount: 100,
            raw: {
              type: 'assistant',
              message: { content: '- First task\n- Second task\n- Third task' }
            }
          }
        ]
      });

      const characteristics = extractTaskCharacteristics(session);
      assert.strictEqual(characteristics.subtaskCount, 3);
    });
  });

  describe('extractOutcomeMetrics', () => {
    it('detects commits and pushes', () => {
      const session = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          {
            type: 'git_op',
            timestamp: '2024-01-01T10:30:00Z',
            tokenCount: 50,
            raw: { type: 'tool_use', tool_name: 'Bash', input: { command: 'git commit -m "fix bug"' } }
          },
          {
            type: 'git_op',
            timestamp: '2024-01-01T10:31:00Z',
            tokenCount: 50,
            raw: { type: 'tool_use', tool_name: 'Bash', input: { command: 'git push origin main' } }
          }
        ]
      });

      const outcome = extractOutcomeMetrics(session);
      assert.strictEqual(outcome.hasCommit, true);
      assert.strictEqual(outcome.commitCount, 1);
      assert.strictEqual(outcome.hasPush, true);
    });

    it('counts multiple commits', () => {
      const session = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          { type: 'git_op', timestamp: '2024-01-01T10:30:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Bash', input: { command: 'git commit -m "first"' } } },
          { type: 'git_op', timestamp: '2024-01-01T10:35:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Bash', input: { command: 'git commit -m "second"' } } },
          { type: 'git_op', timestamp: '2024-01-01T10:40:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Bash', input: { command: 'git commit -m "third"' } } }
        ]
      });

      const outcome = extractOutcomeMetrics(session);
      assert.strictEqual(outcome.commitCount, 3);
      assert.strictEqual(outcome.hasPush, false);
    });

    it('counts errors and calculates density', () => {
      const session = createSession({
        totalTokens: 10000,
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          createEvent('error', '2024-01-01T10:10:00Z'),
          createEvent('error', '2024-01-01T10:20:00Z')
        ]
      });

      const outcome = extractOutcomeMetrics(session);
      assert.strictEqual(outcome.errorCount, 2);
      assert.strictEqual(outcome.errorDensity, 2); // 2 errors per 10k tokens
    });

    it('detects if session ended with error', () => {
      const sessionWithError = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          createEvent('assistant_message', '2024-01-01T10:05:00Z'),
          createEvent('error', '2024-01-01T10:10:00Z')
        ]
      });

      // Session where error is NOT in the last 5 events
      const sessionWithoutError = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          createEvent('error', '2024-01-01T10:02:00Z'),  // Error early
          createEvent('assistant_message', '2024-01-01T10:05:00Z'),
          createEvent('tool_call', '2024-01-01T10:06:00Z'),
          createEvent('tool_call', '2024-01-01T10:07:00Z'),
          createEvent('tool_call', '2024-01-01T10:08:00Z'),
          createEvent('tool_call', '2024-01-01T10:09:00Z'),
          createEvent('assistant_message', '2024-01-01T10:10:00Z')
        ]
      });

      assert.strictEqual(extractOutcomeMetrics(sessionWithError).endedWithError, true);
      assert.strictEqual(extractOutcomeMetrics(sessionWithoutError).endedWithError, false);
    });

    it('counts annotation types correctly', () => {
      const session = createSession({
        events: [createEvent('user_message', '2024-01-01T10:00:00Z')],
        annotations: [
          { type: 'blocker', summary: 'Stuck on X', confidence: 0.9 },
          { type: 'blocker', summary: 'Stuck on Y', confidence: 0.8 },
          { type: 'rework', summary: 'Had to redo', confidence: 0.7 },
          { type: 'decision', summary: 'Chose option A', confidence: 0.85 }
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
        firstInterventionProgress: 0.1,  // Early intervention
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
      // Test extreme cases
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
      const session = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          createEvent('assistant_message', '2024-01-01T10:01:00Z'),
          { type: 'tool_call', timestamp: '2024-01-01T10:02:00Z', tokenCount: 50, raw: { type: 'tool_use', tool_name: 'Read', input: { file_path: '/project/src/auth/login.ts' } } }
        ]
      });

      const analysis = analyzeSessionTrust(session, 'feature', ['frontend']);

      // Check all required fields exist
      assert.ok(analysis.sessionId);
      assert.ok(analysis.analyzedAt);
      assert.ok(analysis.steering);
      assert.ok(analysis.characteristics);
      assert.ok(analysis.outcome);
      assert.ok(typeof analysis.trustScore === 'number');
      assert.ok(typeof analysis.autonomous === 'boolean');

      // Check nested structures
      assert.ok('interventionCount' in analysis.steering);
      assert.ok('codebaseArea' in analysis.characteristics);
      assert.ok('hasCommit' in analysis.outcome);
    });

    it('marks session as autonomous with 0-1 interventions', () => {
      const autonomousSession = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          createEvent('assistant_message', '2024-01-01T10:01:00Z')
        ]
      });

      const steeredSession = createSession({
        events: [
          createEvent('user_message', '2024-01-01T10:00:00Z'),
          createEvent('assistant_message', '2024-01-01T10:01:00Z'),
          createEvent('user_message', '2024-01-01T10:02:00Z'),
          createEvent('user_message', '2024-01-01T10:03:00Z')
        ]
      });

      assert.strictEqual(analyzeSessionTrust(autonomousSession).autonomous, true);
      assert.strictEqual(analyzeSessionTrust(steeredSession).autonomous, false);
    });

    it('includes ticket metadata in characteristics', () => {
      const session = createSession({
        events: [createEvent('user_message', '2024-01-01T10:00:00Z')]
      });

      const analysis = analyzeSessionTrust(session, 'bug', ['critical', 'backend']);

      assert.strictEqual(analysis.characteristics.ticketType, 'bug');
      assert.deepStrictEqual(analysis.characteristics.ticketLabels, ['critical', 'backend']);
    });
  });
});
