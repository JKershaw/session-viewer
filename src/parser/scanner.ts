import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseSessionFromContent } from './parser.js';
import type { ParsedSession } from '../types/index.js';

export interface ScanConfig {
  logsDir?: string;
}

const getDefaultLogsDir = (): string => {
  return join(homedir(), '.claude', 'projects');
};

const findJsonlFiles = async (dir: string): Promise<string[]> => {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await findJsonlFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory might not exist or be inaccessible
  }

  return files;
};

export const scanForSessions = async (
  config: ScanConfig = {}
): Promise<ParsedSession[]> => {
  const logsDir = config.logsDir ?? getDefaultLogsDir();
  const jsonlFiles = await findJsonlFiles(logsDir);

  const sessions: ParsedSession[] = [];

  for (const filePath of jsonlFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const session = parseSessionFromContent(content);
      if (session) {
        sessions.push(session);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return sessions;
};

export const scanAndStoreSessions = async (
  upsertSession: (session: ParsedSession & { durationMs: number; analyzed: boolean; linearTicketId: null; annotations: [] }) => Promise<void>,
  config: ScanConfig = {}
): Promise<number> => {
  const parsed = await scanForSessions(config);

  for (const session of parsed) {
    const startDate = new Date(session.startTime);
    const endDate = new Date(session.endTime);
    const durationMs = endDate.getTime() - startDate.getTime();

    await upsertSession({
      ...session,
      durationMs,
      analyzed: false,
      linearTicketId: null,
      annotations: [],
      events: [] // Will be populated in Phase 2
    });
  }

  return parsed.length;
};
