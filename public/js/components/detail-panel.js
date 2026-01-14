/**
 * Detail panel component for showing session details.
 */
import { store, setSelectedSession } from '../state/store.js';
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
  panelEl.classList.remove('open');
  setSelectedSession(null);
};

const renderContent = (session) => {
  clearChildren(contentEl);

  // Metadata
  const metadata = div({ className: 'panel-metadata' }, [
    createMetadataItem('Folder', getFolderName(session.folder), true, true),
    createMetadataItem('Branch', session.branch || '-'),
    createMetadataItem('Ticket', session.linearTicketId || '-'),
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

  // Analysis status
  const analysisSection = div({ className: 'panel-section' }, [
    div({ className: 'panel-section-title' }, 'Analysis'),
    session.analyzed
      ? div({}, 'Session has been analyzed')
      : button({
          className: 'btn btn-primary',
          onClick: () => handleAnalyze(session.id)
        }, 'Analyze with AI')
  ]);
  contentEl.appendChild(analysisSection);

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

const handleAnalyze = async (sessionId) => {
  try {
    await api.analyzeSession(sessionId);
    // Could poll for job status here
  } catch (err) {
    console.error('Analysis failed:', err);
  }
};
