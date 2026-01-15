/**
 * Area Chart Component - Horizontal bar chart showing trust by codebase area.
 */
import { store, setFilters, setView } from '../../state/store.js';
import { div, span, h3 } from '../../utils/dom.js';

const getTrustColorClass = (score) => {
  if (score >= 0.7) return 'trust-high';
  if (score >= 0.4) return 'trust-medium';
  return 'trust-low';
};

const createAreaBar = (aggregate, onClick) => {
  const autonomousPercent = Math.round(aggregate.autonomousRate * 100);
  const colorClass = getTrustColorClass(aggregate.autonomousRate);

  const bar = div(
    {
      className: 'area-bar',
      role: 'button',
      tabindex: '0',
      'aria-label': `${aggregate.category}: ${autonomousPercent}% autonomous rate, ${aggregate.totalSessions} sessions`,
      onClick: () => onClick(aggregate),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(aggregate);
        }
      }
    },
    [
      div({ className: 'area-bar-name', title: aggregate.category }, aggregate.category),
      div({ className: 'area-bar-track' }, [
        div(
          {
            className: `area-bar-fill ${colorClass}`,
            style: `width: ${autonomousPercent}%`
          },
          autonomousPercent > 15 ? `${autonomousPercent}%` : ''
        )
      ]),
      div({ className: 'area-bar-sessions' }, `${aggregate.totalSessions} sessions`),
      div(
        { className: `area-bar-confidence ${aggregate.confidence >= 0.7 ? '' : 'low'}` },
        `${Math.round(aggregate.confidence * 100)}% conf`
      )
    ]
  );

  return bar;
};

export const initAreaChart = (container) => {
  const handleAreaClick = (aggregate) => {
    // Filter timeline by this area and switch to timeline view
    setFilters({ folder: aggregate.category });
    setView('timeline');
  };

  const render = () => {
    const state = store.getState();
    const { trust } = state;

    if (!trust.map?.byArea || trust.map.byArea.length === 0) {
      container.innerHTML = '';
      container.appendChild(
        div({ className: 'trust-chart-empty' }, [
          h3({ className: 'trust-chart-title' }, 'Trust by Codebase Area'),
          div({ className: 'trust-chart-empty-text' }, 'No area data available')
        ])
      );
      return;
    }

    // Sort by session count (most sessions first)
    const sortedAreas = [...trust.map.byArea]
      .sort((a, b) => b.totalSessions - a.totalSessions)
      .slice(0, 15); // Limit to top 15

    const title = h3({ className: 'trust-chart-title' }, 'Trust by Codebase Area');
    const subtitle = div(
      { className: 'trust-chart-subtitle' },
      'Click an area to filter sessions'
    );

    const bars = sortedAreas.map(area => createAreaBar(area, handleAreaClick));
    const barContainer = div({ className: 'area-bar-container' }, bars);

    container.innerHTML = '';
    container.appendChild(title);
    container.appendChild(subtitle);
    container.appendChild(barContainer);
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
