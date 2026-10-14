# OMP Restricted Tool Policy (P5c-i / row 14a)

Pure restricted-mode tool-decision modules for the OMP integration. Pinned to
official OMP **v18.6.1** / commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`.

OpenSpec change: `define-omp-restricted-tool-decisions`. The modules are
decision logic only — no IO, no clock, no settings or registry reads inside a
decision. **Nothing in this document or its tests demonstrates native
enforcement, a working approval-record reset, or complete native destructive
decoding**; the trusted-extension `tool_call` handler that consults these
decisions per call is wired by 14b (`wire-omp-restricted-tool-enforcement`),
and the generic-command path canonicalization is 14c
(`harden-acp-command-path-gate`).

Consulted **only in restricted mode**: native-YOLO OMP sessions receive none of
these clamps (their LSP disablement is owned separately, row 17), and OpenCode
flows are byte-unchanged. The runtime consumer is 14b
(`wire-omp-restricted-tool-enforcement`): the trusted extension's native
`tool_call` handler consults these decisions per call in restricted sessions,
registered through the pinned native `ExtensionAPI` (C4). Whether the official
binary ever invokes that handler stays user-owned and UNVERIFIED.

## Modules

| Module                                | Role                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/acp/omp/tool-inventory.ts`       | Entry decision over (tool name, recorded provenance, decoded input shape); machine-readable inventory table + alternate-route pair table + honesty gates |
| `src/acp/omp/tool-provenance.ts`      | Live-provenance admission (authenticated `native-builtin` tuple, owned-extension canonical ownership, operator-MCP ownership + epoch freshness) and the MCP mechanism-status table |
| `src/acp/omp/approval-records.ts`     | Exact-key native approval-record interpretation under the surviving-lower-record reality                                                                 |
| `src/acp/omp/destructive-decision.ts` | Thin consumer of the shared row-5 destructive policy; replays its conformance table                                                                      |
| `src/acp/omp/destructive-ingress.ts`  | ACP client ingress normalizer: canonicalizes configured-OMP native single delete/move `rawInput` into the shared destructive vocabulary before row 5       |

`allow` never means "authorized": every non-deny outcome names the completing
authority (the native-local read/write approval posture, the protected row-4
read boundary, the existing common command policy, the row 5 all-target pass,
the owned transport adapters, or MCP client ownership). Deny reasons come from one bounded
vocabulary: `rejected_tool_inventory`, `rejected_tool_provenance`,
`rejected_alternate_route`, `rejected_approval_record_survivor`,
`rejected_destructive_incomplete`, `rejected_destructive_binding`.

## Restricted inventory table

`RESTRICTED_TOOL_INVENTORY_TABLE` is the machine-readable form (row → inputs →
decision → design-§6 citation). Composition order of `decideRestrictedTool`:
alternate-route pair screening (decoded shape only, rename-invariant) →
structural default-deny by name → provenance admission → the row's delegating
outcome.

| Entry                                                                         | Decision                                            | Completing authority                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`, `list`, `glob`, `grep`, `search`/`find`                               | allow gated                                         | `native-local-read-approval`: fresh authenticated native origin, the supported native activation/approval tier, then the process's own ambient OS permissions. Native scans/content IO are NOT daemon descriptor-bound and no row-4 filesystem confinement is claimed for them (accepted native posture). Pinned note: some native search implementations do not automatically invoke ACP callbacks — the decision binds at the handler (14b), never by assumed callback coverage. URL/device/remote roots are screened out before local dispatch (`remote-url`/`internal-uri-scheme`/`ssh-device` pairs) |
| native `read` URL branch; `webfetch`, `websearch`, `web_search`               | `allow-gated-pending-adapter` (distinct from allow) | Rows 17–18 adapters landed; since C5 (`admit-completed-omp-network-adapters`) 14b consumes the route owner's typed completion — the registered owned replacement on a completed route (search: a supported backend's exact grounding route) proceeds to the NAMED controlled boundary; every other case (incl. `webfetch`, credential-absent) stays failed closed, never letting native unadapted transport run. Capability parity preserved, never deny-parity                                                                       |
| `write` / `edit` (ordinary)                                                   | allow gated                                         | `native-local-write-approval`: the pinned native approval path plus the process's ambient OS permissions. The restricted ACP sink is retained only as the route the pinned bridge applies WHERE IT ROUTES THE CALL (unchanged decision and denial propagation; no added bypass); an absolute native sandbox/plan target and an unavailable client bridge do not reach it and mutate directly — the user-authorized residual risk. No pre-dispatch route gate |
| todo-shaped write (`todoread`/`todowrite` and a `todo`-shaped `write`/`edit`) | in-session state only                               | Session planning state; the outcome carries `filesystemMutationRoute: false` — a todo-shaped write never opens a filesystem mutation route                                                                                                               |
| `bash`                                                                        | allow gated                                         | The EXISTING common command policy (lexical path gate unchanged; 14c owns canonical hardening); the extra native ACP bash permission path stays active                                                                                                   |
| `delete`, `move`, `apply_patch`                                               | routed to row 5                                     | Shared destructive all-target policy (below)                                                                                                                                                                                                             |
| operator/client-owned MCP tools (origin-keyed)                                | routed to provenance                                | Provenance decision + client MCP ownership; MCP is never host-owned                                                                                                                                                                                      |
| `skill` (owned skills, `skill://`-style reads)                                | allow gated                                         | Row 4 trusted-skills read root admitted by shared canonical root identity (canonical path + link-free components + `dev`/`ino` + writable-root disjointness); the daemon callback carries no per-identifier critical metadata, and native skill discovery is upstream-owned |
| every unlisted name                                                           | **default-deny by absence**                         | Structural: `denyByAbsence` — audit omissions fail closed, never open                                                                                                                                                                                    |

Default-deny rows enumerate the named OMP-only execution surfaces outside the
approved capability set with design-§6 citations (never inferred from the
historical handoff YAML list): `eval`, `task`/subagent, `computer`, `browser`,
background/`job`/`async`, `launch`, `debug` (DAP), `ast_edit`/`ast_grep`, `lsp`
and LSP-referenced config, `ssh`, `irc`, `recipe`, `question`, `doom_loop`,
`external_directory`, internal device URI schemes (`xd://`-class), and
config-write devices. Each denies for **every** provenance — no authoritative
origin rescues a named execution surface, and an MCP tool merely wearing such a
name is not an approved client capability.

The `lsp` deny is a decision-layer deny, **not** disablement evidence; native
disablement carriers (both-mode `--no-lsp`, per-agent OpenCode denials) land in
LSP row 17 and still prove neither native server suppression nor implicit-
startup suppression (decision-5 evidence limits; `docs/AGENT_PERMISSIONS.md`).

## Alternate-route pair blocking

Even when capability C has an allowed ordinary tool, C reached through
`remote-url`, `internal-uri-scheme`, `config-device`, `debug-device`,
`ast-device`, `ssh-device`, or `lsp-adjacent` denies as
`rejected_alternate_route` naming the (capability, route) pair —
`ALTERNATE_ROUTE_BLOCKING_TABLE`. Route detection
derives from the decoded input shape only, so a renamed carrier of the same
pair produces the identical pair-named denial, and the gate/sink status of the
capability's ordinary tool never excuses the route. A `config-write` shape —
which is how a config write flipping `tools.approval` posture arrives — denies
regardless of the ordinary write route's outcome; `SECURITY_RELEVANT_SETTING_KEYS`
names the protected posture keys the DECIDED settings-discovery-path control
guards. Any unenumerated non-ordinary pair still denies fail-closed naming the
presented pair.

The `remote-url` route is the DECODER-supplied screen for a native
read/search call whose real path/root constituent names an HTTP(S) target: the
native decoder decodes every `path`/`paths` constituent (delimited lists,
selectors, archive members, collapsed/glued internal spellings) and denies the
WHOLE call as `rejected_alternate_route` before any native scan or URL
materialization when any constituent is HTTP(S), SSH or an internal/device
scheme. A lone HTTP(S) `read` path stays on the ordinary `url` branch (the
registered owned controlled-transport replacement), so the pair never labels
that route; literal `pattern`/`query`/`grep_keywords` text is never screened.

## Provenance admission table

`evaluateToolProvenance` (names are structurally insufficient):

| Origin                                   | Admission                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-builtin`                         | Admits allow-table names only when the live runtime roster uniquely presents the pinned builtin tuple FOR THAT NAME (`path` `<builtin:name>`, `scope` `temporary`, `origin` `top-level`); `source: "sdk"` (RPC-host injection) stays host-denied, and a builtin-labelled entry outside the tuple records unowned-discovery. The recorded freshness halves come from the same live read as the identity, so the comparison denies a foreign-domain/hand-built stamp (naming the element); replacement invalidation rides the identity (a replaced name loses builtin membership) |
| `owned-extension`                        | Admits allow-table names only with exact contracted module ownership (row 12 canonical evidence required; lexical path alone never carries the tier) and current resource-generation observation                                                                                                  |
| `operator-mcp`                           | Admits iff the recorded origin is the ACP client's MCP ownership **and** the registry observation is current to `registryEpoch`. Post-start registration/refresh ADMITS on a fresh observation — no exclusion, no elicitation. Stale or incoherent observations deny with `pending: "re-observe"` |
| `host`, `workspace`, `unowned-discovery` | Deny structurally **even on allow-table names** (the name-match insufficiency made executable)                                                                                                                                                                                                    |

Epoch/generation values are consumed freshness inputs; the modules define no
counter and touch no registry plumbing (14b owns live `registryEpoch`
observation).

Generation observations follow a BOTH-or-NEITHER contract: `14b` supplies
`observedResourceGeneration` and `currentResourceGeneration` together from one
observation pair, or omits both (the explicit untracked-generation case).
Disagreement or exactly-one-present denies pending re-observation, so a rotated
`resourceGeneration` can never be admitted by omitting a field.

## Approval-record interpretation

Row 8 modeled the reality: `Settings.#readConfigOverlays` folds CLI overlays
into one mapping that `#mergeOwnLayers` deep-merges over global/project layers,
so lower-layer `tools.approval` grant/prompt/deny entries **can survive** into
the process. `interpretApprovalRecords` consumes that folded map (and row 8's
record-authority verdict) without re-implementing the comparison:

- Lookup is by **exact registered tool key only** — no wildcard, no prefix, no
  emulated default-deny (OpenCode's wildcard default-deny does not exist here).
- A surviving `allow` is never an execution-time grant; when the restricted
  decision denies, `restrictedDenialWithRecordNaming` reports the survivor as
  `rejected_approval_record_survivor` — reported, never obeyed.
- A surviving `prompt`/`ask` never elicits: generic human elicitation is
  explicitly absent from this integration.
- A surviving `deny` is harmless but non-authoritative.
- Records are advisory inputs; the execution-time default-deny decision is the
  operative boundary. The module contains no assertion or code path depending
  on a working record reset.

### Owned approval entries (row 29 `admit-trusted-omp-native-builtins`)

The restricted owned overlay pins exact-name `allow` entries for the native
read/search builtins it admits (`read`, `grep`, `glob`, `find`) plus their
activation flags, validated by `assertOwnedSettingsDocument` against a CLOSED
entry-name set and the pinned value vocabulary — so no unlisted tool key
(`eval`, `task`, `lsp`, …) and no unknown value can enter an owned overlay
through this branch. These entries are an APPROVAL POSTURE, not a boundary of
their own: provenance still denies SDK/foreign same-name calls before native
approval, and a record cannot NULLIFY a lower-layer survivor either (the reset
merge it would need does not exist) — that residual is contained by the
settings-discovery-path control (row 26) plus the execution-time default-deny
decision.

## Native-local versus protected-ACP boundary (row 29)

| Surface                                                        | Route that decides it                                                                                                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| native `read`/`grep`/`glob`/`find` local IO                    | authenticated native origin + native activation/approval, then the process's ambient OS permissions (`native-local-read-approval`); no daemon root-confinement claim                                         |
| native `write`/`edit` ordinary local IO                        | pinned native approval path + ambient OS permissions (`native-local-write-approval`); the restricted ACP mutation sink applies WHERE THE PINNED BRIDGE ROUTES THE CALL, with its denial propagation unchanged |
| native `bash`                                                  | the existing common command policy plus the active native ACP permission path                                                                                                                               |
| protected ACP filesystem callbacks the client serves           | unchanged row-4 boundaries (`row4-filesystem-read-boundary`, `filesystem-policy.ts` write sinks)                                                                                                            |
| delete / move / multi-file mutation                            | the complete shared fail-closed destructive decision (`row5-destructive-all-target-policy`)                                                                                                                  |
| owned URL read / web search                                    | the registered owned replacement's controlled per-hop transport (rows 17–19)                                                                                                                                |

## Destructive decision (consumption, not duplication)

`decideDestructiveIntent` accepts the P0 `DestructiveIntentContract`-shaped
decoded intent, calls row 5's `normalizeDestructiveIntent` +
`authorizeDestructiveTargets`, and returns its verdict verbatim with zero
re-derivation, no second normalizer, no independent path-authorization logic,
and no speculative decoder. Completeness failures yield the shared bounded
reasons (`rejected_destructive_incomplete` / `rejected_destructive_binding`)
with zero side effect. Canonical-root observations are pure data supplied by
14b; when they are absent the decision stops at normalization and reports
`authorizationEvaluated: false` — never a silent completion claim.
`replayConformanceFixtures` runs **every** row-5 conformance fixture through
this entry and tests assert verdict equality against
`DESTRUCTIVE_CONFORMANCE_TABLE` (complete multi-target, first-allowed-later-
escaping, incomplete fail-closed, binding mismatch).

### ACP client ingress normalization (`normalize-omp-destructive-acp-ingress`)

Separate from — and NOT a relaxation of — the restricted extension's
`tool_call` enforcement above, the ACP **client** ingress now normalizes the
native single-operation vocabulary before the shared row-5 policy:
`normalizeOmpDestructivePermissionInput()` (`src/acp/omp/destructive-ingress.ts`)
canonicalizes a configured-OMP `Delete`/`Move` request (identified from the
native `kind` or a case-insensitive word-boundary title) into the shared
`{path}` / `{source,destination}` payload, using the native move alias
precedence `oldPath`, `path`, `from` / `newPath`, `to`, `destination`. The
decoder is selected ONLY by the connector-supplied `ClientConfig.agentType`
— request fields, titles and claimed parser provenance grant no authority,
and OpenCode/omitted-type clients keep the pre-existing decoder exactly. The
adapter adds no new decoder: anything outside the native single-operation
field vocabulary (extra mutation fields, `operations`/patch bodies, malformed
JSON, missing or partial locations) is passed through to the same bounded
`rejected_destructive_incomplete` / `rejected_destructive_binding` denials,
and YOLO approval still precedes the destructive route.

## MCP admission mechanism tiers (honest, never inflatable)

The pinned `AUDITED_PINNED_LEDGER` has **no MCP boundary row**, and this change
may not fabricate one. `MCP_ADMISSION_MECHANISM_STATUS` therefore labels the
native-side MCP admission mechanism basis `needs-mechanism-audit` and any
candidate identity path `candidate-to-verify` — no element `supported`. The
statuses are frozen constants tied to the ledger gap: no fixture, test pass, or
local suite can relabel them. (P0's extension evidence covers handler
registration mechanics only, which is not the MCP admission basis and is not
part of this table.)

## Preserved pinned verdicts and DECIDED dispositions

`restrictedToolPolicyGates` restates both pinned verdicts as **sourced** data —
ledger statuses, notes, and citations are quoted from
`AUDITED_PINNED_LEDGER`, the row-8 reset-gate text from `ompSettingsForMode`,
register labels from the user decision register (§3 of
`docs/superpowers/specs/2026-10-06-omp-proposal-batch-index.md`); a test
asserts equality so no restatement can drift:

| Verdict                              | Pinned                       | Register label | User disposition                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative approval-record reset  | ledger status `incompatible` | INCOMPATIBLE   | DECIDED — settings discovery paths are controlled instead of the reset overlay (only owned `--config` overlays visible; HOME/XDG/project sources filtered), so no hostile lower layer exists to inherit from; restricted default-deny remains the second boundary |
| Complete destructive-intent decoding | ledger status `incompatible` | UNRESOLVED     | DECIDED — keep the ACP-mediated destructive path with complete location lists; deny native shapes (multi-file patches, first-operation-only lists) fail-closed                                                                                                    |

The register labels and the ledger statuses are different tokens from different
sources and are kept apart so neither relabels the other. Passing decision-table
tests clear neither verdict; unit/mock evidence validates decision logic only.

## Handoff

- **Row 29 → the owned-module-evidence writer**
  (`admit-trusted-omp-native-builtins` → `bind-omp-owned-module-evidence`): the
  DIRECT-ROSTER/PROVENANCE CONTRACT this change settles is the surface the
  successor binds physical module admission against — the pinned direct
  `api.getAllTools()` provider, the exact runtime builtin tuple
  (`<builtin:name>` / `temporary` / `top-level`) behind `native-builtin`, the
  `NativeBuiltinProvenance` record (full source identity + one live
  observation's epoch/generation), per-name roster uniqueness, the
  current-observation stamping rule, and the decoder's root-constituent
  vocabulary (`remote-url`/`internal-uri-scheme`/`ssh-device` screening before
  local dispatch). Native builtin authentication does NOT consume module
  evidence: the successor restores the owned `read`/`web_search` replacement's
  production origin admission, and no daemon protected-read broker is invented
  by either change.
- **14b** (`wire-omp-restricted-tool-enforcement`): trusted-extension
  `tool_call` handler wiring — decodes native arguments into `InputShape`
  (including device/config surface detection and `decodedCapability`;
  `deviceSurface` may only REFINE a non-ordinary shape — never downgrade a
  `config-write`/`device-route` shape to the ordinary route), observes
  live `registryEpoch`, supplies canonical observations for the destructive
  all-target pass; `allow-gated-pending-adapter` calls consult the route
  owners' typed completion at the clamp (C5) and stay failed closed whenever
  the completed route or registered owned replacement is absent. MCP
  admission is read from the entry decision's
  `routed-provenance` outcome (or the `decideMcpAdmission` re-expression
  view); there is no second admission path. Note that MCP-origin `url`/`todo`
  shapes are origin-keyed client capability calls, not native transport/todo
  routes — they are not pending-adapter or session-state coverage. The modules
  import cleanly as a self-contained tree; `src/acp/omp/extension/_daemon/mod.ts`
  is the extension's build-TIME re-export barrel and the C3 bundler inlines it
  into the single generated `index.js` (row 22's copied `_daemon/` image install
  tree no longer exists).
- **14c** (`harden-acp-command-path-gate`): lexical→canonical hardening of the
  `bash` completing authority.
- **Row 21** (`adapt-omp-public-code-search`) was REMOVED by C1
  (`remove-omp-public-code-search`): it is not a shipped consumer of the MCP
  tiers or honesty gates, which stay exported data.

## User-owned runtime checklist (UNVERIFIED — not claimed by any test here)

- [ ] Real handler enforcement: the 14b `tool_call` handler actually consults
      these decisions per call in restricted sessions (unverified).
- [ ] Real provenance observation: 14b observes the live `registryEpoch` and
      canonical ownership from the running binary, not fixtures (unverified).
- [ ] Native side effects at the pin: no unmodeled execution surface outside
      the audited table; re-audit at any pin change (unverified).

## Related

- [docs/AGENT_PERMISSIONS.md](AGENT_PERMISSIONS.md) — runtime permission layers
- [docs/OMP_SETTINGS.md](OMP_SETTINGS.md) — settings-layer contracts (row 8)
- [docs/OMP_ENFORCEMENT.md](OMP_ENFORCEMENT.md) — handler wiring, composition/freshness/refresh/error tables, and the user-owned runtime checklist (row 16)
- [openspec/specs/acp-integration/spec.md](../openspec/specs/acp-integration/spec.md)

> Runtime verification for this area is consolidated in the single checklist artifact [USER-RUNTIME-VERIFICATION.md](USER-RUNTIME-VERIFICATION.md) (sections B/C: live-origin freshness, destructive permission shapes; allow-side mock observations stay synthetic-labeled there).
