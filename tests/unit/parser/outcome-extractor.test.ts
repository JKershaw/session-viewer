import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractTicketIds,
  isLinearMcpTool,
  getLinearMcpToolType,
  extractTicketFromLinearTool,
  extractCommitOutcome,
  extractPushOutcome,
  extractTicketsFromMessage,
  extractSessionOutcomes,
  buildTicketReferences,
  getPrimaryTicketId,
  extractEventTags
} from '../../../src/parser/outcome-extractor.js';
import type { Event } from '../../../src/types/index.js';

describe('Outcome Extractor', () => {
  describe('extractTicketIds', () => {
    it('extracts standard format ticket IDs', () => {
      const ids = extractTicketIds('Working on KUL-195 today');
      assert.deepStrictEqual(ids, ['KUL-195']);
    });

    it('extracts ticket IDs from commit messages', () => {
      const ids = extractTicketIds('KUL-195: Fix authentication flow');
      assert.deepStrictEqual(ids, ['KUL-195']);
    });

    it('extracts multiple ticket IDs', () => {
      const ids = extractTicketIds('Fix KUL-195 and KUL-200');
      assert.deepStrictEqual(ids, ['KUL-195', 'KUL-200']);
    });

    it('normalizes case to uppercase', () => {
      const ids = extractTicketIds('kul-195 and Eng-456');
      assert.deepStrictEqual(ids, ['KUL-195', 'ENG-456']);
    });

    it('deduplicates ticket IDs', () => {
      const ids = extractTicketIds('KUL-195 mentioned again KUL-195');
      assert.deepStrictEqual(ids, ['KUL-195']);
    });

    it('handles empty or null input', () => {
      assert.deepStrictEqual(extractTicketIds(''), []);
      assert.deepStrictEqual(extractTicketIds(null as unknown as string), []);
    });

    it('handles text with no ticket IDs', () => {
      const ids = extractTicketIds('Regular text without tickets');
      assert.deepStrictEqual(ids, []);
    });

    it('extracts ticket IDs with various prefix lengths', () => {
      const ids = extractTicketIds('AB-1 and ABCDEFGHIJ-999');
      assert.deepStrictEqual(ids, ['AB-1', 'ABCDEFGHIJ-999']);
    });
  });

  describe('isLinearMcpTool', () => {
    it('recognizes mcp__linear__ prefixed tools', () => {
      assert.strictEqual(isLinearMcpTool('mcp__linear__create_issue'), true);
      assert.strictEqual(isLinearMcpTool('mcp__linear__update_issue'), true);
      assert.strictEqual(isLinearMcpTool('mcp__linear__get_issue'), true);
      assert.strictEqual(isLinearMcpTool('mcp__linear__create_comment'), true);
    });

    it('recognizes mcp__linear-server__ prefixed tools', () => {
      assert.strictEqual(isLinearMcpTool('mcp__linear-server__create_issue'), true);
      assert.strictEqual(isLinearMcpTool('mcp__linear-server__update_issue'), true);
      assert.strictEqual(isLinearMcpTool('mcp__linear-server__get_issue'), true);
      assert.strictEqual(isLinearMcpTool('mcp__linear-server__create_comment'), true);
    });

    it('rejects non-Linear tools', () => {
      assert.strictEqual(isLinearMcpTool('Bash'), false);
      assert.strictEqual(isLinearMcpTool('Read'), false);
      assert.strictEqual(isLinearMcpTool('mcp__github__create_issue'), false);
    });

    it('handles null and undefined', () => {
      assert.strictEqual(isLinearMcpTool(null), false);
      assert.strictEqual(isLinearMcpTool(undefined), false);
    });
  });

  describe('getLinearMcpToolType', () => {
    it('identifies create operations', () => {
      assert.strictEqual(getLinearMcpToolType('mcp__linear__create_issue'), 'create');
      assert.strictEqual(getLinearMcpToolType('mcp__linear-server__create_issue'), 'create');
    });

    it('identifies update operations', () => {
      assert.strictEqual(getLinearMcpToolType('mcp__linear__update_issue'), 'update');
      assert.strictEqual(getLinearMcpToolType('mcp__linear-server__update_issue'), 'update');
    });

    it('identifies read operations', () => {
      assert.strictEqual(getLinearMcpToolType('mcp__linear__get_issue'), 'read');
      assert.strictEqual(getLinearMcpToolType('mcp__linear-server__get_issue'), 'read');
    });

    it('identifies comment operations', () => {
      assert.strictEqual(getLinearMcpToolType('mcp__linear__create_comment'), 'comment');
      assert.strictEqual(getLinearMcpToolType('mcp__linear-server__create_comment'), 'comment');
    });

    it('returns null for non-Linear tools', () => {
      assert.strictEqual(getLinearMcpToolType('Bash'), null);
      assert.strictEqual(getLinearMcpToolType(null), null);
    });
  });

  describe('extractTicketFromLinearTool', () => {
    it('extracts ticket ID from update_issue input', () => {
      const event: Event = {
        type: 'tool_call',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'mcp__linear-server__update_issue',
          input: { id: 'KUL-195', state: 'In Progress' }
        }
      };
      const result = extractTicketFromLinearTool(event);
      assert.ok(result);
      assert.strictEqual(result.ticketId, 'KUL-195');
      assert.strictEqual(result.action, 'update');
      assert.strictEqual(result.isCompletion, false);
    });

    it('detects completion when state is Done', () => {
      const event: Event = {
        type: 'tool_call',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'mcp__linear-server__update_issue',
          input: { id: 'KUL-195', state: 'Done' }
        }
      };
      const result = extractTicketFromLinearTool(event);
      assert.ok(result);
      assert.strictEqual(result.isCompletion, true);
      assert.strictEqual(result.newState, 'Done');
    });

    it('detects completion with various done states', () => {
      const doneStates = ['Done', 'done', 'Completed', 'completed', 'Closed', 'Resolved'];
      for (const state of doneStates) {
        const event: Event = {
          type: 'tool_call',
          timestamp: '2024-01-01T10:00:00Z',
          tokenCount: 0,
          raw: {
            type: 'tool_use',
            tool_name: 'mcp__linear__update_issue',
            input: { id: 'KUL-195', state }
          }
        };
        const result = extractTicketFromLinearTool(event);
        assert.ok(result, `Should extract for state: ${state}`);
        assert.strictEqual(result.isCompletion, true, `State "${state}" should be completion`);
      }
    });

    it('returns null for non-Linear tools', () => {
      const event: Event = {
        type: 'tool_call',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git status' }
        }
      };
      assert.strictEqual(extractTicketFromLinearTool(event), null);
    });

    it('extracts from nested message.content tool_use', () => {
      const event: Event = {
        type: 'tool_call',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'mcp__linear-server__get_issue',
                input: { id: 'KUL-200' }
              }
            ]
          }
        }
      };
      const result = extractTicketFromLinearTool(event);
      assert.ok(result);
      assert.strictEqual(result.ticketId, 'KUL-200');
      assert.strictEqual(result.action, 'read');
    });
  });

  describe('extractCommitOutcome', () => {
    it('extracts message from simple commit', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git commit -m "KUL-195: Fix bug"' }
        }
      };
      const result = extractCommitOutcome(event);
      assert.ok(result);
      assert.strictEqual(result.message, 'KUL-195: Fix bug');
      assert.deepStrictEqual(result.ticketIds, ['KUL-195']);
    });

    it('extracts message with single quotes', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: "git commit -m 'Fix authentication'" }
        }
      };
      const result = extractCommitOutcome(event);
      assert.ok(result);
      assert.strictEqual(result.message, 'Fix authentication');
    });

    it('extracts ticket IDs from commit message', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git commit -m "Fix KUL-195 and ENG-456"' }
        }
      };
      const result = extractCommitOutcome(event);
      assert.ok(result);
      assert.deepStrictEqual(result.ticketIds, ['KUL-195', 'ENG-456']);
    });

    it('returns null for non-commit commands', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git push origin main' }
        }
      };
      assert.strictEqual(extractCommitOutcome(event), null);
    });

    it('returns null for non-git events', () => {
      const event: Event = {
        type: 'tool_call',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: { type: 'tool_use', tool_name: 'Read' }
      };
      assert.strictEqual(extractCommitOutcome(event), null);
    });
  });

  describe('extractPushOutcome', () => {
    it('extracts push to remote and branch', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git push origin feature-branch' }
        }
      };
      const result = extractPushOutcome(event);
      assert.ok(result);
      assert.strictEqual(result.remote, 'origin');
      assert.strictEqual(result.branch, 'feature-branch');
    });

    it('extracts push with -u flag', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git push -u origin main' }
        }
      };
      const result = extractPushOutcome(event);
      assert.ok(result);
      assert.strictEqual(result.remote, 'origin');
      assert.strictEqual(result.branch, 'main');
    });

    it('returns null for non-push commands', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git pull origin main' }
        }
      };
      assert.strictEqual(extractPushOutcome(event), null);
    });
  });

  describe('extractTicketsFromMessage', () => {
    it('extracts ticket mentions from user messages', () => {
      const event: Event = {
        type: 'user_message',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'message',
          message: { role: 'user', content: 'Look at KUL-200 for the pattern' }
        }
      };
      const mentions = extractTicketsFromMessage(event);
      assert.strictEqual(mentions.length, 1);
      assert.strictEqual(mentions[0].ticketId, 'KUL-200');
      assert.ok(mentions[0].context.includes('KUL-200'));
    });

    it('extracts multiple mentions', () => {
      const event: Event = {
        type: 'user_message',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'message',
          message: { role: 'user', content: 'Fix KUL-195 using pattern from KUL-200' }
        }
      };
      const mentions = extractTicketsFromMessage(event);
      assert.strictEqual(mentions.length, 2);
    });

    it('returns empty for non-message events', () => {
      const event: Event = {
        type: 'tool_call',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: { type: 'tool_use' }
      };
      assert.deepStrictEqual(extractTicketsFromMessage(event), []);
    });

    it('uses pre-extracted ticket IDs when content is truncated', () => {
      // Simulate a message where content was truncated but _extractedTicketIds preserved the full extraction
      const event: Event = {
        type: 'user_message',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'message',
          message: { role: 'user', content: 'Short truncated content...' },
          // Pre-extracted IDs include tickets that were in the truncated portion
          _extractedTicketIds: ['KUL-123', 'KUL-456']
        }
      };
      const mentions = extractTicketsFromMessage(event);
      assert.strictEqual(mentions.length, 2);
      assert.strictEqual(mentions[0].ticketId, 'KUL-123');
      assert.strictEqual(mentions[1].ticketId, 'KUL-456');
    });

    it('falls back to content extraction when no pre-extracted IDs', () => {
      const event: Event = {
        type: 'user_message',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'message',
          message: { role: 'user', content: 'Please fix KUL-789' }
          // No _extractedTicketIds field
        }
      };
      const mentions = extractTicketsFromMessage(event);
      assert.strictEqual(mentions.length, 1);
      assert.strictEqual(mentions[0].ticketId, 'KUL-789');
    });
  });

  describe('buildTicketReferences', () => {
    it('builds references from branch name', () => {
      const events: Event[] = [
        {
          type: 'user_message',
          timestamp: '2024-01-01T10:00:00Z',
          tokenCount: 0,
          raw: { type: 'message', message: { role: 'user', content: 'Hello' } }
        }
      ];
      const outcomes = { commits: [], pushes: [], ticketStateChanges: [] };
      const refs = buildTicketReferences('claude/KUL-195-fix-auth', events, outcomes);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].ticketId, 'KUL-195');
      assert.strictEqual(refs[0].relationship, 'worked');
      assert.ok(refs[0].sources.some(s => s.type === 'branch'));
    });

    it('builds references from commits', () => {
      const events: Event[] = [];
      const outcomes = {
        commits: [{ message: 'KUL-195: Fix bug', ticketIds: ['KUL-195'], timestamp: '2024-01-01T10:00:00Z', eventIndex: 5 }],
        pushes: [],
        ticketStateChanges: []
      };
      const refs = buildTicketReferences(null, events, outcomes);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].ticketId, 'KUL-195');
      assert.strictEqual(refs[0].relationship, 'worked');
      assert.ok(refs[0].sources.some(s => s.type === 'commit'));
    });

    it('prioritizes worked over referenced', () => {
      // Create events with both mcp_complete (worked) and mention (referenced)
      const events: Event[] = [
        {
          type: 'user_message',
          timestamp: '2024-01-01T10:00:00Z',
          tokenCount: 0,
          raw: { type: 'message', message: { role: 'user', content: 'Look at KUL-195' } }
        },
        {
          type: 'tool_call',
          timestamp: '2024-01-01T10:01:00Z',
          tokenCount: 0,
          raw: {
            type: 'tool_use',
            tool_name: 'mcp__linear-server__update_issue',
            input: { id: 'KUL-195', state: 'Done' }
          }
        }
      ];
      const outcomes = { commits: [], pushes: [], ticketStateChanges: [] };
      const refs = buildTicketReferences(null, events, outcomes);

      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].ticketId, 'KUL-195');
      assert.strictEqual(refs[0].relationship, 'worked'); // Should be worked due to mcp_complete
    });

    it('distinguishes worked and referenced tickets', () => {
      const events: Event[] = [
        {
          type: 'user_message',
          timestamp: '2024-01-01T10:00:00Z',
          tokenCount: 0,
          raw: { type: 'message', message: { role: 'user', content: 'Look at KUL-200' } }
        },
        {
          type: 'tool_call',
          timestamp: '2024-01-01T10:01:00Z',
          tokenCount: 0,
          raw: {
            type: 'tool_use',
            tool_name: 'mcp__linear-server__get_issue',
            input: { id: 'KUL-200' }
          }
        }
      ];
      const outcomes = {
        commits: [{ message: 'KUL-195: Fix', ticketIds: ['KUL-195'], timestamp: '2024-01-01T10:02:00Z', eventIndex: 2 }],
        pushes: [],
        ticketStateChanges: []
      };
      const refs = buildTicketReferences(null, events, outcomes);

      assert.strictEqual(refs.length, 2);

      const kul195 = refs.find(r => r.ticketId === 'KUL-195');
      const kul200 = refs.find(r => r.ticketId === 'KUL-200');

      assert.ok(kul195);
      assert.strictEqual(kul195.relationship, 'worked');

      assert.ok(kul200);
      assert.strictEqual(kul200.relationship, 'referenced');
    });
  });

  describe('getPrimaryTicketId', () => {
    it('returns first worked ticket', () => {
      const refs = [
        { ticketId: 'KUL-200', relationship: 'referenced' as const, sources: [] },
        { ticketId: 'KUL-195', relationship: 'worked' as const, sources: [] }
      ];
      assert.strictEqual(getPrimaryTicketId(refs), 'KUL-195');
    });

    it('returns null for empty references', () => {
      assert.strictEqual(getPrimaryTicketId([]), null);
    });

    it('returns null when no worked tickets', () => {
      const refs = [
        { ticketId: 'KUL-200', relationship: 'referenced' as const, sources: [] }
      ];
      assert.strictEqual(getPrimaryTicketId(refs), null);
    });
  });

  describe('extractEventTags', () => {
    it('extracts commit tags', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git commit -m "KUL-195: Fix bug"' }
        }
      };
      const tags = extractEventTags(event, 0);
      assert.ok(tags.some(t => t.type === 'commit'));
      const commitTag = tags.find(t => t.type === 'commit');
      assert.ok(commitTag && commitTag.type === 'commit');
      assert.strictEqual(commitTag.message, 'KUL-195: Fix bug');
    });

    it('extracts push tags', () => {
      const event: Event = {
        type: 'git_op',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'Bash',
          input: { command: 'git push origin main' }
        }
      };
      const tags = extractEventTags(event, 0);
      assert.ok(tags.some(t => t.type === 'push'));
    });

    it('extracts ticket_completed tags', () => {
      const event: Event = {
        type: 'tool_call',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'tool_use',
          tool_name: 'mcp__linear-server__update_issue',
          input: { id: 'KUL-195', state: 'Done' }
        }
      };
      const tags = extractEventTags(event, 0);
      assert.ok(tags.some(t => t.type === 'ticket_completed'));
    });

    it('extracts ticket_mentioned tags from messages', () => {
      const event: Event = {
        type: 'user_message',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: {
          type: 'message',
          message: { role: 'user', content: 'Check KUL-200 for reference' }
        }
      };
      const tags = extractEventTags(event, 0);
      assert.ok(tags.some(t => t.type === 'ticket_mentioned'));
    });
  });

  describe('extractSessionOutcomes', () => {
    it('extracts all outcome types from events', () => {
      const events: Event[] = [
        {
          type: 'git_op',
          timestamp: '2024-01-01T10:00:00Z',
          tokenCount: 0,
          raw: {
            type: 'tool_use',
            tool_name: 'Bash',
            input: { command: 'git commit -m "KUL-195: Fix"' }
          }
        },
        {
          type: 'git_op',
          timestamp: '2024-01-01T10:01:00Z',
          tokenCount: 0,
          raw: {
            type: 'tool_use',
            tool_name: 'Bash',
            input: { command: 'git push origin main' }
          }
        },
        {
          type: 'tool_call',
          timestamp: '2024-01-01T10:02:00Z',
          tokenCount: 0,
          raw: {
            type: 'tool_use',
            tool_name: 'mcp__linear-server__update_issue',
            input: { id: 'KUL-195', state: 'Done' }
          }
        }
      ];

      const outcomes = extractSessionOutcomes(events);

      assert.strictEqual(outcomes.commits.length, 1);
      assert.strictEqual(outcomes.commits[0].message, 'KUL-195: Fix');
      assert.strictEqual(outcomes.commits[0].eventIndex, 0);

      assert.strictEqual(outcomes.pushes.length, 1);
      assert.strictEqual(outcomes.pushes[0].branch, 'main');
      assert.strictEqual(outcomes.pushes[0].eventIndex, 1);

      assert.strictEqual(outcomes.ticketStateChanges.length, 1);
      assert.strictEqual(outcomes.ticketStateChanges[0].ticketId, 'KUL-195');
      assert.strictEqual(outcomes.ticketStateChanges[0].eventIndex, 2);
    });

    it('handles empty events', () => {
      const outcomes = extractSessionOutcomes([]);
      assert.deepStrictEqual(outcomes.commits, []);
      assert.deepStrictEqual(outcomes.pushes, []);
      assert.deepStrictEqual(outcomes.ticketStateChanges, []);
    });
  });
});
