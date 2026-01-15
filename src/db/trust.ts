/**
 * Trust Repository
 *
 * Stores and retrieves trust analysis data from the database.
 */

import { getClient } from './client.js';
import type { MangoCollection } from '@jkershaw/mangodb';
import type { SessionTrustAnalysis, TrustMap } from '../types/index.js';

export interface TrustRepository {
  // Session trust analyses
  upsertSessionAnalysis: (analysis: SessionTrustAnalysis) => Promise<void>;
  upsertSessionAnalyses: (analyses: SessionTrustAnalysis[]) => Promise<number>;
  getSessionAnalysis: (sessionId: string) => Promise<SessionTrustAnalysis | null>;
  getAllSessionAnalyses: () => Promise<SessionTrustAnalysis[]>;

  // Trust map (computed aggregate)
  saveTrustMap: (map: TrustMap) => Promise<void>;
  getTrustMap: () => Promise<TrustMap | null>;
}

// Collection accessors
const getAnalysesCollection = async (
  dataDir: string
): Promise<MangoCollection<SessionTrustAnalysis>> => {
  const client = await getClient(dataDir);
  const db = client.db('session-viewer');
  return db.collection<SessionTrustAnalysis>('trust_analyses');
};

const getTrustMapCollection = async (
  dataDir: string
): Promise<MangoCollection<TrustMap & { _id: string }>> => {
  const client = await getClient(dataDir);
  const db = client.db('session-viewer');
  return db.collection<TrustMap & { _id: string }>('trust_map');
};

export const createTrustRepository = async (
  dataDir = './data'
): Promise<TrustRepository> => {
  const analysesCollection = await getAnalysesCollection(dataDir);
  const trustMapCollection = await getTrustMapCollection(dataDir);

  const upsertSessionAnalyses = async (
    analyses: SessionTrustAnalysis[]
  ): Promise<number> => {
    if (analyses.length === 0) return 0;

    const ids = analyses.map(a => a.sessionId);

    // Delete existing analyses for these sessions
    await analysesCollection.deleteMany({ sessionId: { $in: ids } });

    // Insert new analyses
    await analysesCollection.insertMany(analyses);

    return analyses.length;
  };

  const upsertSessionAnalysis = async (
    analysis: SessionTrustAnalysis
  ): Promise<void> => {
    await upsertSessionAnalyses([analysis]);
  };

  const getSessionAnalysis = async (
    sessionId: string
  ): Promise<SessionTrustAnalysis | null> => {
    return await analysesCollection.findOne({ sessionId });
  };

  const getAllSessionAnalyses = async (): Promise<SessionTrustAnalysis[]> => {
    return await analysesCollection.find({}).toArray();
  };

  const saveTrustMap = async (map: TrustMap): Promise<void> => {
    // Use a singleton pattern - always update the same document
    await trustMapCollection.deleteMany({});
    await trustMapCollection.insertOne({
      ...map,
      _id: 'current'
    });
  };

  const getTrustMap = async (): Promise<TrustMap | null> => {
    const doc = await trustMapCollection.findOne({ _id: 'current' });
    if (!doc) return null;

    // Remove _id from result
    const { _id, ...map } = doc;
    return map as TrustMap;
  };

  return {
    upsertSessionAnalysis,
    upsertSessionAnalyses,
    getSessionAnalysis,
    getAllSessionAnalyses,
    saveTrustMap,
    getTrustMap
  };
};
