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
}

export interface LinearTicket {
  ticketId: string;
  title: string;
  type: string;
  labels: string[];
  status: string;
  project: string;
  sessionIds: string[];
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
  startTime: string;
  endTime: string;
  folder: string;
  branch: string | null;
  entries: LogEntry[];
  totalTokens: number;
}
