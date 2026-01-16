/**
 * Timeline component for displaying sessions.
 */
import { store, setSelectedSession, setTimeline, setSessions, setLoading, setVisibleTimeRange } from '../state/store.js';
import { api } from '../api/client.js';
import { div, clearChildren } from '../utils/dom.js';
import { formatAxisTime, getFolderName, formatDuration, formatTokens } from '../utils/formatters.js';
import { throttle } from '../utils/debounce.js';
import { showTooltip, hideTooltip } from './tooltip.js';

const MIN_BAR_WIDTH = 16;
const MIN_ZOOM = 1;      // At zoom 0: 1x (fit viewport)
const MAX_ZOOM = 500;    // At zoom 100: 500x viewport width
const TIMELINE_PADDING = 100; // Padding on left/right for labels to not clip
const GAP_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour - gap to reset swim lanes
const ROW_HEIGHT = 35;   // Fixed row height
const ROW_GAP = 2;
const IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes - gap to show as idle

/**
 * Assigns sessions to swim lanes with fixed row heights.
 *
 * @param {Array} sessions - Sessions with startTime and endTime
 * @param {Object} options - Configuration options
 * @param {number} options.gapThreshold - Gap in ms to trigger lane reset
 * @returns {{ assignments: Map, totalHeight: number }}
 */
const assignLanes = (sessions, options = {}) => {
  const { gapThreshold = GAP_THRESHOLD_MS } = options;

  const sorted = [...sessions].sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  // Identify clusters and assign lanes
  const clusters = [];
  let currentCluster = { sessions: [], maxLane: 0 };
  let latestEndTime = 0;
  let currentLane = 0;

  for (const session of sorted) {
    const start = new Date(session.startTime).getTime();
    const end = new Date(session.endTime).getTime();

    // Gap detected - start new cluster
    if (latestEndTime > 0 && start > latestEndTime + gapThreshold) {
      if (currentCluster.sessions.length > 0) {
        clusters.push(currentCluster);
      }
      currentCluster = { sessions: [], maxLane: 0 };
      currentLane = 0;
    }

    currentCluster.sessions.push({ session, lane: currentLane });
    currentCluster.maxLane = Math.max(currentCluster.maxLane, currentLane);
    currentLane++;
    latestEndTime = Math.max(latestEndTime, end);
  }
  if (currentCluster.sessions.length > 0) {
    clusters.push(currentCluster);
  }

  // Assign positions using fixed height
  const assignments = new Map();
  let maxClusterHeight = 0;

  for (const cluster of clusters) {
    for (const { session, lane } of cluster.sessions) {
      assignments.set(session.id, {
        lane,
        top: lane * (ROW_HEIGHT + ROW_GAP),
        height: ROW_HEIGHT
      });
    }

    // Track the tallest cluster for container height
    const clusterHeight = (cluster.maxLane + 1) * (ROW_HEIGHT + ROW_GAP);
    maxClusterHeight = Math.max(maxClusterHeight, clusterHeight);
  }

  return { assignments, totalHeight: maxClusterHeight };
};

let timelineArea = null;
let contentContainer = null;
let axisContent = null;

// Track time bounds for scroll position preservation
let currentMinTime = 0;
let currentMaxTime = 0;
let currentDrawableWidth = 0;

// Convert zoom level (0-100) to zoom factor using exponential scale
// This makes the slider feel more responsive - small changes at low zoom, bigger at high
const zoomLevelToFactor = (zoomLevel) => {
  // Exponential: factor = MIN_ZOOM * (MAX_ZOOM/MIN_ZOOM)^(level/100)
  return MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, zoomLevel / 100);
};

// Convert zoom factor back to level (for scroll wheel zoom)
const zoomFactorToLevel = (factor) => {
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, factor));
  return 100 * Math.log(clamped / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM);
};

// Calculate content width based on zoom level
// Returns { totalWidth, drawableWidth } where drawableWidth excludes padding
const calculateContentWidth = (timeRange, zoomLevel) => {
  const zoomFactor = zoomLevelToFactor(zoomLevel);

  // Use a conservative default if timelineArea isn't ready yet
  // This accounts for the detail panel taking ~40% of width
  // ResizeObserver will correct this once layout completes
  const defaultViewportWidth = Math.floor((window.innerWidth || 1200) * 0.6);

  if (!timelineArea) {
    const baseWidth = defaultViewportWidth - 2 * TIMELINE_PADDING;
    const drawableWidth = Math.max(baseWidth, 200) * zoomFactor;
    const totalWidth = drawableWidth + 2 * TIMELINE_PADDING;
    return { totalWidth, drawableWidth };
  }

  const viewportWidth = timelineArea.clientWidth;
  if (viewportWidth <= 0) {
    const baseWidth = defaultViewportWidth - 2 * TIMELINE_PADDING;
    const drawableWidth = Math.max(baseWidth, 200) * zoomFactor;
    const totalWidth = drawableWidth + 2 * TIMELINE_PADDING;
    return { totalWidth, drawableWidth };
  }

  const baseWidth = viewportWidth - 2 * TIMELINE_PADDING;
  const drawableWidth = Math.max(baseWidth, 200) * zoomFactor;
  const totalWidth = drawableWidth + 2 * TIMELINE_PADDING;

  return { totalWidth, drawableWidth };
};

// Get the time at a specific x position in the timeline
const getTimeAtPosition = (x) => {
  if (currentDrawableWidth <= 0) return currentMinTime;
  const timeRange = currentMaxTime - currentMinTime;
  const relativeX = x - TIMELINE_PADDING;
  return currentMinTime + (relativeX / currentDrawableWidth) * timeRange;
};

// Get the x position for a specific time
const getPositionForTime = (time) => {
  if (currentDrawableWidth <= 0) return TIMELINE_PADDING;
  const timeRange = currentMaxTime - currentMinTime;
  return TIMELINE_PADDING + ((time - currentMinTime) / timeRange) * currentDrawableWidth;
};

export const initTimeline = (container) => {
  // Check for existing server-rendered structure (EJS)
  let axis = container.querySelector('.timeline-axis');
  timelineArea = container.querySelector('.timeline-area');
  contentContainer = container.querySelector('.timeline-content');

  // Create structure only if not already rendered by server
  if (!axis) {
    axis = div({ className: 'timeline-axis' }, [
      div({ className: 'timeline-axis-content', id: 'timeline-axis-content' })
    ]);
    container.appendChild(axis);
  } else if (!axis.querySelector('.timeline-axis-content')) {
    // Axis exists but needs inner content element
    const axisInner = div({ className: 'timeline-axis-content', id: 'timeline-axis-content' });
    axis.appendChild(axisInner);
  }

  if (!timelineArea) {
    timelineArea = div({ className: 'timeline-area' });
    container.appendChild(timelineArea);
  }

  if (!contentContainer) {
    contentContainer = div({ className: 'timeline-content' });
    timelineArea.appendChild(contentContainer);
  }

  axisContent = document.getElementById('timeline-axis-content');

  // Update visible time range in store
  const updateVisibleTimeRange = () => {
    if (!timelineArea || currentDrawableWidth <= 0) return;
    const scrollLeft = timelineArea.scrollLeft;
    const viewportWidth = timelineArea.clientWidth;
    const visibleStart = getTimeAtPosition(scrollLeft);
    const visibleEnd = getTimeAtPosition(scrollLeft + viewportWidth);
    setVisibleTimeRange(visibleStart, visibleEnd);
  };

  // Scroll handler to sync axis with timeline and update visible range
  const handleScroll = throttle(() => {
    if (axisContent) {
      axisContent.style.transform = `translateX(-${timelineArea.scrollLeft}px)`;
    }
    updateVisibleTimeRange();
  }, 100);

  timelineArea.addEventListener('scroll', handleScroll);

  // Drag-to-scroll on axis
  let isDragging = false;
  let dragStartX = 0;
  let scrollStartLeft = 0;

  axis.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    scrollStartLeft = timelineArea.scrollLeft;
    axis.style.cursor = 'grabbing';
    e.preventDefault(); // Prevent text selection
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = dragStartX - e.clientX;
    timelineArea.scrollLeft = scrollStartLeft + deltaX;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      axis.style.cursor = '';
      timelineArea.style.cursor = '';
    }
  });

  // Drag-to-scroll on timeline area (same as axis)
  timelineArea.addEventListener('mousedown', (e) => {
    // Don't interfere with clicking on session bars
    if (e.target.closest('.session-bar')) return;

    isDragging = true;
    dragStartX = e.clientX;
    scrollStartLeft = timelineArea.scrollLeft;
    timelineArea.style.cursor = 'grabbing';
    e.preventDefault();
  });

  // Track pending zoom anchor for scroll position restoration
  let pendingZoomAnchor = null;

  // Ctrl/Cmd + wheel to zoom
  timelineArea.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;

    e.preventDefault();

    const state = store.getState();
    const currentZoom = state.timeline.zoomLevel;
    const currentFactor = zoomLevelToFactor(currentZoom);

    // Zoom in/out by 20% per wheel tick
    const zoomDelta = e.deltaY > 0 ? 0.8 : 1.25;
    const newFactor = currentFactor * zoomDelta;
    const newZoom = Math.round(zoomFactorToLevel(newFactor));

    if (newZoom !== currentZoom) {
      // Get the time at mouse position before zoom
      const rect = timelineArea.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + timelineArea.scrollLeft;
      const anchorTime = getTimeAtPosition(mouseX);
      const mouseOffsetInViewport = e.clientX - rect.left;

      // Store anchor for scroll restoration after render
      pendingZoomAnchor = { time: anchorTime, viewportOffset: mouseOffsetInViewport };

      setTimeline({ zoomLevel: newZoom });
    }
  }, { passive: false });

  // Subscribe to state changes
  store.subscribe((state, prevState) => {
    const sessionsChanged = state.sessions !== prevState.sessions;
    const zoomChanged = state.timeline.zoomLevel !== prevState.timeline.zoomLevel;
    const loadingChanged = state.loading !== prevState.loading;

    if (sessionsChanged || zoomChanged || loadingChanged) {
      // If zoom changed via slider (not wheel), anchor to center of viewport
      if (zoomChanged && !pendingZoomAnchor && timelineArea) {
        const centerX = timelineArea.scrollLeft + timelineArea.clientWidth / 2;
        const anchorTime = getTimeAtPosition(centerX);
        pendingZoomAnchor = { time: anchorTime, viewportOffset: timelineArea.clientWidth / 2 };
      }

      render();

      // Restore scroll position after render if we have an anchor
      if (pendingZoomAnchor && timelineArea) {
        const newX = getPositionForTime(pendingZoomAnchor.time);
        timelineArea.scrollLeft = newX - pendingZoomAnchor.viewportOffset;
        pendingZoomAnchor = null;
      }

      // Update visible time range after render
      updateVisibleTimeRange();
    }
  });

  // Track last known width to avoid unnecessary re-renders
  let lastKnownWidth = 0;

  // ResizeObserver to handle initial sizing and window resizes
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const newWidth = entry.contentRect.width;
      if (newWidth > 0 && newWidth !== lastKnownWidth) {
        lastKnownWidth = newWidth;
        const state = store.getState();
        if (state.sessions.length > 0) {
          render();
          updateVisibleTimeRange();
        }
      }
    }
  });
  resizeObserver.observe(timelineArea);

  // Initial load
  loadInitialSessions();
};

const loadInitialSessions = async () => {
  setLoading(true);
  try {
    const result = await api.getSessions({
      limit: 10000,
      includeEvents: true
    });

    // Sort by startTime descending (most recent first) to ensure correct vertical order
    // Handle invalid/empty dates by pushing them to the end
    const sortedSessions = result.data.sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : NaN;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : NaN;
      const validA = !isNaN(timeA);
      const validB = !isNaN(timeB);

      // Push invalid dates to the end
      if (!validA && !validB) return 0;
      if (!validA) return 1;
      if (!validB) return -1;

      // Both valid - sort descending (most recent first)
      return timeB - timeA;
    });

    setSessions(sortedSessions);

    // After initial load, scroll to show the past 24 hours
    requestAnimationFrame(() => {
      scrollToLast24Hours();
    });
  } catch (err) {
    console.error('Failed to load sessions:', err);
  } finally {
    setLoading(false);
  }
};

// Zoom and scroll the timeline to show the past 24 hours
const scrollToLast24Hours = () => {
  if (!timelineArea || currentDrawableWidth <= 0) return;

  const dataRange = currentMaxTime - currentMinTime;
  const targetRange = 24 * 60 * 60 * 1000; // 24 hours in ms

  // If data range is less than 24 hours, no need to zoom
  if (dataRange <= targetRange) return;

  // Calculate zoom factor needed: dataRange / targetRange
  // Then convert to zoom level using inverse of zoomLevelToFactor
  const neededFactor = dataRange / targetRange;
  const zoomLevel = Math.round(zoomFactorToLevel(neededFactor));

  // Set the zoom level (this triggers a re-render)
  setTimeline({ zoomLevel: Math.min(zoomLevel, 100) });

  // After zoom is applied, scroll to show the most recent 24 hours
  requestAnimationFrame(() => {
    const now = Date.now();
    const oneDayAgo = now - targetRange;

    // Calculate position for 24 hours ago and scroll there
    const targetX = getPositionForTime(oneDayAgo);
    timelineArea.scrollLeft = Math.max(0, targetX - TIMELINE_PADDING);
  });
};

const render = () => {
  const state = store.getState();
  const { sessions, loading, timeline } = state;

  clearChildren(contentContainer);

  if (loading && sessions.length === 0) {
    contentContainer.appendChild(
      div({ className: 'timeline-loading' }, [
        div({ className: 'spinner' }),
        'Loading sessions...'
      ])
    );
    return;
  }

  if (sessions.length === 0) {
    contentContainer.appendChild(
      div({ className: 'timeline-empty' }, [
        div({}, 'No sessions found'),
        div({}, 'Try adjusting your filters or refreshing')
      ])
    );
    return;
  }

  // Filter out sessions with invalid timestamps
  const validSessions = sessions.filter(s => {
    const start = new Date(s.startTime).getTime();
    const end = new Date(s.endTime).getTime();
    return !isNaN(start) && !isNaN(end);
  });

  if (validSessions.length === 0) {
    contentContainer.appendChild(
      div({ className: 'timeline-empty' }, [
        div({}, 'No sessions with valid timestamps'),
        div({}, 'Try refreshing the session data')
      ])
    );
    return;
  }

  // Calculate time bounds
  const times = validSessions.flatMap(s => [new Date(s.startTime).getTime(), new Date(s.endTime).getTime()]);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime || 1;

  // Content width based on zoom level (0 = fit all, 100 = max zoom)
  const { totalWidth, drawableWidth } = calculateContentWidth(timeRange, timeline.zoomLevel);
  contentContainer.style.width = `${totalWidth}px`;

  // Store current bounds for scroll position calculations
  currentMinTime = minTime;
  currentMaxTime = maxTime;
  currentDrawableWidth = drawableWidth;

  // Render time axis (with padding offset)
  renderAxis(minTime, maxTime, drawableWidth, TIMELINE_PADDING, timeline.zoomLevel);

  // Assign sessions to swim lanes
  const { assignments, totalHeight } = assignLanes(validSessions, {
    gapThreshold: GAP_THRESHOLD_MS
  });

  // Render rows container with calculated height
  const rowsContainer = div({
    className: 'timeline-rows',
    style: { height: `${totalHeight}px` }
  });

  validSessions.forEach((session) => {
    const laneInfo = assignments.get(session.id) || { lane: 0, top: 0, height: ROW_HEIGHT };
    const bar = createSessionBar(session, minTime, timeRange, drawableWidth, TIMELINE_PADDING, laneInfo);
    rowsContainer.appendChild(bar);
  });

  contentContainer.appendChild(rowsContainer);

  // Add now indicator if visible
  const now = Date.now();
  if (now >= minTime && now <= maxTime) {
    const nowPosition = TIMELINE_PADDING + ((now - minTime) / timeRange) * drawableWidth;
    const nowIndicator = div({
      className: 'timeline-now',
      style: { left: `${nowPosition}px` }
    });
    contentContainer.appendChild(nowIndicator);
  }
};

/**
 * Nice interval values for the axis ruler (in milliseconds).
 * Ordered from finest to coarsest granularity.
 */
const NICE_INTERVALS = [
  { ms: 60 * 1000,               label: '1min' },
  { ms: 5 * 60 * 1000,           label: '5min' },
  { ms: 15 * 60 * 1000,          label: '15min' },
  { ms: 30 * 60 * 1000,          label: '30min' },
  { ms: 60 * 60 * 1000,          label: '1hour' },
  { ms: 2 * 60 * 60 * 1000,      label: '2hour' },
  { ms: 6 * 60 * 60 * 1000,      label: '6hour' },
  { ms: 12 * 60 * 60 * 1000,     label: '12hour' },
  { ms: 24 * 60 * 60 * 1000,     label: '1day' },
  { ms: 7 * 24 * 60 * 60 * 1000, label: '1week' },
];

/**
 * Select the appropriate tick interval based on visible time range.
 * Goal: ~10-15 ticks visible in the viewport.
 */
const selectTickInterval = (visibleTimeRangeMs) => {
  const TARGET_TICKS = 12;
  const idealInterval = visibleTimeRangeMs / TARGET_TICKS;

  // Find first nice interval >= ideal
  const selected = NICE_INTERVALS.find(i => i.ms >= idealInterval);
  return selected || NICE_INTERVALS[NICE_INTERVALS.length - 1];
};

/**
 * Determine if a tick is "major" (deserves visual emphasis).
 */
const isMajorTick = (date, intervalMs) => {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  if (intervalMs >= ONE_DAY) {
    // For day+ intervals: Monday is major
    return date.getDay() === 1;
  } else if (intervalMs >= ONE_HOUR) {
    // For hour intervals: midnight is major
    return date.getHours() === 0;
  } else {
    // For minute intervals: top of hour is major
    return date.getMinutes() === 0;
  }
};

/**
 * Format tick label based on interval scale.
 */
const formatTickLabel = (date, intervalMs) => {
  const ONE_DAY = 24 * 60 * 60 * 1000;

  if (intervalMs >= ONE_DAY) {
    // Show day name and date: "Mon 13"
    return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
  } else {
    // Show time: "2:00 PM" or "2:15 PM"
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
};

/**
 * Render the time axis with zoom-adaptive tick intervals.
 *
 * The axis works like a tape measure: zooming in reveals finer detail.
 *
 * @param {number} minTime - Start of data range (ms timestamp)
 * @param {number} maxTime - End of data range (ms timestamp)
 * @param {number} drawableWidth - Pixel width for time content
 * @param {number} padding - Padding on each side (pixels)
 * @param {number} zoomLevel - Current zoom level (0-100)
 */
const renderAxis = (minTime, maxTime, drawableWidth, padding, zoomLevel) => {
  if (!axisContent) return;

  clearChildren(axisContent);

  // Set axis container width
  const totalWidth = drawableWidth + 2 * padding;
  axisContent.style.width = `${totalWidth}px`;

  const timeRange = maxTime - minTime;
  if (timeRange <= 0) return;

  // Calculate visible time range based on zoom
  // zoomLevel 0 = 1x (see all), zoomLevel 100 = 50x (see 1/50th)
  const zoomFactor = zoomLevelToFactor(zoomLevel);
  const visibleTimeRange = timeRange / zoomFactor;

  // Select tick interval based on what's visible
  const interval = selectTickInterval(visibleTimeRange);
  const intervalMs = interval.ms;

  // Calculate time-to-pixel conversion
  const timeToX = (time) => padding + ((time - minTime) / timeRange) * drawableWidth;

  // Start at first interval boundary >= minTime
  const startTick = Math.ceil(minTime / intervalMs) * intervalMs;

  // Create ticks
  let tickCount = 0;
  for (let time = startTick; time <= maxTime; time += intervalMs) {
    const x = timeToX(time);
    const date = new Date(time);
    const major = isMajorTick(date, intervalMs);
    const label = formatTickLabel(date, intervalMs);

    const tick = div({
      className: `timeline-axis-tick ${major ? 'major' : ''}`,
      style: { left: `${x}px` }
    }, label);

    axisContent.appendChild(tick);
  }
};

const createSessionBar = (session, minTime, timeRange, drawableWidth, padding, laneInfo) => {
  const { top, height } = laneInfo;
  const startTime = new Date(session.startTime).getTime();
  const endTime = new Date(session.endTime).getTime();

  const left = padding + ((startTime - minTime) / timeRange) * drawableWidth;
  const width = Math.max(MIN_BAR_WIDTH, ((endTime - startTime) / timeRange) * drawableWidth);

  const bar = div({
    className: 'session-bar',
    style: {
      left: `${left}px`,
      width: `${width}px`,
      top: `${top}px`,
      height: `${height}px`
    },
    onClick: () => handleSessionClick(session),
    onMouseenter: (e) => handleBarHover(e, session),
    onMouseleave: () => hideTooltip()
  });

  // Add event segments container (clips to border radius)
  const segmentsContainer = div({ className: 'session-bar-segments' });
  bar.appendChild(segmentsContainer);

  // Add event segments if events are available (time-based positioning)
  if (session.events && session.events.length > 0) {
    const sessionDuration = endTime - startTime;
    if (sessionDuration > 0) {
      const segments = aggregateEventsByTime(session.events, startTime, endTime);
      segments.forEach(segment => {
        // Check if segment has activity ranges with idle periods
        if (segment.activityRanges && segment.activityRanges.length > 1) {
          // Render sub-segments for active/idle periods
          segment.activityRanges.forEach(range => {
            const rangeLeft = ((range.start - startTime) / sessionDuration) * 100;
            const rangeWidth = ((range.end - range.start) / sessionDuration) * 100;
            const subSegmentEl = div({
              className: `event-segment ${getEventClass(segment.type)}${range.isIdle ? ' idle' : ''}`,
              style: {
                left: `${rangeLeft}%`,
                width: `${Math.max(0.5, rangeWidth)}%`
              }
            });
            segmentsContainer.appendChild(subSegmentEl);
          });
        } else {
          // No idle periods - render as single segment
          const segmentLeft = ((segment.startTime - startTime) / sessionDuration) * 100;
          const segmentWidth = ((segment.endTime - segment.startTime) / sessionDuration) * 100;
          const segmentEl = div({
            className: `event-segment ${getEventClass(segment.type)}`,
            style: {
              left: `${segmentLeft}%`,
              width: `${Math.max(0.5, segmentWidth)}%`
            }
          });
          segmentsContainer.appendChild(segmentEl);
        }
      });
    }
  }

  // Add label overlay (extends beyond bar if needed)
  const labelEl = div({
    className: 'session-bar-label'
  }, getFolderName(session.folder));
  bar.appendChild(labelEl);

  return bar;
};

/**
 * Aggregate consecutive events of the same type into time-based segments.
 * Each segment has a start and end time based on actual event timestamps.
 * Handles missing, invalid, or out-of-bounds timestamps gracefully:
 * - Invalid session bounds: returns empty array
 * - Missing/invalid event timestamps: events are filtered out
 * - Out-of-bounds events: clamped to session bounds (with 1min tolerance)
 * - Zero/negative duration segments: filtered out
 *
 * @param {Array} events - Events with timestamp and type
 * @param {number} sessionStartTime - Session start time in ms
 * @param {number} sessionEndTime - Session end time in ms
 * @returns {Array} Segments with { type, startTime, endTime, count }
 */
const aggregateEventsByTime = (events, sessionStartTime, sessionEndTime) => {
  if (!events || events.length === 0) return [];

  // Validate session bounds
  if (isNaN(sessionStartTime) || isNaN(sessionEndTime) || sessionEndTime <= sessionStartTime) {
    return [];
  }

  // Filter and parse events with valid timestamps within session bounds
  const tolerance = 60000; // 1 minute tolerance for clock skew
  const validEvents = events
    .map(event => {
      const time = event.timestamp ? new Date(event.timestamp).getTime() : NaN;
      return { ...event, _parsedTime: time };
    })
    .filter(event => {
      // Must have valid timestamp
      if (isNaN(event._parsedTime)) return false;
      // Must be within session bounds (with tolerance)
      return event._parsedTime >= sessionStartTime - tolerance &&
             event._parsedTime <= sessionEndTime + tolerance;
    })
    .sort((a, b) => a._parsedTime - b._parsedTime);

  if (validEvents.length === 0) return [];

  const segments = [];
  let currentSegment = null;

  validEvents.forEach((event) => {
    // Clamp event time to session bounds
    const eventTime = Math.max(sessionStartTime, Math.min(sessionEndTime, event._parsedTime));

    if (!currentSegment || currentSegment.type !== event.type) {
      // Close previous segment - its end time is this event's start time
      if (currentSegment) {
        currentSegment.endTime = eventTime;
        // Only add segment if it has positive duration
        if (currentSegment.endTime > currentSegment.startTime) {
          // Compute activity ranges for idle detection
          currentSegment.activityRanges = computeActivityRanges(
            currentSegment.timestamps,
            currentSegment.startTime,
            currentSegment.endTime,
            IDLE_THRESHOLD_MS
          );
          segments.push(currentSegment);
        }
      }
      // Start new segment
      currentSegment = {
        type: event.type,
        startTime: eventTime,
        endTime: sessionEndTime, // Will be updated when next segment starts
        count: 1,
        timestamps: [eventTime] // Track individual event times for idle detection
      };
    } else {
      // Same type - extend current segment
      currentSegment.count++;
      currentSegment.timestamps.push(eventTime);
    }
  });

  // Push final segment (ends at session end)
  if (currentSegment && currentSegment.startTime < sessionEndTime) {
    currentSegment.endTime = sessionEndTime;
    if (currentSegment.endTime > currentSegment.startTime) {
      // Compute activity ranges for final segment
      currentSegment.activityRanges = computeActivityRanges(
        currentSegment.timestamps,
        currentSegment.startTime,
        currentSegment.endTime,
        IDLE_THRESHOLD_MS
      );
      segments.push(currentSegment);
    }
  }

  return segments;
};

/**
 * Compute active/idle ranges from event timestamps within a segment.
 * Gaps larger than the threshold are marked as idle periods.
 *
 * @param {Array<number>} timestamps - Event timestamps within the segment
 * @param {number} segmentStart - Segment start time in ms
 * @param {number} segmentEnd - Segment end time in ms
 * @param {number} idleThreshold - Gap threshold in ms to consider idle
 * @returns {Array<{start: number, end: number, isIdle: boolean}>}
 */
const computeActivityRanges = (timestamps, segmentStart, segmentEnd, idleThreshold) => {
  // Default: single active range if no timestamps or segment too short
  if (!timestamps || timestamps.length === 0 || segmentEnd - segmentStart <= idleThreshold) {
    return [{ start: segmentStart, end: segmentEnd, isIdle: false }];
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  const ranges = [];
  let rangeStart = segmentStart;

  for (let i = 0; i < sorted.length; i++) {
    const currentTime = sorted[i];
    const nextTime = sorted[i + 1];

    if (nextTime !== undefined) {
      const gap = nextTime - currentTime;

      if (gap > idleThreshold) {
        // Active period: from rangeStart to shortly after current event
        const activeEnd = currentTime + Math.min(idleThreshold / 2, gap / 2);
        if (activeEnd > rangeStart) {
          ranges.push({ start: rangeStart, end: activeEnd, isIdle: false });
        }

        // Idle period: gap between active periods
        const idleEnd = nextTime - Math.min(idleThreshold / 2, gap / 2);
        if (idleEnd > activeEnd) {
          ranges.push({ start: activeEnd, end: idleEnd, isIdle: true });
        }

        rangeStart = idleEnd;
      }
    }
  }

  // Handle trailing gap (last event to segment end)
  const lastEventTime = sorted[sorted.length - 1];
  const trailingGap = segmentEnd - lastEventTime;

  if (trailingGap > idleThreshold) {
    // Active period after last event
    const activeEnd = lastEventTime + idleThreshold / 2;
    if (activeEnd > rangeStart) {
      ranges.push({ start: rangeStart, end: activeEnd, isIdle: false });
    }
    // Trailing idle period
    if (segmentEnd > activeEnd) {
      ranges.push({ start: activeEnd, end: segmentEnd, isIdle: true });
    }
  } else {
    // No significant trailing gap - active to end
    if (segmentEnd > rangeStart) {
      ranges.push({ start: rangeStart, end: segmentEnd, isIdle: false });
    }
  }

  // If no ranges were created, return single active range
  if (ranges.length === 0) {
    return [{ start: segmentStart, end: segmentEnd, isIdle: false }];
  }

  return ranges;
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

const handleSessionClick = (session) => {
  setSelectedSession(session);
};

const handleBarHover = (event, session) => {
  const eventCounts = {};
  if (session.events) {
    session.events.forEach(e => {
      eventCounts[e.type] = (eventCounts[e.type] || 0) + 1;
    });
  }

  // Build rows including ticket info if available
  const rows = [
    { label: 'Duration', value: formatDuration(session.durationMs) },
    { label: 'Tokens', value: formatTokens(session.totalTokens) },
    { label: 'Events', value: String(session.events?.length || session.eventCount || 0) }
  ];

  // Add ticket info if available
  if (session.linearTicketId) {
    rows.push({ label: 'Ticket', value: session.linearTicketId });
  }

  // Add outcome summary if available
  if (session.outcomes) {
    const outcomeItems = [];
    if (session.outcomes.commits?.length > 0) {
      outcomeItems.push(`${session.outcomes.commits.length} commit${session.outcomes.commits.length > 1 ? 's' : ''}`);
    }
    if (session.outcomes.pushes?.length > 0) {
      outcomeItems.push('pushed');
    }
    if (session.outcomes.ticketStateChanges?.length > 0) {
      outcomeItems.push(`${session.outcomes.ticketStateChanges.length} ticket update${session.outcomes.ticketStateChanges.length > 1 ? 's' : ''}`);
    }
    if (outcomeItems.length > 0) {
      rows.push({ label: 'Outcomes', value: outcomeItems.join(', ') });
    }
  }

  showTooltip(event.clientX, event.clientY, {
    title: getFolderName(session.folder),
    rows,
    events: eventCounts
  });
};
