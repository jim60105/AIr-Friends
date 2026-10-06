## ADDED Requirements

### Requirement: Combined Mock-ACP Lifecycle Integration Suite

The repository SHALL provide a combined deterministic mock-ACP lifecycle integration suite that drives the real `AgentConnector`, `AgentProcessPool`, and `SessionOrchestrator` wiring through mock ACP subprocess and scripted in-process connection fixtures, covering at minimum: the initialize/new/prompt/cancel/load happy path; a mock subprocess crash followed by same-mode reconnect and `session/load` with the canonical config-options cache restored from the load response and model/reasoning reapplied through the shipped stable-first logic; cross-mode session-load ownership rejection in both directions (restricted context against a native-YOLO-owned session and native-YOLO context against a restricted-owned session); correct-session gate-context restoration after crash with the re-issued prompt's filesystem authorization evaluated against the recovered session's own context; the restricted first-prompt deny-until-ready gate including the post-start operator-MCP registry-refresh sequence (epoch advance → readiness reset → live re-observation → admission or denial decided by the shipped decision modules); dual-mode pool coexistence with the single global execution lease; restricted LSP disablement posture preserved across crash-respawn and same-mode load with native-YOLO exemption; and OpenCode-only lifecycle regression flows with pool identity, spawn environment, and command strings byte-compared against the current shipped values where meaningful. Every scenario SHALL require at least two shipped components to interact; the suite SHALL NOT restate a single-component decision assertion already shipped by predecessor per-row unit suites.

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
- **THEN** readiness SHALL reset, provenance SHALL be re-observed on the fresh epoch, and admission or denial SHALL be produced by the shipped decision modules through the shipped wiring
- **AND** a denied call SHALL surface the bounded fail-closed error shape with no stale-epoch grant honored

#### Scenario: Dual-mode coexistence still serializes on the global lease
- **GIVEN** a restricted and a native-YOLO OMP session concurrently live in one channel under separate mode-keyed pool entries
- **WHEN** both request execution
- **THEN** at most one session SHALL hold the execution lease at any instant across both entries

#### Scenario: OpenCode regression flows remain byte-identical
- **GIVEN** an OpenCode session driving initialize/new/prompt/cancel/load and pool reuse through the same harness
- **WHEN** pool keys, spawn environment, and command strings are captured
- **THEN** they SHALL byte-match the current shipped OpenCode values
- **AND** no readiness verification, trusted extension, or restricted clamp SHALL be involved

### Requirement: Fail-Closed Honest Posture Assertions in the Lifecycle Suite

Every unresolved inherited seam exercised by the combined lifecycle suite SHALL be asserted on its deny or blocked outcome: the unimplemented readiness control channel SHALL resolve not-ready and deny the restricted first prompt; the MCP admission basis SHALL appear at its `needs-mechanism-audit` / `candidate-to-verify` status; surviving lower-layer approval records SHALL never produce a grant; and undecodable destructive intent SHALL yield the shipped shared fail-closed verdict with zero side effect. Every allow-path fixture (established readiness tuple, trusted tool provenance, admitted MCP tool) SHALL be carried as a labeled synthetic positive, and a suite-level guard SHALL verify at runtime that every exercised allow fixture is registered as synthetic. No test name, comment, or assertion in the suite SHALL claim or imply that the native OMP binary invokes a handler, honors a denial, rejects a cross-mode load, emits readiness, or suppresses a language server.

#### Scenario: Unresolved readiness denies the first prompt through the real orchestrator path
- **GIVEN** a restricted OMP session with the shipped unimplemented readiness channel
- **WHEN** its first normal prompt is requested through the orchestrator
- **THEN** the run SHALL end with the bounded readiness-rejection reason
- **AND** zero prompt RPCs SHALL be recorded and no fallback spawn or mode promotion SHALL occur

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

### Requirement: Shared OMP Mock Session Builder Contract

The suite SHALL extract a shared mock-session builder exposing scenario composition for permission mode, recorded ownership context, config-option catalog shape (flat, grouped, catalog-miss, absent), readiness state (defaulting to unresolved fail-closed), registry epoch with live tool-observation fixtures, and destructive-input shape, with every synthetic positive wrapped in a labeled carrier and no default allow path. The builder SHALL be importable unchanged by the follow-up mocked skill-handoff regression, which SHALL extend it additively rather than restructure it.

#### Scenario: Default composition is fail-closed
- **WHEN** the builder is invoked without an explicit readiness or trusted-provenance override
- **THEN** the composed fixture SHALL carry unresolved readiness and untrusted-default tool observations
- **AND** any scenario allowing execution SHALL have explicitly supplied a labeled synthetic positive

#### Scenario: Follow-up suite consumes the builder without modification
- **GIVEN** the follow-up per-spawn/pool skill-handoff regression imports the builder
- **WHEN** it composes pooled OMP sessions
- **THEN** it SHALL add any needed fields additively in its own change
- **AND** the existing builder behavior for lifecycle scenarios SHALL remain unchanged

### Requirement: Lifecycle Suite Determinism and Execution Boundaries

The combined lifecycle suite SHALL be deterministic: timer-driven paths SHALL use the repository's fake-time pattern, subprocess interactions SHALL be bounded on explicit recorded RPCs or the connector's crash signal, and no new test SHALL rely on wall-clock sleeps or delay-based kill races. The suite SHALL require no network access to external hosts, no real agent, no official `omp` executable, no provider or paid credentials, and no container or bwrap execution; it SHALL run under the existing integration test task and coverage gates without silently invoking live-agent acceptance.

#### Scenario: No sleep-dependent new tests
- **WHEN** the new suite's tests are examined for timing behavior
- **THEN** every time-sensitive assertion SHALL be driven by fake-time advancement or an explicit scripted message or crash signal
- **AND** no new test SHALL contain a wall-clock sleep used to await state

#### Scenario: Integration task stays live-acceptance-free
- **GIVEN** the repository's integration test task executes the new suite
- **WHEN** the suite runs
- **THEN** only in-process fixtures and `deno`-launched mock subprocesses SHALL be spawned
- **AND** no `omp --version`, container build, bwrap invocation, or external provider request SHALL occur

### Requirement: Non-Duplication and Justified Deletion Rule for the Lifecycle Suite

The combined suite SHALL NOT duplicate single-component unit assertions already shipped by predecessor rows' suites. A redundant unit case MAY be deleted only when the combined suite fully supersedes its observable outcome, and each deletion SHALL be individually justified in the commit message naming the superseding scenario. Absent a true redundancy, deleting nothing is a conforming outcome; the rule SHALL NOT be satisfied by weakening or modifying existing unit assertions.

#### Scenario: Deletion requires a named superseding scenario
- **WHEN** a predecessor unit test case is deleted alongside this suite
- **THEN** the deletion commit SHALL name the case and the combined scenario whose real-code flow asserts the same observable outcome
- **AND** no unit assertion SHALL be weakened, only removed under this rule or left intact
