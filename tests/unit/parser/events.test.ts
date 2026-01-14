import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  classifyEntry,
  isGitOperation,
  extractBashCommand,
  extractContent,
  isPlanningMode,
  calculateEntryTokens,
  entryToEvent,
  extractEvents,
  extractGitDetails
} from '../../../src/parser/events.js';
import type { LogEntry, Event } from '../../../src/types/index.js';

describe('Event Extraction', () => {
  describe('classifyEntry', () => {
    it('classifies user messages by role', () => {
      const entry: LogEntry = {
        type: 'message',
        message: { role: 'user', content: 'Hello' }
      };
      assert.strictEqual(classifyEntry(entry), 'user_message');
    });

    it('classifies assistant messages by role', () => {
      const entry: LogEntry = {
        type: 'message',
        message: { role: 'assistant', content: 'Hi there' }
      };
      assert.strictEqual(classifyEntry(entry), 'assistant_message');
    });

    it('classifies user messages by type field', () => {
      const entry: LogEntry = { type: 'user' };
      assert.strictEqual(classifyEntry(entry), 'user_message');
    });

    it('classifies assistant messages by type field', () => {
      const entry: LogEntry = { type: 'assistant' };
      assert.strictEqual(classifyEntry(entry), 'assistant_message');
    });

    it('classifies tool_use as tool_call', () => {
      const entry: LogEntry = {
        type: 'tool_use',
        tool_name: 'Read',
        input: { file_path: '/test.ts' }
      };
      assert.strictEqual(classifyEntry(entry), 'tool_call');
    });

    it('classifies tool_result as tool_call', () => {
      const entry: LogEntry = {
        type: 'tool_result',
        content: 'file contents here'
      };
      assert.strictEqual(classifyEntry(entry), 'tool_call');
    });

    it('classifies errors by type', () => {
      const entry: LogEntry = { type: 'error', message: { content: 'Something failed' } };
      assert.strictEqual(classifyEntry(entry), 'error');
    });

    it('classifies errors by error field', () => {
      const entry: LogEntry = { type: 'message', error: { message: 'failed' } };
      assert.strictEqual(classifyEntry(entry), 'error');
    });

    it('returns null for unknown entry types', () => {
      const entry: LogEntry = { type: 'unknown_type' };
      assert.strictEqual(classifyEntry(entry), null);
    });
  });

  describe('isGitOperation', () => {
    it('detects git push in bash command', () => {
      const entry: LogEntry = {
        type: 'tool_use',
        tool_name: 'Bash',
        input: { command: 'git push origin main' }
      };
      assert.strictEqual(isGitOperation(entry), true);
    });

    it('detects git commit in bash command', () => {
      const entry: LogEntry = {
        type: 'tool_use',
        tool_name: 'Bash',
        input: { command: 'git commit -m "fix bug"' }
      };
      assert.strictEqual(isGitOperation(entry), true);
    });

    it('detects git checkout', () => {
      const entry: LogEntry = {
        type: 'tool_use',
        tool_name: 'Bash',
        input: { command: 'git checkout -b feature-branch' }
      };
      assert.strictEqual(isGitOperation(entry), true);
    });

    it('does not flag non-git bash commands', () => {
      const entry: LogEntry = {
        type: 'tool_use',
        tool_name: 'Bash',
        input: { command: 'npm install' }
      };
      assert.strictEqual(isGitOperation(entry), false);
    });

    it('does not flag Read tool as git operation', () => {
      const entry: LogEntry = {
        type: 'tool_use',
        tool_name: 'Read',
        input: { file_path: '/path/to/file' }
      };
      assert.strictEqual(isGitOperation(entry), false);
    });
  });

  describe('extractBashCommand', () => {
    it('extracts command from input field', () => {
      const entry: LogEntry = {
        type: 'tool_use',
        input: { command: 'ls -la' }
      };
      assert.strictEqual(extractBashCommand(entry), 'ls -la');
    });

    it('extracts command from content field', () => {
      const entry: LogEntry = {
        type: 'tool_result',
        content: 'output here'
      };
      assert.strictEqual(extractBashCommand(entry), 'output here');
    });

    it('returns null when no command found', () => {
      const entry: LogEntry = { type: 'message' };
      assert.strictEqual(extractBashCommand(entry), null);
    });
  });

  describe('extractContent', () => {
    it('extracts string content', () => {
      const entry: LogEntry = {
        type: 'message',
        content: 'Hello world'
      };
      assert.strictEqual(extractContent(entry), 'Hello world');
    });

    it('extracts content from message.content string', () => {
      const entry: LogEntry = {
        type: 'message',
        message: { content: 'Message content' }
      };
      assert.strictEqual(extractContent(entry), 'Message content');
    });

    it('extracts content from message.content array', () => {
      const entry: LogEntry = {
        type: 'message',
        message: {
          content: [
            { type: 'text', text: 'First part' },
            { type: 'text', text: 'Second part' }
          ]
        }
      };
      assert.strictEqual(extractContent(entry), 'First part\nSecond part');
    });

    it('returns null when no content found', () => {
      const entry: LogEntry = { type: 'message' };
      assert.strictEqual(extractContent(entry), null);
    });
  });

  describe('isPlanningMode', () => {
    it('detects planning with numbered steps', () => {
      const entry: LogEntry = {
        type: 'assistant',
        message: { content: 'Step 1: First we need to...' }
      };
      assert.strictEqual(isPlanningMode(entry), true);
    });

    it('detects let me plan statements', () => {
      const entry: LogEntry = {
        type: 'assistant',
        message: { content: 'Let me plan the approach' }
      };
      assert.strictEqual(isPlanningMode(entry), true);
    });

    it('does not flag regular assistant messages', () => {
      const entry: LogEntry = {
        type: 'assistant',
        message: { content: 'Here is the code you requested' }
      };
      assert.strictEqual(isPlanningMode(entry), false);
    });
  });

  describe('calculateEntryTokens', () => {
    it('sums all token types', () => {
      const entry: LogEntry = {
        type: 'message',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 25,
            cache_creation_input_tokens: 10
          }
        }
      };
      assert.strictEqual(calculateEntryTokens(entry), 185);
    });

    it('returns 0 when no usage field', () => {
      const entry: LogEntry = { type: 'message' };
      assert.strictEqual(calculateEntryTokens(entry), 0);
    });

    it('handles partial usage data', () => {
      const entry: LogEntry = {
        type: 'message',
        message: { usage: { input_tokens: 50 } }
      };
      assert.strictEqual(calculateEntryTokens(entry), 50);
    });
  });

  describe('entryToEvent', () => {
    it('converts a valid entry to an event', () => {
      const entry: LogEntry = {
        type: 'message',
        timestamp: '2024-01-01T10:00:00Z',
        message: {
          role: 'user',
          content: 'Hello',
          usage: { input_tokens: 10 }
        }
      };
      const event = entryToEvent(entry);
      assert.ok(event);
      assert.strictEqual(event.type, 'user_message');
      assert.strictEqual(event.timestamp, '2024-01-01T10:00:00Z');
      assert.strictEqual(event.tokenCount, 10);
      assert.deepStrictEqual(event.raw, entry);
    });

    it('returns null for unclassifiable entries', () => {
      const entry: LogEntry = { type: 'unknown' };
      assert.strictEqual(entryToEvent(entry), null);
    });

    it('handles missing timestamp', () => {
      const entry: LogEntry = {
        type: 'message',
        message: { role: 'user' }
      };
      const event = entryToEvent(entry);
      assert.ok(event);
      assert.strictEqual(event.timestamp, '');
    });
  });

  describe('extractEvents', () => {
    it('extracts multiple events from entries', () => {
      const entries: LogEntry[] = [
        { type: 'message', timestamp: '2024-01-01T10:00:00Z', message: { role: 'user' } },
        {
          type: 'message',
          timestamp: '2024-01-01T10:00:01Z',
          message: { role: 'assistant' }
        },
        { type: 'tool_use', timestamp: '2024-01-01T10:00:02Z', tool_name: 'Read' }
      ];
      const events = extractEvents(entries);
      assert.strictEqual(events.length, 3);
      assert.strictEqual(events[0].type, 'user_message');
      assert.strictEqual(events[1].type, 'assistant_message');
      assert.strictEqual(events[2].type, 'tool_call');
    });

    it('filters out unclassifiable entries', () => {
      const entries: LogEntry[] = [
        { type: 'message', message: { role: 'user' } },
        { type: 'unknown_type' },
        { type: 'message', message: { role: 'assistant' } }
      ];
      const events = extractEvents(entries);
      assert.strictEqual(events.length, 2);
    });

    it('returns empty array for empty input', () => {
      const events = extractEvents([]);
      assert.deepStrictEqual(events, []);
    });

    it('classifies git operations correctly', () => {
      const entries: LogEntry[] = [
        {
          type: 'tool_use',
          timestamp: '2024-01-01T10:00:00Z',
          tool_name: 'Bash',
          input: { command: 'git commit -m "test"' }
        }
      ];
      const events = extractEvents(entries);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'git_op');
    });
  });

  describe('extractGitDetails', () => {
    it('extracts git command and operation', () => {
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
      const details = extractGitDetails(event);
      assert.ok(details);
      assert.strictEqual(details.command, 'git push origin main');
      assert.strictEqual(details.operation, 'push');
    });

    it('returns null for non-git events', () => {
      const event: Event = {
        type: 'tool_call',
        timestamp: '2024-01-01T10:00:00Z',
        tokenCount: 0,
        raw: { type: 'tool_use', tool_name: 'Read' }
      };
      assert.strictEqual(extractGitDetails(event), null);
    });
  });
});
