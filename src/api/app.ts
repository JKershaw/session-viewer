import express, { type Express, type Request, type Response } from 'express';
import { join } from 'node:path';
import type { SessionRepository } from '../db/sessions.js';
import type { TicketRepository } from '../db/tickets.js';
import type { JobQueue } from '../queue/jobs.js';
import type { ScanConfig } from '../parser/scanner.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createJobRoutes } from './routes/jobs.js';
import { createTicketRoutes } from './routes/tickets.js';
import { createLinearRoutes } from './routes/linear.js';
import { createRefreshRoutes } from './routes/refresh.js';
import { errorHandler } from './middleware/errorHandler.js';

export interface AppConfig extends ScanConfig {
  staticDir?: string;
}

export interface AppRepositories {
  sessions: SessionRepository;
  tickets?: TicketRepository;
}

export const createApp = (
  repos: AppRepositories,
  config: AppConfig = {},
  jobQueue?: JobQueue
): Express => {
  const app = express();

  app.use(express.json());

  // Serve static files from public directory
  const staticDir = config.staticDir ?? join(process.cwd(), 'public');
  app.use(express.static(staticDir));

  // Mount API routes
  app.use('/api/sessions', createSessionRoutes({
    sessionRepo: repos.sessions,
    jobQueue
  }));

  app.use('/api/jobs', createJobRoutes(jobQueue));

  app.use('/api/tickets', createTicketRoutes(repos.tickets));

  app.use('/api/linear', createLinearRoutes({
    sessionRepo: repos.sessions,
    ticketRepo: repos.tickets
  }));

  app.use('/api/refresh', createRefreshRoutes({
    sessionRepo: repos.sessions,
    scanConfig: config
  }));

  // Error handler
  app.use(errorHandler);

  // Serve index.html for all other routes (SPA support)
  app.get('/{*path}', (_req: Request, res: Response) => {
    res.sendFile(join(staticDir, 'index.html'));
  });

  return app;
};
