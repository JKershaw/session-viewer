# Timeline Axis Ruler Specification

## Overview

The timeline axis displays time markers that adapt to zoom level, like a tape measure. Zooming in reveals finer detail (hours → minutes), zooming out shows coarser detail (days → weeks).

## Core Concepts

### 1. Coordinate System

```
|<-- padding -->|<-------- drawableWidth -------->|<-- padding -->|
|               |                                 |               |
0            PADDING                    PADDING + drawableWidth   totalWidth

Time mapping:
- minTime maps to x = PADDING
- maxTime maps to x = PADDING + drawableWidth
```

**Position formulas:**
```javascript
timeToX(time) = PADDING + ((time - minTime) / timeRange) * drawableWidth
xToTime(x) = minTime + ((x - PADDING) / drawableWidth) * timeRange
```

### 2. Zoom Model

```
zoomLevel: 0-100 (slider value)
zoomFactor: 1x to 50x (exponential mapping)

zoomFactor = 1 * Math.pow(50, zoomLevel / 100)

At zoomLevel 0:   factor = 1x   (fit all data in viewport)
At zoomLevel 50:  factor = 7x
At zoomLevel 100: factor = 50x  (maximum zoom)
```

### 3. Visible Time Range

The viewport shows a portion of the total time range:

```
visibleTimeRange = totalTimeRange / zoomFactor

Example with 30 days of data:
- Zoom 0 (1x):   see all 30 days
- Zoom 50 (7x):  see ~4.3 days
- Zoom 100 (50x): see ~14.4 hours
```

## Tick Interval Selection

### Goal
Display approximately **10-15 ticks** in the visible viewport at any zoom level.

### Algorithm

```javascript
// 1. Calculate ideal interval for ~12 visible ticks
idealInterval = visibleTimeRange / 12

// 2. Round UP to nearest "nice" interval
niceIntervals = [
  1 minute,
  5 minutes,
  15 minutes,
  30 minutes,
  1 hour,
  2 hours,
  6 hours,
  12 hours,
  1 day,
  1 week
]

interval = first niceInterval where niceInterval >= idealInterval
```

### Examples

| Data Range | Zoom | Visible Range | Ideal Interval | Nice Interval |
|------------|------|---------------|----------------|---------------|
| 30 days | 0 (1x) | 30 days | 2.5 days | 1 week |
| 30 days | 50 (7x) | 4.3 days | 8.5 hours | 12 hours |
| 30 days | 100 (50x) | 14.4 hours | 1.2 hours | 2 hours |
| 7 days | 100 (50x) | 3.4 hours | 17 minutes | 30 minutes |
| 1 day | 100 (50x) | 29 minutes | 2.4 minutes | 5 minutes |

## Tick Rendering

### What to Render

For each tick from `minTime` to `maxTime` at the selected interval:
1. Calculate x position
2. Determine if major tick (larger visual weight)
3. Format label based on interval scale

### Major Tick Rules

| Interval | Major Tick When |
|----------|-----------------|
| 1 week | First of month |
| 1 day | Monday |
| 12 hours | Midnight |
| 6 hours | Midnight |
| 2 hours | Midnight |
| 1 hour | Midnight |
| 30 minutes | Top of hour |
| 15 minutes | Top of hour |
| 5 minutes | Top of hour |
| 1 minute | Quarter hour (0, 15, 30, 45) |

### Label Format

| Interval | Format | Example |
|----------|--------|---------|
| >= 1 day | "Mon 13" or "Jan 13" | "Mon 13" |
| >= 1 hour | "2:00 PM" | "2:00 PM" |
| < 1 hour | "2:15 PM" | "2:15 PM" |

## Performance Constraints

### Maximum Ticks

Total ticks rendered = `timeRange / interval`

Since `interval >= visibleTimeRange / 12`, and `visibleTimeRange = timeRange / zoomFactor`:

```
totalTicks = timeRange / interval
           <= timeRange / (visibleTimeRange / 12)
           = timeRange / (timeRange / zoomFactor / 12)
           = 12 * zoomFactor
           <= 12 * 50 = 600 ticks (at max zoom)
```

This is acceptable for DOM performance.

## Implementation Interface

```javascript
/**
 * Render the time axis with zoom-adaptive tick intervals.
 *
 * @param {HTMLElement} container - The axis container element
 * @param {number} minTime - Start of data range (ms timestamp)
 * @param {number} maxTime - End of data range (ms timestamp)
 * @param {number} drawableWidth - Pixel width for time content (excludes padding)
 * @param {number} padding - Padding on each side (pixels)
 * @param {number} zoomLevel - Current zoom level (0-100)
 */
function renderAxis(container, minTime, maxTime, drawableWidth, padding, zoomLevel)
```

## Visual Design

```
Axis Header (sticky, 30px height):
┌─────────────────────────────────────────────────────────────┐
│  Mon 6    │    Mon 12   │    Mon 18   │    Tue 0    │  ... │
│    │      │      │      │      │      │      │      │      │
│    ┆      ┆      ┆      ┆      ┆      ┆      ┆      ┆      │
└─────────────────────────────────────────────────────────────┘
     minor       major         minor         major

- Major ticks: taller line, bolder text
- Minor ticks: shorter line, lighter text
- Labels: positioned at tick, no overlap
```

## Scrolling Behavior

1. Timeline content scrolls horizontally
2. Axis header is sticky (fixed position)
3. Axis content translates with scroll: `transform: translateX(-scrollLeft)`
4. All ticks are pre-rendered; scrolling just reveals different portions
