import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseSessionStreaming } from './streaming-parser.js';
import type { ParsedSession, Event } from '../types/index.js';

export interface ScanConfig {
  logsDir?: string;
}

export interface ScanProgress {
  filesProcessed: number;
  totalFiles: number;
  sessionsStored: number;
  errors: number;
  skipped: number;
}

export type ProgressCallback = (progress: ScanProgress) => void;

const getDefaultLogsDir = (): string => {
  return join(homedir(), '.claude', 'projects');
};

const findJsonlFiles = async (dir: string, isRoot = true): Promise<string[]> => {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await findJsonlFiles(fullPath, false);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    if (isRoot) {
      console.error(`  Error reading directory ${dir}:`, err instanceof Error ? err.message : err);
    }
  }

  return files;
};

export const scanForSessions = async (
  config: ScanConfig = {}
): Promise<ParsedSession[]> => {
  const logsDir = config.logsDir ?? getDefaultLogsDir();
  console.log(`Scanning for sessions in: ${logsDir}`);

  const jsonlFiles = await findJsonlFiles(logsDir);
  console.log(`  Found ${jsonlFiles.length} .jsonl files`);

  const sessions: ParsedSession[] = [];
  let parseErrors = 0;
  let skipped = 0;

  for (const filePath of jsonlFiles) {
    try {
      const session = await parseSessionStreaming(filePath);
      if (session) {
        sessions.push(session);
      } else {
        skipped++;
      }
    } catch (err) {
      parseErrors++;
      console.error(`  Error parsing ${filePath}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`  Parsed ${sessions.length} sessions${skipped > 0 ? ` (${skipped} skipped)` : ''}${parseErrors > 0 ? ` (${parseErrors} errors)` : ''}`);
  return sessions;
};

type SessionToStore = ParsedSession & { durationMs: number; analyzed: boolean; linearTicketId: null; annotations: []; events: Event[] };

// Process in batches to limit memory usage
const BATCH_SIZE = 50;

// Yield to event loop to allow GC to run
const yieldToEventLoop = (): Promise<void> =>
  new Promise(resolve => setImmediate(resolve));

export const scanAndStoreSessions = async (
  upsertSessions: (sessions: SessionToStore[]) => Promise<number>,
  config: ScanConfig = {},
  onProgress?: ProgressCallback
): Promise<number> => {
  console.log('Starting session scan...');
  const startTime = Date.now();

  const logsDir = config.logsDir ?? getDefaultLogsDir();
  const jsonlFiles = await findJsonlFiles(logsDir);
  const totalFiles = jsonlFiles.length;
  console.log(`  Found ${totalFiles} .jsonl files`);

  if (totalFiles === 0) {
    onProgress?.({ filesProcessed: 0, totalFiles: 0, sessionsStored: 0, errors: 0, skipped: 0 });
    console.log('  No sessions found to store');
    return 0;
  }

  let totalStored = 0;
  let parseErrors = 0;
  let skipped = 0;
  let filesProcessed = 0;
  let batch: SessionToStore[] = [];

  // Send initial progress
  onProgress?.({ filesProcessed: 0, totalFiles, sessionsStored: 0, errors: 0, skipped: 0 });

  for (const filePath of jsonlFiles) {
    try {
      const session = await parseSessionStreaming(filePath);

      if (!session) {
        skipped++;
        filesProcessed++;
        onProgress?.({ filesProcessed, totalFiles, sessionsStored: totalStored, errors: parseErrors, skipped });
        continue;
      }

      const startDate = new Date(session.startTime);
      const endDate = new Date(session.endTime);
      const durationMs = endDate.getTime() - startDate.getTime();

      batch.push({
        ...session,
        durationMs,
        analyzed: false,
        linearTicketId: null,
        annotations: [],
        events: session.events ?? []
      });

      // Store batch when full
      if (batch.length >= BATCH_SIZE) {
        const stored = await upsertSessions(batch);
        totalStored += stored;
        batch = [];
        // Yield to allow GC to free memory from processed sessions
        await yieldToEventLoop();
      }

      filesProcessed++;
      onProgress?.({ filesProcessed, totalFiles, sessionsStored: totalStored, errors: parseErrors, skipped });
    } catch (err) {
      parseErrors++;
      filesProcessed++;
      console.error(`  Error parsing ${filePath}:`, err instanceof Error ? err.message : err);
      onProgress?.({ filesProcessed, totalFiles, sessionsStored: totalStored, errors: parseErrors, skipped });
    }
  }

  // Store remaining batch
  if (batch.length > 0) {
    const stored = await upsertSessions(batch);
    totalStored += stored;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Stored ${totalStored} sessions${skipped > 0 ? ` (${skipped} skipped)` : ''}${parseErrors > 0 ? ` (${parseErrors} errors)` : ''} in ${elapsed}s`);

  return totalStored;
};
