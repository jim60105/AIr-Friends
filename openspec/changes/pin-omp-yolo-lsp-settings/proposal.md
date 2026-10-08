## Why

Decision 5 disables LSP for both agents in both modes. The archived owned-settings implementation still forbids any native-YOLO LSP key, so its asset and validator must follow the decision without duplicating the pending factory/OpenCode work.

## What Changes

- Add `lsp.enabled: false` to the native-YOLO owned overlay and matching typed composition; retain the identical restricted pin.
- Update the validator and overlay non-contamination requirement to permit and require this shared deployment pin, while preserving native YOLO approval and absence of restricted tool policy.
- Update focused settings tests, documentation and the package digest manifest for changed installed inputs.
- Leave factory flags, OpenCode permission maps and implicit-startup audit to `disable-restricted-agent-lsp`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: amend Restricted and YOLO Overlay Non-Contamination for the decision-5 LSP exception.

## Impact

Implementation ownership is `agent-config/omp/native-yolo.yml`, `src/acp/omp-settings.ts` constants/key sets/validator, `tests/acp/omp-settings.test.ts`, `docs/OMP_SETTINGS.md`, `CHANGELOG.md`, and the row-22-owned package digest manifest. Read the restricted asset without changing its existing pin. No implementation edit to `agent-factory.ts`, `agent-config/opencode.json` or restricted enforcement is in this package. No new config/env/Helm field.

## Workday Budget

| Activity | Hours |
| --- | ---: |
| Asset, composition and validator cutover | 0.75 |
| Unit/mock regression and carrier-interface tests | 0.75 |
| Settings docs, changelog and digest recut | 0.50 |
| Applicable local checks and review contingency | 1.00 |
| **Hard ceiling including implementation/testing/docs** | **3.00** |

## Batch:

depends-on: translate-omp-owned-settings
depends-on: guard-omp-executable-discovery
depends-on: finish-omp-mocked-skill-handoff
depends-on: disable-restricted-agent-lsp
depends-on: package-pinned-omp-runtime

Append as numbered row 25, after every currently listed active change, comprising 10 already applied/archived changes and 13 pending changes. Removed row 13 stays removed. Both archived dependencies refer to their implementations, never edits of their archived artifacts.

| Dependency or conflict | Relationship | Single-writer contract |
| --- | --- | --- |
| translate-omp-owned-settings | Archived implementation predecessor | This package owns native-yolo asset and composition/validator cutover. |
| guard-omp-executable-discovery | Archived implementation dependency | Consume mode-independent deployment identity; no discovery edit here. |
| disable-restricted-agent-lsp, row 17 | Required predecessor | Row 17 owns `--no-lsp` factory flags for BOTH OMP modes and OpenCode build+yolo maps; row 25 exclusively owns the YOLO overlay and settings validator. Serialize row 17 then row 25. |
| finish-omp-mocked-skill-handoff, row 24 | Required application-order predecessor | Consume final mock baselines; later docs/changelog extend the completed handoff. |
| package-pinned-omp-runtime, row 22 | Installed asset predecessor | Same change recuts manifest after the overlay bytes change. |
| isolate-omp-settings-discovery, row 26; pin-omp-owned-skill-roots, row 28 | Ordered successors | Serialize `omp-settings.ts`, settings tests/docs and package-manifest edits as 25 → 26 → 28. |

No row-17 implementation may edit `native-yolo.yml` or fork the row-25 validator change. Row 17's unconditional YOLO `--no-lsp` carrier makes its work independently complete before row 25 adds the mandatory owned-settings pin.

## Evidence and historical boundaries

The fixed fingerprint remains official OMP `v18.6.1` / `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, OpenCode `1.18.21` / `826d9ad46a22bef0294998e08daa3c4904fea28f`, and ACP SDK `0.14.1` with `terminal:false`. Decisions are `DECIDED (2026-10-09)` deployment-owned dispositions. Preserve `supported`, `candidate-to-verify`, `no-supported-mechanism`, `incompatible`, and `unresolved` as the recorded native verdict vocabulary. Never relabel a native verdict or clear a gate using mocks.

Only unit and mock integration evidence is automated acceptance. Real extension loading, settings precedence/reload, pre-import suppression, native skill selection and both-agent/both-mode implicit LSP suppression remain user-owned and unverified under approved design section 15. No real agent, provider, platform, container or bwrap acceptance is run. Read archived artifacts as historical context; implementation modifies their landed files and current specifications, never anything in `openspec/changes/archive/`. No compatibility layer, migration or runtime-pin change is introduced.
