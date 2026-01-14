import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseJsonlContent, extractSessionMetadata, calculateTokens } from '../../../src/parser/parser.js';
import type { LogEntry } from '../../../src/types/index.js';

describe('parseJsonlContent', () => {
  test('parses valid JSONL content into array of entries', () => {
    const content = `{"type":"user","timestamp":"2026-01-01T00:00:00Z","sessionId":"abc123"}
{"type":"assistant","timestamp":"2026-01-01T00:01:00Z","sessionId":"abc123"}`;

    const entries = parseJsonlContent(content);

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].type, 'user');
    assert.strictEqual(entries[1].type, 'assistant');
  });

  test('skips empty lines', () => {
    const content = `{"type":"user","sessionId":"abc123"}

{"type":"assistant","sessionId":"abc123"}`;

    const entries = parseJsonlContent(content);

    assert.strictEqual(entries.length, 2);
  });

  test('skips invalid JSON lines', () => {
    const content = `{"type":"user","sessionId":"abc123"}
not valid json
{"type":"assistant","sessionId":"abc123"}`;

    const entries = parseJsonlContent(content);

    assert.strictEqual(entries.length, 2);
  });

  test('returns empty array for empty content', () => {
    const entries = parseJsonlContent('');
    assert.strictEqual(entries.length, 0);
  });
});

describe('extractSessionMetadata', () => {
  test('extracts session id from entries', () => {
    const entries: LogEntry[] = [
      { type: 'user', sessionId: 'session-123', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'assistant', sessionId: 'session-123', timestamp: '2026-01-01T00:01:00Z' }
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.id, 'session-123');
  });

  test('extracts start and end time from timestamps', () => {
    const entries: LogEntry[] = [
      { type: 'user', sessionId: 'abc', timestamp: '2026-01-01T10:00:00Z' },
      { type: 'assistant', sessionId: 'abc', timestamp: '2026-01-01T10:05:00Z' },
      { type: 'user', sessionId: 'abc', timestamp: '2026-01-01T10:10:00Z' }
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.startTime, '2026-01-01T10:00:00Z');
    assert.strictEqual(metadata.endTime, '2026-01-01T10:10:00Z');
  });

  test('extracts folder from cwd field', () => {
    const entries: LogEntry[] = [
      { type: 'user', sessionId: 'abc', cwd: '/home/user/projects/myapp', timestamp: '2026-01-01T00:00:00Z' }
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.folder, '/home/user/projects/myapp');
  });

  test('extracts branch from gitBranch field', () => {
    const entries: LogEntry[] = [
      { type: 'user', sessionId: 'abc', gitBranch: 'feature/new-feature', timestamp: '2026-01-01T00:00:00Z' }
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.branch, 'feature/new-feature');
  });

  test('returns null branch when not present', () => {
    const entries: LogEntry[] = [
      { type: 'user', sessionId: 'abc', timestamp: '2026-01-01T00:00:00Z' }
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.branch, null);
  });
});

describe('calculateTokens', () => {
  test('sums input and output tokens from usage field', () => {
    const entries: LogEntry[] = [
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50
          }
        }
      },
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 200,
            output_tokens: 100
          }
        }
      }
    ];

    const total = calculateTokens(entries);

    assert.strictEqual(total, 450);
  });

  test('includes cache tokens in total', () => {
    const entries: LogEntry[] = [
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 200
          }
        }
      }
    ];

    const total = calculateTokens(entries);

    assert.strictEqual(total, 850);
  });

  test('handles entries without usage field', () => {
    const entries: LogEntry[] = [
      { type: 'user', message: { content: 'hello' } },
      { type: 'assistant', message: { usage: { input_tokens: 50, output_tokens: 25 } } }
    ];

    const total = calculateTokens(entries);

    assert.strictEqual(total, 75);
  });

  test('returns 0 for empty entries', () => {
    const total = calculateTokens([]);
    assert.strictEqual(total, 0);
  });
});
