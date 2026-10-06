## Context

See `proposal.md` — Why. Binding inputs: approved design §7 "Readiness and registry changes" (synchronous handler install at module load, per-session readiness false, lifecycle failure/timeout/partial init leaves restricted execution blocked, `session/new`/`session/load` alone is not a certificate, client-observable result for the exact current ACP session + process instance, authenticated with process/session-scoped material, never the raw platform or Skill API server secret, never chat-assertable, startup failure ends the session with no unguarded fallback, live-origin check on every restricted call, operator MCP registration/refresh after startup must not bypass, reset on recovery + re-verify, no reuse of a prior process instance's acknowledgement), §10 step 5 (readiness before normal prompting, after gate-context registration), §13 (failure denies before the protected side effect; bounded diagnostics without secrets), §5 (a form-elicitation interaction is not required to execute an authorized capability; D6 keeps YOLO native and unclamped), and P0's pinned verdict at OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.

P0 verbatim, consumed unchanged and never softened:

> **Policy readiness** — `extensions/types.ts` exposes synchronous handler registration, `tool_call`, context session manager and source metadata through `getAllTools`. `extensions/runner.ts`: `emit` reports lifecycle errors/timeouts without making session creation a readiness certificate; `emitToolCall` does explicitly block handler errors/timeouts. **Partial support, overall unresolved: trace native ACP ID to extension identity on both new/load and identify a supported narrow authenticated control channel. Do not invent `policyReady` ACP notifications, rely on chat text, or assume thrown `session_start` rejects the native session.**

Predecessor consumption (no redefinition): P0's `ReadinessContract` field set; row 4's `SessionGateContext` and per-session gate/`gateYolo` surfaces (read-only, restricted-flag read only); row 9's `--trusted-extension` launch posture and `src/utils/omp-paths.ts` constants; row 10's mode-resolved-before-acquisition and `ActiveSession.permissionMode`/`processNamespace`; row 11's `reconnectAndResumeSession(..., { gateContext, onGateContextRestored })` shape plus its tested isolation contract and its `readiness_rejected` reason code; row 12's module tree (`bootstrap`/`surfaces`/`ownership`/`critical-skills`), frozen pre-import decision, `resourceGeneration`, init-failure→ACP-error observability.

## Goals / Non-Goals

**Goals:** One restricted-session readiness state machine whose default and every failure path is NOT READY; a bounded, authenticated readiness SIGNAL produced inside the row-12 module and consumed by the connector/client; a client prompt gate that denies the first normal prompt of an unready restricted OMP session with a bounded ACP-visible diagnostic; reset/re-verify over new/load/recovery/post-start-registry-refresh/respawn; machine-readable evidence of which mechanism tiers are supported versus unresolved.

**Non-Goals:** No restricted tool inventory, provenance default-deny, alternate URI/device blocking, or destructive wiring (row 14) — this change ships the signal the policy attests to, never the policy. No pre-import exclusion or critical-skill selection logic (row 12, landed). No LSP (row 15), transport (17–19), packaging/install (20). No gate-context registration/restore semantics change (rows 4/11), no pool-key/lease change (row 10), no launch-flag change (row 9). No human approval/elicitation/form UI, no new ACP method or notification name, no pin change, no native patch or fork, and no claim that any mock shows the official binary emitting, verifying, or enforcing readiness.

## Decisions

### 1. State keying: `(processInstanceId, acpSessionId)`, default false, never portable

One entry per pair, in a table owned by the connector that owns the connection:

```
ProcessInstanceId = { generation: <connector-allocated, strictly increasing per connection establishment>,
                      pid?: <observed child pid, diagnostics only>,
                      poolEntry: <row-10 mode-composed entry identity, diagnostics only> }

RestrictedReadinessState = {
  processInstanceId, acpSessionId, mode: "restricted",
  ready: false,                       // initialization value; only D2/D3 can set true
  handlerInstalled: false, lifecycleInit: "pending"|"ok"|"failed"|"timeout",
  policyRevision, registryEpoch, resourceGeneration,   // row-12 surfaces, consumed
  challenge: <fresh per-establishment nonce>, establishedFor?: ProcessInstanceId
}
```

`generation` is allocated by the connector when a connection is established, so a respawn (crash reconnect, reclaim, per-spawn) yields a new value and every prior establishment's `establishedFor` mismatches. `pid` alone is rejected as the identity (pid reuse), and the pool entry is diagnostics only — readiness is never read from or written to the pool entry (row 10's fields are consumed read-only, never reinterpreted). Native-YOLO and OpenCode sessions get no entry at all (D7). Table entries are dropped on session cleanup and on process-instance retirement.

### 2. The module-side readiness SIGNAL (not the policy)

Inside the row-12 tree, a new sibling module (row 14 registers its handler in the same tree later) performs, at trusted-module load time and synchronously, exactly one thing this change owns: register the restricted `tool_call` enforcement-handler SLOT through the pinned synchronous registration surface, then publish the signal:

`ReadySignal = { processNonce, acpSessionRef, restricted: true, handlerInstalled, lifecycleInit, policyRevision, registryEpoch, resourceGeneration, errorClass? }`

- The SLOT carries no policy content; row 14 fills it. A signal with `handlerInstalled: false` is structurally unable to become `ready` anywhere downstream.
- `registryEpoch` bumps whenever the live tool registry's identity/provenance set changes — including operator MCP registration/refresh after startup, which is exactly the "must not bypass" case in §7. The bump is derived from row 12's event surfaces and the pinned source-metadata observation (`getAllTools`), never from chat content, and never from a name-only comparison.
- `resourceGeneration` is row 12's counter; this change reads it for staleness and does not define a second generation.
- Lifecycle failure surfaces per the pinned semantics: `emit` reports lifecycle errors/timeouts (that is the failure SIGNAL — the pinned runner does not make session creation a certificate), while `emitToolCall` blocks handler errors/timeouts (that is execution-time fail-closed). The signal classifies `lifecycleInit` as `failed`/`timeout` and `ready` stays false in both cases; a thrown `session_start` is NOT assumed to reject the native session (P0) — the client's own denial (D4) is what ends the session.

### 3. Authentication and identity binding: three honest tiers, one adapter seam

The client-facing establishment is an adapter seam, not an invented wire protocol:

```
ReadinessChannel.requestEstablish({ acpSessionId, processInstanceId, challenge })
  → Promise<ReadinessEstablishment | NotReady>
ReadinessEstablishment = validated against P0's ReadinessContract fields:
  { processInstance, acpSessionId, restrictedMode, challenge, policyRevision,
    registryEpoch, controlChannelEvidence, identityBinding }
```

Per-mechanism status, taken from the pinned ledger rather than inferred:

| Element | Status at pin | Basis |
| --- | --- | --- |
| Synchronous handler registration during module load; lifecycle error/timeout reporting; tool-call blocking on handler error/timeout | `supported` | P0's observed `extensions/types.ts` / `extensions/runner.ts` evidence — the SIGNAL and fail-closed semantics are implementable |
| Native ACP session ID → extension identity binding, on BOTH `new` and `load` | `candidate-to-verify` | P0: "trace native ACP ID to extension identity on both new/load" — the context session manager is reachable but the mapping is untraced |
| A narrow authenticated control channel with authority independent of model/workspace content | `no-supported-mechanism` at the pin (P0's "identify a supported narrow authenticated control channel" is unfulfilled) | No source-backed channel found; the seam ships unimplemented, so every real establishment returns `NotReady` |

Credential rules (P0, enforced by the validator): process/session-scoped material only — a per-process nonce generated by the connector at connection establishment and a per-establishment challenge. The raw platform token and the raw Skill API server secret are NEVER acceptable authenticators and the validator rejects any evidence citing either; the Skill API shared secret is never placed in a file or environment variable the model or native tooling can read (P0: shared secret in model-visible files/env is not authentication evidence). Chat content is never an input: no prompt text, tool title, `session_update` payload, or model-generated string can set, advance, or renew readiness — the validator has no code path from ACP content fields to `ready`.

Consequence stated plainly: while the control channel remains unresolved, the seam yields `NotReady` for every real restricted session, so the client gate denies. That is the fail-closed posture, not a bug to route around; §7 of `docs/OMP_READINESS.md` carries the user-decision options.

**Alternatives considered and rejected:** inventing a `policyReady` ACP notification or any other custom ACP method (P0 bars it; ACP SDK `0.14.1` has no such method); a readiness-bearing file in the mode-scoped state directory or an env/nonce file (model/native-readable, forgeable, P0-barred); chat- or tool-title-asserted readiness; piggybacking on the permission-request path (would make an already-authorized capability depend on an interactive interaction, a design §5 non-goal, and would be chat-adjacent); assuming a thrown `session_start` rejects the native session (P0 explicitly bars the assumption); a `--session-id`-style launch argument (row 9's launch is fixed and per-session arguments cannot bind a pooled connection's many sessions).

### 4. Client prompt gate placement and denial behavior

The gate is one decision call on the first NORMAL prompt of a restricted OMP session, positioned exactly at §10 step 5 — after `setSessionGateContext()` registration (row 4) and after model/reasoning application (row 6), before `connector.prompt()` in the normal message/lurk/spontaneous/self-research/summary/maintenance paths. Decision table (pure, in `src/acp/omp/policy-readiness.ts`):

| Inputs | Decision |
| --- | --- |
| agent type ≠ `omp` (OpenCode) | gate not applied — today's flow unchanged |
| `omp` + resolved mode `native-yolo` (row 10's field) | gate not applied (design D6: no restricted policy exists to be ready) |
| `omp` + `restricted` + entry `ready: true` for this exact `(processInstanceId, acpSessionId)` | proceed |
| `omp` + `restricted` + any other state, including `pending`, `failed`, `timeout`, stale `establishedFor`, stale `registryEpoch`/`resourceGeneration`, missing entry | DENY |

Denial: the session's run ends through its existing per-session error handling with the bounded reason code `readiness_rejected` (row 11 already enumerated it for recovery), a static bounded message naming the failing element (e.g. `policy readiness not established: control channel (no-supported-mechanism)`), containing no credential, secret, token, path, or user content. There is deliberately NO fallback path: no unguarded/extensionless process, no OpenCode substitution, no YOLO promotion, no retry against the readiness gate, and no prompt re-issue. The denial is NOT fed into the retry-prompt permission-rejection section — that buffer exists for policy denials the model can correct, and echoing readiness failure into the prompt would invite content-level assertion attempts. Later prompts on an already-verified `(processInstanceId, acpSessionId)` reuse the verified state until a D6 reset occurs; they never re-derive readiness from prior prompt success.

### 5. `session/new` / `session/load` success is explicitly not readiness

`createSession()` and `reconnectAndResumeSession()` return session ids / `true` exactly as before; neither path writes `ready: true`, and readiness state is (re)initialized to false when either succeeds. A test asserts the assertion itself: a fully successful new/load with a ready-fixture still requires an independent establishment before the gate opens.

### 6. Reset and re-verify matrix (reuses row-12 surfaces)

| Transition | Action |
| --- | --- |
| trusted-module load | initialize table entries to `ready: false`, `handlerInstalled` per signal |
| `session/new` | new entry → false |
| `session/load` / crash-reconnect recovery | false, then re-verify via row 11's `onGateContextRestored` hook (attached, never relocated); rejection fails only that session |
| connection established / respawn / pool reclaim | new `ProcessInstanceId`; any establishment whose `establishedFor` differs is unusable |
| post-start operator MCP registration or tool-registry refresh | `registryEpoch` bump from the module signal → `ready: false` → re-verify before the next prompt |
| skill/registry resource-generation change (row 12) | stale generation → not ready |
| lifecycle error/timeout/partial init | `lifecycleInit` non-ok → not ready, persistently until a fresh establishment on the same instance succeeds |

No transition is a one-shot startup acknowledgement: verification is a state lookup plus freshness checks (challenge freshness, epoch currency, identity binding) performed by the pure decision module, so the gate cannot be satisfied by "we acked readiness at startup".

### 7. YOLO exemption and OpenCode non-regression

Native-YOLO OMP sessions carry no readiness entry, no prompt gate, and no added denial (D6); the exemption is a mode-field read, not an inference from process contents. OpenCode is byte-unchanged in flow and state (no new fields, no new prompts, no new denials). Both are pinned by consumer-visible tests rather than by comments.

### 8. Tests validate decisions and the signal contract only

`tests/acp/omp-policy-readiness.test.ts` plus existing connector/orchestrator/recovery suites cover: deny-until-ready on restricted new and load; allow when a labeled synthetic ready-fixture establishes readiness for the exact tuple; reset-on-MCP-refresh; cross-process-instance non-reuse after respawn; lifecycle `failed`/`timeout` and partial-init blocked; native-YOLO exemption; OpenCode unaffected; forbidden-authenticator rejection (platform token / Skill API secret / chat-asserted); stale epoch/generation rejection. Every allow-path fixture is labeled synthetic and kept out of the pinned evidence statements; the unresolved gate stays open in every test outcome, and no test asserts the native binary emitted, verified, or honored anything.

## Risks / Trade-offs

- **Fail-closed default means restricted OMP sessions cannot prompt while the channel is unresolved** → stated as the intended security posture, surfaced in the docs with the two honest user-decision options (adopt a source-backed channel at a future pin through an explicit decision + P0 revision, or keep restricted OMP unavailable); never mitigated by loosening the gate.
- **Candidate channel could be forgeable by same-process native code** → recorded as residual risk on the `candidate-to-verify` tier: until the identity binding and channel authority are source-verified, in-process native code's reach to channel material is unproven, so a candidate channel cannot be adopted silently.
- **Pooled process serves several ACP sessions** → state keyed per session with the shared process instance; row 10's lease keeps one session in flight, and session cleanup drops only its own entry (a sibling's verified state is never cleared or reused).
- **Registry-epoch churn could cause repeated denials** → the epoch changes only on an identity/provenance change (not on presentation updates), each reset logs one bounded diagnostic, and re-verification is a cheap state check; operator MCP refresh remains admitted by row 14's policy rather than by readiness bypass.
- **Signal could be mistaken for policy enforcement** → the SLOT is policy-free by construction, the requirement text says "signal, not policy", row 14's requirement owns the content, and docs repeat that mock evidence proves decision logic only.
- **Shared-file churn** (`client.ts`, `agent-connector.ts`, `session-orchestrator.ts`) → edits confined to the readiness call sites and the hook attach, batch order enforced, one integration owner.

## Migration Plan

Additive and inert in normal deployment: OpenCode deployments see no new code path (the gate is agent-type-scoped), and the OMP path cannot run before row 9's fail-closed spawn, row 12's module, and row 20's installed binary exist. Rollback reverts one commit; no configuration, data, or state migration exists to unwind.

## Open Questions

- Which candidate transport (if any at a future pin) can carry the establishment with authority independent of model/workspace content — deferred to the user decision plus P0 revision; the seam signature is fixed here so no later answer changes this change's task breakdown.
