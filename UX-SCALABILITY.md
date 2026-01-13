# UX Scalability Analysis

This document analyzes how the Session Analyzer UI scales with varying data volumes.

## Summary

The current implementation works well for small to moderate usage (~50 sessions, ~100 events each) but will degrade significantly with larger datasets due to:

- No server-side pagination
- Client-side filtering on full dataset
- DOM-heavy rendering without virtualization

## Current Architecture

```
API: getAllSessions() → Full dataset
        ↓
Frontend: allSessions[] → Client-side filter
        ↓
Render: .map() → DOM node per session
```

## Scalability Issues

### 1. No Server-Side Pagination

**Location:** `src/api/app.ts:46-59`

```typescript
const sessions = await sessionRepo.getAllSessions();
```

The `/api/sessions` endpoint returns ALL sessions in a single response. As sessions accumulate, this causes:
- Increasing response payload size
- Longer initial load times
- Higher memory usage in browser

### 2. Client-Side Filtering Only

**Location:** `public/index.html:500-516`

All filtering (date range, folder, branch, ticket) runs in the browser after loading the complete dataset:

```javascript
return allSessions.filter(s => {
  if (dateFrom && sessionDate < dateFrom) return false;
  // ... more filters
});
```

This means users must download all data even when viewing a filtered subset.

### 3. List View Renders All Sessions

**Location:** `public/index.html:571-586`

```javascript
listView.innerHTML = sessions.map(s => `
  <div class="session-card">...</div>
`).join('');
```

Every filtered session creates a DOM node. With 500+ sessions, this causes:
- Layout thrashing during render
- Slow scrolling performance
- High memory usage

### 4. Gantt Chart SVG Complexity

**Location:** `public/index.html:744-792`

Each session row in the Gantt view:
- Creates an SVG element
- Renders every event as a `<rect>` element
- Has no aggregation for adjacent same-type events

A session with 500 events generates 500 SVG rect elements. Combined across many sessions, DOM element counts become problematic.

### 5. Hardcoded Linear Ticket Limit

**Location:** `src/api/app.ts:249`

```typescript
const tickets = await client.getIssues({ limit: 100 });
```

Linear sync is capped at 100 tickets regardless of workspace size.

## What Works Well

| Feature | Implementation | Notes |
|---------|---------------|-------|
| Session summaries | API strips `events`/`annotations` from list | Reduces payload |
| Event list limiting | Max 50 events in detail panel | Smart filtering prioritizes important events |
| Small segment culling | Skips segments < 0.1% width | Reduces SVG complexity slightly |

## Expected Performance

| Sessions | Events/Session | Est. DOM Elements | Expected UX |
|----------|----------------|-------------------|-------------|
| 20 | 50 | ~1,500 | Smooth |
| 50 | 100 | ~6,000 | Good |
| 100 | 100 | ~12,000 | Noticeable lag on filter/render |
| 200 | 200 | ~45,000 | Sluggish interactions |
| 500 | 200 | ~100,000+ | Likely unusable |

## Recommendations

### Short-term Improvements

1. **Default date filter** - Show last 7 days by default instead of all time
2. **Lazy load events** - Don't fetch full session with events until detail panel opens
3. **Limit list view** - Show max 100 sessions with "Load more" button

### Medium-term Improvements

1. **Server-side pagination**
   - Add `?limit=50&offset=0` query params to `/api/sessions`
   - Add `?dateFrom=&dateTo=` server-side filtering

2. **Virtual scrolling for list view**
   - Only render visible rows plus buffer
   - Libraries: `virtual-scroller`, or custom with `IntersectionObserver`

3. **Event aggregation in Gantt**
   - Combine adjacent same-type events into single rect
   - Show aggregated count on hover

### Long-term Improvements

1. **Canvas rendering for Gantt chart**
   - Single canvas element vs thousands of SVG rects
   - Better performance for large datasets
   - Trade-off: more complex click handling

2. **IndexedDB caching**
   - Cache sessions client-side
   - Only fetch deltas on refresh

3. **WebWorker for filtering**
   - Offload filter computation from main thread
   - Keeps UI responsive during large dataset operations

## Testing Recommendations

To validate scalability improvements:

1. **Generate test data** - Create script to generate N sessions with M events each
2. **Measure render time** - Use `performance.mark()` around render functions
3. **Profile memory** - Chrome DevTools Memory tab during typical workflows
4. **Test on low-end devices** - Ensure acceptable performance on 4GB RAM machines
