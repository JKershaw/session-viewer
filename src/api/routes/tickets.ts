import { Router, type Request, type Response } from 'express';
import type { TicketRepository } from '../../db/tickets.js';

export const createTicketRoutes = (ticketRepo?: TicketRepository): Router => {
  const router = Router();

  // List all tickets
  router.get('/', async (_req: Request, res: Response) => {
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

  return router;
};
