/**
 * E2E Tests - Application Smoke Tests
 *
 * Basic tests to verify the app loads and core elements are present.
 * More comprehensive tests will be added in LIN-134, LIN-135, LIN-136.
 */

import { test, expect } from '@playwright/test';

test.describe('Application', () => {
  test('loads the homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Claude Code Session Analyzer');
  });

  test('displays main layout elements', async ({ page }) => {
    await page.goto('/');

    // Header
    await expect(page.locator('.header-title')).toBeVisible();

    // Navigation
    await expect(page.locator('.navigation')).toBeVisible();

    // Timeline area
    await expect(page.locator('.timeline')).toBeVisible();
  });
});
