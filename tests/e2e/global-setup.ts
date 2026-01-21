/**
 * Playwright Global Setup
 *
 * Runs before all e2e tests to ensure a clean, isolated test environment.
 * Clears the test data directory to prevent data accumulation.
 */

import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DATA_DIR = './data/test/session-viewer';

async function globalSetup() {
  console.log('[Setup] Cleaning test data directory...');

  try {
    // Remove existing test data
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    // Directory may not exist, that's fine
  }

  // Ensure directory exists for the test run
  await mkdir(TEST_DATA_DIR, { recursive: true });

  console.log('[Setup] Test data directory ready:', join(process.cwd(), TEST_DATA_DIR));
}

export default globalSetup;
