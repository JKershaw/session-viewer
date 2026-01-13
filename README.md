# Claude Code Session Analyzer

A local tool for visualizing and analyzing Claude Code session logs. Identify where tokens are spent, spot systematic friction, and correlate sessions with Linear tickets.

## Features

- **Session log parsing** — Automatically locates and parses Claude Code JSONL logs
- **Gantt chart visualization** — See sessions as horizontal bars with segments colored by event type
- **Token/time toggle** — Switch between token consumption and wall-clock time on the horizontal axis
- **Event extraction** — Typed events including messages, tool calls, git operations, and errors
- **Git correlation** — Highlights commits and pushes as markers on the timeline
- **LLM analysis** — Uses OpenRouter to identify blockers, rework, decision points, and goal shifts
- **Linear integration** — Links sessions to Linear tickets via branch name matching
- **Filtering** — Filter sessions by date range, folder, branch, ticket, or analysis status

## Prerequisites

- Node.js 18+
- [MangoDB](https://github.com/JKershaw/mangodb) (installed as dependency)
- OpenRouter API key (for LLM analysis)
- Linear API key (optional, for ticket integration)

## Installation

```bash
git clone <repository-url>
cd session-viewer
npm install
npm run build
```

## Configuration

Create a `.env` file in the project root:

```env
# Path to MangoDB data directory
MANGODB_PATH=./data

# Path to Claude Code logs (defaults to standard location)
CLAUDE_LOGS_PATH=~/.claude/projects

# OpenRouter API key for LLM analysis
OPENROUTER_API_KEY=your-key-here

# Linear API key for ticket integration (optional)
LINEAR_API_KEY=your-key-here

# Server port (default: 3000)
PORT=3000
```

## Usage

Start the development server:

```bash
npm run dev
```

Or build and run in production:

```bash
npm run build
npm start
```

Open `http://localhost:3000` in your browser.

### Key workflows

1. **Refresh logs** — Scan and parse JSONL files from Claude Code
2. **View sessions** — Browse the session list, filter by date/folder/branch
3. **Gantt view** — Visualize sessions as a chart, click segments for details
4. **Analyze** — Trigger LLM analysis on selected sessions to identify patterns
5. **Sync Linear** — Pull tickets and match them to sessions

## Architecture

```
JSONL Logs → Parser → MangoDB ← Linear API
                          ↓
                    Express API → OpenRouter
                          ↓
                      Frontend
```

### Module overview

| Module | Purpose |
|--------|---------|
| `src/parser/` | Parses JSONL logs, extracts events |
| `src/db/` | MangoDB client, session and ticket repositories |
| `src/api/` | Express routes and handlers |
| `src/llm/` | OpenRouter client for LLM analysis |
| `src/linear/` | Linear API client |
| `src/git/` | Git CLI integration for commit correlation |
| `src/queue/` | Job queue for async analysis processing |

## Development

### Running tests

```bash
# Unit tests
npm test

# End-to-end tests
npm run test:e2e
```

### Development principles

- **Test-driven development** — Write failing tests first
- **Functional style** — Pure functions, composition, minimal mutable state
- **Minimal dependencies** — Only add what is necessary
- **Incremental delivery** — Each change should leave the tool in a working state

## License

ISC
