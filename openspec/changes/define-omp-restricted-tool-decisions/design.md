## Context

See `proposal.md` — Why. Binding inputs: approved design §6 ("Restricted capability and authorization matrix": existing boundaries for read/list/glob/grep and search-class tools; ordinary write/edit through the session/shared sinks; bash through the existing command policy; delete/move/patch through the common destructive policy; MCP operator/client-owned with authoritative provenance after registration/reconnection; unknown tools and internal schemes default-rejected, name-match alone insufficient; complete pinned inventory and implicit side effects audited, "not only tools listed in the handoff YAML"; no hidden execution through `xd://`, configuration, SSH, debug, or other internal device routes; todo as in-session state only) and §7 ("restricted execution-time rejection supplies the missing default-deny boundary"; "explicitly supported native operations and current client-owned MCP tools must not accidentally request unsupported generic elicitation"; the extra native ACP bash/destructive permission path stays active; live-origin check on every restricted call; operator MCP registration/refresh after startup must not bypass it). D6: native YOLO receives none of the restricted clamps.

Predecessor consumption (no redefinition):

- P0 (`src/acp/omp/compatibility-contracts.ts`): `RecordAuthorityContract` (registered exact record keys, effective full records vs owned mode records, leftover grant/prompt/deny entries reject), `DestructiveIntentContract` (tool identity, exact raw input, parser provenance, ordered operations, complete target set, execution binding), the `supported|incompatible|unresolved` status vocabulary, and the two pinned verdicts this change restates verbatim: authoritative record reset **INCOMPATIBLE** as stated (`Settings.#readConfigOverlays` folds CLI overlays into one mapping that `#mergeOwnLayers` deep-merges over global/project, so lower-only `tools.approval` grant/prompt/deny records survive) and destructive intent **UNRESOLVED** (`getEditDestructiveIntent` returns one delete/move; `extractPermissionLocations` cannot recover omitted later operations). P0's ledger has **no MCP boundary row** — this change may not fabricate one.
- Row 4 (`src/acp/filesystem-policy.ts`, `SessionGateContext`): the restricted/YOLO sink decision, root roles, bounded rejection vocabulary — imported read-only for search-class and write/edit routing.
- Row 5 (`src/acp/destructive-policy.ts`): normalization + per-target all-pass + the exported machine-readable conformance table (fixture id → completeness verdict, enumerated targets, outcome reason) that row 5's design D5 states "Row 14's adapter must import" — this change is that consumer for the decision half.
- Row 8 (`src/acp/omp-settings.ts` + gate data): the surviving-lower-record modeling and `recordResetGate` (INCOMPATIBLE, `userDecisionRequired: true`), the exact `tools.approval` keys pinned in the restricted composition, and the fact that the settings layer cannot be relied on to clear records.
- Row 13 (`src/acp/omp/policy-readiness.ts`, readiness signal): `registryEpoch`/`resourceGeneration` freshness semantics consumed as INPUT to provenance decisions; the empty enforcement-handler SLOT this policy will fill (14b wires the registration); `readiness_rejected` is row 13's, never reused for policy denials.

Current-state constraint: OMP approval lookup uses **exact tool keys** rather than OpenCode's wildcard default-deny (design §7), so an unlisted tool has no native default-deny record to fall back on — the restricted execution-time decision shipped here is what supplies that boundary.

## Goals / Non-Goals

**Goals:** Four pure decision modules (inventory/default-deny incl. alternate-route blocking, live provenance, approval-record interpretation, destructive-intent consumption) plus the MCP admission decision, expressed as consumer-visible decision tables over (tool name, recorded provenance, decoded input shape), with the two P0 application gates restated as named data, local to `src/acp/omp/`, inside ~0.9 engineer-day including tests and docs.

**Non-Goals:** No trusted-extension `tool_call` handler wiring, per-call provenance plumbing, post-start MCP registry-refresh admission plumbing, or fail-closed error shapes (14b `wire-omp-restricted-tool-enforcement`); no generic-command gate path lexical→canonical hardening (14c `harden-acp-command-path-gate` — the `bash` allow row gates to the EXISTING policy unchanged); no LSP disablement implementation or implicit-startup proof (row 15); no transport (17–19), packaging (20), readiness state or gate call sites (row 13), destructive normalizer (row 5), owned overlay authoring or `tools.approval` composition (row 8), pre-import exclusion (row 12), native handler registration, IO of any kind, new ACP method, config/env/Helm field, pin change, fork, or claim that a mock shows the official binary enforcing anything.

## Decisions

### 1. One pure decision surface over (name, provenance, input shape), consulted only in restricted mode

`src/acp/omp/tool-inventory.ts` exports the entry decision:

```
ToolOrigin   = "owned-extension" | "operator-mcp" | "host" | "workspace" | "unowned-discovery"
InputShape   = <decoded per-tool argument classification from the pinned schema:
                path-target | command | url | query | todo | config-write | device-route | opaque>
RouteSurface = ordinary-tool | internal-uri-scheme | config-device | debug-device |
               ast-device | ssh-device | lsp-adjacent
RestrictedToolDecision =
  { allow, route: <which predecessor decision completes authorization> }
| { deny, reason: <bounded code from a finite added vocabulary> }
```

Every decision is a pure function of the tool name, its RECORDED origin (D2), and the decoded input shape — no IO, no clock, no settings read, no registry mutation. The module exports the table itself as machine-readable data (row → inputs → decision → rationale citation to design §6) so 14b, tests, and docs consume one artifact. `allow` never means "authorized": it means "this route participates in the predecessor decision that completes authorization" (row 4 sink policy, the existing command gate, row 5 all-target pass, or MCP client ownership). A deny is terminal for that call with one bounded reason (`rejected_tool_inventory`, `rejected_tool_provenance`, `rejected_alternate_route`, `rejected_approval_record_survivor`, `rejected_destructive_*` reused from row 5's vocabulary). Consultation posture is part of the contract: the surface is invoked ONLY for agent type `omp` in restricted mode (row 13's readiness signal attests the slot exists; 14b invokes per call). Native-YOLO OMP sessions never consult it (D6) and OpenCode flows never import it — pinned by tests, mirroring row 13's exemption tests.

### 2. Inventory table: explicit allow rows, exhaustive default-deny

Allow rows (each delegating, never re-deciding):

| Inventory entry | Decision | Completing authority |
| --- | --- | --- |
| `read`, `list`, `glob`, `grep`, local text search | allow gated | Row 4 boundaries + authorized shared/read-only roots + trusted-skills read root; includes the pinned note that some native search implementations do not automatically invoke ACP callbacks, which is precisely why the decision binds at the handler (14b) rather than assuming callback coverage |
| public web fetch/URL-read, web search, public code/docs search | allow gated | Rows 17–19 adapters once they exist; until then the decision marks them `allow-gated-pending-adapter` so 14b fails them closed rather than letting native unadapted transport run — the design's capability-parity requirement is preserved (never deny-parity), the adapter rows supply completion |
| `write`/`edit` (ordinary) | route to sinks | Row 4 `filesystem-policy.ts` via the row-8 sink contract; todo state is in-session only — a todo-shaped write never opens a filesystem mutation route |
| `bash` | allow gated | The EXISTING common command policy (lexical path gate unchanged; 14c hardens it); the extra native ACP bash permission path stays active (design §7) |
| delete/move/multi-file patch | route to row 5 | D5's shared conformance consumption (below) |
| operator/client-owned MCP tools | allow gated | D2 provenance + client ownership; MCP is never host-owned |
| owned critical skills (`skill://`-style reads) | allow gated | Row 4 trusted-skills read root with row 12 provenance |

Default-deny rows: every tool not on the table, plus the named OMP-only execution surfaces outside the approved capability set — eval, task/subagent, computer, browser, async, launch, debug, AST mutation/edit, LSP tool and LSP-referenced config, SSH, internal device URI schemes (`xd://`-class), and config-write — enumerated as table rows with design-§6 citations, NOT inferred from the handoff YAML list. The audit task pins the complete v18.6.1 inventory against official source; any inventoried surface with no table row lands in default-deny automatically (deny-by-absence is structural, so audit omissions fail closed rather than open). Implicit side effects of allowed tools (a `read`/`write` reaching an internal scheme, a config-writing edit flipping `tools.approval`, an LSP-adjacent mutation) are keyed by D3, not by the tool's ordinary allow row.

### 3. Live provenance decides; names never do

`src/acp/omp/tool-provenance.ts`: admit only (a) allow-table names carried by the owned trusted extension (exact-module-path ownership per row 12), and (b) operator MCP tools whose recorded origin is the ACP client's MCP ownership with a live registry observation no staler than the current `registryEpoch`. Deny structurally: host tools and workspace-discovered tools presenting an allow-table NAME (the name-match insufficiency made executable — the same name from the wrong origin denies even though the name is allowed), anything `unowned-discovery`, and stale-epoch observations (decision says "re-observe", 14b surfaces the fail-closed shape). Post-start operator MCP registration/refresh is ADMITTED by this decision — §7's "must not bypass the live-origin check" is satisfied by requiring the fresh provenance observation, not by excluding refreshed tools; the registry-refresh plumbing that feeds the observation is 14b's. Design §14's "refreshed operator tools remain admitted without human elicitation" is tested at the decision level here.

### 4. Alternate-entrypoint blocking keys on (capability, route)

Blocking is a separate table from D2/D3's identity question: even when capability C has an allowed ordinary tool, C reached via `internal-uri-scheme`, `config-device`, `debug-device`, `ast-device`, `ssh-device`, or `lsp-adjacent` route is DENIED (`rejected_alternate_route` naming the capability+route pair). Examples fixed as fixtures: execution through an internal scheme while `bash` is allow-gated; a config write flipping approval posture while `write` is sink-routed; AST/LSP/debug mutation while read is allowed (design §6 "do not admit a hidden mutation/debug/device route merely because `read` or `write` is allowed"). Route detection is input-shape classification (D1), so the block is data, not pattern-matching folklore. Rejected alternative: blacklisting specific tool names — the design requires blocking the ROUTE, and a route-keyed table survives tool renames.

### 5. Exact-key approval-record interpretation with no inherited grants

`src/acp/omp/approval-records.ts` consumes the EFFECTIVE `tools.approval` record map as modeled by row 8 (the faithful folded-merge result, surviving lower entries included). Interpretation rules: lookup is by EXACT registered tool key only — no wildcard/prefix/default-deny emulation; a surviving lower-layer `allow` record is NEVER an execution-time grant (the folded counterexample `{unknown_tool:"allow"}` surviving must yield deny here); a surviving `prompt` record never converts a restricted deny into an elicitation (generic elicitation is unsupported by design); a surviving lower-layer `deny` is harmless but non-authoritative — the D1/D2/D3/D5 decision is what decides. The output record states explicitly that settings-layer records are advisory inputs, the execution-time default-deny is operative, and NO working record reset is claimed: this module exists precisely BECAUSE row 8/P0 recorded reset INCOMPATIBLE. It consumes row 8's `RecordAuthorityContract`-shaped verdict and re-rejects if leftover grants/prompt/deny entries are present, mirroring P0's "leftover entries reject" comparison without re-implementing it.

### 6. Destructive decision is a thin consumer of row 5's shared module

`src/acp/omp/destructive-decision.ts`: given a `DestructiveIntentContract`-shaped decoded intent, call row 5's exported normalization + all-target decision and return its verdict verbatim (complete-authorized / fail-closed incomplete / escaping-target / binding-mismatch), with zero re-derivation and zero mutation. Tests replay row 5's exported conformance fixtures through this entry — same verdicts, proving consumption not duplication — including first-allowed-later-escaping and incomplete-intent cases. The pinned destructive-intent UNRESOLVED verdict means the honest default for native-shaped inputs the P0 fixtures mark undecodable is the row-5 fail-closed reason; no speculative decoder appears here.

### 7. MCP admission with honest mechanism tiers

The MCP admission DECISION (D2b, part of `tool-provenance.ts`): operator MCP tools admitted iff origin is client MCP ownership + fresh registry observation + the tool does not itself present an alternate-route surface (D3). Mechanism status is exported as named data, tiered from the pinned ledger, and honestly incomplete: handler-registration surfaces are `supported` (P0 extension evidence), but **P0 has no MCP boundary row**, so the native-side MCP admission mechanism is labeled `needs-mechanism-audit` and any candidate identity path `candidate-to-verify` — never `supported`. The exported table cites the gap explicitly so 14b's wiring and row 21's mocks inherit the label. Generic human elicitation is stated absent: admission is a machine decision; nothing here can request a form.

### 8. Honesty gate as named data, mirroring rows 8/13

One exported `restrictedToolPolicyGates` structure carries: the record-reset verdict (INCOMPATIBLE, pinned basis text, `userDecisionRequired: true`), the destructive-intent verdict (UNRESOLVED, pinned basis text, `userDecisionRequired: true`), and the MCP mechanism-audit gap. The gates block SECURITY CONSUMPTION (14b wiring real enforcement claims, row 20 packaging security posture) exactly as row 8's `recordResetGate` and row 13's readiness gate do, while the modules themselves ship and test locally — that is the operative-boundary posture design §7 mandates, never a workaround: no fixture, including a synthetic allow-fixture, flips a status, and no test asserts the native binary enforced, reset, or decoded anything.

## Risks / Trade-offs

- **Inventory drift at a future pin** → deny-by-absence is structural (unlisted ⇒ default-deny), the table rows cite design §6 and the pinned revision, and 14b/20 re-run the audit task at any pin change; drift fails closed.
- **`allow-gated-pending-adapter` rows could be misread as "network already allowed"** → the decision value is distinct from `allow`, docs repeat that rows 17–19 complete those routes, and a test asserts the pending-adapter value is not equal to allow.
- **P0 gates stay open** (record reset INCOMPATIBLE, destructive UNRESOLVED) → intended: this module is the boundary that holds while the user decides; docs state the two decision options (source-backed mechanism at a future pin via P0 revision + explicit decision; or restricted OMP remains not security-consumable).
- **Route classification could under-detect an exotic alternate surface** → input-shape classification is table data reviewable in one file; under-detection degrades to the tool's ordinary gated route, which is still bounded by rows 4/5/14c policies; the named-surface list covers every route design §6 enumerates.
- **Shared-file exposure is minimal but serial** → pure modules are new here; only `docs/AGENT_PERMISSIONS.md`/`CHANGELOG.md` are shared, append-only; predecessor modules are read-only imports, so no merge coupling with 14b/14c edits to client/extension files.
- **False assurance** → tests prove decision logic only; docs state unit/mock evidence never demonstrates native enforcement, and P0's evidence rules (synthetic fixtures labeled, never clearing ledgers) apply verbatim.

## Migration Plan

Additive and inert: pure modules not yet imported by any runtime path until 14b wires them; OpenCode and YOLO behavior byte-unchanged (no consumer). Rollback reverts one commit; no config, data, or state migration exists.

## Open Questions

None blocking. Whether rows 17–19 land before or after 14b's wiring only changes when `allow-gated-pending-adapter` flips to a completing adapter; the table shape accommodates both orders without revisiting this change.
