# Scheduled Reminders

## Purpose

DM-only one-off reminders that users can schedule, cancel, and list via skill calls, with append-only JSONL persistence per workspace, fixed-interval polling for delivery, and restart recovery.

## Requirements

### Requirement: DM-Only Access Restriction

The `set-reminder`, `cancel-reminder`, and `list-reminders` skill handlers SHALL reject calls from non-DM contexts. The system SHALL check `context.workspace.isDm` and return an error when it is `false`.

#### Scenario: set-reminder rejected in non-DM context

- **GIVEN** a user invokes `set-reminder` from a guild channel
- **WHEN** the handler checks `context.workspace.isDm`
- **THEN** the handler SHALL return `success: false` with an error message indicating reminders are only available in DMs

#### Scenario: cancel-reminder rejected in non-DM context

- **GIVEN** a user invokes `cancel-reminder` from a public channel
- **WHEN** the handler checks `context.workspace.isDm`
- **THEN** the handler SHALL return `success: false` with an error message indicating DM-only access

#### Scenario: list-reminders rejected in non-DM context

- **GIVEN** a user invokes `list-reminders` from a server channel
- **WHEN** the handler checks `context.workspace.isDm`
- **THEN** the handler SHALL return `success: false` with an error message indicating DM-only access

### Requirement: Set Reminder with Validation

The `set-reminder` handler SHALL validate: `scheduledAt` is a valid ISO 8601 timestamp, `scheduledAt` is at least `minIntervalMs` in the future, `message` is a non-empty string, and the user has not exceeded `maxRemindersPerUser` active reminders. On success, the handler SHALL append a `ReminderEntry` to the workspace `reminders.jsonl` and return the generated reminder ID.

#### Scenario: Successfully schedule a reminder

- **GIVEN** the user sends a valid `scheduledAt` (at least `minIntervalMs` in the future) and a non-empty `message` in a DM
- **WHEN** the handler validates and persists the reminder
- **THEN** the handler SHALL append a `ReminderEntry` with `type: "reminder"`, a unique `id` (format `rem_TIMESTAMP_UUID`), `enabled: true`, and the provided fields to `reminders.jsonl`
- **AND** return `success: true` with the `reminderId` and `scheduledAt`

#### Scenario: Reject invalid ISO timestamp

- **GIVEN** `scheduledAt` is not a valid date string
- **WHEN** the handler attempts to parse it
- **THEN** the handler SHALL return `success: false` with an error about invalid format

#### Scenario: Reject time too close to now

- **GIVEN** `minIntervalMs` is `60000` and `scheduledAt` is 30 seconds from now
- **WHEN** the handler validates the time
- **THEN** the handler SHALL return `success: false` with an error indicating the minimum interval

#### Scenario: Reject empty message

- **GIVEN** `message` is empty or missing
- **WHEN** the handler validates the payload
- **THEN** the handler SHALL return `success: false` with an error about missing or empty message

#### Scenario: Reject when per-user limit reached

- **GIVEN** the user already has `maxRemindersPerUser` active reminders
- **WHEN** the user attempts to set another
- **THEN** the handler SHALL return `success: false` with an error indicating the maximum has been reached

### Requirement: Single Set-Reminder Per Session

The `set-reminder` handler SHALL allow only one successful `set-reminder` call per session (tracked by `workspaceKey:channelId`). Subsequent calls in the same session SHALL be rejected. The session tracking SHALL be clearable via `clearSessionState()`.

#### Scenario: Second set-reminder in same session rejected

- **GIVEN** a session has already executed `set-reminder` successfully
- **WHEN** the agent calls `set-reminder` again in the same session
- **THEN** the handler SHALL return `success: false` with an error about one reminder per session

#### Scenario: New session allows set-reminder again

- **GIVEN** the session state has been cleared via `clearSessionState()`
- **WHEN** the agent calls `set-reminder` in the new session
- **THEN** the handler SHALL execute successfully

### Requirement: Cancel Reminder

The `cancel-reminder` handler SHALL validate DM context, require a non-empty `reminderId`, verify the reminder exists and belongs to the calling user, and verify the reminder is still enabled. On success, the handler SHALL append a `ReminderPatch` with `changes: { enabled: false }` to `reminders.jsonl`.

#### Scenario: Successfully cancel a pending reminder

- **GIVEN** reminder `rem-123` exists, is enabled, and belongs to the calling user
- **WHEN** the user issues `cancel-reminder` with `reminderId: "rem-123"` in a DM
- **THEN** the system SHALL append a `ReminderPatch` disabling the reminder and return `success: true`

#### Scenario: Cancel non-existent reminder

- **GIVEN** no reminder with `reminderId: "rem-999"` exists
- **WHEN** the user issues `cancel-reminder`
- **THEN** the handler SHALL return `success: false` with `"Reminder not found"`

#### Scenario: Cancel already disabled reminder

- **GIVEN** reminder `rem-124` is already disabled (cancelled or delivered)
- **WHEN** the user attempts to cancel it
- **THEN** the handler SHALL return `success: false` with an error indicating the reminder is already cancelled or delivered

#### Scenario: Cannot cancel another user's reminder

- **GIVEN** reminder `rem-125` belongs to a different user
- **WHEN** the calling user attempts to cancel it
- **THEN** the handler SHALL return `success: false` with an error about ownership

### Requirement: List Reminders

The `list-reminders` handler SHALL return all active pending reminders (enabled and `scheduledAt` in the future) for the calling user's workspace. The response SHALL include `id`, `message`, `scheduledAt`, and `createdAt` for each reminder.

#### Scenario: List active pending reminders

- **GIVEN** the user's workspace has two pending reminders
- **WHEN** the user invokes `list-reminders` in a DM
- **THEN** the handler SHALL return `success: true` with an array of pending reminders and their count

#### Scenario: No pending reminders returns empty array

- **GIVEN** the user has no pending reminders
- **WHEN** the user invokes `list-reminders`
- **THEN** the handler SHALL return `success: true` with an empty array and `count: 0`

### Requirement: Append-Only JSONL Persistence

`ReminderStore` SHALL persist reminders as append-only JSONL in `reminders.jsonl` within each workspace. New reminders SHALL be appended as `ReminderEntry` events (`type: "reminder"`). State changes (cancel, delivery) SHALL be appended as `ReminderPatch` events (`type: "reminder-patch"`). Loading SHALL use two-pass resolution: collect all entries, then apply patches sorted by timestamp.

#### Scenario: Two-pass resolution applies patches in order

- **GIVEN** a `reminders.jsonl` file contains a reminder entry followed by two patch events
- **WHEN** `loadReminders()` is called
- **THEN** the system SHALL apply patches in timestamp order to produce the resolved state

#### Scenario: Malformed JSONL lines are skipped

- **GIVEN** a `reminders.jsonl` file contains a malformed JSON line among valid entries
- **WHEN** `loadReminders()` is called
- **THEN** the malformed line SHALL be logged as a warning and skipped; valid reminders SHALL be returned

#### Scenario: Missing file returns empty array

- **GIVEN** no `reminders.jsonl` file exists in the workspace
- **WHEN** `loadReminders()` is called
- **THEN** the system SHALL return an empty array without error

### Requirement: Fixed-Interval Polling Scheduler

`ReminderScheduler` SHALL poll at `checkIntervalMs` intervals using `setTimeout`. The scheduler SHALL prevent overlapping executions — if a previous check is still running, the current tick SHALL be skipped. Errors in the callback SHALL be caught and logged without stopping the scheduler. The scheduler SHALL schedule the next tick in the `finally` block.

#### Scenario: Overlapping execution is skipped

- **GIVEN** a previous reminder check is still running (`isRunning` is `true`)
- **WHEN** the next timer fires
- **THEN** the scheduler SHALL skip execution and schedule the next tick

#### Scenario: Callback error does not stop scheduler

- **GIVEN** the callback throws an error during execution
- **WHEN** the error is caught
- **THEN** the scheduler SHALL log the error and schedule the next tick

### Requirement: Restart Recovery

The scheduler SHALL use polling (not per-reminder timers) so that bot restarts automatically pick up overdue reminders. When `getDueReminders()` is called, it SHALL return all enabled reminders with `scheduledAt <= now`, including those that became overdue during downtime.

#### Scenario: Overdue reminders found after restart

- **GIVEN** the bot was down for 2 hours and reminders with `scheduledAt` in the past exist
- **WHEN** the scheduler resumes and calls `getDueReminders()`
- **THEN** overdue reminders SHALL be returned for processing

### Requirement: Workspace Isolation

Reminders SHALL be persisted per-user workspace. Each workspace has its own `reminders.jsonl` file. Reminders in one workspace SHALL NOT be visible or accessible from another workspace.

#### Scenario: User A's reminders not visible to User B

- **GIVEN** users A and B have separate workspaces
- **WHEN** user A schedules a reminder
- **THEN** the reminder SHALL be appended only to user A's workspace `reminders.jsonl`

### Requirement: Configuration and Defaults

The `reminders` config section SHALL default to: `enabled: false`, `minIntervalMs: 60000`, `checkIntervalMs: 30000`, `maxRemindersPerUser: 20`, `persistPath: "reminders.jsonl"`. Environment variables `REMINDERS_ENABLED`, `REMINDERS_MIN_INTERVAL_MS`, `REMINDERS_CHECK_INTERVAL_MS`, `REMINDERS_MAX_PER_USER`, and `REMINDERS_PERSIST_PATH` MAY override config values. Configuration validation SHALL clamp `minIntervalMs` to a minimum of `10000`, `checkIntervalMs` to a minimum of `5000`, and `maxRemindersPerUser` to a minimum of `1`, logging a warning when clamping occurs.

#### Scenario: Default configuration values

- **GIVEN** no explicit `reminders` section in config
- **WHEN** the system starts
- **THEN** defaults SHALL be `enabled: false`, `minIntervalMs: 60000`, `checkIntervalMs: 30000`, `maxRemindersPerUser: 20`, `persistPath: "reminders.jsonl"`

#### Scenario: Invalid minIntervalMs clamped

- **GIVEN** `reminders.minIntervalMs` is set to `5000`
- **WHEN** configuration is validated
- **THEN** the value SHALL be clamped to `10000` and a warning SHALL be logged

### Requirement: Metrics Integration

The system SHALL increment `airfriends_reminders_set_total` (labeled by `platform`) when a reminder is successfully set. The system SHALL increment `airfriends_reminders_cancelled_total` (labeled by `platform`) when a reminder is cancelled.

#### Scenario: Set reminder increments metric

- **GIVEN** metrics collection is enabled
- **WHEN** a reminder is successfully set on Discord
- **THEN** `airfriends_reminders_set_total{platform="discord"}` SHALL be incremented by 1
