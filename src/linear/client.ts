import type { LinearTicket, Session, TicketReference } from '../types/index.js';

export interface LinearConfig {
  apiKey: string;
  teamId?: string;
  baseUrl?: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: { name: string };
  labels: { nodes: Array<{ name: string }> };
  project?: { name: string };
  branchName?: string;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface IssuesConnection {
  nodes: LinearIssue[];
  pageInfo: PageInfo;
}

interface LinearGraphQLResponse {
  data?: {
    issues?: IssuesConnection;
    team?: {
      issues?: IssuesConnection;
    };
  };
  errors?: Array<{ message: string }>;
}

const DEFAULT_BASE_URL = 'https://api.linear.app/graphql';

/**
 * Extract ticket type from labels.
 * Looks for common type indicators like bug, feature, enhancement, etc.
 */
export const extractTicketType = (labels: string[]): string => {
  const lowerLabels = labels.map(l => l.toLowerCase());

  // Priority order for type detection
  const typePatterns: [RegExp, string][] = [
    [/^bug$/i, 'bug'],
    [/^bugfix$/i, 'bug'],
    [/^fix$/i, 'bug'],
    [/^feature$/i, 'feature'],
    [/^enhancement$/i, 'enhancement'],
    [/^improvement$/i, 'enhancement'],
    [/^task$/i, 'task'],
    [/^chore$/i, 'chore'],
    [/^refactor$/i, 'refactor'],
    [/^docs?$/i, 'docs'],
    [/^documentation$/i, 'docs'],
    [/^test$/i, 'test'],
    [/^testing$/i, 'test'],
  ];

  for (const label of lowerLabels) {
    for (const [pattern, type] of typePatterns) {
      if (pattern.test(label)) {
        return type;
      }
    }
  }

  return 'issue'; // Default fallback
};

/**
 * Creates a Linear API client
 */
export const createLinearClient = (config: LinearConfig) => {
  const { apiKey, teamId, baseUrl = DEFAULT_BASE_URL } = config;

  const query = async <T>(gql: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: gql, variables })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Linear API error: ${response.status} - ${errorText}`);
    }

    const result = (await response.json()) as LinearGraphQLResponse;
    if (result.errors?.length) {
      throw new Error(`Linear GraphQL error: ${result.errors.map((e) => e.message).join(', ')}`);
    }

    return result.data as T;
  };

  /**
   * Fetches issues from Linear with pagination support.
   * @param options.limit - Max issues per page (default 100, max 250)
   * @param options.maxPages - Max pages to fetch (default 10, set to 0 for unlimited)
   */
  const getIssues = async (options: { limit?: number; maxPages?: number } = {}): Promise<LinearTicket[]> => {
    const { limit = 100, maxPages = 10 } = options;
    const pageSize = Math.min(limit, 250); // Linear max is 250 per request

    const gql = teamId
      ? `
        query GetTeamIssues($teamId: String!, $first: Int!, $after: String) {
          team(id: $teamId) {
            issues(first: $first, after: $after, orderBy: updatedAt) {
              nodes {
                id
                identifier
                title
                state { name }
                labels { nodes { name } }
                project { name }
                branchName
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `
      : `
        query GetIssues($first: Int!, $after: String) {
          issues(first: $first, after: $after, orderBy: updatedAt) {
            nodes {
              id
              identifier
              title
              state { name }
              labels { nodes { name } }
              project { name }
              branchName
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `;

    type IssuesQueryResult = {
      issues?: IssuesConnection;
      team?: { issues?: IssuesConnection };
    };

    const allIssues: LinearIssue[] = [];
    let cursor: string | null = null;
    let pageCount = 0;

    // Fetch pages until no more or limit reached
    while (maxPages === 0 || pageCount < maxPages) {
      const data: IssuesQueryResult = await query<IssuesQueryResult>(gql, { teamId, first: pageSize, after: cursor });

      const connection: IssuesConnection | undefined = teamId ? data.team?.issues : data.issues;
      if (!connection?.nodes?.length) {
        break;
      }

      allIssues.push(...connection.nodes);
      pageCount++;

      // Check if there are more pages
      if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
        break;
      }

      cursor = connection.pageInfo.endCursor;
    }

    return allIssues.map((issue) => ({
      ticketId: issue.identifier,
      title: issue.title,
      type: extractTicketType(issue.labels.nodes.map((l) => l.name)),
      labels: issue.labels.nodes.map((l) => l.name),
      status: issue.state.name,
      project: issue.project?.name ?? '',
      sessionIds: []
    }));
  };

  return { query, getIssues };
};

/**
 * Extracts ticket ID from branch name using common patterns
 */
export const extractTicketFromBranch = (branch: string | null): string | null => {
  if (!branch) return null;

  // Common patterns:
  // ENG-123/feature-name
  // feature/ENG-123-description
  // ENG-123
  // eng-123 (case insensitive)

  const patterns = [
    /^([A-Z]{2,10}-\d+)/i, // Starts with ticket ID
    /\/([A-Z]{2,10}-\d+)/i, // After slash
    /[_-]([A-Z]{2,10}-\d+)/i // After underscore or hyphen
  ];

  for (const pattern of patterns) {
    const match = branch.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
};

/**
 * Matches sessions to tickets based on branch names
 */
export const matchSessionsToTickets = (
  sessions: Session[],
  tickets: LinearTicket[]
): Map<string, string[]> => {
  const ticketToSessions = new Map<string, string[]>();

  // Initialize map with all ticket IDs
  for (const ticket of tickets) {
    ticketToSessions.set(ticket.ticketId, []);
  }

  // Match sessions to tickets
  for (const session of sessions) {
    const ticketId = extractTicketFromBranch(session.branch);
    if (ticketId && ticketToSessions.has(ticketId)) {
      ticketToSessions.get(ticketId)!.push(session.id);
    }
  }

  return ticketToSessions;
};

/**
 * Get the primary ticket ID from ticket references.
 * Prioritizes "worked" tickets over "referenced" tickets.
 */
const getPrimaryTicketFromReferences = (ticketRefs: TicketReference[] | undefined): string | null => {
  if (!ticketRefs || ticketRefs.length === 0) return null;

  // First, look for a "worked" ticket
  const workedTicket = ticketRefs.find(t => t.relationship === 'worked');
  if (workedTicket) return workedTicket.ticketId;

  // Fall back to first referenced ticket
  return ticketRefs[0]?.ticketId ?? null;
};

/**
 * Updates sessions with their linked ticket IDs.
 * Uses ticket references if available, falls back to branch extraction.
 * Only links to tickets that exist in Linear.
 */
export const linkSessionsToTickets = (
  sessions: Session[],
  tickets: LinearTicket[]
): Session[] => {
  // Create lookup by ticket ID (normalized)
  const validTicketIds = new Set<string>();
  for (const ticket of tickets) {
    validTicketIds.add(ticket.ticketId.toUpperCase());
  }

  return sessions.map((session) => {
    // First, try to get ticket from ticketReferences (if populated)
    let ticketId = getPrimaryTicketFromReferences(session.ticketReferences);

    // Fall back to branch extraction if no ticket references
    if (!ticketId) {
      ticketId = extractTicketFromBranch(session.branch);
    }

    // Only link if ticket exists in Linear
    const linkedTicketId = ticketId && validTicketIds.has(ticketId.toUpperCase())
      ? ticketId.toUpperCase()
      : null;

    // Filter ticket references to only include valid Linear tickets
    const filteredReferences = session.ticketReferences?.filter(
      ref => validTicketIds.has(ref.ticketId.toUpperCase())
    );

    return {
      ...session,
      linearTicketId: linkedTicketId,
      ticketReferences: filteredReferences
    };
  });
};

/**
 * Gets Linear config from environment
 */
export const getLinearConfig = (): LinearConfig | null => {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    teamId: process.env.LINEAR_TEAM_ID,
    baseUrl: process.env.LINEAR_BASE_URL || DEFAULT_BASE_URL
  };
};
