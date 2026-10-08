## Why

Decision 1 adopts deployment control plus a pre-import startup check for the recorded unsupported custom-tool/plugin exclusion routes. The archived guard currently produces unconditional unsupported-mechanism blockers and does not inspect the actual session workspace before native session setup.

## What Changes

- Extend the existing discovery decision tree with a metadata-only executable-source observer and fail-closed deployment disposition; preserve the native surface table and its verdicts.
- Check every OMP session workspace and reachable executable discovery root before spawning/importing OMP and before native session new/load/rediscovery; reject executable custom tools or plugin entry points without importing them.
- Load the owned extension only from the packaged image path in production and keep `--no-extensions`; preserve source-owned development resolution for unit/mock use.
- Keep the archived fail-closed restricted-session rejection as fallback when deployment controls cannot be established, with bounded diagnostics and no unguarded retry/downgrade.
- Update both honesty-gate disposition records to reflect decisions 1 and 7 as DECIDED separately from unchanged native verdicts; decision-7 controls are implemented by row 28.
- Recut the package closure digest and update focused tests, discovery/spawn docs, checklist and changelog. No readiness handshake or client-observable handler-installation claim.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: amend pre-import bootstrap, fail-closed session setup and discovery/critical-selection application-gate requirements to consume the decided deployment posture.

## Impact

Own `src/acp/omp/discovery-guard.ts`, existing `src/acp/omp/extension/*` bootstrap/surface/ownership integration, OMP-only pre-spawn and pre-new/load checks in factory/connector, focused discovery unit/mock tests, package closure inputs/manifest, `docs/OMP_DISCOVERY.md`, `docs/OMP_SPAWN.md`, `docs/USER-RUNTIME-VERIFICATION.md` and `CHANGELOG.md`. Do not implement tool enforcement, network routes, readiness channel, critical-root asset settings or skill staging here. No new public config/env/Helm field.

## Workday Budget

| Activity | Hours |
| --- | ---: |
| Pinned executable-source inventory and observer | 1.50 |
| Existing guard disposition/fallback integration | 1.00 |
| Pre-spawn and native new/load/refresh wiring | 1.50 |
| Temporary-filesystem and mock importer/lifecycle tests | 1.75 |
| Owned closure/manifest recut and docs/checklist/changelog | 1.00 |
| Applicable checks and review contingency | 1.25 |
| **Hard ceiling including implementation/testing/docs** | **8.00** |

Sizing relies on row 26's authoritative roots/metadata observation and pre-native seam, the archived guard decision/failure objects, and the completed mock lifecycle harness. Extend those objects with the pinned executable-entry inventory and append one executable check at the seam; do not implement a second filesystem backend, recursive whole-repository executable scan or native import interceptor. Exercise entry/link failure cases through table-driven observer tests and lifecycle ordering through the existing both-mode harness. The 1.25h verification/contingency allocation covers integration review.

## Batch:

depends-on: translate-omp-owned-settings
depends-on: guard-omp-executable-discovery
depends-on: finish-omp-mocked-skill-handoff
depends-on: isolate-omp-settings-discovery
depends-on: wire-omp-restricted-tool-enforcement
depends-on: package-pinned-omp-runtime
depends-on: cover-omp-mocked-acp-lifecycle

Append as row 27 after all original 23 active changes and rows 25/26; removed row 13 stays removed. Both archived dependencies identify implementation owners, never mutable historical artifacts.

| Dependency or conflict | Relationship | Single-writer contract |
| --- | --- | --- |
| guard-omp-executable-discovery | Archived implementation predecessor | Extend its existing decision objects, module ownership, two honesty gates and failure formatter. |
| translate-omp-owned-settings; isolate-omp-settings-discovery | Archived dependency and row-26 predecessor | Consume the owned-only source plan; settings preflight executes first, executable preflight second. |
| wire-omp-restricted-tool-enforcement | Existing extension-tree predecessor | Preserve installed synchronous handler, live registryEpoch/resourceGeneration checks and accepted extension-load risk. |
| package-pinned-omp-runtime | Closure/digest predecessor | All installed imports stay under `/opt/air/omp/extension`, including `_daemon/` closure. Same-change manifest recut. |
| cover-omp-mocked-acp-lifecycle; finish-omp-mocked-skill-handoff | Harness and ordering predecessors | Add focused preflight scenarios to real repository lifecycle paths with mock native requests; avoid rewriting mock admission as native support. |
| pin-omp-owned-skill-roots, row 28 | Ordered successor | Row 27 owns bootstrap/executable observation and both gate disposition records; row 28 consumes them and owns skill canonical selection/roots. Serialize shared discovery/extension/docs/manifest writes. |

Factory/connector edits serialize after row 26. One engineer integrates the extension tree after all network/enforcement content has landed; no competing import graph or discovery table is introduced.

## Evidence and historical boundaries

The fixed fingerprint remains official OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, OpenCode `1.18.21` / `826d9ad46a22bef0294998e08daa3c4904fea28f`, and ACP SDK `0.14.1` with `terminal:false`. Decisions are `DECIDED (2026-10-09)` deployment-owned dispositions. Preserve `supported`, `candidate-to-verify`, `no-supported-mechanism`, `incompatible`, and `unresolved` as the recorded native verdict vocabulary. Never relabel a native verdict or clear a gate using mocks.

Only unit and mock integration evidence is automated acceptance. Real extension loading, settings precedence/reload, pre-import suppression, native skill selection and both-agent/both-mode implicit LSP suppression remain user-owned and unverified under approved design section 15. No real agent, provider, platform, container or bwrap acceptance is run. Read archived artifacts as historical context; implementation modifies their landed files and current specifications, never anything in `openspec/changes/archive/`. No compatibility layer, migration or runtime-pin change is introduced.
