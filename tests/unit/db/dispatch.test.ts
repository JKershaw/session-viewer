import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { createDispatchRepository, type DispatchRepository } from '../../../src/db/dispatch.js';
import { closeClient } from '../../../src/db/client.js';
import { createTestClaimedPrompt } from '../dispatch/helpers.js';

const TEST_DATA_DIR = './test-data-dispatch-db';

describe('DispatchRepository', () => {
  let repo: DispatchRepository;

  beforeEach(async () => {
    repo = createDispatchRepository(TEST_DATA_DIR, 'test-claimed-prompts');
  });

  afterEach(async () => {
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('saveClaimedPrompt', () => {
    test('inserts a new prompt', async () => {
      const prompt = createTestClaimedPrompt({ id: 'new-prompt' });

      await repo.saveClaimedPrompt(prompt);

      const found = await repo.getClaimedPrompt('new-prompt');
      assert.strictEqual(found?.id, 'new-prompt');
      assert.strictEqual(found?.promptName, 'Test Task');
    });

    test('updates existing prompt', async () => {
      const prompt = createTestClaimedPrompt({ id: 'update-prompt' });
      await repo.saveClaimedPrompt(prompt);

      const updated = createTestClaimedPrompt({ id: 'update-prompt', promptName: 'Updated Name' });
      await repo.saveClaimedPrompt(updated);

      const found = await repo.getClaimedPrompt('update-prompt');
      assert.strictEqual(found?.promptName, 'Updated Name');
    });
  });

  describe('getClaimedPrompt', () => {
    test('returns prompt by ID', async () => {
      const prompt = createTestClaimedPrompt({ id: 'find-me', promptName: 'Find Me Task' });
      await repo.saveClaimedPrompt(prompt);

      const found = await repo.getClaimedPrompt('find-me');

      assert.strictEqual(found?.id, 'find-me');
      assert.strictEqual(found?.promptName, 'Find Me Task');
    });

    test('returns null for non-existent ID', async () => {
      const found = await repo.getClaimedPrompt('does-not-exist');
      assert.strictEqual(found, null);
    });
  });

  describe('getAllClaimedPrompts', () => {
    test('returns all prompts', async () => {
      await repo.saveClaimedPrompt(createTestClaimedPrompt({ id: 'prompt-1' }));
      await repo.saveClaimedPrompt(createTestClaimedPrompt({ id: 'prompt-2' }));
      await repo.saveClaimedPrompt(createTestClaimedPrompt({ id: 'prompt-3' }));

      const all = await repo.getAllClaimedPrompts();

      assert.strictEqual(all.length, 3);
      const ids = all.map(p => p.id).sort();
      assert.deepStrictEqual(ids, ['prompt-1', 'prompt-2', 'prompt-3']);
    });

    test('returns empty array when no prompts', async () => {
      const all = await repo.getAllClaimedPrompts();
      assert.strictEqual(all.length, 0);
    });
  });

  describe('deleteClaimedPrompt', () => {
    test('removes prompt and returns true', async () => {
      const prompt = createTestClaimedPrompt({ id: 'to-delete' });
      await repo.saveClaimedPrompt(prompt);

      const deleted = await repo.deleteClaimedPrompt('to-delete');

      assert.strictEqual(deleted, true);

      const found = await repo.getClaimedPrompt('to-delete');
      assert.strictEqual(found, null);
    });

    test('returns false for non-existent ID', async () => {
      const deleted = await repo.deleteClaimedPrompt('not-found');
      assert.strictEqual(deleted, false);
    });
  });

  describe('field preservation', () => {
    test('preserves all prompt fields', async () => {
      const prompt = createTestClaimedPrompt({
        id: 'full-prompt',
        prompt: 'Detailed prompt text here',
        promptName: 'Full Task Name',
        issueId: 'issue-abc',
        issueIdentifier: 'ENG-456',
        issueTitle: 'Important Issue',
        issueUrl: 'https://linear.app/team/issue/ENG-456',
        workspaceUrlKey: 'production-workspace',
        claimedAt: '2024-06-15T14:30:00Z'
      });

      await repo.saveClaimedPrompt(prompt);
      const found = await repo.getClaimedPrompt('full-prompt');

      assert.strictEqual(found?.prompt, 'Detailed prompt text here');
      assert.strictEqual(found?.promptName, 'Full Task Name');
      assert.strictEqual(found?.issueId, 'issue-abc');
      assert.strictEqual(found?.issueIdentifier, 'ENG-456');
      assert.strictEqual(found?.issueTitle, 'Important Issue');
      assert.strictEqual(found?.issueUrl, 'https://linear.app/team/issue/ENG-456');
      assert.strictEqual(found?.workspaceUrlKey, 'production-workspace');
      assert.strictEqual(found?.claimedAt, '2024-06-15T14:30:00Z');
    });
  });
});
