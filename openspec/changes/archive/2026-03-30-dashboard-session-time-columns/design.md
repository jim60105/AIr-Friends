## Context

The dashboard Session History table currently has seven columns: Session ID, Type, Platform, User, Time, Duration, Status. The Time column shows start time and Duration shows session duration. However, the table uses `overflow-x-auto` which can cause horizontal scrolling on narrow viewports. The table needs to be constrained to its parent container width with proper content wrapping.

Looking at the current code:
- `src/dashboard/public/index.html` defines the table structure with `table-fixed` and `w-full`
- `src/dashboard/public/js/sessions.js` renders rows in `pollHistory()` using `formatTime()` and `formatDuration()`
- The table already uses Time and Duration columns (not Started/Ended/Duration as initially described)

The primary issue is ensuring the table does not overflow horizontally and content wraps properly on all screen sizes.

## Goals / Non-Goals

**Goals:**
- Ensure Session History table never produces a horizontal scrollbar
- Apply proper `table-fixed` layout with explicit column width percentages
- Ensure long content (Session ID, User ID) wraps within cells using `break-all` / `break-words`
- Maintain responsive readability across desktop, tablet, and mobile viewports

**Non-Goals:**
- Changing the API response format (columns already match the desired layout)
- Adding new data fields or columns
- Changing the Active Sessions table layout

## Decisions

### Decision 1: Use `table-fixed` with explicit column widths via Tailwind `w-` classes

**Rationale**: `table-fixed` distributes column widths based on the first row's `<th>` widths. By assigning explicit percentage-based widths, we prevent any single column from expanding beyond bounds. This is simpler than CSS Grid and maintains semantic table markup.

**Alternatives considered**:
- CSS Grid layout: More flexible but loses semantic `<table>` benefits and accessibility
- `table-layout: auto` with `max-width`: Unreliable with long monospace strings

### Decision 2: Use `overflow-x-hidden` on the table container

**Rationale**: Combined with `table-fixed` and proper column widths, `overflow-x-hidden` ensures no horizontal scroll. Content that exceeds column width wraps via `break-all` on monospace cells.

### Decision 3: Responsive column width distribution

Proposed widths for 7 columns:
| Column     | Width | Justification                        |
|------------|-------|--------------------------------------|
| Session ID | 20%   | Longest content, monospace, break-all|
| Type       | 10%   | Short labels (reply, spontaneous)    |
| Platform   | 10%   | Short (discord, misskey)             |
| User       | 15%   | Monospace IDs, break-all             |
| Time       | 20%   | Date-time string                     |
| Duration   | 10%   | Short formatted string               |
| Status     | 15%   | Status badge with dot                |

## Risks / Trade-offs

- [Very long Session IDs may wrap to 2-3 lines] → Acceptable trade-off vs horizontal scroll; monospace `text-xs` keeps it compact
- [Fixed column widths may not be optimal for all content] → Percentage-based widths scale with container; `break-all` prevents overflow
