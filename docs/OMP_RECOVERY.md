# Mode-Separated ACP Session Recovery

This document is the recovery contract for `restore-mode-owned-acp-sessions` (batch row 11) as
amended by `simplify-omp-recovery-context`: what a resumed ACP session is bound to, what is
verified before anything is torn down, what is restored afterwards, and what a recovery failure is
allowed to touch. It consumes row 10's acquisition-time identity record
(`docs/OMP_POOL_MODES.md`) and row 6's session-config restore logic (AGENTS.md, "Session Model
Selection (Stable-First)" / "Cache Restoration on Reconnect"); it changes neither.

Implementation surfaces: `src/acp/recovery-ownership.ts` (pure verdict helper, consumed by the
OpenCode path only), `AgentConnector.reconnectAndResumeSession()` in `src/acp/agent-connector.ts`
(verify-when-supplied → respawn → load → config tail → gate-context restore → hook), and ALL NINE
recovery call sites — the two pooled runner seams plus the seven per-spawn seams — with the failure
classification in `src/core/session-orchestrator.ts`.

## 0. Caller matrix — every reconnect-capable runner carries its own context

`SessionOrchestrator.promptWithIdleTimeoutHandling()` is the single recovery seam; every one of its
nine callers supplies the owning session's own recovery context — its own gate context, its own
cwd, the operator MCP servers and the resolved reasoning effort. A pooled OpenCode caller
additionally passes the row-10 ownership record; OMP recovery carries none (see §1). No caller
leaves the context implicit.

| Caller                                                                   | Acquisition shape | Context source                                                                                      |
| ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------- |
| `processMessage` pooled runner (`message`/`channelLurk`)                 | pooled            | the per-session gate registration + resolved effort (pooled OpenCode also threads its row-10 record) |
| `runSharedPoolSession` (pooled `spontaneous`/`selfResearch`/maintenance) | pooled            | the per-session gate registration + resolved effort (pooled OpenCode also threads its row-10 record) |
| `processMessage` per-spawn (`message`/`channelLurk`)                     | per-spawn         | the connector's own `clientConfig` gate fields + resolved effort                                     |
| `processSpontaneousPost` per-spawn                                       | per-spawn         | same shape (own workspace/effort)                                                                   |
| self research initial (per-spawn)                                        | per-spawn         | same shape, including the shared-workspace write authorization                                      |
| self research correction retry (per-spawn)                               | per-spawn         | the SAME captured initial research context — never a freshly inferred gate                          |
| user memory maintenance (per-spawn)                                      | per-spawn         | same shape (own maintenance identity/effort)                                                        |
| channel memory maintenance (per-spawn)                                   | per-spawn         | same shape against the CHANNEL workspace the acquisition spawned with                               |
| reminder (per-spawn)                                                     | per-spawn         | same shape (own shell identity/cwd/effort)                                                          |

The pooled callers' context is built inline at the seam; the per-spawn callers build it through one
helper (`perSpawnRecoveryContext`) from the session's own `clientConfig`, whose per-spawn connector
serves exactly that one session. `reasoningEffort` is the already-resolved value of the session
setup; nothing is re-resolved at recovery time. `recoveryOwnershipFromRegistry()` reads the row-10
record for OpenCode only and returns `undefined` for OMP, so no OMP caller can thread an ownership
record.

There is no recovery caller in `generateConversationSummary()`: the conversation summary prompts the
live session directly and catches failures, so a summary failure never triggers a reconnect and this
change gives the summary path no new retry behavior.

## 1. Recovery contract — OMP recovers from its own options; OpenCode keeps its checks

OMP recovery is option-based. The connector restarts its OWN process from its own immutable
connector options — the factory-produced command, args and env it was constructed with — and resumes
the in-flight session through the shared `session/load` capability path. There is no OMP ownership
prerequisite: a legacy OMP ownership record supplied by an old caller is NOT an authorization input
and is ignored, and the resolved permission mode stays an audit/pool-selection observation rather
than a recovery input. Mode separation is the pool entry key and the factory-produced mode-scoped
state root (`docs/OMP_POOL_MODES.md`); recovery never reconstructs a mode from a mutable namespace.

OpenCode recovery keeps its pre-change verification. When a recovery context is supplied
(`opts.ownership` or `opts.gateContext`), the recorded acquisition mode/namespace is verified
against this connector's own recovery target BEFORE any teardown, and once more after the respawn.
The rule is selected by the supplied record's agent type, falling back to the configured deployment
type — an OpenCode connector receiving a foreign (e.g. OMP-shaped) record still fails closed as
unmatched provenance. No ownership check is applied to a context-free OpenCode recovery, and none is
applied to any OMP recovery.

| Recorded input                   | Source                                                                        | Recovery use (OpenCode)                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ActiveSession.permissionMode`   | row 10 OpenCode acquisition (`process_acquired`)                              | Expected ownership mode; mismatch in EITHER direction is a violation                                                 |
| `ActiveSession.processNamespace` | row 10 OpenCode acquisition (pool-key data root)                              | Expected namespace; derived again ONLY from the connector's own factory-produced `agentConfig.env`, never recomputed |
| Session cwd                      | the session's own ACP cwd: pooled runner `sessionCwd`, per-spawn `agentConfig.cwd` (what `createSession()` used) | Passed positionally; a supplied `gateContext.cwd` must agree or restore fails closed                                 |
| Operator MCP definitions         | `SessionOrchestrator.getMCPServers()` at the call site                        | Passed to the respawn unchanged                                                                                      |
| Resolved reasoning effort        | row 6 `resolvedReasoningEffort` (same value as session setup)                 | Threaded through `opts.reasoningEffort`; `default`/empty keeps the no-op semantics                                   |

Ordering inside `reconnectAndResumeSession` (the supplied-context verification is part of the
OpenCode leg; every other step serves both agent types):

1. **Verify ownership FIRST (OpenCode with a supplied recovery context only)** — before
   `disconnect()`, before any spawn, load, or gate-context mutation. `actual` is derived from the
   connector's own options env (the pool-key data root for OpenCode — the same factory-produced env
   row 10 recorded from, so there is exactly one namespace formula). OMP runs no ownership step at
   all.
2. `disconnect()` → `connect()` on the connector's OWN options. OMP's mode-separated pool entry and
   mode-scoped state root select the process; recovery never asks the pool for a new entry.
3. Post-connect invariant re-check of the freshly spawned env, for OpenCode with a supplied
   ownership record (assertion; the values are reconstructed from the same options).
4. `session/load` (capability absence keeps the existing "loadSession not supported … Session lost"
   path — that string stays reserved for genuine capability absence).
5. Row-6 config tail (see §2).
6. Gate-context restore (see §3).
7. `onGateContextRestored` hook, if supplied (see §4).

### Verdicts and both violation directions (OpenCode)

`verifyRecoveryOwnership(recorded, actual)` (`src/acp/recovery-ownership.ts`) returns
`match | mode-mismatch | namespace-mismatch | unverified`. A matching `yolo-switch` + pool-key
data-root record is `match`, and an ABSENT OpenCode record is also `match` (today's behavior
preserved byte-identically). An OMP-shaped record supplied to an OpenCode connector derives the
actual target through the record's own agent type, finds no OMP namespace in the OpenCode spawn env,
and fails closed as `unverified`.

Both cross-mode directions are ownership VIOLATIONS, never a fallback:

| Direction                                                            | Outcome                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| restricted recovery context holding a `native-yolo`-owned session id | `RecoveryOwnershipError` (`ownership_violation`), zero side effects                            |
| `native-yolo` context holding a restricted-owned id                  | same — no opposite-mode resume, no fresh opposite-mode process, no "Session lost" string reuse |

Pinned verdict → bounded reason-code mapping (single source of truth
`mapOwnershipVerdictToReason`): `mode-mismatch → ownership_violation`,
`namespace-mismatch → namespace_mismatch`, `unverified → ownership_unverified`. Messages carry the
session id, expected/actual mode, and expected/actual namespace only — no MCP env/headers, no
secrets. The reason-code vocabulary is retained because the OpenCode path still produces it.

A violation performs NO disconnect, NO spawn, NO `session/load`, NO gate-context mutation. The
possibly dead-but-connected entry is left for the existing pool reclaim/drain paths; deliberately
not killing it is what keeps a violation from disturbing the opposite mode.

## 2. Config restore is pure row-6 consumption — never forked

After a successful load the sequence is exactly row 6's as shipped: refresh the canonical cache
from the load response's `configOptions`, reapply the prior model stable-first (a post-load catalog
miss propagates and fails THIS session in isolation, no unstable second chance), then reapply
reasoning effort best-effort — only because row 11 supplies `opts.reasoningEffort`, so a crash no
longer silently loses reasoning configuration. Every reasoning outcome stays non-fatal. This change
adds NO matching, flattening, casing, or cache-refresh code: `src/acp/session-config.ts` has zero
diff in this change.

Note for pooled OpenCode: reasoning reapplication rides row 6's stable-first config-options path;
when the agent advertises no `thought_level` option it remains the documented best-effort no-op
(same semantics as session setup), and the orchestrator-side reasoning RPC activation ordering
(`setSessionConfigOption` after model, before prompt) is unchanged.

## 3. Gate-context restore — supplied context is restored for the recovered id

The orchestrator passes the FULL `SessionGateContext` the session was registered with (`cwd`,
`shellSessionId`, `yolo`, `canWriteAgentWorkspace`, `allowedWriteExtensions`) as `opts.gateContext`
on every caller (§0), with `cwd` equal to the session's own ACP cwd:

- Supplied context whose `cwd` disagrees with the recovery cwd → `GateContextRestoreError`, no
  mutation, this session only. The check is POST-LOAD for every agent type: no recovery
  prevalidation runs before the teardown.
- Supplied (or agreement-cached) context is restored for the RECOVERED session id via the existing
  `setSessionGateContext` merge, AFTER the load/config tail and BEFORE success — so it also
  survives later `connect()` replays. Cached contexts stay per ACP session id: the recovered id's
  OWN context is re-registered and a sibling's cached context is never rebound to it.
- No context supplied AND none cached for that id, on an OpenCode recovery that DID supply an
  ownership record → fail closed as `gate_context_restore_failed`. The session NEVER resumes on the
  process-frozen client flags or another session's cached context.
- An OMP call that supplies no gate context uses the existing cwd-only restore (the connector's
  process-frozen `clientConfig` fields) and still recovers. Production OMP callers always supply the
  session's own full gate context, which supersedes that fallback; the fallback exists so a
  context-free OMP recovery is a supported load rather than a bounded failure.
- Other sessions' cached contexts: replay logic unchanged, never rebound.

When no recovery context at all is supplied (`opts.ownership` and `opts.gateContext` both absent),
the method keeps its exact pre-row-11 behavior: the cwd-only restore tail applies. That is the
pre-change OpenCode shape and the OMP context-free recovery shape.

## 4. Post-restore recovery hook — named, optional, no readiness assertion

`opts.onGateContextRestored?: (sessionId: string) => void | Promise<void>` is invoked exactly once
strictly AFTER gate-context restoration and BEFORE success/resumed prompting; the orchestrator
resumes strictly after it returns. It is a named callback contract and NOTHING MORE: no readiness
request/response, no session/process readiness state, no channel, no assertion, no prompt gate is
implemented or deferred (row 13 `gate-omp-policy-readiness` was removed from the batch by user
decision 2026-10-09; it is not a hook supplier). In production the orchestrator's
`recoveryPostRestoreHook()` seam is a documented no-op returning `undefined`; tests inject a stub
through it. A rejecting hook is wrapped as `RecoveryHookError` → `post_restore_hook_failed` and
fails only its own session.

## 5. Isolation matrix — which failure, which blast radius

Every recovery failure ends exactly ONE session through the existing `session_end` failure audit
path (exactly one `session_end` per turn, error stamped
`session_recovery_failed: <reason>`), never enters the respond-gated re-prompt branch, and never
calls `disconnect()`/`cancel()` from the recovery path. The pooled runners stamp the reason at their
post-lease `session_end` writer; per-spawn callers stamp it on their ended-without-response outcome
(the bounded reason replaces the generic idle-timeout message for that turn only, and the same
reason vocabulary is reused — no second one):

| Failure                                            | Reason code                      | Blast radius                                                                                                                                           |
| -------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenCode supplied-record mode mismatch             | `ownership_violation`            | This session only; opposite-mode process and other gate contexts untouched                                                                             |
| OpenCode supplied-record namespace drift           | `namespace_mismatch`             | This session only                                                                                                                                      |
| OpenCode supplied-record unreadable/foreign        | `ownership_unverified`           | This session only                                                                                                                                      |
| Gate context disagreeing cwd                       | `gate_context_restore_failed`    | This session only; siblings' contexts intact and replayed                                                                                              |
| Hook rejected                                      | `post_restore_hook_failed`       | This session only                                                                                                                                      |
| Load failure / post-load catalog miss              | (unchanged row-6/§13 throw path) | This session only — unchanged behavior, asserted never to fall through into the recovery-abort classes                                                 |
| `loadSession` capability absence                   | existing "Session lost" path     | unchanged — kept distinct from every reason code above so tests and operators can tell the classes apart                                               |

Fence lowering around recovery is unchanged in all outcomes (match, violation, restore failure),
and the pool's `finally` release path is untouched.

Native/config/transport failures and shared authorization denials keep their pre-existing handling:
they are NOT recovery-abort classes (`classifyRecoveryFailure()` returns `null` for them), so a
failure after the load still propagates through the isolated per-session throw path asserted above.
Superseded OMP scan-gate rejections are no longer produced and therefore have no reason code.

## 6. OpenCode recovery is unchanged

No gate-context requirement, same cwd-only restore when no options are passed, same
`false`-on-unsupported return, same respond-gate behavior, and the same record-selected
verification rule (now the only rule, since OMP no longer consults ownership). The existing
shared-process resumption suite (`tests/core/session-orchestrator.test.ts`, the resumption cases in
`tests/acp/agent-connector.test.ts`) passes with zero modified OpenCode expectations, and the
default `yolo-switch` + pool-key record passes verification by construction.

## 7. Verdicts, dispositions, and evidence limits

- The pinned-binary verdicts in `docs/OMP_COMPATIBILITY.md` §3 and the seven DECIDED (2026-10-09)
  user dispositions in §1a are unchanged by this document; this recovery contract consumes
  decision 2's post-amendment posture (readiness cancelled; the named hook carries no readiness
  claim).
- **Mock-only evidence.** The tests certify this repository's client-side decisions (verify-first
  for supplied OpenCode contexts, zero-side-effect violations, restore ordering, per-session
  isolation, option-based OMP recovery). They cannot show the pinned OMP binary accepting or
  refusing a load. Design §15 remains user-owned and UNVERIFIED for: "Observe real pool reuse, mode
  separation, crash/restart and history restoration."
- The caller matrix in §0 is certified by mock/recording fixtures in both spawn shapes and both OMP
  modes (`tests/core/omp-pool-modes.test.ts`, `tests/core/session-orchestrator.test.ts`,
  `tests/acp/agent-connector.test.ts`) for the values each caller hands to recovery — never for
  runtime provider behavior. A real reconnect against the pinned binary remains user-owned and
  UNVERIFIED, including whether a real native session restart actually resumes its history.

## Cross-links

- Row 10 (identity record, pool identity, `process_acquired`): `docs/OMP_POOL_MODES.md`
- Row 6 (stable-first selection, cache restoration on reconnect, reasoning): AGENTS.md — "Session
  Model Selection (Stable-First)" and "Reasoning Effort (ACP `thought_level`)"
- Row 3 (spawn-time mode-scoped state roots feeding the namespace formula): `docs/OMP_SPAWN.md`
- Batch decisions and evidence rules: `docs/OMP_COMPATIBILITY.md`, design §10, §13, §15
  (`docs/superpowers/specs/2026-10-06-omp-integration-design.md`)
