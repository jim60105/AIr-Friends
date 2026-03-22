## 1. Fix Workspace File Path Mismatch

- [x] 1.1 In `src/dashboard/server.ts` `handleWorkspaceFile()`, strip leading `/` from `filePath` before path traversal validation
- [x] 1.2 Add/update tests for `handleWorkspaceFile` with leading-slash paths, plain paths, and traversal attempts

## 2. Fix Chat Message Field Name

- [x] 2.1 In `src/dashboard/public/js/chat.js` `chatSend()`, change `message: msg` to `content: msg` in the fetch body
- [x] 2.2 Verify chat message sending works end-to-end (manual or integration test)

## 3. Populate Model Dropdown from Config

- [x] 3.1 Add `/api/config/models` endpoint in `src/dashboard/server.ts` that returns unique models from `modelRouting.rules[].model` + default `agent.model`
- [x] 3.2 Update frontend to fetch `/api/config/models` on page load and populate the `<datalist id="model-suggestions">` dynamically
- [x] 3.3 Add tests for the `/api/config/models` endpoint with various config scenarios

## 4. Fix Session Audit ID Mismatch

- [x] 4.1 Add `auditSessionId?: string` field to `CompletedSession` interface in `src/dashboard/completed-session-store.ts`
- [x] 4.2 Pass the skill-API session ID (`sess_*`) when calling `completedSessionStore.add()` in `src/core/session-orchestrator.ts`
- [x] 4.3 Update `/api/sessions/history` response and frontend `sessions.js` to use `auditSessionId` for audit lookups
- [x] 4.4 Add tests for audit lookup using the correct session ID format
