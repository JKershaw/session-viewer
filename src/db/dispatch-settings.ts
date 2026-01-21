import type { MangoCollection } from '@jkershaw/mangodb';
import { getClient } from './client.js';
import type { AutoClaimSettings } from '../types/index.js';

const DEFAULT_SETTINGS: AutoClaimSettings = {
  enabled: false,
  pollingIntervalMs: 3000,
  maxClaimsPerPoll: 1,
  lastPollAt: null,
  lastClaimAt: null,
  lastError: null,
  totalClaimedCount: 0
};

const SETTINGS_ID = 'auto-claim-settings';

interface SettingsDocument extends AutoClaimSettings {
  _id: string;
  [key: string]: unknown;
}

export interface DispatchSettingsRepository {
  getSettings: () => Promise<AutoClaimSettings>;
  updateSettings: (partial: Partial<AutoClaimSettings>) => Promise<AutoClaimSettings>;
  recordPoll: (error?: string) => Promise<void>;
  recordClaim: () => Promise<void>;
}

export const createDispatchSettingsRepository = (
  dataDir = './data',
  collectionName = 'dispatch_settings'
): DispatchSettingsRepository => {
  let collection: MangoCollection<SettingsDocument> | null = null;

  const getCollection = async (): Promise<MangoCollection<SettingsDocument>> => {
    if (!collection) {
      const client = await getClient(dataDir);
      const db = client.db('session-viewer');
      collection = db.collection<SettingsDocument>(collectionName);
    }
    return collection;
  };

  const getSettings = async (): Promise<AutoClaimSettings> => {
    const coll = await getCollection();
    const doc = await coll.findOne({ _id: SETTINGS_ID });
    if (!doc) {
      return { ...DEFAULT_SETTINGS };
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...settings } = doc;
    return settings;
  };

  const updateSettings = async (partial: Partial<AutoClaimSettings>): Promise<AutoClaimSettings> => {
    const coll = await getCollection();
    const current = await getSettings();
    const updated = { ...current, ...partial };

    const existing = await coll.findOne({ _id: SETTINGS_ID });
    if (existing) {
      await coll.updateOne({ _id: SETTINGS_ID }, { $set: updated });
    } else {
      await coll.insertOne({ _id: SETTINGS_ID, ...updated });
    }

    return updated;
  };

  const recordPoll = async (error?: string): Promise<void> => {
    const coll = await getCollection();
    const update: Partial<AutoClaimSettings> = {
      lastPollAt: new Date().toISOString(),
      lastError: error || null
    };

    const existing = await coll.findOne({ _id: SETTINGS_ID });
    if (existing) {
      await coll.updateOne({ _id: SETTINGS_ID }, { $set: update });
    } else {
      await coll.insertOne({ _id: SETTINGS_ID, ...DEFAULT_SETTINGS, ...update });
    }
  };

  const recordClaim = async (): Promise<void> => {
    const coll = await getCollection();
    const current = await getSettings();
    const update: Partial<AutoClaimSettings> = {
      lastClaimAt: new Date().toISOString(),
      totalClaimedCount: current.totalClaimedCount + 1
    };

    const existing = await coll.findOne({ _id: SETTINGS_ID });
    if (existing) {
      await coll.updateOne({ _id: SETTINGS_ID }, { $set: update });
    } else {
      await coll.insertOne({ _id: SETTINGS_ID, ...DEFAULT_SETTINGS, ...update });
    }
  };

  return {
    getSettings,
    updateSettings,
    recordPoll,
    recordClaim
  };
};
