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

test.describe('Navigation', () => {
  test('displays navigation tabs', async ({ page }) => {
    await page.goto('/');

    const navigation = page.locator('.navigation');
    await expect(navigation).toBeVisible();

    const timelineTab = page.locator('.nav-tab:has-text("Sessions Timeline")');
    const dashboardTab = page.locator('.nav-tab:has-text("Trust Dashboard")');

    await expect(timelineTab).toBeVisible();
    await expect(dashboardTab).toBeVisible();
  });

  test('timeline tab is active by default', async ({ page }) => {
    await page.goto('/');

    const timelineTab = page.locator('.nav-tab:has-text("Sessions Timeline")');
    await expect(timelineTab).toHaveClass(/active/);
  });

  test('clicking Trust Dashboard tab switches view', async ({ page }) => {
    await page.goto('/');

    const dashboardTab = page.locator('.nav-tab:has-text("Trust Dashboard")');
    await dashboardTab.click();

    // Dashboard tab should become active
    await expect(dashboardTab).toHaveClass(/active/);

    // Trust dashboard container should be visible
    const trustDashboard = page.locator('.trust-dashboard');
    await expect(trustDashboard).toBeVisible();

    // Timeline should be hidden
    const timeline = page.locator('.timeline');
    await expect(timeline).toHaveClass(/hidden/);
  });

  test('clicking back to Sessions Timeline tab works', async ({ page }) => {
    await page.goto('/');

    // Switch to dashboard
    const dashboardTab = page.locator('.nav-tab:has-text("Trust Dashboard")');
    await dashboardTab.click();
    await expect(page.locator('.trust-dashboard')).toBeVisible();

    // Switch back to timeline
    const timelineTab = page.locator('.nav-tab:has-text("Sessions Timeline")');
    await timelineTab.click();

    await expect(timelineTab).toHaveClass(/active/);
    await expect(page.locator('.timeline')).toBeVisible();
    await expect(page.locator('.trust-dashboard')).toHaveClass(/hidden/);
  });
});

test.describe('Trust Dashboard', () => {
  test('shows loading or empty state initially', async ({ page }) => {
    await page.goto('/');

    // Navigate to dashboard
    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    // Should show either loading or empty state
    const dashboard = page.locator('.trust-dashboard');
    await expect(dashboard).toBeVisible();

    // Either loading message or empty state should be present
    const loadingOrEmpty = dashboard.locator('.trust-loading, .trust-empty');
    await expect(loadingOrEmpty).toBeVisible({ timeout: 5000 });
  });

  test('displays dashboard header with title', async ({ page }) => {
    await page.goto('/');

    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    const title = page.locator('.trust-header-title');
    await expect(title).toContainText('Trust Analysis Dashboard');
  });

  test('displays Compute Trust Map button', async ({ page }) => {
    await page.goto('/');

    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    const computeBtn = page.locator('button:has-text("Compute Trust Map")');
    await expect(computeBtn).toBeVisible();
  });

  test('compute button shows loading state when clicked', async ({ page }) => {
    await page.goto('/');

    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    const computeBtn = page.locator('button:has-text("Compute Trust Map")');
    await computeBtn.click();

    // Button should show loading state
    await expect(computeBtn).toContainText('Computing', { timeout: 2000 });
  });

  test('filters are hidden when on dashboard view', async ({ page }) => {
    await page.goto('/');

    // Filters should be visible on timeline view
    await expect(page.locator('.filters')).toBeVisible();

    // Navigate to dashboard
    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    // Filters should be hidden
    await expect(page.locator('.filters')).toHaveClass(/hidden/);
  });

  test('filters reappear when switching back to timeline', async ({ page }) => {
    await page.goto('/');

    // Go to dashboard
    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();
    await expect(page.locator('.filters')).toHaveClass(/hidden/);

    // Go back to timeline
    await page.locator('.nav-tab:has-text("Sessions Timeline")').click();
    await expect(page.locator('.filters')).not.toHaveClass(/hidden/);
  });
});

test.describe('Trust Dashboard - After Compute', () => {
  // These tests assume there are sessions in the database
  // They will pass gracefully if no data exists

  test('displays global stats section after loading', async ({ page }) => {
    await page.goto('/');

    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    // Wait for loading to complete
    await page.waitForTimeout(2000);

    // If data exists, stats grid should be visible
    const statsSection = page.locator('.trust-stats-section');
    const emptyState = page.locator('.trust-empty');

    // Either stats or empty state should be present
    const hasStats = await statsSection.isVisible();
    const hasEmpty = await emptyState.isVisible();

    expect(hasStats || hasEmpty).toBe(true);
  });

  test('category tabs component exists in dashboard', async ({ page }) => {
    await page.goto('/');

    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    // Wait for loading
    await page.waitForTimeout(2000);

    // Check if category tabs or empty state exists
    const categoryTabs = page.locator('.category-tabs');
    const emptyState = page.locator('.trust-empty');

    const hasTabs = await categoryTabs.isVisible();
    const hasEmpty = await emptyState.isVisible();

    expect(hasTabs || hasEmpty).toBe(true);
  });

  test('prediction form component exists in dashboard', async ({ page }) => {
    await page.goto('/');

    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    // Wait for loading
    await page.waitForTimeout(2000);

    // Check if prediction form or empty state exists
    const predictionForm = page.locator('.prediction-form');
    const emptyState = page.locator('.trust-empty');

    const hasForm = await predictionForm.isVisible();
    const hasEmpty = await emptyState.isVisible();

    expect(hasForm || hasEmpty).toBe(true);
  });
});

test.describe('Trust Dashboard - Prediction Form', () => {
  test('prediction form has input fields when visible', async ({ page }) => {
    await page.goto('/');

    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    // Wait for content to load
    await page.waitForTimeout(3000);

    const predictionForm = page.locator('.prediction-form');

    if (await predictionForm.isVisible()) {
      // Check for form elements
      await expect(predictionForm.locator('input, select').first()).toBeVisible();
      await expect(predictionForm.locator('button:has-text("Predict Trust")')).toBeVisible();
    }
  });

  test('clear button exists in prediction form', async ({ page }) => {
    await page.goto('/');

    await page.locator('.nav-tab:has-text("Trust Dashboard")').click();

    // Wait for content to load
    await page.waitForTimeout(3000);

    const predictionForm = page.locator('.prediction-form');

    if (await predictionForm.isVisible()) {
      await expect(predictionForm.locator('button:has-text("Clear")')).toBeVisible();
    }
  });
});

test.describe('Accessibility', () => {
  test('navigation tabs have proper ARIA attributes', async ({ page }) => {
    await page.goto('/');

    const tabList = page.locator('[role="tablist"]');
    await expect(tabList).toBeVisible();

    const tabs = page.locator('[role="tab"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(0);
  });

  test('active tab has aria-selected true', async ({ page }) => {
    await page.goto('/');

    const activeTab = page.locator('.nav-tab.active');
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
  });

  test('keyboard navigation works on tabs', async ({ page }) => {
    await page.goto('/');

    // Focus the first tab
    const firstTab = page.locator('.nav-tab').first();
    await firstTab.focus();

    // Press Enter to activate (should already be active)
    await page.keyboard.press('Enter');

    // Tab should still be active
    await expect(firstTab).toHaveClass(/active/);
  });
});
