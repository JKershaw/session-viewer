/**
 * Main entry point for the Session Analyzer frontend.
 */
import { store, setFilterOptions, setView } from './state/store.js';
import { api } from './api/client.js';
import { initHeader } from './components/header.js';
import { initNavigation } from './components/navigation.js';
import { initFilters, extractFilterOptions } from './components/filters.js';
import { initTimeline } from './components/timeline.js';
import { initTrustDashboard } from './components/trust-dashboard.js';
import { initDispatch } from './components/dispatch.js';
import { initDetailPanel } from './components/detail-panel.js';
import { initFooter } from './components/footer.js';
import { initTooltip } from './components/tooltip.js';
import { initNotifications } from './components/notifications.js';
import { $ } from './utils/dom.js';

/**
 * Check if element has server-rendered content (EJS).
 * Elements with content from EJS won't need JS initialization.
 * Checks for child elements OR meaningful text content.
 */
const hasServerContent = (el) => {
  if (!el) return false;
  // Check for child elements or text content (excluding whitespace)
  return el.children.length > 0 || (el.textContent?.trim().length ?? 0) > 0;
};

/**
 * Initialize the application.
 */
const init = async () => {
  // Sync view state from URL query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const viewParam = urlParams.get('view');
  const VALID_VIEWS = ['timeline', 'trust-dashboard', 'dispatch'];
  if (viewParam && VALID_VIEWS.includes(viewParam)) {
    console.log('[Main] Setting initial view from URL:', viewParam);
    setView(viewParam);
  }

  // Initialize tooltip (global)
  initTooltip();

  // Initialize notifications
  const notificationsEl = $('notifications');
  if (notificationsEl) initNotifications(notificationsEl);

  // Get component containers
  const headerEl = $('header');
  const navigationEl = $('navigation');
  const filtersEl = $('filters');
  const timelineEl = $('timeline');
  const trustDashboardEl = $('trust-dashboard');
  const dispatchEl = $('dispatch');
  const detailPanelEl = $('detail-panel');
  const footerEl = $('footer');

  // Initialize components
  // Header always needs JS for button handlers (it re-renders itself)
  if (headerEl) initHeader(headerEl);
  // Nav, filters, footer: skip if EJS rendered them (they work without JS)
  if (navigationEl && !hasServerContent(navigationEl)) initNavigation(navigationEl);
  if (filtersEl && !hasServerContent(filtersEl)) initFilters(filtersEl);
  if (footerEl && !hasServerContent(footerEl)) initFooter(footerEl);

  // Timeline, detail panel, trust dashboard, dispatch: always init (they need JS interactivity)
  if (timelineEl) initTimeline(timelineEl);
  if (trustDashboardEl) initTrustDashboard(trustDashboardEl);
  if (dispatchEl) initDispatch(dispatchEl);
  if (detailPanelEl) initDetailPanel(detailPanelEl);

  // Load initial filter options
  await loadFilterOptions();

  // Subscribe to session changes to update filter options
  store.subscribe((state, prevState) => {
    if (state.sessions !== prevState.sessions && state.sessions.length > 0) {
      const options = extractFilterOptions(state.sessions);
      setFilterOptions(options);
    }
  });

  // Subscribe to view changes for navigation
  store.subscribe((state, prevState) => {
    if (state.view !== prevState.view) {
      // Hide all view content
      document.querySelectorAll('.view-content').forEach(el => {
        el.classList.add('hidden');
      });

      // Show active view
      const activeViewEl = $(state.view);
      if (activeViewEl) {
        activeViewEl.classList.remove('hidden');
      }

      // Show/hide filters based on view
      const filtersContainer = $('filters');
      if (filtersContainer) {
        if (state.view === 'timeline') {
          filtersContainer.classList.remove('hidden');
        } else {
          filtersContainer.classList.add('hidden');
        }
      }
    }
  });
};

/**
 * Load filter options from tickets endpoint.
 */
const loadFilterOptions = async () => {
  try {
    const tickets = await api.getTickets();
    setFilterOptions({ tickets });
  } catch (err) {
    console.error('Failed to load filter options:', err);
  }
};

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
