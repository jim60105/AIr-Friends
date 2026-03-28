## 1. Data Model Changes

- [x] 1.1 Remove `id` field from `CompletedSession` interface in `src/dashboard/completed-session-store.ts`; make `auditSessionId` a required `string` field
- [x] 1.2 Update `CompletedSessionStore.getAll()` to return sessions sorted by `endedAt` descending (newest first)
- [x] 1.3 Add `addMany(sessions: CompletedSession[])` method to `CompletedSessionStore` for bulk loading historical sessions, maintaining capacity limit and sort order

## 2. Audit History Loader

- [x] 2.1 Create `src/dashboard/audit-history-loader.ts` with `loadSessionsFromAuditLogs(auditBasePath: string)` function that scans `{auditBasePath}/{platform}/{userId}/*.jsonl` files
- [x] 2.2 Implement metadata extraction: parse first and last JSONL lines to extract platform (from path), userId (from path), sessionType, timestamps, status, and durationMs
- [x] 2.3 Handle edge cases: missing `session_end` entry (mark as failure), corrupted files (skip with warning), empty directory (return empty array)
- [x] 2.4 Limit scan results to 100 most recent sessions by end timestamp

## 3. Session Orchestrator Updates

- [x] 3.1 Update all `completedSessionStore.add()` call sites in `src/core/session-orchestrator.ts` to remove the `id` field and ensure `auditSessionId` is always set (use `sess_noaudit_{timestamp}` fallback when `shellSessionId` is unavailable)

## 4. Dashboard Server Updates

- [x] 4.1 Update `handleSessionHistory()` in `src/dashboard/server.ts` to return sessions without `id` field, using `auditSessionId` as identifier
- [x] 4.2 Integrate audit history loader into `DashboardServer` initialization: call `loadSessionsFromAuditLogs()` asynchronously (non-blocking) and populate `CompletedSessionStore` via `addMany()` without blocking platform connections or request serving

## 5. Frontend Updates

- [x] 5.1 Update `src/dashboard/public/js/sessions.js` (or equivalent) to use `auditSessionId` as the primary identifier in session history table rows
- [x] 5.2 Remove any references to `s.id` fallback in the frontend polling/rendering logic
- [x] 5.3 Display "No audit log available" message in the audit detail view when a session has a `sess_noaudit_` prefixed identifier

## 6. Tests

- [x] 6.1 Add unit tests for `CompletedSessionStore` changes: `getAll()` sort order, `addMany()` bulk loading, capacity eviction
- [x] 6.2 Add unit tests for `loadSessionsFromAuditLogs()`: happy path, corrupted files, missing `session_end`, empty directory, capacity limit
- [x] 6.3 Update existing tests in `tests/dashboard/` and `tests/core/session-orchestrator.test.ts` to remove `id` field references and use `auditSessionId`
