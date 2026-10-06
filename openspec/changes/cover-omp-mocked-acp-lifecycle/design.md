## Context

See `proposal.md` — Why. Binding inputs: approved design §14 (mock ACP subprocess/connection fixtures may exercise new/prompt/cancel/load, crashes, and registry updates without launching a real agent; consumer-visible decisions and state transitions; no source-text snapshots or mocks that manufacture missing security behavior; the applicable task set `fmt:check`, `lint`, `check`, `test:unit`, `test:integration`, coverage > 75%; those tasks must NOT silently invoke live-agent/container/bwrap acceptance), §15 (unit/mock evidence never certifies native behavior; the listed observations stay user-owned), and §16's P9a row ("Combined deterministic mock ACP/MCP new/prompt/cancel/load/crash tests exercising real integration code across modes/ownership/readiness").

Inherited honesty posture, consumed verbatim and never softened:

- Readiness: P0 verdict "Partial support, overall unresolved …"; the connector-side `ReadinessChannel` shipped UNIMPLEMENTED resolving `NotReady` (row 13) — in this suite restricted sessions are DENIED at the first-prompt gate by default; an allow requires a labeled synthetic established-tuple fixture and clears nothing.
- MCP admission basis: `candidate-to-verify` / `needs-mechanism-audit` (14a) — no scenario may present MCP admission as supported.
- Record reset: INCOMPATIBLE (row 8/P0) — surviving lower-layer records never grant in any fixture outcome.
- Destructive-intent decoding: UNRESOLVED (row 5/14a/P0) — undecodable input exercises the shared fail-closed verdict.
- No test names, comments, or assertions may claim the native OMP binary invoked a handler, honored a denial, rejected a cross-mode load, emitted readiness, or suppressed a language server. Those lines belong to the §15 checklist.

Predecessor consumption (landed artifacts, no redefinition): row 6 `src/acp/session-config.ts` + connector stable-first/reload-cache logic; row 10 `AgentProcessPool` mode-composed keys + `ActiveSession.permissionMode`/`processNamespace` + global lease; row 11 `reconnectAndResumeSession` recovery context (`gateContext`, `onGateContextRestored`) + ownership-violation error class + isolation contract; row 13 readiness state table, first-prompt gate, `readiness_rejected` reason, epoch-reset semantics; 14a's pure modules (`tool-inventory.ts`, `tool-provenance.ts`, `approval-records.ts`, `destructive-decision.ts`); 14b's trusted-tree `enforcement.ts` handler body + `src/acp/omp/tool-enforcement-wiring.ts` vocabulary; row 15 restricted launch flag/overlay pin + `agent-config/opencode.json` build-agent permission map; row 20's fact that the extension tree is content-final and this suite runs against dev paths.

Harness realities the design must honor (verified in-repo):

- `tests/mocks/mock-acp-agent.ts` is a real stdio JSON-RPC mock subprocess launched by the connector (used by `tests/integration/shared-process.integration.test.ts`), with a state file surviving restarts for recovery flows; wall-clock `MOCK_PROMPT_DELAY_MS` + `kill -0` polling is today's crash technique.
- `tests/acp/agent-connector.test.ts` injects a scripted in-process connection object (`connector["connection"] = { … }`) — an inline pattern to extract into `tests/mocks/mock-acp-connection.ts`.
- `@std/testing` `FakeTime` is the established deterministic-timer pattern (`tests/core/rate-limiter.test.ts`, `context-assembler.test.ts`).
- OMP launch: the factory's `omp acp` command construction (row 9) plus row 20's dev-path resolution; the integration harness must be able to substitute the mock executable — the existing OpenCode integration tests already do this via the agent command the connector spawns; IF the OMP factory path offers no equivalent injection point, the pre-declared test-only seam applies (flagged, single hook, no behavior change for production callers).

## Goals / Non-Goals

**Goals:** One deterministic combined lifecycle suite proving the REAL integration code composes rows 6/10/11/13/14a/14b/15/20 decisions across: initialize/new/prompt/cancel/load; crash→reconnect→same-mode load with model/reasoning reapplication from restored config-options; cross-mode ownership rejection in both directions; correct-session gate-context restoration; deny-until-ready including post-start MCP-refresh re-admission epoch composition through the real decision modules; dual-mode lease serialization; OpenCode byte-compare regression — with every unresolved seam asserted fail-closed and every allow path a labeled synthetic fixture. A shared OMP mock-session builder that row 22 consumes unchanged.

**Non-Goals:** Zero production behavior change (at most the pre-declared test-only launch seam). No per-spawn/pool payload→Skill API→mock-platform reply regression (row 22). No final README/AGENTS/OpenSpec/changelog sync (row 22 — the changelog is explicitly omitted here, test-only). No P0 verdict revision, no new capability spec, no changes to rows 1–20's unit suites beyond justified deletions, no container/bwrap/live-`omp`/provider execution, no dashboard coverage.

## Decisions

### D1. Two-tier harness: scripted in-process connection + stdio mock subprocess, chosen per scenario

Scenarios split by what they must exercise:

- **Connection-tier** scenarios (config restoration, ownership verification, readiness state composition, provenance/epoch composition) drive real `AgentConnector` methods against the extracted `tests/mocks/mock-acp-connection.ts` — a scripted in-process ACP connection that records every RPC (initialize/new/prompt/cancel/load/set_config_option) and replays scripted responses/notifications (config-option catalogs, `config_option_update`, registry-epoch tool-metadata observations, scripted mid-call connection death). This tier is deterministic by construction: every interaction is an awaited message, never a timer.
- **Subprocess-tier** scenarios (crash→reconnect, dual-mode pool coexistence, OpenCode byte-compare, LSP-posture across respawn) launch the extended `tests/mocks/mock-acp-agent.ts` through the real pool. The crash trigger changes from delay-based kill to an explicit scripted RPC: a prompt whose text contains `mock-crash` makes the mock exit its process tree mid-prompt (no `MOCK_PROMPT_DELAY_MS` dependency in NEW tests; the existing OpenCode suites keep their current behavior untouched). Process-exit detection uses the connector's own crash signal, not polling sleeps.

Both tiers are behind the shared builder (D2); no scenario hand-rolls fixture plumbing.

### D2. `tests/mocks/omp-mock-session.ts` — the shared OMP mock session builder (row-22 contract)

One exported builder composes an OMP scenario fixture from landed shapes only:

```
buildOmpMockSession({
  mode: "restricted" | "yolo",           // row 10 effective mode
  ownership?: { permissionMode, processNamespace },  // row 10 fields for recovery fixtures
  configOptions?: "flat" | "grouped" | "miss" | "none", // row 6 catalog shapes
  readiness: "unresolved" | { syntheticEstablished: true }, // default unresolved → fail closed
  registry?: { epoch, tools: ToolObservationFixture[] },     // 14b live-observation input
  destructive?: "undecodable" | …,                             // row 5/14a fail-closed path
  timers?: FakeTime,
})
```

Every synthetic-positive element (established readiness tuple, trusted-provenance tool origin, admitted MCP tool) is wrapped in a `SyntheticPositive` carrier carrying the P0 fixture-rule label; the builder has NO default allow path — `readiness` defaults to `unresolved` and untrusted provenance is the default tool fixture. Row 22 imports this module unchanged; the contract is that adding row-22 needs must extend it additively in row 22, never rework it here.

### D3. Scenario matrix is cross-component by construction

Each scenario names its required component intersections, and a scenario touching one component's already-unit-tested decision is rejected in review:

| Scenario                                               | Components interacting (≥2)                                                                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Happy path init/new/prompt/cancel/load                 | pool mode-acquisition (10) × readiness gate consumption (13) × config-options cache population (6)                                                               |
| Crash→reconnect→same-mode load                         | recovery ownership (11) × pool mode entry re-entry (10) × real load-cache restore + stable-first model/reasoning reapplication (6) × gate-context restore (11/4) |
| Post-load catalog miss                                 | recovery (11) × explicit catalog-miss error (6) × per-session isolation incl. sibling lease/state untouched (10)                                                 |
| Cross-mode rejection (both directions)                 | recorded ownership fields (10) × verify-before-teardown violation (11) × opposite-mode live process/lease untouched assertion (10)                               |
| Gate-context correct-session after crash               | gate-context restore (11) × real row-4 read/write authorization evaluated on the re-issued prompt                                                                |
| Deny-until-ready first prompt                          | orchestrator gate call site (13) × real `NotReady` channel seam × zero-prompt-RPC assertion through the recorded connection                                      |
| Established-readiness allow (labeled)                  | readiness decision (13) × orchestrator ordering §10 step 5 (after model/reasoning set — asserts row 6 ran first, row 13 gate second, in one flow)                |
| Refresh → epoch bump → readiness reset → re-admit/deny | 14b handler body × 14a provenance/inventory/MCP-admission modules × row 13 readiness reset × connector epoch state                                               |
| Denied tool → bounded fail-closed error                | 14b error shapes × client-visible surface (composition tier)                                                                                                     |
| Dual-mode lease serialization                          | pool mode-split entries (10) × orchestrator lease around two concurrent session runs                                                                             |
| Restricted LSP posture across respawn/load             | row 15 flag+overlay composition × row 11 recovery respawn path × D6 YOLO exemption                                                                               |
| OpenCode regression byte-compare                       | pool key/env/command byte-identity (10) × readiness/extension non-involvement (13/14b) × `agent-config` yolo untouched (15)                                      |

### D4. Registry/provenance composition without the native binary

The mock subprocess does not load the trusted extension (the pinned binary would), so the refresh scenario is explicitly a CLIENT-SIDE + MODULE composition: the connection-tier fixture presents simulated live tool-metadata observations (the shape 14b's wiring consumes), 14b's real `enforcement.ts` handler body + 14a's real decision modules run against them, and the real connector-side epoch/readiness state participates. Test names and the README note state this is integration-code composition evidence only; "the extension ran inside a real agent process" is §15 user-owned and never implied. No fabricated ACP notification names: observations arrive through the 14b wiring's own injectable observation input, not invented protocol.

### D5. Determinism and gate fit

`FakeTime` (`using clock = new FakeTime(…)`) for every timer-driven path: readiness establishment timeout, idle-timeout reconnect triggers, pool reclaim. Connection-tier scenarios need no timers at all (subpromises resolve on scripted messages). Subprocess-tier scenarios bound every wait on an explicit recorded RPC or the connector's crash signal with an overall per-test timeout; no test may contain a bare `setTimeout`/sleep (review rule; existing OpenCode integration tests are exempt — untouched). `deno test:integration` picks the suite up automatically under `tests/integration/`; `deno.json` is not edited; the suite spawns only `deno run` mock processes and temp dirs — no network listeners beyond the existing local Skill-API mock where a flow needs one, no provider credentials.

### D6. Redundancy audit and deletion discipline

Before finishing, diff the new matrix against rows 1–20's landed test files. A unit case is deletable only if (a) it asserts a single-component decision, (b) a new combined scenario asserts the SAME observable outcome through real code, and (c) the deletion commit message names the case and the superseding scenario. Deletions are BOUNDED to test files owned by OMP-batch rows (this suite's own tree and files this batch created); an OpenCode-inherited regression case is never deletable as "superseded" by an OMP mock suite — the design section-14 OpenCode row stands on those cases (batch-review fix). Expected volume is small (the per-row suites were written decision-first, this suite is flow-first); if the audit finds zero true redundancies, deleting nothing is a passing outcome — this proposal does not require deletions, it requires justification for each.

### D7. Honesty assertions are first-class test content

Each fail-closed seam gets at least one combined scenario asserted on its DENY outcome: readiness unresolved → `readiness_rejected`, zero prompt RPC, no fallback spawn; undecodable destructive intent through the full wiring → shared fail-closed verdict with zero side effect; surviving lower-layer approval record fixture → never grants through 14b; MCP admission basis fixtures labeled `needs-mechanism-audit` in the assertion data. Allow-path scenarios all route through `SyntheticPositive` carriers, and a suite-level guard test scans (via the carrier's runtime registry, not source text) that every allow fixture is registered as synthetic — replacing fragile source-text snapshots with a runtime ledger. The README test-map note states explicitly (batch-review fix) that the 14a/14b composition scenarios bypass row 13's prompt gate BY CONSTRUCTION (the mock subprocess does not load the trusted extension) and are composition evidence only — green here is never gated-pipeline or native-enforcement evidence. `FakeTime` coverage of the readiness establishment timeout exercises only this codebase's timeout handling; it never implies the real control channel's native timeout behavior is verified (design section-15 checklist item; batch-review note).

## Risks / Trade-offs

- **Integration flakiness from real subprocesses** → only the four subprocess-tier scenarios spawn processes; all security-composition scenarios are connection-tier (fully in-process). Crash detection via the connector's crash signal, never polling sleeps, in new tests.
- **FakeTime vs real subprocess timers** → `FakeTime` is installed only in connection-tier tests; subprocess-tier tests use explicit-message waits (fake timers cannot virtualize a child process).
- **Overlapping rows 10/11/13 files** → none: this change edits no `src/**` file (except the pre-declared seam exception, which touches only `agent-factory.ts`'s test-injection point and must be additive).
- **Suite runtime creep** → cap subprocess-tier scenarios at the four enumerated flows; coverage gate is met mostly by connection-tier tests exercising already-covered modules again through real paths, which is the intended P9a value, not padding.

## Migration Plan

Test-only; no runtime migration. Merge order: after all dependencies (rows 6, 10, 11, 13, 14a, 14b, 15, 20) are applied — the suite imports their landed modules and would otherwise reference unbuilt seams. Row 22 builds on `omp-mock-session.ts` afterward.

## Open Questions

- Whether the row-9 factory already exposes an executable/command override usable by the integration harness. Implementation decides first thing; if absent, the minimal test-only seam ships and is named in the return (expected to be unnecessary — the connector already spawns whatever command the factory composes, and the OpenCode integration pattern overrides at that boundary).
