import type { Collection } from '@jkershaw/mangodb';
import { getCollection } from './client.js';
import type { LinearTicket } from '../types/index.js';

export interface TicketRepository {
  upsertTicket: (ticket: LinearTicket) => Promise<void>;
  getTicket: (ticketId: string) => Promise<LinearTicket | null>;
  getAllTickets: () => Promise<LinearTicket[]>;
  deleteTicket: (ticketId: string) => Promise<void>;
}

export const createTicketRepository = (
  collectionName = 'tickets'
): TicketRepository => {
  let collection: Collection<LinearTicket> | null = null;

  const getTicketCollection = async (): Promise<Collection<LinearTicket>> => {
    if (!collection) {
      collection = await getCollection<LinearTicket>(collectionName);
    }
    return collection;
  };

  const upsertTicket = async (ticket: LinearTicket): Promise<void> => {
    const coll = await getTicketCollection();
    const existing = await coll.findOne({ ticketId: ticket.ticketId });

    if (existing) {
      await coll.updateOne({ ticketId: ticket.ticketId }, { $set: ticket });
    } else {
      await coll.insertOne(ticket);
    }
  };

  const getTicket = async (ticketId: string): Promise<LinearTicket | null> => {
    const coll = await getTicketCollection();
    return coll.findOne({ ticketId });
  };

  const getAllTickets = async (): Promise<LinearTicket[]> => {
    const coll = await getTicketCollection();
    return coll.find({}).toArray();
  };

  const deleteTicket = async (ticketId: string): Promise<void> => {
    const coll = await getTicketCollection();
    await coll.deleteOne({ ticketId });
  };

  return {
    upsertTicket,
    getTicket,
    getAllTickets,
    deleteTicket
  };
};
