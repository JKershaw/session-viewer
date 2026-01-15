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

      // Get existing tickets to detect deleted ones
      const existingTickets = await ticketRepo.getAllTickets();
      const newTicketIds = new Set(tickets.map(t => t.ticketId));
      const deletedTickets = existingTickets.filter(t => !newTicketIds.has(t.ticketId));

      // Store new/updated tickets
      for (const ticket of tickets) {
        await ticketRepo.upsertTicket(ticket);
      }

      // Remove deleted tickets
      for (const ticket of deletedTickets) {
        await ticketRepo.deleteTicket(ticket.ticketId);
      }

      // Link sessions to tickets (use raw sessions to update individual DB records)
      const sessions = await sessionRepo.getAllSessionsRaw();
      const linkedSessions = linkSessionsToTickets(sessions, tickets);

      // Update sessions with ticket links (including clearing stale links)
      const sessionsToUpdate: typeof linkedSessions = [];
      for (let i = 0; i < linkedSessions.length; i++) {
        const linkedSession = linkedSessions[i];
        const originalSession = sessions[i];
        // Update if ticket link changed (added, removed, or changed)
        if (linkedSession.linearTicketId !== originalSession.linearTicketId) {
          sessionsToUpdate.push(linkedSession);
        }
      }

      // Batch update for efficiency
      if (sessionsToUpdate.length > 0) {
        await sessionRepo.upsertSessions(sessionsToUpdate);
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
        linkedSessions: linkedSessions.filter((s) => s.linearTicketId).length,
        deletedTickets: deletedTickets.length
      });
    } catch (error) {
      console.error('Linear sync error:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: `Failed to sync with Linear: ${message}` });
    }
  });

  return router;
};
