import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  summarizeEvents,
  buildAnalysisPrompt,
  parseAnnotations
} from './openrouter.js';
import type { Event, Session } from '../types/index.js';

describe('OpenRouter LLM Client', () => {
  describe('summarizeEvents', () => {
    it('summarizes a list of events', () => {
      const events: Event[] = [
        {
          type: 'user_message',
          timestamp: '2024-01-15T10:00:00Z',
          tokenCount: 100,
          raw: { type: 'message' }
        },
        {
          type: 'assistant_message',
          timestamp: '2024-01-15T10:01:00Z',
          tokenCount: 500,
          raw: { type: 'message' }
        }
      ];

      const summary = summarizeEvents(events);
      assert.ok(summary.includes('user_message'));
      assert.ok(summary.includes('assistant_message'));
      assert.ok(summary.includes('100 tokens'));
      assert.ok(summary.includes('500 tokens'));
    });

    it('handles git operations with command detail', () => {
      const events: Event[] = [
        {
          type: 'git_op',
          timestamp: '2024-01-15T10:00:00Z',
          tokenCount: 50,
          raw: { type: 'tool_use', input: { command: 'git commit -m "test"' } }
        }
      ];

      const summary = summarizeEvents(events);
      assert.ok(summary.includes('git_op'));
      assert.ok(summary.includes('git commit'));
    });

    it('handles errors with message detail', () => {
      const events: Event[] = [
        {
          type: 'error',
          timestamp: '2024-01-15T10:00:00Z',
          tokenCount: 0,
          raw: { type: 'error', error: { message: 'File not found' } }
        }
      ];

      const summary = summarizeEvents(events);
      assert.ok(summary.includes('error'));
      assert.ok(summary.includes('File not found'));
    });

    it('handles empty events', () => {
      const summary = summarizeEvents([]);
      assert.strictEqual(summary, '');
    });
  });

  describe('buildAnalysisPrompt', () => {
    it('builds a valid prompt with session details', () => {
      const session: Session = {
        id: 'test-session-123',
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T11:00:00Z',
        durationMs: 3600000,
        totalTokens: 50000,
        branch: 'feature/test',
        folder: '/home/user/project',
        linearTicketId: null,
        analyzed: false,
        events: [
          { type: 'user_message', timestamp: '2024-01-15T10:00:00Z', tokenCount: 100, raw: { type: 'user' } }
        ],
        annotations: []
      };

      const messages = buildAnalysisPrompt(session);

      assert.strictEqual(messages.length, 2);
      assert.strictEqual(messages[0].role, 'system');
      assert.strictEqual(messages[1].role, 'user');

      // Check user prompt contains session details
      assert.ok(messages[1].content.includes('test-session-123'));
      assert.ok(messages[1].content.includes('60 minutes'));
      assert.ok(messages[1].content.includes('50000'));
      assert.ok(messages[1].content.includes('feature/test'));
    });
  });

  describe('parseAnnotations', () => {
    it('parses valid JSON array response', () => {
      const response = `[
        {"type": "blocker", "eventIndex": 15, "summary": "Stuck on auth issue", "confidence": 0.85},
        {"type": "decision", "eventIndex": 42, "summary": "Switched database", "confidence": 0.9}
      ]`;

      const annotations = parseAnnotations(response);

      assert.strictEqual(annotations.length, 2);
      assert.strictEqual(annotations[0].type, 'blocker');
      assert.strictEqual(annotations[0].eventIndex, 15);
      assert.strictEqual(annotations[0].summary, 'Stuck on auth issue');
      assert.strictEqual(annotations[0].confidence, 0.85);
    });

    it('parses JSON inside markdown code block', () => {
      const response = `Here is the analysis:

\`\`\`json
[{"type": "rework", "eventIndex": 5, "summary": "Reverted changes", "confidence": 0.7}]
\`\`\``;

      const annotations = parseAnnotations(response);
      assert.strictEqual(annotations.length, 1);
      assert.strictEqual(annotations[0].type, 'rework');
    });

    it('handles empty array response', () => {
      const annotations = parseAnnotations('[]');
      assert.deepStrictEqual(annotations, []);
    });

    it('handles invalid JSON gracefully', () => {
      const annotations = parseAnnotations('not valid json');
      assert.deepStrictEqual(annotations, []);
    });

    it('filters out invalid annotation types', () => {
      const response = `[
        {"type": "blocker", "summary": "Valid", "confidence": 0.8},
        {"type": "invalid_type", "summary": "Invalid", "confidence": 0.5},
        {"type": "decision", "summary": "Also valid", "confidence": 0.9}
      ]`;

      const annotations = parseAnnotations(response);
      assert.strictEqual(annotations.length, 2);
      assert.strictEqual(annotations[0].type, 'blocker');
      assert.strictEqual(annotations[1].type, 'decision');
    });

    it('clamps confidence values to 0-1 range', () => {
      const response = `[
        {"type": "blocker", "summary": "High confidence", "confidence": 1.5},
        {"type": "decision", "summary": "Negative confidence", "confidence": -0.5}
      ]`;

      const annotations = parseAnnotations(response);
      assert.strictEqual(annotations[0].confidence, 1);
      assert.strictEqual(annotations[1].confidence, 0);
    });

    it('handles missing confidence with default value', () => {
      const response = `[{"type": "goal_shift", "summary": "Changed direction"}]`;

      const annotations = parseAnnotations(response);
      assert.strictEqual(annotations[0].confidence, 0.5);
    });

    it('extracts JSON array from mixed text', () => {
      const response = `Let me analyze this session.

Based on the events, I found:
[{"type": "blocker", "eventIndex": 10, "summary": "Test failure", "confidence": 0.8}]

Hope this helps!`;

      const annotations = parseAnnotations(response);
      assert.strictEqual(annotations.length, 1);
      assert.strictEqual(annotations[0].type, 'blocker');
    });
  });
});
