/**
 * Unit tests for event classification and extraction
 *
 * Tests the core event processing logic that converts raw log entries
 * into typed events.
 */

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
import { createTestLogEntry, createTestEvent } from '../../fixtures/sessions.js';

describe('classifyEntry', () => {
  it('classifies user messages by role', () => {
    const entry = createTestLogEntry({ message: { role: 'user' } });
    assert.strictEqual(classifyEntry(entry), 'user_message');
  });

  it('classifies assistant messages by role', () => {
    const entry = createTestLogEntry({ message: { role: 'assistant' } });
    assert.strictEqual(classifyEntry(entry), 'assistant_message');
  });

  it('classifies user messages by type field', () => {
    const entry = createTestLogEntry({ type: 'user' });
    assert.strictEqual(classifyEntry(entry), 'user_message');
  });

  it('classifies human type as user_message', () => {
    const entry = createTestLogEntry({ type: 'human' });
    assert.strictEqual(classifyEntry(entry), 'user_message');
  });

  it('classifies error entries', () => {
    const entry = createTestLogEntry({ type: 'error' });
    assert.strictEqual(classifyEntry(entry), 'error');
  });

  it('classifies entries with error property as errors', () => {
    const entry = createTestLogEntry({ type: 'message', error: { message: 'failed' } });
    assert.strictEqual(classifyEntry(entry), 'error');
  });

  it('classifies tool_use entries', () => {
    const entry = createTestLogEntry({ type: 'tool_use', tool_name: 'Read' });
    assert.strictEqual(classifyEntry(entry), 'tool_call');
  });

  it('classifies tool_result entries', () => {
    const entry = createTestLogEntry({ type: 'tool_result' });
    assert.strictEqual(classifyEntry(entry), 'tool_call');
  });

  it('classifies git operations from bash commands', () => {
    const entry = createTestLogEntry({
      type: 'tool_use',
      tool_name: 'Bash',
      input: { command: 'git commit -m "test"' }
    });
    assert.strictEqual(classifyEntry(entry), 'git_op');
  });

  it('returns null for unknown entry types', () => {
    const entry = createTestLogEntry({ type: 'unknown_type' });
    assert.strictEqual(classifyEntry(entry), null);
  });
});

describe('isGitOperation', () => {
  it('detects git commit commands', () => {
    const entry = createTestLogEntry({
      tool_name: 'Bash',
      input: { command: 'git commit -m "feat: add feature"' }
    });
    assert.strictEqual(isGitOperation(entry), true);
  });

  it('detects git push commands', () => {
    const entry = createTestLogEntry({
      tool_name: 'Bash',
      input: { command: 'git push origin main' }
    });
    assert.strictEqual(isGitOperation(entry), true);
  });

  it('detects git pull commands', () => {
    const entry = createTestLogEntry({
      tool_name: 'Bash',
      input: { command: 'git pull --rebase' }
    });
    assert.strictEqual(isGitOperation(entry), true);
  });

  it('detects git checkout commands', () => {
    const entry = createTestLogEntry({
      tool_name: 'Bash',
      input: { command: 'git checkout -b feature/new' }
    });
    assert.strictEqual(isGitOperation(entry), true);
  });

  it('returns false for non-git bash commands', () => {
    const entry = createTestLogEntry({
      tool_name: 'Bash',
      input: { command: 'npm install' }
    });
    assert.strictEqual(isGitOperation(entry), false);
  });

  it('returns false for non-bash tools', () => {
    const entry = createTestLogEntry({
      tool_name: 'Read',
      input: { file_path: '/path/to/file' }
    });
    assert.strictEqual(isGitOperation(entry), false);
  });

  it('detects git commands in nested tool_use content', () => {
    const entry = createTestLogEntry({
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'git status' }
          }
        ]
      }
    });
    assert.strictEqual(isGitOperation(entry), true);
  });
});

describe('extractBashCommand', () => {
  it('extracts command from direct input field', () => {
    const entry = createTestLogEntry({
      input: { command: 'npm test' }
    });
    assert.strictEqual(extractBashCommand(entry), 'npm test');
  });

  it('extracts command from nested tool_use in message content', () => {
    const entry = createTestLogEntry({
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'ls -la' }
          }
        ]
      }
    });
    assert.strictEqual(extractBashCommand(entry), 'ls -la');
  });

  it('extracts from content field as fallback', () => {
    const entry = createTestLogEntry({
      content: 'echo hello'
    });
    assert.strictEqual(extractBashCommand(entry), 'echo hello');
  });

  it('returns null when no command found', () => {
    const entry = createTestLogEntry({ type: 'message' });
    assert.strictEqual(extractBashCommand(entry), null);
  });
});

describe('extractContent', () => {
  it('extracts string content from content field', () => {
    const entry = createTestLogEntry({ content: 'Hello world' });
    assert.strictEqual(extractContent(entry), 'Hello world');
  });

  it('extracts string content from message.content', () => {
    const entry = createTestLogEntry({ message: { content: 'Message content' } });
    assert.strictEqual(extractContent(entry), 'Message content');
  });

  it('extracts text from array content with text items', () => {
    const entry = createTestLogEntry({
      message: {
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' }
        ]
      }
    });
    assert.strictEqual(extractContent(entry), 'First part\nSecond part');
  });

  it('returns null when no content found', () => {
    const entry = createTestLogEntry({ type: 'tool_use' });
    assert.strictEqual(extractContent(entry), null);
  });
});

describe('isPlanningMode', () => {
  it('detects "Plan:" prefix', () => {
    const entry = createTestLogEntry({
      message: { content: 'Plan:\n1. First step\n2. Second step' }
    });
    assert.strictEqual(isPlanningMode(entry), true);
  });

  it('detects "Step N:" patterns', () => {
    const entry = createTestLogEntry({
      message: { content: 'Step 1: Initialize the project' }
    });
    assert.strictEqual(isPlanningMode(entry), true);
  });

  it('detects "let me plan" phrases', () => {
    const entry = createTestLogEntry({
      message: { content: 'Let me plan this out before we start.' }
    });
    assert.strictEqual(isPlanningMode(entry), true);
  });

  it('returns false for regular messages', () => {
    const entry = createTestLogEntry({
      message: { content: 'Here is the code you requested.' }
    });
    assert.strictEqual(isPlanningMode(entry), false);
  });

  it('returns false for entries without content', () => {
    const entry = createTestLogEntry({ type: 'tool_use' });
    assert.strictEqual(isPlanningMode(entry), false);
  });
});

describe('calculateEntryTokens', () => {
  it('sums all token types', () => {
    const entry = createTestLogEntry({
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100
        }
      }
    });
    assert.strictEqual(calculateEntryTokens(entry), 450);
  });

  it('returns 0 when no usage field', () => {
    const entry = createTestLogEntry({ message: { content: 'test' } });
    assert.strictEqual(calculateEntryTokens(entry), 0);
  });

  it('handles partial usage data', () => {
    const entry = createTestLogEntry({
      message: { usage: { input_tokens: 100 } }
    });
    assert.strictEqual(calculateEntryTokens(entry), 100);
  });
});

describe('entryToEvent', () => {
  it('converts a valid entry to an event', () => {
    const entry = createTestLogEntry({
      type: 'message',
      message: { role: 'user' },
      timestamp: '2026-01-01T10:00:00Z'
    });

    const event = entryToEvent(entry);

    assert.ok(event);
    assert.strictEqual(event.type, 'user_message');
    assert.strictEqual(event.timestamp, '2026-01-01T10:00:00Z');
    assert.strictEqual(event.raw, entry);
  });

  it('returns null for unclassifiable entries', () => {
    const entry = createTestLogEntry({ type: 'unknown' });
    assert.strictEqual(entryToEvent(entry), null);
  });

  it('calculates token count from entry', () => {
    const entry = createTestLogEntry({
      message: {
        role: 'assistant',
        usage: { input_tokens: 100, output_tokens: 200 }
      }
    });

    const event = entryToEvent(entry);

    assert.ok(event);
    assert.strictEqual(event.tokenCount, 300);
  });
});

describe('extractEvents', () => {
  it('extracts events from multiple entries', () => {
    const entries = [
      createTestLogEntry({ message: { role: 'user' }, timestamp: '2026-01-01T10:00:00Z' }),
      createTestLogEntry({ message: { role: 'assistant' }, timestamp: '2026-01-01T10:01:00Z' }),
      createTestLogEntry({ type: 'tool_use', tool_name: 'Read', timestamp: '2026-01-01T10:02:00Z' })
    ];

    const events = extractEvents(entries);

    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].type, 'user_message');
    assert.strictEqual(events[1].type, 'assistant_message');
    assert.strictEqual(events[2].type, 'tool_call');
  });

  it('filters out unclassifiable entries', () => {
    const entries = [
      createTestLogEntry({ message: { role: 'user' } }),
      createTestLogEntry({ type: 'unknown' }),
      createTestLogEntry({ message: { role: 'assistant' } })
    ];

    const events = extractEvents(entries);

    assert.strictEqual(events.length, 2);
  });

  it('returns empty array for empty input', () => {
    const events = extractEvents([]);
    assert.strictEqual(events.length, 0);
  });
});

describe('extractGitDetails', () => {
  it('extracts commit details', () => {
    const event = createTestEvent({
      type: 'git_op',
      raw: createTestLogEntry({
        tool_name: 'Bash',
        input: { command: 'git commit -m "feat: add feature"' }
      })
    });

    const details = extractGitDetails(event);

    assert.ok(details);
    assert.strictEqual(details.operation, 'commit');
    assert.ok(details.command.includes('git commit'));
  });

  it('extracts push details', () => {
    const event = createTestEvent({
      type: 'git_op',
      raw: createTestLogEntry({
        tool_name: 'Bash',
        input: { command: 'git push origin main' }
      })
    });

    const details = extractGitDetails(event);

    assert.ok(details);
    assert.strictEqual(details.operation, 'push');
  });

  it('returns null for non-git events', () => {
    const event = createTestEvent({ type: 'tool_call' });
    assert.strictEqual(extractGitDetails(event), null);
  });
});
