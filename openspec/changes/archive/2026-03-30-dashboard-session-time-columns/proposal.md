## Why

The Session History table in the dashboard currently displays Started, Ended, and Duration as three separate columns, consuming excessive horizontal space and causing horizontal scrollbar on smaller viewports. Consolidating into two columns (Time and Duration) improves readability and eliminates unnecessary scrolling.

## What Changes

- Replace the three time-related columns (Started, Ended, Duration) with two columns: **Time** (start time only) and **Duration**
- Ensure the Session History table never exceeds its parent container width (no horizontal scrollbar)
- Apply proper text wrapping and responsive layout so the table renders well across all screen sizes
- Use `table-fixed` layout with explicit column width distribution

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `dashboard-ui`: Session History table column layout changes from three time columns to two, and table overflow/responsive behavior is improved
- `web-dashboard-session-monitor`: Session History rendering logic updated to match new two-column layout

## Impact

- `src/dashboard/public/index.html` — Session History table `<thead>` column definitions
- `src/dashboard/public/js/sessions.js` — `pollHistory()` row rendering logic
- `src/dashboard/public/style.css` — Potential table responsive styles
- No API changes, no dependency changes, no breaking changes
