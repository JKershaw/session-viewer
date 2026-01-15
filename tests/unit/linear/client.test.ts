import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractTicketFromBranch,
  extractTicketType,
  matchSessionsToTickets,
  linkSessionsToTickets
} from '../../../src/linear/client.js';
import type { Session, LinearTicket } from '../../../src/types/index.js';

describe('Linear Client', () => {
  describe('extractTicketFromBranch', () => {
    it('extracts ticket ID at start of branch', () => {
      assert.strictEqual(extractTicketFromBranch('ENG-123/feature-name'), 'ENG-123');
    });

    it('extracts ticket ID after slash', () => {
      assert.strictEqual(extractTicketFromBranch('feature/ENG-456-description'), 'ENG-456');
    });

    it('extracts standalone ticket ID', () => {
      assert.strictEqual(extractTicketFromBranch('PROJ-789'), 'PROJ-789');
    });

    it('handles lowercase ticket IDs', () => {
      assert.strictEqual(extractTicketFromBranch('eng-123/feature'), 'ENG-123');
    });

    it('extracts ticket ID after hyphen', () => {
      assert.strictEqual(extractTicketFromBranch('feature-ABC-100-something'), 'ABC-100');
    });

    it('extracts ticket ID after underscore', () => {
      assert.strictEqual(extractTicketFromBranch('feature_DEV-200'), 'DEV-200');
    });

    it('returns null for branches without ticket ID', () => {
      assert.strictEqual(extractTicketFromBranch('main'), null);
      assert.strictEqual(extractTicketFromBranch('feature/new-feature'), null);
    });

    it('returns null for null branch', () => {
      assert.strictEqual(extractTicketFromBranch(null), null);
    });

    it('handles various team prefixes', () => {
      assert.strictEqual(extractTicketFromBranch('AB-1'), 'AB-1');
      assert.strictEqual(extractTicketFromBranch('LONGTEAM-999'), 'LONGTEAM-999');
    });
  });

  describe('extractTicketType', () => {
    it('extracts bug type from labels', () => {
      assert.strictEqual(extractTicketType(['bug']), 'bug');
      assert.strictEqual(extractTicketType(['Bug']), 'bug');
      assert.strictEqual(extractTicketType(['BUG']), 'bug');
      assert.strictEqual(extractTicketType(['bugfix']), 'bug');
      assert.strictEqual(extractTicketType(['fix']), 'bug');
    });

    it('extracts feature type from labels', () => {
      assert.strictEqual(extractTicketType(['feature']), 'feature');
      assert.strictEqual(extractTicketType(['Feature']), 'feature');
    });

    it('extracts enhancement type from labels', () => {
      assert.strictEqual(extractTicketType(['enhancement']), 'enhancement');
      assert.strictEqual(extractTicketType(['improvement']), 'enhancement');
    });

    it('extracts other common types', () => {
      assert.strictEqual(extractTicketType(['task']), 'task');
      assert.strictEqual(extractTicketType(['chore']), 'chore');
      assert.strictEqual(extractTicketType(['refactor']), 'refactor');
      assert.strictEqual(extractTicketType(['docs']), 'docs');
      assert.strictEqual(extractTicketType(['documentation']), 'docs');
      assert.strictEqual(extractTicketType(['test']), 'test');
      assert.strictEqual(extractTicketType(['testing']), 'test');
    });

    it('returns first matching type when multiple labels present', () => {
      // First matching label in the list wins
      assert.strictEqual(extractTicketType(['feature', 'bug']), 'feature');
      assert.strictEqual(extractTicketType(['bug', 'feature']), 'bug');
    });

    it('returns issue as default when no type labels found', () => {
      assert.strictEqual(extractTicketType([]), 'issue');
      assert.strictEqual(extractTicketType(['priority-high']), 'issue');
      assert.strictEqual(extractTicketType(['backend', 'api']), 'issue');
    });
  });

  describe('matchSessionsToTickets', () => {
    const createSession = (id: string, branch: string | null): Session => ({
      id,
      parentSessionId: null,
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-01T01:00:00Z',
      durationMs: 3600000,
      totalTokens: 1000,
      branch,
      folder: '/project',
      linearTicketId: null,
      analyzed: false,
      events: [],
      annotations: []
    });

    const createTicket = (ticketId: string): LinearTicket => ({
      ticketId,
      title: `Ticket ${ticketId}`,
      type: 'issue',
      labels: [],
      status: 'In Progress',
      project: 'Test Project',
      sessionIds: []
    });

    it('matches sessions to tickets by branch', () => {
      const sessions = [
        createSession('s1', 'ENG-123/feature'),
        createSession('s2', 'ENG-123/another'),
        createSession('s3', 'ENG-456/different')
      ];
      const tickets = [createTicket('ENG-123'), createTicket('ENG-456')];

      const matches = matchSessionsToTickets(sessions, tickets);

      assert.deepStrictEqual(matches.get('ENG-123'), ['s1', 's2']);
      assert.deepStrictEqual(matches.get('ENG-456'), ['s3']);
    });

    it('ignores sessions without matching tickets', () => {
      const sessions = [
        createSession('s1', 'ENG-999/feature'),
        createSession('s2', 'main')
      ];
      const tickets = [createTicket('ENG-123')];

      const matches = matchSessionsToTickets(sessions, tickets);

      assert.deepStrictEqual(matches.get('ENG-123'), []);
    });

    it('handles empty inputs', () => {
      const matches = matchSessionsToTickets([], []);
      assert.strictEqual(matches.size, 0);
    });
  });

  describe('linkSessionsToTickets', () => {
    const createSession = (id: string, branch: string | null): Session => ({
      id,
      parentSessionId: null,
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-01T01:00:00Z',
      durationMs: 3600000,
      totalTokens: 1000,
      branch,
      folder: '/project',
      linearTicketId: null,
      analyzed: false,
      events: [],
      annotations: []
    });

    const createTicket = (ticketId: string): LinearTicket => ({
      ticketId,
      title: `Ticket ${ticketId}`,
      type: 'issue',
      labels: [],
      status: 'In Progress',
      project: 'Test Project',
      sessionIds: []
    });

    it('links sessions to matching tickets', () => {
      const sessions = [
        createSession('s1', 'ENG-123/feature'),
        createSession('s2', 'main')
      ];
      const tickets = [createTicket('ENG-123')];

      const linked = linkSessionsToTickets(sessions, tickets);

      assert.strictEqual(linked[0].linearTicketId, 'ENG-123');
      assert.strictEqual(linked[1].linearTicketId, null);
    });

    it('preserves session data when linking', () => {
      const sessions = [createSession('s1', 'ENG-123/feature')];
      const tickets = [createTicket('ENG-123')];

      const linked = linkSessionsToTickets(sessions, tickets);

      assert.strictEqual(linked[0].id, 's1');
      assert.strictEqual(linked[0].totalTokens, 1000);
      assert.strictEqual(linked[0].folder, '/project');
    });
  });
});
