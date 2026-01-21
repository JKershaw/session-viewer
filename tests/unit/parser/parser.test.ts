/**
 * Unit tests for parser core functions
 *
 * Tests JSONL parsing, session metadata extraction, and token calculation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseJsonlContent,
  extractSessionMetadata,
  calculateTokens,
  parseSessionFromContent
} from '../../../src/parser/parser.js';
import { createTestLogEntry } from '../../fixtures/sessions.js';

describe('parseJsonlContent', () => {
  it('parses valid JSONL content into array of entries', () => {
    const content = `{"type":"user","timestamp":"2026-01-01T00:00:00Z","sessionId":"abc123"}
{"type":"assistant","timestamp":"2026-01-01T00:01:00Z","sessionId":"abc123"}`;

    const entries = parseJsonlContent(content);

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].type, 'user');
    assert.strictEqual(entries[1].type, 'assistant');
  });

  it('skips empty lines', () => {
    const content = `{"type":"user","sessionId":"abc123"}

{"type":"assistant","sessionId":"abc123"}`;

    const entries = parseJsonlContent(content);

    assert.strictEqual(entries.length, 2);
  });

  it('skips invalid JSON lines without crashing', () => {
    const content = `{"type":"user","sessionId":"abc123"}
not valid json
{"type":"assistant","sessionId":"abc123"}`;

    const entries = parseJsonlContent(content);

    assert.strictEqual(entries.length, 2);
  });

  it('returns empty array for empty content', () => {
    const entries = parseJsonlContent('');
    assert.strictEqual(entries.length, 0);
  });

  it('returns empty array for whitespace-only content', () => {
    const entries = parseJsonlContent('   \n\n  \t  ');
    assert.strictEqual(entries.length, 0);
  });

  it('handles single line content', () => {
    const content = '{"type":"user","sessionId":"test"}';
    const entries = parseJsonlContent(content);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].type, 'user');
  });
});

describe('extractSessionMetadata', () => {
  it('extracts session id from entries', () => {
    const entries = [
      createTestLogEntry({ sessionId: 'session-123', timestamp: '2026-01-01T00:00:00Z' }),
      createTestLogEntry({ sessionId: 'session-123', timestamp: '2026-01-01T00:01:00Z' })
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.id, 'session-123');
  });

  it('uses file path basename as ID when provided', () => {
    const entries = [
      createTestLogEntry({ sessionId: 'embedded-id', timestamp: '2026-01-01T00:00:00Z' })
    ];

    const metadata = extractSessionMetadata(entries, '/path/to/file-based-id.jsonl');

    assert.strictEqual(metadata.id, 'file-based-id');
    assert.strictEqual(metadata.parentSessionId, 'embedded-id');
  });

  it('sets parentSessionId to null when embedded matches file-based', () => {
    const entries = [
      createTestLogEntry({ sessionId: 'same-id', timestamp: '2026-01-01T00:00:00Z' })
    ];

    const metadata = extractSessionMetadata(entries, '/path/to/same-id.jsonl');

    assert.strictEqual(metadata.id, 'same-id');
    assert.strictEqual(metadata.parentSessionId, null);
  });

  it('extracts start and end time from timestamps', () => {
    const entries = [
      createTestLogEntry({ timestamp: '2026-01-01T10:00:00Z' }),
      createTestLogEntry({ timestamp: '2026-01-01T10:05:00Z' }),
      createTestLogEntry({ timestamp: '2026-01-01T10:10:00Z' })
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.startTime, '2026-01-01T10:00:00Z');
    assert.strictEqual(metadata.endTime, '2026-01-01T10:10:00Z');
  });

  it('handles entries with missing timestamps', () => {
    const entries = [
      createTestLogEntry({ timestamp: '2026-01-01T10:00:00Z' }),
      createTestLogEntry({ timestamp: undefined }),
      createTestLogEntry({ timestamp: '2026-01-01T10:10:00Z' })
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.startTime, '2026-01-01T10:00:00Z');
    assert.strictEqual(metadata.endTime, '2026-01-01T10:10:00Z');
  });

  it('extracts folder from cwd field', () => {
    const entries = [
      createTestLogEntry({ cwd: '/home/user/projects/myapp', timestamp: '2026-01-01T00:00:00Z' })
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.folder, '/home/user/projects/myapp');
  });

  it('extracts branch from gitBranch field', () => {
    const entries = [
      createTestLogEntry({ gitBranch: 'feature/new-feature', timestamp: '2026-01-01T00:00:00Z' })
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.branch, 'feature/new-feature');
  });

  it('returns null branch when not present', () => {
    const entries = [
      createTestLogEntry({ timestamp: '2026-01-01T00:00:00Z' })
    ];

    const metadata = extractSessionMetadata(entries);

    assert.strictEqual(metadata.branch, null);
  });

  it('returns empty strings for missing data', () => {
    const metadata = extractSessionMetadata([]);

    assert.strictEqual(metadata.startTime, '');
    assert.strictEqual(metadata.endTime, '');
    assert.strictEqual(metadata.folder, '');
  });
});

describe('calculateTokens', () => {
  it('sums input and output tokens from usage field', () => {
    const entries = [
      createTestLogEntry({
        message: { usage: { input_tokens: 100, output_tokens: 50 } }
      }),
      createTestLogEntry({
        message: { usage: { input_tokens: 200, output_tokens: 100 } }
      })
    ];

    const total = calculateTokens(entries);

    assert.strictEqual(total, 450);
  });

  it('includes cache tokens in total', () => {
    const entries = [
      createTestLogEntry({
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 200
          }
        }
      })
    ];

    const total = calculateTokens(entries);

    assert.strictEqual(total, 850);
  });

  it('handles entries without usage field', () => {
    const entries = [
      createTestLogEntry({ message: { content: 'hello' } }),
      createTestLogEntry({ message: { usage: { input_tokens: 50, output_tokens: 25 } } })
    ];

    const total = calculateTokens(entries);

    assert.strictEqual(total, 75);
  });

  it('handles entries without message field', () => {
    const entries = [
      createTestLogEntry({ type: 'system' }),
      createTestLogEntry({ message: { usage: { input_tokens: 100, output_tokens: 50 } } })
    ];

    const total = calculateTokens(entries);

    assert.strictEqual(total, 150);
  });

  it('returns 0 for empty entries', () => {
    const total = calculateTokens([]);
    assert.strictEqual(total, 0);
  });

  it('handles missing token fields as 0', () => {
    const entries = [
      createTestLogEntry({
        message: { usage: { input_tokens: 100 } }  // No output_tokens
      })
    ];

    const total = calculateTokens(entries);

    assert.strictEqual(total, 100);
  });
});

describe('parseSessionFromContent', () => {
  it('returns null for empty content', () => {
    const result = parseSessionFromContent('');
    assert.strictEqual(result, null);
  });

  it('returns null for content with only invalid JSON', () => {
    const result = parseSessionFromContent('not valid\nalso not valid');
    assert.strictEqual(result, null);
  });

  it('parses complete session from content', () => {
    const content = `{"type":"user","sessionId":"test-123","timestamp":"2026-01-01T10:00:00Z","cwd":"/project","gitBranch":"main"}
{"type":"assistant","sessionId":"test-123","timestamp":"2026-01-01T10:01:00Z","message":{"usage":{"input_tokens":100,"output_tokens":50}}}`;

    const session = parseSessionFromContent(content, '/logs/test-123.jsonl');

    assert.ok(session);
    assert.strictEqual(session.id, 'test-123');
    assert.strictEqual(session.folder, '/project');
    assert.strictEqual(session.branch, 'main');
    assert.strictEqual(session.totalTokens, 150);
    assert.strictEqual(session.entries.length, 2);
  });
});
