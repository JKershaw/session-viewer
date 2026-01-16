import type { Event, EventType, LogEntry, EventTag } from '../types/index.js';
import { extractEventTags as extractEventTagsFromOutcome } from './outcome-extractor.js';

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

  // Check if message content contains tool_use or tool_result
  // tool_use: assistant messages with tool calls (name, input)
  // tool_result: user messages with tool responses
  const content = entry.message?.content;
  if (Array.isArray(content)) {
    const hasToolContent = content.some(
      (item) => typeof item === 'object' && item !== null &&
        ((item as Record<string, unknown>).type === 'tool_result' ||
         (item as Record<string, unknown>).type === 'tool_use')
    );
    if (hasToolContent) {
      // Check if it's a git operation
      if (isGitOperation(entry)) {
        return 'git_op';
      }
      return 'tool_call';
    }
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
  // Check tool name at top level
  let toolName = entry.tool_name ?? entry.name;

  // Also check for tool name inside nested tool_use items in message.content
  if (!toolName) {
    const msgContent = entry.message?.content;
    if (Array.isArray(msgContent)) {
      for (const item of msgContent) {
        if (typeof item === 'object' && item !== null) {
          const contentItem = item as Record<string, unknown>;
          if (contentItem.type === 'tool_use' && contentItem.name && typeof contentItem.name === 'string') {
            toolName = contentItem.name;
            break;
          }
        }
      }
    }
  }

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
 * Extracts bash command from a tool call entry.
 * Commands can be at:
 * - entry.input.command (direct tool_use)
 * - entry.message.content[i].input.command (tool_use in assistant message)
 */
export const extractBashCommand = (entry: LogEntry): string | null => {
  // Check direct input field for tool_use
  const input = entry.input as Record<string, unknown> | undefined;
  if (input?.command && typeof input.command === 'string') {
    return input.command;
  }

  // Check message.content array for tool_use items with commands
  const msgContent = entry.message?.content;
  if (Array.isArray(msgContent)) {
    for (const item of msgContent) {
      if (typeof item === 'object' && item !== null) {
        const contentItem = item as Record<string, unknown>;
        if (contentItem.type === 'tool_use') {
          const toolInput = contentItem.input as Record<string, unknown> | undefined;
          if (toolInput?.command && typeof toolInput.command === 'string') {
            return toolInput.command;
          }
        }
      }
    }
  }

  // Check content for tool_result
  const content = entry.content;
  if (typeof content === 'string') {
    return content;
  }

  // Check message content if it's a string
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
 * Converts a log entry to a typed Event.
 * Optionally extracts event tags if extractTags is true.
 */
export const entryToEvent = (entry: LogEntry, options?: { extractTags?: boolean; eventIndex?: number }): Event | null => {
  const type = classifyEntry(entry);
  if (!type) return null;

  const event: Event = {
    type,
    timestamp: entry.timestamp ?? '',
    tokenCount: calculateEntryTokens(entry),
    raw: entry
  };

  // Extract event tags if requested
  if (options?.extractTags) {
    const tags = extractEventTagsFromOutcome(event, options.eventIndex ?? 0);
    if (tags.length > 0) {
      event.tags = tags;
    }
  }

  return event;
};

/**
 * Extract event tags from a log entry.
 * This is a convenience wrapper that creates a temporary event to extract tags.
 */
export const extractEventTags = (entry: LogEntry): EventTag[] => {
  const type = classifyEntry(entry);
  if (!type) return [];

  const tempEvent: Event = {
    type,
    timestamp: entry.timestamp ?? '',
    tokenCount: 0,
    raw: entry
  };

  return extractEventTagsFromOutcome(tempEvent, 0);
};

/**
 * Extracts all events from log entries
 */
export const extractEvents = (entries: LogEntry[]): Event[] => {
  return entries
    .map((entry) => entryToEvent(entry))
    .filter((event): event is Event => event !== null);
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
