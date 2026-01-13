import { test, expect } from '@playwright/test';

test.describe('Session Viewer App', () => {
  test('loads the homepage and displays title', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Claude Code Session Analyzer');
    await expect(page.locator('h1')).toContainText('Claude Code Session Analyzer');
  });

  test('shows session list view by default', async ({ page }) => {
    await page.goto('/');

    // List view should be visible
    await expect(page.locator('#list-view')).toBeVisible();
    // Gantt view should be hidden
    await expect(page.locator('#gantt-view')).toBeHidden();

    // List button should be active
    await expect(page.locator('#view-list')).toHaveClass(/active/);
  });

  test('can switch to Gantt view', async ({ page }) => {
    await page.goto('/');

    // Click Gantt button
    await page.click('#view-gantt');

    // Gantt view should now be visible
    await expect(page.locator('#gantt-view')).toBeVisible();
    await expect(page.locator('#list-view')).toBeHidden();

    // Gantt button should be active
    await expect(page.locator('#view-gantt')).toHaveClass(/active/);
  });

  test('refresh button triggers session scan', async ({ page }) => {
    await page.goto('/');

    // Click refresh
    await page.click('#refresh-btn');

    // Button should show scanning state
    await expect(page.locator('#refresh-btn')).toContainText('Scanning');

    // Wait for completion
    await expect(page.locator('#refresh-btn')).toContainText('Refresh Logs', { timeout: 10000 });
  });

  test('filter controls are present', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#filter-date-from')).toBeVisible();
    await expect(page.locator('#filter-date-to')).toBeVisible();
    await expect(page.locator('#filter-folder')).toBeVisible();
    await expect(page.locator('#filter-branch')).toBeVisible();
    await expect(page.locator('#axis-mode')).toBeVisible();
    await expect(page.locator('#group-mode')).toBeVisible();
  });

  test('takes screenshot of main interface', async ({ page }) => {
    await page.goto('/');

    // Click refresh to load sessions
    await page.click('#refresh-btn');
    await expect(page.locator('#refresh-btn')).toContainText('Refresh Logs', { timeout: 10000 });

    // Wait for any loading to complete
    await page.waitForSelector('.session-card, .empty-state', { timeout: 10000 });

    // Take full page screenshot
    await page.screenshot({
      path: 'tests/e2e/screenshots/main-interface.png',
      fullPage: true
    });
  });

  test('takes screenshot of Gantt view', async ({ page }) => {
    await page.goto('/');

    // Refresh to load sessions
    await page.click('#refresh-btn');
    await expect(page.locator('#refresh-btn')).toContainText('Refresh Logs', { timeout: 10000 });

    // Switch to Gantt view
    await page.click('#view-gantt');
    await expect(page.locator('#gantt-view')).toBeVisible();

    // Wait a bit for rendering
    await page.waitForTimeout(500);

    // Take screenshot
    await page.screenshot({
      path: 'tests/e2e/screenshots/gantt-view.png',
      fullPage: true
    });
  });

  test('takes screenshot of time mode Gantt', async ({ page }) => {
    await page.goto('/');

    // Refresh to load sessions
    await page.click('#refresh-btn');
    await expect(page.locator('#refresh-btn')).toContainText('Refresh Logs', { timeout: 10000 });

    // Switch to Gantt view
    await page.click('#view-gantt');
    await expect(page.locator('#gantt-view')).toBeVisible();

    // Switch to time mode
    await page.selectOption('#axis-mode', 'time');
    await page.waitForTimeout(500);

    // Take screenshot
    await page.screenshot({
      path: 'tests/e2e/screenshots/gantt-time-mode.png',
      fullPage: true
    });
  });

  test('detail panel opens when session clicked', async ({ page }) => {
    await page.goto('/');

    // Refresh to load sessions
    await page.click('#refresh-btn');
    await expect(page.locator('#refresh-btn')).toContainText('Refresh Logs', { timeout: 10000 });

    // Wait for sessions to load
    const sessionCard = page.locator('.session-card').first();

    // Skip if no sessions
    const count = await sessionCard.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await sessionCard.click();

    // Detail panel should open
    await expect(page.locator('#detail-panel')).toHaveClass(/open/);

    // Take screenshot of detail panel
    await page.screenshot({
      path: 'tests/e2e/screenshots/detail-panel.png',
      fullPage: true
    });
  });
});
