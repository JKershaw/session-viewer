/**
 * Trust Analysis API Routes
 *
 * Endpoints for trust map computation, session analysis, and predictions.
 */

import { Router, type Request, type Response } from 'express';
import type { SessionRepository } from '../../db/sessions.js';
import type { TrustRepository } from '../../db/trust.js';
import type { TicketRepository } from '../../db/tickets.js';
import {
  analyzeSessionTrust,
  analyzeSessionsTrust
} from '../../analysis/trust-analyzer.js';
import {
  buildTrustMap,
  predictTrust,
  generateComparativeInsights
} from '../../analysis/trust-aggregator.js';

export interface TrustRoutesConfig {
  sessionRepo: SessionRepository;
  trustRepo: TrustRepository;
  ticketRepo?: TicketRepository;
}

export const createTrustRoutes = (config: TrustRoutesConfig): Router => {
  const { sessionRepo, trustRepo, ticketRepo } = config;
  const router = Router();

  /**
   * GET /api/trust/map
   * Get the current trust map (or compute if missing)
   */
  router.get('/map', async (_req: Request, res: Response) => {
    try {
      let trustMap = await trustRepo.getTrustMap();

      if (!trustMap) {
        // Auto-compute if missing
        const sessions = await sessionRepo.getAllSessions();
        const ticketMap = await buildTicketMap(ticketRepo);
        const analyses = analyzeSessionsTrust(sessions, ticketMap);
        await trustRepo.upsertSessionAnalyses(analyses);
        trustMap = buildTrustMap(analyses);
        await trustRepo.saveTrustMap(trustMap);
      }

      res.json(trustMap);
    } catch (error) {
      console.error('Trust map error:', error);
      res.status(500).json({ error: 'Failed to get trust map' });
    }
  });

  /**
   * POST /api/trust/compute
   * Recompute trust map from all sessions
   */
  router.post('/compute', async (_req: Request, res: Response) => {
    try {
      const sessions = await sessionRepo.getAllSessions();
      const ticketMap = await buildTicketMap(ticketRepo);

      // Analyze all sessions
      const analyses = analyzeSessionsTrust(sessions, ticketMap);
      await trustRepo.upsertSessionAnalyses(analyses);

      // Build and save trust map
      const trustMap = buildTrustMap(analyses);
      await trustRepo.saveTrustMap(trustMap);

      // Generate insights
      const insights = generateComparativeInsights(trustMap);

      res.json({
        message: 'Trust map computed',
        sessionsAnalyzed: analyses.length,
        trustMap,
        insights
      });
    } catch (error) {
      console.error('Trust compute error:', error);
      res.status(500).json({ error: 'Failed to compute trust map' });
    }
  });

  /**
   * GET /api/trust/session/:id
   * Get trust analysis for a specific session
   */
  router.get('/session/:id', async (req: Request, res: Response) => {
    try {
      const sessionId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;

      // Always fetch session to check if recomputation is needed
      const session = await sessionRepo.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Check for cached analysis
      let analysis = await trustRepo.getSessionAnalysis(sessionId);

      // Recompute if:
      // 1. No cached analysis exists, OR
      // 2. Session data has changed since cache was computed (stale cache)
      //    Detect by comparing annotation counts and outcome counts
      const sessionAnnotationCount = session.annotations?.length ?? 0;
      const cachedAnnotationCount = analysis
        ? (analysis.steering.goalShiftCount +
           analysis.outcome.blockerCount +
           analysis.outcome.reworkCount +
           analysis.outcome.decisionCount)
        : 0;
      const annotationsStale = session.analyzed && sessionAnnotationCount > cachedAnnotationCount;

      // Also check if outcomes have changed (e.g., after re-parsing with bug fixes)
      const sessionCommitCount = session.outcomes?.commits?.length ?? 0;
      const cachedCommitCount = analysis?.outcome.commitCount ?? 0;
      const outcomesStale = sessionCommitCount !== cachedCommitCount;

      const cacheIsStale = analysis && (annotationsStale || outcomesStale);

      if (!analysis || cacheIsStale) {
        // Compute on demand
        const ticket = session.linearTicketId && ticketRepo
          ? await ticketRepo.getTicket(session.linearTicketId)
          : null;

        analysis = analyzeSessionTrust(
          session,
          ticket?.type,
          ticket?.labels
        );
        await trustRepo.upsertSessionAnalysis(analysis);
      }

      res.json(analysis);
    } catch (error) {
      console.error('Session trust error:', error);
      res.status(500).json({ error: 'Failed to get session trust analysis' });
    }
  });

  /**
   * POST /api/trust/predict
   * Predict trust level for a new task based on characteristics
   *
   * Body: { codebaseArea?, ticketType?, branchType?, labels?, projectPath? }
   */
  router.post('/predict', async (req: Request, res: Response) => {
    try {
      const trustMap = await trustRepo.getTrustMap();

      if (!trustMap) {
        res.status(400).json({
          error: 'Trust map not computed. Run POST /api/trust/compute first.'
        });
        return;
      }

      const characteristics = {
        codebaseArea: req.body.codebaseArea as string | undefined,
        ticketType: req.body.ticketType as string | undefined,
        branchType: req.body.branchType as string | undefined,
        labels: req.body.labels as string[] | undefined,
        projectPath: req.body.projectPath as string | undefined
      };

      const prediction = predictTrust(trustMap, characteristics);

      res.json(prediction);
    } catch (error) {
      console.error('Trust prediction error:', error);
      res.status(500).json({ error: 'Failed to predict trust' });
    }
  });

  /**
   * GET /api/trust/insights
   * Get comparative insights from the trust map
   */
  router.get('/insights', async (_req: Request, res: Response) => {
    try {
      const trustMap = await trustRepo.getTrustMap();

      if (!trustMap) {
        res.json({ insights: [], message: 'No trust map computed yet' });
        return;
      }

      const insights = generateComparativeInsights(trustMap);

      res.json({
        insights,
        global: trustMap.global,
        computedAt: trustMap.computedAt
      });
    } catch (error) {
      console.error('Trust insights error:', error);
      res.status(500).json({ error: 'Failed to get insights' });
    }
  });

  /**
   * GET /api/trust/areas
   * Get trust statistics by codebase area
   */
  router.get('/areas', async (_req: Request, res: Response) => {
    try {
      const trustMap = await trustRepo.getTrustMap();

      if (!trustMap) {
        res.json({ areas: [] });
        return;
      }

      res.json({
        areas: trustMap.byArea,
        global: trustMap.global
      });
    } catch (error) {
      console.error('Trust areas error:', error);
      res.status(500).json({ error: 'Failed to get trust by area' });
    }
  });

  return router;
};

/**
 * Build a map of ticket ID -> ticket info for analysis
 */
async function buildTicketMap(
  ticketRepo?: TicketRepository
): Promise<Map<string, { type: string; labels: string[] }>> {
  const map = new Map<string, { type: string; labels: string[] }>();

  if (!ticketRepo) return map;

  try {
    const tickets = await ticketRepo.getAllTickets();
    for (const ticket of tickets) {
      map.set(ticket.ticketId, {
        type: ticket.type,
        labels: ticket.labels
      });
    }
  } catch {
    // Ticket repo may not be initialized
  }

  return map;
}
