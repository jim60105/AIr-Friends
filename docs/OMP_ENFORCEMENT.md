# OMP Restricted `tool_call` Enforcement Wiring (row 16)

Implements OpenSpec change `wire-omp-restricted-tool-enforcement`. Pinned to
official OMP v18.6.1 / commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.

This document describes the WIRING: how the trusted extension attaches a
`tool_call` handler and composes the row-14a pure decisions per call. It adds
no decision logic of its own — the tables and verdicts live in
[OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md) (row 14a) and the permission model in
[AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md). Nothing here demonstrates that
the official binary invokes, honors, or enforces anything: that is the
user-owned checklist at the bottom.

## Modules

| Module                                       | Role                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/acp/omp/extension/enforcement.ts`       | Synchronous slot registration + attached handler body + live epoch observer         |
| `src/acp/omp/extension/enforcement-error.ts` | Bounded error shapes, observation shapes, composition-order data                    |
| `src/acp/omp/extension/_daemon/mod.ts`       | Image-mapped re-export barrel (row 20 D5) — the extension's ONLY 14a import surface |
| `src/acp/omp/tool-enforcement-wiring.ts`     | Composition point: seam table, pinned mechanism evidence, honesty gates             |
| `src/acp/omp/extension/index.ts`             | Entrypoint: pre-import gate, then the load-time attach call                         |

**Current-pin reality:** the shipped row-12 gate always yields blockers
(native-custom-tool-discovery and plugin-entry-points are P0-unresolved and
pushed unconditionally), so the entrypoint throws BEFORE the attach call
completes and the slot is unregistered in every environment today. Load-time
registration becomes operative only if the pinned pre-import-exclusion
verdicts ever pass — this is a stronger residual than "extension load might
fail" (checklist item 4) and no wiring test can or does certify a registered
handler in a real process.

## Composition order (fixed data; `ENFORCEMENT_COMPOSITION`)

| # | Step                      | Decision source                                    | Notes                                                   |
| - | ------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| 1 | inventory                 | `tool-inventory.ts:decideRestrictedTool`           | default-deny by absence + named surfaces                |
| 2 | provenance                | `tool-provenance.ts:evaluateToolProvenance`        | live origin; consulted inside the same entry decision   |
| 3 | alternate-route           | `tool-inventory.ts:ALTERNATE_ROUTE_BLOCKING_TABLE` | (capability, route) pair screening                      |
| 4 | destructive               | `destructive-decision.ts:decideDestructiveIntent`  | routed-destructive calls only                           |
| 5 | approval-records advisory | `approval-records.ts:interpretApprovalRecords`     | runs LAST: renames a denial's report, never its outcome |

No step is short-circuitable by later input. `proceed: true` never means
"authorized" — it only names the completing predecessor authority.

## Freshness (per call; nothing cached)

| Input                | Read fresh from                                                                                                                                    | Staleness result                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| recorded origin      | live `getAllTools`-class tool-metadata surface (`RegistryEpochObserver`)                                                                           | wrong origin → `rejected_tool_provenance`                                                 |
| `registryEpoch`      | wiring-owned observer; advances ONLY on a full-origin snapshot diff (never chat content, never name-only diff, never an event with no observation) | recorded < current (or future) → `rejected_stale_observation` with `stale=registry-epoch` |
| `resourceGeneration` | row 12's frozen session counter (read-only consumer)                                                                                               | observed ≠ current or one-sided → `stale=resource-generation`                             |

There is no cache to invalidate and no admitted set is ever frozen: a
post-start MCP registration/refresh needs no ack, no reset, and no readiness
signal — the next call simply reads the advanced epoch. `composeFreshProvenance`
pairs the recorded half with the live read at that instant; BOTH-or-NEITHER is
enforced by the provenance decision itself.

## Registry refresh

- Post-start client-owned MCP tool: epoch advances from the live observation;
  the call re-invokes 14a's `decideMcpAdmission` on the fresh epoch. Admission
  proceeds only to `mcp-client-ownership` with `basisStatus`
  `needs-mechanism-audit` — the basis is never inflated.
- Refreshed-untrusted / unowned-discovery tools: stay denied; the refresh
  event grants and softens nothing.
- Stale-after-admission: re-denies; a one-shot acknowledgement is not
  representable in any shape.
- Zero elicitation/form calls exist on any path.

## Bounded error (`EnforcementError` / `formatEnforcementError`)

Finite field set `ENFORCEMENT_ERROR_FIELDS`: `code`, `capability`, `route`,
`originCategory`, `staleElement`, `seam`, `tableRowId` — enum tokens and
table row ids only. No payload, path content, model text, secret, or token
field is representable. Codes = 14a's `RESTRICTED_DENIAL_VOCABULARY` plus the
wiring codes `rejected_enforcement_seam`, `rejected_stale_observation`,
`rejected_pending_adapter`, `rejected_destructive_authorization` (the last
covered by the proposal's `rejected_destructive_*` wildcard — it names the
row-4 authorization-stage denial distinct from 14a's completeness-stage
`rejected_destructive_incomplete`/`rejected_destructive_binding`). Blocks
surface through the pinned tool-call error path (row 12's bounded ACP error
posture) — never `requestPermission()`, never elicitation, never the
retry-permission-rejection buffer (which lives daemon-side in ChatbotClient,
unreachable from this process).

## Restricted-only posture

- Registration happens in the trusted-extension load sequence gated on the
  module's OWN launch identity (`{baseRoot}/omp-agent/restricted/cwd`). The
  native-YOLO and unidentified branches call `registerNativeYoloNoop`, which
  registers NOTHING and loads no restricted approval records — the exemption
  is structural at the registration site.
- The handler entry re-verifies its observed process identity as its first
  statement and fails closed (`rejected_enforcement_seam`, `seam=seam-table`).
- OpenCode flows: the agent factory assembles no `--trusted-extension`
  argument and no `omp-agent` root in either permission mode (pinned by
  `tests/acp/omp-tool-enforcement-wiring.test.ts`).

## Seam dispositions (design §6; `ENFORCEMENT_SEAMS`)

| Seam                        | Inherited verdict                    | DECIDED disposition (handler posture)                                                                                                                          |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mcp-admission-basis         | `needs-mechanism-audit` (14a)        | decision runs per call; basis never inflated                                                                                                                   |
| readiness-cancellation      | row 13 REMOVED by user decision      | no readiness signal/state/channel/handshake anywhere; `runner.emit` load-failure is an accepted residual risk                                                  |
| approval-record-reset       | INCOMPATIBLE (ledger `incompatible`) | records advisory at step 5; survivor renames report to `rejected_approval_record_survivor` with `seam=record-reset`, settings-discovery-path control unchanged |
| destructive-intent-decoding | UNRESOLVED (ledger `incompatible`)   | row-5 consumer verbatim; complete ACP-mediated boundary; observation-absent never proceeds                                                                     |
| network-parity-adapters     | rows 17–19 not landed                | `allow-gated-pending-adapter` blocks as `rejected_pending_adapter` (`seam=pending-adapter`)                                                                    |
| discovery-side-gates        | row 12 gates as shipped              | consumed read-only; no second gate or claim                                                                                                                    |

No status relabel anywhere: every inherited status is quoted from its source
module (`tool-enforcement-wiring.ts` quotes `AUDITED_PINNED_LEDGER` and
`MCP_ADMISSION_MECHANISM_STATUS` directly).

## Configuration

This change introduces ZERO new configuration or environment fields:
`config.example.yaml`, `.env.example`, and `helm/values.yaml` are untouched
by design (tasks 6.2 verified — no implementation surface added any field).

## User-owned runtime checklist (nothing below is certified by tests)

The wiring suites use SYNTHETIC tool observations only. A mock certifies
nothing about the official binary. Verify at runtime, on a real pinned-OMP
install (row 20):

1. **Real handler invocation** — does the official binary actually deliver
   `tool_call` events to the trusted extension's registered handler (pinned
   `extensions/runner.ts` `emitToolCall` / `extensions/types.ts` synchronous
   registration; the exact host-side surface name is candidate-to-verify)?
   `loadTimeEnforcementRegistration` / the factory's
   `restrictedToolCallHandler` field is the synchronous attachment point;
   observe a real blocked call to prove invocation.
2. **Real block behavior** — does a blocked call fail closed natively
   (handler error/timeout blocks per `emitToolCall`), with no retry or
   continue?
3. **Live provenance** — does the `getAllTools`-class metadata surface expose
   recorded origins per tool such that origin/epoch observation matches the
   live registry (production observer adapter wiring is part of this
   checklist; unattached, every restricted call denies fail-closed)? Recorded
   `registryEpochObserved` stamps must come from the wiring's own observation
   domain — the epoch never retracts, so a foreign stamp denies re-observe
   fail-closed, never admit. Sibling item: the production decoder/assembler
   that delivers `RestrictedToolCallInput` (input-shape decode, destructive
   payload with canonical observations, folded row-8 record evaluation) is
   user/downstream-owned — until it exists, no real call reaches the handler.
4. **Extension-load failure** — `runner.emit` only logs lifecycle-hook errors
   and does NOT fail session startup: an extension that fails to load leaves
   the session without the restricted capability set (accepted residual
   risk; NO client-observable readiness assertion exists — row 13 cancelled).
   If the handler is absent, non-YOLO native approval plus the client ACP
   policy remain the boundary for ACP-mediated operations; that fallback is
   NOT equivalent to execution-time default-deny.
5. **Record reset / destructive decoding** — the INCOMPATIBLE/UNRESOLVED
   pinned verdicts stand; do not treat any wiring test as evidence of a
   working reset or a complete native decoder.

Related: [OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md) ·
[AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md)
