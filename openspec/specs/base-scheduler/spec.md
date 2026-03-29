# Base Scheduler

## Purpose

Abstract base class that encapsulates common scheduler lifecycle management — timer scheduling, concurrency guards, state persistence, and start/stop lifecycle — shared by all scheduler implementations in the system.

## Requirements

### Requirement: BaseScheduler provides common lifecycle management
The system SHALL provide an abstract `BaseScheduler<TCallback>` class that encapsulates timer management, concurrency guards, state persistence, and start/stop lifecycle shared by all scheduler implementations.

#### Scenario: Scheduler starts and schedules first execution
- **WHEN** `start()` is called on a scheduler that is enabled and not already started
- **THEN** the scheduler SHALL set `started = true`, compute the next delay via `getNextDelayMs()`, and schedule execution via `setTimeout`

#### Scenario: Scheduler prevents double-start
- **WHEN** `start()` is called on a scheduler that is already started
- **THEN** the scheduler SHALL log a warning and return without scheduling another timer

#### Scenario: Scheduler stops cleanly
- **WHEN** `stop()` is called on a running scheduler
- **THEN** the scheduler SHALL clear the active timer, set `started = false`, and reset `nextScheduledAt` to null

#### Scenario: Execute enforces concurrency guard
- **WHEN** the scheduler's `execute()` fires while a previous execution is still running (`isRunning = true`)
- **THEN** the scheduler SHALL log a warning, skip the callback invocation, and reschedule the next execution

#### Scenario: Execute invokes callback and records completion
- **WHEN** `execute()` fires and `isRunning` is false
- **THEN** the scheduler SHALL set `isRunning = true`, invoke `executeCallback()`, set `lastExecutedAt` to current time, set `isRunning = false`, and call `scheduleNext()` if still started

#### Scenario: Execute handles callback errors gracefully
- **WHEN** the callback throws an error during `execute()`
- **THEN** the scheduler SHALL log the error, set `isRunning = false`, and still call `scheduleNext()` to continue scheduling

#### Scenario: State persistence on schedule
- **WHEN** `scheduleNext()` is called and a `stateStore` is configured
- **THEN** the scheduler SHALL persist the next scheduled time via `stateStore.save()`

#### Scenario: Start with restored state
- **WHEN** `start(restoredState)` is called with a previously persisted schedule time
- **THEN** the scheduler SHALL use `resolveScheduleTime()` to compute the appropriate delay from the restored timestamp

### Requirement: BaseScheduler exposes status information
The system SHALL provide a `getStatus()` method that returns the scheduler's current operational state.

#### Scenario: Status returns current state
- **WHEN** `getStatus()` is called on a scheduler
- **THEN** it SHALL return an object containing `isRunning`, `lastExecutedAt`, and `nextScheduledAt` fields

### Requirement: Subclasses define scheduling strategy
Each scheduler subclass SHALL implement `getNextDelayMs()` to define its scheduling interval (fixed or random) and `isEnabled()` to determine if the scheduler should run.

#### Scenario: Fixed-interval scheduler returns constant delay
- **WHEN** `getNextDelayMs()` is called on a fixed-interval scheduler (e.g., GitBackupScheduler)
- **THEN** it SHALL return the configured `intervalMs` value

#### Scenario: Random-interval scheduler returns randomized delay
- **WHEN** `getNextDelayMs()` is called on a random-interval scheduler (e.g., SpontaneousScheduler)
- **THEN** it SHALL return a value between `minIntervalMs` and `maxIntervalMs`
