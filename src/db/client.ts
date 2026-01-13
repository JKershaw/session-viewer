import { MangoClient, type MangoDb, type MangoCollection } from '@jkershaw/mangodb';

let client: MangoClient | null = null;

export const getClient = async (dataDir = './data'): Promise<MangoClient> => {
  if (!client) {
    client = new MangoClient(dataDir);
    await client.connect();
  }
  return client;
};

export const getDb = async (dbName = 'session-viewer'): Promise<MangoDb> => {
  const c = await getClient();
  return c.db(dbName);
};

export const getCollection = async <T extends Record<string, unknown>>(
  collectionName: string,
  dbName = 'session-viewer'
): Promise<MangoCollection<T>> => {
  const db = await getDb(dbName);
  return db.collection<T>(collectionName);
};

export const closeClient = async (): Promise<void> => {
  if (client) {
    await client.close();
    client = null;
  }
};
