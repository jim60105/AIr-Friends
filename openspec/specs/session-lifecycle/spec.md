# Session Lifecycle

## Purpose

Shared session lifecycle orchestration pattern that encapsulates the common 10-step session setup/teardown sequence used by all session types, eliminating duplication across `process*` methods in `SessionOrchestrator`.

## Requirements

### Requirement: Shared session lifecycle orchestration
The system SHALL provide a `runAgentSession()` method in `SessionOrchestrator` that encapsulates the common 10-step session setup/teardown pattern, accepting a callback for session-type-specific prompt building and agent interaction.

#### Scenario: Successful session lifecycle
- **WHEN** `runAgentSession()` is called with valid parameters and a `buildAndRunAgent` callback
- **THEN** the system SHALL execute in order: create workspace, register shell session, create audit writer, audit trigger_received, resolve model, audit session_start, invoke buildAndRunAgent callback, record metrics, clean up workspace tmp, and deregister the session

#### Scenario: Session lifecycle handles agent errors
- **WHEN** the `buildAndRunAgent` callback throws an error during execution
- **THEN** the system SHALL log the error, audit session_end with failure status, record failure metrics, clean up resources, and return `{ success: false }`

#### Scenario: Session lifecycle records metrics
- **WHEN** a session completes (success or failure)
- **THEN** the system SHALL decrement `activeSessionsGauge`, increment `sessionsTotal` with appropriate labels, observe `sessionDurationSeconds`, and store the completed session

### Requirement: Optional platform adapter in session context
The system SHALL accept `platformAdapter` as an optional parameter in session lifecycle, eliminating unsafe type casts for sessions that do not interact with a platform (e.g., memory maintenance, self-research).

#### Scenario: Session without platform adapter
- **WHEN** `runAgentSession()` is called without a `platformAdapter`
- **THEN** the system SHALL proceed normally without platform interaction, and the `platformAdapter` field SHALL be `undefined` (not a cast to `PlatformAdapter`)

#### Scenario: Session with platform adapter
- **WHEN** `runAgentSession()` is called with a valid `platformAdapter`
- **THEN** the adapter SHALL be available in the session context for reply dispatch and message fetching

### Requirement: Process methods delegate to shared lifecycle
Each `process*` method (`processMessageInternal`, `processSpontaneousPost`, `processSelfResearch`, `processMemoryMaintenance`, `processChannelMemoryMaintenance`, `processReminder`) SHALL delegate to `runAgentSession()`, providing only the session-type-specific logic via the `buildAndRunAgent` callback.

#### Scenario: processMessageInternal uses shared lifecycle
- **WHEN** a normal message triggers `processMessageInternal`
- **THEN** it SHALL call `runAgentSession()` with sessionType "message" and a callback that assembles message context and prompts the agent

#### Scenario: processSpontaneousPost uses shared lifecycle
- **WHEN** the spontaneous scheduler triggers `processSpontaneousPost`
- **THEN** it SHALL call `runAgentSession()` with sessionType "spontaneous" and a callback that assembles spontaneous context and prompts the agent

#### Scenario: processSelfResearch uses shared lifecycle without platform adapter
- **WHEN** the self-research scheduler triggers `processSelfResearch`
- **THEN** it SHALL call `runAgentSession()` with sessionType "selfResearch", no `platformAdapter`, and a callback that assembles research context

### Requirement: Session response finalization

Every `process*` method SHALL resolve with a `SessionResponse` object on ALL completion paths — success, no-reply, queue-deadline cancellation, lurk-trigger skip, and idle-timeout session loss — and SHALL NOT let post-session bookkeeping (the `finally` block that records session metrics) throw in place of that response. Post-session metrics SHALL be recorded with the `success` value of the response ACTUALLY returned; a bookkeeping failure SHALL be logged and swallowed, never propagated, and never replace a computed response.

#### Scenario: Pooled message session resolves cleanly
- **GIVEN** shared-process (pool) mode is active
- **WHEN** `processMessage()` completes a turn in which the agent sent a reply
- **THEN** it SHALL resolve with `{ success: true, replySent: true, ... }`
- **AND** the session metrics SHALL have been recorded with `success: true`
- **AND** no "Cannot read properties of undefined (reading 'success')" error SHALL surface to the platform event handler

#### Scenario: Early-return paths still record metrics accurately
- **GIVEN** a session run is cancelled by the queue deadline (or skips a stale lurk trigger, or loses its agent connection on idle-timeout reconnect)
- **WHEN** the corresponding early-return branch completes
- **THEN** the method SHALL resolve with that branch's exact `SessionResponse`
- **AND** session metrics SHALL be recorded once with the `success` value of THAT response

#### Scenario: Bookkeeping failure cannot replace the response
- **GIVEN** the metrics-recording step throws unexpectedly
- **WHEN** a `process*` method's `finally` runs
- **THEN** the error SHALL be logged
- **AND** the originally computed `SessionResponse` SHALL still be returned to the caller
