## Context

The AIr-Friends web dashboard is a vanilla JS + Tailwind CSS single-page application served by a Deno backend (`src/dashboard/`). It has four tabs: Sessions, Stats, Workspace, and Chat. Several usability issues have been reported:

1. **Chat SSE mismatch**: `server.ts` sends SSE events named `"sessionUpdate"` (lines 588, 596) but `chat.js` listens for `"message"` and `"think"` (lines 58, 68). Agent responses never reach the UI.
2. **No typing indicator**: No visual feedback while the agent is processing.
3. **Workspace tree folding broken**: `style.css` defines `.tree-folder > .tree-children` with `overflow: hidden` and `transition` but never sets `max-height: 0` when `.collapsed` is toggled.
4. **Audit log unreadable**: JSON is truncated to 120 chars on a single line with no formatting.
5. **Audit rows auto-collapse**: `pollHistory()` replaces the entire `<tbody>` innerHTML every poll cycle, destroying any expanded audit rows.
6. **Workspace not full-height**: The workspace section lacks the `h-[calc(100vh-8rem)]` class that Chat uses.

## Goals / Non-Goals

**Goals:**
- Fix all 6 reported UI issues with minimal, surgical changes
- Maintain the existing vanilla JS architecture (no framework introduction)
- Keep changes purely in the presentation/SSE layer — no API contract changes

**Non-Goals:**
- Refactoring the dashboard to use a framework (React, Vue, etc.)
- Adding new API endpoints
- Changing the ACP integration or skill system
- Adding tests for frontend JS (no test infrastructure exists for it)

## Decisions

### D1: Fix SSE event names on the server side

**Decision**: Change the server's `sendSSE()` calls from `"sessionUpdate"` to `"message"` and `"think"` to match what `chat.js` expects.

**Rationale**: The client code matches the SSE specification's expected patterns. Changing 2 lines in `server.ts` is safer than changing the client listeners. The client's event names (`"message"`, `"think"`, `"done"`, `"error"`, `"disconnect"`) form a clean, self-documenting set.

**Alternative considered**: Change the client to listen for `"sessionUpdate"` and differentiate by payload type. Rejected because it would require parsing type fields in the listener and diverges from SSE best practices of using distinct event names.

### D2: Typing indicator as a DOM element with CSS animation

**Decision**: Add a "typing indicator" div with animated dots that appears when a message is sent and disappears on first `"message"` or `"done"` event.

**Rationale**: A CSS-only animation (bouncing dots) is lightweight, requires no dependencies, and matches the existing dark theme. The indicator is appended to `#chat-messages` and auto-scrolls into view.

### D3: Add missing CSS rule for `.collapsed`

**Decision**: Add `.tree-folder.collapsed > .tree-children { max-height: 0 !important; }` to `style.css` and set a reasonable `max-height` default on `.tree-children`.

**Rationale**: The JS toggle logic in `workspace.js` is already correct — it toggles the `collapsed` class and rotates the arrow. Only the CSS rule to actually hide children is missing. A `max-height` transition with a large default (e.g., `2000px`) provides smooth animation.

### D4: Formatted JSON with expandable detail view for audit logs

**Decision**: Replace the truncated single-line JSON with a clickable summary showing phase + timestamp, and an expandable `<pre>` block with `JSON.stringify(data, null, 2)` for the full formatted content.

**Rationale**: Audit log entries can be large (context assembly, prompt text). A collapsible detail view lets users scan phases quickly and drill into specific entries. Using `<pre>` with `whitespace-pre-wrap` handles long content naturally.

### D5: Preserve expanded audit rows across polling

**Decision**: Before `pollHistory()` replaces innerHTML, collect the set of session IDs whose audit rows are currently expanded. After re-rendering, restore the audit rows for those sessions by calling `toggleAudit()` again.

**Rationale**: This is the simplest approach that doesn't require switching to a virtual DOM or diffing library. The audit data is re-fetched, which ensures it stays fresh. The alternative of DOM-diffing would be over-engineering for a vanilla JS app.

### D6: Full-height workspace layout

**Decision**: Add `flex flex-col h-[calc(100vh-8rem)]` to the workspace `<section>` and adjust the inner flex container to use `flex-1 min-h-0 overflow-hidden`.

**Rationale**: This mirrors exactly what the Chat tab does. The `min-h-0` is needed for flex children to properly constrain overflow in a flex column layout.

## Risks / Trade-offs

- **[Risk] `max-height` transition on tree-children** → Large directories may have a noticeable delay because `max-height` transitions from a large value. Mitigation: acceptable for the workspace size; a proper `height` animation would require JS measurement.
- **[Risk] Re-fetching audit data on poll restore** → Expanded audit rows are re-fetched after each history poll, adding extra HTTP requests. Mitigation: audit endpoints are lightweight reads; polling interval (5s) limits frequency.
- **[Risk] Typing indicator not removed on error** → If the SSE connection drops without a `"done"` event, the indicator might persist. Mitigation: also remove it on `"error"` and `"disconnect"` events.
