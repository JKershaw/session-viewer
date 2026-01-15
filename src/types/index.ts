export type EventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'git_op'
  | 'error'
  | 'planning_mode';

export type AnnotationType = 'decision' | 'blocker' | 'rework' | 'goal_shift';

export interface Event {
  type: EventType;
  timestamp: string;
  tokenCount: number;
  raw: LogEntry;
  sourceSessionId?: string; // Set when events are merged from multiple sessions
}

export interface Annotation {
  eventIndex?: number;
  startTime?: string;
  endTime?: string;
  type: AnnotationType;
  summary: string;
  confidence: number;
}

export interface Session {
  id: string;
  parentSessionId: string | null; // Original session ID from logs (tracks compaction chain)
  startTime: string;
  endTime: string;
  durationMs: number;
  totalTokens: number;
  branch: string | null;
  folder: string;
  linearTicketId: string | null;
  analyzed: boolean;
  events: Event[];
  annotations: Annotation[];
  // Merge metadata (set when sessions are merged by parentSessionId)
  _childSessionIds?: string[]; // IDs of sessions that were merged
  _childCount?: number;        // Number of merged sessions
  [key: string]: unknown;
}

export interface LinearTicket {
  ticketId: string;
  title: string;
  type: string;
  labels: string[];
  status: string;
  project: string;
  sessionIds: string[];
  [key: string]: unknown;
}

export interface LogEntry {
  type: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  [key: string]: unknown;
}

export interface ParsedSession {
  id: string;
  parentSessionId: string | null; // Original session ID from logs (tracks compaction chain)
  startTime: string;
  endTime: string;
  folder: string;
  branch: string | null;
  entries: LogEntry[];
  totalTokens: number;
  events?: Event[]; // Optional - populated by streaming parser
  [key: string]: unknown;
}

// Pagination and filter types
export interface SessionQueryOptions {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
  folder?: string;
  branch?: string;
  linearTicketId?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// Timeline-specific query options for infinite scroll
export interface TimelineQueryOptions {
  before?: string;  // ISO timestamp - get sessions ending before this time
  after?: string;   // ISO timestamp - get sessions starting after this time
  limit?: number;
  folder?: string;
  branch?: string;
  linearTicketId?: string;
}

export interface TimelineResult {
  sessions: Session[];
  hasEarlier: boolean;
  hasLater: boolean;
  earliestTime: string | null;
  latestTime: string | null;
}

// Re-export trust types
export * from './trust.js';
