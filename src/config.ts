import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  logsDir: string;
}

export const loadConfig = (): Config => {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    dataDir: process.env.DATA_DIR ?? './data',
    logsDir: process.env.LOGS_DIR ?? join(homedir(), '.claude', 'projects')
  };
};
