import type { LinearTicket, Session } from '../types/index.js';

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

interface LinearGraphQLResponse {
  data?: {
    issues?: {
      nodes: LinearIssue[];
    };
    team?: {
      issues?: {
        nodes: LinearIssue[];
      };
    };
  };
  errors?: Array<{ message: string }>;
}

const DEFAULT_BASE_URL = 'https://api.linear.app/graphql';

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
   * Fetches recent issues from Linear
   */
  const getIssues = async (options: { limit?: number } = {}): Promise<LinearTicket[]> => {
    const { limit = 100 } = options;

    const gql = teamId
      ? `
        query GetTeamIssues($teamId: String!, $first: Int!) {
          team(id: $teamId) {
            issues(first: $first, orderBy: updatedAt) {
              nodes {
                id
                identifier
                title
                state { name }
                labels { nodes { name } }
                project { name }
                branchName
              }
            }
          }
        }
      `
      : `
        query GetIssues($first: Int!) {
          issues(first: $first, orderBy: updatedAt) {
            nodes {
              id
              identifier
              title
              state { name }
              labels { nodes { name } }
              project { name }
              branchName
            }
          }
        }
      `;

    const data = await query<{
      issues?: { nodes: LinearIssue[] };
      team?: { issues?: { nodes: LinearIssue[] } };
    }>(gql, { teamId, first: limit });

    const issues = teamId ? data.team?.issues?.nodes : data.issues?.nodes;
    if (!issues) {
      return [];
    }

    return issues.map((issue) => ({
      ticketId: issue.identifier,
      title: issue.title,
      type: 'issue',
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
 * Updates sessions with their linked ticket IDs
 */
export const linkSessionsToTickets = (
  sessions: Session[],
  tickets: LinearTicket[]
): Session[] => {
  const ticketByBranch = new Map<string, string>();

  // Create lookup by ticket ID (normalized)
  for (const ticket of tickets) {
    ticketByBranch.set(ticket.ticketId.toUpperCase(), ticket.ticketId);
  }

  return sessions.map((session) => {
    const ticketId = extractTicketFromBranch(session.branch);
    const linkedTicketId = ticketId ? ticketByBranch.get(ticketId.toUpperCase()) ?? null : null;

    return {
      ...session,
      linearTicketId: linkedTicketId
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
