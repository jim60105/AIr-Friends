## Why

The dashboard needs several UX improvements to enhance usability: the sidebar takes up permanent horizontal space on smaller screens, the file viewer has no way to view files in a larger viewport, the file tree lacks flexible sorting options, and elements lack `id` attributes needed for testing and maintenance.

## What Changes

- **Collapsible sidebar**: The `<aside>` sidebar SHALL be collapsible to show only icons, freeing horizontal space
- **Expand file viewer**: Add an expand/popup view for the file content area (80vw × 80vh, centered, scrollable, with close button)
- **File tree sort toggle**: Add a button to switch between alphabetical order and time descending order in the workspace file tree
- **Element IDs**: Add unique `id` attributes to all interactive elements in the dashboard for testing and maintenance

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `dashboard-ui`: Adding collapsible sidebar behavior and element ID attributes
- `web-dashboard-agent-workspace-browser`: Adding expanded file viewer popup and file tree sort order toggle; API needs to return file timestamps for time-based sorting

## Impact

- `src/dashboard/public/index.html` — Sidebar collapse UI, expand button, sort toggle button, element IDs
- `src/dashboard/public/js/workspace.js` — Expand view logic, sort toggle logic
- `src/dashboard/public/style.css` — Sidebar collapse transition, expand popup styles
- `src/dashboard/server.ts` — Workspace tree API may need to include file modification times
- No breaking API changes; new fields are additive
