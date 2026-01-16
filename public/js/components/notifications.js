/**
 * Toast notification component for displaying errors and success messages.
 */
import { store } from '../state/store.js';
import { div, span, button } from '../utils/dom.js';

let container = null;
const AUTO_DISMISS_MS = 5000;
const activeNotifications = new Map();
let notificationId = 0;

/**
 * Create a notification element.
 */
const createNotification = (id, message, type = 'error') => {
  const notification = div(
    {
      className: `notification notification-${type}`,
      dataset: { id: String(id) }
    },
    [
      div({ className: 'notification-icon' }, type === 'error' ? '!' : '\u2713'),
      span({ className: 'notification-message' }, message),
      button(
        {
          className: 'notification-close',
          onClick: () => dismissNotification(id),
          'aria-label': 'Dismiss'
        },
        '\u00d7'
      )
    ]
  );

  return notification;
};

/**
 * Show a notification.
 */
const showNotification = (message, type = 'error') => {
  if (!container || !message) return;

  const id = ++notificationId;
  const notification = createNotification(id, message, type);

  container.appendChild(notification);

  // Trigger animation
  requestAnimationFrame(() => {
    notification.classList.add('notification-visible');
  });

  // Auto-dismiss
  const timeoutId = setTimeout(() => {
    dismissNotification(id);
  }, AUTO_DISMISS_MS);

  activeNotifications.set(id, { element: notification, timeoutId });

  return id;
};

/**
 * Dismiss a notification.
 */
const dismissNotification = (id) => {
  const notification = activeNotifications.get(id);
  if (!notification) return;

  clearTimeout(notification.timeoutId);
  notification.element.classList.remove('notification-visible');
  notification.element.classList.add('notification-dismissing');

  // Remove after animation
  setTimeout(() => {
    notification.element.remove();
    activeNotifications.delete(id);
  }, 300);
};

/**
 * Initialize the notifications component.
 */
export const initNotifications = (el) => {
  container = el;

  // Subscribe to error state changes
  let previousError = null;
  let previousSuccess = null;

  store.subscribe((state, prevState) => {
    // Show error notification when error changes to a new value
    if (state.error && state.error !== previousError) {
      showNotification(state.error, 'error');
      previousError = state.error;
    } else if (!state.error) {
      previousError = null;
    }

    // Show success notification when success changes to a new value
    if (state.success && state.success !== previousSuccess) {
      showNotification(state.success, 'success');
      previousSuccess = state.success;
    } else if (!state.success) {
      previousSuccess = null;
    }
  });
};

/**
 * Programmatically show a notification (exported for direct use).
 */
export const notify = {
  error: (message) => showNotification(message, 'error'),
  success: (message) => showNotification(message, 'success')
};
