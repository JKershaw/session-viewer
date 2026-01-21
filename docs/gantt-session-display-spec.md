# Session Gantt Chart Display Specification

A specification for displaying AI coding assistant sessions as interactive Gantt-style timeline visualizations.

---

## Overview

This document describes a system for visualizing session logs as horizontal timeline bars, where each session is rendered as a row containing colored segments representing different event types. The visualization enables users to quickly understand session composition, identify patterns, and spot anomalies.

---

## Data Model

### Session

A session represents a single working period with an AI assistant.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique session identifier |
| startTime | ISO timestamp | When the session began |
| endTime | ISO timestamp | When the session ended |
| events | Event[] | Ordered list of events within the session |
| totalTokens | number | Cumulative token usage |
| folder | string | Working directory path |
| branch | string | Git branch name (optional) |

### Event

An event represents a discrete interaction or action within a session.

| Field | Type | Description |
|-------|------|-------------|
| type | EventType | Classification of the event |
| timestamp | ISO timestamp | When the event occurred |
| tokenCount | number | Tokens consumed by this event |

### EventType

Events are classified into six categories:

| Type | Description |
|------|-------------|
| `user_message` | Human input to the assistant |
| `assistant_message` | AI response text |
| `tool_call` | Tool/function invocation (file ops, search, etc.) |
| `git_op` | Git-specific operations (commit, push, etc.) |
| `error` | Errors or failures |
| `planning_mode` | Planning or reasoning phases |

---

## Event Classification

Events are classified by examining log entry properties in priority order:

1. **Error detection** — Check for error indicators first
2. **Tool detection** — Identify tool/function calls
3. **Git detection** — Within tool calls, detect git commands via pattern matching
4. **Message classification** — Classify by role (user vs assistant)
5. **Planning detection** — Within assistant messages, detect planning language patterns

### Git Command Detection

Git operations are identified by matching tool call content against patterns:
- Commands starting with `git` followed by subcommands (push, pull, commit, etc.)

### Planning Mode Detection

Planning is detected by matching assistant message content against patterns indicating:
- Explicit planning language ("let me plan", "step 1:")
- Sequential thinking ("first... then... finally")
- Outlining behavior

---

## Color Palette

Each event type maps to a distinct color for visual differentiation:

| Event Type | Color | Hex |
|------------|-------|-----|
| User Message | Blue | `#4a90d9` |
| Assistant Message | Purple | `#9b59b6` |
| Tool Call | Orange | `#f39c12` |
| Git Operation | Green | `#2ecc71` |
| Error | Red | `#e74c3c` |
| Planning Mode | Teal | `#1abc9c` |

The palette is designed for:
- Sufficient contrast on dark backgrounds
- Distinguishability for common forms of color blindness
- Semantic meaning (red = error, green = git success)

---

## Timeline Rendering

### Session Bar Layout

Each session is rendered as a horizontal bar:

```
┌─────────────────────────────────────────────────────────┐
│ Session Label │ [===USER===][==ASST==][TOOL][GIT][ERR] │
└─────────────────────────────────────────────────────────┘
```

- **Label area**: Fixed width, shows session identifier
- **Timeline area**: Variable width, contains colored segments

### Segment Positioning

Segments are positioned proportionally within the session's time range:

```
segment_start_position = (event_start - session_start) / session_duration
segment_width = (event_end - event_start) / session_duration
```

### Segment Aggregation

Consecutive events of the same type are merged into single segments:

1. Iterate through events in chronological order
2. Group adjacent events sharing the same type
3. Each group becomes one segment with:
   - Start time: first event's timestamp
   - End time: last event's timestamp
   - Type: shared event type
   - Count: number of merged events

This reduces visual noise and improves rendering performance.

### Minimum Segment Width

Segments below a minimum pixel width are rendered at that minimum to ensure visibility and interactivity. Recommended minimum: 2-4 pixels.

---

## Idle Period Detection

Gaps within sessions where no activity occurred are visually distinguished:

### Detection

An idle period is detected when the gap between consecutive events exceeds a threshold (recommended: 10 minutes).

### Rendering

Idle periods are shown with reduced opacity (recommended: 25%) to indicate inactivity while preserving timeline continuity.

```
[ACTIVE SEGMENT]▓▓▓▓▓▓▓▓[  IDLE  ]░░░░░░░░[ACTIVE SEGMENT]▓▓▓▓▓▓▓▓
```

---

## Swim Lane Assignment

When displaying multiple sessions, swim lanes prevent visual overlap:

### Algorithm

1. Sort sessions by start time
2. Maintain a list of "active" lanes with their end times
3. For each session:
   - Find a lane where the previous session ended before this one starts (with gap tolerance)
   - If found, reuse that lane
   - Otherwise, create a new lane
4. Large gaps between sessions (recommended: 1 hour) reset lane assignments to reduce vertical spread

### Gap Clustering

Sessions are grouped into temporal clusters. A new cluster starts when the gap from the previous session exceeds the cluster threshold. Each cluster's lanes are calculated independently.

---

## Zoom and Pan

### Zoom Behavior

The timeline supports zoom levels from overview (all sessions visible) to detail (single events visible):

- **Zoom scale**: Exponential (e.g., 1x, 2x, 4x, 8x... up to 500x)
- **Zoom anchor**: Zoom centers on cursor position or viewport center
- **Minimum bar width**: Session bars maintain minimum clickable width regardless of zoom

### Pan Behavior

- Horizontal scrolling navigates through time
- Vertical scrolling navigates through sessions
- Scroll position is preserved during zoom operations relative to the anchor point

---

## Interactivity

### Hover States

- **Session bar**: Highlight entire bar, show tooltip with summary
- **Segment**: Highlight segment, show tooltip with event details

### Selection

- **Click session**: Open detail panel with full session information
- **Click segment**: Scroll detail panel to relevant events

### Tooltips

Tooltip content includes:
- Event type and count
- Time range
- Token consumption
- Preview of content (truncated)

---

## Responsive Considerations

### Label Truncation

Session labels are truncated with ellipsis when viewport is narrow.

### Minimum Dimensions

- Minimum row height: 20-35 pixels for touch targets
- Minimum segment width: 2-4 pixels for visibility
- Minimum bar width: 16 pixels for clickability

### Performance

For large datasets (100+ sessions):
- Virtualize rows outside viewport
- Debounce zoom/pan updates
- Use canvas rendering for segments if DOM performance degrades

---

## Legend

A persistent legend maps colors to event types:

```
┌──────────────────────────────────────────────────────────┐
│ ■ User  ■ Assistant  ■ Tool  ■ Git  ■ Error  ■ Planning │
└──────────────────────────────────────────────────────────┘
```

Position: Fixed at bottom or top of viewport.

---

## Accessibility

- Color is not the only differentiator (patterns or labels available)
- Keyboard navigation between sessions and segments
- Screen reader announcements for session summaries
- Sufficient color contrast ratios (WCAG AA minimum)

---

## Summary

This specification defines a Gantt-style visualization where:

1. **Sessions** are horizontal bars spanning their time range
2. **Events** are classified into six types with distinct colors
3. **Segments** aggregate consecutive same-type events
4. **Idle periods** are shown with reduced opacity
5. **Swim lanes** prevent overlap between concurrent sessions
6. **Zoom/pan** enables navigation from overview to detail
7. **Interactivity** provides tooltips and detail panels on selection
