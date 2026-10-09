## Why

The restricted boundary requires a synchronously installed `tool_call` enforcement handler that decides every restricted call against live tool origin, registry epoch, and resource generation. The decision register cancels readiness and removes row 13 from the batch. This change owns synchronous handler-slot registration and attachment in row 12's trusted-extension tree and is the first runtime consumer of 14a's pure inventory, provenance, alternate-route, record, destructive, and MCP admission decisions. Pinned `emitToolCall` errors/timeouts fail the call closed; lifecycle `runner.emit` errors do not fail startup. No readiness handshake or readiness-channel seam is required. If the extension handler is not installed, the pinned non-YOLO native approval mode plus the client ACP policy remain the boundary for ACP-mediated operations; restricted sessions still fail closed on client policy denials. This does not provide the missing restricted capability set or an equivalent native default-deny boundary. `runner.emit` only logs lifecycle-hook errors and does not fail session startup, so extension-load failure remains an accepted residual risk with no client-observable readiness assertion.

## What Changes

- **Handler-slot attachment:** synchronously register the policy-free slot and attach `enforcement.ts` in row 12's trusted-extension module-load sequence. Compose only 14a's decision exports on each restricted call; do not fork policy decisions.
- **Consulted on EVERY restricted tool call, not a startup filter**: the handler runs per call including tools that appear mid-session (dynamic registrations, recovery re-discovery); there is no one-shot filtered registry snapshot, no path by which a call bypasses the decision, and a handler error or timeout fails the call closed (the pinned `emitToolCall` fail-closed semantics carry the denials).
- **Denied calls yield a fail-closed, bounded, non-secret-leaking error** observable to the client through the pinned tool-call-error surface: one bounded machine-readable reason from 14a's vocabulary (`rejected_tool_inventory`, `rejected_tool_provenance`, `rejected_alternate_route`, `rejected_approval_record_survivor`, `rejected_destructive_*`) or a wiring-level `rejected_enforcement_seam`, naming capability/route/origin category/fixture-class never file content, never credential, secret, token, or raw tool payload.
- **Post-start MCP registry-refresh admission without elicitation or one-shot ack**: when operator/client-owned MCP tools register or refresh AFTER startup, the wiring advances the registry epoch from the live tool-metadata observation, re-observes provenance (stale-epoch records deny), and re-invokes 14a's MCP-admission decision for the fresh epoch — no generic human-elicitation/form UI (design §3 non-goal), no one-shot acknowledgement. Refreshed tools that fail admission stay denied; freshness depends on the current registry epoch and resource generation only.
- **No restricted handler wired for native-YOLO sessions**: the handler body is registered/consulted ONLY in the restricted process; the native-YOLO launch (row 8/9's yolo overlay, no `--trusted-extension` restricted policy) registers no restricted `tool_call` policy, and OpenCode loads no extension at all.
- **Honest decided dispositions:** readiness signal cancelled by user decision; no readiness state or channel is consumed. Preserve MCP `needs-mechanism-audit`/`candidate-to-verify`, record-reset INCOMPATIBLE and destructive-intent UNRESOLVED inherited verdicts. The register records DECIDED settings-discovery-path control and the complete ACP-mediated destructive boundary, with native incomplete shapes denied. Mock fixtures never clear or relabel verdicts.
- **Unit/mock tests validate the WIRING decisions only**: a denied-tool fixture reaches the fail-closed bounded error; provenance is consumed LIVE (a registry mutation between calls changes the decision — no caching); post-start refresh re-admits on fresh epoch and rejects untrusted refreshes; the YOLO process registers no handler; OpenCode has no extension handler; every seam-fixture fails closed with its marker. Tests NEVER assert or imply that the native OMP binary invokes the handler, honors a denial, or enforces anything — real-runtime handler invocation stays on the user's checklist (design §15).
- Explicit non-goals: decision tables (14a), pre-import discovery/critical skills (row 12), command-path canonicalization (14c), LSP disablement (P5d), transport adapters, packaging, destructive normalizer and new configuration fields. Authenticated readiness, prompt gates and channel seams are cancelled, not deferred.
- No new `config.yaml`, `.env`, or Helm field: every input is 14a module output, row 12 ownership state and wiring-owned registry observations, and the pinned registration/tool-metadata surfaces. `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain intentionally unchanged; if implementation surfaces any new field, this change synchronizes all three itself.

## Capabilities

### New Capabilities

None. Reuse the existing ACP integration capability; the wiring requirements extend it rather than fork a parallel security specification.

### Modified Capabilities

- `acp-integration`: per-call handler attachment and consultation, live provenance, registryEpoch/resourceGeneration freshness, stale-observation denial, bounded errors, post-start MCP refresh admission, restricted-only handler registration, and honest decided dispositions without a readiness handshake. YOLO has no restricted handler; LSP disablement in both modes is owned separately.

## Impact

Eventual implementation owns `enforcement.ts` and its error-shape sibling in row 12's trusted-extension tree, synchronous slot registration/attachment, live registry-epoch observation, `src/acp/omp/tool-enforcement-wiring.ts` composition/freshness/seam data, consumer-visible wiring/refresh tests, `docs/OMP_ENFORCEMENT.md`, tool-policy/permission cross-links and CHANGELOG. No client, connector, readiness module or channel is edited or consumed.

Pinned verdicts remain unchanged; the user register decides their dispositions and supersedes the application hold. No readiness handshake or readiness-channel seam is required. If the extension handler is not installed, the pinned non-YOLO native approval mode plus the client ACP policy remain the boundary for ACP-mediated operations; restricted sessions still fail closed on client policy denials. This does not provide the missing restricted capability set or an equivalent native default-deny boundary. `runner.emit` only logs lifecycle-hook errors and does not fail session startup, so extension-load failure remains an accepted residual risk with no client-observable readiness assertion. Unit/mock fixtures certify wiring decisions only; native handler invocation and provenance observation remain user-owned and unverified.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Predecessor consumption: 14a module exports + table vocabulary, wiring-owned slot/registry-epoch surfaces, row 12 tree structure, pinned `emitToolCall`/`getAllTools` semantics | 0.75 |
| `enforcement.ts` handler body: per-call composition (inventory, live provenance, alternate route, destructive, records), bounded error shapes, mid-session coverage | 1.75 |
| Registry-epoch re-observation + post-start MCP refresh re-admission wiring (no elicitation, no one-shot ack) | 1.00 |
| Restricted-only registration posture + seam fail-closed tables (`tool-enforcement-wiring.ts`) + gate data | 1.00 |
| Consumer-visible unit/mock tests (denied fixture → fail-closed error, live-not-cached provenance, refresh re-admit/reject on epoch, YOLO registers no handler, OpenCode no extension handler, every seam fixture fails closed with marker) | 1.75 |
| `docs/OMP_ENFORCEMENT.md` + `OMP_TOOL_POLICY.md`/`AGENT_PERMISSIONS.md` cross-links + CHANGELOG | 0.75 |
| Applicable focused type/unit checks and OpenSpec verification, no live agents, plus contingency | 1.00 |
| **Total hard ceiling** | **8.00** |

Core is 7.00 hours plus 1.00 embedded checks/contingency. Decision tables (14a), command-path canonicalization (14c), LSP (row 15), transport (17–19), and packaging (20) are owned elsewhere and would exceed this change if attempted. Predecessor proposals naming `enforce-omp-restricted-tool-policy` refer to the pre-split row 14; its pure-decision half (14a) landed and this is its wiring half.

## Batch:

depends-on: define-omp-restricted-tool-decisions
depends-on: enforce-acp-filesystem-authorization
depends-on: normalize-acp-destructive-targets
depends-on: translate-omp-owned-settings
depends-on: guard-omp-executable-discovery
depends-on: establish-omp-compatibility-contracts

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| define-omp-restricted-tool-decisions (14a) | Required predecessor, FIRST runtime consumer | Imports `src/acp/omp/tool-inventory.ts`, `tool-provenance.ts`, `approval-records.ts`, `destructive-decision.ts` read-only as THE decision source; the wiring composes and never forks, re-derives, or re-weights a table row; new decision needs force a 14a table change, never local logic. 14a's modules stay pure — the wiring (and only the wiring) performs observation/IO. No edited-file overlap: 14a's modules untouched. |
| Cancelled row 13 | Removed by user decision | No readiness dependency, signal, prompt gate or channel. This change owns synchronous slot registration and handler attachment plus live registry-epoch observation. |
| guard-omp-executable-discovery (row 12) | Required predecessor, same-module-tree | EXTEND the same tree (sibling module + slot attach); consume `bootstrap.ts` frozen decision, ownership identity, and `resourceGeneration` read-only; never restructure row 12's bootstrap or re-run its decision; row 12's two discovery gates stand. Tree is serial: 12 → this change, before row 20's digest cut. |
| enforce-acp-filesystem-authorization (row 4) | Transitive, read-only | Read/search allow rows delegate to row 4 boundaries through 14a's table; the handler never re-evaluates paths or touches `filesystem-policy.ts`/`SessionGateContext` — read-only import at most through 14a. |
| normalize-acp-destructive-targets (row 5) | Transitive via 14a | Destructive calls route to 14a's `destructive-decision.ts`, which is row 5's conformance consumer; no second normalizer anywhere in the wiring; `destructive-policy.ts` never imported directly by extension code. |
| translate-omp-owned-settings (row 8) | Transitive, gate + posture consumer | Consumes `recordResetGate` (INCOMPATIBLE) verbatim as the reason the handler — not settings-layer records — is operative; the wiring loads no restricted approval records into YOLO and adds no overlay content. |
| establish-omp-compatibility-contracts (P0) | Application gate + evidence consumer | Consumes the status vocabulary, `emitToolCall` fail-closed evidence, and the no-MCP-boundary-row gap verbatim; adds no ledger row, relabels no verdict, and per P0's fixture rule no synthetic allow-fixture here is citable as native support. |
| harden-acp-command-path-gate (14c) | Independent sibling, landed | The `bash` allow row keeps delegating to the common command policy that 14c canonicalized; neither edits the other; the handler performs no path canonicalization of its own. |
| control-omp-url-fetch-transport / adapt-omp-web-search / adapt-omp-public-code-search (17–19) | Successor adapters | 14a's `allow-gated-pending-adapter` outcomes FAIL CLOSED in this wiring until those adapters land (never a silent native transport allow); when they land they complete the route without revisiting 14a's table shape. |
| disable-restricted-agent-lsp (row 15) | Successor | Row 15's native disablement is separate; the handler's LSP denial here is execution-time rejection, never disablement evidence, and implicit-startup coverage is not this change's. |
| package-pinned-omp-runtime (row 20) | Downstream, same-module-tree | Row 20 installs this change's extended tree at the contracted path with checksums; content changes here must land before row 20's digest list is cut; row 20 must not alter the contract. |
| cover-omp-mocked-acp-lifecycle / finish-omp-mocked-skill-handoff (21/22) | Final regression/docs | Row 21 exercises the handler wiring end-to-end across handler/ownership states without duplicating this change's same-path unit cases and without fabricating native enforcement; row 22 extends (never rewrites) `docs/OMP_ENFORCEMENT.md`; zero config sync owed here. |

- Shared-file conflict: row 12's trusted-extension tree is extended serially (12 → 14b, before packaging digests), with synchronous slot registration/attachment owned here. 14a decision modules, discovery ownership and resourceGeneration are read-only. No readiness module, client or connector edit. Permission docs and CHANGELOG remain serial append/cross-link writes.
- Spec-conflict: uniquely named ADDED acp-integration wiring requirements consume 14a decisions and row 12 ownership unchanged; no readiness requirements survive. Decided dispositions never relabel pinned unresolved/incompatible verdicts.
- Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
