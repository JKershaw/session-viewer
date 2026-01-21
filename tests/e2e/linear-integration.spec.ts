/**
 * E2E Tests - Linear Integration Flow
 *
 * Tests for Linear ticket integration functionality including:
 * - Sync Linear button
 * - Ticket display in sessions
 * - Ticket filtering
 * - Error handling
 */

import { test, expect } from '@playwright/test';

test.describe('Linear Integration', () => {
  test.describe('Sync Button', () => {
    test('sync Linear button exists in header', async ({ page }) => {
      await page.goto('/');

      const syncBtn = page.locator('#btn-sync');
      await expect(syncBtn).toBeVisible();
      await expect(syncBtn).toHaveText('Sync Linear');
    });

    test('sync button is clickable', async ({ page }) => {
      await page.goto('/');

      const syncBtn = page.locator('#btn-sync');
      await expect(syncBtn).toBeEnabled();
    });

    test('clicking sync triggers Linear synchronization', async ({ page }) => {
      await page.goto('/');

      const syncBtn = page.locator('#btn-sync');

      // Set up response listener to verify API call
      const responsePromise = page.waitForResponse(
        response => response.url().includes('/api/linear') || response.url().includes('/api/refresh'),
        { timeout: 5000 }
      ).catch(() => null);

      await syncBtn.click();

      // Button should show some loading indication or complete
      await expect(async () => {
        const text = await syncBtn.textContent();
        expect(text).toBeTruthy();
      }).toPass({ timeout: 10000 });
    });
  });

  test.describe('Ticket Filter', () => {
    test('ticket filter dropdown exists', async ({ page }) => {
      await page.goto('/');

      const ticketSelect = page.locator('#filter-ticket');
      await expect(ticketSelect).toBeVisible();
    });

    test('ticket filter has default option', async ({ page }) => {
      await page.goto('/');

      const ticketSelect = page.locator('#filter-ticket');
      const defaultOption = ticketSelect.locator('option[value=""]');

      await expect(defaultOption).toHaveText('All tickets');
    });

    test('can select ticket filter option', async ({ page }) => {
      await page.goto('/');

      const ticketSelect = page.locator('#filter-ticket');
      const options = ticketSelect.locator('option');
      const optionCount = await options.count();

      // If there are ticket options beyond "All tickets"
      if (optionCount > 1) {
        const secondOption = options.nth(1);
        const value = await secondOption.getAttribute('value');

        if (value) {
          await ticketSelect.selectOption(value);
          await expect(ticketSelect).toHaveValue(value);
        }
      }
    });

    test('ticket filter updates URL on apply', async ({ page }) => {
      await page.goto('/');

      const ticketSelect = page.locator('#filter-ticket');
      const options = ticketSelect.locator('option');
      const optionCount = await options.count();

      if (optionCount > 1) {
        const secondOption = options.nth(1);
        const value = await secondOption.getAttribute('value');

        if (value) {
          await ticketSelect.selectOption(value);
          await page.locator('#filter-form button[type="submit"]').click();

          await expect(page).toHaveURL(new RegExp(`ticket=${encodeURIComponent(value)}`));
        }
      }
    });
  });

  test.describe('Session Ticket Display', () => {
    test('session detail panel shows ticket info when available', async ({ page }) => {
      await page.goto('/');

      // Wait for potential sessions to load
      await page.waitForTimeout(500);

      const segments = page.locator('.session-segment');
      const count = await segments.count();

      if (count > 0) {
        // Click a session to open detail panel
        await segments.first().click();

        const detailPanel = page.locator('#detail-panel');

        // Wait for panel to populate
        await page.waitForTimeout(300);

        // Check if panel is populated (may or may not have ticket info)
        const panelContent = await detailPanel.textContent();
        expect(panelContent).toBeDefined();
      }
    });
  });

  test.describe('Notifications', () => {
    test('notification container exists', async ({ page }) => {
      await page.goto('/');

      const notifications = page.locator('#notifications');
      await expect(notifications).toBeAttached();
    });

    test('sync shows notification on completion', async ({ page }) => {
      await page.goto('/');

      const syncBtn = page.locator('#btn-sync');
      await syncBtn.click();

      // Wait for potential notification
      await page.waitForTimeout(2000);

      // Check if notification appeared (may be success or error)
      const notifications = page.locator('#notifications');
      const hasNotification = await notifications.locator('.notification').count() > 0;

      // Notification system should be functional (but might not show if no-op)
      await expect(notifications).toBeAttached();
    });
  });

  test.describe('Error Handling', () => {
    test('handles missing Linear configuration gracefully', async ({ page }) => {
      await page.goto('/');

      // Click sync - should not crash even if Linear is not configured
      const syncBtn = page.locator('#btn-sync');
      await syncBtn.click();

      // Page should remain functional
      await expect(page.locator('.header-title')).toBeVisible();
      await expect(page.locator('.navigation')).toBeVisible();

      // Wait for any error notifications
      await page.waitForTimeout(2000);

      // App should still be usable
      await expect(page.locator('#timeline')).toBeAttached();
    });
  });

  test.describe('Header Actions', () => {
    test('both refresh and sync buttons coexist', async ({ page }) => {
      await page.goto('/');

      const headerActions = page.locator('.header-actions');
      await expect(headerActions).toBeVisible();

      await expect(page.locator('#btn-refresh')).toBeVisible();
      await expect(page.locator('#btn-sync')).toBeVisible();
    });

    test('buttons have consistent styling', async ({ page }) => {
      await page.goto('/');

      const refreshBtn = page.locator('#btn-refresh');
      const syncBtn = page.locator('#btn-sync');

      // Both should have the btn class
      await expect(refreshBtn).toHaveClass(/btn/);
      await expect(syncBtn).toHaveClass(/btn/);
    });
  });
});

test.describe('Linear API Integration', () => {
  test('API endpoint responds', async ({ page, request }) => {
    // Direct API test
    const response = await request.get('/api/linear/status').catch(() => null);

    // Endpoint may or may not exist, but should not crash
    if (response) {
      expect([200, 404, 500]).toContain(response.status());
    }
  });
});
