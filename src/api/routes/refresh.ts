import { Router, type Request, type Response } from 'express';
import type { SessionRepository } from '../../db/sessions.js';
import { scanAndStoreSessions, type ScanConfig, type ScanProgress } from '../../parser/scanner.js';

export interface RefreshRoutesConfig {
  sessionRepo: SessionRepository;
  scanConfig: ScanConfig;
}

export const createRefreshRoutes = (config: RefreshRoutesConfig): Router => {
  const { sessionRepo, scanConfig } = config;
  const router = Router();

  // Refresh sessions by scanning logs
  router.post('/', async (_req: Request, res: Response) => {
    try {
      const count = await scanAndStoreSessions(
        sessionRepo.upsertSessions,
        scanConfig
      );
      res.json({ count, message: `Scanned ${count} sessions` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to refresh sessions' });
    }
  });

  // SSE endpoint for streaming progress updates
  router.get('/stream', async (req: Request, res: Response) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Helper to send SSE events
    const sendEvent = (event: string, data: object) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Handle client disconnect
    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    try {
      const onProgress = (progress: ScanProgress) => {
        if (!aborted) {
          sendEvent('progress', progress);
        }
      };

      const count = await scanAndStoreSessions(
        sessionRepo.upsertSessions,
        scanConfig,
        onProgress
      );

      if (!aborted) {
        sendEvent('complete', { count, message: `Scanned ${count} sessions` });
      }
    } catch (error) {
      if (!aborted) {
        sendEvent('error', {
          error: 'Failed to refresh sessions',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } finally {
      res.end();
    }
  });

  return router;
};
