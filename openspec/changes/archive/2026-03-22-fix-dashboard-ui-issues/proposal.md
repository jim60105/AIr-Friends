## Why

The web dashboard has several usability issues that degrade the user experience: agent responses are invisible in Chat due to an SSE event name mismatch, there is no loading indicator while the agent is responding, the Workspace directory tree cannot be folded/expanded due to a missing CSS rule, audit logs in Sessions are truncated/unreadable and auto-collapse during polling, and the Workspace page does not use full screen height like Chat does. These issues make the dashboard frustrating to use for daily monitoring and interaction.

## What Changes

- **Fix Chat SSE event mismatch**: Server sends SSE events named `"sessionUpdate"` (lines 588, 596 in `server.ts`) but the client listens for `"message"` and `"think"` (lines 58, 68 in `chat.js`). Align the event names so agent responses stream to the UI.
- **Add typing indicator in Chat**: Show an animated "agent is typing" indicator while waiting for agent response, remove it when `"done"` or first message chunk arrives.
- **Fix Workspace tree folding**: Add the missing `.tree-folder.collapsed > .tree-children { max-height: 0; }` CSS rule so clicking a directory actually hides/shows its children.
- **Format audit log JSON**: Replace the truncated single-line JSON display with a formatted, indented, expandable JSON view showing full content.
- **Persist audit log expand state**: Track which audit rows the user has expanded and preserve that state across `pollHistory()` refreshes instead of destroying and recreating the DOM.
- **Full-height Workspace page**: Apply the same `h-[calc(100vh-8rem)]` layout pattern used by the Chat tab to the Workspace section.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-dashboard-chat`: Fix SSE event name mismatch preventing agent responses from displaying; add typing/loading indicator during agent response.
- `web-dashboard-session-monitor`: Format audit log JSON readably with indentation; persist expand/collapse state across polling refreshes.
- `web-dashboard-agent-workspace-browser`: Fix directory tree folding by adding missing CSS rule; make workspace page occupy full viewport height.

## Impact

- **Files affected**:
  - `src/dashboard/server.ts` — SSE event names (lines 588, 596)
  - `src/dashboard/public/js/chat.js` — typing indicator logic
  - `src/dashboard/public/js/sessions.js` — audit log formatting and state persistence
  - `src/dashboard/public/js/workspace.js` — no changes needed (JS logic is correct)
  - `src/dashboard/public/style.css` — collapsed tree rule, typing indicator animation
  - `src/dashboard/public/index.html` — workspace section height class, typing indicator element
- **No API changes**: All fixes are in the presentation layer or SSE event naming
- **No dependency changes**: Uses existing Tailwind CSS utilities and vanilla JS
