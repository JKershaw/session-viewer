# Claude Code Session Analyzer — Implementation Brief

## First Steps

Before writing any code, save this entire prompt to `SPEC.md` in the project root. This is the reference document for the project. Refer back to it when making architectural decisions.

---

## Project Summary

Build a local tool for visualizing and analyzing Claude Code session logs. The core deliverable is a Gantt chart view of sessions where the horizontal axis represents tokens (with a toggle to wall-clock time). Key events like git operations, errors, and decision points appear as markers. Sessions can be correlated with Linear tickets and enriched with LLM-generated annotations identifying blockers, rework, and decision points.

The purpose is to identify systematic friction in Claude Code workflows so they can be preemptively addressed, reducing manual intervention over time.

---

## Technology Constraints

- TypeScript throughout (strict mode)
- Express.js for the API
- Simple frontend (vanilla JS/TS, no framework unless complexity demands it later)
- MangoDB for persistence: https://github.com/JKershaw/mangodb
- OpenRouter for LLM analysis
- Minimal dependencies — add only what is necessary
- Test-driven development — write tests before implementation
- Functional style — pure functions, composition, avoid classes where practical

---

## Specification

### Data Sources

| Source | Data | Access |
|--------|------|--------|
| Claude Code | Session logs (JSONL) | File system |
| Git | Commits, branches | Local git CLI |
| Linear | Tickets, labels, status | REST API (manual pull) |
| OpenRouter | LLM analysis | REST API (on demand) |

### Data Model

**Session**
- id
- startTime, endTime, durationMs
- totalTokens
- branch (nullable)
- folder
- linearTicketId (nullable)
- analyzed (boolean)
- events (array)
- annotations (array, populated by LLM)

**Event**
- type: user_message | assistant_message | tool_call | git_op | error | planning_mode
- timestamp
- tokenCount
- raw (original log entry)

**Annotation**
- eventIndex or time range
- type: decision | blocker | rework | goal_shift
- summary
- confidence

**LinearTicket**
- ticketId
- title, type, labels, status, project
- sessionIds (array)

### Event Extraction

Deterministic (from JSONL parsing):
- Message boundaries and roles
- Token counts
- Tool calls and types
- Bash commands containing git operations
- Errors and retries
- Timestamps

LLM-derived (on-demand analysis):
- Decision points
- Blockers (extended effort on one problem)
- Rework (revisiting completed work)
- Goal shifts
- Classification of user interventions

### UI Requirements

**Session list view**
- Filterable by date range, folder, branch, ticket, analysis status
- Shows basic metadata per session

**Gantt view**
- Rows are sessions (or grouped by ticket)
- Horizontal axis is tokens, toggleable to wall-clock time
- Segments colored by event type
- Markers for significant events (git, errors, annotations)
- Click/hover reveals detail panel

**Controls**
- Refresh logs: re-scan and parse JSONL files
- Sync Linear: pull tickets, match to sessions
- Analyze: trigger LLM pass on selected sessions
- Axis toggle: tokens vs time

### Architecture

```
JSONL Logs → Parser → MangoDB ← Linear API
                          ↓
                    Express API → OpenRouter
                          ↓
                      Frontend
```

---

## Roadmap

Follow this sequence. Each phase results in a working, usable tool. Do not proceed to the next phase until the current phase is complete and tested.

### Phase 1: Foundation

**Goal:** Parse Claude Code logs and display a list of sessions.

- Initialize TypeScript project with Express
- Set up MangoDB connection and basic repository pattern
- Locate Claude Code JSONL logs (use standard paths, make configurable)
- Parse JSONL files into session documents with basic metadata
- API endpoint: list all sessions
- Minimal frontend: display session list with timestamps and token counts
- Tests: log parsing, session storage, API responses

**Done when:** You can refresh logs and see sessions listed in a browser.

### Phase 2: Event Extraction

**Goal:** Break sessions into typed events.

- Extract events from parsed logs (messages, tool calls, errors)
- Identify git operations within bash tool calls
- Store events as nested array in session document
- API endpoint: get session with events
- Tests: event extraction for each type, edge cases

**Done when:** Sessions contain a complete, typed event array.

### Phase 3: Gantt Visualization

**Goal:** Render sessions as a Gantt chart with token-based axis.

- Frontend Gantt component (keep it simple, SVG or canvas)
- Horizontal axis represents cumulative tokens
- Segments colored by event type
- Session rows, one per session
- Click segment to view raw event data
- Tests: rendering logic, token accumulation

**Done when:** You can visually scan sessions and see where tokens were spent.

### Phase 4: Time Toggle and Filtering

**Goal:** Switch between token and time views, filter session list.

- Toggle horizontal axis between tokens and wall-clock time
- Add filters: date range, folder, branch
- Persist filter state in URL or local state
- Tests: time calculations, filter logic

**Done when:** You can compare token-effort vs real-time and narrow down to specific sessions.

### Phase 5: Git Correlation

**Goal:** Highlight git activity and correlate with actual commits.

- Parse git commands from tool calls more precisely
- Run local git log to get actual commit times and branches
- Match mentioned commits to real commits
- Display git markers on Gantt
- Auto-detect branch from session if possible
- Tests: git command parsing, commit matching

**Done when:** Git pushes and commits appear as markers on the timeline.

### Phase 6: Linear Integration

**Goal:** Link sessions to Linear tickets.

- Linear API client (pull tickets for configured team/project)
- Match sessions to tickets via branch name heuristics
- Store ticket metadata, link to sessions
- Filter and group by ticket in UI
- Aggregate view: all sessions for a ticket as one row
- Tests: API client, matching logic

**Done when:** You can see which sessions contributed to which tickets.

### Phase 7: LLM Analysis

**Goal:** Generate annotations identifying decisions, blockers, and rework.

- OpenRouter client (configurable model)
- Design analysis prompt: given a session's events, identify key moments
- Queue and process analysis requests
- Store annotations against sessions
- Display annotation markers on Gantt
- Detail panel shows annotation summaries
- Tests: prompt construction, annotation parsing, storage

**Done when:** You can trigger analysis and see AI-identified patterns on the chart.

---

## Development Principles

**Test-driven development**
Write a failing test, then implement. Tests cover parsing, extraction, storage, API, and UI logic. Keep tests fast and focused.

**Functional style**
Prefer pure functions that take data and return data. Use composition. Avoid mutable state except at explicit boundaries (DB, UI). Keep side effects at the edges.

**Minimal dependencies**
Question each dependency. If the standard library or a few lines of code can do it, prefer that. Dependencies are a maintenance burden.

**Incremental delivery**
Each phase produces a working tool. Resist the urge to build infrastructure for later phases. Solve the problem in front of you.

**Clean abstractions**
Separate concerns: parsing, storage, API, UI. Each module should have a clear responsibility. Functions should do one thing.

---

## Begin

Start with Phase 1. Set up the project, get MangoDB working, parse some logs, and show them in a list. Save this file as SPEC.md first.
