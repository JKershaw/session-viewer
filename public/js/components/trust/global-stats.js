/**
 * Global Stats Component - Displays summary metric cards.
 */
import { store } from '../../state/store.js';
import { div, span } from '../../utils/dom.js';

const getTrustColorClass = (score) => {
  if (score >= 0.7) return 'trust-high';
  if (score >= 0.4) return 'trust-medium';
  return 'trust-low';
};

const createStatCard = (label, value, subtext, colorClass = '', barPercent = null) => {
  const cardContent = [
    div({ className: 'stat-card-label' }, label),
    div({ className: `stat-card-value ${colorClass}` }, value)
  ];

  if (barPercent !== null) {
    cardContent.push(
      div({ className: 'stat-card-bar' }, [
        div({
          className: `stat-card-bar-fill ${colorClass}`,
          style: `width: ${Math.min(100, Math.max(0, barPercent))}%`
        })
      ])
    );
  }

  if (subtext) {
    cardContent.push(div({ className: 'stat-card-subtext' }, subtext));
  }

  return div({ className: 'stat-card' }, cardContent);
};

export const initGlobalStats = (container) => {
  const render = () => {
    const state = store.getState();
    const { trust } = state;

    if (!trust.map?.global) {
      container.innerHTML = '';
      return;
    }

    const global = trust.map.global;

    // Calculate stats
    const totalSessions = global.totalSessions || 0;
    const autonomousRate = global.autonomousRate || 0;
    const avgTrustScore = global.avgTrustScore || 0;
    const avgInterventions = global.avgInterventionCount || 0;

    // Create stat cards
    const cards = [
      createStatCard(
        'Total Sessions',
        totalSessions.toLocaleString(),
        'Sessions analyzed',
        '',
        null
      ),
      createStatCard(
        'Autonomous Rate',
        `${Math.round(autonomousRate * 100)}%`,
        'Sessions with 0-1 interventions',
        getTrustColorClass(autonomousRate),
        autonomousRate * 100
      ),
      createStatCard(
        'Average Trust Score',
        `${Math.round(avgTrustScore * 100)}%`,
        'Overall trust level',
        getTrustColorClass(avgTrustScore),
        avgTrustScore * 100
      ),
      createStatCard(
        'Avg Interventions',
        avgInterventions.toFixed(1),
        'Per session',
        avgInterventions <= 1 ? 'trust-high' : avgInterventions <= 3 ? 'trust-medium' : 'trust-low',
        Math.max(0, 100 - avgInterventions * 20)
      )
    ];

    const grid = div({ className: 'trust-stats-grid' }, cards);

    container.innerHTML = '';
    container.appendChild(grid);
  };

  // Subscribe to trust map changes
  store.subscribe((state, prevState) => {
    if (state.trust.map !== prevState.trust.map) {
      render();
    }
  });

  // Initial render
  render();
};
