import { getClient } from './client.js';
import type { Session, SessionQueryOptions, PaginatedResult, Event, TimelineQueryOptions, TimelineResult } from '../types/index.js';
import type { MangoCollection } from '@jkershaw/mangodb';

/**
 * Build a MongoDB-style query object from filter options.
 * This enables database-level filtering for better performance.
 */
const buildSessionQuery = (options: SessionQueryOptions): Record<string, unknown> => {
  const query: Record<string, unknown> = {};

  // Date range filtering on startTime
  // Note: For merged sessions, startTime is the earliest child's startTime,
  // so filtering at DB level is safe - all relevant sessions will be included
  if (options.dateFrom) {
    query.startTime = { $gte: options.dateFrom };
  }
  if (options.dateTo) {
    // Include all sessions on dateTo by setting end of day
    const toDate = new Date(options.dateTo);
    toDate.setHours(23, 59, 59, 999);
    query.startTime = {
      ...(query.startTime as Record<string, unknown> || {}),
      $lte: toDate.toISOString()
    };
  }

  // Exact match filters - safe to apply at DB level
  if (options.branch) {
    query.branch = options.branch;
  }
  if (options.linearTicketId) {
    query.linearTicketId = options.linearTicketId;
  }

  // Folder uses regex for partial match
  if (options.folder) {
    query.folder = { $regex: options.folder };
  }

  return query;
};

/**
 * Build a MongoDB-style query for timeline requests.
 * Optimized for infinite scroll with before/after cursors.
 */
const buildTimelineQuery = (options: TimelineQueryOptions): Record<string, unknown> => {
  const query: Record<string, unknown> = {};

  // Time-based cursor for infinite scroll
  if (options.before) {
    query.startTime = { $lt: options.before };
  }
  if (options.after) {
    query.startTime = {
      ...(query.startTime as Record<string, unknown> || {}),
      $gt: options.after
    };
  }

  // Standard filters
  if (options.branch) {
    query.branch = options.branch;
  }
  if (options.linearTicketId) {
    query.linearTicketId = options.linearTicketId;
  }
  if (options.folder) {
    query.folder = { $regex: options.folder };
  }

  return query;
};

/**
 * Merge sessions that share the same parentSessionId.
 * Sessions with the same parent are combined into a single unified session
 * with merged events sorted by timestamp.
 */
const mergeSessions = (sessions: Session[]): Session[] => {
  // Group sessions by their merge key (parentSessionId if exists, else id)
  const mergeGroups = new Map<string, Session[]>();

  for (const session of sessions) {
    const mergeKey = session.parentSessionId || session.id;
    if (!mergeGroups.has(mergeKey)) {
      mergeGroups.set(mergeKey, []);
    }
    mergeGroups.get(mergeKey)!.push(session);
  }

  // Merge each group into a single session
  return Array.from(mergeGroups.values()).map(group => {
    // If only one session in group, return it unchanged
    if (group.length === 1) {
      return {
        ...group[0],
        _childSessionIds: [group[0].id],
        _childCount: 1
      };
    }

    // Sort by startTime to ensure chronological order
    group.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Merge events and add source session reference, then sort by timestamp
    const mergedEvents: Event[] = group
      .flatMap(s => s.events.map(e => ({ ...e, sourceSessionId: s.id })))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Merge annotations from all sessions
    const mergedAnnotations = group.flatMap(s => s.annotations || []);

    // Calculate merged time span
    const startTime = group[0].startTime;
    const endTime = group[group.length - 1].endTime;
    const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();

    // Use the parentSessionId as the merged session's ID
    const mergedId = group[0].parentSessionId || group[0].id;

    return {
      id: mergedId,
      parentSessionId: null, // This is now the canonical merged session
      startTime,
      endTime,
      durationMs,
      totalTokens: group.reduce((sum, s) => sum + s.totalTokens, 0),
      branch: group[0].branch,
      folder: group[0].folder,
      linearTicketId: group[0].linearTicketId,
      analyzed: group.every(s => s.analyzed),
      events: mergedEvents,
      annotations: mergedAnnotations,
      _childSessionIds: group.map(s => s.id),
      _childCount: group.length
    };
  });
};

// Simple promise-based mutex to serialize MangoDB file operations
const createMutex = () => {
  let lock: Promise<void> = Promise.resolve();

  return {
    acquire: (): Promise<() => void> => {
      let release: () => void;
      const waitForLock = lock;
      lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      return waitForLock.then(() => release!);
    }
  };
};

export interface SessionRepository {
  upsertSession: (session: Session) => Promise<void>;
  upsertSessions: (sessions: Session[]) => Promise<number>;
  getSession: (id: string) => Promise<Session | null>;
  getAllSessions: () => Promise<Session[]>;
  getAllSessionsRaw: () => Promise<Session[]>;  // Returns unmerged sessions
  getSessions: (options: SessionQueryOptions) => Promise<PaginatedResult<Session>>;
  getSessionsForTimeline: (options: TimelineQueryOptions) => Promise<TimelineResult>;
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
  const mutex = createMutex();

  // Bulk upsert - delete existing by ID, then insert new
  // Optimized to avoid loading all sessions into memory
  const upsertSessions = async (sessions: Session[]): Promise<number> => {
    if (sessions.length === 0) return 0;

    const release = await mutex.acquire();
    try {
      // Get IDs of sessions we're about to insert
      const incomingIds = sessions.map(s => s.id);

      // Delete any existing sessions with these IDs in ONE operation
      // This avoids loading all sessions just to check which exist
      await collection.deleteMany({ id: { $in: incomingIds } });

      // Insert all in ONE operation
      await collection.insertMany(sessions);

      console.log(`  Stored ${sessions.length} sessions`);
      return sessions.length;
    } finally {
      release();
    }
  };

  // Single upsert for backwards compatibility
  const upsertSession = async (session: Session): Promise<void> => {
    await upsertSessions([session]);
  };

  const getSession = async (id: string): Promise<Session | null> => {
    // First try direct ID lookup
    const directMatch = await collection.findOne({ id });
    if (directMatch) {
      // Check if this session has siblings with the same parentSessionId
      if (directMatch.parentSessionId) {
        const siblings = await collection.find({ parentSessionId: directMatch.parentSessionId }).toArray();
        if (siblings.length > 1) {
          // Return the merged version
          const merged = mergeSessions(siblings);
          return merged[0] || null;
        }
      }
      return {
        ...directMatch,
        _childSessionIds: [directMatch.id],
        _childCount: 1
      };
    }

    // If not found by direct ID, try looking for sessions where this ID is the parentSessionId
    const childSessions = await collection.find({ parentSessionId: id }).toArray();
    if (childSessions.length > 0) {
      const merged = mergeSessions(childSessions);
      return merged[0] || null;
    }

    return null;
  };

  const getAllSessions = async (): Promise<Session[]> => {
    const rawSessions = await collection.find({}).toArray();
    return mergeSessions(rawSessions);
  };

  const getAllSessionsRaw = async (): Promise<Session[]> => {
    return await collection.find({}).toArray();
  };

  const getSessions = async (
    options: SessionQueryOptions
  ): Promise<PaginatedResult<Session>> => {
    const { limit = 50, offset = 0 } = options;

    // Build query for database-level filtering
    const query = buildSessionQuery(options);

    // Fetch filtered sessions from database
    const rawSessions = await collection.find(query).toArray();

    // Merge sessions that share the same parentSessionId
    const allSessions = mergeSessions(rawSessions);

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

  const getSessionsForTimeline = async (
    options: TimelineQueryOptions
  ): Promise<TimelineResult> => {
    const { limit = 50 } = options;

    // Build query for timeline filtering
    const query = buildTimelineQuery(options);

    // Fetch filtered sessions
    const rawSessions = await collection.find(query).toArray();

    // Merge sessions that share the same parentSessionId
    const allSessions = mergeSessions(rawSessions);

    // Sort by startTime descending (most recent first)
    allSessions.sort(
      (a: Session, b: Session) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    // Apply limit
    const sessions = allSessions.slice(0, limit);

    // Determine if there are more sessions in each direction
    // Check for earlier sessions (before our oldest result)
    const oldestInResult = sessions.length > 0
      ? sessions[sessions.length - 1].startTime
      : null;

    // Check for later sessions (after our newest result)
    const newestInResult = sessions.length > 0
      ? sessions[0].startTime
      : null;

    // Check if there are earlier sessions
    let hasEarlier = false;
    if (oldestInResult) {
      const earlierQuery = { ...buildTimelineQuery(options), startTime: { $lt: oldestInResult } };
      const earlierSessions = await collection.find(earlierQuery).toArray();
      hasEarlier = earlierSessions.length > 0;
    }

    // Check if there are later sessions (only if we had a 'before' cursor)
    let hasLater = false;
    if (options.before && newestInResult) {
      const laterQuery = { ...buildTimelineQuery({ ...options, before: undefined }), startTime: { $gt: newestInResult } };
      const laterSessions = await collection.find(laterQuery).toArray();
      hasLater = laterSessions.length > 0;
    } else if (!options.before) {
      // No 'before' cursor means we're at the latest - check if there's anything newer
      hasLater = false;
    }

    return {
      sessions,
      hasEarlier,
      hasLater,
      earliestTime: oldestInResult,
      latestTime: newestInResult
    };
  };

  const deleteSession = async (id: string): Promise<void> => {
    await collection.deleteOne({ id });
  };

  return {
    upsertSession,
    upsertSessions,
    getSession,
    getAllSessions,
    getAllSessionsRaw,
    getSessions,
    getSessionsForTimeline,
    deleteSession
  };
};
