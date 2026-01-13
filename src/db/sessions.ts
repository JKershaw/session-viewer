import { getClient } from './client.js';
import type { Session } from '../types/index.js';
import type { Collection } from '@jkershaw/mangodb';

export interface SessionRepository {
  upsertSession: (session: Session) => Promise<void>;
  getSession: (id: string) => Promise<Session | null>;
  getAllSessions: () => Promise<Session[]>;
  deleteSession: (id: string) => Promise<void>;
}

const getSessionsCollection = async (
  dataDir: string
): Promise<Collection<Session>> => {
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

  const deleteSession = async (id: string): Promise<void> => {
    await collection.deleteOne({ id });
  };

  return {
    upsertSession,
    getSession,
    getAllSessions,
    deleteSession
  };
};
