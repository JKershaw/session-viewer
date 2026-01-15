import { Router, type Request, type Response } from 'express';
import type { SessionRepository } from '../../db/sessions.js';
import type { TicketRepository } from '../../db/tickets.js';
import {
  createLinearClient,
  getLinearConfig,
  linkSessionsToTickets
} from '../../linear/client.js';

export interface LinearRoutesConfig {
  sessionRepo: SessionRepository;
  ticketRepo?: TicketRepository;
}

export const createLinearRoutes = (config: LinearRoutesConfig): Router => {
  const { sessionRepo, ticketRepo } = config;
  const router = Router();

  // Sync with Linear
  router.post('/sync', async (_req: Request, res: Response) => {
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

      // Update sessions with ticket links (including clearing stale links)
      for (let i = 0; i < linkedSessions.length; i++) {
        const linkedSession = linkedSessions[i];
        const originalSession = sessions[i];
        // Update if ticket link changed (added, removed, or changed)
        if (linkedSession.linearTicketId !== originalSession.linearTicketId) {
          await sessionRepo.upsertSession(linkedSession);
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: `Failed to sync with Linear: ${message}` });
    }
  });

  return router;
};
