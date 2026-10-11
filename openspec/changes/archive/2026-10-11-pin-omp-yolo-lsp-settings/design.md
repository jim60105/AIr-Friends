## Context

See proposal.md for scope, budgets and dependency/conflict matrix. Archived `2026-10-08-translate-omp-owned-settings` landed a native-YOLO asset with no LSP keys, a matching constant and validator prohibition. Decision 5 supersedes that prohibition; the restricted asset already pins `lsp.enabled: false`.

## Goals / Non-Goals

Make the native-YOLO asset, emitted composition and validation agree on the same registered disable. Preserve native YOLO approval, provider identity, compaction and update posture. Factory/OpenCode LSP wiring and source audit remain row 17's work, and this package adds no restricted handler.

## Decisions

### D1. One shared deployment LSP pin

Move `lsp.enabled` from the restricted-only validator key set to the declared shared deployment set. Require boolean false for both modes. Update the native-YOLO YAML asset and matching constant together; tests parse the actual asset and validate the emitted composition. Reject missing/true/string-valued LSP settings and unknown `lsp.*` keys. Do not loosen validation for any other restricted-only field. Both modes retain their own overlay filenames and existing ordered selectors.

### D2. Explicit split from row 17

`disable-restricted-agent-lsp` owns `--no-lsp` in BOTH OMP launch branches plus OpenCode build+yolo `permission.lsp: deny`, with no global OpenCode clamp. It owns flag/permission-map tests and native implicit-startup source audit. This follow-up owns `native-yolo.yml` content plus settings schema/composition tests. Row 17 lands first; every original active row including final handoff lands before this row 25. Even when the flag exists, row 25 must add the YAML pin. The redundant deployment pin is intentional and never a restricted YOLO tool policy.

### D3. Remove superseded live assertions, preserve historical records

Update current settings module comments, tests and `docs/OMP_SETTINGS.md` that forbid any YOLO LSP key. Modify the existing non-contamination requirement rather than add a contradictory new requirement. Preserve no per-tool approval record/reset/provider-disable clamp in YOLO. Do not edit archived artifacts or any P0 pinned native compatibility requirement/ledger. The user decision supplies the new application disposition without changing the native contract's evidence.

### D4. Package consistency and checks

The original packaging row has already completed by this application point. Recut its installed-input digest manifest in this implementation commit; use the existing packaging manifest tooling and do not change runtime-version/checksum pins. Add focused consumer-visible asset/composition tests and a both-mode factory interface regression that consumes row 17's launch result without reimplementing its flag decisions. Update settings docs and changelog, and keep implicit-startup suppression unverified.

## Risks / Trade-offs

The shared pin changes an old D6 assertion. Limit the exception to LSP and retain all other mode non-contamination checks. YAML and the typed constant can diverge, so parsed emitted/asset comparison is paired with actual validator-result tests. A passed unit/mock suite proves repository-selected settings only; real binary implicit startup remains user-owned.

## Migration Plan

Rebuild the image with changed owned asset bytes after row 17 and all original rows. No state migration or compatibility shim. Reverting this implementation removes the added settings pin only, retaining row 17's both-mode flags and OpenCode permissions.
