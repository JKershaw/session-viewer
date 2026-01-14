/**
 * Tooltip component.
 */
import { div, span, clearChildren, $ } from '../utils/dom.js';

let tooltipEl = null;
let hideTimeout = null;

export const initTooltip = () => {
  tooltipEl = $('tooltip');
  if (!tooltipEl) {
    tooltipEl = div({ id: 'tooltip', className: 'hidden' });
    document.body.appendChild(tooltipEl);
  }
};

export const showTooltip = (x, y, data) => {
  if (!tooltipEl) initTooltip();

  clearTimeout(hideTimeout);
  clearChildren(tooltipEl);

  // Title
  if (data.title) {
    tooltipEl.appendChild(div({ className: 'tooltip-title' }, data.title));
  }

  // Rows
  if (data.rows) {
    data.rows.forEach(row => {
      tooltipEl.appendChild(
        div({ className: 'tooltip-row' }, [
          span({ className: 'tooltip-label' }, row.label),
          span({ className: 'tooltip-value' }, row.value)
        ])
      );
    });
  }

  // Event counts
  if (data.events && Object.keys(data.events).length > 0) {
    const eventsContainer = div({ className: 'tooltip-events' });

    Object.entries(data.events).forEach(([type, count]) => {
      eventsContainer.appendChild(
        div({ className: 'tooltip-event-row' }, [
          span({ className: `tooltip-event-dot ${getEventClass(type)}` }),
          span({ className: 'tooltip-event-count' }, `${formatEventType(type)}: ${count}`)
        ])
      );
    });

    tooltipEl.appendChild(eventsContainer);
  }

  // Position
  positionTooltip(x, y);

  tooltipEl.classList.remove('hidden');
  tooltipEl.classList.add('visible');
};

export const hideTooltip = () => {
  if (!tooltipEl) return;

  hideTimeout = setTimeout(() => {
    tooltipEl.classList.remove('visible');
    tooltipEl.classList.add('hidden');
  }, 100);
};

const positionTooltip = (x, y) => {
  const padding = 10;
  const tooltipRect = tooltipEl.getBoundingClientRect();

  let left = x + padding;
  let top = y + padding;

  // Check right edge
  if (left + tooltipRect.width > window.innerWidth - padding) {
    left = x - tooltipRect.width - padding;
  }

  // Check bottom edge
  if (top + tooltipRect.height > window.innerHeight - padding) {
    top = y - tooltipRect.height - padding;
  }

  // Ensure not negative
  left = Math.max(padding, left);
  top = Math.max(padding, top);

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
};

const getEventClass = (type) => {
  const typeMap = {
    user_message: 'user',
    assistant_message: 'assistant',
    tool_call: 'tool',
    git_op: 'git',
    error: 'error',
    planning_mode: 'planning'
  };
  return typeMap[type] || 'tool';
};

const formatEventType = (type) => {
  const typeMap = {
    user_message: 'User',
    assistant_message: 'Assistant',
    tool_call: 'Tool',
    git_op: 'Git',
    error: 'Error',
    planning_mode: 'Planning'
  };
  return typeMap[type] || type;
};
