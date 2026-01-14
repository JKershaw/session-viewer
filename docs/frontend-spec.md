# Claude Code Session Analyzer - Frontend Specification

## Purpose

The Claude Code Session Analyzer provides a visual interface for analyzing Claude Code coding sessions. Users can explore session timelines, inspect event details, and understand token usage patterns across their development work.

---

## Views

### Timeline View (Primary)

The timeline view displays sessions as horizontal bars on a continuous time axis.

#### Time Navigation

- **Horizontal scrolling** navigates through time - no navigation buttons
- Scrolling toward the left edge loads earlier sessions automatically
- Scrolling toward the right edge loads later sessions automatically
- Loading triggers when scroll position reaches 80% toward either edge
- A loading indicator appears during data fetch
- Sessions appear smoothly without layout jumps

#### Time Axis

- Fixed position at the top of the timeline area
- Displays time markers with adaptive intervals:
  - When zoomed in: hours and minutes (e.g., "14:00", "14:30")
  - When zoomed out: days (e.g., "Mon 13", "Tue 14")
- Vertical grid lines extend through the session rows
- Day boundaries marked with stronger visual weight
- "Now" indicator shows current time when visible in viewport

#### Zoom Behavior

- Pinch gesture on trackpad adjusts zoom level
- Scroll wheel with modifier key (Ctrl/Cmd) adjusts zoom level
- Zoom maintains the center point of the viewport
- Smooth animated transitions between zoom levels
- Zoom range: from 1 hour to 7 days visible

---

## Session Rows

Each row represents one session (or merged sessions sharing a parent ID).

### Row Layout

- Fixed height: approximately 22 pixels
- Minimal vertical gap between rows: 2 pixels
- Left column displays session label (sticky during horizontal scroll)
- Session bar positioned according to actual start/end time

### Session Labels

- Default: folder name (last path component)
- When grouped by ticket: Linear ticket identifier
- Truncated with ellipsis if too long

### Session Bars

- Width represents actual session duration
- Positioned absolutely on the time axis
- Contains colored segments representing events

### Event Segments

Events within a session render as colored segments:

| Event Type | Color | Hex |
|------------|-------|-----|
| User message | Blue | #4a90d9 |
| Assistant message | Purple | #9b59b6 |
| Tool call | Orange | #f39c12 |
| Git operation | Green | #2ecc71 |
| Error | Red | #e74c3c |
| Planning mode | Teal | #1abc9c |

Segment width is proportional to token count (default) or duration (time mode).

### Interactions

- **Hover** on session bar: tooltip appears with summary
- **Click** on session bar: detail panel opens
- **Click** on specific segment: detail panel opens scrolled to that event

---

## Session Detail Panel

A slide-out panel displaying comprehensive session information.

### Panel Behavior

- Slides in from the right edge of the screen
- Width: 450 pixels
- Overlays the timeline content
- Does not push timeline content

### Close Actions

- Click the X button in panel header
- Click outside the panel (on timeline area)
- Press Escape key

### Panel Sections

#### Header
- Session ID (truncated, copyable)
- Close button

#### Metadata
- Folder path
- Git branch name
- Start time (formatted)
- End time (formatted)
- Duration (human readable, e.g., "2h 15m")
- Total tokens (formatted, e.g., "45.2K")
- Merge indicator: "Merged from N sessions" (if applicable)

#### Analysis Status
- Shows "Analyzed" or "Not analyzed"
- "Analyze" button triggers LLM analysis
- Progress indicator during analysis

#### Events List

- Scrollable list of session events
- Sorted chronologically
- Lazy loads more events as user scrolls down (50 events per batch)

Each event shows:
- Type badge (colored by event type)
- Timestamp
- Token count
- Preview text (first 80 characters)
- Expand indicator

Expanding an event reveals:
- Full event content
- Tool input/output (for tool calls)
- Error details (for errors)

#### Annotations (if analyzed)
- List of AI-generated annotations
- Each shows: type, summary, confidence percentage
- Types: decision, blocker, rework, goal_shift

#### Git Correlations
- List of matched git commits
- Each shows: commit hash (linked), message, author, timestamp

---

## Filters

Filter controls reduce the visible sessions.

### Filter Fields

| Filter | Type | Behavior |
|--------|------|----------|
| Date From | Date picker | Sessions starting on or after this date |
| Date To | Date picker | Sessions starting on or before this date |
| Folder | Dropdown | Partial match on folder path |
| Branch | Dropdown | Exact match on git branch |
| Ticket | Dropdown | Exact match on Linear ticket ID |

### Filter Behavior

- Changes apply immediately (no submit button)
- Filtering happens server-side
- Timeline reloads with filtered results
- Filter state persists in URL query parameters
- "Clear Filters" button resets all filters

### Dropdown Population

- Folder: unique folder paths from sessions
- Branch: unique branch names from sessions
- Ticket: synced Linear tickets

---

## Header

### Elements

- Application title: "Claude Code Session Analyzer"
- View mode toggle (if List view retained): List | Timeline
- Refresh button: rescans log files
- Sync Linear button: syncs tickets from Linear API

### Button States

- Refresh: shows spinner during scan
- Sync Linear: shows spinner during sync
- Both disabled during their respective operations

---

## Grouping Modes

### By Session (Default)

- Each row is one session
- Label shows folder name

### By Ticket

- Sessions grouped by Linear ticket ID
- Row shows ticket identifier
- Bar shows aggregated events from all linked sessions
- Sessions without tickets grouped as "Unlinked"

---

## Tooltip

Appears on hover over session bars.

### Content

- Session folder
- Start time
- Duration
- Token count
- Event count by type

### Behavior

- Appears after brief hover delay (200ms)
- Follows cursor position
- Repositions to stay within viewport
- Disappears immediately on mouse leave

---

## Loading States

### Initial Load

- Skeleton placeholder for timeline area
- "Loading sessions..." text

### Infinite Scroll Loading

- Small spinner at the edge being scrolled toward
- Sessions already loaded remain visible and interactive

### Detail Panel Loading

- Skeleton for events list
- Metadata loads first, events load progressively

### Refresh Operation

- Header refresh button shows spinner
- Timeline content remains visible but slightly dimmed
- After completion, timeline reloads with new data

---

## Error States

### Network Error

- Toast notification with error message
- Retry button in notification
- Previous data remains visible if available

### Empty Results

- "No sessions found" message in timeline area
- If filters active: "Try adjusting your filters"

### Session Not Found

- Detail panel shows error state
- "Session not found" message
- Close button to dismiss

---

## Responsive Behavior

### Minimum Width

- 1024 pixels
- Below this, horizontal scroll on entire page

### Panel Adaptation

- On narrower screens, detail panel takes full width
- Closes existing panel before opening new one

### Touch Support

- Swipe gesture for horizontal scroll
- Tap for selection
- Long press for tooltip (mobile)

---

## Performance Requirements

- Initial load completes within 500ms (excluding network)
- Scroll remains smooth at 60fps with 1000+ sessions
- Infinite scroll fetch completes within 200ms perceived latency
- Detail panel opens within 100ms (events load progressively)

---

## Accessibility

- Keyboard navigation for all interactive elements
- Tab order: filters, header buttons, session rows, detail panel
- Arrow keys navigate between sessions
- Enter/Space opens selected session
- ARIA labels for all controls
- Sufficient color contrast (WCAG AA)
- Screen reader announces loading states
