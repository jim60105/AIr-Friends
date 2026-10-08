## ADDED Requirements

### Requirement: Combined Mock-ACP Lifecycle Integration Suite

The combined mock-ACP lifecycle integration suite SHALL drive the real `AgentConnector`, `AgentProcessPool`, and `SessionOrchestrator` wiring through mock ACP subprocess and in-process connection fixtures, covering happy path, crash recovery, cross-mode rejection, registry-refresh re-admission, lease serialization, LSP posture, and OpenCode flows. Every scenario SHALL exercise at least two shipped components and SHALL NOT restate a predecessor single-component unit assertion.

#### Scenario: Crash recovery restores config and ownership in one flow
- **GIVEN** a restricted OMP session established through real pool acquisition with a recorded ownership context
- **WHEN** the mock subprocess dies mid-prompt and recovery reconnects and loads the session
- **THEN** recovery SHALL re-enter the same mode's pool entry, verify ownership, restore the config-options cache from the load response, and reapply the session's model through the shipped stable-first code path
- **AND** the re-issued prompt SHALL execute with the recovered session's own gate context

#### Scenario: Cross-mode load is rejected in both directions without collateral effects
- **GIVEN** a live native-YOLO-owned session and a restricted recovery context (and the mirror pairing)
- **WHEN** either context attempts to load the opposite-mode-owned session
- **THEN** recovery SHALL report the ownership violation before any teardown
- **AND** the opposite mode's live process, lease, and sibling sessions SHALL be unaffected

#### Scenario: Registry-refresh re-admission composes through the shipped decision modules
- **GIVEN** a restricted composition fixture whose live tool-metadata observation gains or replaces an operator MCP tool after startup
- **WHEN** the registry epoch advances
- **THEN** provenance SHALL be re-observed on the fresh epoch, and admission or denial SHALL be produced by the shipped decision modules through the shipped wiring
- **AND** a denied call SHALL surface the bounded fail-closed error shape with no stale-epoch grant honored

#### Scenario: Dual-mode coexistence still serializes on the global lease
- **GIVEN** a restricted and a native-YOLO OMP session concurrently live in one channel under separate mode-keyed pool entries
- **WHEN** both request execution
- **THEN** at most one session SHALL hold the execution lease at any instant across both entries

#### Scenario: OpenCode regression flows remain byte-identical
- **GIVEN** an OpenCode session driving initialize/new/prompt/cancel/load and pool reuse through the same harness
- **WHEN** pool keys, spawn environment, and command strings are captured
- **THEN** they SHALL byte-match the current shipped OpenCode values
- **AND** no readiness verification or OMP trusted extension SHALL be involved, and the baseline SHALL retain build+yolo per-agent explicit lsp denies after numbered rows 15 and 17

#### Scenario: Happy path completes through real pool wiring
- **GIVEN** mock ACP subprocess and scripted in-process connection fixtures for a restricted session
- **WHEN** the suite drives initialize, new, prompt, cancel, and load through the combined harness
- **THEN** each step SHALL complete through the real `AgentConnector`, `AgentProcessPool`, and `SessionOrchestrator` wiring
- **AND** the scenario SHALL exercise at least two shipped components together

#### Scenario: LSP disablement posture survives crash-respawn and same-mode load
- **GIVEN** an OMP session in either restricted or native-YOLO mode with its selected LSP disable carrier
- **WHEN** the mock subprocess crashes, respawns, or the session is re-loaded in the same mode
- **THEN** the selected mode's LSP disable carrier SHALL be preserved across crash-respawn and same-mode load
- **AND** native-YOLO SHALL carry its LSP disable without loading restricted tool policy, and no fixture SHALL certify implicit startup suppression

### Requirement: Fail-Closed Honest Posture Assertions in the Lifecycle Suite

Every unresolved inherited seam exercised by the combined lifecycle suite SHALL be asserted on its deny or blocked outcome, and every allow-path fixture SHALL be carried as a labeled synthetic positive verified by a runtime suite guard. No test name, comment, or assertion SHALL claim or imply that the native OMP binary invokes a handler, honors a denial, rejects a cross-mode load, emits readiness, or suppresses a language server.

#### Scenario: Absent-handler sessions retain the native approval and ACP client boundary
- **GIVEN** a restricted OMP session whose extension handler is not installed
- **WHEN** an unauthorized ACP-mediated operation is requested through the real client policy
- **THEN** the operation SHALL fail closed with the client policy's bounded denial and zero side effects
- **AND** the pinned non-YOLO native approval launch posture SHALL remain unchanged with no readiness handshake, fallback spawn or mode promotion

#### Scenario: Synthetic allow fixtures are registered and labeled
- **GIVEN** any scenario in which a restricted call or prompt is allowed
- **WHEN** the suite-level fixture ledger is inspected at runtime
- **THEN** the enabling fixture SHALL be present as a labeled synthetic positive
- **AND** no result SHALL be presented as evidence of native emission or enforcement

#### Scenario: Undecodable destructive intent fails closed end to end
- **GIVEN** a restricted composition fixture presenting an incomplete or undecodable destructive intent through the shipped wiring
- **WHEN** the handler decision is evaluated
- **THEN** the shared fail-closed verdict SHALL be returned
- **AND** no filesystem side effect or grant SHALL occur

#### Scenario: MCP admission basis appears at honest audit status
- **GIVEN** a restricted composition fixture exercising the MCP admission basis
- **WHEN** its admission basis is asserted by the lifecycle suite
- **THEN** the basis SHALL appear at its `needs-mechanism-audit` / `candidate-to-verify` status
- **AND** it SHALL not be presented as an allow-path claim

#### Scenario: Surviving lower-layer approval records never grant
- **GIVEN** lower-layer approval records surviving in a restricted flow
- **WHEN** the suite inspects them while asserting a deny or blocked outcome
- **THEN** surviving lower-layer approval records SHALL never produce a grant
- **AND** the denied or blocked outcome SHALL be the sole asserted result

#### Scenario: No test wording claims native OMP behavior
- **GIVEN** the combined suite's test names, comments, and assertions
- **WHEN** they are reviewed for posture honesty
- **THEN** none SHALL claim or imply that the native OMP binary invokes a handler, honors a denial, rejects a cross-mode load, emits readiness, or suppresses a language server

### Requirement: Shared OMP Mock Session Builder Contract

The suite SHALL extract a shared mock-session builder exposing scenario composition for permission mode, recorded ownership context, config-option catalog shape, handler availability (default absent with non-YOLO native approval and ACP client fallback), registry epoch with live tool-observation fixtures, and destructive-input shape, with every synthetic positive wrapped in a labeled carrier and no default allow path.

#### Scenario: Default composition is fail-closed
- **WHEN** the builder is invoked without an explicit synthetic installed-handler or trusted-provenance override
- **THEN** the composed fixture SHALL carry an absent handler and untrusted-default tool observations, with ACP client denials still fail-closed
- **AND** any scenario allowing execution SHALL have explicitly supplied a labeled synthetic positive

#### Scenario: Follow-up suite consumes the builder without modification
- **GIVEN** the follow-up per-spawn/pool skill-handoff regression imports the builder
- **WHEN** it composes pooled OMP sessions
- **THEN** it SHALL add any needed fields additively in its own change
- **AND** the existing builder behavior for lifecycle scenarios SHALL remain unchanged

#### Scenario: Composition surface covers every scenario dimension
- **GIVEN** a scenario composing a mock OMP session through the shared builder
- **WHEN** it configures permission mode, recorded ownership context, config-option catalog shape (flat, grouped, catalog-miss, absent), handler availability, registry epoch with live tool-observation fixtures, or destructive-input shape
- **THEN** the builder SHALL expose each dimension's scenario composition
- **AND** handler availability SHALL default to absent without any readiness assertion; client policy denials and untrusted handler observations SHALL fail closed

### Requirement: Lifecycle Suite Determinism and Execution Boundaries

The combined lifecycle suite SHALL be deterministic: timer-driven paths SHALL use the repository's fake-time pattern, subprocess interactions SHALL be bounded on explicit recorded RPCs or the connector's crash signal, and no new test SHALL rely on wall-clock sleeps or delay-based kill races. The suite SHALL require no network access, real agent, official `omp` executable, provider or paid credentials, or container/bwrap execution.

#### Scenario: No sleep-dependent new tests
- **WHEN** the new suite's tests are examined for timing behavior
- **THEN** every time-sensitive assertion SHALL be driven by fake-time advancement or an explicit scripted message or crash signal
- **AND** no new test SHALL contain a wall-clock sleep used to await state

#### Scenario: Integration task stays live-acceptance-free
- **GIVEN** the repository's integration test task executes the new suite
- **WHEN** the suite runs
- **THEN** only in-process fixtures and `deno`-launched mock subprocesses SHALL be spawned
- **AND** no `omp --version`, container build, bwrap invocation, or external provider request SHALL occur

#### Scenario: No live external dependencies
- **GIVEN** the repository's integration test task executes the combined suite
- **WHEN** the suite runs
- **THEN** it SHALL require no network access to external hosts, no real agent, and no official `omp` executable
- **AND** no provider or paid credential SHALL be used, and the suite SHALL run under the existing integration task and coverage gates without silently invoking live-agent acceptance

### Requirement: Non-Duplication and Justified Deletion Rule for the Lifecycle Suite

The combined suite SHALL NOT duplicate single-component unit assertions already shipped by predecessor rows' suites. A redundant unit case MAY be deleted only when the combined suite fully supersedes its observable outcome, and each deletion SHALL be individually justified in the commit message naming the superseding scenario. Absent a true redundancy, deleting nothing is a conforming outcome; the rule SHALL NOT be satisfied by weakening or modifying existing unit assertions.

#### Scenario: Deletion requires a named superseding scenario
- **WHEN** a predecessor unit test case is deleted alongside this suite
- **THEN** the deletion commit SHALL name the case and the combined scenario whose real-code flow asserts the same observable outcome
- **AND** no unit assertion SHALL be weakened, only removed under this rule or left intact

#### Scenario: Missing handler is an accepted residual risk
- **GIVEN** pinned runner.emit logs extension lifecycle-hook errors without failing startup
- **WHEN** an extension fails to load
- **THEN** the session may run without the restricted capability set and no client-observable readiness assertion SHALL be made
- **AND** native non-YOLO approval plus client ACP policy SHALL NOT be claimed equivalent to installed-handler default-deny or proof of native callback coverage
