# Spec Delta

## MODIFIED Requirements

### Requirement: Recovery Context Threading And Failure Classification In Session Runs

Every existing reconnect-capable OMP runner SHALL pass its acquisition-recorded permission mode and process namespace read-only from the session registry, its complete owning gate context, resolved effort, own cwd and operator MCP definitions to recovery. This SHALL cover pooled and per-spawn paths, including correction retries, without re-resolving ownership or expanding the existing recovery triggers.

#### Scenario: Recorded acquisition values reach the connector
- **GIVEN** a pooled OMP session whose ownership record names mode `native-yolo` and that mode's state namespace, running with a resolved reasoning effort
- **WHEN** its prompt dies mid-flight through an existing qualifying recovery path and the call site invokes reconnect-and-resume
- **THEN** the recovery context SHALL carry exactly the recorded mode and namespace, the session's full gate context and own cwd, the operator MCP definitions, and the resolved reasoning effort, none re-resolved or inferred

#### Scenario: Ownership violation ends only the affected session run
- **GIVEN** a reconnect attempt that fails with an ownership violation while a sibling session runs on the same process
- **WHEN** the call site handles the failure
- **THEN** the affected session SHALL end in error with a bounded ownership-violation reason
- **AND** no prompt SHALL be re-issued for it, no process SHALL be disconnected by the recovery path, and the sibling session SHALL continue unaffected under the unchanged lease

#### Scenario: Fence semantics untouched by recovery outcomes
- **GIVEN** a recovery attempt reaching the connector from the controlled-recovery path with the session's recovery fence raised
- **WHEN** the recovery succeeds, fails as an ownership violation, or fails as a restore failure
- **THEN** the fence raise/settle/decision ordering around the recovery SHALL be exactly the pre-existing controlled-recovery ordering, with the ownership check inserted strictly before the connector's own teardown

#### Scenario: Restore failure ends the affected session as loss
- **GIVEN** a reconnect attempt that fails with a gate-context restore failure rather than an ownership violation
- **WHEN** the call site handles the failure
- **THEN** the affected session SHALL end in error classified as loss of that session, with the same bounded classification as an ownership violation

#### Scenario: Session loss is logged, audited, and kept out of re-prompt
- **GIVEN** a session lost because the connector returned or threw an ownership violation or gate-context restore failure
- **WHEN** the call site classifies the loss
- **THEN** it SHALL log and audit a bounded machine-readable failure reason distinct from capability-absence session loss and surface it through the session's existing error handling
- **AND** the lost session SHALL never continue into the respond-gated re-prompt path or disconnect a process it did not own

#### Scenario: Every per-spawn owning caller carries recorded context
- **WHEN** message/lurk reply, spontaneous, self research, user maintenance, channel maintenance or reminder enters its existing qualifying per-spawn reconnect path
- **THEN** each SHALL supply its own recorded acquisition ownership, full gate, cwd/MCP definitions and resolved effort
- **AND** neither another session's cache nor current configuration SHALL replace its acquisition values

#### Scenario: Research correction preserves the initial session values
- **WHEN** the existing self-research correction retry enters reconnect
- **THEN** it SHALL supply exactly the initial research session's acquisition context and resolved effort
- **AND** no fresh inferred ownership or gate SHALL be used

#### Scenario: Nonqualifying per-spawn crashes remain fail-fast
- **WHEN** a per-spawn crash does not match the existing idle-liveness recovery trigger
- **THEN** its existing fail-fast behavior SHALL remain unchanged
- **AND** this change SHALL NOT add a new retry or session-load capability

## ADDED Requirements

### Requirement: OMP Recovery Cannot Select a Context-Free Legacy Path

OMP recovery SHALL require recorded ownership and its complete owning gate context based on deployment agent type, independent of whether optional arguments were supplied. Ownership verification SHALL be the first action; absent or mismatched provenance SHALL fail before teardown or load. Missing or cwd-inconsistent required gate context SHALL also fail before teardown. OpenCode's existing context-free recovery SHALL remain unchanged.

#### Scenario: OMP recovery invoked without options
- **WHEN** reconnect-and-resume is called for OMP without recorded ownership options
- **THEN** it SHALL raise the bounded ownership-violation failure
- **AND** it SHALL perform no disconnect, spawn, load or gate-context mutation

#### Scenario: OMP recovery supplies only partial context
- **WHEN** an OMP call lacks mode or namespace, or supplies ownership that mismatches its connector target
- **THEN** ownership verification SHALL reject before settings preflight, teardown or load
- **AND** it SHALL NOT use a cwd-only legacy fallback

#### Scenario: OMP owning gate absent or inconsistent
- **GIVEN** matching recorded OMP ownership
- **WHEN** its required own gate is missing, incomplete or inconsistent with the recovery cwd or owning skill session
- **THEN** the operation SHALL fail as gate-context restore failure before teardown
- **AND** a sibling or process-frozen gate SHALL NOT be substituted

#### Scenario: Restore order before resumption
- **WHEN** a fully contextual same-mode OMP load succeeds
- **THEN** config cache, prior model, caller-resolved best-effort effort and complete own gate SHALL restore in that order before the optional post-restore hook and success
- **AND** hook absence SHALL remain a no-op without a readiness assertion

#### Scenario: Sibling gate replay does not change ownership
- **WHEN** cached sibling gate contexts replay to a fresh client during recovery
- **THEN** they SHALL remain unchanged and SHALL NOT substitute for the recovered id's own context
- **AND** an affected session's failure SHALL NOT resume it or modify a sibling's recorded acquisition

#### Scenario: OpenCode keeps its legacy optional-options behavior
- **WHEN** an OpenCode caller invokes its existing reconnect path without additional context
- **THEN** its existing recovery, capability-absence return and fixed-mode behavior SHALL remain unchanged
- **AND** no new OMP mode or native-YOLO restriction SHALL be consulted
