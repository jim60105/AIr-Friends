# OMP Integration Proposal Batch Index

- Date: 2026-10-06
- Design: `docs/superpowers/specs/2026-10-06-omp-integration-design.md` (approved).
- Status (current, 2026-10-13): the archived OMP baseline is **35** changes — the 27 original
  non-cancelled rows, the seven `C1`–`C7` correction followups and
  `2026-10-13-unify-omp-skill-root-resolution`. Row 13 (`gate-omp-policy-readiness`) stays
  cancelled and has no archive. Unrelated non-OMP archive entries are not part of this baseline.
- The follow-on seam-correction batch is five changes: four are applied, archived and merged into
  `master`; the fifth, `synchronize-omp-seam-correction-docs`, is the final documentation
  reconciliation. Section 8 owns their ownership, dependency, shared-file conflict and
  application matrix.
- Acceptance contract: automated evidence is unit + mock integration only. All real-runtime
  verification (design section 15) is user-owned and ships unverified. Artifact existence or
  strict OpenSpec validation proves neither implementation nor native acceptance.
- Historical (proposal time, 2026-10-06): the paragraphs below that call the original changes plus
  seven correction *proposals* "planning artifacts only", and the section 6/7 language about
  unchecked tasks and unapplied source removal, record the state at proposal generation. Every one
  of those changes has since been applied and archived; those labels are retained as history,
  never as current status. Original artifact validation and whole-batch review did not establish
  correct native registration or production wiring — the correction and seam-correction batches
  own those source-audit findings, and both are applied.

## 1. Original application order (historical, already archived)

The original batch used this order, skipping cancelled row 13 without renumbering the remaining
rows. Do not reapply archived changes. Section 6's `C1`–`C7` batch is applied and archived; in
the follow-on seam-correction batch (section 8) issues 1–4 are applied, archived and merged, and
issue 5's documentation is implemented on `feat/synchronize-omp-seam-correction-docs` with its
archive/main-spec sync still owned by the batch owner.

| #  | Change                                | Batch row     | Budget |
| -- | ------------------------------------- | ------------- | ------ |
| 1  | establish-omp-compatibility-contracts | P0            | 8.0h   |
| 2  | canonicalize-acp-filesystem-roots     | P1a           | 7.75h  |
| 3  | secure-acp-filesystem-access          | P1b           | 8.0h   |
| 4  | enforce-acp-filesystem-authorization  | P1c           | 8.0h   |
| 5  | normalize-acp-destructive-targets     | P1d           | 8.0h   |
| 6  | modernize-acp-session-config          | P2            | 8.0h   |
| 7  | add-omp-agent-configuration           | P3a           | 8.0h   |
| 8  | translate-omp-owned-settings          | P3b           | 8.0h   |
| 9  | spawn-mode-scoped-omp-agents          | P3c           | 8.0h   |
| 10 | isolate-omp-process-pools-by-mode     | P4a           | 8.0h   |
| 11 | restore-mode-owned-acp-sessions       | P4b           | 7.5h   |
| 12 | guard-omp-executable-discovery        | P5a           | 8.0h   |
| 13 | gate-omp-policy-readiness (**REMOVED by user decision, 2026-10-09**) | P5b, cancelled | n/a |
| 14 | define-omp-restricted-tool-decisions  | P5c-i (14a)   | 7.0h   |
| 15 | harden-acp-command-path-gate          | P5c-iii (14c) | 5.5h   |
| 16 | wire-omp-restricted-tool-enforcement  | P5c-ii (14b)  | 8.0h   |
| 17 | disable-restricted-agent-lsp          | P5d           | 8.0h   |
| 18 | make-skill-staging-agent-portable     | P6            | 8.0h   |
| 19 | control-omp-url-fetch-transport       | P7a           | 8.0h   |
| 20 | adapt-omp-web-search                  | P7b           | 8.0h   |
| 21 | adapt-omp-public-code-search          | P7c, archived; superseded by C1 removal | 8.0h |
| 22 | package-pinned-omp-runtime            | P8            | 8.0h   |
| 23 | cover-omp-mocked-acp-lifecycle        | P9a           | 8.0h   |
| 24 | finish-omp-mocked-skill-handoff       | P9b           | 8.0h   |
| 25 | pin-omp-yolo-lsp-settings            | F1: archived settings / decision 5 | 3.0h |
| 26 | isolate-omp-settings-discovery       | F2: archived settings / decision 3 | 8.0h |
| 27 | check-omp-workspace-executables      | F3: archived discovery / decision 1 | 8.0h |
| 28 | pin-omp-owned-skill-roots            | F4: archived settings + discovery / decision 7 | 8.0h |

Ordering notes:

- Numbered row 15 (`harden-acp-command-path-gate`, 14c) lands before row 16's extension consumers
  and row 17's LSP edits. `src/acp/client.ts` edits in rows 4/5/15 are serial; removed row 13 adds none.
- The trusted-extension tree is serial: row 12 discovery → row 16 enforcement → row 19 fetch →
  row 20 search → the row-21 historical code-search slot, REMOVED by C1
  (`remove-omp-public-code-search`). Row 22 cut digests after content landed; subsequent
  `/opt/air/omp` input changes recut `PACKAGE-MANIFEST.sha256` in the same commit.
- Rows 23/24 are the original batch's final lifecycle/handoff consumers. Legacy proposal labels (14a/14b/14c, P5d,
  row-17 fetch, row-20 packaging, row-21 lifecycle, row-22 handoff) are not this table's numbering.
- Rows 25–28 are also applied/archived. Their historical order was 25 → 26 → 27 → 28.
  Row 13 remains cancelled and is skipped without renumbering.
- Follow-up dependencies on `translate-omp-owned-settings` and `guard-omp-executable-discovery` identify their archived implementations to modify. Their `openspec/changes/archive/` artifacts remain frozen.

## 2. Dependency-errata and contracts the index owns

- Row 12 declares a read-only dependency on row 2 canonical filesystem identity beyond its
  pre-split contract; numbered order satisfies it.
- `src/utils/omp-paths.ts` is authored by row 9; pool/ownership consumers are read-only, and row 22
  owns the append-only image-first export seam. No independent resolver is introduced.
- `agent-config/opencode.json` is serialized between numbered rows 15 and 17, row 15 first.
  Row 17 (`disable-restricted-agent-lsp`) explicitly denies `lsp` per agent for BOTH build and yolo,
  without a global clamp and without changing unrelated predecessor permissions. No batch-wide
  yolo-byte-identical invariant remains. Rows 23/24 use the file after BOTH rows as their baseline.
- `src/acp/client.ts` serial chain is row 4 sink cutover → row 5 destructive routing → row 15
  command-path branch. Row 16 consumes the decisions without a client edit. Row 13 is removed;
  no readiness prompt gate or channel is inserted.
- `agent-factory.ts` serial chain is row 7 config → row 8 settings selectors → row 9 OMP launch
  → row 17 both-mode LSP carriers → row 18 retry/staging consumers. Packaging row 22 preserves it.
- `agent-connector.ts` serial chain is row 6 config/cache → row 10 mode acquisition → row 11
  recovery. The named post-restore hook remains after gate-context restoration and before
  resumption, with no readiness assertion and no row-13 attachment.
- Row 16 owns synchronous handler-slot registration/attachment and live registryEpoch observation;
  it consumes row 12 resourceGeneration for stale-generation denial. Live-origin checks and
  post-start MCP refresh admission remain; no ReadySignal/channel or readiness reset is consumed.
- Extension packaging closure (row 22's copied `_daemon/` install tree is superseded by C3
  `package-bun-compatible-omp-extension`): the image installs ONE generated native-loadable
  `index.js` at `/opt/air/omp/extension/index.js`, cut by `deno bundle --frozen --format esm`
  from the canonical entry `src/acp/omp/extension/index.ts` (build input only, never a launch
  target) against the committed `deno.lock`; the development launch presents the generated
  `build/omp-extension/index.js` verbatim. `src/acp/omp/extension/_daemon/mod.ts` is the
  extension's build-TIME re-export barrel of the 14a pure modules and is inlined into that single
  bundle — there is no installed `mod.ts` image copy and no sidecar import map, and no runtime
  `/app/src` import ever existed. Extending the closure recuts the digest manifest in the same
  change.
- Row 23 may add at most one flagged test-only command override on row 9's launch path if no
  injection point exists; row 24 may need one flagged ephemeral Skill API port/JWT-dir seam.
  Implementation records seam/no-seam and retains production defaults.
- Row 24 owns final CHANGELOG consolidation, preserving row 22's packaging entry, adding row 23's
  deferred lifecycle entry and synchronizing the decision register, row 13 removal and both-agent
  LSP posture. Its config-trio audit checks existing fields introduced by rows 7/22 only.
- Row 23's justified test deletions are bounded to OMP-batch-owned files; inherited OpenCode
  regression cases are never removed as superseded by mock OMP evidence.
- Row 17 exclusively owns `--no-lsp` factory flags for BOTH OMP modes and OpenCode build+yolo per-agent permission maps, plus its existing audit/residual evidence work. Row 25 exclusively owns the native-YOLO LSP pin in `agent-config/omp/native-yolo.yml` and the corresponding `src/acp/omp-settings.ts` content/composition/validator cutover. Serialize row 17 → row 25; row 17 does not edit those settings carriers.
- Follow-up factory/connector preflights serialize row 26's settings check before row 27's executable check at the same pre-native-request seam. Row 28 consumes and extends their shared source/selection contracts. Every changed `/opt/air/omp` installed input recuts `PACKAGE-MANIFEST.sha256` in the same implementation change.

### Follow-up dependency and conflict matrix

All four rows depend on the archived implementations `translate-omp-owned-settings` and `guard-omp-executable-discovery`, and on original final handoff `finish-omp-mocked-skill-handoff`. These are implementation dependencies, with no edits to archived artifacts.

| Row / change | Additional dependencies | Ownership and serialized conflicts |
| --- | --- | --- |
| 25 `pin-omp-yolo-lsp-settings` | `disable-restricted-agent-lsp`; `package-pinned-omp-runtime` | Owns native-yolo LSP asset and settings composition/validator cutover after row 17's factory/OpenCode carriers. Settings module/assets/tests/docs and package manifest serialize 25 → 26 → 28. |
| 26 `isolate-omp-settings-discovery` | `pin-omp-yolo-lsp-settings`; `spawn-mode-scoped-omp-agents`; `restore-mode-owned-acp-sessions`; `wire-omp-restricted-tool-enforcement` | Owns settings-source plan, mandatory OMP environment sanitization and settings preflight. Factory/connector serialize 26 → 27; settings module/tests/docs serialize 25 → 26 → 28. Conditional installed-helper closure changes require a same-change digest recut. |
| 27 `check-omp-workspace-executables` | `isolate-omp-settings-discovery`; `wire-omp-restricted-tool-enforcement`; `package-pinned-omp-runtime`; `cover-omp-mocked-acp-lifecycle` | Owns executable observer/bootstrap and both honesty-gate DECIDED disposition records. Executable check follows row 26's settings check. Shared discovery/extension/docs/manifest serialize 27 → 28 while preserving prior enforcement/network closure. |
| 28 `pin-omp-owned-skill-roots` | `pin-omp-yolo-lsp-settings`; `isolate-omp-settings-discovery`; `check-omp-workspace-executables`; `make-skill-staging-agent-portable`; `package-pinned-omp-runtime` | Owns owned-skill settings declarations and canonical selection/root consumption. Final serial settings/discovery/extension/docs/manifest writer preserves row 25's LSP pin, row 26's source plan and row 27's executable checks/dispositions. |

## 3. User decisions required (consolidated decision sheet)

These gates were discovered honestly during proposal generation and are all now **DECIDED
(2026-10-09)** by explicit user determination. The verdict column is retained verbatim as the
pinned-binary record at OMP v18.6.1 / OpenCode 1.18.21; the pinned binaries still provide none of
the recorded mechanisms. The decision column records the user's chosen disposition and the change
that carries it, so the remaining batch changes implement one agreed posture. Local mock work and
fail-closed behavior at every seam continue; nothing here is a supported-mechanism claim.

The follow-ups extend the carrying changes recorded below without changing any pinned verdict or evidence limit. Decision 1 adds row 27 `check-omp-workspace-executables`; decision 3 adds row 26 `isolate-omp-settings-discovery`; decision 7 adds row 28 `pin-omp-owned-skill-roots`, consuming row 27's disposition records. Decision 5 serializes row 17's mandatory both-mode `--no-lsp` factory flags and OpenCode maps before row 25 `pin-omp-yolo-lsp-settings`, which owns the mandatory native-YOLO settings pin and content/validator cutover.

| Gate                                                                           | Verdict at pin                                                                                                                                   | Decision (2026-10-09)                                                                                                                                                                                                                                                                                                                                                                        | Carried by                                                                                              | Where recorded              | Consequence if undecided                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-import executable-discovery exclusion                                      | no-supported-mechanism (unresolved)                                                                                                              | DECIDED — deployment control keeps executable custom tools and plugin entry points out of the workspace; owned extension loaded only from the image path; `--no-extensions` keeps ambient discovery off; a startup check rejects an executable module found in the workspace. Fail-closed session rejection stays as the fallback.                                                            | `guard-omp-executable-discovery`                                                                        | P0 ledger; row 12           | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| Critical-skill canonical ownership                                             | incompatible name-only trust; selection unresolved                                                                                               | DECIDED — skill roots come from deployment-owned settings; only owned paths are declared, workspace skill discovery is excluded, and name-only critical-skill resolution is denied.                                                                                                                                                                                                          | `guard-omp-executable-discovery`; `make-skill-staging-agent-portable`                                   | P0 ledger; row 12           | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| Authoritative approval-record reset                                            | INCOMPATIBLE (deep-merge loses null barrier)                                                                                                     | DECIDED — settings discovery paths are controlled instead of the reset overlay: only the owned `--config` overlays are visible, with HOME, XDG and project settings sources filtered out, so no hostile lower layer exists to inherit from. Restricted runtime default-deny remains the second boundary.                                                                                      | `translate-omp-owned-settings`                                                                          | P0 ledger; rows 8/9/14a     | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| Complete destructive-intent decoding                                           | UNRESOLVED                                                                                                                                       | DECIDED — keep the ACP-mediated destructive path with complete location lists; deny native shapes (multi-file patches and first-operation-only lists) fail-closed.                                                                                                                                                                                                                           | `normalize-acp-destructive-targets`                                                                     | P0 ledger; rows 5/14a/14b   | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| Authenticated readiness control channel + native-to-ACP identity binding       | PARTIAL; channel no-supported-mechanism                                                                                                          | DECIDED: client-observable authenticated readiness is cancelled and gate-omp-policy-readiness is removed from the batch. Installed handler decisions remain; if handler installation fails, pinned non-YOLO native approval plus ACP client policy gate ACP-mediated operations fail-closed. runner.emit only logs lifecycle-hook errors without failing startup, leaving the restricted capability set absent; no equivalent native default-deny or callback coverage claim. | wire-omp-restricted-tool-enforcement; restore-mode-owned-acp-sessions; cover-omp-mocked-acp-lifecycle | P0 ledger; decision 2; row 13 REMOVED | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| MCP admission mechanism basis                                                  | needs-mechanism-audit (no P0 boundary row)                                                                                                       | DECIDED (no configuration change; not one of the seven security-boundary dispositions) — the operational stance stands: operator-MCP refresh admission runs the decision, provenance is revalidated after registration/reconnection, and the basis is never inflated to supported.                                                                                                          | `define-omp-restricted-tool-decisions` (14a); `wire-omp-restricted-tool-enforcement` (14b)              | 14a/14b                     | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| OMP restricted-only LSP incl. lazy cold-start                                  | CANDIDATE                                                                                                                                        | DECIDED: LSP disabled for OMP restricted+YOLO. Row 17 supplies both-mode --no-lsp flags over the existing restricted pin; row 25 supplies the mandatory native-yolo settings pin and content/validator changes. D6 LSP exemption superseded; no restricted tool policy copied into YOLO and native implicit startup remains unverified. | `disable-restricted-agent-lsp`; `pin-omp-yolo-lsp-settings` | P0 ledger; decision 5; rows 17/P5d and 25 | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| OpenCode restricted-only LSP mechanism                                         | UNAUDITED at 1.18.21                                                                                                                             | DECIDED: OpenCode build+yolo both explicitly deny lsp in their per-agent permission maps; no top-level global clamp. Explicit denial does not clear implicit-startup incompatibility or prove native server suppression. | `disable-restricted-agent-lsp`                                                                          | P0 ledger; decision 5; row 17/P5d | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| Native transport bypasses (loadPage/fetchBinary redirect:follow) | PARTIAL | DECIDED: controlled replacements cover URL read and web search only. Uncovered native routes remain blocked; proxy environment alone is not enforcement. C2–C5 repair definition, packaging, registration, and admission gaps. | `control-omp-url-fetch-transport`; `adapt-omp-web-search`; C2–C5 | P0 ledger; network docs | Native runtime observations remain user-owned and unverified. |
| D4 public code-search parity | PREMISE FALSE: pinned OpenCode 1.18.21 removed codesearch upstream, commit 2481dde, 2026-05-12 | SUPERSEDED by the user's parity decision: no dedicated public code-search implementation is required. Its executor, route, inventory/ledger requirements, obsolete tests and packaging slot are removed; local search, URL read and web search are kept. | C1: `remove-omp-public-code-search` | Archived row 21; network docs | Removal applied and archived as C1. No additional backend or credential, and no outstanding credential decision. |
| Row-15 audit OpenCode version bump (if the LSP mechanism needs newer OpenCode) | deferred                                                                                                                                         | DECIDED (decision 5): no OpenCode version bump; keep 1.18.21 and preserve implicit-startup evidence limits while both agents explicitly deny lsp per agent. | `disable-restricted-agent-lsp`                                                                          | decision 5; row 17/P5d caveat | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |
| Digest-manifest recuts                                                         | invariant                                                                                                                                        | DECIDED — retained as an invariant (no user decision was required); any content change to `/opt/air/omp` inputs still recuts `PACKAGE-MANIFEST.sha256` in the same commit.                                                                                                                                                                                                                   | `package-pinned-omp-runtime` (row 20)                                                                   | row 20                      | DECIDED disposition above governs application; pinned verdict and unverified runtime limits remain. |

## 4. Coverage map (design -> owner)

The original planning coverage map assigned owners to design sections 5–12. It did not establish
that their production consumers were wired correctly. Section 6 below owns the discovered gaps.
Historical highlights: section 5 pooling/state (9/10/11), section 6
capability matrix (2/3/4/5/14a/14b/14c/15/17/18/19), section 7 settings/discovery/readiness
(8/12; readiness cancelled, row 13 removed), section 8 sinks/destructive (2/3/4/5), section 9 network (17/18/19), section 10 flow
(6/9/10/11; no readiness handshake), section 11 staging (16), section 12 settings/packaging (7/8/20), section 14
mock-only acceptance (per-row suites + 23/24 combined), section 15 checklist (24 ships
`docs/USER-RUNTIME-VERIFICATION.md`, all items unverified until user observation).

## 5. Evidence limits (binding on every row)

Mock/temp-filesystem tests certify this codebase's decisions only. No mock certifies: native
trusted-extension load, pre-import enforcement, native ACP delegation shapes, restricted LSP
suppression incl. implicit startup, cross-mode native load rejection, native fetch/search
traffic routing, digest/asset bytes, or image/architecture behavior. Those are design section-15
user-owned checks, tracked in `docs/USER-RUNTIME-VERIFICATION.md` at row 24.

## 6. Correction batch (applied and archived)

Historical plan: these changes were authored and applied independently, in the listed application
order. Dependencies are behavioral prerequisites; serialization also prevented conflicts in shared
source and main specs. At proposal time each carried proposal, design, delta specs and unchecked
implementation tasks; all seven are now applied and archived (section 7), with
`synchronize-omp-seam-correction-docs` (section 8, issue 5) as this batch's final documentation
writer.

| Order | Change | Scope | Prerequisites | Budget |
| --- | --- | --- | --- | --- |
| C1 | `remove-omp-public-code-search` | Remove the unused public-search executor and obsolete contracts; retain actual OpenCode parity. | Archived baseline | 4.0h |
| C2 | `align-omp-native-tool-contracts` | Native parameter schemas, `content` results, and valid binary/image representations. | Archived baseline; serialize after C1 | 5.0h |
| C3 | `package-bun-compatible-omp-extension` | Native-loadable locked bundle and runtime-compatible DNS, without a new installed runtime. | C2; serialize after C1 | 8.0h |
| C4 | `wire-omp-native-extension-api` | Real `ExtensionAPI` registration, event decoding, and fresh native registry provenance. | C2 and C3 | 8.0h |
| C5 | `admit-completed-omp-network-adapters` | Consume route completion and backend availability without bypassing provenance or transport policy. | C1 and C4 | 5.0h |
| C6 | `repair-omp-owned-skill-handoff` | Literal skills-root instructions and owned native `skill://` reads, preserving staging and isolated HOME. | C2 and C4; serialize after C5 | 8.0h |
| C7 | `expose-omp-dashboard-agent-selection` | Offer OpenCode and OMP in dashboard chat and forward the selected type. | Archived API support; otherwise independent | 2.0h |

### Shared-file and specification conflict matrix

| Writer | Shared surfaces | Serialization rule |
| --- | --- | --- |
| C1, C4, C5 | Inventory, enforcement, daemon exports, `acp-integration` | C1 → C4 → C5; C5 modifies the network seam requirements after C1 removes the obsolete public-search clauses. |
| C2, C4, C5, C6 | Replacement tools and native extension entry | C2 → C4 → C5 → C6; native definitions are registered once, and skill URI support is not interpreted as network-adapter completion. |
| C1, C2, C3, C4, C5, C6 | Owned extension artifacts and package digests | Rebuild and recut the owned manifest in every change affecting installed inputs, using C3's packaging path after it lands. |
| C1, C3 | `container-packaging` | C1 removes the reserved-slot manifest clause; C3 modifies content-faithfulness to permit reproducible bundling from canonical sources. |
| C6 | Skill instructions, all prompt render callers, retry builder, template and skills specs | One writer migrates every caller; no child-HOME fallback or second root convention. |
| C7 | Dashboard markup and chat selection coverage, `web-dashboard-chat` | No runtime-policy dependency; no config or model-routing expansion. |

There are no new public configuration or credential fields. No correction restores the cancelled
readiness change, changes LSP scope, loosens YOLO/restricted isolation, or edits archived artifacts.
Proposal validation is artifact evidence only. Native loading, actual traffic, browser interaction,
and container behavior remain unverified until their respective implementation/manual checks.

## 7. Correction-proposal evidence (proposal-time record; all seven since applied)

**Historical, proposal time (2026-10-06).** At proposal creation, all seven changes passed
`openspec validate <change> --strict` and had complete proposal, design, delta-spec and task
artifacts; every implementation checkbox was unchecked, and an in-memory serial projection of
their 30 delta operations had no missing modification targets or duplicate additions and removed
all six dedicated public-code-search requirements (that projection modified no main spec and
archived no change). Artifact validation and that projection are proposal-completeness evidence
only: they proved neither implementation nor native acceptance.

All seven have since been applied and archived — `remove-omp-public-code-search`,
`align-omp-native-tool-contracts`, `package-bun-compatible-omp-extension`,
`wire-omp-native-extension-api`, `admit-completed-omp-network-adapters`,
`repair-omp-owned-skill-handoff`, `expose-omp-dashboard-agent-selection` — so the "unchecked" and
"remain unapplied" statements above describe the proposal, not the outcome. The draft-style
findings (zero errors; colon-label and literal source-mirror warnings reviewed in context) and the
absence of any project test suite, real agent, provider, browser or container run belong to that
proposal task; official-runtime acceptance remains user-owned and UNVERIFIED.

## 8. Seam-correction batch (2026-10-13, applied)

Five changes close the source-audit seams left by the archived C batch. Ordering among them is
shared-file serialization only: no change is gated on an unmet mutation or runtime prerequisite,
and issues 1, 3 and 4 were independently actionable.

| Issue | Change | Depends on | Application state | Archive / merge evidence |
| --- | --- | --- | --- | --- |
| 1 | `admit-trusted-omp-native-builtins` | archived baseline | applied, archived, merged | archive `2026-10-13-admit-trusted-omp-native-builtins`; merge `5064689` |
| 2 | `bind-omp-owned-module-evidence` | issue 1 | applied, archived, merged | archive `2026-10-13-bind-omp-owned-module-evidence`; merge `6948f9f` |
| 3 | `render-delivered-skill-root-contract` | archived baseline | applied, archived, merged | archive `2026-10-13-render-delivered-skill-root-contract`; merge `a6f12e6` |
| 4 | `thread-per-spawn-omp-recovery-context` | issue 3 | applied, archived, merged | archive `2026-10-13-thread-per-spawn-omp-recovery-context`; merge `90b50ea` |
| 5 | `synchronize-omp-seam-correction-docs` | issues 1–4 | this change: documentation implemented on `feat/synchronize-omp-seam-correction-docs`; archive/main-spec sync is the batch owner's step | — |

Implementation state is read from the landed implementation and source, never from artifact
existence: a change's four planning artifacts (and their strict validation) prove proposed
completeness only — not implementation and not native runtime acceptance.

### Ownership and shared-file conflict matrix

| Surface | Owner | Final pass |
| --- | --- | --- |
| Native builtin admission, provenance and owned-replacement evidence in `OMP_ENFORCEMENT.md`, `OMP_TOOL_POLICY.md`, `OMP_SETTINGS.md`, `OMP_COMPATIBILITY.md` | issues 1 and 2 | issue 5 removes stale taxonomy/no-consumer/callback-completion wording and records the accepted native posture |
| `OMP_NETWORK.md` and the skill-URI handoff | issue 2 | issue 5 keeps physical origin ahead of route completion and the absent-credential deny (no fallback) |
| Prompt variables, skill recipes and the shared skills-root fragment | issue 3 | issue 5 keeps every delivered template/retry on the literal, quoted trusted root |
| `OMP_RECOVERY.md` | issue 4 | issue 5 keeps all nine owning callers, the mandatory OMP context and the legacy-OpenCode distinction |
| `OMP_SPAWN.md`, `OMP_DISCOVERY.md`, `OMP_PACKAGING.md`, this index | issue 5 (predecessors supplied the new evidence types) | generated launch-path contract, deployment/state root separation, accepted extension-load residual |
| `CHANGELOG.md` | every substantive writer | issue 5 deduplicates and adds supersession context only — no owner's entry is rewritten |
| `USER-RUNTIME-VERIFICATION.md` | every behavior owner | issue 5 keeps the source/mock/user-observation separation and every UNVERIFIED row |

Every pair conflicts on the append-only CHANGELOG, so those commits are serialized; issues 1/2
also share the provenance/enforcement docs and bundle inputs, and issues 3/4 share the
session-orchestrator delivery/recovery callers. **Every ordering edge is shared-file serialization
only** — no change in this batch is gated on an unmet mutation or runtime prerequisite, and no
change remains application-blocked.

### Accepted native boundaries and residuals this batch records

- **Native local read/search (issue 1)** — the authority is `native-local-read-approval`:
  authenticated native builtins, the supported native activation/approval tier, then the
  PROCESS's own ambient OS permissions. A read may reach an ambient-readable path outside the
  daemon session roots; the ACP read boundary keeps its guarantees only for the callbacks that
  actually execute. Remote/device routes stay denied and are screened out before local dispatch.
  No daemon root-confinement is claimed.
- **Native write/edit (issue 1)** — `native-local-write-approval`: the pinned native approval path
  plus ambient OS permissions, with the restricted ACP mutation sink retained only as the route
  the pinned bridge applies WHERE IT ROUTES THE CALL. An absolute native session-sandbox/plan
  target and an unavailable client bridge do not reach that sink and mutate directly: **the user
  explicitly authorized that ambient native mutation risk, and it is recorded as a residual — not
  as an application-blocked status and not as a pending protected-IO prerequisite.** No ACP-sink
  protection is claimed for those paths, and no pre-dispatch route gate exists.
- **Cancelled readiness (never restored)** — row 13 stays removed: no readiness channel,
  handshake, tuple or assertion exists. The accepted residual is that the pinned host logs
  extension-load/lifecycle failures without failing startup, so an extension that fails to load
  leaves a running session without the restricted capability set.
- **Named residual, not closed** — at the pin the roster forwards only the definition-authorable
  `sourceInfo.path`, so a hostile same-name extension declaring our artifact path is
  indistinguishable through the supported roster API: **which extension implementation the host
  invokes under a name is not claimed anywhere** (`docs/OMP_ENFORCEMENT.md`, "Named residual —
  the roster's `sourceInfo.path` is definition-authorable").
- **Pins and invariants unchanged** — OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`,
  OpenCode `1.18.21`, ACP SDK `0.14.1`; the investigated `v18.10.3` supplies no confined-IO fix
  (no bump, no fork, no custom broker); the configuration trio, the public-code-search removal,
  native-YOLO separation, LSP disable scope and sandbox/egress behavior are unchanged.
