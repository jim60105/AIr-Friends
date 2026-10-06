## Context

Recovery today is one connector method and one orchestrator call site. `AgentConnector.reconnectAndResumeSession(sessionId, cwd, mcpServers)` (`src/acp/agent-connector.ts:964`) tears the connection down (`disconnect()`), re-spawns from `this.options.agentConfig`, checks `supportsLoadSession()`, issues `session/load`, calls `setSessionGateContext(sessionId, { cwd })`, and returns `true`. The only other gate-context wiring is `connect()`'s blanket replay of `sessionGateContexts` onto the fresh client (`agent-connector.ts:186-189`). On the orchestrator side, `promptWithIdleTimeoutHandling` (`src/core/session-orchestrator.ts:3725`) is the sole recovery trigger (idle-timeout liveness failures plus, in shared mode, the crash signal); it raises `recoveryFenced` synchronously, waits for in-flight side effects, and re-issues the prompt behind a respond-gate.

Three properties of that shape are unsafe under mode-split pools: (1) nothing ties the respawn or the `session/load` to the permission mode / process-state namespace the session was ACQUIRED under — the connector trusts its own options, and the session only ever had row 10's `ActiveSession.permissionMode` / `ActiveSession.processNamespace` written at acquisition (OpenCode pooled sessions record `yolo-switch` + the pool-key data-root identity); (2) the gate-context restore is cwd-only, so if the pool re-spawned a FRESH connector (row 10's liveness re-spawn path) the recovered session resumes with the process-frozen client flags — effectively another session's fallback context; (3) after row 6, the load response restores the canonical config-options cache and re-sends model (+ optional reasoning), so recovery must supply the session's resolved reasoning effort or reasoning silently disappears after a crash.

Row 10's contract (its `acp-integration` delta) is read-only here: the ownership fields are written once at acquisition, "SHALL NOT be mutated by later per-session activity", and their "Recovery interface is read-only consumption" scenario names this change as the verifier. Row 6's contract is consumed through its call surface: `reconnectAndResumeSession(sessionId, cwd, mcpServers, opts?: { reasoningEffort?: string })` with load-cache restoration, stable-first model reapplication (catalog-miss throws, isolated), and best-effort reasoning after the model.

## Goals / Non-Goals

**Goals:** one recovery path, exercised by both crash reconnect and `session/load`, that is (a) anchored to the recorded original mode, state namespace, cwd, and operator MCP definitions; (b) ownership-verified BEFORE any teardown, failing closed in both directions; (c) cache/model/reasoning-complete via row 6's logic; (d) gate-context-restored for the recovered session id before prompting resumes; (e) failure-isolated per session with the existing error classes; (f) a named, empty readiness seam for row 13. OpenCode recovery behavior stays byte-identical.

**Non-Goals:** no pool-key composition, mode resolution, lease, or reclaim changes (row 10); no writing or re-meaning of the ownership fields (row 10); no authenticated readiness request/response, deny-until-ready prompt gate, or readiness state (row 13); no tool-policy, LSP, staging-prompt, transport, search or packaging behavior (rows 14–20); no changes to the filesystem sink authorization logic (row 4 — the restored gate context is its input, its decisions are untouched); no modification of row 6's catalog flattening / canonical matching / `none`→`off` alias / cache-refresh semantics; no new config/env/Helm field; no retry or telemetry subsystem; no combined lifecycle suite (row 21).

## Decisions

### D1 — Recovery context is caller-supplied and read-only; the connector never re-resolves the mode

`reconnectAndResumeSession` grows inside row 6's trailing-options object:

```ts
reconnectAndResumeSession(
  sessionId: string,
  cwd: string,
  mcpServers: MCPServerConfig[] = [],
  opts?: {
    reasoningEffort?: string;                                   // row 6, consumed unchanged
    ownership?: SessionRecoveryOwnership;                       // row 11 (required for OMP recovery)
    gateContext?: SessionGateContext;                           // full per-session context to restore
    onGateContextRestored?: (sessionId: string) => void | Promise<void>; // row-13 readiness seam
  },
): Promise<boolean>
```

`SessionRecoveryOwnership` is `{ permissionMode, processNamespace, agentType }` — the recorded acquisition values plus the deployment agent type needed to pick the comparison rule. The orchestrator reads them from the registry's active-session record (`this.sessionRegistry.get(shellSessionId)` — the fields row 10 wrote) and from `getDefaultAgentType(this.config)`; the connector never resolves, re-reads config, or infers a mode. Rationale: row 10 made the mode an explicit option at acquisition and explicitly forbids inference elsewhere; recovery is the same discipline (the recorded value is the TARGET, not an input to a new decision). Alternative considered: the connector deriving the expected mode from its own `agentConfig.env` alone — rejected, because that makes the connector self-certifying: any drift between the entry the session was leased and the options it holds would silently pass, which is exactly the "find its ID elsewhere" failure design §5 forbids.

The parameter is optional in the type so existing OpenCode/unaware call sites compile and behave exactly as today; the orchestrator's OMP recovery paths always populate it.

### D2 — Ownership verification runs BEFORE `disconnect()`; a violation touches nothing else

A small pure module `src/acp/recovery-ownership.ts` exports `verifyRecoveryOwnership(recorded, actual): OwnershipVerdict`, where `actual` is `{ permissionMode, processNamespace }` derived from the connector's own recovery target (the agent type + the mode-scoped namespace in `this.options.agentConfig.env` — `PI_CODING_AGENT_DIR`/`TMPDIR` for OMP, the pool-key data root for OpenCode — the same factory-produced env row 10 recorded from, so there is one namespace formula: `omp-paths` via the factory, never a re-derivation). Verdicts: `match`, `mode-mismatch`, `namespace-mismatch`, `unverified` (record missing/incomplete for `omp`).

In `reconnectAndResumeSession` the verification is the FIRST statement, ahead of `await this.disconnect()`: on any non-`match` verdict it throws a distinct `RecoveryOwnershipError` (message names the session, `expected` mode/namespace, `actual` mode/namespace — bounded, no MCP env/headers or path contents beyond the two namespaces) and performs NO disconnect, NO spawn, NO `session/load`, NO gate-context mutation. Because the check precedes the teardown, a violation cannot kill the opposite mode's live process, cannot drop the session's own gate context (design §13 "cannot … lose its gate context to make progress"), and cannot reach the respond-gate re-prompt path at all.

Both directions are specified as separate scenarios in the delta: a restricted recovery context holding a `native-yolo`-owned session id, and a `native-yolo` context holding a `restricted`-owned id. Each is an OWNERSHIP VIOLATION — not a fallback to the other mode, not a fresh opposite-mode process, and not the existing "loadSession not supported … Session lost" message (that string stays reserved for genuine capability absence, so tests and operators can tell the two apart). `unverified` for OMP is treated as a violation, not as "proceed like today": an OMP session with no provenance record cannot prove same-mode recovery, and §13's gate-context/ownership rule is deny-before-side-effect. For OpenCode, the record's `yolo-switch` + pool-key data-root identity always matches by construction (its env is unchanged), and an ABSENT record keeps today's exact path — that asymmetry is what keeps OpenCode recovery byte-identical while OMP fails closed. Alternative considered: verify after `loadSession` by inspecting the load response — rejected: ACP's `session/load` response carries no mode/namespace attestation, so post-load inspection is a client-side fiction; the only real control point is "only load in the namespace the session was created in", which must therefore be decided before the load.

### D3 — Same-mode respawn is asserted, not re-selected

The respawn stays `disconnect()` → `connect()` on the connector's own options; recovery never chooses a different process or namespace, and never asks the pool for a new entry (the pool runner owns that lease and would need to re-acquire it — row 10's rule that mode is explicit at acquisition). Verification (D2) is what guarantees the "respawn into the SAME mode pool + namespace" property: the connector being recovered on IS the entry's connector, and its options' namespace must equal the recorded one. The connector additionally re-checks the invariant after `connect()` from the fresh `agentConfig` env it just spawned with, so a spawn that drifted between the two reads aborts before any `session/load` is issued. Documented explicitly: `agent-process-pool.ts`, `agent-factory.ts`, and `omp-paths.ts` are NOT edited by this change; recovery re-enters row 10's mode-composed entry, it does not construct one.

### D4 — Config restoration is pure consumption of row 6, with reasoning now supplied

After a successful load, the sequence is exactly row 6's: refresh the cache from `response.configOptions`, reapply the previously set model stable-first (catalog-miss → the error propagates into this session's failure handling, no unstable second chance), then — only because this change passes it — reapply reasoning effort best-effort through row 6's `opts.reasoningEffort`. The orchestrator threads the session's already-resolved value (`resolvedReasoningEffort`, the same value used at session setup in both pooled blocks) into the recovery call, so a crash no longer silently loses reasoning configuration; `default`/empty keeps the existing no-op semantics and every reasoning outcome stays non-fatal. No matching, flattening, casing, or cache-refresh code lands in this change; its tests assert only that the wiring reaches row 6's surface with the right arguments and that failures isolate.

### D5 — Gate-context restore is complete and bound to the recovered session id

The recovery call passes the FULL `SessionGateContext` the session was registered with — `{ cwd, shellSessionId, yolo, canWriteAgentWorkspace, allowedWriteExtensions }` — which the orchestrator already holds at both pooled call sites (`session-orchestrator.ts:724-730` and `:3522-3528`). The connector restores it for the recovered id via the existing `setSessionGateContext` merge (so the value survives a later `connect()` replay too) AFTER `session/load` succeeded and BEFORE it returns `true`, and it never substitutes another session's cached context or the process-frozen client config: if the caller supplied no `gateContext` for a recovered id that has no cached context, that is a gate-context restore failure → fail closed for that session, other sessions' contexts untouched. `cwd` in the option and the recorded recovery cwd MUST agree (the recovery cwd is the session's own workspace, not the process cwd); a disagreement is a restore failure, not a silent overwrite. Ordering matters and is specified: load → cache/model/reasoning → gate-context restore → readiness seam → resume prompting. Alternative considered: keep cwd-only restore and rely on `connect()`'s blanket replay — rejected, because a pool-initiated FRESH connector has an empty `sessionGateContexts` map, which is precisely the unknown-session-id case design §10 step 4 forbids.

### D6 — The readiness seam is an invoked-if-present callback, placed by the orchestrator-side contract

The seam is `onGateContextRestored` (optional, called after restore and before the method reports success). This change defines position + contract and ships NO implementation: no readiness request, no session/process state, no client-visible check, no prompt gating (row 13). A rejected/throwing hook fails only the affected session, through the same isolation path — that is the behavior row 13 will rely on, and it is tested here with a stub hook so row 13 cannot silently widen it. The hook lives on the connector rather than only in the orchestrator because the ordering constraint ("before resuming prompting") is only enforceable where the gate context is restored; the orchestrator's re-prompt path sits strictly after the method returns.

### D7 — Failure isolation reuses the existing per-session machinery verbatim

The orchestrator wraps the call site: `RecoveryOwnershipError` and the restore-failure error are classified as session-loss-for-this-session — logged with a bounded `session_recovery_failed`-style reason (reason code: `ownership_violation` | `ownership_unverified` | `load_failed` | `catalog_miss` | `gate_context_restore_failed` | `readiness_rejected`), audited via the existing `session_end` failure path, and returned as the session's error. No fence lowering is reordered, no re-prompt is attempted, no `disconnect()` is called for a violation, other sessions' gate contexts and processes are untouched, and the pool's `finally` release path is unchanged. Genuine load failures and post-load catalog misses keep row 6's/§13's existing isolation (throw → that session fails); the only new behavior is that none of them may fall through into the "resume anyway" branch.

### D8 — Tests are consumer-visible decisions against mock ACP

Mock-connector/mock-connection tests (existing `tests/acp/agent-connector.test.ts` harness): same-mode reconnect respawns in the recorded namespace and succeeds; cross-mode load is rejected in BOTH directions with zero `disconnect`/`spawn`/`loadSession` calls recorded; load restores the cache and the model+reasoning reapplication reaches row 6's stable-first surface with the supplied effort; a missing gate context for the recovered id fails that session while a sibling's context is intact and replayed; `connect()`-fresh (empty context cache) recovery restores the full context from the supplied option; OpenCode recovery golden-identical (no ownership requirement, `yolo-switch` record passes, cwd-only behavior unchanged when no options are passed). Orchestrator tests: `promptWithIdleTimeoutHandling` threads the registry-recorded ownership + full gate context + resolved reasoning into the connector, an ownership violation yields a session error without a re-prompt and without a `disconnect`, and the readiness hook stub is invoked exactly once between restore and re-prompt. No test asserts native OMP behavior; §15's "cross-mode ownership rejection" stays user-verified.

## Risks / Trade-offs

- **`unverified` fails closed → an OMP session whose record was lost (e.g. registry restart) loses its session.** Accepted: recovery without provenance cannot prove same-mode, and losing one session is strictly safer than loading a restricted history into a YOLO process. OpenCode is unaffected by construction.
- **Strict before-teardown verification means a violation leaves a possibly dead process connected.** Accepted and intended: the dead-but-connected entry is reclaimed/drained by the existing pool paths; deliberately not killing it is what keeps the violation from disturbing the opposite mode.
- **The recovery options object grows (row 6 + row 11 in one place).** Mitigated by shape: row 6's key is untouched, row 11's keys are additive and optional, and this change edits only their consumption order — the batch order (row 6 → row 10 → row 11) plus the shared-file note keeps `agent-connector.ts` serialized.
- **The readiness seam could be misread as readiness implemented.** Mitigated three ways: the delta requirement states "restore-context yes, gate-prompt-on-readiness no", the hook ships unimplemented, and the docs name row 13 as the attaching owner.
- **Mock-only evidence.** These tests certify the bot's client-side decisions; they cannot show the pinned binary refusing a cross-mode load. Recorded honestly, per the batch rule and design §15.
- **Shared-file churn** (`session-orchestrator.ts` with rows 4/10/16) → edits confined to `promptWithIdleTimeoutHandling`, the two pooled runner blocks' recovery wiring, and the hook call; no restructuring of the surrounding flow, fences, or retry logic.

## Migration Plan

Pre-release, no compatibility layer: the recovery options are additive-optional, all OMP recovery call sites pass them in the same change, and no persisted format changes (the ownership fields already exist from row 10; nothing here migrates them). Rollback = revert this commit; row 6's reconnect logic and row 10's pool identity remain intact and unaffected. No `config.example.yaml`/`.env.example`/`helm/values.yaml` synchronization is needed (recovery inputs are the existing registry record, resolved model/reasoning, and operator MCP configuration) — if implementation surfaces any new field, all three files are updated in THIS change.

## Open Questions

None. Violation-vs-unsupported-resumption error separation, `unverified` handling, restore ordering, and the seam's form are decided above.
