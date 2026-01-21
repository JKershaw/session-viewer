/**
 * Test Fixtures for SessionViewer
 *
 * Factory functions for creating test data with sensible defaults.
 * Override any property by passing it in the overrides object.
 */

import type {
  Session,
  Event,
  Annotation,
  LogEntry,
  TicketReference,
  SessionOutcomes,
  EventTag,
} from '../../src/types/index.js';

import type {
  SteeringMetrics,
  TaskCharacteristics,
  OutcomeMetrics,
  SessionTrustAnalysis,
  TrustAggregate,
} from '../../src/types/trust.js';

// ============================================================================
// Core Entity Factories
// ============================================================================

/**
 * Create a test session with sensible defaults.
 */
export const createTestSession = (overrides: Partial<Session> = {}): Session => ({
  id: `test-session-${Date.now()}`,
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

/**
 * Create a test event with sensible defaults.
 */
export const createTestEvent = (overrides: Partial<Event> = {}): Event => ({
  type: 'user_message',
  timestamp: '2026-01-01T10:00:00Z',
  tokenCount: 100,
  raw: { type: 'message', timestamp: '2026-01-01T10:00:00Z' },
  ...overrides
});

/**
 * Create a test annotation with sensible defaults.
 */
export const createTestAnnotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  type: 'blocker',
  summary: 'Test annotation',
  confidence: 0.8,
  ...overrides
});

/**
 * Create a test log entry with sensible defaults.
 */
export const createTestLogEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  type: 'message',
  timestamp: '2026-01-01T10:00:00Z',
  sessionId: 'test-session-1',
  ...overrides
});

// ============================================================================
// Batch Factories
// ============================================================================

/**
 * Create multiple test sessions with sequential IDs and timestamps.
 */
export const createTestSessions = (count: number, baseOverrides: Partial<Session> = {}): Session[] => {
  return Array.from({ length: count }, (_, i) => {
    const startDate = new Date('2026-01-01T10:00:00Z');
    startDate.setHours(startDate.getHours() + i);
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);

    return createTestSession({
      id: `session-${i + 1}`,
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
      ...baseOverrides
    });
  });
};

/**
 * Create a session with a variety of event types for testing.
 */
export const createSessionWithEvents = (sessionOverrides: Partial<Session> = {}): Session => {
  const rawEntry = { type: 'message', timestamp: '2026-01-01T10:00:00Z' };

  return createTestSession({
    events: [
      { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 100, raw: rawEntry },
      { type: 'assistant_message', timestamp: '2026-01-01T10:00:10Z', tokenCount: 500, raw: rawEntry },
      { type: 'tool_call', timestamp: '2026-01-01T10:00:20Z', tokenCount: 50, raw: { ...rawEntry, type: 'tool_use', tool_name: 'Read' } },
      { type: 'git_op', timestamp: '2026-01-01T10:00:30Z', tokenCount: 10, raw: { ...rawEntry, type: 'tool_use', tool_name: 'Bash', input: { command: 'git commit -m "test"' } } },
      { type: 'assistant_message', timestamp: '2026-01-01T10:00:40Z', tokenCount: 200, raw: rawEntry }
    ],
    totalTokens: 860,
    ...sessionOverrides
  });
};

// ============================================================================
// Ticket & Outcome Factories
// ============================================================================

/**
 * Create a test ticket reference.
 */
export const createTestTicketReference = (overrides: Partial<TicketReference> = {}): TicketReference => ({
  ticketId: 'LIN-123',
  relationship: 'worked',
  sources: [{
    type: 'branch',
    timestamp: '2026-01-01T10:00:00Z',
    context: 'feature/lin-123-test-feature'
  }],
  ...overrides
});

/**
 * Create test session outcomes.
 */
export const createTestSessionOutcomes = (overrides: Partial<SessionOutcomes> = {}): SessionOutcomes => ({
  commits: [{
    message: 'Add test feature',
    ticketIds: ['LIN-123'],
    timestamp: '2026-01-01T10:30:00Z',
    eventIndex: 5
  }],
  pushes: [{
    branch: 'feature/lin-123-test-feature',
    remote: 'origin',
    timestamp: '2026-01-01T10:31:00Z',
    eventIndex: 6
  }],
  ticketStateChanges: [],
  ...overrides
});

/**
 * Create a test event tag.
 */
export const createTestEventTag = (type: EventTag['type'] = 'commit'): EventTag => {
  switch (type) {
    case 'commit':
      return { type: 'commit', message: 'Test commit', ticketIds: ['LIN-123'] };
    case 'push':
      return { type: 'push', branch: 'main', remote: 'origin' };
    case 'ticket_created':
      return { type: 'ticket_created', ticketId: 'LIN-456', title: 'New ticket' };
    case 'ticket_updated':
      return { type: 'ticket_updated', ticketId: 'LIN-123', changes: { status: 'Done' } };
    case 'ticket_completed':
      return { type: 'ticket_completed', ticketId: 'LIN-123' };
    case 'ticket_read':
      return { type: 'ticket_read', ticketId: 'LIN-123' };
    case 'ticket_mentioned':
      return { type: 'ticket_mentioned', ticketId: 'LIN-123', context: 'Mentioned in comment' };
    default:
      return { type: 'commit', message: 'Test commit', ticketIds: [] };
  }
};

// ============================================================================
// Trust Analysis Factories
// ============================================================================

/**
 * Create test steering metrics.
 */
export const createTestSteeringMetrics = (overrides: Partial<SteeringMetrics> = {}): SteeringMetrics => ({
  interventionCount: 0,
  firstInterventionProgress: null,
  interventionDensity: 0,
  goalShiftCount: 0,
  timeToFirstIntervention: null,
  ...overrides
});

/**
 * Create test task characteristics.
 */
export const createTestTaskCharacteristics = (overrides: Partial<TaskCharacteristics> = {}): TaskCharacteristics => ({
  codebaseArea: 'src/components',
  projectPath: '/home/user/project',
  branchType: 'feature',
  ticketType: 'feature',
  ticketLabels: [],
  initialPromptTokens: 500,
  subtaskCount: 0,
  toolDiversity: 3,
  filePatterns: ['*.ts', '*.tsx'],
  ...overrides
});

/**
 * Create test outcome metrics.
 */
export const createTestOutcomeMetrics = (overrides: Partial<OutcomeMetrics> = {}): OutcomeMetrics => ({
  hasCommit: true,
  commitCount: 1,
  hasPush: true,
  blockerCount: 0,
  reworkCount: 0,
  decisionCount: 1,
  errorCount: 0,
  errorDensity: 0,
  durationMs: 3600000,
  totalTokens: 5000,
  endedWithError: false,
  ...overrides
});

/**
 * Create a complete test trust analysis.
 */
export const createTestTrustAnalysis = (overrides: Partial<SessionTrustAnalysis> = {}): SessionTrustAnalysis => ({
  sessionId: `test-session-${Date.now()}`,
  analyzedAt: new Date().toISOString(),
  steering: createTestSteeringMetrics(),
  characteristics: createTestTaskCharacteristics(),
  outcome: createTestOutcomeMetrics(),
  trustScore: 0.85,
  autonomous: true,
  ...overrides
});

/**
 * Create a test trust aggregate.
 */
export const createTestTrustAggregate = (overrides: Partial<TrustAggregate> = {}): TrustAggregate => ({
  category: 'src/components',
  categoryType: 'area',
  totalSessions: 10,
  autonomousSessions: 8,
  autonomousRate: 0.8,
  avgTrustScore: 0.75,
  avgInterventionCount: 0.5,
  avgInterventionDensity: 0.2,
  commitRate: 0.9,
  reworkRate: 0.1,
  errorRate: 0.05,
  avgFirstInterventionProgress: 0.6,
  confidence: 0.7,
  updatedAt: new Date().toISOString(),
  ...overrides
});

// ============================================================================
// Scenario Factories
// ============================================================================

/**
 * Create a session representing an autonomous completion (high trust).
 */
export const createAutonomousSession = (overrides: Partial<Session> = {}): Session => {
  const rawEntry = { type: 'message', timestamp: '2026-01-01T10:00:00Z' };

  return createTestSession({
    id: `autonomous-session-${Date.now()}`,
    branch: 'feature/simple-task',
    events: [
      { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 200, raw: rawEntry },
      { type: 'assistant_message', timestamp: '2026-01-01T10:01:00Z', tokenCount: 1000, raw: rawEntry },
      { type: 'tool_call', timestamp: '2026-01-01T10:02:00Z', tokenCount: 50, raw: { ...rawEntry, type: 'tool_use', tool_name: 'Read' } },
      { type: 'tool_call', timestamp: '2026-01-01T10:03:00Z', tokenCount: 50, raw: { ...rawEntry, type: 'tool_use', tool_name: 'Edit' } },
      { type: 'git_op', timestamp: '2026-01-01T10:04:00Z', tokenCount: 20, raw: { ...rawEntry, type: 'tool_use', tool_name: 'Bash', input: { command: 'git commit -m "feat: complete task"' } } },
      { type: 'assistant_message', timestamp: '2026-01-01T10:05:00Z', tokenCount: 100, raw: rawEntry },
    ],
    totalTokens: 1420,
    outcomes: createTestSessionOutcomes(),
    ...overrides
  });
};

/**
 * Create a session representing heavy steering (low trust).
 */
export const createSteeredSession = (overrides: Partial<Session> = {}): Session => {
  const rawEntry = { type: 'message', timestamp: '2026-01-01T10:00:00Z' };

  return createTestSession({
    id: `steered-session-${Date.now()}`,
    branch: 'fix/complex-bug',
    events: [
      { type: 'user_message', timestamp: '2026-01-01T10:00:00Z', tokenCount: 200, raw: rawEntry },
      { type: 'assistant_message', timestamp: '2026-01-01T10:01:00Z', tokenCount: 500, raw: rawEntry },
      { type: 'user_message', timestamp: '2026-01-01T10:05:00Z', tokenCount: 150, raw: rawEntry }, // Intervention 1
      { type: 'assistant_message', timestamp: '2026-01-01T10:06:00Z', tokenCount: 600, raw: rawEntry },
      { type: 'error', timestamp: '2026-01-01T10:07:00Z', tokenCount: 50, raw: rawEntry },
      { type: 'user_message', timestamp: '2026-01-01T10:10:00Z', tokenCount: 200, raw: rawEntry }, // Intervention 2
      { type: 'assistant_message', timestamp: '2026-01-01T10:11:00Z', tokenCount: 800, raw: rawEntry },
      { type: 'user_message', timestamp: '2026-01-01T10:15:00Z', tokenCount: 100, raw: rawEntry }, // Intervention 3
    ],
    totalTokens: 2600,
    annotations: [
      createTestAnnotation({ type: 'blocker', summary: 'Got stuck on authentication' }),
      createTestAnnotation({ type: 'rework', summary: 'Had to redo the approach' }),
    ],
    ...overrides
  });
};
