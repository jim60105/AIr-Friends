## Why

Decision 3 replaces the incompatible approval-record-reset recipe with control of settings discovery paths. The archived implementation describes neutral cwd/environment intentions but still exports an unresolved reset application gate and lacks an end-to-end lower-layer exclusion check for session setup.

## What Changes

- Extend typed owned-settings composition with one deployment-owned settings-source plan, consumed by OMP factory, mandatory final child-environment sanitization and pre-session checks.
- Remove inherited HOME/XDG/profile/config selectors from OMP settings discovery and rebuild only owned mode-scoped HOME/agent paths; reject lower global/project settings files instead of merging or deleting them.
- Revalidate actual ACP project cwd on new/load and same-mode recovery, including foreign discovery-provider settings sources, before sending a native session request.
- Retain the faithful reset counterexample and pinned incompatible/unresolved evidence; record decision 3 separately as DECIDED, with restricted runtime default-deny as the second boundary.
- Update unit/mock tests, settings/spawn docs, runtime checklist and changelog. Do not modify runtime policy, credentials, payload staging or OpenCode behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: amend the owned-settings reset application-gate requirement and OMP environment pass-through; add enforced owned-only settings-source visibility.

## Impact

Implementation owner covers `src/acp/omp-settings.ts`, `src/acp/sandbox-manager.ts` OMP-specific filtering, `src/acp/agent-factory.ts` OMP environment assembly, `src/acp/agent-connector.ts` pre-new/pre-load boundary, focused settings/factory/sandbox/mock-session tests, `docs/OMP_SETTINGS.md`, `docs/OMP_SPAWN.md`, `docs/USER-RUNTIME-VERIFICATION.md` and `CHANGELOG.md`. If a focused settings-source helper is needed, keep it in `src/acp/omp/` and reuse filesystem-root primitives. Do not change `models.yml` headers/provider identity or install an invented reset. No new public config/env/Helm field.

## Workday Budget

| Activity | Hours |
| --- | ---: |
| Pinned discovery-path inventory and typed plan | 1.00 |
| Mandatory OMP environment assembly/sanitization | 1.25 |
| Lower-source observer and new/load/recovery wiring | 2.00 |
| Temporary-filesystem unit and mock lifecycle tests | 1.75 |
| Settings/spawn docs, runtime checklist and changelog | 0.75 |
| Applicable checks and review contingency | 1.25 |
| **Hard ceiling including implementation/testing/docs** | **8.00** |

Sizing assumes reuse of the landed canonical filesystem primitives, mode-state selectors and final mock ACP harness. The implementation adds a bounded pinned source-path table, one observer and one shared pre-native lifecycle call site; it introduces no mount/filter backend or native watcher. Table-driven fixtures cover all source failures, then the existing lifecycle harness exercises both modes/shapes without repeating every filesystem case through every lifecycle combination. The 1.25h verification/contingency allocation is retained. Existing project-source detection rejects the workspace until its owner removes the source; this package does not implement native project-source suppression.

## Batch:

depends-on: translate-omp-owned-settings
depends-on: guard-omp-executable-discovery
depends-on: finish-omp-mocked-skill-handoff
depends-on: pin-omp-yolo-lsp-settings
depends-on: spawn-mode-scoped-omp-agents
depends-on: restore-mode-owned-acp-sessions
depends-on: wire-omp-restricted-tool-enforcement

Append as row 26 after all original 23 active changes and row 25; do not reintroduce removed row 13. Both archived dependencies refer to modifying landed implementations, never archive artifacts.

| Dependency or conflict | Relationship | Single-writer contract |
| --- | --- | --- |
| translate-omp-owned-settings | Archived implementation predecessor | This package owns source-plan/envPosture/recordResetGate disposition; preserve merge helpers and evidence. |
| guard-omp-executable-discovery | Archived implementation dependency | Consume canonical ownership and recorded unsupported discovery routes; no native-support reclassification. |
| pin-omp-yolo-lsp-settings | Serial predecessor | Preserve both-mode LSP pin in shared composition/validator/tests/docs. |
| spawn-mode-scoped-omp-agents; restore-mode-owned-acp-sessions | Launch/lifecycle predecessors | Single owner wires one source observer before native new/load and recovery; preserve state namespaces and gate-context restoration order. |
| wire-omp-restricted-tool-enforcement | Second-boundary predecessor | Consume restricted runtime default-deny; never copy its policy into YOLO. |
| check-omp-workspace-executables, row 27 | Lifecycle successor | Row 26 owns the settings check; row 27 adds its executable check AFTER it at the same pre-native-request seam without replacing it. |
| pin-omp-owned-skill-roots, row 28 | Composition successor | Extend source plan with owned roots while retaining mandatory sanitization and settings tests. |
| finish-omp-mocked-skill-handoff | Required last-original-row predecessor | Extend completed docs/checklist and mock regressions; no current-row reordering. |

Shared-file order is factory/connector 26 → 27 and settings module/tests/docs 25 → 26 → 28. The package touches no `/opt/air/omp` asset inputs unless its new helper is imported by the installed extension; if that closure changes, package the helper inside the owned closure and recut the manifest in this same change.

## Evidence and historical boundaries

The fixed fingerprint remains official OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, OpenCode `1.18.21` / `826d9ad46a22bef0294998e08daa3c4904fea28f`, and ACP SDK `0.14.1` with `terminal:false`. Decisions are `DECIDED (2026-10-09)` deployment-owned dispositions. Preserve `supported`, `candidate-to-verify`, `no-supported-mechanism`, `incompatible`, and `unresolved` as the recorded native verdict vocabulary. Never relabel a native verdict or clear a gate using mocks.

Only unit and mock integration evidence is automated acceptance. Real extension loading, settings precedence/reload, pre-import suppression, native skill selection and both-agent/both-mode implicit LSP suppression remain user-owned and unverified under approved design section 15. No real agent, provider, platform, container or bwrap acceptance is run. Read archived artifacts as historical context; implementation modifies their landed files and current specifications, never anything in `openspec/changes/archive/`. No compatibility layer, migration or runtime-pin change is introduced.
