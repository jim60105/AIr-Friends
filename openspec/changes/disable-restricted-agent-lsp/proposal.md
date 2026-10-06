# Proposal: disable-restricted-agent-lsp

## Why

Design D5 requires removing LSP — the tool AND implicit language-server startup — from BOTH restricted agents while D6 keeps native YOLO maximally permissive with no added LSP denial. P0's ledger leaves both agents' restricted-only mechanisms as CANDIDATE/unaudited: OMP's `--no-lsp`/`lsp.enabled:false` gates startup discovery/warmup but source comments identify a lazy cold-start via edit/write that is unproven, and OpenCode `1.18.21` per-agent explicit/implicit LSP scoping is unresolved. This change wires the supported parts, audits the residual routes against pinned source, and fail-closes/gates what cannot be proven — it never lets a mock certify native behavior.

## What Changes

- **OMP restricted launch wires the pinned candidate mechanism**: row 9's restricted `omp acp` argument list gains `--no-lsp` ON TOP OF row 8's `lsp.enabled: false` restricted-overlay pin — the CLI flag maps to `enableLsp:false` gating startup discovery/warmup per P0 evidence (`main.ts`), the overlay pin covers the settings layer; neither alone is claimed sufficient until the audit below says otherwise. The native-YOLO OMP launch gains NO `--no-lsp`, no `lsp.*` key, and no restricted clamp (D6, row 8's composition contract).
- **Close the lazy cold-start gap or record it honestly**: audit pinned OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` (`packages/coding-agent/src/lsp/tool.ts`, `packages/coding-agent/src/tools/settings.ts`, the edit/write tool paths, and every `enableLsp`/`lsp.*` consumer) whether a restricted session's first `edit`/`write` (or `read`-side diagnostics/format routes) can still cold-start a language server after `enableLsp:false` + `lsp.enabled:false`. If a residual route exists AND is reachable through the restricted tool surface, block it via the 14a inventory as an ADDITIVE LSP-cold-start decision extension (the `lsp` tool, `lsp-adjacent` route, and `lsp.diagnosticsOnWrite`/`diagnosticsOnEdit`/`formatOnWrite` consumers default-deny on live provenance through 14b's handler) without editing 14a's shipped row semantics. If the residual is a native-internal route no AIr decision can reach, ship the supported wiring and record the residual as an unresolved gate with `userDecisionRequired` — never claim cold-start coverage that mocks do not prove.
- **OpenCode restricted config removes LSP from the `build`/restricted agent ONLY**: edit `agent-config/opencode.json` to remove the `"lsp": "allow"` grant from the `build` agent's permission map (default `"*": "deny"` then denies the tool), preserving the `yolo` agent's `"*": "allow"` untouched (D6). Audit pinned OpenCode `1.18.21` whether per-agent permission denies ALSO cover IMPLICIT language-server startup (diagnostics on read/edit/write, auto-detected server boot) or whether the only LSP kill-switch is the global top-level `lsp` configuration that would equally strip YOLO. Per design §6: if pinned OpenCode cannot express restricted-only LSP removal, do NOT apply a global disable — record the incompatibility and gate application pending explicit user decision rather than silently shrinking native YOLO.
- **Native YOLO on both agents gains nothing**: no `--no-lsp`, no overlay `lsp.*` key, no extension deny, no agent-config change for `yolo`; tests assert the YOLO overlay/launch/agent keep LSP available, and the 14b handler never registers in the YOLO process.
- **Evidence boundary stated as data**: unit/mock tests prove ONLY config/flag/decision wiring — the restricted launch/overlay carries the disable, the OpenCode restricted agent denies the `lsp` tool while `yolo` keeps it, the cold-start decision path returns deny on a residual-route fixture, and YOLO is exempt on both agents. Native restricted LSP removal INCLUDING implicit startup, and native YOLO LSP availability, stay on the design §15 user checklist; the implementation handoff MUST list them unverified.
- Explicit non-goals (owned elsewhere): the tool-inventory/provenance decision tables themselves (14a — consumed read-only; only additive LSP-cold-start rows if the audit proves `enableLsp:false` insufficient); `harden-acp-command-path-gate` (14c — explicitly NOT a dependency per the split note); transport (rows 17–19); packaging/version-health (row 20 — the OpenCode `1.18.21` pin is consumed as-is; if the audit shows the mechanism needs a newer OpenCode, that bump is a separate user decision noted in caveats, not applied here); the overlay content itself (row 8 — the pin already exists); the restricted launch skeleton (row 9 — this change only adds the flag to its restricted branch).
- No new `config.yaml`, `.env`, or Helm field: the change edits `agent-config/opencode.json`, adds one row-9 launch flag, consumes row 8's already-pinned overlay, and conditionally extends 14a's in-code table. `config.example.yaml`, `.env.example`, and `helm/values.yaml` remain intentionally unchanged; if implementation surfaces any new field, this change synchronizes all three itself.

## Capabilities

### New Capabilities

None. Reuse the existing `acp-integration` capability; P0's `RestrictedLspContract` is the consumed contract, not a new spec.

### Modified Capabilities

- `acp-integration`: ADD restricted-only LSP requirements — OMP restricted launch flag + overlay pin composition, the lazy cold-start audit-and-decision gate, OpenCode `build`-agent LSP permission removal with the restricted-only mechanism gate, and YOLO LSP preservation on both agents with an explicit mock-evidence boundary. P0's Restricted-Only LSP Compatibility Contract requirement stands unchanged; this change implements its supported parts and inherits its unresolved verdicts rather than relabeling them.

## Impact

Eventual implementation owns: `agent-config/opencode.json` (first runtime edit of this file in the batch — the `build` agent permission map only), the restricted branch of `src/acp/agent-factory.ts` `buildBaseAgentConfig()` (one flag in row 9's assembled argument list; shared file, confined edit), a conditional additive LSP-cold-start decision extension of `src/acp/omp/tool-inventory.ts` (data rows only, only if the audit proves a residual route), `tests/acp/restricted-lsp.test.ts` plus an extension of `tests/acp/agent-factory.test.ts`, `docs/AGENT_PERMISSIONS.md` (LSP section: restricted `build` agent no longer lists `lsp` as an allowed read-only tool; OMP restricted posture documented), and a `CHANGELOG.md` entry. Row 8's `agent-config/omp/*.yml` overlays, row 9's `src/utils/omp-paths.ts`, 14b's handler wiring, and P0's contract module are consumed read-only, never edited. Introduce no deployment config or environment fields; `config.example.yaml`, `.env.example`, and `helm/values.yaml` therefore remain intentionally unchanged.

Honesty restated from P0: OMP's mechanism verdict is CANDIDATE (flag gates startup discovery/warmup; lazy cold-start via edit/write unresolved), OpenCode's restricted-only mechanism is UNAUDITED. Passing unit/mock suites prove the wiring exists and decides correctly on fixtures; they are not evidence the official binaries suppress a language-server process. Both native properties remain §15 user-owned verification.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Pinned-source audit: OMP `enableLsp`/`lsp.*` consumers incl. edit/write cold-start and tool construction; OpenCode 1.18.21 per-agent permission vs global `lsp` config for implicit startup | 2.00 |
| OMP restricted launch flag wiring (`--no-lsp` in row 9's restricted branch only) + YOLO no-flag guard | 0.75 |
| OpenCode `agent-config/opencode.json` `build`-agent LSP removal + restricted-only mechanism gate (apply-or-record, no global bleed) | 1.00 |
| Conditional additive 14a cold-start decision rows + fail-closed residual gate recording (`userDecisionRequired`) | 1.00 |
| Consumer-visible unit/mock tests (restricted args/overlay carry disable; YOLO exempt both agents; OpenCode build denies / yolo keeps; cold-start decision fixture; fail-closed recording) | 2.00 |
| `docs/AGENT_PERMISSIONS.md` LSP section, §15 checklist carry-over, changelog | 0.75 |
| Applicable local type/unit/mock checks and OpenSpec verification, no live agents | 0.25 |
| Contingency for audit surprises or blocking review fixes | 0.25 |
| **Total hard ceiling** | **8.00** |

Core is 7.75 hours plus 0.25 contingency. If the pinned-source audit consumes its bound without resolving either agent's mechanism, publishing the honest unresolved gate with the supported parts wired is a valid P5d outcome — not license to invent an API method, bump the OpenCode pin, or shrink YOLO.

## Batch:

depends-on: establish-omp-compatibility-contracts
depends-on: translate-omp-owned-settings
depends-on: spawn-mode-scoped-omp-agents
depends-on: define-omp-restricted-tool-decisions
depends-on: wire-omp-restricted-tool-enforcement

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| establish-omp-compatibility-contracts (P0) | Application gate + evidence consumer | Consumes the CANDIDATE OMP verdict, the unaudited OpenCode verdict, the `RestrictedLspContract` shape, and the no-global-clamp rule verbatim; adds no ledger relabel — an implementation-time audit finding upgrades/lowers the verdict with recorded evidence, never a mock fixture. P0's application block (unresolved boundary) is discharged by this change's audit only for the LSP boundary; other P0 gates stand. |
| translate-omp-owned-settings (row 8) | Required predecessor, consumed as-is | The `lsp.enabled: false` restricted-overlay pin and the YOLO document's no-`lsp.*`-keys invariant are consumed unchanged; this change never moves the pin into the factory, never adds an LSP key to `agent-config/omp/native-yolo.yml`, and never edits row 8's composition module. |
| spawn-mode-scoped-omp-agents (row 9) | Required predecessor, same-file confined edit | Adds `--no-lsp` to the restricted branch of `src/acp/agent-factory.ts`'s assembled arguments ONLY (the one place the flag carrier exists); the native-yolo branch, state roots, env assembly, and OpenCode branch are untouched. Row 9's "no YOLO flag" invariants stay; this flag is a restricted-only disable, not an approval-mode carrier. |
| define-omp-restricted-tool-decisions (14a) | Required predecessor, table consumer | The `lsp` tool and `lsp-adjacent` route rows are consumed as shipped; ONLY if the audit shows `enableLsp:false` + `lsp.enabled:false` insufficient may this change append additive LSP-cold-start default-deny rows to the inventory table (data rows with citations; no editing shipped row semantics, no re-weighting, no new decision shape). |
| wire-omp-restricted-tool-enforcement (14b) | Required predecessor, wiring consumer | Any additive cold-start row is enforced by 14b's EXISTING handler unchanged — no new wiring, seam, or error vocabulary here; 14b's own note stands: handler denial is execution-time rejection, never disablement evidence. |
| harden-acp-command-path-gate (14c) | Explicit NON-dependency | Per the row-14 split note, row 15 depends on 14a+14b only; no command-path canonicalization behavior is consumed, and the bash gate is not an LSP mechanism. |
| package-pinned-omp-runtime (row 20) | Downstream successor | Row 20 installs the extended trusted-extension tree (if additive rows land) and the settings/overlay tree before cutting digests; content changes here must land first; row 20 must not alter any LSP posture or bump the OpenCode pin. |
| cover-omp-mocked-acp-lifecycle (row 21) | Final regression | May exercise the launch/overlay/handler composition across modes without duplicating this change's same-path unit cases and without fabricating native suppression. |
| finish-omp-mocked-skill-handoff (row 22) | Final docs | Extends (never rewrites) `docs/AGENT_PERMISSIONS.md` and the §15 checklist; zero config sync owed here because this change introduces zero new config/env fields. |

- Shared-file conflict: `agent-config/opencode.json` is FIRST runtime-edited by this change in the batch — rows outside this batch own it otherwise; the edit is confined to the `build` agent's permission map and the `yolo` agent block is byte-identical. `src/acp/agent-factory.ts` is shared with rows 7/8/9/20 — this change's edit is confined to the restricted-mode argument assembly; apply serially after row 9 lands. `docs/AGENT_PERMISSIONS.md` and `CHANGELOG.md` are serial across the OMP rows (4/5/13/14a/14b/14c/15/…) — the LSP table row and rationale are updated here, append/cross-link elsewhere. Row 8's overlays, 14a/14b modules, and P0's contract module are read-only consumers.
- Spec-conflict: ADDED requirements are uniquely named within `acp-integration`; this change adds no inventory/provenance decision requirement (14a), no handler-wiring requirement (14b), no overlay-composition requirement (row 8), and rewrites no inherited unresolved verdict into a supported claim without a recorded audit upgrade.
- Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
