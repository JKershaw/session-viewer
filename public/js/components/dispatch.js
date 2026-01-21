/**
 * Dispatch component - manages dispatch queue and claimed prompts.
 */
import {
  store,
  setDispatchAvailable,
  setDispatchClaimed,
  addDispatchClaimed,
  removeDispatchClaimed,
  setDispatchLoading,
  setDispatchError,
  setDispatchConfigured,
  setDispatchSettings
} from '../state/store.js';
import { api } from '../api/client.js';
import { div, button, span, h3, a } from '../utils/dom.js';
import { notify } from './notifications.js';

let initialized = false;
let sseCleanup = null;

const createSpinner = () => div({ className: 'spinner' });

export const initDispatch = (container) => {
  console.log('[Dispatch] initDispatch called with container:', container);

  const renderAvailableItem = (item) => {
    console.log('[Dispatch] Rendering available item:', item);
    const claimBtn = button(
      {
        className: 'btn btn-primary dispatch-claim-btn',
        onClick: () => handleClaim(item.id)
      },
      'Claim'
    );

    // Build ticket link if issue info is available
    const ticketContent = item.issueUrl
      ? [a(
          { href: item.issueUrl, target: '_blank', rel: 'noopener noreferrer' },
          `${item.issueIdentifier}: ${item.issueTitle}`
        )]
      : [span({}, 'No linked issue')];

    return div({ className: 'dispatch-item available', 'data-id': item.id }, [
      div({ className: 'dispatch-item-header' }, [
        span({ className: 'dispatch-item-name' }, item.promptName || 'Unnamed Prompt')
      ]),
      div({ className: 'dispatch-item-ticket' }, ticketContent),
      div(
        { className: 'dispatch-item-prompt' },
        item.prompt.length > 200 ? item.prompt.substring(0, 200) + '...' : item.prompt
      ),
      div({ className: 'dispatch-item-meta' }, [
        span({}, `Workspace: ${item.workspace?.urlKey || 'Unknown'}`),
        span({}, `Expires: ${item.expiresAt ? new Date(item.expiresAt).toLocaleString() : 'Unknown'}`)
      ]),
      div({ className: 'dispatch-item-actions' }, [claimBtn])
    ]);
  };

  const renderClaimedItem = (prompt) => {
    const deleteBtn = button(
      {
        className: 'btn btn-delete dispatch-delete-btn',
        'data-id': prompt.id,
        onClick: () => handleDelete(prompt.id)
      },
      'Delete'
    );

    // Build ticket link if issue info is available
    const ticketContent = prompt.issueUrl
      ? [a(
          { href: prompt.issueUrl, target: '_blank', rel: 'noopener noreferrer' },
          `${prompt.issueIdentifier}: ${prompt.issueTitle}`
        )]
      : [span({}, 'No linked issue')];

    return div({ className: 'dispatch-item claimed', 'data-id': prompt.id }, [
      div({ className: 'dispatch-item-header' }, [
        span({ className: 'dispatch-item-name' }, prompt.promptName || 'Unnamed Prompt')
      ]),
      div({ className: 'dispatch-item-ticket' }, ticketContent),
      div(
        { className: 'dispatch-item-prompt' },
        prompt.prompt.length > 200 ? prompt.prompt.substring(0, 200) + '...' : prompt.prompt
      ),
      div({ className: 'dispatch-item-meta' }, [
        span({}, `Workspace: ${prompt.workspaceUrlKey || 'Unknown'}`),
        span({}, `Claimed: ${new Date(prompt.claimedAt).toLocaleString()}`)
      ]),
      div({ className: 'dispatch-item-actions' }, [deleteBtn])
    ]);
  };

  const render = () => {
    const state = store.getState();
    const { dispatch } = state;

    console.log('[Dispatch] render() called, view:', state.view, 'dispatch state:', dispatch);

    // Don't render if not on dispatch view
    if (state.view !== 'dispatch') return;

    // Auto-claim toggle button
    const { settings } = dispatch;
    const toggleBtn = button(
      {
        className: `btn auto-claim-toggle ${settings.enabled ? 'active' : ''}`,
        onClick: handleToggleAutoClaim,
        disabled: dispatch.loading ? 'disabled' : null
      },
      settings.enabled ? 'Auto-Claim: ON' : 'Auto-Claim: OFF'
    );

    // Header
    const refreshBtn = button(
      {
        className: 'btn',
        id: 'dispatch-refresh-btn',
        onClick: () => {
          console.log('[Dispatch] Refresh button clicked');
          handleRefresh();
        },
        disabled: dispatch.loading ? 'disabled' : null
      },
      dispatch.loading ? [createSpinner(), ' Loading...'] : 'Refresh Available'
    );
    console.log('[Dispatch] Created refresh button with click handler');

    const header = div({ className: 'dispatch-header' }, [
      div({ className: 'dispatch-header-title' }, 'Dispatch Queue'),
      div({ className: 'dispatch-header-actions' }, [toggleBtn, refreshBtn])
    ]);

    // Error display
    const errorDisplay = dispatch.error
      ? div({ className: 'dispatch-error' }, [
          span({}, `Error: ${dispatch.error}`),
          button({ className: 'btn', onClick: handleRefresh, style: 'margin-left: 12px' }, 'Retry')
        ])
      : null;

    // Auto-claim status display (when enabled)
    const autoClaimStatus = settings.enabled ? div({ className: 'auto-claim-status' }, [
      span({ className: 'auto-claim-status-indicator active' }),
      span({}, `Polling every ${settings.pollingIntervalMs / 1000}s`),
      settings.totalClaimedCount > 0 ?
        span({ className: 'auto-claim-count' }, `${settings.totalClaimedCount} auto-claimed`) : null,
      settings.lastPollAt ?
        span({ className: 'auto-claim-last-poll' }, `Last poll: ${formatRelativeTime(settings.lastPollAt)}`) : null,
      settings.lastError ?
        span({ className: 'auto-claim-error' }, `Error: ${settings.lastError}`) : null
    ].filter(Boolean)) : null;

    // Not configured message
    if (!dispatch.configured && !dispatch.loading) {
      const notConfigured = div({ className: 'dispatch-not-configured' }, [
        div({ className: 'dispatch-empty-icon' }, '!'),
        div({ className: 'dispatch-empty-title' }, 'Dispatch Not Configured'),
        div(
          { className: 'dispatch-empty-text' },
          'Set DISPATCH_TOKEN environment variable to enable the dispatch queue.'
        )
      ]);

      container.innerHTML = '';
      container.appendChild(
        div({ className: 'dispatch-container' }, [header, errorDisplay, notConfigured].filter(Boolean))
      );
      return;
    }

    // Available section
    const availableContent = dispatch.available.length > 0
      ? dispatch.available.map(renderAvailableItem)
      : [div({ className: 'dispatch-empty-state' }, 'No available prompts. Click "Refresh Available" to check for new prompts.')];

    const availableSection = div({ className: 'dispatch-section' }, [
      h3({}, 'Available Prompts'),
      div({ className: 'dispatch-list', id: 'dispatch-available-list' }, availableContent)
    ]);

    // Claimed section
    const claimedContent = dispatch.claimed.length > 0
      ? dispatch.claimed.map(renderClaimedItem)
      : [div({ className: 'dispatch-empty-state' }, 'No claimed prompts yet. Claim prompts from the available queue above.')];

    const claimedSection = div({ className: 'dispatch-section' }, [
      h3({}, 'Claimed Prompts'),
      div({ className: 'dispatch-list', id: 'dispatch-claimed-list' }, claimedContent)
    ]);

    // Assemble
    container.innerHTML = '';
    container.appendChild(
      div({ className: 'dispatch-container' }, [
        header,
        autoClaimStatus,
        errorDisplay,
        availableSection,
        claimedSection
      ].filter(Boolean))
    );
  };

  // Format relative time for display
  const formatRelativeTime = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const checkConfigured = async () => {
    console.log('[Dispatch] Checking if dispatch is configured...');
    try {
      const status = await api.getDispatchStatus();
      console.log('[Dispatch] Config status:', status);
      setDispatchConfigured(status.configured);
      return status.configured;
    } catch (err) {
      console.error('[Dispatch] Error checking config:', err);
      setDispatchConfigured(false);
      return false;
    }
  };

  const loadClaimedPrompts = async () => {
    console.log('[Dispatch] Loading claimed prompts...');
    try {
      const claimed = await api.getClaimedPrompts();
      console.log('[Dispatch] Claimed prompts loaded:', claimed);
      setDispatchClaimed(claimed);
    } catch (err) {
      console.error('[Dispatch] Failed to load claimed prompts:', err);
    }
  };

  const handleRefresh = async () => {
    console.log('[Dispatch] handleRefresh called');
    setDispatchLoading(true);
    setDispatchError(null);

    try {
      const configured = await checkConfigured();
      console.log('[Dispatch] Configured check result:', configured);
      if (!configured) {
        console.log('[Dispatch] Not configured, stopping refresh');
        setDispatchLoading(false);
        render();
        return;
      }

      console.log('[Dispatch] Fetching available prompts...');
      const [availableResponse] = await Promise.all([
        api.getDispatchAvailable(),
        loadClaimedPrompts(),
        loadSettings()
      ]);

      console.log('[Dispatch] Available prompts received:', availableResponse);
      // API returns {items: [...]} so extract the array
      const available = Array.isArray(availableResponse) ? availableResponse : (availableResponse.items || []);
      setDispatchAvailable(available);
    } catch (err) {
      console.error('[Dispatch] Error during refresh:', err);
      setDispatchError(err.message);
    } finally {
      console.log('[Dispatch] Refresh complete');
      setDispatchLoading(false);
    }
  };

  const handleClaim = async (itemId) => {
    try {
      setDispatchLoading(true);
      const claimed = await api.claimDispatchItem(itemId);

      // Add to claimed list
      addDispatchClaimed(claimed);

      // Remove from available list
      const state = store.getState();
      const newAvailable = state.dispatch.available.filter(item => item.id !== itemId);
      setDispatchAvailable(newAvailable);

      notify.success('Prompt claimed successfully');
    } catch (err) {
      if (err.message.includes('already claimed')) {
        notify.error('This prompt has already been claimed');
        // Refresh to update the list
        handleRefresh();
      } else {
        notify.error(`Failed to claim: ${err.message}`);
      }
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this claimed prompt?')) {
      return;
    }

    try {
      await api.deleteClaimedPrompt(id);
      removeDispatchClaimed(id);
      notify.success('Prompt deleted');
    } catch (err) {
      notify.error(`Failed to delete: ${err.message}`);
    }
  };

  const handleToggleAutoClaim = async () => {
    try {
      setDispatchLoading(true);
      const settings = await api.toggleAutoClaim();
      setDispatchSettings(settings);

      if (settings.enabled) {
        notify.success('Auto-claim enabled');
        subscribeToSSE();
      } else {
        notify.success('Auto-claim disabled');
        unsubscribeFromSSE();
      }
    } catch (err) {
      notify.error(`Failed to toggle auto-claim: ${err.message}`);
    } finally {
      setDispatchLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const settings = await api.getAutoClaimSettings();
      setDispatchSettings(settings);

      // Subscribe to SSE if enabled
      if (settings.enabled) {
        subscribeToSSE();
      }
    } catch (err) {
      console.error('[Dispatch] Failed to load settings:', err);
    }
  };

  const subscribeToSSE = () => {
    // Clean up existing subscription
    if (sseCleanup) {
      sseCleanup();
      sseCleanup = null;
    }

    console.log('[Dispatch] Subscribing to auto-claim events');
    sseCleanup = api.subscribeToAutoClaimEvents({
      onClaim: (event) => {
        console.log('[Dispatch] Auto-claim event:', event);
        const prompt = event.data;
        addDispatchClaimed(prompt);

        // Remove from available list if present
        const state = store.getState();
        const newAvailable = state.dispatch.available.filter(item => item.id !== prompt.id);
        if (newAvailable.length !== state.dispatch.available.length) {
          setDispatchAvailable(newAvailable);
        }

        notify.success(`Auto-claimed: ${prompt.promptName || 'Prompt'}`);

        // Update settings with new counts
        loadSettings();
      },
      onError: (event) => {
        console.error('[Dispatch] Auto-claim error event:', event);
        setDispatchSettings({ lastError: event.data?.error });
      },
      onStatusChange: (event) => {
        console.log('[Dispatch] Auto-claim status change:', event);
        setDispatchSettings({ enabled: event.data?.enabled });
      }
    });
  };

  const unsubscribeFromSSE = () => {
    if (sseCleanup) {
      console.log('[Dispatch] Unsubscribing from auto-claim events');
      sseCleanup();
      sseCleanup = null;
    }
  };

  // Subscribe to view changes
  store.subscribe((state, prevState) => {
    if (state.view === 'dispatch' && prevState.view !== 'dispatch') {
      if (!initialized) {
        initialized = true;
        handleRefresh();
      }
      render();
    }
  });

  // Subscribe to dispatch state changes
  store.subscribe((state, prevState) => {
    if (state.view === 'dispatch' && state.dispatch !== prevState.dispatch) {
      render();
    }
  });

  // Initial load if already on dispatch view
  const initialState = store.getState();
  if (initialState.view === 'dispatch' && !initialized) {
    console.log('[Dispatch] Already on dispatch view, triggering initial refresh');
    initialized = true;
    handleRefresh();
  } else {
    // Just render without refresh
    render();
  }
};
