import express, { type Express, type Request, type Response } from 'express';
import { join } from 'node:path';
import type { SessionRepository } from '../db/sessions.js';
import type { TicketRepository } from '../db/tickets.js';
import type { JobQueue } from '../queue/jobs.js';
import { scanAndStoreSessions, type ScanConfig } from '../parser/scanner.js';
import { getOpenRouterConfig } from '../llm/openrouter.js';
import {
  createLinearClient,
  getLinearConfig,
  linkSessionsToTickets
} from '../linear/client.js';
import {
  correlateGitOperations,
  parseGitCommand,
  getRepoPath
} from '../git/client.js';
import { extractGitDetails } from '../parser/events.js';

export interface AppConfig extends ScanConfig {
  staticDir?: string;
}

export interface AppRepositories {
  sessions: SessionRepository;
  tickets?: TicketRepository;
}

export const createApp = (
  repos: SessionRepository | AppRepositories,
  config: AppConfig = {},
  jobQueue?: JobQueue
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
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const session = await sessionRepo.getSession(id);
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

  // Analyze a session with LLM (queued)
  app.post('/api/sessions/:id/analyze', async (req: Request, res: Response) => {
    try {
      const openRouterConfig = getOpenRouterConfig();
      if (!openRouterConfig) {
        res.status(400).json({ error: 'OpenRouter API key not configured. Set OPENROUTER_API_KEY environment variable.' });
        return;
      }

      if (!jobQueue) {
        res.status(500).json({ error: 'Job queue not initialized' });
        return;
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const session = await sessionRepo.getSession(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (session.events.length === 0) {
        res.status(400).json({ error: 'Session has no events to analyze' });
        return;
      }

      // Enqueue job instead of processing synchronously
      const job = await jobQueue.enqueue(id);

      res.status(202).json({
        message: 'Analysis job queued',
        jobId: job.id,
        status: job.status
      });
    } catch (error) {
      console.error('Analysis error:', error);
      res.status(500).json({ error: 'Failed to queue analysis' });
    }
  });

  // Job status endpoints
  app.get('/api/jobs', async (_req: Request, res: Response) => {
    try {
      if (!jobQueue) {
        res.json([]);
        return;
      }
      const jobs = await jobQueue.getAllJobs();
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch jobs' });
    }
  });

  app.get('/api/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      if (!jobQueue) {
        res.status(404).json({ error: 'Job queue not initialized' });
        return;
      }
      const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
      const job = await jobQueue.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json(job);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  // Git correlation endpoint
  app.get('/api/sessions/:id/git-correlations', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const session = await sessionRepo.getSession(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Extract git operations from session events
      const gitEvents = session.events.filter((e) => e.type === 'git_op');
      if (gitEvents.length === 0) {
        res.json({ correlations: [] });
        return;
      }

      // Parse git commands into GitOperation objects
      const operations = gitEvents
        .map((e) => {
          const details = extractGitDetails(e);
          return details ? parseGitCommand(details.command) : null;
        })
        .filter((op): op is NonNullable<typeof op> => op !== null);

      if (operations.length === 0) {
        res.json({ correlations: [] });
        return;
      }

      // Get repository path and correlate
      const repoPath = getRepoPath(session.folder);
      const correlations = await correlateGitOperations(
        repoPath,
        operations,
        { start: session.startTime, end: session.endTime }
      );

      // Convert Map to array for JSON response
      const result = Array.from(correlations.entries()).map(([op, commit]) => ({
        operation: {
          type: op.type,
          command: op.command,
          branch: op.branch,
          message: op.message
        },
        commit: commit ? {
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
          author: commit.author,
          timestamp: commit.timestamp
        } : null
      }));

      res.json({ correlations: result });
    } catch (error) {
      console.error('Git correlation error:', error);
      res.status(500).json({ error: 'Failed to correlate git operations' });
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
