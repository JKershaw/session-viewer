import type { MangoCollection } from '@jkershaw/mangodb';
import { getClient } from './client.js';
import type { ClaimedPrompt } from '../types/index.js';

export interface DispatchRepository {
  saveClaimedPrompt: (prompt: ClaimedPrompt) => Promise<void>;
  getClaimedPrompt: (id: string) => Promise<ClaimedPrompt | null>;
  getAllClaimedPrompts: () => Promise<ClaimedPrompt[]>;
  deleteClaimedPrompt: (id: string) => Promise<boolean>;
}

export const createDispatchRepository = (
  dataDir = './data',
  collectionName = 'claimed_prompts'
): DispatchRepository => {
  let collection: MangoCollection<ClaimedPrompt> | null = null;

  const getDispatchCollection = async (): Promise<MangoCollection<ClaimedPrompt>> => {
    if (!collection) {
      const client = await getClient(dataDir);
      const db = client.db('session-viewer');
      collection = db.collection<ClaimedPrompt>(collectionName);
    }
    return collection;
  };

  const saveClaimedPrompt = async (prompt: ClaimedPrompt): Promise<void> => {
    const coll = await getDispatchCollection();
    const existing = await coll.findOne({ id: prompt.id });
    if (existing) {
      await coll.updateOne({ id: prompt.id }, { $set: prompt });
    } else {
      await coll.insertOne(prompt);
    }
  };

  const getClaimedPrompt = async (id: string): Promise<ClaimedPrompt | null> => {
    const coll = await getDispatchCollection();
    return await coll.findOne({ id });
  };

  const getAllClaimedPrompts = async (): Promise<ClaimedPrompt[]> => {
    const coll = await getDispatchCollection();
    return await coll.find({}).toArray();
  };

  const deleteClaimedPrompt = async (id: string): Promise<boolean> => {
    const coll = await getDispatchCollection();
    const existing = await coll.findOne({ id });
    if (!existing) {
      return false;
    }
    await coll.deleteOne({ id });
    return true;
  };

  return {
    saveClaimedPrompt,
    getClaimedPrompt,
    getAllClaimedPrompts,
    deleteClaimedPrompt
  };
};
