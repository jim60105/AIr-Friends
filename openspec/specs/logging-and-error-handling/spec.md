# Logging and Error Handling

## Purpose

Defines the structured JSON logging system, GELF transport, error class hierarchy, session error isolation, connection retry management, health check endpoints, and global error handling.

## Requirements

### Requirement: Structured JSON Logging

The system SHALL use structured JSON logging via `createLogger("ModuleName")` with all output written to stdout/stderr.

#### Scenario: Log Entry Format

- **GIVEN** a logger is created with `createLogger("SessionOrchestrator")`
- **WHEN** `logger.info("Operation completed", { userId, channelId })` is called
- **THEN** the output SHALL be a single JSON line containing: `timestamp` (ISO 8601), `level` ("INFO"), `module` ("SessionOrchestrator"), `message` ("Operation completed"), and `context` ({ userId, channelId })

#### Scenario: Log Level Filtering

- **GIVEN** `LOG_LEVEL` environment variable is set to `"WARN"`
- **WHEN** `logger.info(...)` is called
- **THEN** the message SHALL NOT be emitted
- **AND** only WARN, ERROR, and FATAL messages SHALL be output

#### Scenario: Log Level Hierarchy

- **GIVEN** the `LogLevel` enum
- **WHEN** log levels are compared
- **THEN** the order SHALL be: DEBUG (0) < INFO (1) < WARN (2) < ERROR (3) < FATAL (4)

#### Scenario: Error Output Routing

- **GIVEN** a log entry at ERROR or FATAL level
- **WHEN** the entry is output
- **THEN** it SHALL be written to `console.error` (stderr)
- **AND** DEBUG, INFO, and WARN entries SHALL be written to `console.log` (stdout)

#### Scenario: Default Log Level

- **GIVEN** no `LOG_LEVEL` environment variable is set and no explicit config
- **WHEN** a logger is created
- **THEN** the default level SHALL be `INFO`

### Requirement: Sensitive Data Masking

The system SHALL automatically detect and redact sensitive data in log output.

#### Scenario: Key-Based Redaction

- **GIVEN** a context object contains a key matching `/token|password|secret|key|auth/i`
- **WHEN** the logger sanitizes the context
- **THEN** the value SHALL be replaced with `"[REDACTED]"`

#### Scenario: Pattern-Based Redaction

- **GIVEN** a string value matches patterns for tokens (e.g., `Bearer ...`), API keys, or long base64-like strings (40+ chars)
- **WHEN** the logger sanitizes the value
- **THEN** matching substrings SHALL be replaced with `"[REDACTED]"`

#### Scenario: Nested Object Sanitization

- **GIVEN** a context contains nested objects and arrays
- **WHEN** the logger sanitizes the context
- **THEN** it SHALL recursively sanitize all nested values

### Requirement: Message Template Syntax

The system SHALL support Message Template syntax (`{PropertyName}`) for structured log messages following messagetemplates.org.

#### Scenario: Template Rendering

- **GIVEN** `logger.info("Session {sessionId} model set to {modelId}", { sessionId: "abc", modelId: "gpt-4" })`
- **WHEN** the log entry is formatted
- **THEN** `message` SHALL be `"Session abc model set to gpt-4"`
- **AND** `messageTemplate` SHALL be `"Session {sessionId} model set to {modelId}"`

#### Scenario: Unmatched Placeholders

- **GIVEN** a template contains `{unknownProp}` not present in context
- **WHEN** the log entry is formatted
- **THEN** the placeholder SHALL be preserved as-is in the rendered message

#### Scenario: Escape Sequences

- **GIVEN** a template contains `{{` or `}}`
- **WHEN** the log entry is formatted
- **THEN** they SHALL be rendered as literal `{` and `}`

#### Scenario: Null and Object Values

- **GIVEN** a context property is `null`, `undefined`, or an object
- **WHEN** the template is rendered
- **THEN** `null`/`undefined` SHALL be replaced with empty string
- **AND** objects SHALL be serialized with `JSON.stringify()`

#### Scenario: No Template Detected

- **GIVEN** a message contains no `{PropertyName}` patterns
- **WHEN** the log entry is formatted
- **THEN** `messageTemplate` SHALL NOT be present in the output

### Requirement: Child and Context Loggers

The system SHALL support creating derived loggers with additional default context.

#### Scenario: withContext

- **GIVEN** `const sessionLogger = logger.withContext({ sessionId: "abc" })`
- **WHEN** `sessionLogger.info("Processing")` is called
- **THEN** the log entry SHALL include `sessionId: "abc"` in context
- **AND** call-site context SHALL take precedence over default context

#### Scenario: Child Logger

- **GIVEN** `const child = logger.child("SubModule")`
- **WHEN** `child.info("test")` is called
- **THEN** the module SHALL be `"ParentModule:SubModule"`

### Requirement: GELF Transport

The system SHALL support sending log entries to a GELF-compatible server via HTTP, TCP, or UDP when `logging.gelf.enabled` is `true`.

#### Scenario: HTTP Transport

- **GIVEN** `logging.gelf.enabled` is `true` and `logging.gelf.endpoint` is set
- **WHEN** a log entry is emitted
- **THEN** the entry SHALL be converted to GELF 1.1 format and sent via HTTP POST
- **AND** sending SHALL be fire-and-forget (errors logged to stderr, never thrown)

#### Scenario: GELF Message Format

- **GIVEN** a `LogEntry` with level "ERROR" and module "AgentCore"
- **WHEN** converted to GELF format
- **THEN** the GELF message SHALL contain: `version: "1.1"`, `host` (configurable, default "air-friends"), `short_message` (rendered message), `timestamp` (unix epoch seconds), `level` (syslog severity: FATAL→2, ERROR→3, WARN→4, INFO→6, DEBUG→7), `_module`, `_log_level`

#### Scenario: Message Template in GELF

- **GIVEN** a log entry has a `messageTemplate`
- **WHEN** converted to GELF
- **THEN** it SHALL be sent as `_messageTemplate` custom field

#### Scenario: Context Fields in GELF

- **GIVEN** a log entry has context with key `userId`
- **WHEN** converted to GELF
- **THEN** it SHALL appear as `_userId` (prefixed with underscore)
- **AND** `null` or `undefined` values SHALL be skipped
- **AND** keys named `id` SHALL be skipped
- **AND** keys not matching `/^[\w.\-]*$/` SHALL be skipped
- **AND** boolean values SHALL be converted to strings
- **AND** object values SHALL be serialized with `JSON.stringify()`

#### Scenario: TCP Transport

- **GIVEN** `logging.gelf.protocol` is `"tcp"`
- **WHEN** a log entry is sent
- **THEN** the GELF message SHALL be JSON-encoded with a null byte terminator
- **AND** a persistent TCP connection SHALL be maintained with lazy reconnect on failure

#### Scenario: UDP Transport with Chunking

- **GIVEN** `logging.gelf.protocol` is `"udp"` and a message exceeds 8192 bytes
- **WHEN** the message is sent
- **THEN** it SHALL be split into chunks per the GELF chunking spec (magic bytes 0x1e 0x0f, 8-byte message ID, sequence number, sequence count)
- **AND** GZIP compression SHALL be enabled by default for UDP

#### Scenario: GELF Initialization

- **GIVEN** `logging.gelf.enabled` is `true` and `logging.gelf.endpoint` is set in config
- **WHEN** bootstrap runs
- **THEN** a `GelfTransport` instance SHALL be created and injected into the global logger config via `configureLogger`

### Requirement: Error Class Hierarchy

The system SHALL use a unified error class hierarchy extending `BaseError` with domain-specific error codes.

#### Scenario: Error Code Ranges

- **GIVEN** the `ErrorCode` enum
- **WHEN** error codes are defined
- **THEN** they SHALL follow these ranges: Configuration (1xxx: 1001-1003), Platform (2xxx: 2001-2004), Agent (3xxx: 3001-3003), Memory (4xxx: 4001-4003), Skill (5xxx: 5001-5003), Workspace (6xxx: 6001-6003)

#### Scenario: Error Classes

- **GIVEN** a domain error occurs
- **WHEN** the error is constructed
- **THEN** it SHALL use the corresponding class: `ConfigError`, `PlatformError`, `AgentError`, `MemoryError`, `SkillError`, or `WorkspaceError`
- **AND** each error SHALL have: `code` (ErrorCode), `message` (string), `timestamp` (ISO 8601), `context` (optional Record), `isRetryable` (boolean)

#### Scenario: Retryable Errors

- **GIVEN** an error is thrown
- **WHEN** `isRetryable` is checked
- **THEN** `PLATFORM_CONNECTION_FAILED` and `PLATFORM_RATE_LIMITED` SHALL be retryable
- **AND** `AGENT_TIMEOUT` SHALL be retryable
- **AND** all `ConfigError`, `MemoryError`, `SkillError`, and `WorkspaceError` instances SHALL NOT be retryable

#### Scenario: Error Serialization

- **GIVEN** a `BaseError` instance
- **WHEN** `toJSON()` is called
- **THEN** it SHALL return an object with: `name`, `code`, `message`, `timestamp`, `context`, `isRetryable`

### Requirement: Session Error Isolation

Single session errors SHALL NOT crash the entire bot.

#### Scenario: Session Failure Containment

- **GIVEN** an agent session throws an error during execution
- **WHEN** the error is caught by the session orchestrator
- **THEN** the error SHALL be logged with full stack trace
- **AND** the bot SHALL continue processing other interaction events
- **AND** the process SHALL NOT terminate

#### Scenario: Safe Execute Helper

- **GIVEN** `safeExecute(operation, { module, action })` is called
- **WHEN** the operation throws an error
- **THEN** the error SHALL be logged via the module's logger
- **AND** `null` SHALL be returned instead of propagating the error

### Requirement: Connection Manager with Exponential Backoff

The system SHALL implement automatic reconnection with exponential backoff for platform connections.

#### Scenario: Backoff Calculation

- **GIVEN** a connection attempt fails
- **WHEN** the retry delay is calculated for attempt N
- **THEN** the delay SHALL be `baseDelay * (backoffMultiplier ^ N)` with ±10% jitter, clamped to `maxDelay`
- **AND** defaults SHALL be: `baseDelay=1000ms`, `maxDelay=60000ms`, `backoffMultiplier=2`, `maxAttempts=0` (infinite)

#### Scenario: Max Attempts Exceeded

- **GIVEN** `maxAttempts` is set to a positive number
- **WHEN** that many consecutive connection attempts fail
- **THEN** a FATAL log SHALL be emitted
- **AND** an error SHALL be thrown

#### Scenario: Connection Monitoring

- **GIVEN** a connection is established
- **WHEN** the connection status transitions to `DISCONNECTED` or `ERROR`
- **THEN** the connection manager SHALL automatically attempt reconnection via `connectWithRetry`

#### Scenario: Graceful Disconnect

- **GIVEN** `disconnect()` is called
- **WHEN** the shutdown flag is set
- **THEN** pending retry timeouts SHALL be cancelled
- **AND** the adapter's `disconnect()` SHALL be called

### Requirement: Health Check Server

The system SHALL provide HTTP health check endpoints when `health.enabled` is `true`.

#### Scenario: Health Endpoint

- **GIVEN** the health check server is running on port `health.port`
- **WHEN** `GET /health` or `GET /healthz` is requested
- **THEN** the response SHALL be JSON with: `status` ("healthy"|"degraded"|"unhealthy"), `timestamp`, `uptime`, and `checks` array
- **AND** HTTP 200 SHALL be returned for "healthy" or "degraded"
- **AND** HTTP 503 SHALL be returned for "unhealthy"

#### Scenario: Readiness Endpoint

- **GIVEN** the health check server is running
- **WHEN** `GET /ready` or `GET /readyz` is requested
- **THEN** the response SHALL check: platform connections, skill script existence, required binaries (rg, deno, git), Skill API connectivity (when `skillApi.enabled`), and workspace directory writability
- **AND** HTTP 200 SHALL be returned only when all checks pass
- **AND** readiness results SHALL be cached for 30 seconds to avoid excessive subprocess spawning

#### Scenario: Prometheus Metrics Endpoint

- **GIVEN** `metrics.enabled` is `true`
- **WHEN** `GET {metrics.path}` (default "/metrics") is requested
- **THEN** the response SHALL return Prometheus exposition format text
- **AND** the metrics endpoint SHALL share the same port as health check

#### Scenario: Platform Health Checks

- **GIVEN** a platform adapter reports connection state
- **WHEN** health is checked
- **THEN** "connected" state SHALL map to "pass", "reconnecting" to "warn", and other states to "fail"

### Requirement: Global Error Handler

The system SHALL install global handlers for unhandled errors and graceful shutdown signals.

#### Scenario: Unhandled Promise Rejection

- **GIVEN** `setupGlobalErrorHandler` has been called
- **WHEN** an unhandled promise rejection occurs
- **THEN** the event SHALL be prevented from default handling
- **AND** the error SHALL be logged at ERROR level with stack trace
- **AND** `BaseError` instances SHALL use `toJSON()` for structured logging

#### Scenario: Uncaught Error

- **GIVEN** `setupGlobalErrorHandler` has been called
- **WHEN** an uncaught error occurs
- **THEN** the error SHALL be logged at FATAL level with filename, line number, column number, and stack trace
- **AND** the optional `onFatalError` callback SHALL be invoked

#### Scenario: SIGTERM Graceful Shutdown

- **GIVEN** `enableGracefulShutdown` is `true`
- **WHEN** `SIGTERM` or `SIGINT` is received
- **THEN** the handler SHALL dispatch a `"shutdown"` CustomEvent on `globalThis`
- **AND** duplicate signals SHALL be ignored (idempotent shutdown)
- **AND** `isGracefulShutdownInProgress()` SHALL return `true` after the first signal
