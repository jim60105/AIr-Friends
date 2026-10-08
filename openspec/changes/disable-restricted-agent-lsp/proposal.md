# Proposal: disable-restricted-agent-lsp

## Why

Decision 5 in `docs/OMP_COMPATIBILITY.md` and the dated approved-design amendment disable LSP for OMP restricted and native-YOLO and OpenCode build and yolo. This supersedes D6's LSP exemption without copying restricted tool policies into YOLO. Pinned OMP v18.6.1 and OpenCode 1.18.21 incompatibility/unresolved verdicts remain authoritative; user disposition is DECIDED, and mock evidence never establishes native implicit-startup suppression.

## What Changes

- OMP restricted launches add `--no-lsp` over the existing `restricted.yml` `lsp.enabled: false` pin. Native-YOLO receives the LSP disable through `agent-config/omp/native-yolo.yml` (`lsp.enabled: false`) and/or `--no-lsp` on its launch branch. Keep mode-isolated settings/state and native YOLO approval behavior; register no restricted handler in YOLO.
- `agent-config/opencode.json` explicitly denies the `lsp` tool in BOTH agents, `build` and `yolo`, using per-agent permission maps. Do not introduce a top-level global LSP clamp. The yolo block intentionally changes for this one denial; unrelated permissions remain permissive and unchanged.
- Audit pinned source for implicit server boot/cold-start consumers and preserve any unsupported or unresolved coverage as named evidence. Per-agent OpenCode tool denial does not establish suppression of automatic diagnostics/server startup. No version bump, replacement LSP service or invented native interception is authorized.
- Retain the conditional additive restricted LSP-adjacent inventory rows for consultable residual routes; the existing handler enforces them. Native-internal residual routes, including YOLO paths without a restricted handler, remain explicitly unverified/uncovered rather than claimed solved.
- Tests cover mode-specific config/flag/permission wiring and the residual-route decisions only. Runtime suppression in all four agent/mode combinations, including implicit startup, stays user-owned and unverified.
- No new config/env/Helm field. The three example files remain unchanged unless eventual implementation genuinely introduces a field, in which case it synchronizes all three.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: LSP disable carriers in both OMP modes, per-agent explicit OpenCode build+yolo lsp denial, pinned implicit-startup evidence and residual-route decisions, and source/mock/runtime evidence separation. Existing compatibility verdicts are not relabeled.

## Impact

Eventual implementation edits `agent-config/opencode.json` in both per-agent permission maps; `src/acp/agent-factory.ts` restricted and optionally native-yolo LSP argument branches; `agent-config/omp/native-yolo.yml` if the settings carrier is selected; conditional additive rows in `src/acp/omp/tool-inventory.ts`; consumer-visible LSP/config/factory tests; `docs/AGENT_PERMISSIONS.md`; and CHANGELOG. The restricted overlay pin, settings ordering, mode state/env roots, restricted-only handler registration and upstream pins stay unchanged. No global OpenCode clamp.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Pinned-source OMP/OpenCode implicit-startup and carrier audit | 2.00 |
| OMP restricted and native-YOLO LSP carrier wiring | 0.75 |
| OpenCode per-agent build+yolo explicit denial | 1.00 |
| Conditional restricted cold-start rows and honest residual records | 1.00 |
| Config/flag/permission/decision unit and mock tests | 2.00 |
| Permission docs, runtime checklist handoff and changelog | 0.75 |
| Focused checks/OpenSpec verification | 0.25 |
| Contingency | 0.25 |
| **Total hard ceiling** | **8.00** |

## Batch:

depends-on: establish-omp-compatibility-contracts
depends-on: translate-omp-owned-settings
depends-on: spawn-mode-scoped-omp-agents
depends-on: define-omp-restricted-tool-decisions
depends-on: wire-omp-restricted-tool-enforcement
depends-on: harden-acp-command-path-gate

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| establish-omp-compatibility-contracts | Evidence contract | Preserve pinned unresolved/incompatible verdicts. Decision 5 determines deployment posture; passing mocks never clear a native gap. |
| translate-omp-owned-settings | Settings consumer | Keep restricted pin and overlay ordering; supersede the native-yolo no-lsp-keys invariant only for the explicit LSP disable carrier. No unrelated approval/overlay changes. |
| spawn-mode-scoped-omp-agents | Same-file confined edit | Add restricted --no-lsp and optionally native-yolo --no-lsp; preserve native approval mode, state/env isolation and no restricted handler in YOLO. |
| define-omp-restricted-tool-decisions / wire-omp-restricted-tool-enforcement | Decision/wiring consumers | Only additive consultable restricted cold-start rows; no policy in YOLO and no handler edits. Denial is not implicit-startup suppression evidence. |
| harden-acp-command-path-gate | Serialized shared-file predecessor | Actual numbered row 15 lands before this change, actual row 17 (P5d, formerly called row 15 in proposal prose). Serialize agent-config/opencode.json claims; retain predecessor build permission changes and add only explicit lsp denies to build and yolo. No yolo-byte-identical invariant spans this change. |
| package-pinned-omp-runtime | Packaging successor | Install final overlay/extension bytes before digest cuts; preserve pins and posture. |
| cover-omp-mocked-acp-lifecycle / finish-omp-mocked-skill-handoff | Regression/docs successors | Compare OpenCode against the file as landed after both numbered rows 15 and 17, never pre-batch snapshots. Document LSP-all-off for both agents and preserve unverified implicit-startup observations. |

- Shared-file conflict: `agent-config/opencode.json` is serialized row 15 → row 17. This change owns build+yolo LSP denials; unrelated predecessor grants/denials stay unchanged. Factory LSP branch changes follow row 9. Native-yolo overlay changes precede packaging digest cuts.
- Spec conflict: uniquely named ADDED requirements extend acp-integration. No existing native verdict is cleared, and no mock evidence upgrades support.
