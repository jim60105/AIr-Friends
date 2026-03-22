## 1. Fix Chat SSE Event Names

- [x] 1.1 In `src/dashboard/server.ts`, change `sendSSE(sseController, "sessionUpdate", ...)` on line 588 (agent_message_chunk) to `sendSSE(sseController, "message", ...)`
- [x] 1.2 In `src/dashboard/server.ts`, change `sendSSE(sseController, "sessionUpdate", ...)` on line 596 (agent_thought_chunk) to `sendSSE(sseController, "think", ...)`

## 2. Add Chat Typing Indicator

- [x] 2.1 In `src/dashboard/public/js/chat.js`, add a `showTypingIndicator()` function that appends an animated typing indicator element to `#chat-messages`
- [x] 2.2 In `src/dashboard/public/js/chat.js`, add a `removeTypingIndicator()` function that removes the typing indicator element
- [x] 2.3 Call `showTypingIndicator()` in `chatSend()` after the user message is appended
- [x] 2.4 Call `removeTypingIndicator()` at the start of the `"message"`, `"done"`, `"error"`, and `"disconnect"` event handlers
- [x] 2.5 Add typing indicator CSS animation (bouncing dots) to `src/dashboard/public/style.css`

## 3. Fix Workspace Directory Tree Folding

- [x] 3.1 Add `.tree-folder.collapsed > .tree-children { max-height: 0 !important; }` rule to `src/dashboard/public/style.css`
- [x] 3.2 Add `.tree-folder > .tree-children { max-height: 2000px; }` default max-height to enable CSS transition

## 4. Format Audit Log JSON

- [x] 4.1 In `src/dashboard/public/js/sessions.js` `toggleAudit()`, replace the truncated single-line JSON display with a clickable summary (timestamp + phase) and an expandable `<pre>` block using `JSON.stringify(e.data, null, 2)`
- [x] 4.2 Style the formatted JSON entries with appropriate spacing and overflow handling

## 5. Persist Audit Log Expand State

- [x] 5.1 In `src/dashboard/public/js/sessions.js`, add a `Set` to track which session IDs have expanded audit rows
- [x] 5.2 In `pollHistory()`, before replacing innerHTML, collect currently expanded session IDs from the DOM
- [x] 5.3 In `pollHistory()`, after re-rendering, re-expand audit rows for previously expanded session IDs by calling `toggleAudit()`

## 6. Full-Height Workspace Layout

- [x] 6.1 In `src/dashboard/public/index.html`, add `flex flex-col h-[calc(100vh-8rem)]` to the `<section id="tab-workspace">` element
- [x] 6.2 Update the inner flex container to use `flex-1 min-h-0 overflow-hidden` so panels fill available space and scroll independently
