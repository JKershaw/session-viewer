/**
 * Outcome Extractor
 *
 * Extracts rich ticket references and session outcomes from session events.
 * Sources include: Linear MCP tools, git commits, branch names, message mentions.
 */

import type {
  Event,
  Session,
  TicketReference,
  TicketRelationship,
  TicketSourceType,
  SessionOutcomes,
  EventTag
} from '../types/index.js';
import { extractBashCommand, extractContent } from './events.js';

// Ticket ID pattern: 2-10 uppercase letters followed by hyphen and digits
const TICKET_ID_PATTERN = /\b([A-Z]{2,10}-\d+)\b/gi;

// Linear MCP tool patterns - both mcp__linear__ and mcp__linear-server__ prefixes
const LINEAR_MCP_PATTERNS = {
  create: /^mcp__linear(?:-server)?__create_issue$/,
  update: /^mcp__linear(?:-server)?__update_issue$/,
  comment: /^mcp__linear(?:-server)?__create_comment$/,
  read: /^mcp__linear(?:-server)?__get_issue$/
};

/**
 * Extract all ticket IDs from text.
 * Returns uppercase normalized IDs, deduplicated.
 */
export const extractTicketIds = (text: string): string[] => {
  if (!text) return [];

  const matches = text.matchAll(TICKET_ID_PATTERN);
  const ids = new Set<string>();

  for (const match of matches) {
    ids.add(match[1].toUpperCase());
  }

  return Array.from(ids);
};

/**
 * Check if a tool name is a Linear MCP tool.
 */
export const isLinearMcpTool = (toolName: string | null | undefined): boolean => {
  if (!toolName) return false;
  return Object.values(LINEAR_MCP_PATTERNS).some(pattern => pattern.test(toolName));
};

/**
 * Get the Linear MCP tool type from a tool name.
 */
export const getLinearMcpToolType = (
  toolName: string | null | undefined
): 'create' | 'update' | 'comment' | 'read' | null => {
  if (!toolName) return null;

  for (const [type, pattern] of Object.entries(LINEAR_MCP_PATTERNS)) {
    if (pattern.test(toolName)) {
      return type as 'create' | 'update' | 'comment' | 'read';
    }
  }
  return null;
};

/**
 * Extract tool name from event raw data.
 */
const extractToolName = (raw: Record<string, unknown>): string | null => {
  // Direct tool_name/name fields
  if (raw.tool_name && typeof raw.tool_name === 'string') {
    return raw.tool_name;
  }
  if (raw.name && typeof raw.name === 'string') {
    return raw.name;
  }

  // Check message.content array for tool_use items
  const message = raw.message as { content?: unknown } | undefined;
  if (message?.content && Array.isArray(message.content)) {
    for (const item of message.content) {
      if (typeof item === 'object' && item !== null) {
        const contentItem = item as Record<string, unknown>;
        if (contentItem.type === 'tool_use' && contentItem.name && typeof contentItem.name === 'string') {
          return contentItem.name;
        }
      }
    }
  }

  return null;
};

/**
 * Extract tool input from event raw data.
 */
const extractToolInput = (raw: Record<string, unknown>): Record<string, unknown> | null => {
  // Direct input field
  if (raw.input && typeof raw.input === 'object') {
    return raw.input as Record<string, unknown>;
  }

  // Check message.content array for tool_use items
  const message = raw.message as { content?: unknown } | undefined;
  if (message?.content && Array.isArray(message.content)) {
    for (const item of message.content) {
      if (typeof item === 'object' && item !== null) {
        const contentItem = item as Record<string, unknown>;
        if (contentItem.type === 'tool_use' && contentItem.input && typeof contentItem.input === 'object') {
          return contentItem.input as Record<string, unknown>;
        }
      }
    }
  }

  return null;
};

/**
 * Extract ticket information from a Linear MCP tool call.
 */
export interface LinearToolExtraction {
  ticketId: string;
  action: 'create' | 'update' | 'comment' | 'read';
  isCompletion: boolean;
  newState?: string;
  title?: string;
  changes?: Record<string, string>;
}

export const extractTicketFromLinearTool = (event: Event): LinearToolExtraction | null => {
  const raw = event.raw as Record<string, unknown>;
  const toolName = extractToolName(raw);
  const toolType = getLinearMcpToolType(toolName);

  if (!toolType) return null;

  const input = extractToolInput(raw);
  if (!input) return null;

  // Extract ticket ID from input - common fields: id, issueId, identifier
  let ticketId: string | null = null;
  for (const field of ['id', 'issueId', 'identifier']) {
    if (input[field] && typeof input[field] === 'string') {
      // Could be UUID or ticket identifier - extract ticket ID if present
      const value = input[field] as string;
      const ticketIds = extractTicketIds(value);
      if (ticketIds.length > 0) {
        ticketId = ticketIds[0];
        break;
      }
      // If no ticket pattern, might be the identifier directly
      if (/^[A-Z]{2,10}-\d+$/i.test(value)) {
        ticketId = value.toUpperCase();
        break;
      }
    }
  }

  if (!ticketId) return null;

  // Check for state changes (completion)
  const state = input.state ?? input.stateId ?? input.status;
  const isCompletion = typeof state === 'string' &&
    /^(done|completed|closed|finished|resolved)$/i.test(state);

  // Extract title for create operations
  const title = typeof input.title === 'string' ? input.title : undefined;

  // Build changes object for updates
  const changes: Record<string, string> = {};
  if (toolType === 'update') {
    for (const [key, value] of Object.entries(input)) {
      if (key !== 'id' && key !== 'issueId' && typeof value === 'string') {
        changes[key] = value;
      }
    }
  }

  return {
    ticketId,
    action: toolType,
    isCompletion,
    newState: typeof state === 'string' ? state : undefined,
    title,
    changes: Object.keys(changes).length > 0 ? changes : undefined
  };
};

/**
 * Git commit pattern to extract message.
 */
const GIT_COMMIT_PATTERN = /git\s+commit\s+.*-m\s+["'](.+?)["']/i;
const GIT_COMMIT_HEREDOC_PATTERN = /git\s+commit\s+.*-m\s+"\$\(cat\s+<<['"]?EOF['"]?\n([\s\S]*?)\nEOF\s*\)"/i;

/**
 * Extract commit outcome from a git_op event.
 */
export interface CommitOutcome {
  message: string;
  ticketIds: string[];
}

export const extractCommitOutcome = (event: Event): CommitOutcome | null => {
  if (event.type !== 'git_op') return null;

  const command = extractBashCommand(event.raw) ?? extractContent(event.raw);
  if (!command) return null;

  // Check for commit command
  if (!command.includes('git commit')) return null;

  // Try heredoc format first
  let match = command.match(GIT_COMMIT_HEREDOC_PATTERN);
  if (match) {
    const message = match[1].trim();
    return {
      message,
      ticketIds: extractTicketIds(message)
    };
  }

  // Try simple -m format
  match = command.match(GIT_COMMIT_PATTERN);
  if (match) {
    const message = match[1].trim();
    return {
      message,
      ticketIds: extractTicketIds(message)
    };
  }

  return null;
};

/**
 * Git push pattern to extract branch and remote.
 */
const GIT_PUSH_PATTERN = /git\s+push\s+(?:-[a-z]+\s+)*([^\s]+)\s+([^\s]+)/i;

/**
 * Extract push outcome from a git_op event.
 */
export interface PushOutcome {
  branch: string;
  remote: string;
}

export const extractPushOutcome = (event: Event): PushOutcome | null => {
  if (event.type !== 'git_op') return null;

  const command = extractBashCommand(event.raw) ?? extractContent(event.raw);
  if (!command) return null;

  // Check for push command
  if (!command.includes('git push')) return null;

  const match = command.match(GIT_PUSH_PATTERN);
  if (match) {
    return {
      remote: match[1],
      branch: match[2]
    };
  }

  // Handle simple "git push" with defaults
  if (/git\s+push\s*$/.test(command)) {
    return {
      remote: 'origin',
      branch: 'current'
    };
  }

  return null;
};

/**
 * Extract ticket mentions from user/assistant messages.
 */
export interface TicketMention {
  ticketId: string;
  context: string;
}

export const extractTicketsFromMessage = (event: Event): TicketMention[] => {
  if (event.type !== 'user_message' && event.type !== 'assistant_message') {
    return [];
  }

  const raw = event.raw as Record<string, unknown>;
  const content = extractContent(event.raw);

  // Use pre-extracted ticket IDs if available (extracted before content truncation)
  // This ensures we find tickets in long messages that were truncated
  const preExtractedIds = raw._extractedTicketIds as string[] | undefined;
  const ticketIds = preExtractedIds && preExtractedIds.length > 0
    ? preExtractedIds
    : extractTicketIds(content ?? '');

  if (ticketIds.length === 0) return [];

  return ticketIds.map(ticketId => {
    // Extract context around the ticket mention (up to 50 chars on each side)
    // Use truncated content for context (it's just for display)
    if (content) {
      const pattern = new RegExp(`(.{0,50})\\b${ticketId}\\b(.{0,50})`, 'i');
      const match = content.match(pattern);
      if (match) {
        return { ticketId, context: `${match[1]}${ticketId}${match[2]}`.trim() };
      }
    }
    // If no context found (ticket was in truncated portion), use ticket ID as context
    return { ticketId, context: ticketId };
  });
};

/**
 * Map source type to relationship.
 * "worked" = actively modified/created
 * "referenced" = read or mentioned
 */
const SOURCE_TO_RELATIONSHIP: Record<TicketSourceType, TicketRelationship> = {
  branch: 'worked',
  commit: 'worked',
  mcp_create: 'worked',
  mcp_update: 'worked',
  mcp_complete: 'worked',
  mcp_comment: 'worked',
  mcp_read: 'referenced',
  mention: 'referenced'
};

/**
 * Source type priority for determining primary relationship.
 * Higher = stronger signal of "worked".
 */
const SOURCE_PRIORITY: Record<TicketSourceType, number> = {
  mcp_complete: 100,
  mcp_create: 90,
  mcp_update: 80,
  commit: 70,
  mcp_comment: 60,
  branch: 50,
  mcp_read: 20,
  mention: 10
};

/**
 * Extract all session outcomes from events.
 */
export const extractSessionOutcomes = (events: Event[]): SessionOutcomes => {
  const outcomes: SessionOutcomes = {
    commits: [],
    pushes: [],
    ticketStateChanges: []
  };

  events.forEach((event, eventIndex) => {
    // Extract commit outcomes
    const commit = extractCommitOutcome(event);
    if (commit) {
      outcomes.commits.push({
        message: commit.message,
        ticketIds: commit.ticketIds,
        timestamp: event.timestamp,
        eventIndex
      });
    }

    // Extract push outcomes
    const push = extractPushOutcome(event);
    if (push) {
      outcomes.pushes.push({
        branch: push.branch,
        remote: push.remote,
        timestamp: event.timestamp,
        eventIndex
      });
    }

    // Extract ticket state changes from Linear MCP tools
    const linearTool = extractTicketFromLinearTool(event);
    if (linearTool?.isCompletion && linearTool.newState) {
      outcomes.ticketStateChanges.push({
        ticketId: linearTool.ticketId,
        newState: linearTool.newState,
        timestamp: event.timestamp,
        eventIndex
      });
    }
  });

  return outcomes;
};

/**
 * Build ticket references from session data and outcomes.
 */
export const buildTicketReferences = (
  branch: string | null,
  events: Event[],
  outcomes: SessionOutcomes
): TicketReference[] => {
  // Map of ticketId -> sources
  const ticketSources = new Map<string, TicketReference['sources']>();

  const addSource = (
    ticketId: string,
    source: TicketReference['sources'][0]
  ) => {
    if (!ticketSources.has(ticketId)) {
      ticketSources.set(ticketId, []);
    }
    ticketSources.get(ticketId)!.push(source);
  };

  // Extract from branch name
  if (branch) {
    const branchTickets = extractTicketIds(branch);
    for (const ticketId of branchTickets) {
      addSource(ticketId, {
        type: 'branch',
        timestamp: events[0]?.timestamp ?? ''
      });
    }
  }

  // Extract from commits
  for (const commit of outcomes.commits) {
    for (const ticketId of commit.ticketIds) {
      addSource(ticketId, {
        type: 'commit',
        eventIndex: commit.eventIndex,
        timestamp: commit.timestamp,
        context: commit.message
      });
    }
  }

  // Extract from Linear MCP tool calls
  events.forEach((event, eventIndex) => {
    const linearTool = extractTicketFromLinearTool(event);
    if (linearTool) {
      let sourceType: TicketSourceType;
      if (linearTool.isCompletion) {
        sourceType = 'mcp_complete';
      } else {
        switch (linearTool.action) {
          case 'create':
            sourceType = 'mcp_create';
            break;
          case 'update':
            sourceType = 'mcp_update';
            break;
          case 'comment':
            sourceType = 'mcp_comment';
            break;
          case 'read':
            sourceType = 'mcp_read';
            break;
        }
      }

      addSource(linearTool.ticketId, {
        type: sourceType,
        eventIndex,
        timestamp: event.timestamp,
        context: linearTool.title
      });
    }

    // Extract from message mentions
    const mentions = extractTicketsFromMessage(event);
    for (const mention of mentions) {
      addSource(mention.ticketId, {
        type: 'mention',
        eventIndex,
        timestamp: event.timestamp,
        context: mention.context
      });
    }
  });

  // Build ticket references with relationship determined by highest priority source
  const ticketRefs: TicketReference[] = [];

  for (const [ticketId, sources] of ticketSources) {
    // Determine relationship from highest priority source
    let maxPriority = 0;
    let relationship: TicketRelationship = 'referenced';

    for (const source of sources) {
      const priority = SOURCE_PRIORITY[source.type];
      if (priority > maxPriority) {
        maxPriority = priority;
        relationship = SOURCE_TO_RELATIONSHIP[source.type];
      }
    }

    ticketRefs.push({
      ticketId,
      relationship,
      sources: sources.sort((a, b) => (b.eventIndex ?? -1) - (a.eventIndex ?? -1))
    });
  }

  // Sort by relationship (worked first) then by source priority
  ticketRefs.sort((a, b) => {
    if (a.relationship !== b.relationship) {
      return a.relationship === 'worked' ? -1 : 1;
    }
    const aPriority = Math.max(...a.sources.map(s => SOURCE_PRIORITY[s.type]));
    const bPriority = Math.max(...b.sources.map(s => SOURCE_PRIORITY[s.type]));
    return bPriority - aPriority;
  });

  return ticketRefs;
};

/**
 * Get the primary ticket ID (first "worked" ticket).
 */
export const getPrimaryTicketId = (ticketRefs: TicketReference[]): string | null => {
  const workedTicket = ticketRefs.find(t => t.relationship === 'worked');
  return workedTicket?.ticketId ?? null;
};

/**
 * Extract event tags for a single event.
 */
export const extractEventTags = (event: Event, eventIndex: number): EventTag[] => {
  const tags: EventTag[] = [];

  // Commit tags
  const commit = extractCommitOutcome(event);
  if (commit) {
    tags.push({
      type: 'commit',
      message: commit.message,
      ticketIds: commit.ticketIds
    });
  }

  // Push tags
  const push = extractPushOutcome(event);
  if (push) {
    tags.push({
      type: 'push',
      branch: push.branch,
      remote: push.remote
    });
  }

  // Linear MCP tags
  const linearTool = extractTicketFromLinearTool(event);
  if (linearTool) {
    if (linearTool.action === 'create') {
      tags.push({
        type: 'ticket_created',
        ticketId: linearTool.ticketId,
        title: linearTool.title
      });
    } else if (linearTool.action === 'read') {
      tags.push({
        type: 'ticket_read',
        ticketId: linearTool.ticketId
      });
    } else if (linearTool.isCompletion) {
      tags.push({
        type: 'ticket_completed',
        ticketId: linearTool.ticketId
      });
    } else if (linearTool.action === 'update' && linearTool.changes) {
      tags.push({
        type: 'ticket_updated',
        ticketId: linearTool.ticketId,
        changes: linearTool.changes
      });
    }
  }

  // Mention tags
  const mentions = extractTicketsFromMessage(event);
  for (const mention of mentions) {
    tags.push({
      type: 'ticket_mentioned',
      ticketId: mention.ticketId,
      context: mention.context
    });
  }

  return tags;
};

/**
 * Process a session to extract all outcomes and ticket references.
 */
export const processSessionOutcomes = (session: Session): {
  outcomes: SessionOutcomes;
  ticketReferences: TicketReference[];
  primaryTicketId: string | null;
} => {
  const outcomes = extractSessionOutcomes(session.events);
  const ticketReferences = buildTicketReferences(session.branch, session.events, outcomes);
  const primaryTicketId = getPrimaryTicketId(ticketReferences);

  return {
    outcomes,
    ticketReferences,
    primaryTicketId
  };
};
