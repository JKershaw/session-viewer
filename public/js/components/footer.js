/**
 * Footer component displaying visible time range and color legend.
 */
import { store } from '../state/store.js';
import { div, span, clearChildren } from '../utils/dom.js';

let container = null;
let timeRangeEl = null;

/**
 * Format a time range for display.
 * Same day: "Jan 12, 2:00 PM – 6:30 PM"
 * Multi-day: "Jan 12, 2:00 PM – Jan 13, 4:30 PM"
 */
const formatTimeRange = (startMs, endMs) => {
  if (!startMs || !endMs) return '–';

  const start = new Date(startMs);
  const end = new Date(endMs);

  const timeOptions = { hour: 'numeric', minute: '2-digit' };
  const dateTimeOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

  // Check if same day
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    const dateStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const startTime = start.toLocaleTimeString('en-US', timeOptions);
    const endTime = end.toLocaleTimeString('en-US', timeOptions);
    return `${dateStr}, ${startTime} – ${endTime}`;
  } else {
    const startStr = start.toLocaleDateString('en-US', dateTimeOptions);
    const endStr = end.toLocaleDateString('en-US', dateTimeOptions);
    return `${startStr} – ${endStr}`;
  }
};

/**
 * Create the legend items.
 */
const createLegend = () => {
  const items = [
    { className: 'user', label: 'User' },
    { className: 'assistant', label: 'Assistant' },
    { className: 'tool', label: 'Tool' },
    { className: 'git', label: 'Git' },
    { className: 'error', label: 'Error' },
    { className: 'planning', label: 'Planning' }
  ];

  return div({ className: 'footer-legend' }, items.map(item =>
    span({ className: 'legend-item' }, [
      span({ className: `legend-color ${item.className}` }),
      item.label
    ])
  ));
};

/**
 * Update the time range display.
 */
const updateTimeRange = () => {
  if (!timeRangeEl) return;

  const { visibleTimeRange } = store.getState();
  const formatted = formatTimeRange(visibleTimeRange.start, visibleTimeRange.end);
  timeRangeEl.textContent = formatted;
};

/**
 * Initialize the footer component.
 */
export const initFooter = (el) => {
  container = el;

  // Create time range element
  timeRangeEl = span({ className: 'footer-time-range' }, '–');

  // Build footer structure
  const content = [
    timeRangeEl,
    createLegend()
  ];

  content.forEach(child => container.appendChild(child));

  // Subscribe to visible time range changes
  store.subscribe((state, prevState) => {
    if (state.visibleTimeRange !== prevState.visibleTimeRange) {
      updateTimeRange();
    }
  });

  // Initial update
  updateTimeRange();
};
