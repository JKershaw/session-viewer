/**
 * API client for communicating with the backend.
 */

const BASE_URL = '/api';

const handleResponse = async (response) => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
};

export const api = {
  /**
   * Fetch sessions with pagination and filtering.
   */
  async getSessions(params = {}) {
    const url = new URL(`${BASE_URL}/sessions`, window.location.origin);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url);
    return handleResponse(response);
  },

  /**
   * Fetch a single session with full details.
   */
  async getSession(id) {
    const response = await fetch(`${BASE_URL}/sessions/${id}`);
    return handleResponse(response);
  },

  /**
   * Fetch git correlations for a session.
   */
  async getGitCorrelations(id) {
    const response = await fetch(`${BASE_URL}/sessions/${id}/git-correlations`);
    return handleResponse(response);
  },

  /**
   * Queue session analysis.
   */
  async analyzeSession(id) {
    const response = await fetch(`${BASE_URL}/sessions/${id}/analyze`, {
      method: 'POST'
    });
    return handleResponse(response);
  },

  /**
   * Get job status.
   */
  async getJob(jobId) {
    const response = await fetch(`${BASE_URL}/jobs/${jobId}`);
    return handleResponse(response);
  },

  /**
   * Refresh sessions by scanning logs.
   */
  async refresh() {
    const response = await fetch(`${BASE_URL}/refresh`, {
      method: 'POST'
    });
    return handleResponse(response);
  },

  /**
   * Refresh sessions with streaming progress updates.
   * @param {Object} callbacks - Callback functions for progress events
   * @param {Function} callbacks.onProgress - Called with progress updates
   * @param {Function} callbacks.onComplete - Called when scan completes
   * @param {Function} callbacks.onError - Called on error
   * @returns {Function} Abort function to cancel the stream
   */
  refreshWithProgress({ onProgress, onComplete, onError }) {
    const eventSource = new EventSource(`${BASE_URL}/refresh/stream`);

    eventSource.addEventListener('progress', (event) => {
      const data = JSON.parse(event.data);
      onProgress?.(data);
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      eventSource.close();
      onComplete?.(data);
    });

    eventSource.addEventListener('error', (event) => {
      if (event.data) {
        const data = JSON.parse(event.data);
        onError?.(new Error(data.message || data.error));
      } else {
        onError?.(new Error('Connection lost'));
      }
      eventSource.close();
    });

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        return;
      }
      eventSource.close();
      onError?.(new Error('Connection error'));
    };

    return () => {
      eventSource.close();
    };
  },

  /**
   * Get all Linear tickets.
   */
  async getTickets() {
    const response = await fetch(`${BASE_URL}/tickets`);
    return handleResponse(response);
  },

  /**
   * Sync with Linear.
   */
  async syncLinear() {
    const response = await fetch(`${BASE_URL}/linear/sync`, {
      method: 'POST'
    });
    return handleResponse(response);
  },

  // Trust Analysis API

  /**
   * Get trust analysis for a session.
   */
  async getSessionTrust(sessionId) {
    const response = await fetch(`${BASE_URL}/trust/session/${sessionId}`);
    return handleResponse(response);
  },

  /**
   * Get the current trust map.
   */
  async getTrustMap() {
    const response = await fetch(`${BASE_URL}/trust/map`);
    return handleResponse(response);
  },

  /**
   * Compute/recompute the trust map.
   */
  async computeTrustMap() {
    const response = await fetch(`${BASE_URL}/trust/compute`, {
      method: 'POST'
    });
    return handleResponse(response);
  },

  /**
   * Get trust insights.
   */
  async getTrustInsights() {
    const response = await fetch(`${BASE_URL}/trust/insights`);
    return handleResponse(response);
  },

  /**
   * Get trust by codebase area.
   */
  async getTrustByArea() {
    const response = await fetch(`${BASE_URL}/trust/areas`);
    return handleResponse(response);
  },

  // Dispatch API

  /**
   * Get dispatch configuration status.
   */
  async getDispatchStatus() {
    const response = await fetch(`${BASE_URL}/dispatch/status`);
    return handleResponse(response);
  },

  /**
   * Get available dispatch prompts.
   */
  async getDispatchAvailable() {
    const response = await fetch(`${BASE_URL}/dispatch/available`);
    return handleResponse(response);
  },

  /**
   * Claim a dispatch item.
   */
  async claimDispatchItem(itemId) {
    const response = await fetch(`${BASE_URL}/dispatch/claim/${itemId}`, {
      method: 'POST'
    });
    return handleResponse(response);
  },

  /**
   * Get all claimed prompts.
   */
  async getClaimedPrompts() {
    const response = await fetch(`${BASE_URL}/dispatch/claimed`);
    return handleResponse(response);
  },

  /**
   * Delete a claimed prompt.
   */
  async deleteClaimedPrompt(id) {
    const response = await fetch(`${BASE_URL}/dispatch/claimed/${id}`, {
      method: 'DELETE'
    });
    return handleResponse(response);
  },

  // Auto-claim settings API

  /**
   * Get current auto-claim settings.
   */
  async getAutoClaimSettings() {
    const response = await fetch(`${BASE_URL}/dispatch/settings`);
    return handleResponse(response);
  },

  /**
   * Update auto-claim settings.
   */
  async updateAutoClaimSettings(settings) {
    const response = await fetch(`${BASE_URL}/dispatch/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    return handleResponse(response);
  },

  /**
   * Toggle auto-claim enabled state.
   */
  async toggleAutoClaim() {
    const response = await fetch(`${BASE_URL}/dispatch/settings/toggle`, {
      method: 'POST'
    });
    return handleResponse(response);
  },

  /**
   * Subscribe to auto-claim events via SSE.
   * @param {Object} callbacks - Event callbacks
   * @param {Function} callbacks.onClaim - Called when a prompt is auto-claimed
   * @param {Function} callbacks.onError - Called on auto-claim error
   * @param {Function} callbacks.onStatusChange - Called when auto-claim is enabled/disabled
   * @returns {Function} Cleanup function to unsubscribe
   */
  subscribeToAutoClaimEvents({ onClaim, onError, onStatusChange }) {
    const eventSource = new EventSource(`${BASE_URL}/dispatch/events`);

    eventSource.addEventListener('claim', (event) => {
      const data = JSON.parse(event.data);
      onClaim?.(data);
    });

    eventSource.addEventListener('error', (event) => {
      if (event.data) {
        const data = JSON.parse(event.data);
        onError?.(data);
      }
    });

    eventSource.addEventListener('status_change', (event) => {
      const data = JSON.parse(event.data);
      onStatusChange?.(data);
    });

    eventSource.onerror = () => {
      // Connection error - auto-reconnect is handled by EventSource
      console.warn('[AutoClaim] SSE connection error, will auto-reconnect');
    };

    return () => {
      eventSource.close();
    };
  }
};
