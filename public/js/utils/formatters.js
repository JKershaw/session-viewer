/**
 * Formatting utilities for dates, tokens, durations, etc.
 */

/**
 * Format a date for display.
 */
export const formatDate = (isoString) => {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Format a date for the time axis.
 */
export const formatAxisTime = (date, showDate = false, showSeconds = false) => {
  if (showDate) {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric'
    });
  }
  const options = {
    hour: '2-digit',
    minute: '2-digit'
  };
  if (showSeconds) {
    options.second = '2-digit';
  }
  return date.toLocaleTimeString('en-US', options);
};

/**
 * Format a date for date input fields.
 */
export const formatDateInput = (isoString) => {
  if (!isoString) return '';
  return isoString.split('T')[0];
};

/**
 * Format duration in milliseconds to human-readable string.
 */
export const formatDuration = (ms) => {
  if (!ms || ms < 0) return '-';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
};

/**
 * Format token count with K/M suffix.
 */
export const formatTokens = (tokens) => {
  if (tokens === null || tokens === undefined) return '-';

  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return String(tokens);
};

/**
 * Format relative time (e.g., "2 hours ago").
 */
export const formatRelativeTime = (isoString) => {
  if (!isoString) return '-';

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return 'Just now';
};

/**
 * Get folder name from full path.
 */
export const getFolderName = (path) => {
  if (!path) return '-';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
};

/**
 * Escape HTML to prevent XSS.
 */
export const escapeHtml = (str) => {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

/**
 * Truncate text to specified length.
 */
export const truncate = (str, maxLength = 80) => {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
};
