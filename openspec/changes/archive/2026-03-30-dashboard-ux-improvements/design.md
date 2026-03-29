## Context

The dashboard is a single-page app with an `<aside>` sidebar containing navigation tabs and action buttons. The Workspace tab provides a file tree browser and file content viewer. Currently the sidebar is always fully expanded, the file viewer has no way to enlarge content, the file tree only supports alphabetical sorting (server-side), and most elements lack `id` attributes.

Key files:
- `src/dashboard/public/index.html` — Full dashboard layout
- `src/dashboard/public/js/workspace.js` — File tree rendering, file loading
- `src/dashboard/public/style.css` — Custom styles
- `src/dashboard/server.ts` — API endpoints including workspace tree/file

## Goals / Non-Goals

**Goals:**
- Sidebar collapses to icon-only mode with smooth transition, preserving tab navigation
- File viewer has an expand button opening a centered 80vw × 80vh modal with scroll and close
- File tree supports toggling between alphabetical and time-descending sort order
- All interactive/significant elements have unique `id` attributes
- API returns `mtime` for each tree entry to enable client-side time sorting

**Non-Goals:**
- Changing the overall dashboard layout or theme
- Adding new tabs or removing existing ones
- Server-side sort order parameter (sorting done client-side for time order)

## Decisions

### Decision 1: CSS transition for sidebar collapse

Use a CSS class toggle (`collapsed`) on `<aside>` that transitions `width` from full to icon-width (~60px). Nav buttons hide text labels and show only SVG icons. A toggle button is added at the top of the sidebar.

**Rationale**: Pure CSS transition is simple, performant, and doesn't require JS framework. The sidebar already uses flex layout.

**Alternatives**: JS-animated sidebar — unnecessary complexity for a width transition.

### Decision 2: Modal overlay for expanded file viewer

Create a fixed-position overlay div (80vw × 80vh) centered with flexbox, containing the file content with `overflow-y: auto`. A close button (×) in the top-right corner and clicking the backdrop dismisses it. Reuse the same file content (clone or move DOM node).

**Rationale**: Native HTML/CSS modal avoids dependencies. 80vw/80vh ensures visibility on all screens while leaving context visible.

### Decision 3: Client-side sort toggle for file tree

Add `mtime` (Unix timestamp) to the workspace tree API response. The client stores the full tree data and re-renders when sort order changes. A toggle button in the workspace tree header switches between "A→Z" (alphabetical) and "🕒" (time descending).

**Rationale**: Server already sorts alphabetically. Adding `mtime` to API response is trivial (Deno `stat()` already available). Client-side re-sort avoids extra API calls and is instant.

### Decision 4: Element ID naming convention

Use kebab-case IDs following the pattern: `{section}-{component}-{descriptor}`. Examples: `sidebar-nav`, `sidebar-toggle`, `workspace-tree-sort-toggle`, `workspace-file-expand-btn`, `file-viewer-modal`.

**Rationale**: Consistent naming enables reliable test selectors and maintenance. Kebab-case follows HTML convention.

## Risks / Trade-offs

- [Sidebar collapse changes layout width] → Content area uses `flex-1` so it automatically fills remaining space
- [Adding mtime to tree API increases response size slightly] → Negligible; timestamps are small integers
- [Client-side sort may be slow for very large trees] → Tree is capped at 1000 entries; sorting 1000 items is instant
