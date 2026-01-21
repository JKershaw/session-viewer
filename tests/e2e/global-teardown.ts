/**
 * Playwright Global Teardown
 *
 * Runs after all e2e tests complete.
 * Test data is intentionally preserved for debugging failed tests.
 * It will be cleaned on the next test run by global-setup.ts.
 */

async function globalTeardown() {
  console.log('[Teardown] E2E tests complete. Test data preserved in ./data/test/');
}

export default globalTeardown;
