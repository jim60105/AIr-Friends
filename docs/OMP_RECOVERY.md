# Mode-Owned ACP Session Recovery

This document is the recovery contract for `restore-mode-owned-acp-sessions` (batch row 11):
what a resumed ACP session is bound to, what is verified before anything is torn down, what is
restored afterwards, and what a recovery failure is allowed to touch. It consumes row 10's
acquisition-time ownership record (`docs/OMP_POOL_MODES.md`) and row 6's session-config restore
logic (AGENTS.md, "Session Model Selection (Stable-First)" / "Cache Restoration on Reconnect");
it changes neither.

Implementation surfaces: `src/acp/recovery-ownership.ts` (pure verdict helper),
`AgentConnector.reconnectAndResumeSession()` in `src/acp/agent-connector.ts` (verify → respawn →
load → config tail → gate-context restore → hook), and the two pooled recovery call sites plus the
failure classification in `src/core/session-orchestrator.ts`.

## 1. Recovery contract — recorded context is the target

Recovery never re-resolves the permission mode and never picks a different process. The values
recorded at acquisition are the TARGET of verification, consumed read-only (row 10: the ownership
fields "SHALL NOT be mutated by later per-session activity"; their recovery interface is read-only
consumption).

| Recorded input                   | Source                                                                        | Recovery use                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ActiveSession.permissionMode`   | row 10 acquisition (`process_acquired`)                                       | Expected ownership mode; mismatch in EITHER direction is a violation                                                 |
| `ActiveSession.processNamespace` | row 10 acquisition (mode-scoped omp state root / pool-key OpenCode data root) | Expected namespace; derived again ONLY from the connector's own factory-produced `agentConfig.env`, never recomputed |
| Session cwd                      | orchestrator pooled runner (`sessionCwd`)                                     | Passed positionally; a supplied `gateContext.cwd` must agree or restore fails closed                                 |
| Operator MCP definitions         | `clientConfig.mcpServers` at the call site                                    | Passed to the respawn unchanged                                                                                      |
| Resolved reasoning effort        | row 6 `resolvedReasoningEffort` (same value as session setup)                 | Threaded through `opts.reasoningEffort`; `default`/empty keeps the no-op semantics                                   |

Ordering inside `reconnectAndResumeSession` (also asserted by the post-connect re-check):

1. **Verify ownership FIRST** — before `disconnect()`, before any spawn, load, or gate-context
   mutation. `actual` is derived from the connector's own options env (`PI_CODING_AGENT_DIR` /
   `TMPDIR` / `XDG_DATA_HOME` for OMP, the pool-key data root for OpenCode — the same
   factory-produced env row 10 recorded from, so there is exactly one namespace formula:
   `src/utils/omp-paths.ts` via the factory).
2. `disconnect()` → `connect()` on the connector's OWN options — a same-mode respawn is asserted by
   step 1, not re-selected; recovery never asks the pool for a new entry.
3. Post-connect invariant re-check of the freshly spawned env (assertion; the values are
   reconstructed from the same options).
4. `session/load` (capability absence keeps the existing "loadSession not supported … Session lost"
   path — that string stays reserved for genuine capability absence).
5. Row-6 config tail (see §2).
6. Full gate-context restore (see §3).
7. `onGateContextRestored` hook, if supplied (see §4).

### Verdicts and both violation directions

`verifyRecoveryOwnership(recorded, actual)` (`src/acp/recovery-ownership.ts`) returns
`match | mode-mismatch | namespace-mismatch | unverified`. OMP: an absent/incomplete record is
`unverified` and fails closed — recovery without provenance cannot prove same-mode. OpenCode: a
matching `yolo-switch` + pool-key data-root record is `match`, and an ABSENT OpenCode record is
also `match` (today's behavior preserved byte-identically).

Both cross-mode directions are ownership VIOLATIONS, never a fallback:

| Direction                                                            | Outcome                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| restricted recovery context holding a `native-yolo`-owned session id | `RecoveryOwnershipError` (`ownership_violation`), zero side effects                            |
| `native-yolo` context holding a restricted-owned id                  | same — no opposite-mode resume, no fresh opposite-mode process, no "Session lost" string reuse |

Pinned verdict → bounded reason-code mapping (single source of truth
`mapOwnershipVerdictToReason`): `mode-mismatch → ownership_violation`,
`namespace-mismatch → namespace_mismatch`, `unverified → ownership_unverified`. Messages carry the
session id, expected/actual mode, and expected/actual namespace only — no MCP env/headers, no
secrets.

A violation performs NO disconnect, NO spawn, NO `session/load`, NO gate-context mutation. The
possibly dead-but-connected entry is left for the existing pool reclaim/drain paths; deliberately
not killing it is what keeps a violation from disturbing the opposite mode.

## 2. Config restore is pure row-6 consumption — never forked

After a successful load the sequence is exactly row 6's as shipped: refresh the canonical cache
from the load response's `configOptions`, reapply the prior model stable-first (a post-load catalog
miss propagates and fails THIS session in isolation, no unstable second chance), then reapply
reasoning effort best-effort — only because row 11 now supplies `opts.reasoningEffort`, so a crash
no longer silently loses reasoning configuration. Every reasoning outcome stays non-fatal. This
change adds NO matching, flattening, casing, or cache-refresh code: `src/acp/session-config.ts`
has zero diff in this change.

Note for pooled OpenCode: reasoning reapplication rides row 6's stable-first config-options path;
when the agent advertises no `thought_level` option it remains the documented best-effort no-op
(same semantics as session setup), and the orchestrator-side reasoning RPC activation ordering
(`setSessionConfigOption` after model, before prompt) is unchanged.

## 3. Gate-context restore — no fallback context for an unknown session id

The orchestrator passes the FULL `SessionGateContext` the session was registered with (`cwd`,
`yolo`, `canWriteAgentWorkspace`, `allowedWriteExtensions`) as `opts.gateContext`:

- Supplied context whose `cwd` disagrees with the recovery cwd → `GateContextRestoreError`, no
  mutation.
- Supplied (or agreement-cached) context is restored for the RECOVERED session id via the existing
  `setSessionGateContext` merge, AFTER the load/config tail and BEFORE success — so it also
  survives later `connect()` replays.
- No context supplied AND none cached for that id (e.g. a fresh connector from row 10's liveness
  re-spawn) → fail closed as `gate_context_restore_failed`. The session NEVER resumes on the
  process-frozen client flags or another session's cached context.
- Other sessions' cached contexts: replay logic unchanged, never rebound.

When no recovery context at all is supplied (legacy/OpenCode call sites — no `opts.ownership`, no
`opts.gateContext`), the method keeps its exact pre-row-11 behavior: cwd-only restore tail, byte-identical
OpenCode recovery.

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
calls `disconnect()`/`cancel()` from the recovery path:

| Failure                                  | Reason code                      | Blast radius                                                                                                                                           |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-mode ownership                     | `ownership_violation`            | This session only; opposite-mode process and other gate contexts untouched                                                                             |
| Namespace drift                          | `namespace_mismatch`             | This session only                                                                                                                                      |
| OMP provenance record missing/incomplete | `ownership_unverified`           | This session only (record-loss loses the session — accepted: one lost session is strictly safer than loading a restricted history into a YOLO process) |
| Gate context absent or cwd-disagreeing   | `gate_context_restore_failed`    | This session only; siblings' contexts intact and replayed                                                                                              |
| Hook rejected                            | `post_restore_hook_failed`       | This session only                                                                                                                                      |
| Load failure / post-load catalog miss    | (unchanged row-6/§13 throw path) | This session only — unchanged behavior, asserted never to fall through into the recovery-abort classes                                                 |
| `loadSession` capability absence         | existing "Session lost" path     | unchanged — kept distinct from every reason code above so tests and operators can tell the classes apart                                               |

Fence lowering around recovery is unchanged in all outcomes (match, violation, restore failure),
and the pool's `finally` release path is untouched.

## 6. OpenCode recovery is unchanged

No ownership requirement, no gate-context requirement, same cwd-only restore when no options are
passed, same `false`-on-unsupported return, same respond-gate behavior. The existing shared-process
resumption suite (`tests/core/session-orchestrator.test.ts`, the resumption cases in
`tests/acp/agent-connector.test.ts`) passes with zero modified expectations, and the default
`yolo-switch` + pool-key record passes verification by construction.

## 7. Verdicts, dispositions, and evidence limits

- The pinned-binary verdicts in `docs/OMP_COMPATIBILITY.md` §3 and the seven DECIDED (2026-10-09)
  user dispositions in §1a are unchanged by this document; this recovery contract consumes
  decision 2's post-amendment posture (readiness cancelled; the named hook carries no readiness
  claim).
- **Mock-only evidence.** The tests certify this repository's client-side decisions (verify-first,
  zero-side-effect violations, restore ordering, per-session isolation). They cannot show the
  pinned OMP binary refusing a cross-mode load. Design §15 remains user-owned and UNVERIFIED for:
  "Observe real pool reuse, mode separation, crash/restart, history restoration, and cross-mode
  ownership rejection."

## Cross-links

- Row 10 (ownership record, pool identity, `process_acquired`): `docs/OMP_POOL_MODES.md`
- Row 6 (stable-first selection, cache restoration on reconnect, reasoning): AGENTS.md — "Session
  Model Selection (Stable-First)" and "Reasoning Effort (ACP `thought_level`)"
- Row 3 (spawn-time mode-scoped state roots feeding the namespace formula): `docs/OMP_SPAWN.md`
- Batch decisions and evidence rules: `docs/OMP_COMPATIBILITY.md`, design §10, §13, §15
  (`docs/superpowers/specs/2026-10-06-omp-integration-design.md`)
