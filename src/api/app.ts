import express, { type Express, type Request, type Response } from 'express';
import { join } from 'node:path';
import type { SessionRepository } from '../db/sessions.js';
import type { TicketRepository } from '../db/tickets.js';
import { scanAndStoreSessions, type ScanConfig } from '../parser/scanner.js';
import {
  createOpenRouterClient,
  analyzeSession,
  getOpenRouterConfig
} from '../llm/openrouter.js';
import {
  createLinearClient,
  getLinearConfig,
  linkSessionsToTickets
} from '../linear/client.js';

export interface AppConfig extends ScanConfig {
  staticDir?: string;
}

export interface AppRepositories {
  sessions: SessionRepository;
  tickets?: TicketRepository;
}

export const createApp = (
  repos: SessionRepository | AppRepositories,
  config: AppConfig = {}
): Express => {
  // Support both old and new API signatures
  const sessionRepo = 'sessions' in repos ? repos.sessions : repos;
  const ticketRepo = 'tickets' in repos ? repos.tickets : undefined;
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

  // Analyze a session with LLM
  app.post('/api/sessions/:id/analyze', async (req: Request, res: Response) => {
    try {
      const openRouterConfig = getOpenRouterConfig();
      if (!openRouterConfig) {
        res.status(400).json({ error: 'OpenRouter API key not configured. Set OPENROUTER_API_KEY environment variable.' });
        return;
      }

      const session = await sessionRepo.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (session.events.length === 0) {
        res.status(400).json({ error: 'Session has no events to analyze' });
        return;
      }

      const client = createOpenRouterClient(openRouterConfig);
      const annotations = await analyzeSession(client, session);

      // Update session with annotations
      const updatedSession = {
        ...session,
        analyzed: true,
        annotations
      };
      await sessionRepo.upsertSession(updatedSession);

      res.json({
        message: `Analyzed session with ${annotations.length} annotations`,
        annotations
      });
    } catch (error) {
      console.error('Analysis error:', error);
      res.status(500).json({ error: 'Failed to analyze session' });
    }
  });

  // Linear Integration
  app.get('/api/tickets', async (_req: Request, res: Response) => {
    try {
      if (!ticketRepo) {
        res.json([]);
        return;
      }
      const tickets = await ticketRepo.getAllTickets();
      res.json(tickets);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch tickets' });
    }
  });

  app.post('/api/linear/sync', async (_req: Request, res: Response) => {
    try {
      const linearConfig = getLinearConfig();
      if (!linearConfig) {
        res.status(400).json({ error: 'Linear API key not configured. Set LINEAR_API_KEY environment variable.' });
        return;
      }

      if (!ticketRepo) {
        res.status(400).json({ error: 'Ticket repository not configured' });
        return;
      }

      const client = createLinearClient(linearConfig);
      const tickets = await client.getIssues({ limit: 100 });

      // Store tickets
      for (const ticket of tickets) {
        await ticketRepo.upsertTicket(ticket);
      }

      // Link sessions to tickets
      const sessions = await sessionRepo.getAllSessions();
      const linkedSessions = linkSessionsToTickets(sessions, tickets);

      // Update sessions with ticket links
      for (const session of linkedSessions) {
        if (session.linearTicketId) {
          await sessionRepo.upsertSession(session);
        }
      }

      // Update tickets with session IDs
      for (const ticket of tickets) {
        const linkedSessionIds = linkedSessions
          .filter((s) => s.linearTicketId === ticket.ticketId)
          .map((s) => s.id);
        ticket.sessionIds = linkedSessionIds;
        await ticketRepo.upsertTicket(ticket);
      }

      res.json({
        message: `Synced ${tickets.length} tickets`,
        ticketCount: tickets.length,
        linkedSessions: linkedSessions.filter((s) => s.linearTicketId).length
      });
    } catch (error) {
      console.error('Linear sync error:', error);
      res.status(500).json({ error: 'Failed to sync with Linear' });
    }
  });

  // Serve index.html for all other routes (SPA support)
  app.get('/{*path}', (_req: Request, res: Response) => {
    res.sendFile(join(staticDir, 'index.html'));
  });

  return app;
};
