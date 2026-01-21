import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { createDispatchSettingsRepository, type DispatchSettingsRepository } from '../../../src/db/dispatch-settings.js';
import { closeClient } from '../../../src/db/client.js';

const TEST_DATA_DIR = './test-data-dispatch-settings-db';

describe('DispatchSettingsRepository', () => {
  let repo: DispatchSettingsRepository;

  beforeEach(async () => {
    repo = createDispatchSettingsRepository(TEST_DATA_DIR, 'test-dispatch-settings');
  });

  afterEach(async () => {
    await closeClient();
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  describe('getSettings', () => {
    test('returns defaults when no settings exist', async () => {
      const settings = await repo.getSettings();

      assert.strictEqual(settings.enabled, false);
      assert.strictEqual(settings.pollingIntervalMs, 30000);
      assert.strictEqual(settings.maxClaimsPerPoll, 1);
      assert.strictEqual(settings.lastPollAt, null);
      assert.strictEqual(settings.lastClaimAt, null);
      assert.strictEqual(settings.lastError, null);
      assert.strictEqual(settings.totalClaimedCount, 0);
    });

    test('returns saved settings', async () => {
      await repo.updateSettings({ enabled: true, pollingIntervalMs: 60000 });

      const settings = await repo.getSettings();

      assert.strictEqual(settings.enabled, true);
      assert.strictEqual(settings.pollingIntervalMs, 60000);
    });
  });

  describe('updateSettings', () => {
    test('preserves unmodified fields', async () => {
      await repo.updateSettings({ enabled: true });
      await repo.updateSettings({ pollingIntervalMs: 45000 });

      const settings = await repo.getSettings();

      assert.strictEqual(settings.enabled, true);
      assert.strictEqual(settings.pollingIntervalMs, 45000);
      assert.strictEqual(settings.maxClaimsPerPoll, 1);
    });

    test('returns updated settings', async () => {
      const result = await repo.updateSettings({ enabled: true, maxClaimsPerPoll: 5 });

      assert.strictEqual(result.enabled, true);
      assert.strictEqual(result.maxClaimsPerPoll, 5);
    });

    test('updates existing settings', async () => {
      await repo.updateSettings({ enabled: true });
      await repo.updateSettings({ enabled: false });

      const settings = await repo.getSettings();
      assert.strictEqual(settings.enabled, false);
    });
  });

  describe('recordPoll', () => {
    test('updates lastPollAt timestamp', async () => {
      const before = new Date().toISOString();
      await repo.recordPoll();
      const after = new Date().toISOString();

      const settings = await repo.getSettings();

      assert.ok(settings.lastPollAt);
      assert.ok(settings.lastPollAt >= before);
      assert.ok(settings.lastPollAt <= after);
    });

    test('clears lastError on successful poll', async () => {
      await repo.recordPoll('Some error');
      await repo.recordPoll();

      const settings = await repo.getSettings();

      assert.strictEqual(settings.lastError, null);
    });

    test('records error when provided', async () => {
      await repo.recordPoll('Connection failed');

      const settings = await repo.getSettings();

      assert.strictEqual(settings.lastError, 'Connection failed');
    });

    test('creates settings if none exist', async () => {
      await repo.recordPoll();

      const settings = await repo.getSettings();

      assert.ok(settings.lastPollAt);
      assert.strictEqual(settings.enabled, false);
    });
  });

  describe('recordClaim', () => {
    test('increments totalClaimedCount', async () => {
      await repo.recordClaim();
      await repo.recordClaim();
      await repo.recordClaim();

      const settings = await repo.getSettings();

      assert.strictEqual(settings.totalClaimedCount, 3);
    });

    test('updates lastClaimAt timestamp', async () => {
      const before = new Date().toISOString();
      await repo.recordClaim();
      const after = new Date().toISOString();

      const settings = await repo.getSettings();

      assert.ok(settings.lastClaimAt);
      assert.ok(settings.lastClaimAt >= before);
      assert.ok(settings.lastClaimAt <= after);
    });

    test('creates settings if none exist', async () => {
      await repo.recordClaim();

      const settings = await repo.getSettings();

      assert.ok(settings.lastClaimAt);
      assert.strictEqual(settings.totalClaimedCount, 1);
      assert.strictEqual(settings.enabled, false);
    });
  });
});
