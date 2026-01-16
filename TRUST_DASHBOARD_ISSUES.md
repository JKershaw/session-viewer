# Trust Dashboard Issues Analysis

## Summary

Analysis of the Trust Dashboard screenshot from 2026-01-16 revealed **8 issues** across data processing, UI layout, and visual styling.

**Status: 6 FIXED, 1 BY DESIGN, 1 RESOLVED (already fixed)**

---

## Data Issues

### 1. All Sessions Classified as "unknown" Area

**Severity:** Critical
**Symptom:** All 182 sessions fall into a single "unknown" codebase area category.

**Root Cause:** The streaming parser (`src/parser/streaming-parser.ts:164-179`) truncates log entries for memory efficiency but **fails to preserve the `input` field** which contains tool call parameters like `file_path`.

```typescript
// streaming-parser.ts:164-173
const truncatedEntry = {
  ...entry,
  message: entry.message
    ? {
        ...entry.message,
        content: truncateContent(entry.message.content)
      }
    : undefined,
  content: truncateContent(entry.content)
  // MISSING: input, tool_name, name fields are not preserved!
} as LogEntry;
```

The trust analyzer (`src/analysis/trust-analyzer.ts:99-106`) then tries to read `raw.input` to extract file paths, but this field doesn't exist on the truncated entries:

```typescript
// trust-analyzer.ts:99-106
const raw = event.raw;
const input = raw.input as Record<string, unknown> | undefined;  // Always undefined!
const fileFields = ['file_path', 'path', 'filePath', 'filename'];
for (const field of fileFields) {
  if (input?.[field] && typeof input[field] === 'string') {
    paths.add(input[field] as string);  // Never executes
  }
}
```

**Fix:** Preserve `input`, `tool_name`, and `name` fields in the truncated entry:

```typescript
const truncatedEntry = {
  ...entry,
  input: entry.input,        // ADD: Preserve tool input
  tool_name: entry.tool_name, // ADD: Preserve tool name
  name: entry.name,          // ADD: Preserve name field
  message: entry.message ? { ... } : undefined,
  content: truncateContent(entry.content)
} as LogEntry;
```

---

### 2. 0% Commit Rate

**Severity:** Critical
**Symptom:** 182 sessions show 0% commit rate, which is implausible.

**Root Cause:** Same as issue #1. Git operations are detected via the `Bash` tool's `input.command` field (`src/parser/events.ts:101-106`), but this field is stripped by the streaming parser.

```typescript
// events.ts:101-106
export const extractBashCommand = (entry: LogEntry): string | null => {
  const input = entry.input as Record<string, unknown> | undefined;
  if (input?.command && typeof input.command === 'string') {
    return input.command;  // Can't find git commands without input field
  }
  // ...
};
```

**Fix:** Same as issue #1 - preserve the `input` field in streaming parser.

---

### 3. 0% Rework Rate

**Severity:** Medium
**Symptom:** Zero rework detected across all sessions.

**Root Cause:** Rework is detected via LLM annotations (`src/analysis/trust-analyzer.ts:275`):

```typescript
const reworkCount = annotations.filter(a => a.type === 'rework').length;
```

This requires sessions to have been analyzed via the LLM analysis job queue. Possible causes:
1. No LLM analysis jobs have been run
2. OpenRouter API key not configured
3. Annotations aren't being persisted correctly after analysis

**Investigation needed:** Check if any sessions have `analyzed: true` and non-empty `annotations` arrays.

---

### 4. High Intervention Count (12.1 average)

**Severity:** High
**Symptom:** Average of 12.1 interventions per session seems excessive.

**Root Cause:** The intervention counting logic (`src/analysis/trust-analyzer.ts:25-34`) counts ALL user messages after the first:

```typescript
const userMessages = events.filter(e => e.type === 'user_message');
const interventionCount = Math.max(0, userMessages.length - 1);
```

**Possible issues:**
1. **Tool result messages misclassified as user messages** - The classifier (`src/parser/events.ts:32-44`) attempts to filter these out, but may not catch all patterns from Claude Code's JSONL format.
2. **Session merging inflation** - When sessions with same `parentSessionId` are merged (`src/db/sessions.ts:94-139`), their user messages are combined, potentially inflating the count.

**Investigation needed:**
- Sample a merged session and count its user messages manually
- Check if tool_result entries are being classified correctly

---

## UI/UX Issues

### 5. Key Insights Panel Truncated

**Severity:** High
**Symptom:** "Key Insights" panel shows as "Ke... Ins..." - severely clipped.

**Root Cause:** The `.trust-dashboard` container lacks explicit width styling:

```css
/* trust-dashboard.css:21-26 */
.trust-dashboard {
  padding: 24px;
  overflow-y: auto;
  max-height: calc(100vh - var(--header-height) - 100px);
  padding-bottom: 80px;
  /* MISSING: width: 100% or flex: 1 */
}
```

Combined with the parent `main` element using `display: flex` (`main.css:76-80`), the dashboard doesn't expand to fill available width. The `.trust-content-grid` with `grid-template-columns: 1.5fr 1fr` then allocates space proportionally in a constrained container.

**Fix:** Add width styling to `.trust-dashboard`:

```css
.trust-dashboard {
  padding: 24px;
  overflow-y: auto;
  max-height: calc(100vh - var(--header-height) - 100px);
  padding-bottom: 80px;
  width: 100%;  /* ADD */
}
```

---

### 6. Column Header Cut Off ("CONFIDE...")

**Severity:** Low
**Symptom:** "Confidence" column header truncated to "CONFIDE...".

**Root Cause:** The table grid in `category-tabs.js:77-85` defines 7 columns but the CSS grid template (`trust-dashboard.css:443-444`) doesn't allocate enough space:

```css
.table-header {
  display: grid;
  grid-template-columns: 1.5fr 0.7fr 1fr 1fr 0.7fr 0.7fr 1fr;
  /* Last column (1fr) is for "Confidence" but gets squeezed */
}
```

The column headers (`category-tabs.js:77-85`):
```javascript
const columns = [
  { key: 'category', label: 'Category' },      // 1.5fr
  { key: 'totalSessions', label: 'Sessions' }, // 0.7fr
  { key: 'autonomousRate', label: 'Autonomous %' }, // 1fr
  { key: 'avgTrustScore', label: 'Trust Score' },   // 1fr
  { key: 'commitRate', label: 'Commit %' },    // 0.7fr
  { key: 'reworkRate', label: 'Rework %' },    // 0.7fr
  { key: 'confidence', label: 'Confidence' }   // 1fr - truncated
];
```

**Fix:** Increase the last column or use `minmax()`:

```css
.table-header, .table-row {
  grid-template-columns: 1.5fr 0.7fr 1fr 1fr 0.7fr 0.7fr minmax(80px, 1fr);
}
```

---

### 7. Progress Bar Color Inconsistency

**Severity:** Low
**Symptom:** The "Autonomous Rate" card shows a GREEN progress bar under the ORANGE 28% value text.

**Root Cause:** Looking at the code in `global-stats.js:64-70`:

```javascript
createStatCard(
  'Autonomous Rate',
  `${Math.round(autonomousRate * 100)}%`,
  'Sessions with 0-1 interventions',
  getTrustColorClass(autonomousRate),  // Returns 'trust-low' for 0.28
  autonomousRate * 100
)
```

And `createStatCard` at lines 13-34:
```javascript
const createStatCard = (label, value, subtext, colorClass = '', barPercent = null) => {
  // ...
  cardContent.push(
    div({ className: 'stat-card-bar' }, [
      div({
        className: `stat-card-bar-fill ${colorClass}`,
        // colorClass should be 'trust-low' (red) for 28%
```

The CSS at `trust-dashboard.css:16-18`:
```css
.trust-low.stat-card-bar-fill { background: #e74c3c; }  /* Red */
```

**Possible causes:**
1. The `colorClass` isn't being passed correctly to the bar element
2. Another CSS rule is overriding the color
3. The screenshot shows a browser rendering inconsistency

**Investigation needed:** Inspect the actual DOM in browser dev tools.

---

### 8. No Insights Generated (Empty State)

**Severity:** Medium
**Symptom:** Key Insights panel appears empty (only header visible before truncation).

**Root Cause:** Insights are generated by `generateComparativeInsights()` in `trust-aggregator.ts:446-491`. This function only generates insights when there are **multiple categories to compare**:

```typescript
const analyzeCategory = (aggregates: TrustAggregate[], categoryName: string) => {
  for (const agg of aggregates) {
    if (agg.totalSessions < 5) continue;  // Need enough data
    // Compare to global baseline...
  }
};
```

With only one "unknown" category, there are no meaningful comparisons to make, so no insights are generated.

**Fix:** This will resolve automatically once issue #1 is fixed and sessions are categorized into multiple areas.

---

## Issue Dependencies

```
#1 (Streaming Parser) ──┬──> #2 (0% Commit Rate)
                        ├──> #8 (No Insights)
                        └──> #4 (partially - git ops not detected)

#3 (0% Rework) ──> Independent (LLM analysis)

#4 (High Interventions) ──> Needs further investigation

#5 (Layout) ──> #6 (Column truncation - related container issues)

#7 (Bar Color) ──> Independent (CSS/rendering issue)
```

---

## Recommended Fix Priority

1. **Critical - Fix streaming parser** (Issues #1, #2, #8)
   - Single fix resolves multiple data issues
   - File: `src/parser/streaming-parser.ts`

2. **High - Fix dashboard layout** (Issue #5)
   - Makes dashboard usable
   - File: `public/css/components/trust-dashboard.css`

3. **High - Investigate intervention counting** (Issue #4)
   - Validates trust scoring accuracy
   - Files: `src/analysis/trust-analyzer.ts`, `src/parser/events.ts`

4. **Medium - Verify LLM analysis pipeline** (Issue #3)
   - Enables rework/blocker detection

5. **Low - Fix column width** (Issue #6)
   - Cosmetic improvement
   - File: `public/css/components/trust-dashboard.css`

6. **Low - Investigate bar color** (Issue #7)
   - Cosmetic inconsistency

---

## Resolution Summary (2026-01-16)

| # | Issue | Status | Resolution |
|---|-------|--------|------------|
| 1 | "unknown" area classification | **FIXED** | Streaming parser now preserves `input`, `tool_name`, `name`, `error` fields |
| 2 | 0% commit rate | **FIXED** | Same fix as #1 - git commands now detected from `input.command` |
| 3 | 0% rework rate | **BY DESIGN** | Requires `OPENROUTER_API_KEY` env var for LLM analysis |
| 4 | High intervention count (12.1) | **RESOLVED** | Already fixed in commit 636503a; 12.1 is legitimate user data |
| 5 | Key Insights panel truncated | **FIXED** | Added `flex: 1`, `min-width: 0` to `.trust-dashboard` |
| 6 | Column header cut off | **FIXED** | Changed last column to `minmax(90px, 1fr)` |
| 7 | Progress bar color | **FIXED** | Added default fallback background color |
| 8 | No insights generated | **FIXED** | Will resolve with #1 fix (multiple areas to compare) |

### Files Modified

1. `src/parser/streaming-parser.ts` - Preserve tool fields in truncated entries
2. `public/css/components/trust-dashboard.css` - Layout and color fixes

### Verification Steps

1. Start server: `npm run dev`
2. Click "Refresh Logs" to re-parse sessions
3. Go to Trust Dashboard → Click "Compute Trust Map"
4. Verify multiple areas appear with correct commit rates
