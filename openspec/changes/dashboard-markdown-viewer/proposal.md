## Why

The Workspace page file viewer currently displays all file content as raw plain text in a `<pre>` block, including `.md` files. Markdown files should be rendered as formatted HTML for readability, since the agent workspace primarily uses markdown for notes and journals.

## What Changes

- Add a client-side markdown rendering library (e.g., `marked` via CDN) to the dashboard
- Detect `.md` file extension in the file viewer and render content as formatted HTML by default
- Add a toggle button to switch between rendered markdown and raw text view for `.md` files
- Keep `.txt` files rendered as plain text in the existing `<pre>` block (no toggle needed)
- Add appropriate CSS styling for rendered markdown content (headings, lists, code blocks, etc.)

## Capabilities

### New Capabilities

- `markdown-file-rendering`: Client-side markdown rendering for `.md` files in the Workspace page file viewer, with a toggle to switch between rendered and raw text views

### Modified Capabilities

- `web-dashboard-agent-workspace-browser`: File content viewing now differentiates between `.md` (rendered markdown) and `.txt` (plain text) display modes

## Impact

- `src/dashboard/public/js/workspace.js` — `loadFile()` function needs markdown detection, rendering logic, and toggle handling
- `src/dashboard/public/index.html` — Add markdown rendering library CDN, add a rendered content container alongside the `<pre>` block, add a toggle button in the file header area
- `src/dashboard/public/style.css` — Add styles for rendered markdown content
- No backend changes required; the API already serves raw file content
- No new Deno dependencies; markdown rendering is client-side only
