import type { Session, Event, Annotation, LogEntry } from '../../src/types/index.js';

/**
 * Create a test session with sensible defaults.
 * Override any property by passing it in the overrides object.
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
