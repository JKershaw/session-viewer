/**
 * Main entry point for the Session Analyzer frontend.
 */
import { store, setFilterOptions } from './state/store.js';
import { api } from './api/client.js';
import { initHeader } from './components/header.js';
import { initFilters, extractFilterOptions } from './components/filters.js';
import { initTimeline } from './components/timeline.js';
import { initDetailPanel } from './components/detail-panel.js';
import { initFooter } from './components/footer.js';
import { initTooltip } from './components/tooltip.js';
import { $ } from './utils/dom.js';

/**
 * Initialize the application.
 */
const init = async () => {
  // Initialize tooltip (global)
  initTooltip();

  // Initialize components
  const headerEl = $('header');
  const filtersEl = $('filters');
  const timelineEl = $('timeline');
  const detailPanelEl = $('detail-panel');
  const footerEl = $('footer');

  if (headerEl) initHeader(headerEl);
  if (filtersEl) initFilters(filtersEl);
  if (timelineEl) initTimeline(timelineEl);
  if (detailPanelEl) initDetailPanel(detailPanelEl);
  if (footerEl) initFooter(footerEl);

  // Load initial filter options
  await loadFilterOptions();

  // Subscribe to session changes to update filter options
  store.subscribe((state, prevState) => {
    if (state.sessions !== prevState.sessions && state.sessions.length > 0) {
      const options = extractFilterOptions(state.sessions);
      setFilterOptions(options);
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
