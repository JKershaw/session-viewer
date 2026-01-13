import type { Event, EventType, LogEntry } from '../types/index.js';

/**
 * Git command patterns to detect in bash tool calls
 */
const GIT_COMMAND_PATTERNS = [
  /\bgit\s+(push|pull|commit|checkout|merge|rebase|clone|fetch|add|reset|stash)/i,
  /\bgit\s+[a-z-]+/i
];

/**
 * Determines the event type from a log entry
 */
export const classifyEntry = (entry: LogEntry): EventType | null => {
  const entryType = entry.type;
  const role = entry.message?.role;

  // Check for errors first
  if (entryType === 'error' || entry.error) {
    return 'error';
  }

  // Check for tool calls
  if (entryType === 'tool_use' || entryType === 'tool_result') {
    // Check if it's a git operation
    if (isGitOperation(entry)) {
      return 'git_op';
    }
    return 'tool_call';
  }

  // Check for messages by role
  if (role === 'user') {
    return 'user_message';
  }

  if (role === 'assistant') {
    // Check for planning mode indicators
    if (isPlanningMode(entry)) {
      return 'planning_mode';
    }
    return 'assistant_message';
  }

  // Check type field for message types
  if (entryType === 'user' || entryType === 'human') {
    return 'user_message';
  }

  if (entryType === 'assistant') {
    if (isPlanningMode(entry)) {
      return 'planning_mode';
    }
    return 'assistant_message';
  }

  // Unknown entry type - skip it
  return null;
};

/**
 * Checks if an entry represents a git operation
 */
export const isGitOperation = (entry: LogEntry): boolean => {
  // Check tool name
  const toolName = entry.tool_name ?? entry.name;
  if (toolName === 'Bash' || toolName === 'bash') {
    const command = extractBashCommand(entry);
    if (command) {
      return GIT_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
    }
  }

  // Check content for git commands
  const content = extractContent(entry);
  if (content) {
    return GIT_COMMAND_PATTERNS.some((pattern) => pattern.test(content));
  }

  return false;
};

/**
 * Extracts bash command from a tool call entry
 */
export const extractBashCommand = (entry: LogEntry): string | null => {
  // Check input field for tool_use
  const input = entry.input as Record<string, unknown> | undefined;
  if (input?.command && typeof input.command === 'string') {
    return input.command;
  }

  // Check content for tool_result
  const content = entry.content;
  if (typeof content === 'string') {
    return content;
  }

  // Check message content
  const msgContent = entry.message?.content;
  if (typeof msgContent === 'string') {
    return msgContent;
  }

  return null;
};

/**
 * Extracts text content from an entry
 */
export const extractContent = (entry: LogEntry): string | null => {
  const content = entry.content;
  if (typeof content === 'string') {
    return content;
  }

  const msgContent = entry.message?.content;
  if (typeof msgContent === 'string') {
    return msgContent;
  }

  if (Array.isArray(msgContent)) {
    return msgContent
      .filter((item) => typeof item === 'object' && item !== null && 'text' in item)
      .map((item) => (item as { text: string }).text)
      .join('\n');
  }

  return null;
};

/**
 * Checks if an entry represents planning mode
 */
export const isPlanningMode = (entry: LogEntry): boolean => {
  const content = extractContent(entry);
  if (!content) return false;

  // Look for planning indicators
  const planningIndicators = [
    /\bplan(ning)?\b.*:/i,
    /\bstep\s+\d+:/i,
    /\b(first|then|next|finally)\b.*\bI('ll| will)\b/i,
    /let me (think|plan|outline)/i
  ];

  return planningIndicators.some((pattern) => pattern.test(content));
};

/**
 * Calculates token count for a single entry
 */
export const calculateEntryTokens = (entry: LogEntry): number => {
  const usage = entry.message?.usage;
  if (!usage) return 0;

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;

  return inputTokens + outputTokens + cacheRead + cacheCreation;
};

/**
 * Converts a log entry to a typed Event
 */
export const entryToEvent = (entry: LogEntry): Event | null => {
  const type = classifyEntry(entry);
  if (!type) return null;

  return {
    type,
    timestamp: entry.timestamp ?? '',
    tokenCount: calculateEntryTokens(entry),
    raw: entry
  };
};

/**
 * Extracts all events from log entries
 */
export const extractEvents = (entries: LogEntry[]): Event[] => {
  return entries.map(entryToEvent).filter((event): event is Event => event !== null);
};

/**
 * Extracts git operation details from an event
 */
export const extractGitDetails = (
  event: Event
): { command: string; operation: string } | null => {
  if (event.type !== 'git_op') return null;

  const command = extractBashCommand(event.raw) ?? extractContent(event.raw);
  if (!command) return null;

  // Extract the git operation type
  const match = command.match(/\bgit\s+([a-z-]+)/i);
  const operation = match ? match[1] : 'unknown';

  return { command, operation };
};
