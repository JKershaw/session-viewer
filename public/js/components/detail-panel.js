/**
 * Detail panel component for showing session details.
 */
import { store, setSelectedSession, setView, setFilters, setError, setSuccess } from '../state/store.js';
import { api } from '../api/client.js';
import { div, button, span, clearChildren } from '../utils/dom.js';
import {
  formatDate,
  formatDuration,
  formatTokens,
  escapeHtml,
  truncate,
  getFolderName
} from '../utils/formatters.js';

let panelEl = null;
let contentEl = null;
let currentSessionId = null;
let loadedEvents = [];
let eventsOffset = 0;
const EVENTS_PER_PAGE = 50;

// Analysis polling state
let analyzingSessionId = null;
let pollIntervalId = null;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export const initDetailPanel = (container) => {
  panelEl = container;

  // Close button
  const header = div({ className: 'panel-header' }, [
    span({ className: 'panel-title', id: 'panel-title' }, ''),
    button({
      className: 'panel-close',
      onClick: closePanel,
      ariaLabel: 'Close panel'
    }, '✕')
  ]);

  contentEl = div({ className: 'panel-content' });

  panelEl.appendChild(header);
  panelEl.appendChild(contentEl);

  // Subscribe to state changes
  store.subscribe((state, prevState) => {
    if (state.selectedSession !== prevState.selectedSession) {
      if (state.selectedSession) {
        openPanel(state.selectedSession);
      } else {
        closePanel();
      }
    }
  });

  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelEl.classList.contains('open')) {
      setSelectedSession(null);
    }
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (panelEl.classList.contains('open') &&
        !panelEl.contains(e.target) &&
        !e.target.closest('.session-bar') &&
        !e.target.closest('.timeline-label')) {
      setSelectedSession(null);
    }
  });
};

const openPanel = async (session) => {
  panelEl.classList.add('open');
  currentSessionId = session.id;
  loadedEvents = [];
  eventsOffset = 0;

  // Update title
  const titleEl = document.getElementById('panel-title');
  if (titleEl) {
    titleEl.textContent = session.id;
  }

  renderContent(session);

  // Load full session details if needed
  if (!session.events || session.events.length === 0) {
    try {
      const fullSession = await api.getSession(session.id);
      if (currentSessionId === session.id) {
        renderContent(fullSession);
      }
    } catch (err) {
      console.error('Failed to load session details:', err);
    }
  }
};

const closePanel = () => {
  stopPolling();
  panelEl.classList.remove('open');
  setSelectedSession(null);
};

const getTicketDisplay = (ticketId) => {
  if (!ticketId) return '-';
  const { filterOptions } = store.getState();
  const ticket = filterOptions.tickets.find(t => t.ticketId === ticketId);
  if (ticket?.title) {
    return `${ticketId}: ${ticket.title}`;
  }
  return ticketId;
};

const renderContent = (session) => {
  clearChildren(contentEl);

  // Metadata
  const metadata = div({ className: 'panel-metadata' }, [
    createMetadataItem('Folder', getFolderName(session.folder), true, true),
    createMetadataItem('Branch', session.branch || '-'),
    createMetadataItem('Ticket', getTicketDisplay(session.linearTicketId), true),
    createMetadataItem('Start', formatDate(session.startTime)),
    createMetadataItem('End', formatDate(session.endTime)),
    createMetadataItem('Duration', formatDuration(session.durationMs)),
    createMetadataItem('Tokens', formatTokens(session.totalTokens))
  ]);

  if (session._childCount && session._childCount > 1) {
    metadata.appendChild(
      createMetadataItem('Merged', `${session._childCount} sessions`, true)
    );
  }

  contentEl.appendChild(metadata);

  // Outcomes section (if available)
  if (session.outcomes && hasOutcomes(session.outcomes)) {
    const outcomesSection = div({ className: 'panel-section' }, [
      div({ className: 'panel-section-title' }, 'Outcomes'),
      ...renderOutcomes(session.outcomes)
    ]);
    contentEl.appendChild(outcomesSection);
  }

  // Ticket References section (if available)
  if (session.ticketReferences && session.ticketReferences.length > 0) {
    const ticketsSection = div({ className: 'panel-section' }, [
      div({ className: 'panel-section-title' }, 'Tickets'),
      ...renderTicketReferences(session.ticketReferences)
    ]);
    contentEl.appendChild(ticketsSection);
  }

  // Analysis status
  let analysisContent;
  if (session.analyzed) {
    analysisContent = div({}, `Analyzed - ${session.annotations?.length || 0} annotations found`);
  } else if (analyzingSessionId === session.id) {
    analysisContent = div({ className: 'analyzing-status' }, [
      div({ className: 'spinner' }),
      span({}, 'Analyzing...')
    ]);
  } else {
    analysisContent = button({
      className: 'btn btn-primary',
      onClick: () => handleAnalyze(session.id)
    }, 'Analyze with AI');
  }

  const analysisSection = div({ className: 'panel-section' }, [
    div({ className: 'panel-section-title' }, 'Analysis'),
    analysisContent
  ]);
  contentEl.appendChild(analysisSection);

  // Trust metrics section (loads async)
  const trustSection = div({ className: 'panel-section', id: 'trust-section' }, [
    div({ className: 'panel-section-title' }, 'Trust Metrics'),
    div({ className: 'trust-loading' }, 'Loading trust analysis...')
  ]);
  contentEl.appendChild(trustSection);
  loadTrustMetrics(session.id);

  // Annotations
  if (session.annotations && session.annotations.length > 0) {
    const annotationsSection = div({ className: 'panel-section' }, [
      div({ className: 'panel-section-title' }, 'Annotations'),
      ...session.annotations.map(createAnnotationItem)
    ]);
    contentEl.appendChild(annotationsSection);
  }

  // Events
  if (session.events && session.events.length > 0) {
    loadedEvents = session.events.slice(0, EVENTS_PER_PAGE);
    eventsOffset = EVENTS_PER_PAGE;

    const eventsSection = div({ className: 'panel-section' }, [
      div({ className: 'panel-section-title' }, `Events (${session.events.length})`),
      div({ className: 'events-list', id: 'events-list' },
        loadedEvents.map(createEventItem)
      )
    ]);

    if (session.events.length > EVENTS_PER_PAGE) {
      const loadMoreBtn = button({
        className: 'btn load-more',
        onClick: () => loadMoreEvents(session)
      }, 'Load More Events');
      eventsSection.appendChild(loadMoreBtn);
    }

    contentEl.appendChild(eventsSection);
  }
};

const createMetadataItem = (label, value, fullWidth = false, mono = false) => {
  const className = fullWidth ? 'metadata-item full-width' : 'metadata-item';
  const valueClass = mono ? 'metadata-value mono' : 'metadata-value';

  return div({ className }, [
    span({ className: 'metadata-label' }, label),
    span({ className: valueClass }, value)
  ]);
};

const createAnnotationItem = (annotation) => {
  return div({ className: 'annotation-item' }, [
    div({ className: 'annotation-header' }, [
      span({ className: `badge badge-${getAnnotationClass(annotation.type)}` }, annotation.type),
      span({ className: 'annotation-confidence' }, `${Math.round(annotation.confidence * 100)}%`)
    ]),
    div({ className: 'annotation-summary' }, annotation.summary)
  ]);
};

const getAnnotationClass = (type) => {
  const typeMap = {
    blocker: 'error',
    decision: 'assistant',
    rework: 'tool',
    goal_shift: 'planning'
  };
  return typeMap[type] || 'tool';
};

const createEventItem = (event, index) => {
  const eventEl = div({
    className: 'event-item',
    onClick: (e) => toggleEventExpand(e.currentTarget)
  }, [
    div({ className: 'event-item-header' }, [
      span({ className: `badge badge-${getEventClass(event.type)}` }, formatEventType(event.type)),
      span({ className: 'event-item-time' }, formatTime(event.timestamp)),
      span({ className: 'event-item-tokens' }, formatTokens(event.tokenCount))
    ]),
    div({ className: 'event-item-preview' }, truncate(getEventContent(event), 100))
  ]);

  // Add expandable content (hidden by default)
  const contentEl = div({ className: 'event-item-content', style: { display: 'none' } });
  contentEl.textContent = getEventContent(event);
  eventEl.appendChild(contentEl);

  return eventEl;
};

const toggleEventExpand = (eventEl) => {
  const contentEl = eventEl.querySelector('.event-item-content');
  const isExpanded = eventEl.classList.contains('expanded');

  if (isExpanded) {
    eventEl.classList.remove('expanded');
    contentEl.style.display = 'none';
  } else {
    eventEl.classList.add('expanded');
    contentEl.style.display = 'block';
  }
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
    user_message: 'USER',
    assistant_message: 'ASSISTANT',
    tool_call: 'TOOL',
    git_op: 'GIT',
    error: 'ERROR',
    planning_mode: 'PLANNING'
  };
  return typeMap[type] || type.toUpperCase();
};

const formatTime = (timestamp) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

const getEventContent = (event) => {
  const raw = event.raw;
  if (!raw) return '';

  // Try various content locations
  if (raw.message?.content) {
    const content = raw.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(c => c.text || c.content || '').join('\n');
    }
  }

  if (raw.content) {
    return typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content, null, 2);
  }

  if (raw.input?.command) return raw.input.command;
  if (raw.input?.file_path) return raw.input.file_path;
  if (raw.error?.message) return raw.error.message;

  return JSON.stringify(raw, null, 2);
};

const loadMoreEvents = (session) => {
  const eventsList = document.getElementById('events-list');
  if (!eventsList || !session.events) return;

  const newEvents = session.events.slice(eventsOffset, eventsOffset + EVENTS_PER_PAGE);
  eventsOffset += EVENTS_PER_PAGE;

  newEvents.forEach(event => {
    eventsList.appendChild(createEventItem(event));
  });

  // Remove load more button if no more events
  if (eventsOffset >= session.events.length) {
    const loadMoreBtn = contentEl.querySelector('.load-more');
    if (loadMoreBtn) {
      loadMoreBtn.remove();
    }
  }
};

/**
 * Start polling for analysis job completion.
 */
const startPolling = (jobId, sessionId) => {
  const startTime = Date.now();

  pollIntervalId = setInterval(async () => {
    // Stop if panel closed or viewing different session
    if (currentSessionId !== sessionId) {
      stopPolling();
      return;
    }

    // Stop if exceeded max duration
    if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
      stopPolling();
      setError('Analysis timed out - check job status manually');
      return;
    }

    try {
      const job = await api.getJob(jobId);

      if (job.status === 'completed') {
        stopPolling();
        setSuccess(`Analysis complete: ${job.result?.annotationCount || 0} annotations found`);
        await refreshCurrentSession();
      } else if (job.status === 'failed') {
        stopPolling();
        setError(job.error || 'Analysis failed');
        analyzingSessionId = null;
        const session = store.getState().selectedSession;
        if (session) renderContent(session);
      }
      // If still pending/processing, continue polling
    } catch (err) {
      console.error('Failed to poll job status:', err);
      // Continue polling on transient errors
    }
  }, POLL_INTERVAL_MS);
};

/**
 * Stop polling for analysis job.
 */
const stopPolling = () => {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  analyzingSessionId = null;
};

/**
 * Refresh the current session data and re-render.
 */
const refreshCurrentSession = async () => {
  if (!currentSessionId) return;
  try {
    const fullSession = await api.getSession(currentSessionId);
    renderContent(fullSession);
  } catch (err) {
    console.error('Failed to refresh session:', err);
  }
};

const handleAnalyze = async (sessionId) => {
  try {
    const result = await api.analyzeSession(sessionId);
    analyzingSessionId = sessionId;
    const session = store.getState().selectedSession;
    if (session) renderContent(session); // Re-render to show spinner
    startPolling(result.jobId, sessionId);
  } catch (err) {
    console.error('Analysis failed:', err);
    setError(err.message || 'Failed to start analysis');
  }
};

/**
 * Load and display trust metrics for a session.
 */
const loadTrustMetrics = async (sessionId) => {
  const trustSection = document.getElementById('trust-section');
  if (!trustSection) return;

  try {
    const trust = await api.getSessionTrust(sessionId);

    // Only update if we're still viewing the same session
    if (currentSessionId !== sessionId) return;

    // Clear loading message
    const content = trustSection.querySelector('.trust-loading');
    if (content) content.remove();

    // Build trust display
    const trustContent = div({ className: 'trust-content' }, [
      // Trust score with visual indicator
      createTrustScoreDisplay(trust.trustScore, trust.autonomous, trust.characteristics?.codebaseArea),

      // Steering metrics
      div({ className: 'trust-group' }, [
        div({ className: 'trust-group-title' }, 'Steering'),
        createTrustMetric('Interventions', trust.steering.interventionCount.toString()),
        createTrustMetric('Goal Shifts', trust.steering.goalShiftCount.toString()),
        trust.steering.firstInterventionProgress !== null
          ? createTrustMetric(
              'First Intervention',
              `${Math.round(trust.steering.firstInterventionProgress * 100)}% through session`
            )
          : null
      ].filter(Boolean)),

      // Outcome metrics
      div({ className: 'trust-group' }, [
        div({ className: 'trust-group-title' }, 'Outcome'),
        createTrustMetric('Commits', trust.outcome.commitCount.toString()),
        createTrustMetric('Pushed', trust.outcome.hasPush ? 'Yes' : 'No'),
        createTrustMetric('Blockers', trust.outcome.blockerCount.toString()),
        createTrustMetric('Rework', trust.outcome.reworkCount.toString()),
        createTrustMetric('Errors', trust.outcome.errorCount.toString())
      ]),

      // Task characteristics
      div({ className: 'trust-group' }, [
        div({ className: 'trust-group-title' }, 'Characteristics'),
        createTrustMetric('Area', trust.characteristics.codebaseArea),
        trust.characteristics.branchType
          ? createTrustMetric('Branch Type', trust.characteristics.branchType)
          : null,
        createTrustMetric('Tools Used', trust.characteristics.toolDiversity.toString()),
        createTrustMetric('Subtasks', trust.characteristics.subtaskCount.toString())
      ].filter(Boolean))
    ]);

    trustSection.appendChild(trustContent);
  } catch (err) {
    console.error('Failed to load trust metrics:', err);
    const content = trustSection.querySelector('.trust-loading');
    if (content) {
      content.textContent = 'Trust analysis unavailable';
      content.classList.add('trust-error');
    }
  }
};

/**
 * Create the main trust score display with a visual gauge.
 */
const createTrustScoreDisplay = (score, autonomous, codebaseArea) => {
  const percentage = Math.round(score * 100);
  const level = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';

  const handleViewInDashboard = () => {
    // If we have a codebase area, filter to it
    if (codebaseArea) {
      setFilters({ folder: codebaseArea });
    }
    setView('trust-dashboard');
    setSelectedSession(null);
  };

  return div({ className: 'trust-score-display' }, [
    div({ className: 'trust-score-header' }, [
      span({ className: 'trust-score-label' }, 'Trust Score'),
      span({ className: `trust-score-value trust-${level}` }, `${percentage}%`)
    ]),
    div({ className: 'trust-score-bar' }, [
      div({
        className: `trust-score-fill trust-${level}`,
        style: { width: `${percentage}%` }
      })
    ]),
    div({ className: 'trust-score-status' }, [
      autonomous
        ? span({ className: 'badge badge-assistant' }, 'Autonomous')
        : span({ className: 'badge badge-user' }, 'Steered'),
      span({ className: 'trust-level-text' }, getTrustLevelText(level))
    ]),
    div({ className: 'trust-score-actions' }, [
      button({
        className: 'btn btn-link',
        onClick: handleViewInDashboard
      }, 'View in Dashboard →')
    ])
  ]);
};

const getTrustLevelText = (level) => {
  const texts = {
    high: 'High confidence - ran smoothly',
    medium: 'Moderate - some steering needed',
    low: 'Low confidence - significant intervention'
  };
  return texts[level] || '';
};

const createTrustMetric = (label, value) => {
  return div({ className: 'trust-metric' }, [
    span({ className: 'trust-metric-label' }, label),
    span({ className: 'trust-metric-value' }, value)
  ]);
};

/**
 * Check if there are any outcomes to display.
 */
const hasOutcomes = (outcomes) => {
  return (outcomes.commits && outcomes.commits.length > 0) ||
         (outcomes.pushes && outcomes.pushes.length > 0) ||
         (outcomes.ticketStateChanges && outcomes.ticketStateChanges.length > 0);
};

/**
 * Render session outcomes.
 */
const renderOutcomes = (outcomes) => {
  const items = [];

  // Render commits
  if (outcomes.commits && outcomes.commits.length > 0) {
    for (const commit of outcomes.commits) {
      items.push(
        div({ className: 'outcome-item outcome-commit' }, [
          span({ className: 'outcome-icon' }, '\u2713'),
          span({ className: 'outcome-label' }, 'Committed:'),
          span({ className: 'outcome-value' }, truncate(commit.message, 50))
        ])
      );
    }
  }

  // Render pushes
  if (outcomes.pushes && outcomes.pushes.length > 0) {
    for (const push of outcomes.pushes) {
      items.push(
        div({ className: 'outcome-item outcome-push' }, [
          span({ className: 'outcome-icon' }, '\u2713'),
          span({ className: 'outcome-label' }, 'Pushed to'),
          span({ className: 'outcome-value' }, `${push.remote}/${push.branch}`)
        ])
      );
    }
  }

  // Render ticket completions
  if (outcomes.ticketStateChanges && outcomes.ticketStateChanges.length > 0) {
    for (const change of outcomes.ticketStateChanges) {
      const label = change.newState.toLowerCase().includes('done') ||
                    change.newState.toLowerCase().includes('complete')
        ? 'Completed:'
        : `Changed to ${change.newState}:`;
      items.push(
        div({ className: 'outcome-item outcome-ticket' }, [
          span({ className: 'outcome-icon' }, '\u2713'),
          span({ className: 'outcome-label' }, label),
          span({ className: 'outcome-value' }, change.ticketId)
        ])
      );
    }
  }

  return items;
};

/**
 * Get display text for ticket source types.
 */
const getSourceTypeDisplay = (sourceType) => {
  const displays = {
    branch: 'branch',
    commit: 'commit',
    mcp_create: 'created',
    mcp_update: 'updated',
    mcp_complete: 'completed',
    mcp_comment: 'commented',
    mcp_read: 'read',
    mention: 'mentioned'
  };
  return displays[sourceType] || sourceType;
};

/**
 * Render ticket references.
 */
const renderTicketReferences = (ticketRefs) => {
  return ticketRefs.map(ref => {
    const icon = ref.relationship === 'worked' ? '\uD83C\uDFAF' : '\uD83D\uDCD6';
    const relationLabel = ref.relationship === 'worked' ? 'worked' : 'referenced';

    // Summarize sources
    const sourceTypes = [...new Set(ref.sources.map(s => getSourceTypeDisplay(s.type)))];
    const sourceSummary = sourceTypes.join(', ');

    return div({ className: `ticket-ref ticket-ref-${ref.relationship}` }, [
      span({ className: 'ticket-ref-icon' }, icon),
      span({ className: 'ticket-ref-id' }, ref.ticketId),
      span({ className: 'ticket-ref-relation' }, `(${relationLabel})`),
      span({ className: 'ticket-ref-sources' }, `- ${sourceSummary}`)
    ]);
  });
};
