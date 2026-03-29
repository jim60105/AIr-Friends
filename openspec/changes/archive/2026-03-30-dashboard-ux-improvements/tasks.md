## 1. Add Element ID Attributes

- [x] 1.1 In `src/dashboard/public/index.html`, add unique `id` attributes to the `<aside>` element, each tab button, action buttons (restart, logout), and the main content area
- [x] 1.2 In `src/dashboard/public/index.html`, add unique `id` attributes to workspace elements: file tree container, file viewer panel, file header, markdown toggle button
- [x] 1.3 In `src/dashboard/public/index.html`, add unique `id` attributes to session tab elements: active sessions table, history sessions table
- [x] 1.4 In `src/dashboard/public/index.html`, add unique `id` attributes to stats tab and chat tab containers

## 2. Collapsible Sidebar

- [x] 2.1 In `src/dashboard/public/index.html`, add a sidebar toggle button (hamburger/collapse icon) at the top of `<aside>`
- [x] 2.2 In `src/dashboard/public/style.css`, add CSS for sidebar collapse transition: `aside.collapsed` with icon-only width (~60px), hidden text labels, and smooth `width` transition
- [x] 2.3 In `src/dashboard/public/index.html` or a new JS file, add toggle logic: clicking the toggle button adds/removes `collapsed` class on `<aside>`
- [x] 2.4 Ensure tab buttons still function in collapsed mode (icon click triggers tab switch)

## 3. Expanded File Viewer Modal

- [x] 3.1 In `src/dashboard/public/index.html`, add a modal overlay element for expanded file view: backdrop, content container (80vw × 80vh), close button
- [x] 3.2 In `src/dashboard/public/index.html`, add an expand button in the file viewer header bar
- [x] 3.3 In `src/dashboard/public/js/workspace.js`, add expand logic: clicking expand button populates modal with current file content (raw or markdown) and shows the modal
- [x] 3.4 In `src/dashboard/public/js/workspace.js`, add close logic: close button click and backdrop click dismiss the modal
- [x] 3.5 In `src/dashboard/public/js/workspace.js`, hide expand button when no file is loaded

## 4. File Tree Sort Order Toggle

- [x] 4.1 In `src/dashboard/server.ts`, add `mtime` field (Unix timestamp in ms) to each entry in the workspace tree API response
- [x] 4.2 In `src/dashboard/public/index.html`, add a sort toggle button in the workspace tree header
- [x] 4.3 In `src/dashboard/public/js/workspace.js`, store the raw tree data from the API and implement client-side sort functions (alphabetical and time-descending)
- [x] 4.4 In `src/dashboard/public/js/workspace.js`, add toggle logic: clicking sort button re-renders tree with the alternate sort order
- [x] 4.5 Update existing workspace tree tests to verify `mtime` is included in API response

## 5. Verification

- [x] 5.1 Run `deno task test` and verify all tests pass
- [x] 5.2 Run `deno fmt --check src/ tests/` and `deno lint src/ tests/` to verify code quality
