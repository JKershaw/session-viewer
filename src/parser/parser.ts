import { basename } from 'node:path';
import type { LogEntry, ParsedSession } from '../types/index.js';

export const parseJsonlContent = (content: string): LogEntry[] => {
  if (!content.trim()) return [];

  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as LogEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is LogEntry => entry !== null);
};

export const extractSessionMetadata = (
  entries: LogEntry[],
  filePath?: string
): {
  id: string;
  parentSessionId: string | null;
  startTime: string;
  endTime: string;
  folder: string;
  branch: string | null;
} => {
  const timestamps = entries
    .map((e) => e.timestamp)
    .filter((t): t is string => typeof t === 'string')
    .sort();

  // Use filename as unique ID, embedded sessionId becomes parent (for compaction tracking)
  const embeddedSessionId = entries.find((e) => e.sessionId)?.sessionId ?? null;
  const fileBasedId = filePath ? basename(filePath, '.jsonl') : embeddedSessionId ?? 'unknown';

  const folder = entries.find((e) => e.cwd)?.cwd ?? '';
  const branch = entries.find((e) => e.gitBranch)?.gitBranch ?? null;

  return {
    id: fileBasedId,
    parentSessionId: embeddedSessionId !== fileBasedId ? embeddedSessionId : null,
    startTime: timestamps[0] ?? '',
    endTime: timestamps[timestamps.length - 1] ?? '',
    folder,
    branch
  };
};

export const calculateTokens = (entries: LogEntry[]): number => {
  return entries.reduce((total, entry) => {
    const usage = entry.message?.usage;
    if (!usage) return total;

    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;

    return total + inputTokens + outputTokens + cacheRead + cacheCreation;
  }, 0);
};

export const parseSessionFromContent = (content: string, filePath?: string): ParsedSession | null => {
  const entries = parseJsonlContent(content);
  if (entries.length === 0) return null;

  const metadata = extractSessionMetadata(entries, filePath);
  const totalTokens = calculateTokens(entries);

  return {
    ...metadata,
    entries,
    totalTokens
  };
};
