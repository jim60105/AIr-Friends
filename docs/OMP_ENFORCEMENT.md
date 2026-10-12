# OMP Restricted `tool_call` Enforcement Wiring (row 16 + C4)

Implements OpenSpec changes `wire-omp-restricted-tool-enforcement` and
`wire-omp-native-extension-api` (C4). Pinned to official OMP v18.6.1 /
commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.

This document describes the WIRING: how the trusted extension registers a
`tool_call` handler through the pinned native `ExtensionAPI` and composes the
row-14a pure decisions per call. It adds
no decision logic of its own — the tables and verdicts live in
[OMP_TOOL_POLICY.md](OMP_TOOL_POLICY.md) (row 14a) and the permission model in
[AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md). Nothing here demonstrates that
the official binary invokes, honors, or enforces anything: that is the
user-owned checklist at the bottom.

## Modules

| Module                                         | Role                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/acp/omp/extension/enforcement.ts`         | Synchronous slot registration + attached handler body + live epoch observer                                                                                                              |
| `src/acp/omp/extension/enforcement-error.ts`   | Bounded error shapes, observation shapes, composition-order data                                                                                                                         |
| `src/acp/omp/extension/_daemon/mod.ts`         | Image-mapped re-export barrel (row 20 D5) — the extension's ONLY 14a import surface                                                                                                      |
| `src/acp/omp/tool-enforcement-wiring.ts`       | Composition point: seam table, pinned mechanism evidence, honesty gates                                                                                                                  |
| `src/acp/omp/extension/native-registration.ts` | C4 native adapter: `api.on("tool_call")` + `api.registerTool(...)` at factory evaluation; fresh `getAllTools()` sourceInfo → canonical provenance with first-sighting freshness captures |
| `src/acp/omp/extension/native-events.ts`       | C4 decoder: pinned `ToolCallEvent` → restricted input (shape selection, destructive payload, empty-hierarchy record evaluation); model-forged authority fields are never read            |
| `src/acp/omp/extension/index.ts`               | Entrypoint: pre-import gate, then the default factory that performs the native registrations                                                                                             |

**Current-pin reality:** the shipped row-12 gate always yields blockers
(native-custom-tool-discovery and plugin-entry-points are P0-unresolved and
pushed unconditionally), so the entrypoint throws BEFORE the default factory
is ever exported in every environment today — the native registrations below
become operative only if the pinned pre-import-exclusion
verdicts ever pass — this is a stronger residual than "extension load might
fail" (checklist item 4) and no wiring test can or does certify a registered
handler in a real process.

## Native registration (C4 correction)

C4 replaced the earlier factory-return/private-slot convention with the real
pinned contract: the loader evaluates the module's default export as a
factory, awaits it, and DISCARDS its return value — the only enforcement
surface the binary honors is what the factory registers synchronously during
its own evaluation through the native `ExtensionAPI`:

- `api.on("tool_call", callback)` — the callback decodes the pinned event
  (`{toolCallId, toolName, input}`) into the restricted input shape, runs
  the same composition, and returns the bounded `{block:true, reason}` on
  denial (preventing dispatch) or `undefined` to continue toward the NAMED
  completing boundary. There is no silently-allow path: an unrepresentable
  event or an internal throw blocks with the `native-event-decode` seam
  marker.
- `api.registerTool(definition)` — the C2 `read` and `web_search`
  replacement definitions, restricted branch only. Native-YOLO and
  unidentified launches register NOTHING (structural exemption).

Production provenance is a fresh `ctx.getAllTools()`-shaped roster
translation (per observation): `extension`-sourced entries are owned only
when their recorded file is the contracted deployment path or this module's
own loaded (C3 single-bundle) file inside the observed base root;
`mcp__`-prefixed `mcp` sources record operator-MCP on the shared epoch
domain; `builtin`/`sdk` record host (never admitted); missing, duplicate
(ambiguous), or unrecognized source data records unowned-discovery and
denies before dispatch. The former empty-registry PRODUCTION default is
removed — an unavailable roster reads every tool unowned and fails closed.
Recorded freshness halves come from the surface's FIRST sighting of each
(name, sourceInfo) spelling; the composition recomputes the current halves
live, so a mid-session same-name foreign replacement or generation bump
reads stale and denies. A trusted acquired-session context (canonical
target resolution + row-4 write-authorization parameters) is injectable
only — the pinned host offers none into the extension child today, so
production destructive-shaped calls fail closed on absent canonical
observations rather than trusting anything the model serialized.

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

| Input                | Read fresh from                                                                                                                                                                                                                                                                                   | Staleness result                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| recorded origin      | live `getAllTools()` roster translation (`createNativeRegistrySurface`/`createNativeLiveObserver`; fixture suites may instead inject the `RegistryEpochObserver` fixture domain)                                                                                                                  | wrong origin → `rejected_tool_provenance`                                                 |
| `registryEpoch`      | the observation domain's own movement counter — production: the roster surface advances it ONLY when the fresh name+sourceInfo roster key moves; the fixture observer advances ONLY on a full-origin snapshot diff (never chat content, never name-only diff, never an event with no observation) | recorded < current (or future) → `rejected_stale_observation` with `stale=registry-epoch` |
| `resourceGeneration` | row 12's frozen session counter (read-only consumer)                                                                                                                                                                                                                                              | observed ≠ current or one-sided → `stale=resource-generation`                             |

Stamping discipline: recorded freshness halves MUST come from the same
observation domain the current halves read from — production stamps are the
roster surface's first-sighting captures, and a cross-domain stamp (e.g.
fixture-epoch bytes in a production record) denies re-observe fail-closed,
never admits.

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

- Registration happens in the default factory (native `ExtensionAPI`) gated
  on the module's OWN launch identity
  (`{baseRoot}/omp-agent/restricted/cwd`). The native-YOLO and
  unidentified branches call `registerNativeYoloNoop`, which registers
  NOTHING and loads no restricted approval records — the exemption is
  structural at the registration site.
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
| network-parity-adapters     | ledger native_transport statuses quoted verbatim (unchanged) | `allow-gated-pending-adapter` consults the route owner's typed completion at the clamp: a completed route + registered owned replacement proceeds to the NAMED replacement boundary (C5); every other case blocks as `rejected_pending_adapter` (`seam=pending-adapter`) |
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
   Since C4 there is no module-local attachment point to inspect: the
   factory's `api.on("tool_call", ...)` call IS the registration; observe
   a real blocked call to prove invocation. Load evidence for the factory
   itself remains limited: the row-12 gate currently throws at module load
   in every environment, and `runner.emit` only logs lifecycle-hook errors,
   so neither tests nor docs here certify that the binary ever evaluated
   the factory.
2. **Real block behavior** — does a blocked call fail closed natively
   (handler error/timeout blocks per `emitToolCall`), with no retry or
   continue?
3. **Live provenance** — does the `getAllTools`-class metadata surface expose
   recorded origins per tool such that origin/epoch observation matches the
   live registry (since C4 the production observer adapter is the
   `native-registration.ts` roster translation; an unavailable roster makes
   every restricted call deny fail-closed)? Recorded
   `registryEpochObserved` stamps must come from the wiring's own observation
   domain — the epoch never retracts, so a foreign stamp denies re-observe
   fail-closed, never admit. Sibling item: the production decoder/assembler
   that delivers `RestrictedToolCallInput` is, since C4, the
   `native-events.ts` decoder: input-shape decode and the destructive
   payload build run natively, but canonical observations and row-4 write
   authorization require the trusted acquired-session context the pinned
   host does NOT acquire into the extension child — until that acquisition
   exists, the owned-extension tier's REQUIRED canonical evidence is
   absent, so even owned-name reads deny re-observe
   (`rejected_stale_observation`, `origin=owned-extension`), destructive-
   shaped calls fail closed at the `complete-awaiting-authorization` seam,
   and URL/search calls never reach the adapter-completion clamp (C5's
   typed completion consumes only calls that have passed live provenance;
   where it applies, absence still blocks `rejected_pending_adapter`); approval
   records stay the empty-hierarchy evaluation (the child observes no
   settings layer). Client-owned MCP admission is the one origin class
   that decides fully on native-registry data alone.
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

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (section B); the numbered items above are expanded there as unverified runtime rows.
