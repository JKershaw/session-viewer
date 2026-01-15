/**
 * Insights Panel Component - Displays comparative insights.
 */
import { store } from '../../state/store.js';
import { div, span, h3 } from '../../utils/dom.js';

const getInsightType = (insight) => {
  const lowerInsight = insight.toLowerCase();
  if (lowerInsight.includes('higher') || lowerInsight.includes('better') || lowerInsight.includes('more autonomous')) {
    return 'success';
  }
  if (lowerInsight.includes('lower') || lowerInsight.includes('needs') || lowerInsight.includes('requires') || lowerInsight.includes('struggle')) {
    return 'warning';
  }
  return 'info';
};

const getInsightIcon = (type) => {
  switch (type) {
    case 'success': return '✓';
    case 'warning': return '⚠';
    default: return 'ℹ';
  }
};

const createInsightCard = (insight, index) => {
  const type = getInsightType(insight);
  const icon = getInsightIcon(type);

  return div({ className: `insight-card ${type}` }, [
    span({ className: 'insight-icon' }, icon),
    span({ className: 'insight-text' }, insight)
  ]);
};

export const initInsightsPanel = (container) => {
  const render = () => {
    const state = store.getState();
    const { trust } = state;

    const title = h3({ className: 'trust-chart-title' }, 'Key Insights');

    if (!trust.insights || trust.insights.length === 0) {
      container.innerHTML = '';
      container.appendChild(title);
      container.appendChild(
        div({ className: 'insights-empty' }, [
          div({ className: 'insights-empty-icon' }, '💡'),
          div(
            { className: 'insights-empty-text' },
            'No significant patterns detected yet. Analyze more sessions to discover insights.'
          )
        ])
      );
      return;
    }

    const insightCards = trust.insights.map((insight, i) => createInsightCard(insight, i));
    const insightsList = div({ className: 'insights-list' }, insightCards);

    container.innerHTML = '';
    container.appendChild(title);
    container.appendChild(insightsList);
  };

  // Subscribe to insights changes
  store.subscribe((state, prevState) => {
    if (state.trust.insights !== prevState.trust.insights) {
      render();
    }
  });

  // Initial render
  render();
};
