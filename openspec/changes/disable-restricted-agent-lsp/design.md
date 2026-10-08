# Design: disable-restricted-agent-lsp

## Context

The user decision register and follow-up clarification require LSP disabled in OMP restricted+YOLO and OpenCode build+yolo. Approved D6 and earlier restricted-only/no-YOLO-LSP-carrier statements are superseded only for LSP. Pinned verdicts and runtime evidence limits remain unchanged.

## Goals / Non-Goals

Goals are mode-specific OMP LSP disable wiring, explicit per-agent OpenCode lsp denials in both agents, and honest separation of explicit-tool removal from implicit startup. No version bump, global OpenCode clamp, replacement LSP, restricted YOLO handler, new config/env/Helm field or native runtime acceptance.

## Decisions

### D1. OMP disable carriers cover both modes

Restricted launch adds `--no-lsp` while preserving row 8's `restricted.yml` `lsp.enabled: false`. Native-yolo gets `lsp.enabled: false` in `agent-config/omp/native-yolo.yml` and/or `--no-lsp` in its launch branch. Implementation records the selected carrier and tests it; neither mode may remain without the disable. Settings order and mode-isolated state/env remain unchanged. This is an intentional exception to prior native-yolo no-LSP-key/no-LSP-flag assertions, with native YOLO approval posture and absence of restricted handler retained.

### D2. Pinned cold-start audit records residual coverage honestly

Audit OMP v18.6.1 at `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` for all enableLsp/lsp settings consumers, tool construction, read/edit/write diagnostics and format paths. Record source symbols and per-mode outcomes: no residual route, consultable restricted tool route, or native-internal/uncovered route. Only consultable restricted routes receive additive default-deny rows on existing lsp-adjacent inventory surfaces, enforced by 14b unchanged. Do not apply that restricted handler to YOLO or claim it closes a native-internal route. Preserve inherited unresolved/incompatible verdicts; any incomplete coverage stays explicit and runtime suppression stays unverified.

### D3. OpenCode explicit denial is per agent in both permission maps

Set `permission.lsp` to `deny` for both `build` and `yolo` in `agent-config/opencode.json`. Explicit denial is required for yolo because its wildcard default is allow. Keep unrelated permissions unchanged; do not add a top-level global `lsp: false` or equivalent clamp. Pinned OpenCode 1.18.21 at tree `826d9ad46a22bef0294998e08daa3c4904fea28f` remains the baseline. Audit implicit diagnostics/server boot separately; the recorded restricted-only implicit scoping incompatibility is not cleared by two explicit tool denials. Document any remaining implicit startup as uncovered/unverified without presenting the user disposition as native support.

### D4. Shared-file order is numbered row 15 then row 17

The batch index's actual row 15 is command-path hardening; this P5d change is actual row 17. Their opencode.json claims serialize in that order. Consume predecessor build permissions as landed; only the LSP denials intentionally change both maps here. Final lifecycle/handoff suites derive baselines after row 17, with no pre-batch yolo-byte-equality assertion.

### D5. Evidence stays source/mock/runtime-separated

Tests mechanically prove selected OMP carriers, build+yolo per-agent explicit denial, no global clamp, preservation of unrelated permissions, and conditional restricted cold-start decisions. They do not prove native server suppression, extension loading or implicit callback coverage. Permission docs/CHANGELOG and the final runtime checklist state decision 5 for both agents and list native implicit-startup observations for every mode as unverified.

## Risks / Trade-offs

Per-agent explicit denial may not stop implicit OpenCode server boot; the pin's recorded incompatibility remains. Native OMP cold-start can occur inside a tool without a consultable handler event; record that limit rather than inventing interception. YOLO intentionally loses LSP only, without inheriting restricted tool policy. A shared-file merge must retain row 15's unrelated permission posture.

## Migration Plan

Land config/flag LSP carriers together after numbered row 15 and before packaging. Rebuild picks up config bytes; no data migration. Rollback reverts this change's LSP-only config/flag and conditional additive rows without reverting predecessor permission changes.

## Open Questions

The native-yolo settings-versus-flag carrier is decided from the pinned supported surfaces at implementation and recorded in the handoff. No user decision is pending for LSP-all-off, and incomplete native coverage never changes the recorded verdicts.
