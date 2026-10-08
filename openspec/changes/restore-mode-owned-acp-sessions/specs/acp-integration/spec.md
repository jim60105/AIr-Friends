# Delta: acp-integration

## ADDED Requirements

### Requirement: Connector Recovery Ownership Verification Before Teardown

For an agent type whose sessions carry ownership provenance, the connector SHALL verify the recovery context's recorded permission mode and namespace against its own recovery target (the mode-scoped namespace its spawn configuration carries) as the FIRST action, before disconnecting, respawning, or issuing `session/load`; a mismatch or missing provenance SHALL raise a distinct ownership-violation error and perform no disconnect, spawn, load, or gate-context mutation.

#### Scenario: Verification precedes any teardown or load
- **GIVEN** a recovery call supplying a recorded mode and namespace that match the connector's recovery target
- **WHEN** reconnect-and-resume runs
- **THEN** the ownership verification SHALL complete before the connection is disconnected, and the same-mode respawn and `session/load` SHALL then proceed

#### Scenario: Ownership violation produces zero connector side effects
- **GIVEN** a recovery call whose supplied ownership context does not match the connector's recovery target (opposite mode or different namespace)
- **WHEN** reconnect-and-resume is invoked
- **THEN** it SHALL reject with a distinct ownership-violation error
- **AND** no disconnect, process spawn, `session/load`, or gate-context mutation SHALL occur

#### Scenario: Missing provenance for a provenance-required agent fails closed
- **GIVEN** a recovery call for a session of an agent type that requires ownership provenance, with no recovery context or an incomplete one supplied
- **WHEN** reconnect-and-resume is invoked
- **THEN** it SHALL fail closed as an ownership violation rather than proceeding with today's unverified recovery

#### Scenario: Recovery context is consumed read-only
- **GIVEN** a completed same-mode recovery that read the session's recorded mode and process/state namespace
- **WHEN** the session continues or ends afterward
- **THEN** the recovery path SHALL NOT have written, mutated, or re-interpreted those recorded ownership fields

#### Scenario: Callers without recovery context keep existing behavior
- **GIVEN** a caller invoking reconnect-and-resume with only the pre-existing arguments (session, cwd, MCP servers) for an agent type without mode-split ownership
- **WHEN** the call runs
- **THEN** the operation SHALL behave exactly as before this change, including the capability-absence false return

#### Scenario: Recovery context is consumed as additive optional trailing options
- **GIVEN** a caller supplying a recovery context with the session's recorded mode, process/state namespace, and deployment agent type (read from the session-ownership record), the session's full gate context, and its optional resolved reasoning effort
- **WHEN** reconnect-and-resume is invoked
- **THEN** the context SHALL be consumed as additive, optional additions to the operation's existing trailing-options shape

#### Scenario: Ownership-violation error names the session and mismatch
- **GIVEN** a recovery whose supplied ownership context mismatches the connector's recovery target in either direction
- **WHEN** the verification rejects the recovery
- **THEN** the distinct ownership-violation error SHALL name the session and the mismatched mode and namespace, with bounded detail

#### Scenario: Recorded permission mode is never re-resolved
- **GIVEN** a recovery supplying a recorded permission mode
- **WHEN** the connector runs the recovery
- **THEN** it SHALL NOT re-resolve the permission mode from any other source

#### Scenario: Post-load configuration restoration reuses the shared logic
- **GIVEN** a successful same-mode load with a caller-supplied resolved reasoning value
- **WHEN** configuration restoration runs after the load
- **THEN** it SHALL reuse the shared model-configuration logic — load-cache restoration, stable-first model reapplication, best-effort reasoning from the supplied value
- **AND** it SHALL NOT reimplement the matching rules

#### Scenario: Fixed per-session mode-switch identity matches by construction
- **GIVEN** an agent type whose recovery provenance is a fixed per-session mode-switch identity
- **WHEN** the ownership verification runs
- **THEN** it SHALL match by construction
- **AND** the agent type's existing recovery behavior SHALL remain unchanged

### Requirement: Gate-Context Restoration And Readiness Seam In Connector Recovery

After a successful same-mode `session/load`, the connector SHALL re-register the recovered session id's OWN complete per-session gate context (cwd, owning skill session id, per-session permission flags), supplied by the caller and consistent with the recovery cwd, before reporting recovery success, and SHALL NOT substitute another session's cached gate context or the process-frozen client configuration when the session's own context cannot be established.

#### Scenario: Full gate context restored on a fresh client for the recovered id
- **GIVEN** a recovery on a connector whose gate-context cache is empty (freshly respawned client) with the caller supplying the recovered session's complete gate context
- **WHEN** `session/load` succeeds and restoration completes
- **THEN** the recovered session id's permission gate and filesystem callbacks SHALL resolve to that session's own cwd, owning skill session id, and per-session flags before the method reports success

#### Scenario: No fallback context for an unknown session
- **GIVEN** a recovery for a session id with no cached gate context and no caller-supplied context, while other sessions' contexts exist in the cache
- **WHEN** restoration is attempted
- **THEN** that session's recovery SHALL fail as a gate-context restore failure
- **AND** none of the other sessions' contexts SHALL be bound to or substituted for the recovered session id

#### Scenario: Supplied context must agree with the recovery cwd
- **GIVEN** a recovery whose supplied gate context names a cwd different from the recovery cwd passed to `session/load`
- **WHEN** restoration is attempted
- **THEN** it SHALL fail closed as a gate-context restore failure for that session rather than silently overwriting either value

#### Scenario: Readiness seam is a positioned no-op attach point
- **GIVEN** a successful same-mode recovery with no post-restore hook supplied
- **WHEN** recovery completes
- **THEN** resumption SHALL proceed without any readiness assertion
- **AND** WHEN a stub hook is supplied it SHALL be invoked exactly once, after gate-context restoration and before success is reported
- **AND** a rejecting hook SHALL fail only that session's recovery

#### Scenario: Post-load model or reasoning restoration failure stays isolated
- **GIVEN** a same-mode load whose restored catalog no longer contains the session's previously set model
- **WHEN** the shared stable-first logic reports the catalog miss
- **THEN** the error SHALL propagate to the affected session's existing failure handling without an unstable second chance, and other sessions SHALL be unaffected

#### Scenario: Configuration restored through the shared model-configuration logic
- **GIVEN** a successful same-mode recovery whose caller supplied a resolved reasoning value
- **WHEN** the connector restores configuration after `session/load`
- **THEN** it SHALL restore through the shared model-configuration logic in the canonical order — config-options cache restoration, then model reapplication, then best-effort reasoning reapplication from the supplied value

#### Scenario: Other sessions' cached gate contexts replay unchanged
- **GIVEN** a recovery on a connector whose gate-context cache holds other sessions' contexts to replay to a fresh client
- **WHEN** the recovered session's own context is restored
- **THEN** the other sessions' cached gate contexts SHALL continue to be replayed to the fresh client
- **AND** they SHALL NOT be modified by the recovery

### Requirement: Recovery Context Threading And Failure Classification In Session Runs

The session runners' reconnect call sites SHALL build the recovery context from the session's OWN recorded values — the ownership record's permission mode and process/state namespace read read-only from the in-bot session registry, the session's own gate-context fields, its resolved reasoning effort, its own workspace cwd, and the operator MCP definitions — and pass it to the connector's reconnect-and-resume operation.

#### Scenario: Recorded acquisition values reach the connector
- **GIVEN** a pooled OMP session whose ownership record names mode `native-yolo` and that mode's state namespace, running with a resolved reasoning effort
- **WHEN** its prompt dies mid-flight and the call site invokes reconnect-and-resume
- **THEN** the recovery context SHALL carry exactly the recorded mode and namespace, the session's full gate context and own cwd, the operator MCP definitions, and the resolved reasoning effort — none re-resolved or inferred

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
