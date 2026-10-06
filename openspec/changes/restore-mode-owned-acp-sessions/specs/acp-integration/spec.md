# Delta: acp-integration

## ADDED Requirements

### Requirement: Connector Recovery Ownership Verification Before Teardown

The connector's reconnect-and-resume operation SHALL consume a caller-supplied recovery context — the session's recorded original permission mode, process/state namespace, and deployment agent type (read-only from the session-ownership record), the recovered session's full gate context, and the session's optional resolved reasoning effort — as additive, optional additions to its existing trailing-options shape, so callers that pass nothing keep the current behavior unchanged. For an agent type whose sessions carry ownership provenance, the connector SHALL verify the recorded mode and namespace against its own recovery target (the mode-scoped process/state namespace its spawn configuration carries) as the FIRST action, BEFORE disconnecting, respawning, or issuing `session/load`. A mismatch in either direction, or a session lacking the provenance such that same-mode recovery cannot be established, SHALL raise a distinct ownership-violation error naming the session and the mismatched mode/namespace with bounded detail, and SHALL perform no disconnect, no spawn, no `session/load`, and no gate-context mutation. The connector SHALL NOT re-resolve the permission mode, and any configuration restoration after a successful load SHALL reuse the shared model-configuration logic (load-cache restoration, stable-first model reapplication, best-effort reasoning from the supplied value) without reimplementing matching rules. An agent type whose recovery provenance is a fixed per-session mode-switch identity SHALL match by construction, keeping its existing recovery behavior unchanged.

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

### Requirement: Gate-Context Restoration And Readiness Seam In Connector Recovery

After a successful same-mode `session/load`, the connector SHALL restore configuration through the shared model-configuration logic (canonical config-options cache restoration, then model reapplication, then best-effort reasoning reapplication from the caller-supplied resolved value), and SHALL re-register the recovered session id's OWN complete per-session gate context (cwd, owning skill session id, per-session permission flags) — supplied by the caller and consistent with the recovery cwd — before reporting recovery success. The connector SHALL NOT substitute another session's cached gate context or the process-frozen client configuration for a recovered session whose own context cannot be established (no supplied context and no cached entry, or a disagreement between the supplied context's cwd and the recovery cwd); that is a gate-context restore failure for that session alone. Other sessions' cached gate contexts SHALL continue to be replayed to a fresh client and SHALL NOT be modified by a recovery. The restoration sequence SHALL end by invoking an optional post-restore hook (called, if present, after gate-context restoration and before success is reported); this hook is the defined attach point for a later restricted-policy readiness verification, and its absence SHALL NOT block resumption while no readiness mechanism exists. A hook that rejects or throws fails ONLY the affected session's recovery.

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

### Requirement: Recovery Context Threading And Failure Classification In Session Runs

The session runners' reconnect call sites SHALL build the recovery context from the session's OWN recorded values — the ownership record's permission mode and process/state namespace read read-only from the in-bot session registry, the session's own gate-context fields, its resolved reasoning effort, its own workspace cwd, and the operator MCP definitions — and pass it to the connector's reconnect-and-resume operation. An ownership violation or gate-context restore failure returned/thrown by the connector SHALL be classified as loss of the affected session: logged and audited with a bounded machine-readable failure reason distinct from capability-absence session loss, surfaced through the session's existing error handling, and never allowed to continue into the respond-gated re-prompt path or to disconnect a process it did not own. The recovery-fence and in-flight side-effect ordering established before the recovery attempt SHALL remain unchanged in all recovery outcomes.

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
