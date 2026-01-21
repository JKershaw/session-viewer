import type { DispatchQueueItem } from '../types/index.js';

export interface DispatchConfig {
  token: string;
  baseUrl: string;
}

export interface DispatchClient {
  poll: () => Promise<DispatchQueueItem[]>;
  take: (itemId: string) => Promise<DispatchQueueItem>;
}

const DEFAULT_BASE_URL = 'https://projects.jkershaw.com';

/**
 * Gets dispatch config from environment variables.
 * Returns null if required variables are not set.
 */
export const getDispatchConfig = (): DispatchConfig | null => {
  const token = process.env.DISPATCH_TOKEN;
  const baseUrl = process.env.DISPATCH_URL || DEFAULT_BASE_URL;

  if (!token) {
    return null;
  }

  return {
    token,
    baseUrl
  };
};

/**
 * Creates a dispatch client for interacting with the LinearViewer dispatch API.
 */
export const createDispatchClient = (config: DispatchConfig): DispatchClient => {
  const { token, baseUrl } = config;

  /**
   * Poll for available dispatch items.
   */
  const poll = async (): Promise<DispatchQueueItem[]> => {
    const response = await fetch(`${baseUrl}/api/dispatch/poll`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dispatch poll error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result as DispatchQueueItem[];
  };

  /**
   * Take (claim) a dispatch item atomically.
   * Returns the claimed item on success.
   * Throws an error if the item is already claimed (404) or on other errors.
   */
  const take = async (itemId: string): Promise<DispatchQueueItem> => {
    const response = await fetch(`${baseUrl}/api/dispatch/take/${itemId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 404) {
      throw new Error('Item already claimed or not found');
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dispatch take error: ${response.status} - ${errorText}`);
    }

    // API returns { item: {...} }
    const result = await response.json();
    return result.item as DispatchQueueItem;
  };

  return { poll, take };
};
