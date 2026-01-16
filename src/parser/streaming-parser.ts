/**
 * Streaming JSONL parser that processes files line-by-line.
 * Uses chunked file reading for memory efficiency while parsing
 * each line to extract complete event data with content truncation.
 */
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ParsedSession, Event, TicketReference, SessionOutcomes } from '../types/index.js';
import type { LogEntry } from '../types/index.js';
import { classifyEntry, calculateEntryTokens } from './events.js';
import { extractEventTags, extractSessionOutcomes, buildTicketReferences, getPrimaryTicketId, extractTicketIds } from './outcome-extractor.js';

// Use a smaller buffer to reduce memory pressure
const BUFFER_SIZE = 64 * 1024; // 64KB chunks

interface StreamingMetadata {
  id: string;
  parentSessionId: string | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  folder: string;
  branch: string | null;
  totalTokens: number;
  entryCount: number;
  events: Event[];
}

// Maximum content length to store per event (for memory efficiency)
const MAX_CONTENT_LENGTH = 500;

/**
 * Truncate content to limit memory usage while preserving structure.
 */
const truncateContent = (content: unknown): unknown => {
  if (typeof content === 'string') {
    return content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH) + '...'
      : content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'object' && item !== null && 'text' in item) {
        const textItem = item as { text: string };
        return { ...item, text: truncateContent(textItem.text) };
      }
      return item;
    });
  }
  return content;
};

/**
 * Parse a single JSONL file using chunked reading and regex extraction.
 * No file size limits - processes everything with minimal memory.
 */
export const parseSessionStreaming = async (
  filePath: string
): Promise<ParsedSession | null> => {
  const metadata: StreamingMetadata = {
    id: basename(filePath, '.jsonl'),
    parentSessionId: null,
    firstTimestamp: null,
    lastTimestamp: null,
    folder: '',
    branch: null,
    totalTokens: 0,
    entryCount: 0,
    events: []
  };

  const file = await open(filePath, 'r');
  const buffer = Buffer.alloc(BUFFER_SIZE);
  let remainder = '';

  try {
    let bytesRead: number;

    while ((bytesRead = (await file.read(buffer, 0, BUFFER_SIZE)).bytesRead) > 0) {
      const chunk = buffer.toString('utf-8', 0, bytesRead);
      const data = remainder + chunk;
      const lines = data.split('\n');

      // Keep last incomplete line for next iteration
      remainder = lines.pop() ?? '';

      // Process complete lines
      for (const line of lines) {
        if (line.trim()) {
          processLine(line, metadata);
        }
      }
    }

    // Process final remainder
    if (remainder.trim()) {
      processLine(remainder, metadata);
    }
  } finally {
    await file.close();
  }

  if (metadata.entryCount === 0) {
    return null;
  }

  // Extract event tags for each event
  metadata.events.forEach((event, index) => {
    const tags = extractEventTags(event, index);
    if (tags.length > 0) {
      event.tags = tags;
    }
  });

  // Extract session outcomes and ticket references
  const outcomes = extractSessionOutcomes(metadata.events);
  const ticketReferences = buildTicketReferences(metadata.branch, metadata.events, outcomes);
  const primaryTicketId = getPrimaryTicketId(ticketReferences);

  return {
    id: metadata.id,
    parentSessionId: metadata.parentSessionId,
    startTime: metadata.firstTimestamp ?? '',
    endTime: metadata.lastTimestamp ?? '',
    folder: metadata.folder,
    branch: metadata.branch,
    totalTokens: metadata.totalTokens,
    entries: [],
    events: metadata.events,
    // New fields for rich ticket tracking
    outcomes,
    ticketReferences,
    linearTicketId: primaryTicketId
  };
};

/**
 * Process a single line by parsing JSON and extracting event data.
 */
const processLine = (line: string, metadata: StreamingMetadata): void => {
  metadata.entryCount++;

  let entry: LogEntry;
  try {
    entry = JSON.parse(line) as LogEntry;
  } catch {
    return; // Skip malformed lines
  }

  // Extract timestamps
  if (entry.timestamp) {
    if (!metadata.firstTimestamp || entry.timestamp < metadata.firstTimestamp) {
      metadata.firstTimestamp = entry.timestamp;
    }
    if (!metadata.lastTimestamp || entry.timestamp > metadata.lastTimestamp) {
      metadata.lastTimestamp = entry.timestamp;
    }
  }

  // Extract session ID (for parent tracking)
  if (!metadata.parentSessionId && entry.sessionId && entry.sessionId !== metadata.id) {
    metadata.parentSessionId = entry.sessionId;
  }

  // Extract folder
  if (!metadata.folder && entry.cwd) {
    metadata.folder = entry.cwd;
  }

  // Extract branch
  if (!metadata.branch && entry.gitBranch) {
    metadata.branch = entry.gitBranch;
  }

  // Calculate tokens for this entry
  const tokens = calculateEntryTokens(entry);
  metadata.totalTokens += tokens;

  // Classify and create event
  const type = classifyEntry(entry);
  if (type) {
    // Extract ticket IDs from full content BEFORE truncation
    // This ensures we don't miss ticket mentions in long messages
    let preExtractedTicketIds: string[] | undefined;
    const fullContent = extractFullContent(entry);
    if (fullContent) {
      const ticketIds = extractTicketIds(fullContent);
      if (ticketIds.length > 0) {
        preExtractedTicketIds = ticketIds;
      }
    }

    // Create a truncated version of the entry to limit memory
    // Explicitly preserve fields needed for analysis (input, tool_name, name, error)
    const truncatedEntry = {
      ...entry,
      // Preserve tool-related fields (required for trust analysis and git detection)
      input: entry.input,
      tool_name: entry.tool_name,
      name: entry.name,
      error: entry.error,
      // Store pre-extracted ticket IDs (extracted before truncation)
      _extractedTicketIds: preExtractedTicketIds,
      // Truncate large content fields
      message: entry.message
        ? {
            ...entry.message,
            content: truncateContent(entry.message.content)
          }
        : undefined,
      content: truncateContent(entry.content)
    } as LogEntry;

    metadata.events.push({
      type,
      timestamp: entry.timestamp ?? '',
      tokenCount: tokens,
      raw: truncatedEntry
    });
  }
};

/**
 * Extract full text content from an entry before truncation.
 */
const extractFullContent = (entry: LogEntry): string | null => {
  // Check direct content field
  if (typeof entry.content === 'string') {
    return entry.content;
  }

  // Check message.content
  const msgContent = entry.message?.content;
  if (typeof msgContent === 'string') {
    return msgContent;
  }

  // Handle array content (text blocks)
  if (Array.isArray(msgContent)) {
    const texts = msgContent
      .filter((item) => typeof item === 'object' && item !== null && 'text' in item)
      .map((item) => (item as { text: string }).text);
    if (texts.length > 0) {
      return texts.join('\n');
    }
  }

  return null;
};
