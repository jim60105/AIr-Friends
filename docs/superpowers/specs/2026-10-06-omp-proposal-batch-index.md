# OMP Integration Proposal Batch Index

- Date: 2026-10-06
- Design: `docs/superpowers/specs/2026-10-06-omp-integration-design.md` (approved).
- Status: All 27 non-cancelled original and follow-up changes are applied/archived. Row 13
  remains cancelled. Seven new correction proposals are planning artifacts only, each budgeted
  <=8h including implementation, focused verification, and documentation. Original artifact
  validation and whole-batch review did not establish correct native registration or production
  wiring. The correction batch below owns the source-audit findings.
- Acceptance contract: automated evidence is unit + mock integration only. All real-runtime
  verification (design section 15) is user-owned and ships unverified.

## 1. Original application order (historical, already archived)

The original batch used this order, skipping cancelled row 13 without renumbering the remaining
rows. Do not reapply archived changes. Apply the new correction batch in section 6 instead.

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
  row 20 search → row 21 historical code-search slot, now scheduled for removal. Row 22 cut digests after content landed;
  subsequent `/opt/air/omp` input changes recut `PACKAGE-MANIFEST.sha256` in the same commit.
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
- Extension dependency closure remains binding: row 22 installs 14a pure modules into the image
  extension's `_daemon/` tree with a `mod.ts` barrel. All imports resolve inside
  `/opt/air/omp/extension`; dev mode resolves the same committed sources. No runtime `/app/src`
  import. Extending the closure recuts the digest manifest in the same change.
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
| D4 public code-search parity | PREMISE FALSE: pinned OpenCode 1.18.21 removed codesearch upstream, commit 2481dde, 2026-05-12 | SUPERSEDED by the user's parity decision: no dedicated public code-search implementation is required. Remove its executor, route, inventory/ledger requirements, obsolete tests, and packaging slot. Keep local search, URL read, and web search. | C1: `remove-omp-public-code-search` | Archived row 21; network docs | Removal is proposed, not yet applied. No additional backend or credentials. |
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

## 6. Correction batch (single writer, serial)

Author and apply changes independently, in the listed application order. Dependencies are
behavioral prerequisites; serialization also prevents conflicts in shared source and main specs.
All seven proposals include proposal, design, delta specs, and unchecked implementation tasks.

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

## 7. Correction proposal evidence

At proposal creation, all seven changes pass `openspec validate <change> --strict` and have
complete proposal, design, delta-spec, and task artifacts. All implementation checkboxes remain
unchecked. An in-memory serial projection of their 30 delta operations has no missing modification
targets or duplicate additions and removes all six dedicated public-code-search requirements.
This projection does not modify main specs or archive any change.

Draft style checking reports zero errors; its colon-label and literal source-mirror warnings were
reviewed in context. No project test suite, real agent, provider, browser, or container was run
for this proposal task. Source removal and runtime repairs remain unapplied.
