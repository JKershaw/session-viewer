/**
 * Trust Dashboard - Main orchestrating component.
 * Displays aggregated trust analysis data across all sessions.
 */
import {
  store,
  setTrustMap,
  setTrustInsights,
  setTrustAreas,
  setTrustLoading,
  setTrustError
} from '../state/store.js';
import { api } from '../api/client.js';
import { div, button, h2, span } from '../utils/dom.js';
import { initGlobalStats } from './trust/global-stats.js';
import { initAreaChart } from './trust/area-chart.js';
import { initInsightsPanel } from './trust/insights-panel.js';
import { initCategoryTabs } from './trust/category-tabs.js';
import { initPredictionForm } from './trust/prediction-form.js';

let initialized = false;
let computing = false;

const createSpinner = () => div({ className: 'spinner' });

export const initTrustDashboard = (container) => {
  // Sub-component containers
  let globalStatsEl = null;
  let areaChartEl = null;
  let insightsPanelEl = null;
  let categoryTabsEl = null;
  let predictionFormEl = null;

  const render = () => {
    const state = store.getState();
    const { trust } = state;

    // Header with title and compute button
    const computeBtn = button(
      {
        className: 'btn btn-primary',
        onClick: handleCompute,
        disabled: computing || trust.loading ? 'disabled' : null
      },
      computing || trust.loading
        ? [createSpinner(), 'Computing...']
        : 'Compute Trust Map'
    );

    const lastComputed = trust.lastComputed
      ? span(
          { className: 'trust-last-computed' },
          `Last computed: ${new Date(trust.lastComputed).toLocaleString()}`
        )
      : null;

    const header = div({ className: 'trust-header' }, [
      div({ className: 'trust-header-left' }, [
        h2({ className: 'trust-header-title' }, 'Trust Analysis Dashboard'),
        lastComputed
      ]),
      div({ className: 'trust-header-actions' }, [computeBtn])
    ]);

    // Error display
    const errorDisplay = trust.error
      ? div({ className: 'trust-error' }, [
          span({}, `Error: ${trust.error}`),
          button(
            { className: 'btn', onClick: loadTrustData, style: 'margin-left: 12px' },
            'Retry'
          )
        ])
      : null;

    // Loading state
    if (trust.loading && !trust.map) {
      container.innerHTML = '';
      container.appendChild(header);
      if (errorDisplay) container.appendChild(errorDisplay);
      container.appendChild(
        div({ className: 'trust-loading' }, [
          createSpinner(),
          span({ style: 'margin-top: 12px' }, 'Loading trust analysis data...')
        ])
      );
      return;
    }

    // Empty state
    if (!trust.map && !trust.loading) {
      container.innerHTML = '';
      container.appendChild(header);
      if (errorDisplay) container.appendChild(errorDisplay);
      container.appendChild(
        div({ className: 'trust-empty' }, [
          div({ className: 'trust-empty-icon' }, '📊'),
          div({ className: 'trust-empty-title' }, 'No Trust Data Available'),
          div(
            { className: 'trust-empty-text' },
            'Click "Compute Trust Map" to analyze all sessions and build the trust database.'
          )
        ])
      );
      return;
    }

    // Global stats section
    globalStatsEl = div({ className: 'trust-stats-section', id: 'trust-global-stats' });

    // Main content grid (area chart + insights)
    areaChartEl = div({ className: 'trust-chart-container', id: 'trust-area-chart' });
    insightsPanelEl = div({ className: 'insights-panel', id: 'trust-insights-panel' });

    const contentGrid = div({ className: 'trust-content-grid' }, [
      areaChartEl,
      insightsPanelEl
    ]);

    // Category tabs section
    categoryTabsEl = div({ className: 'category-tabs', id: 'trust-category-tabs' });

    // Prediction form section
    predictionFormEl = div({ className: 'prediction-form', id: 'trust-prediction-form' });

    // Assemble the dashboard
    container.innerHTML = '';
    container.appendChild(header);
    if (errorDisplay) container.appendChild(errorDisplay);
    container.appendChild(globalStatsEl);
    container.appendChild(contentGrid);
    container.appendChild(categoryTabsEl);
    container.appendChild(predictionFormEl);

    // Initialize sub-components
    initGlobalStats(globalStatsEl);
    initAreaChart(areaChartEl);
    initInsightsPanel(insightsPanelEl);
    initCategoryTabs(categoryTabsEl);
    initPredictionForm(predictionFormEl);
  };

  const loadTrustData = async () => {
    setTrustLoading(true);
    setTrustError(null);

    try {
      const [mapResult, insightsResult, areasResult] = await Promise.all([
        api.getTrustMap().catch(() => null),
        api.getTrustInsights().catch(() => ({ insights: [] })),
        api.getTrustByArea().catch(() => ({ areas: [] }))
      ]);

      if (mapResult) {
        setTrustMap(mapResult);
      }
      setTrustInsights(insightsResult?.insights || []);
      setTrustAreas(areasResult?.areas || []);
    } catch (err) {
      setTrustError(err.message);
    } finally {
      setTrustLoading(false);
    }
  };

  const handleCompute = async () => {
    if (computing) return;

    computing = true;
    setTrustLoading(true);
    setTrustError(null);
    render();

    try {
      const result = await api.computeTrustMap();
      if (result.trustMap) {
        setTrustMap(result.trustMap);
      }
      // Reload insights and areas after compute
      const [insightsResult, areasResult] = await Promise.all([
        api.getTrustInsights().catch(() => ({ insights: [] })),
        api.getTrustByArea().catch(() => ({ areas: [] }))
      ]);
      setTrustInsights(insightsResult?.insights || []);
      setTrustAreas(areasResult?.areas || []);
    } catch (err) {
      setTrustError(err.message);
    } finally {
      computing = false;
      setTrustLoading(false);
      render();
    }
  };

  // Subscribe to view changes - load data when dashboard becomes visible
  store.subscribe((state, prevState) => {
    if (state.view === 'trust-dashboard' && prevState.view !== 'trust-dashboard') {
      if (!initialized) {
        initialized = true;
        loadTrustData();
      }
      render();
    }
  });

  // Subscribe to trust state changes
  store.subscribe((state, prevState) => {
    if (state.view === 'trust-dashboard' && state.trust !== prevState.trust) {
      render();
    }
  });

  // Initial render (hidden by default)
  render();
};
