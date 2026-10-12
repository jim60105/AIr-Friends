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
these clamps (their LSP disablement is owned separately, row 15), and OpenCode
flows are byte-unchanged — this change has no runtime consumer yet.

## Modules

| Module                                | Role                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/acp/omp/tool-inventory.ts`       | Entry decision over (tool name, recorded provenance, decoded input shape); machine-readable inventory table + alternate-route pair table + honesty gates |
| `src/acp/omp/tool-provenance.ts`      | Live-provenance admission (owned-extension canonical ownership, operator-MCP ownership + epoch freshness) and the MCP mechanism-status table             |
| `src/acp/omp/approval-records.ts`     | Exact-key native approval-record interpretation under the surviving-lower-record reality                                                                 |
| `src/acp/omp/destructive-decision.ts` | Thin consumer of the shared row-5 destructive policy; replays its conformance table                                                                      |

`allow` never means "authorized": every non-deny outcome names the completing
authority (row 4 sink policy, the existing common command policy, the row 5
all-target pass, or MCP client ownership). Deny reasons come from one bounded
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
| `read`, `list`, `glob`, `grep`, `search`/`find`                               | allow gated                                         | Row 4 boundaries + authorized shared/read-only roots + trusted-skills read root. Pinned note: some native search implementations do not automatically invoke ACP callbacks — the decision binds at the handler (14b), never by assumed callback coverage |
| native `read` URL branch; `webfetch`, `websearch`, `web_search`               | `allow-gated-pending-adapter` (distinct from allow) | Rows 17–18 adapters landed; since C5 (`admit-completed-omp-network-adapters`) 14b consumes the route owner's typed completion — the registered owned replacement on a completed route (search: a supported backend's exact grounding route) proceeds to the NAMED controlled boundary; every other case (incl. `webfetch`, credential-absent) stays failed closed, never letting native unadapted transport run. Capability parity preserved, never deny-parity                                                                       |
| `write` / `edit` (ordinary)                                                   | routed to sinks                                     | Row 4 `filesystem-policy.ts` via the row-8 sink contract                                                                                                                                                                                                 |
| todo-shaped write (`todoread`/`todowrite` and a `todo`-shaped `write`/`edit`) | in-session state only                               | Session planning state; the outcome carries `filesystemMutationRoute: false` — a todo-shaped write never opens a filesystem mutation route                                                                                                               |
| `bash`                                                                        | allow gated                                         | The EXISTING common command policy (lexical path gate unchanged; 14c owns canonical hardening); the extra native ACP bash permission path stays active                                                                                                   |
| `delete`, `move`, `apply_patch`                                               | routed to row 5                                     | Shared destructive all-target policy (below)                                                                                                                                                                                                             |
| operator/client-owned MCP tools (origin-keyed)                                | routed to provenance                                | Provenance decision + client MCP ownership; MCP is never host-owned                                                                                                                                                                                      |
| `skill` (owned critical skills, `skill://`-style reads)                       | allow gated                                         | Row 4 trusted-skills read root with row 12 canonical provenance                                                                                                                                                                                          |
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
`internal-uri-scheme`, `config-device`, `debug-device`, `ast-device`,
`ssh-device`, or `lsp-adjacent` denies as `rejected_alternate_route` naming the
(capability, route) pair — `ALTERNATE_ROUTE_BLOCKING_TABLE`. Route detection
derives from the decoded input shape only, so a renamed carrier of the same
pair produces the identical pair-named denial, and the gate/sink status of the
capability's ordinary tool never excuses the route. A `config-write` shape —
which is how a config write flipping `tools.approval` posture arrives — denies
regardless of the ordinary write route's outcome; `SECURITY_RELEVANT_SETTING_KEYS`
names the protected posture keys the DECIDED settings-discovery-path control
guards. Any unenumerated non-ordinary pair still denies fail-closed naming the
presented pair.

## Provenance admission table

`evaluateToolProvenance` (names are structurally insufficient):

| Origin                                   | Admission                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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
  import cleanly as a self-contained tree for the image extension's `_daemon/`
  install (row 22).
- **14c** (`harden-acp-command-path-gate`): lexical→canonical hardening of the
  `bash` completing authority.
- **Row 21**: inherits the MCP tiers and honesty gates as exported data.

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
