## Why

Decision 7 declares skill roots through deployment-owned settings, excludes workspace discovery from critical-name resolution and keeps name-only resolution denied. The archived tree already checks canonical candidates but deliberately leaves all `skills.*` settings unpinned, so its settings and skill-selection implementation need a complete follow-up.

## What Changes

- Declare only deployment-owned absolute skill roots in both owned mode overlays and typed settings composition, with registered source toggles and skills globally enabled.
- Feed those exact roots into the existing critical-skill selection tree and trusted-read consumers; exclude workspace candidates before critical-name collision/selection.
- Retain canonical path/source/read-only-root/current-session generation checks, deny name-only resolution and preserve ordinary owned skills.
- Wire new/load/refresh consumption to the same declaration without recreating staging or restricted execution policy.
- Update settings/discovery tests, packaged asset/extension closure manifest and docs/checklist/changelog, preserving decision-7 native incompatibility and evidence limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: amend canonical critical-skill ownership for owned-settings roots and add owned skill-source declarations for both OMP modes.

## Impact

Own `agent-config/omp/restricted.yml` and `native-yolo.yml` skill-source entries, `src/acp/omp-settings.ts` registered-key validator and shared source plan, skill sections of `src/acp/omp/discovery-guard.ts`, `src/acp/omp/extension/critical-skills.ts` and bootstrap consumption, focused settings/discovery/new-load-refresh mock tests, package closure/digest manifest, `docs/OMP_SETTINGS.md`, `docs/OMP_DISCOVERY.md`, `docs/USER-RUNTIME-VERIFICATION.md` and `CHANGELOG.md`. Consume canonical owned skill root from existing deployment/trusted-root constants; no configurable new skill-root selector, staging change, skill instruction rewrite, readiness gate or new public config/env/Helm field.

## Workday Budget

| Activity | Hours |
| --- | ---: |
| Pinned registered skill settings/source trace | 0.75 |
| Overlay/composition/schema validation and owned-root wiring | 1.25 |
| Canonical selection and new/load/refresh integration | 1.75 |
| Unit/mock collision, source, link and generation regressions | 2.00 |
| Package closure/digest and settings/discovery/checklist docs | 1.00 |
| Applicable checks and review contingency | 1.25 |
| **Hard ceiling including implementation/testing/docs** | **8.00** |

Sizing relies on the existing canonical critical selector, trusted-read root validator, settings validator and resource-generation lifecycle tests. Add registered settings/root declaration and candidate filtering at their existing interfaces, avoiding a replacement native skill loader or new staging/delivery harness. Table-driven source/collision cases and the existing new/load/refresh harness provide the required coverage without duplicating end-to-end delivery work. The 1.25h verification/contingency allocation remains inside the hard ceiling.

## Batch:

depends-on: translate-omp-owned-settings
depends-on: guard-omp-executable-discovery
depends-on: finish-omp-mocked-skill-handoff
depends-on: pin-omp-yolo-lsp-settings
depends-on: isolate-omp-settings-discovery
depends-on: check-omp-workspace-executables
depends-on: make-skill-staging-agent-portable
depends-on: package-pinned-omp-runtime

Append as row 28 after every original active row (10 applied/archived and 13 pending) and follow-up rows 25–27. Historical row 13 is removed and is neither applied nor required. The two archived dependencies are implementation prerequisites; all archive files remain frozen.

| Dependency or conflict | Relationship | Single-writer contract |
| --- | --- | --- |
| translate-omp-owned-settings | Archived settings implementation predecessor | Extend overlays and registered-key validation; provider/model identity remains unchanged. |
| guard-omp-executable-discovery | Archived canonical-selection predecessor | Reuse selection tuple, canonical identity and resourceGeneration vocabulary. |
| pin-omp-yolo-lsp-settings; isolate-omp-settings-discovery | Composition predecessors | Preserve mandatory LSP pin and settings-source plan. Settings module/overlays/tests/docs serialize 25 → 26 → 28. |
| check-omp-workspace-executables | Extension-tree predecessor | Consume DECIDED disposition records and executable observer; row 28 owns critical roots/candidate selection only. |
| make-skill-staging-agent-portable | Skill payload consumer predecessor | Preserve absolute payload paths, literal session ID and retry semantics; root declarations never move staging. |
| package-pinned-omp-runtime | Asset/closure predecessor | Recut the package manifest for both overlays and all modified installed closure inputs in the same implementation change. |
| finish-omp-mocked-skill-handoff | Required last-original-row predecessor | Consume existing handoff tests and add focused owned-root regressions; append docs/checklist/changelog after final baseline. |

One integration owner applies 25 → 26 → 27 → 28. Shared discovery/extension/docs/package-manifest writes serialize 27 → 28. All four follow-ups remain complete work packages; row 27 deploys executable checks and row 28 deploys critical skill controls, with neither package relying on a future placeholder implementation.

## Evidence and historical boundaries

The fixed fingerprint remains official OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, OpenCode `1.18.21` / `826d9ad46a22bef0294998e08daa3c4904fea28f`, and ACP SDK `0.14.1` with `terminal:false`. Decisions are `DECIDED (2026-10-09)` deployment-owned dispositions. Preserve `supported`, `candidate-to-verify`, `no-supported-mechanism`, `incompatible`, and `unresolved` as the recorded native verdict vocabulary. Never relabel a native verdict or clear a gate using mocks.

Only unit and mock integration evidence is automated acceptance. Real extension loading, settings precedence/reload, pre-import suppression, native skill selection and both-agent/both-mode implicit LSP suppression remain user-owned and unverified under approved design section 15. No real agent, provider, platform, container or bwrap acceptance is run. Read archived artifacts as historical context; implementation modifies their landed files and current specifications, never anything in `openspec/changes/archive/`. No compatibility layer, migration or runtime-pin change is introduced.
