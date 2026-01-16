/**
 * Header component with title and action buttons.
 */
import { store, setLoading, setError, setSuccess, setSessions } from '../state/store.js';
import { api } from '../api/client.js';
import { div, button, span, h1, $ } from '../utils/dom.js';

let refreshing = false;
let syncing = false;
let refreshProgress = null;
let abortRefresh = null;

const createSpinner = () => div({ className: 'spinner' });

const createProgressBar = (progress) => {
  const { filesProcessed, totalFiles, errors } = progress;
  const percent = totalFiles > 0 ? Math.round((filesProcessed / totalFiles) * 100) : 0;

  return div({ className: 'progress-bar-container' }, [
    div({ className: 'progress-bar-track' }, [
      div({
        className: 'progress-bar-fill',
        style: `width: ${percent}%`
      })
    ]),
    div({ className: 'progress-bar-text' }, [
      span({}, `${filesProcessed} / ${totalFiles} files (${percent}%)`),
      errors > 0 ? span({ className: 'progress-errors' }, ` - ${errors} errors`) : null
    ].filter(Boolean))
  ]);
};

export const initHeader = (container) => {
  const render = () => {
    const title = h1({ className: 'header-title' }, 'Claude Code Session Analyzer');

    let refreshBtnContent;
    if (refreshing && refreshProgress) {
      refreshBtnContent = [createSpinner(), 'Refreshing...'];
    } else if (refreshing) {
      refreshBtnContent = [createSpinner(), 'Starting...'];
    } else {
      refreshBtnContent = 'Refresh Logs';
    }

    const refreshBtn = button(
      {
        className: 'btn header-btn',
        id: 'btn-refresh',
        onClick: handleRefresh,
        disabled: refreshing ? 'disabled' : null
      },
      refreshBtnContent
    );

    const syncBtn = button(
      {
        className: 'btn header-btn',
        id: 'btn-sync',
        onClick: handleSync,
        disabled: syncing ? 'disabled' : null
      },
      syncing ? [createSpinner(), 'Syncing...'] : 'Sync Linear'
    );

    const actionItems = [refreshBtn, syncBtn];
    if (refreshing && refreshProgress) {
      actionItems.unshift(createProgressBar(refreshProgress));
    }

    const actions = div({ className: 'header-actions' }, actionItems);

    container.innerHTML = '';
    container.appendChild(title);
    container.appendChild(actions);
  };

  const handleRefresh = async () => {
    if (refreshing) return;

    refreshing = true;
    refreshProgress = null;
    render();

    try {
      setLoading(true);

      await new Promise((resolve, reject) => {
        abortRefresh = api.refreshWithProgress({
          onProgress: (progress) => {
            refreshProgress = progress;
            render();
          },
          onComplete: (result) => {
            resolve(result);
          },
          onError: (error) => {
            reject(error);
          }
        });
      });

      // Reload sessions
      const sessionsResult = await api.getSessions({ limit: 10000, includeEvents: true });
      const sortedSessions = sessionsResult.data.sort((a, b) => {
        const timeA = a.startTime ? new Date(a.startTime).getTime() : NaN;
        const timeB = b.startTime ? new Date(b.startTime).getTime() : NaN;
        const validA = !isNaN(timeA);
        const validB = !isNaN(timeB);
        if (!validA && !validB) return 0;
        if (!validA) return 1;
        if (!validB) return -1;
        return timeB - timeA;
      });
      setSessions(sortedSessions);
      setError(null);
      setSuccess(`Refreshed ${sortedSessions.length} sessions`);
    } catch (err) {
      console.error('Refresh failed:', err);
      setError(err.message);
    } finally {
      refreshing = false;
      refreshProgress = null;
      abortRefresh = null;
      setLoading(false);
      render();
    }
  };

  const handleSync = async () => {
    if (syncing) return;

    syncing = true;
    render();

    try {
      const result = await api.syncLinear();

      // Reload sessions to get updated ticket links
      const sessionsResult = await api.getSessions({ limit: 10000, includeEvents: true });
      const sortedSessions = sessionsResult.data.sort((a, b) => {
        const timeA = a.startTime ? new Date(a.startTime).getTime() : NaN;
        const timeB = b.startTime ? new Date(b.startTime).getTime() : NaN;
        const validA = !isNaN(timeA);
        const validB = !isNaN(timeB);
        if (!validA && !validB) return 0;
        if (!validA) return 1;
        if (!validB) return -1;
        return timeB - timeA;
      });
      setSessions(sortedSessions);

      setError(null);
      setSuccess(`Synced ${result.ticketCount} tickets, linked ${result.linkedSessions} sessions`);
    } catch (err) {
      console.error('Sync failed:', err);
      setError(err.message);
    } finally {
      syncing = false;
      render();
    }
  };

  // Initial render
  render();
};
