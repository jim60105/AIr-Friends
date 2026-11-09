# Spec Delta

## MODIFIED Requirements

### Requirement: Global Error Handler

The system SHALL install global handlers for unhandled errors and graceful shutdown signals.

#### Scenario: Unhandled Promise Rejection

- **GIVEN** `setupGlobalErrorHandler` has been called
- **WHEN** an unhandled promise rejection occurs
- **THEN** the process SHALL keep running instead of exiting
- **AND** the error SHALL be logged at ERROR level with stack trace
- **AND** `BaseError` instances SHALL use `toJSON()` for structured logging

#### Scenario: Uncaught Error

- **GIVEN** `setupGlobalErrorHandler` has been called
- **WHEN** an uncaught error occurs
- **THEN** the error SHALL be logged at FATAL level with its message and stack trace, which carries the file, line and column
- **AND** the optional `onFatalError` callback SHALL be invoked

#### Scenario: SIGTERM Graceful Shutdown

- **GIVEN** `enableGracefulShutdown` is `true`
- **WHEN** `SIGTERM` or `SIGINT` is received
- **THEN** the handler SHALL dispatch a `"shutdown"` CustomEvent on `globalThis`
- **AND** duplicate signals SHALL be ignored (idempotent shutdown)
- **AND** `isGracefulShutdownInProgress()` SHALL return `true` after the first signal

## ADDED Requirements

### Requirement: Shutdown Signals Reach Every Registered Handler

A `SIGTERM` or `SIGINT` delivered to the daemon, including one the daemon sends to itself, SHALL invoke every handler registered by the shutdown handler and the global error handler, once per handler.

#### Scenario: Self-sent SIGTERM
- **GIVEN** a process that registered the shutdown handler's signal handlers with a recording shutdown context
- **WHEN** the process sends `SIGTERM` to its own PID
- **THEN** the recording context SHALL observe exactly one shutdown and the process SHALL exit with code 0

#### Scenario: Both handlers registered
- **GIVEN** a process with both the shutdown handler's signal handlers and the global error handler with graceful shutdown enabled
- **WHEN** it receives `SIGINT`
- **THEN** the shutdown flow SHALL run once and the global `"shutdown"` event SHALL be dispatched once
