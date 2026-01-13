import express, { type Express, type Request, type Response } from 'express';
import { join } from 'node:path';
import type { SessionRepository } from '../db/sessions.js';
import { scanAndStoreSessions, type ScanConfig } from '../parser/scanner.js';

export interface AppConfig extends ScanConfig {
  staticDir?: string;
}

export const createApp = (
  sessionRepo: SessionRepository,
  config: AppConfig = {}
): Express => {
  const app = express();

  app.use(express.json());

  // Serve static files from public directory
  const staticDir = config.staticDir ?? join(process.cwd(), 'public');
  app.use(express.static(staticDir));

  // API Routes
  app.get('/api/sessions', async (_req: Request, res: Response) => {
    try {
      const sessions = await sessionRepo.getAllSessions();
      // Return sessions without the raw entries to reduce payload size
      const summaries = sessions.map(({ events, annotations, ...rest }) => ({
        ...rest,
        eventCount: events?.length ?? 0,
        annotationCount: annotations?.length ?? 0
      }));
      res.json(summaries);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  app.get('/api/sessions/:id', async (req: Request, res: Response) => {
    try {
      const session = await sessionRepo.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch session' });
    }
  });

  app.post('/api/refresh', async (_req: Request, res: Response) => {
    try {
      const count = await scanAndStoreSessions(
        sessionRepo.upsertSession,
        config
      );
      res.json({ count, message: `Scanned ${count} sessions` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to refresh sessions' });
    }
  });

  // Serve index.html for all other routes (SPA support)
  app.get('/{*splat}', (_req: Request, res: Response) => {
    res.sendFile(join(staticDir, 'index.html'));
  });

  return app;
};
