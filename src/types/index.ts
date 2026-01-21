export type EventType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'git_op'
  | 'error'
  | 'planning_mode';

export type AnnotationType = 'decision' | 'blocker' | 'rework' | 'goal_shift';

// Event tags for significant events
export type EventTag =
  | { type: 'commit'; message: string; ticketIds: string[] }
  | { type: 'push'; branch: string; remote: string }
  | { type: 'ticket_created'; ticketId: string; title?: string }
  | { type: 'ticket_updated'; ticketId: string; changes: Record<string, string> }
  | { type: 'ticket_completed'; ticketId: string }
  | { type: 'ticket_read'; ticketId: string }
  | { type: 'ticket_mentioned'; ticketId: string; context: string };

// Ticket relationship type
export type TicketRelationship = 'worked' | 'referenced';

// Source type for ticket references
export type TicketSourceType =
  | 'branch'
  | 'commit'
  | 'mcp_create'
  | 'mcp_update'
  | 'mcp_complete'
  | 'mcp_comment'
  | 'mcp_read'
  | 'mention';

// Rich ticket reference
export interface TicketReference {
  ticketId: string;
  relationship: TicketRelationship;
  sources: Array<{
    type: TicketSourceType;
    eventIndex?: number;
    timestamp: string;
    context?: string;
  }>;
}

// Session outcomes
export interface SessionOutcomes {
  commits: Array<{
    message: string;
    ticketIds: string[];
    timestamp: string;
    eventIndex: number;
  }>;
  pushes: Array<{
    branch: string;
    remote: string;
    timestamp: string;
    eventIndex: number;
  }>;
  ticketStateChanges: Array<{
    ticketId: string;
    newState: string;
    timestamp: string;
    eventIndex: number;
  }>;
}

export interface Event {
  type: EventType;
  timestamp: string;
  tokenCount: number;
  raw: LogEntry;
  sourceSessionId?: string; // Set when events are merged from multiple sessions
  tags?: EventTag[];        // Structured tags for significant events
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
  linearTicketId: string | null;        // Keep as primary ticket (first worked)
  ticketReferences?: TicketReference[]; // All ticket references
  outcomes?: SessionOutcomes;           // Session outcomes (commits, pushes, state changes)
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
  // Rich ticket tracking (populated by streaming parser)
  linearTicketId?: string | null;
  ticketReferences?: TicketReference[];
  outcomes?: SessionOutcomes;
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

// Dispatch types - matches LinearViewer API format
// See: https://github.com/JKershaw/LinearViewer/blob/main/docs/dispatch-integration.md
export interface DispatchQueueItem {
  id: string;
  prompt: string;
  promptName: string;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  issueUrl: string | null;
  workspace: { urlKey: string };
  dispatchedAt: string;
  dispatchedBy: string | null;
  expiresAt: string;
}

export interface ClaimedPrompt {
  id: string;
  prompt: string;
  promptName: string;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  issueUrl: string | null;
  workspaceUrlKey: string;
  claimedAt: string;
  [key: string]: unknown;
}

// Re-export trust types
export * from './trust.js';
