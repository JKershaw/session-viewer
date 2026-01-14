import { test, expect } from '@playwright/test';

test.describe('Session Viewer App', () => {
  test('loads the homepage and displays title', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Claude Code Session Analyzer');
    await expect(page.locator('.header-title')).toContainText('Claude Code Session Analyzer');
  });

  test('displays header with action buttons', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.header-actions')).toBeVisible();
    await expect(page.locator('button:has-text("Refresh Logs")')).toBeVisible();
    await expect(page.locator('button:has-text("Sync Linear")')).toBeVisible();
  });

  test('displays filter controls', async ({ page }) => {
    await page.goto('/');

    // Wait for filters to render
    await expect(page.locator('.filters')).toBeVisible();

    // Check for filter groups (From, To, Folder, Branch, Ticket, Zoom)
    await expect(page.locator('.filter-group')).toHaveCount(6);
  });

  test('displays timeline structure', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.timeline')).toBeVisible();
    await expect(page.locator('.timeline-axis')).toBeVisible();
    await expect(page.locator('.timeline-area')).toBeVisible();
  });

  test('displays detail panel element', async ({ page }) => {
    await page.goto('/');

    // Detail panel element exists but is not open
    const detailPanel = page.locator('.detail-panel');
    await expect(detailPanel).toBeAttached();
    await expect(detailPanel).not.toHaveClass(/open/);
  });

  test('clear filters button exists', async ({ page }) => {
    await page.goto('/');

    const clearBtn = page.locator('button:has-text("Clear Filters")');
    await expect(clearBtn).toBeVisible();
  });

  test('refresh button loads sessions without crashing', async ({ page }) => {
    await page.goto('/');

    const refreshBtn = page.locator('button:has-text("Refresh")');
    await refreshBtn.click();

    // Wait for button to show loading state then return to normal
    await expect(refreshBtn).toContainText('Refreshing', { timeout: 5000 });
    await expect(refreshBtn).toContainText('Refresh Logs', { timeout: 120000 });

    // Timeline should still be visible (server didn't crash)
    await expect(page.locator('.timeline-area')).toBeVisible();
  });
});
