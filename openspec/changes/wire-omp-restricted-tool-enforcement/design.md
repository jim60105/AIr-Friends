## Context

Binding inputs are the user decision register, its dated approved-design amendments, 14a's pure decisions, row 12's ownership/resourceGeneration and pinned `emitToolCall` fail-closed semantics. Keep live-origin checks and post-start registry refresh; readiness reset and acknowledgement requirements are cancelled.

Predecessor consumption (no redefinition):

- **14a** (`src/acp/omp/tool-inventory.ts`, `tool-provenance.ts`, `approval-records.ts`, `destructive-decision.ts`): the exported decision vocabulary (`ToolOrigin`, `InputShape`, `RouteSurface`, `RestrictedToolDecision`, the `rejected_*` reason codes, `allow-gated-pending-adapter`, the MCP mechanism-status table, `restrictedToolPolicyGates`) is this change's sole decision source. This wiring is 14a's FIRST runtime consumer; before it lands, the tables are inert. The modules are pure by 14a's contract — the wiring is where observation happens.
- **Cancelled row 13:** removed from the batch. This change registers the synchronous handler slot, attaches the policy body, and owns live registryEpoch observation. It consumes no ReadySignal, readiness state, channel or prompt gate.
- **Row 12** (the trusted-extension tree: `index.ts`, `bootstrap.ts`, `surfaces.ts`, `ownership.ts`, `critical-skills.ts`; `src/acp/omp/discovery-guard.ts`): frozen pre-import decision, owned-module identity, `resourceGeneration`, init-failure→ACP-error observability — consumed read-only; the tree is extended by one sibling module plus the slot attach.
- **P0** (`src/acp/omp/compatibility-contracts.ts`): the `supported | candidate-to-verify | no-supported-mechanism` vocabulary; the pinned readiness evidence that `extensions/runner.ts` `emitToolCall` blocks handler errors/timeouts (the fail-closed execution mechanism this wiring rides) while `extensions/types.ts` offers synchronous handler registration and `getAllTools` source metadata; the absence of any MCP boundary row; the fixture rule (synthetic fixtures labeled, never clearing ledgers).
- **Rows 4/5/8**: sink policy, destructive conformance module, and `recordResetGate` are reached only THROUGH 14a's tables; this change imports none of them directly and edits none.
- **Row 20 (downstream packaging)**: `enforcement.ts` resolves its 14a imports through the image-mapped `_daemon/mod.ts` re-export barrel when running inside `/opt/air/omp/extension` and through the committed `src/acp/omp/*.ts` paths in dev; both branches load byte-identical committed sources. The extension never imports `/app/src` across the boundary at runtime — row 20's D5 extension-dependency-closure decision is normative here (batch-review fix); this change's sibling must keep every 14a import behind the barrel so the install copy + digest set apply unchanged.

Current-state constraint: native approval uses exact tool keys, with no wildcard default-deny. The installed handler supplies execution-time default-deny; its absence does not make native approval equivalent. No readiness handshake or readiness-channel seam is required. If the extension handler is not installed, the pinned non-YOLO native approval mode plus the client ACP policy remain the boundary for ACP-mediated operations; restricted sessions still fail closed on client policy denials. This does not provide the missing restricted capability set or an equivalent native default-deny boundary. `runner.emit` only logs lifecycle-hook errors and does not fail session startup, so extension-load failure remains an accepted residual risk with no client-observable readiness assertion.

## Goals / Non-Goals

**Goals:** synchronously registered slot with attached per-call handler composing 14a decisions against live origin, registryEpoch and resourceGeneration; bounded fail-closed errors, post-start MCP re-admission without elicitation or acknowledgement, restricted-only registration and preserved verdicts with DECIDED dispositions.

**Non-Goals:** no new decision logic, readiness establishment/reset/channel/prompt gate, discovery internals, command canonicalization, LSP disablement, transport adapters, packaging, destructive normalizer, generic elicitation UI, ACP protocol addition, pin change or config/env/Helm field.

## Decisions

### 1. One synchronously registered handler slot and attached body composed from 14a exports

New sibling `enforcement.ts` exports the handler body dispatched by the synchronous slot this change registers in row 12's trusted-module load sequence. Slot/body registration carries no readiness assertion. An installed handler fails calls closed on errors; an absent handler retains the weaker native approval/client ACP fallback and the recorded extension-load risk.

```
ToolCallObservation = {              // assembled fresh per call, never cached
  toolKey, toolName, recordedOrigin, // origin from the live tool-metadata surface (getAllTools-class)
  registryEpoch, resourceGeneration, // wiring-owned registry epoch + row 12 counter, read fresh
  decodedInputShape                  // per pinned schema, handed to 14a's classifier
}
handleRestrictedToolCall(obs) ->
  | { proceed, completingAuthority } // 14a allow-gated/sink-routed/admitted-MCP outcome
  | { block, error: EnforcementError }
EnforcementError = { code, capability?, route?, originCategory?, seam? }  // bounded, static
```

Composition order per call, each step a pure call into 14a: (1) `tool-inventory` decision on (name, origin, input shape) — unknown/unlisted names and named OMP-only surfaces deny here; (2) `tool-provenance` decision on the CURRENT recorded origin + epoch currency — same name from host/workspace/unowned-discovery denies, stale epoch yields the re-observe denial; (3) the alternate-(capability, route) table — internal scheme / config-device / debug / AST / SSH / LSP-adjacent denies even when the ordinary route would allow; (4) destructive-shaped calls go to `destructive-decision` (row-5 conformance verbatim); (5) `approval-records` interpretation runs as an ADVISORY cross-check only — a surviving lower-layer `allow` never short-circuits steps 1–4. `proceed` never means "authorized by this handler"; it means 14a named the completing predecessor authority (row 4 sink, existing command gate via 14c-hardened policy, row 5 all-target pass, MCP client ownership) that the native permission path still has to satisfy. The wiring maintains zero decision tables of its own; `src/acp/omp/tool-enforcement-wiring.ts` exports only composition/ordering data, freshness rules, the error vocabulary, the seam table, and gate values — consumer-visible vocabulary in the `discovery-guard.ts`/`policy-readiness.ts` posture so tests and docs read one artifact.

### 2. Every call, live origin, no one-shot filter

The handler is consulted per call, including mid-session arrivals. Read the current recorded origin from live tool metadata, derive the current registryEpoch from that observation, and read row 12's current resourceGeneration. Cache no origin or decision across calls. A stale epoch or resource generation denies and requires re-observation; startup/name-only snapshots never authorize.

### 3. Bounded fail-closed error shapes, client-observable, non-secret

A blocked call surfaces as the pinned tool-call error (the same observable surface row 12 uses for init-failure ACP errors), carrying one code from the union of 14a's reason vocabulary (`rejected_tool_inventory`, `rejected_tool_provenance`, `rejected_alternate_route`, `rejected_approval_record_survivor`, `rejected_destructive_*`) plus wiring-level codes (`rejected_enforcement_seam`, `rejected_stale_observation`, `rejected_pending_adapter` for 14a's pending-adapter outcomes). Each error names at most: capability id, route surface, origin category, epoch/generation staleness element — static strings from finite enums. NEVER path content, file/argument payloads, model text, credential, token, or secret material (design §13). The client sees an ordinary failed tool call through existing error handling; nothing here feeds the retry-permission-rejection buffer (echoing denials into prompts is row 13's rejected pattern for readiness and stays rejected for policy denials that name seams). Denials remain observable without becoming an elicitation: no `requestPermission()` call, no form, no interactive surface is invoked on any block path.

### 4. Post-start MCP registry-refresh admission: re-invoke, no elicitation, no ack

When operator/client-owned MCP tools register or refresh after startup, advance wiring-owned registryEpoch from live metadata, re-observe provenance per call and invoke 14a's MCP admission on the fresh epoch. Admitted tools proceed only to the completing authority; untrusted or alternate-route refreshes deny. No readiness reset, form elicitation or one-shot acknowledgement is involved.

Rejected alternatives: freezing the admitted-MCP set at startup (violates §7's "registration and refresh… must not bypass"); admitting refreshes on a one-shot ack (violates per-call live-origin); routing refresh admission through `requestPermission()` (turns an already-authorized capability into an interactive interaction — design §5 non-goal).

### 5. Restricted-only registration; YOLO and OpenCode structurally see nothing

The handler body attaches only in the restricted process using row 9's own launch identity. Native-YOLO registers no restricted tool policy and loads no restricted approval records; OpenCode loads no OMP extension. Decision 5's LSP denial in both modes is a separate native config/launch change, not restricted handler registration.

### 6. Seam table: fail closed at every inherited unresolved gate, markers carried

`enforcement-seams.ts` (data) + the wiring module's `enforcementWiringGates` export enumerate each inherited seam, its source verdict verbatim, and the handler's fail-closed behavior at it:

| Seam                                   | Inherited verdict (verbatim source)                                                         | Handler behavior                                                                                                                                                                | Marker on block             |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| MCP admission mechanism basis          | `needs-mechanism-audit` / `candidate-to-verify`; P0 ledger has NO MCP boundary row (14a §7) | Admission decision runs and can pass/fail per 14a; the mechanism BASIS never inflates: exported status stays audit-needed in every code path and document                       | `seam: mcp-admission-basis` |
| Cancelled readiness | `no-supported-mechanism` remains the recorded pin verdict | No readiness signal/channel/state/prompt gate; native non-YOLO approval plus ACP-mediated client policy remain the fallback if handler installation fails, with accepted residual risk | disposition DECIDED |
| Approval-record reset                  | INCOMPATIBLE, folded-overlay survival (P0 via row 8/14a)                                    | Records advisory-only; surviving lower-layer `allow` cannot admit (14a rule enforced at composition step 5 ordering)                                                            | `seam: record-reset`        |
| Destructive-intent decoding            | UNRESOLVED at the pin (P0 via row 5/14a)                                                    | Undecodable/incomplete native-shaped destructive input → row-5 shared fail-closed verdict through 14a; no speculative decoder in the wiring                                     | `seam: destructive-intent`  |
| Network parity adapters                | rows 17–19 not landed                                                                       | 14a's `allow-gated-pending-adapter` blocks at the call (`rejected_pending_adapter`) — fail closed, never silent native transport                                                | `seam: pending-adapter`     |
| Pre-import exclusion / critical skills | unresolved (row 12 gates)                                                                   | Consumed as-is: init failure already fails session setup before any call; wiring adds no second claim                                                                           | gate data only              |

Each inherited verdict is preserved independently from its DECIDED user disposition. Settings-discovery-path control replaces reset reliance; the complete ACP-mediated destructive path remains the boundary and incomplete native shapes deny. MCP basis remains audit-needed; pending adapters deny. Synthetic fixtures never certify handler installation or clear a native verdict. No readiness handshake or readiness-channel seam is required. If the extension handler is not installed, the pinned non-YOLO native approval mode plus the client ACP policy remain the boundary for ACP-mediated operations; restricted sessions still fail closed on client policy denials. This does not provide the missing restricted capability set or an equivalent native default-deny boundary. `runner.emit` only logs lifecycle-hook errors and does not fail session startup, so extension-load failure remains an accepted residual risk with no client-observable readiness assertion.

### 7. Tests validate wiring decisions only

`tests/acp/omp-tool-enforcement-wiring.test.ts` (+ refresh/error-shape suite): a denied-tool fixture (unlisted name, wrong-origin same-name, alternate-route pair) reaches the fail-closed `EnforcementError` with its bounded code and no secret fields; live-not-cached provenance proven by mutating the registry fixture between two identical calls and observing the decision change (a cached-decision implementation fails this test); post-start refresh re-admits an owned-MCP tool on the fresh epoch and rejects an untrusted refresh, with zero elicitation calls asserted; stale-epoch and stale-generation fixtures deny re-observe; `allow-gated-pending-adapter` blocks; destructive undecodable fixture returns the row-5 fail-closed verdict verbatim (14a replay preserved); YOLO-process fixture registers no handler and OpenCode flow loads no extension handler; every seam fixture fails closed carrying its marker while `enforcementWiringGates` still reports every inherited verdict verbatim after all tests pass. Negative assertions frozen: no test asserts the native binary invoked the handler, honored a block, enforced inventory, performed record reset, or decoded destructive intent; row 4/5/14a suites run unchanged to prove read-only consumption.

Rejected alternative: a connector-side mock asserting "handler ran in the native process" — that is exactly the fabricated native evidence P0 §fixture-rule and design §15 forbid; runtime handler invocation stays on the user checklist.

## Risks / Trade-offs

- **Wiring misread as native enforcement:** mock decisions never prove installation or native callback coverage; retain the accepted absence-of-handler risk and unverified runtime checklist.
- **Origin observation could be staler than true registry state** → per-call fresh reads plus 14a's stale-epoch re-observe denial bound the window; the observation surface itself is part of the user's runtime verification; residual native-timing risk documented, not hidden.
- **Slot/body attachment:** this change owns both in the synchronous load sequence; no removed row-13 prerequisite or readiness assertion.
- **Composition-order bugs could let an advisory record or pending-adapter row leak an allow** → ordering is data in `tool-enforcement-wiring.ts`, asserted by table-driven tests including step-5 non-short-circuit and pending-adapter block fixtures.
- **Error text could leak payload/secret** → error fields are finite static enums, tested for absence of free-text fields; row 12's bounded-diagnostic posture reused, not re-invented.
- **Shared-file exposure:** new sibling modules plus row 12 tree slot attachment, serial before packaging; docs/CHANGELOG append-only.

## Migration Plan

The change becomes the installed restricted execution-time decision boundary without a readiness gate. OpenCode has no extension and YOLO has no restricted handler. Rollback detaches the handler and retains the weaker pinned non-YOLO native approval/client ACP boundary with the recorded residual risk; no configuration or state migration is introduced here.

## Open Questions

No readiness mechanism is awaited. Pending network adapters continue to block until their owning changes land; MCP basis and runtime handler observations remain honestly unverified.
