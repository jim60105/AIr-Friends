# Spontaneous Posting

## Purpose

Defines the autonomous posting system that enables the bot to create and send messages on its own schedule without user triggers, with per-platform scheduling, configurable intervals, probability-based context fetching, and target selection.

## Requirements

### Requirement: SpontaneousScheduler Random Interval Timing

The system SHALL schedule spontaneous posts at random intervals between configurable minimum and maximum values, independently per platform.

#### Scenario: Random interval selection
- **GIVEN** `minIntervalMs` and `maxIntervalMs` configured for a platform
- **WHEN** the scheduler calculates the next execution time
- **THEN** it SHALL pick a random interval in the range `[minIntervalMs, maxIntervalMs)` (min inclusive, max exclusive)

#### Scenario: Default interval values
- **GIVEN** no explicit interval configuration
- **WHEN** defaults are applied
- **THEN** `minIntervalMs` SHALL default to `10800000` (3 hours) and `maxIntervalMs` SHALL default to `43200000` (12 hours)

#### Scenario: Interval validation — minimum clamp
- **GIVEN** `minIntervalMs` configured to less than 60000 (1 minute)
- **WHEN** the scheduler validates the config
- **THEN** it SHALL clamp `minIntervalMs` to `60000`

#### Scenario: Interval validation — swap if reversed
- **GIVEN** `minIntervalMs` greater than `maxIntervalMs`
- **WHEN** the scheduler validates the config
- **THEN** it SHALL swap the values

### Requirement: Per-Platform Independent Timers

The system SHALL maintain independent scheduling state per platform, including separate timers, running flags, and execution timestamps.

#### Scenario: Independent platform scheduling
- **GIVEN** both Discord and Misskey have spontaneous posting enabled
- **WHEN** the scheduler is running
- **THEN** each platform SHALL have its own timer, `isRunning` flag, `lastExecutedAt`, and `nextScheduledAt` timestamps

#### Scenario: Platform-specific enablement
- **GIVEN** Discord spontaneous posting enabled and Misskey disabled
- **WHEN** `start()` is called
- **THEN** a timer SHALL be created only for Discord

### Requirement: Scheduler Lifecycle

The `SpontaneousScheduler` SHALL manage its lifecycle tied to platform connection and shutdown events.

#### Scenario: Start after connect
- **GIVEN** platform adapters are connected
- **WHEN** `start()` is called
- **THEN** it SHALL begin scheduling for all enabled platforms and SHALL NOT allow double-start

#### Scenario: Stop on shutdown
- **GIVEN** the scheduler is running
- **WHEN** `stop()` is called
- **THEN** it SHALL clear all platform timers and clean up state

#### Scenario: Reschedule after execution
- **GIVEN** a spontaneous post execution completes (success or failure)
- **WHEN** the execution callback returns
- **THEN** the scheduler SHALL always schedule the next execution with a new random interval

### Requirement: Scheduler State Persistence

The system SHALL persist scheduler state to survive restarts.

#### Scenario: State restoration on start
- **GIVEN** previously persisted scheduler state
- **WHEN** `start(restoredState)` is called
- **THEN** it SHALL restore previous schedule times and execute immediately if the scheduled time has passed, or schedule for the remaining time

#### Scenario: State saving on schedule
- **GIVEN** a `stateStore` is configured
- **WHEN** the next execution is scheduled
- **THEN** it SHALL save the next scheduled time to the state store

---

### Requirement: Concurrency Prevention

The system SHALL prevent concurrent spontaneous post executions for the same platform.

#### Scenario: Skip if already running
- **GIVEN** a spontaneous post execution is in progress for a platform
- **WHEN** the timer fires again for the same platform
- **THEN** it SHALL skip the execution (checked via `isRunning` flag) and schedule the next attempt

---

### Requirement: Target Selection — Discord

The Discord adapter SHALL select spontaneous post targets from channels configured with `spontaneousPost: true`.

#### Scenario: Random channel selection
- **GIVEN** multiple Discord channels configured with `spontaneousPost: true`
- **WHEN** `determineSpontaneousTarget()` is called
- **THEN** it SHALL randomly select one channel from the eligible list

#### Scenario: Account entry as DM target
- **GIVEN** a `"discord/account/{userId}"` entry with `spontaneousPost: true`
- **WHEN** selected as a target
- **THEN** it SHALL create a DM channel to that user as the posting target

#### Scenario: No eligible targets
- **GIVEN** no channels configured with `spontaneousPost: true`
- **WHEN** `determineSpontaneousTarget()` is called
- **THEN** it SHALL return null and the execution SHALL be skipped

### Requirement: Target Selection — Misskey

The Misskey adapter SHALL support `misskey/timeline/self` and account-based targets for spontaneous posts.

#### Scenario: Timeline self target
- **GIVEN** `"misskey/timeline/self"` in configured channels with `spontaneousPost: true`
- **WHEN** `determineSpontaneousTarget()` is called
- **THEN** `"timeline:self"` SHALL be included as a valid target, creating a new public note without `replyId`

#### Scenario: Account target
- **GIVEN** `"misskey/account/{userId}"` in configured channels with `spontaneousPost: true`
- **WHEN** selected as a target
- **THEN** it SHALL use the account's DM channel (`"chat:{userId}"`) as the posting target

---

### Requirement: Context Assembly for Spontaneous Posts

The `ContextAssembler` SHALL assemble context for spontaneous posts via `assembleSpontaneousContext()`, differing from normal message context in key ways.

#### Scenario: No trigger message
- **GIVEN** a spontaneous post session
- **WHEN** context is assembled
- **THEN** there SHALL be no trigger message and no `triggerEvent` in the session

#### Scenario: Important memories always included
- **GIVEN** a spontaneous post session
- **WHEN** context is assembled
- **THEN** it SHALL fetch and include important memories from the bot's workspace

#### Scenario: Probability-based recent message fetching
- **GIVEN** `contextFetchProbability` is `0.5`
- **WHEN** the scheduler prepares a spontaneous post
- **THEN** there SHALL be approximately a 50% chance that recent messages are fetched from the target channel

#### Scenario: Probability clamping
- **GIVEN** `contextFetchProbability` configured outside the range `[0.0, 1.0]`
- **WHEN** the config is validated
- **THEN** the value SHALL be clamped to `[0.0, 1.0]`

#### Scenario: Recent message fetch failure
- **GIVEN** `fetchRecentMessages` is `true` but the fetch fails
- **WHEN** context assembly proceeds
- **THEN** it SHALL log a warning and return an empty recent messages array (non-fatal)

#### Scenario: Available emojis
- **GIVEN** a spontaneous post context assembly
- **WHEN** emojis are fetched
- **THEN** it SHALL include available emojis from the platform, failing gracefully on error (returns undefined)

#### Scenario: No related messages search
- **GIVEN** a spontaneous post session
- **WHEN** context is assembled
- **THEN** it SHALL NOT perform related messages search (unlike normal message context)

---

### Requirement: Prompt Template

Spontaneous post sessions SHALL use the `system_spontaneous.md` Vento template with specific template variables.

#### Scenario: Template variables
- **GIVEN** a spontaneous post session
- **WHEN** the prompt is rendered
- **THEN** the template SHALL receive variables including `recentMessagesFetched` (boolean), `importantMemories` (formatted text), `recentMessages` (formatted text), `availableEmojis` (formatted text), `sessionId`, `agentType`, `model`, `yolo`, `isDm` (hardcoded `false`), `platform` (hardcoded `"internal"`), `userId` (empty string), `channelId` (empty string), and `guildId` (empty string)

#### Scenario: recentMessagesFetched flag
- **GIVEN** recent messages were fetched successfully
- **WHEN** the template renders
- **THEN** `recentMessagesFetched` SHALL be `true`, allowing the template to conditionally include recent message context

---

### Requirement: Bot Workspace Key

Spontaneous post sessions SHALL use the bot's own identity for workspace resolution.

#### Scenario: Workspace key
- **GIVEN** a spontaneous post session on platform `"discord"` with bot ID `"botId123"`
- **WHEN** the workspace key is generated
- **THEN** it SHALL be `"discord/botId123"` (using the bot's own user ID, not a real user)

---

### Requirement: Session Type

Spontaneous post sessions SHALL be identified with session type `"spontaneous"`.

#### Scenario: Session type identification
- **GIVEN** a spontaneous post is triggered
- **WHEN** a session is created
- **THEN** the session type SHALL be `"spontaneous"` for metrics, audit, and model routing purposes

---

### Requirement: Agent Execution and Reply

The spontaneous post session SHALL execute the full agent prompt flow with retry support.

#### Scenario: Agent prompt execution
- **GIVEN** assembled context and rendered prompt
- **WHEN** the session executes
- **THEN** it SHALL create an ACP connector, connect, create a session, set the model, send the prompt, and wait for the agent to call `send-reply`

#### Scenario: Multiple replies allowed
- **GIVEN** a spontaneous post session
- **WHEN** the agent calls `send-reply` multiple times
- **THEN** each call SHALL send a separate message to the platform

#### Scenario: Retry on missing reply
- **GIVEN** the agent completes without calling `send-reply`
- **WHEN** `stopReason` is `"end_turn"` and retry threshold is not exceeded
- **THEN** it SHALL retry on the same ACP session with a retry prompt

---

### Requirement: Error Isolation

Spontaneous post errors SHALL never crash the bot and SHALL always allow the next scheduled execution.

#### Scenario: Execution error handling
- **GIVEN** any error occurs during spontaneous post execution (context assembly, agent connection, prompt failure)
- **WHEN** the error is caught
- **THEN** it SHALL log the error, return a failure `SessionResponse`, and the scheduler SHALL proceed to schedule the next execution

#### Scenario: Cleanup guarantee
- **GIVEN** a spontaneous post session (success or failure)
- **WHEN** the session completes
- **THEN** the `finally` block SHALL always disconnect the agent, remove the session from the registry, and clean up the tmp directory

#### Scenario: Metrics recording
- **GIVEN** a completed spontaneous post session
- **WHEN** the session ends
- **THEN** it SHALL record metrics for session count and duration, labeled with platform, session type `"spontaneous"`, and status (success/failure)

---

### Requirement: Environment Variable Overrides

Spontaneous posting configuration SHALL be overridable per platform via environment variables.

#### Scenario: Discord overrides
- **GIVEN** `DISCORD_SPONTANEOUS_ENABLED`, `DISCORD_SPONTANEOUS_MIN_INTERVAL_MS`, `DISCORD_SPONTANEOUS_MAX_INTERVAL_MS`, or `DISCORD_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` env vars
- **WHEN** configuration is loaded
- **THEN** they SHALL override the corresponding `platforms.discord.spontaneousPost.*` config values

#### Scenario: Misskey overrides
- **GIVEN** `MISSKEY_SPONTANEOUS_ENABLED`, `MISSKEY_SPONTANEOUS_MIN_INTERVAL_MS`, `MISSKEY_SPONTANEOUS_MAX_INTERVAL_MS`, or `MISSKEY_SPONTANEOUS_CONTEXT_FETCH_PROBABILITY` env vars
- **WHEN** configuration is loaded
- **THEN** they SHALL override the corresponding `platforms.misskey.spontaneousPost.*` config values

---

### Requirement: Status Reporting

The scheduler SHALL provide status information for observability.

#### Scenario: Status query
- **GIVEN** a running scheduler
- **WHEN** `getStatus()` is called
- **THEN** it SHALL return a map of platform to `{ isRunning, lastExecutedAt, nextScheduledAt }` for each enabled platform
