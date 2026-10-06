## ADDED Requirements

### Requirement: Combined Mocked Skill-Handoff Regression Suite

The repository SHALL provide a combined deterministic integration suite that drives the real `SessionOrchestrator` delivery path, the real Skill API server, session registry, and reply/file/reaction handlers, with a mock ACP agent (composed through the shared OMP mock-session builder consumed unchanged, its mock-agent fixture extended additively) and a mock platform adapter, in BOTH per-spawn and pooled spawn shapes, with no real platform service. The suite SHALL cover at minimum: the happy-path handoff where the prompt supplies the literal Skill API session id and absolute staging directory, the payload file is staged at that absolute path, the skill is invoked with the literal session id and absolute payload path, real authentication and payload containment accept it, and exactly one intended platform response is recorded; the missing-reply retry triggering exactly once with a literal-first retry prompt (literal id, absolute staging directory, no unexpanded tokens) and no duplicate or fallback delivery; `send-file` quota and message-id anchor invariants including rejection of file ids for `edit-reply`; at-least-one-response satisfaction by reaction-only and file-only turns without retry, with the conversation-summary gate remaining on a sent text reply; and an OpenCode regression flow whose pool keys, spawn environment, and command strings byte-match the shipped values with the legacy token-path expansion still functioning. The suite SHALL NOT restate single-component decisions already covered by predecessor unit suites or the payload-contract delivery test.

#### Scenario: Pooled handoff delivers exactly one intended response
- **GIVEN** a pooled OMP session with no frozen subprocess session identity, a shared-process marker, and a valid active-session pointer
- **WHEN** the mock agent stages a payload at the absolute staging path and invokes the reply skill with the literal session id
- **THEN** real authentication and containment SHALL accept the call and exactly one intended platform response SHALL be recorded
- **AND** no retry prompt and no fallback or duplicate delivery SHALL occur

#### Scenario: Retry fires once with literal-first instructions in both shapes
- **GIVEN** a session in either spawn shape whose agent turn ends without any reply, reaction, or file send
- **WHEN** the orchestrator completes its retry handling
- **THEN** exactly one retry prompt SHALL be recorded, carrying the literal session id and absolute staging directory with no unexpanded shell token
- **AND** if the retried turn also produces no response the session SHALL report failure with zero platform deliveries

#### Scenario: File-only turn is a response but not a summary trigger
- **GIVEN** a session whose only delivered output is a successful multi-file send
- **WHEN** the turn completes
- **THEN** the at-least-one-response gate SHALL be satisfied without retry
- **AND** the conversation-summary generation SHALL NOT run
- **AND** a second send-file call SHALL be rejected and a file message id SHALL be rejected by edit-reply

#### Scenario: OpenCode delivery flow remains byte-identical
- **GIVEN** an OpenCode message session driven through the same harness
- **WHEN** pool keys, spawn environment, command strings, and a legacy token-path payload invocation are captured
- **THEN** the captured values SHALL byte-match the current shipped OpenCode values
- **AND** the legacy token-path payload resolution SHALL still deliver the response
- **AND** no readiness verification or trusted-extension involvement SHALL appear

### Requirement: Skill-Handoff Suite Honest Posture and Determinism

Every skill-handoff scenario SHALL assert the inherited fail-closed seams on their deny or blocked outcome wherever they would otherwise be silent, and every restricted allow path SHALL be enabled only by a labeled synthetic positive registered in the suite's runtime synthetic-positive ledger. The suite SHALL NOT execute a real OMP binary, real platform service, external network host, provider credential, container, or bwrap; the Skill API SHALL bind an ephemeral loopback port per test file; every timer-driven path SHALL use the repository's fake-time pattern; subprocess and skill-script completion SHALL be awaited on explicit recorded events rather than wall-clock sleeps; and the suite SHALL run under the existing integration test task and coverage gates without silently invoking live acceptance. No test name, comment, or assertion SHALL claim that the native binary staged a file, invoked a skill, delivered a platform response, or enforced any policy; payload staging by the mock fixture SHALL be documented as standing in for the agent's write, whose authorization decision is the client-side one under test.

#### Scenario: Unresolved readiness still denies before any skill call
- **GIVEN** a restricted scenario composed without a synthetic established-readiness fixture
- **WHEN** the orchestrator attempts its first prompt
- **THEN** the run SHALL end with the bounded readiness-rejection reason
- **AND** zero skill invocations and zero platform deliveries SHALL be recorded

#### Scenario: Rejected skill call composes with the retry gate without fallback delivery
- **GIVEN** a skill call presenting a wrong-session credential or an out-of-staging payload path
- **WHEN** the real Skill API rejects it and the turn ends without a response
- **THEN** exactly one retry SHALL be attempted and the session SHALL report failure
- **AND** no platform delivery SHALL occur and no assertion SHALL attribute the rejection to native enforcement

#### Scenario: Skill API port never collides with existing suites
- **WHEN** the suite's Skill API servers are inspected for their bound ports and credential directories
- **THEN** each SHALL use an ephemeral loopback port and a per-test credential directory
- **AND** no test SHALL bind the fixed port used by existing integration suites

#### Scenario: Additive-only mock and integration-tree discipline
- **GIVEN** the diff of this change's test edits
- **THEN** existing mock-agent OpenCode behavior and existing integration suites SHALL be byte-unchanged
- **AND** any new fields on the shared mock-session builder SHALL be additive with existing lifecycle behavior unchanged
- **AND** at most one pre-declared additive test-only production seam SHALL appear, if any, with production defaults preserved
