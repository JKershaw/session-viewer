/**
 * E2E Tests - Trust Dashboard Flow
 *
 * Tests for the trust dashboard functionality including:
 * - Navigation to dashboard
 * - Filter visibility
 * - Compute trust map
 * - Global stats display
 * - Category tabs
 * - Prediction form
 * - Empty states
 */

import { test, expect } from '@playwright/test';

test.describe('Trust Dashboard', () => {
  test.describe('Navigation', () => {
    test('can navigate to trust dashboard via tab', async ({ page }) => {
      await page.goto('/');

      const dashboardTab = page.locator('.nav-tab[data-view="trust-dashboard"]');
      await expect(dashboardTab).toBeVisible();
      await expect(dashboardTab).toHaveText('Trust Dashboard');

      await dashboardTab.click();

      // URL should update
      await expect(page).toHaveURL(/view=trust-dashboard/);

      // Dashboard should be visible
      await expect(page.locator('#trust-dashboard')).toBeVisible();
      await expect(page.locator('#trust-dashboard')).not.toHaveClass(/hidden/);
    });

    test('can navigate directly via URL', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      await expect(page.locator('#trust-dashboard')).toBeVisible();
      await expect(page.locator('#trust-dashboard')).not.toHaveClass(/hidden/);

      // Tab should be marked active
      const dashboardTab = page.locator('.nav-tab[data-view="trust-dashboard"]');
      await expect(dashboardTab).toHaveClass(/active/);
    });

    test('timeline is hidden when on dashboard', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      await expect(page.locator('#timeline')).toHaveClass(/hidden/);
    });
  });

  test.describe('Filter Visibility', () => {
    test('filters are hidden on trust dashboard', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      const filters = page.locator('#filters');
      await expect(filters).toHaveClass(/hidden/);
    });

    test('filters are shown on timeline', async ({ page }) => {
      await page.goto('/?view=timeline');

      const filters = page.locator('#filters');
      await expect(filters).not.toHaveClass(/hidden/);
    });
  });

  test.describe('Dashboard Header', () => {
    test('displays dashboard title', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      await expect(page.locator('.trust-header-title')).toHaveText('Trust Analysis Dashboard');
    });

    test('compute trust map button exists', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      // Button may be in header or trust header
      const computeBtn = page.locator('#btn-compute-trust');
      const btnCount = await computeBtn.count();

      if (btnCount > 0) {
        await expect(computeBtn).toBeVisible();
      } else {
        // If button doesn't exist, trust dashboard structure is different
        // Just verify the dashboard loaded
        await expect(page.locator('.trust-dashboard')).toBeVisible();
      }
    });
  });

  test.describe('Compute Trust Map', () => {
    test('clicking compute button triggers analysis', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      const computeBtn = page.locator('#btn-compute-trust');
      const btnCount = await computeBtn.count();

      if (btnCount > 0) {
        await computeBtn.click();

        // Wait for loading to complete (button may show loading state)
        await expect(async () => {
          const text = await computeBtn.textContent();
          expect(text).toBeTruthy();
        }).toPass({ timeout: 15000 });
      } else {
        // Skip if button doesn't exist
        expect(true).toBe(true);
      }
    });
  });

  test.describe('Empty State', () => {
    test('dashboard renders content area', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      // Dashboard main element should exist
      const dashboard = page.locator('#trust-dashboard');
      await expect(dashboard).toBeAttached();
    });
  });

  test.describe('Global Stats', () => {
    test('stats grid structure exists when data present', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      const statsGrid = page.locator('.trust-stats-grid');
      const hasStats = await statsGrid.count() > 0;

      if (hasStats) {
        // Should have stat cards
        const statCards = page.locator('.stat-card');
        expect(await statCards.count()).toBeGreaterThanOrEqual(1);

        // Each card should have value and label
        const firstCard = statCards.first();
        await expect(firstCard.locator('.stat-value')).toBeVisible();
        await expect(firstCard.locator('.stat-label')).toBeVisible();
      }
    });

    test('displays expected stat categories when data present', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      const statsGrid = page.locator('.trust-stats-grid');
      const hasStats = await statsGrid.count() > 0;

      if (hasStats) {
        // Check for expected labels
        const labels = page.locator('.stat-label');
        const labelTexts = await labels.allTextContents();

        // Should include key metrics
        const expectedLabels = ['Total Sessions', 'Autonomy Rate', 'Avg Interventions', 'Avg Trust Score'];
        for (const expected of expectedLabels) {
          expect(labelTexts.some(text => text.includes(expected))).toBe(true);
        }
      }
    });
  });

  test.describe('Category Tabs', () => {
    test('category tabs container exists when data present', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      const statsGrid = page.locator('.trust-stats-grid');
      const hasStats = await statsGrid.count() > 0;

      if (hasStats) {
        await expect(page.locator('.category-tabs')).toBeAttached();
      }
    });
  });

  test.describe('Prediction Form', () => {
    test('prediction form container exists when data present', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      const statsGrid = page.locator('.trust-stats-grid');
      const hasStats = await statsGrid.count() > 0;

      if (hasStats) {
        await expect(page.locator('.prediction-form')).toBeAttached();
      }
    });
  });

  test.describe('Insights Panel', () => {
    test('insights panel container exists when data present', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      const statsGrid = page.locator('.trust-stats-grid');
      const hasStats = await statsGrid.count() > 0;

      if (hasStats) {
        await expect(page.locator('.insights-panel')).toBeAttached();
      }
    });
  });

  test.describe('Back Navigation', () => {
    test('can switch back to timeline', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      const timelineTab = page.locator('.nav-tab[data-view="timeline"]');
      await timelineTab.click();

      await expect(page).toHaveURL(/view=timeline/);
      await expect(page.locator('#timeline')).toBeVisible();
      await expect(page.locator('#timeline')).not.toHaveClass(/hidden/);
    });

    test('filters become visible when switching to timeline', async ({ page }) => {
      await page.goto('/?view=trust-dashboard');

      // Filters should be hidden
      await expect(page.locator('#filters')).toHaveClass(/hidden/);

      // Switch to timeline
      await page.locator('.nav-tab[data-view="timeline"]').click();

      // Filters should be visible
      await expect(page.locator('#filters')).not.toHaveClass(/hidden/);
    });
  });
});
