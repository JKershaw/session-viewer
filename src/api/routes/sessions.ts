import { Router, type Request, type Response } from 'express';
import type { SessionRepository } from '../../db/sessions.js';
import type { JobQueue } from '../../queue/jobs.js';
import { getOpenRouterConfig } from '../../llm/openrouter.js';
import {
  correlateGitOperations,
  parseGitCommand,
  getRepoPath
} from '../../git/client.js';
import { extractGitDetails } from '../../parser/events.js';

const isValidISODate = (dateString: string): boolean => {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

export interface SessionRoutesConfig {
  sessionRepo: SessionRepository;
  jobQueue?: JobQueue;
}

export const createSessionRoutes = (config: SessionRoutesConfig): Router => {
  const { sessionRepo, jobQueue } = config;
  const router = Router();

  // Timeline endpoint for infinite scroll
  // Must be before /:id to avoid matching 'timeline' as an id
  router.get('/timeline', async (req: Request, res: Response) => {
    try {
      const before = req.query.before as string | undefined;
      const after = req.query.after as string | undefined;
      const limitParam = req.query.limit as string | undefined;
      const folder = req.query.folder as string | undefined;
      const branch = req.query.branch as string | undefined;
      const ticket = req.query.ticket as string | undefined;
      const includeEvents = req.query.includeEvents === 'true';

      const limit = Math.min(
        Math.max(1, parseInt(limitParam ?? '50', 10) || 50),
        100
      );

      const result = await sessionRepo.getSessionsForTimeline({
        before: before && isValidISODate(before) ? before : undefined,
        after: after && isValidISODate(after) ? after : undefined,
        limit,
        folder: folder || undefined,
        branch: branch || undefined,
        linearTicketId: ticket || undefined
      });

      // Transform sessions - include events if requested, otherwise just counts
      const sessions = result.sessions.map(
        ({ events, annotations, ...rest }) => ({
          ...rest,
          ...(includeEvents
            ? { events, annotations }
            : { eventCount: events?.length ?? 0, annotationCount: annotations?.length ?? 0 }
          )
        })
      );

      res.json({
        sessions,
        hasEarlier: result.hasEarlier,
        hasLater: result.hasLater,
        earliestTime: result.earliestTime,
        latestTime: result.latestTime
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch sessions for timeline' });
    }
  });

  // List sessions with filtering and pagination
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limitParam = req.query.limit as string | undefined;
      const offsetParam = req.query.offset as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const folder = req.query.folder as string | undefined;
      const branch = req.query.branch as string | undefined;
      const ticket = req.query.ticket as string | undefined;
      const includeEvents = req.query.includeEvents === 'true';

      const limit = Math.max(1, parseInt(limitParam ?? '100', 10) || 100);
      const offset = Math.max(0, parseInt(offsetParam ?? '0', 10) || 0);

      const result = await sessionRepo.getSessions({
        limit,
        offset,
        dateFrom: dateFrom && isValidISODate(dateFrom) ? dateFrom : undefined,
        dateTo: dateTo && isValidISODate(dateTo) ? dateTo : undefined,
        folder: folder || undefined,
        branch: branch || undefined,
        linearTicketId: ticket || undefined
      });

      const summaries = result.data.map(
        ({ events, annotations, ...rest }) => ({
          ...rest,
          ...(includeEvents
            ? { events, annotations }
            : { eventCount: events?.length ?? 0, annotationCount: annotations?.length ?? 0 }
          )
        })
      );

      res.json({
        data: summaries,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.data.length < result.total,
        page: Math.floor(result.offset / result.limit) + 1,
        totalPages: Math.ceil(result.total / result.limit)
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  // Get single session
  router.get('/:id', async (req: Request, res: Response) => {
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

  // Analyze session with LLM
  router.post('/:id/analyze', async (req: Request, res: Response) => {
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

  // Git correlations
  router.get('/:id/git-correlations', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const session = await sessionRepo.getSession(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const gitEvents = session.events.filter((e) => e.type === 'git_op');
      if (gitEvents.length === 0) {
        res.json({ correlations: [] });
        return;
      }

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

      const repoPath = getRepoPath(session.folder);
      const correlations = await correlateGitOperations(
        repoPath,
        operations,
        { start: session.startTime, end: session.endTime }
      );

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

  return router;
};
