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

Every `process*` method SHALL resolve with a `SessionResponse` object on all completion paths, and SHALL NOT let post-session bookkeeping (the `finally` block) throw in place of that response.

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

#### Scenario: All completion paths resolve with SessionResponse
- **GIVEN** a session ends via success, no-reply, queue-deadline cancellation, lurk-trigger skip, or idle-timeout session loss
- **WHEN** the corresponding `process*` method completes
- **THEN** it SHALL resolve with a `SessionResponse` object on every one of those paths

#### Scenario: Metrics reflect the response actually returned
- **GIVEN** a `process*` method has computed its `SessionResponse`
- **WHEN** post-session metrics are recorded in the `finally` block
- **THEN** they SHALL be recorded with the `success` value of the response ACTUALLY returned

#### Scenario: Bookkeeping failure is swallowed
- **GIVEN** the `finally` block bookkeeping throws unexpectedly
- **WHEN** a `process*` method completes
- **THEN** the failure SHALL be logged and swallowed, never propagated to the caller, and never replace a computed response

### Requirement: Idle Workspace Disposable Temporary Reclamation

The system SHALL reclaim disposable entries inside recognized workspace temporary directories at startup and after the last live temporary-use owner finishes. It SHALL preserve native engine state and persistent workspace data. Cleanup SHALL NOT rely solely on Skill API registry expiry or file age as evidence that a workspace is idle.

#### Scenario: Startup removes crash leftovers
- **GIVEN** a supported single-instance startup with the previous process tree stopped and a workspace containing orphan payload, browser and attachment temporary files
- **WHEN** startup cleanup runs before session-producing ingress is exposed
- **THEN** eligible disposable entries within the traversal budget SHALL be removed even if that workspace receives no new message
- **AND** the workspace's memory files and temporary directory root SHALL remain

#### Scenario: Same-user reuse does not imply leakage
- **GIVEN** two conversations use the same user's workspace and one session is still using its temporary files
- **WHEN** the other session finishes
- **THEN** cleanup SHALL skip that workspace while any temporary-use owner remains
- **AND** it SHALL NOT infer orphan status from a different conversation or Skill API session ID

#### Scenario: Producer ownership precedes registration
- **WHEN** workspace creation or session setup is suspended before Skill API registration
- **THEN** another completion path SHALL see the workspace as busy and SHALL NOT delete its temporary files
- **AND** setup failure SHALL release its temporary-use ownership exactly once

#### Scenario: Authentication expiry does not end filesystem use
- **GIVEN** an agent still uses a workspace after its Skill API registry entry is evicted
- **WHEN** another session's cleanup runs
- **THEN** live temporary-use ownership SHALL prevent deletion until the producer and its tool children have completed teardown

#### Scenario: Per-spawn background children retain files
- **GIVEN** a per-spawn agent has a background tool child still using workspace temporary files
- **WHEN** the owning session finishes
- **THEN** cleanup SHALL wait for bounded child drain or confirmed termination before releasing its cleanup protection
- **AND** a missing observation or surviving child SHALL retain an unreclaimable marker even if best-effort wrapper disconnect returns

#### Scenario: Pooled completion waits for child release
- **GIVEN** a pooled runner finishes while a tool child still uses a staged payload
- **WHEN** the pool begins its existing child drain and pointer/JWT release
- **THEN** temporary-use ownership SHALL remain live through that release and the caller-visible completed run SHALL settle only afterward
- **AND** the staged file SHALL remain available to the child until its drain or termination completes
- **AND** existing ACP result/deadline classification and queue serialization SHALL be preserved

#### Scenario: Normal and abnormal session endings use one policy
- **WHEN** a message/lurk, spontaneous, research/correction, maintenance, channel-maintenance or reminder session ends through success, dry-run, setup failure, cancellation, queue expiry or agent failure
- **THEN** its temporary-use ownership SHALL be released exactly once after any started producer teardown
- **AND** the final idle cleanup SHALL apply the same state-preserving entry policy without changing the computed session response

### Requirement: Native State Survives Disposable Cleanup

Workspace temporary cleanup SHALL preserve existing OMP and OpenCode native state subtrees in every mode, including resumable state beneath per-spawn temporary roots. It SHALL NOT traverse pooled engine roots, shared native runtime payloads or persistent memory/shared-agent workspaces.

#### Scenario: Both engines and modes are preserved
- **GIVEN** a workspace contains `tmp/omp-agent/restricted`, `tmp/omp-agent/native-yolo` and `tmp/opencode-data` alongside disposable files
- **WHEN** startup or idle teardown cleanup runs for either selected engine
- **THEN** those state trees and their files SHALL retain their paths, identities and bytes
- **AND** eligible disposable siblings SHALL be removed

#### Scenario: Shared runtime and pooled state stay outside cleanup
- **GIVEN** native state contains a link to the prepared shared runtime and separate pool/channel temporary roots exist outside user workspaces
- **WHEN** workspace cleanup runs
- **THEN** it SHALL NOT enumerate the reserved native subtree or follow its runtime link
- **AND** shared payload, pooled sessions/databases, channel process state and memory files SHALL remain unchanged

#### Scenario: Reserved names are conservative
- **WHEN** a reserved direct-child native-state name contains an unexpected object or a symlink
- **THEN** cleanup SHALL preserve that entry without inspecting its descendants or following it
- **AND** the currently selected engine SHALL NOT change that decision

### Requirement: Bounded Conservative Workspace Cleanup

Cleanup SHALL visit only the configured recognized workspace layout and SHALL limit disposable traversal per workspace. Unsafe ancestry, filesystem uncertainty or exhausted traversal limits SHALL retain affected data and produce a bounded diagnostic rather than authorize broader deletion or fail a completed session/startup.

#### Scenario: Recognized layout only
- **GIVEN** user, internal/synthetic and channel workspaces plus unrelated nested directories named `tmp`
- **WHEN** startup cleanup enumerates candidates
- **THEN** it SHALL visit only actual temporary children of recognized user/channel workspace shapes
- **AND** the channel container, unrelated nested directories, repository root and shared agent workspace SHALL NOT be deletion candidates

#### Scenario: Dashboard protection depends on startup ordering
- **GIVEN** dashboard chat uses its dedicated workspace without orchestrator temporary-use ownership
- **WHEN** dashboard ingress starts or an unrelated orchestrator session tears down
- **THEN** startup-wide reclamation SHALL already be finished and runtime teardown SHALL visit only the finishing orchestrator session's workspace
- **AND** active dashboard temporary data SHALL NOT be swept by unrelated session cleanup

#### Scenario: Links cannot redirect traversal
- **WHEN** a platform/workspace/tmp component is a link or is no longer an ordinary directory, or a disposable child is a symlink to outside data
- **THEN** cleanup SHALL skip unsafe ancestry and SHALL never descend through the disposable symlink
- **AND** unlinking a disposable symlink SHALL leave its target and outside sentinel bytes unchanged

#### Scenario: Traversal budget retains remaining work
- **GIVEN** disposable contents exceed the per-workspace node or depth budget
- **WHEN** one cleanup invocation reaches its bound
- **THEN** reaching the node budget SHALL stop that workspace's traversal and retain unvisited data
- **AND** a depth violation SHALL retain that subtree as intentionally ineligible and SHALL continue with the remaining candidates, so an over-deep branch cannot starve its shallow siblings
- **AND** a later normal teardown or startup pass SHALL be able to reclaim remaining eligible entries without a new periodic scheduler

#### Scenario: Missing entries and partial IO failures
- **WHEN** a workspace/tmp entry is absent, disappears, has a permission error or contains an unexpected special node
- **THEN** cleanup SHALL treat absence as harmless and retain unsafe/failed entries with diagnostics
- **AND** it SHALL continue other eligible candidates within budget without replacing the session response or preventing application startup

#### Scenario: Uncertain teardown is never declared idle
- **WHEN** producer teardown cannot confirm that its workspace use ended
- **THEN** the running bot SHALL retain that workspace's cleanup protection and report the skipped cleanup
- **AND** cleanup SHALL NOT delete data merely because the registry entry or authentication token is absent

### Requirement: Durable agent-start fence

An email work item SHALL durably record started before the agent or delivery can act, and SHALL not be replayed automatically after an uncertain started outcome.

#### Scenario: Queue crash

- **WHEN** the process dies with accepted work waiting for the execution lease
- **THEN** restart resumes that unstarted work without treating merely emitted events as completed

### Requirement: Explicit receive completion

Email processing completion SHALL depend on explicit lifecycle and side-effect receipts rather than swallowed event-handler errors.

#### Scenario: Handler throws

- **WHEN** downstream event handling fails after work starts
- **THEN** journal records review-required and later polls do not replay it
