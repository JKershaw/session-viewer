import { getClient } from './client.js';
import type { Session, SessionQueryOptions, PaginatedResult } from '../types/index.js';
import type { MangoCollection } from '@jkershaw/mangodb';

export interface SessionRepository {
  upsertSession: (session: Session) => Promise<void>;
  getSession: (id: string) => Promise<Session | null>;
  getAllSessions: () => Promise<Session[]>;
  getSessions: (options: SessionQueryOptions) => Promise<PaginatedResult<Session>>;
  deleteSession: (id: string) => Promise<void>;
}

const getSessionsCollection = async (
  dataDir: string
): Promise<MangoCollection<Session>> => {
  const client = await getClient(dataDir);
  const db = client.db('session-viewer');
  return db.collection<Session>('sessions');
};

export const createSessionRepository = async (
  dataDir = './data'
): Promise<SessionRepository> => {
  const collection = await getSessionsCollection(dataDir);

  const upsertSession = async (session: Session): Promise<void> => {
    const existing = await collection.findOne({ id: session.id });
    if (existing) {
      await collection.updateOne({ id: session.id }, { $set: session });
    } else {
      await collection.insertOne(session);
    }
  };

  const getSession = async (id: string): Promise<Session | null> => {
    return await collection.findOne({ id });
  };

  const getAllSessions = async (): Promise<Session[]> => {
    return await collection.find({}).toArray();
  };

  const getSessions = async (
    options: SessionQueryOptions
  ): Promise<PaginatedResult<Session>> => {
    const { limit = 50, offset = 0, dateFrom, dateTo, folder, branch, linearTicketId } = options;

    // Get all sessions and filter in memory
    // (MangoDB doesn't support complex queries, so we filter after fetching)
    let allSessions = await collection.find({}).toArray();

    // Filter by date range if provided
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      allSessions = allSessions.filter(
        (s: Session) => new Date(s.startTime) >= fromDate
      );
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      allSessions = allSessions.filter(
        (s: Session) => new Date(s.startTime) <= toDate
      );
    }

    // Filter by folder (partial match)
    if (folder) {
      allSessions = allSessions.filter(
        (s: Session) => s.folder && s.folder.includes(folder)
      );
    }

    // Filter by branch (exact match)
    if (branch) {
      allSessions = allSessions.filter(
        (s: Session) => s.branch === branch
      );
    }

    // Filter by Linear ticket ID (exact match)
    if (linearTicketId) {
      allSessions = allSessions.filter(
        (s: Session) => s.linearTicketId === linearTicketId
      );
    }

    // Sort by startTime descending (most recent first)
    allSessions.sort(
      (a: Session, b: Session) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    const total = allSessions.length;

    // Apply pagination
    const data = allSessions.slice(offset, offset + limit);

    return { data, total, limit, offset };
  };

  const deleteSession = async (id: string): Promise<void> => {
    await collection.deleteOne({ id });
  };

  return {
    upsertSession,
    getSession,
    getAllSessions,
    getSessions,
    deleteSession
  };
};
