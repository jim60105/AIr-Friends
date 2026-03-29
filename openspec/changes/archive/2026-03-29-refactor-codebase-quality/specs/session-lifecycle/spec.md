## ADDED Requirements

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
