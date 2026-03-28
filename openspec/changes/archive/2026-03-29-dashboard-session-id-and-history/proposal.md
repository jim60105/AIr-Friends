## Why

The Dashboard's Session History displays `CompletedSession.id` (format: `{sessionType}_{startTimestamp}`, e.g. `message_1711612345678`), which is an ephemeral in-memory string that cannot be used to query audit logs, correlate with other logging systems, or identify sessions meaningfully. Additionally, session history is lost on restart since it's stored only in memory, and sessions are displayed in oldest-first order, forcing users to scroll to see the most recent activity.

## What Changes

- **Remove** the meaningless `CompletedSession.id` field (the `{sessionType}_{startTimestamp}` string) from the Dashboard UI and data model
- **Replace** it with `shellSessionId` (stored as `auditSessionId`) as the primary session identifier displayed in the UI, enabling direct correlation with audit logs and structured logging
- **Load historical sessions from audit logs** at startup by scanning the `data/audit/` directory, so past sessions survive restarts and appear in the Dashboard
- **Reverse the display order** of session history to show newest sessions first (descending by time)

## Capabilities

### New Capabilities

- `dashboard-audit-history-loader`: Load completed session records from existing audit log files at startup, populating the session history with historical data that persists across restarts

### Modified Capabilities

- `web-dashboard-session-monitor`: Replace `CompletedSession.id` with `auditSessionId` as the displayed identifier; reverse session history sort order to newest-first

## Impact

- `src/dashboard/completed-session-store.ts` — Remove `id` field, use `auditSessionId` as primary key, add audit-log-based initialization, reverse sort order
- `src/dashboard/server.ts` — Update `/api/sessions/history` response and any references to session `id`
- `src/dashboard/public/` — Update frontend JS/HTML to display `auditSessionId` and handle reversed order
- `src/core/session-orchestrator.ts` — Stop generating the `{sessionType}_{startTimestamp}` id string
- `tests/` — Update related tests for new identifier and history behavior
