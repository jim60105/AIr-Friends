Feature: Scheduled Reminders (Feature 23)
  As the AIr-Friends bot
  I want users to schedule one-off reminders in DMs
  So that the bot delivers time-based reminder messages reliably and with workspace isolation

  Background:
    Given the reminders feature is configurable via config.yaml
    And environment variables can override configuration

  # Configuration validation
  Scenario: Configuration defaults and validation
    Given the configuration has no explicit scheduledReminders section
    When the system starts
    Then scheduledReminders.enabled should default to false
    And scheduledReminders.minIntervalMs should default to 60000
    And scheduledReminders.checkIntervalMs should default to 60000
    And scheduledReminders.maxRemindersPerUser should default to 50

  Scenario: Configuration environment variable overrides and validation
    Given the environment sets SCHEDULED_REMINDERS_ENABLED to "true"
    And the environment sets SCHEDULED_REMINDERS_MIN_INTERVAL_MS to "15000"
    And the environment sets SCHEDULED_REMINDERS_CHECK_INTERVAL_MS to "6000"
    And the environment sets SCHEDULED_REMINDERS_MAX_REMINDERS_PER_USER to "5"
    When the system loads configuration
    Then scheduledReminders.enabled should be true
    And scheduledReminders.minIntervalMs should be 15000
    And scheduledReminders.checkIntervalMs should be 6000
    And scheduledReminders.maxRemindersPerUser should be 5

  Scenario: Invalid configuration values are rejected on startup
    Given the configuration file sets scheduledReminders.minIntervalMs to 5000
    When the configuration is validated
    Then startup should fail with a configuration error indicating minIntervalMs must be >= 10000

  Scenario: Invalid checkIntervalMs and maxRemindersPerUser validation
    Given the configuration file sets scheduledReminders.checkIntervalMs to 3000
    And scheduledReminders.maxRemindersPerUser to 0
    When validating configuration
    Then startup should fail with an error stating checkIntervalMs must be >= 5000 and maxRemindersPerUser must be >= 1

  # DM-only command restrictions
  Scenario: set-reminder only allowed in DMs
    Given a user invokes the set-reminder command from a guild channel
    When the command handler checks context
    Then the handler should return an error with HTTP-like status 400 and message "Reminders can only be scheduled via direct message"

  Scenario: cancel-reminder only allowed in DMs
    Given a user invokes cancel-reminder from a public channel
    When the handler checks the event context
    Then it should return an error with status 400 and message "Cancellations must be requested via direct message"

  Scenario: list-reminders only allowed in DMs
    Given a user invokes list-reminders from a server channel
    When access is validated
    Then the command should respond with status 400 and message "List reminders is only available in direct messages"

  # Single set per session enforcement
  Scenario: Only one set-reminder per session allowed
    Given an ACP session is active for the user
    And the session has already executed set-reminder successfully
    When the agent attempts to call set-reminder a second time in the same session
    Then the skill API should respond with 409 Conflict and message "Only one reminder may be scheduled per session"

  Scenario: New session allows set-reminder again
    Given a new ACP session is created for the same user
    When the agent calls set-reminder
    Then the skill executes successfully and returns 200

  # Setting reminders - success and validation
  Scenario: Successfully schedule a reminder in DM
    Given the user sends a DM with command set-reminder
      "time: 2025-12-01T10:00:00Z"
      "message: Take medicine"
    And the scheduled time is in the future and at least minIntervalMs from now
    When the command handler validates and persists the reminder
    Then the handler should append a reminder JSON event to the user workspace reminders.jsonl with fields: id, ts, due_ts, content, enabled=true, delivered=false
    And the command responds with 201 Created and the reminder id

  Scenario: Reject scheduling a reminder in the past
    Given the user requests set-reminder with time "2000-01-01T00:00:00Z"
    When the request is validated
    Then the handler returns status 400 and message "Scheduled time must be in the future"

  Scenario: Reject scheduling a reminder too close to now
    Given minIntervalMs is 60000
    And the user requests a reminder for a time that is 30 seconds from now
    When validating the request
    Then the handler returns status 400 and message "Scheduled time must be at least minIntervalMs milliseconds from now"

  Scenario: Reject when user has reached per-user reminder limit
    Given the user's workspace already contains scheduledReminders.maxRemindersPerUser pending reminders
    When the user attempts to set another reminder
    Then the handler should return status 429 and message "User has reached the maximum number of pending reminders"

  Scenario: Reject empty message content
    Given the user submits set-reminder with an empty message
    When validating payload
    Then return status 400 and message "Reminder message must not be empty"

  Scenario: Reject invalid ISO timestamp format
    Given the user submits set-reminder with time "tomorrow at noon"
    When the handler attempts to parse the timestamp
    Then it should return status 400 and message "Invalid ISO 8601 timestamp"

  Scenario: Reject recurring/cron formats
    Given the user submits set-reminder with cron "0 9 * * *"
    When the handler detects recurrence syntax
    Then it should return 422 Unprocessable Entity with message "Recurring reminders are not supported"

  # Cancelling reminders
  Scenario: Successfully cancel a pending reminder in DM
    Given a user schedules a reminder and receives reminder id "rem-123"
    When the user issues cancel-reminder with id "rem-123" from a DM
    Then the system should append a patch event to reminders.jsonl disabling the reminder (enabled=false)
    And respond with 200 OK and message "Reminder cancelled"

  Scenario: Cancel non-existent reminder
    Given the user issues cancel-reminder with id "rem-999"
    When the system searches the user's reminders
    Then it should respond with 404 Not Found and message "Reminder not found"

  Scenario: Cancel already delivered or cancelled reminder
    Given reminder "rem-124" is already delivered
    When user attempts to cancel it
    Then the handler should respond with 409 Conflict and message "Cannot cancel a delivered or already cancelled reminder"

  Scenario: cancel-reminder invoked from non-DM returns error
    Given a user issues cancel-reminder from a guild channel
    When the handler checks context
    Then it responds with 400 and message "Cancellations must be requested via direct message"

  # Listing reminders
  Scenario: List active pending reminders in DM
    Given the user's workspace has two pending reminders
    When the user invokes list-reminders in a DM
    Then the handler returns 200 OK and a JSON array of pending reminders with id, due_ts, and content

  Scenario: List returns empty when no pending reminders
    Given the user's workspace has no pending reminders
    When the user invokes list-reminders
    Then the handler returns 200 OK and an empty array

  Scenario: list-reminders invoked outside DM returns error
    Given a user invokes list-reminders from a server channel
    When the handler validates context
    Then it returns 400 and message "List reminders is only available in direct messages"

  # Scheduler behavior
  Scenario: Scheduler polls at configured interval and processes due reminders
    Given scheduledReminders.checkIntervalMs is 6000
    And there is a pending reminder due within the next poll
    When the scheduler runs its polling loop
    Then it should call processReminder for the due reminder
    And mark the reminder as delivered (append patch event delivered=true)

  Scenario: Scheduler isolates errors per workspace and per reminder
    Given the scheduler encounters an error while processing reminder A in workspace X
    When processing continues
    Then reminder B in workspace Y should still be processed and delivered successfully

  Scenario: Scheduler prevents overlapping processing of the same reminder
    Given reminder "rem-200" is being processed
    When another scheduler tick attempts to process rem-200 concurrently
    Then the scheduler should skip the concurrent attempt and log an overlap warning

  # DM delivery and ACP session use
  Scenario: Due reminders delivered via DM using ACP send-reply skill
    Given reminder "rem-300" is due
    And getDmChannelId(userId) returns "dm:123"
    When processReminder runs for rem-300
    Then the system should create an ACP session and call the send-reply skill with the reminder content and reply target "dm:123"
    And on success append a patch event marking delivered=true and store delivered_ts

  Scenario: Delivery errors are isolated and do not stop other reminders
    Given processReminder for rem-301 fails due to transient agent error
    When the scheduler continues
    Then other due reminders should still be attempted and delivered where possible

  # Workspace isolation
  Scenario: Reminders persisted per-user workspace only
    Given two users A and B with separate workspace keys
    When user A schedules a reminder
    Then the reminder is appended to A's workspace reminders.jsonl and not visible in B's workspace

  Scenario: Append-only persistence and patch events
    Given a reminder is scheduled
    When it is cancelled or delivered
    Then the system appends a patch event to the same reminders.jsonl describing changes (enabled, delivered, delivered_ts)
    And original create event remains unchanged

  # Restart recovery
  Scenario: Bot restart picks up overdue reminders and delivers them
    Given the bot restarts after being down for 2 hours
    And reminders with due_ts earlier than now exist in user workspaces
    When the scheduler resumes
    Then overdue reminders should be found and processed immediately according to the normal delivery flow

  # No recurring support
  Scenario: Reject attempts to schedule recurring reminders
    Given the user attempts to set a recurring reminder using RRULE or cron
    When the request is validated
    Then the handler returns 422 and message "Recurring reminders are not supported"

  # Metrics
  Scenario: Metrics counters are incremented appropriately
    Given metrics collection is enabled
    When a reminder is set
    Then the counter remindersSetTotal should increment by 1 with label session_type="reminder"
    When a reminder is delivered
    Then remindersDeliveredTotal should increment by 1 with label session_type="reminder"
    When a reminder is cancelled
    Then remindersCancelledTotal should increment by 1 with label session_type="reminder"

  # Edge cases
  Scenario: Overdue reminders processed once only
    Given a reminder is overdue and not yet delivered
    When multiple scheduler ticks occur concurrently
    Then the reminder should be delivered only once and subsequent attempts should detect delivered=true and skip

  Scenario: Invalid reminder storage does not crash scheduler
    Given a malformed reminder JSON line exists in a workspace file
    When the scheduler reads the workspace file
    Then the malformed line should be logged and skipped while valid reminders are processed
