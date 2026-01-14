/**
 * Streaming JSONL parser that processes files line-by-line.
 * Uses chunked file reading for memory efficiency while parsing
 * each line to extract complete event data with content truncation.
 */
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ParsedSession, Event } from '../types/index.js';
import type { LogEntry } from '../types/index.js';
import { classifyEntry, calculateEntryTokens } from './events.js';

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

  return {
    id: metadata.id,
    parentSessionId: metadata.parentSessionId,
    startTime: metadata.firstTimestamp ?? '',
    endTime: metadata.lastTimestamp ?? '',
    folder: metadata.folder,
    branch: metadata.branch,
    totalTokens: metadata.totalTokens,
    entries: [],
    events: metadata.events
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
    // Create a truncated version of the entry to limit memory
    const truncatedEntry = {
      ...entry,
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
