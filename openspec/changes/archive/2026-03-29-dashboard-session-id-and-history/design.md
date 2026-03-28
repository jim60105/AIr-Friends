## Context

The Dashboard's Session History feature (`GET /api/sessions/history`) displays completed sessions stored in an in-memory ring buffer (`CompletedSessionStore`, max 100 entries). Each `CompletedSession` has an `id` field formatted as `{sessionType}_{startTimestamp}` (e.g., `message_1711612345678`) which is generated ad-hoc in `SessionOrchestrator` and has no correlation to any persistent identifier. The meaningful identifier — `shellSessionId` (format: `sess_{base36timestamp}_{uuid}`) — is already stored as `auditSessionId` but is secondary in the data model.

Audit logs are written as JSONL files at `{auditBasePath}/{platform}/{userId}/{sessionId}.jsonl`, where `sessionId` matches the `shellSessionId`. These files persist across restarts, but the dashboard cannot display them because the session history is purely in-memory.

## Goals / Non-Goals

**Goals:**

- Use `auditSessionId` (`shellSessionId`) as the primary session identifier in the Dashboard, removing the meaningless `CompletedSession.id` field
- Populate session history from persisted audit log files at startup, so past sessions are visible after restart
- Display sessions in newest-first (descending) order in the Dashboard UI

**Non-Goals:**

- Changing the audit log format or adding new fields to audit entries
- Adding pagination to the session history API (current 100-entry limit remains)
- Changing the `shellSessionId` generation logic
- Modifying the active sessions view or stats endpoints
- Adding database storage for session history (audit log files are the source of truth)

## Decisions

### D1: Remove `CompletedSession.id`, promote `auditSessionId` to required field

**Decision**: Remove the `id` field from `CompletedSession` interface entirely and make `auditSessionId` a required `string` field (no longer optional). This field becomes the primary identifier for completed sessions.

**Rationale**: The `id` field (`{sessionType}_{timestamp}`) is generated in-memory, not persisted anywhere, and cannot be used for querying audit logs or correlating with other systems. The `auditSessionId` (`shellSessionId`) is already the identifier used for audit log filenames, Skill API session registration, and structured logging. Making it the sole identifier eliminates confusion.

**Alternative considered**: Keep `id` as a computed display field → rejected because it adds no value and creates ambiguity about which identifier to use.

### D2: Scan audit log directory at startup to reconstruct session history

**Decision**: On `CompletedSessionStore` initialization, scan the audit log directory (`data/audit/{platform}/{userId}/*.jsonl`) for existing audit log files. For each file, extract metadata from the first (`context_assembly` or earliest) and last (`session_end` or latest) entries to reconstruct `CompletedSession` records. Populate the store with the most recent 100 sessions (by end time).

**Rationale**: Audit logs already contain all the information needed to reconstruct session history (platform, userId, sessionType, timestamps, success/failure status). This approach requires no new storage mechanism and leverages existing persistent data.

**Alternative considered**: Persist `CompletedSession` records to a separate JSONL file → rejected because it duplicates information already in audit logs and adds another file to manage.

### D3: Reverse sort order to newest-first

**Decision**: The `CompletedSessionStore.getAll()` method returns sessions sorted by `endedAt` descending (newest first). The in-memory array stores sessions in insertion order; `getAll()` returns a reversed copy.

**Rationale**: Users monitoring the dashboard care most about recent activity. Newest-first is the standard UX pattern for activity feeds and log viewers.

### D4: Handle sessions without audit logs gracefully

**Decision**: When `auditSessionId` is unavailable (e.g., `skillApi.enabled` is false, or audit is disabled), sessions are still recorded in the in-memory store with `auditSessionId` set to a generated fallback ID (`sess_noaudit_{timestamp}`). The audit detail view shows "No audit log available" for these sessions.

**Rationale**: The system must remain functional even when audit logging is disabled. A predictable fallback ID format avoids null-handling complexity throughout the codebase.

## Risks / Trade-offs

- **[Startup latency with large audit directories]** → Mitigation: Limit scan to most recent N files per user directory (sorted by filename/mtime), cap total scan at 100 entries. Use async I/O and fail gracefully on corrupted files.
- **[Corrupted or incomplete audit files]** → Mitigation: Skip files that fail to parse; log a warning. A missing `session_end` entry means the session crashed — record as `status: "failure"`.
- **[Breaking change for API consumers]** → Mitigation: The `id` field removal is a breaking change for any external tooling consuming `/api/sessions/history`. Since the dashboard is an internal tool with no documented external API contract, the risk is minimal.
- **[Memory overhead during scan]** → Mitigation: Process files one at a time, extracting only first/last lines rather than loading entire files. Discard intermediate data immediately.
