# Proposal

## Why

Source design section 10 ends the migration with one merge and the `0.37.0` release, after every P0 release blocker in section 9 passes. Section 1 requires that after the merge neither the repository nor the image depends on `deno`, and the migration material in `migration/bun/` is to be kept only until cutover. The Go record's open items P0-1 to P0-10 are owned by earlier changes; this change runs the final gates once more on the final tree, records the evidence, removes the migration material, and prepares the release.

## What Changes

- Run the final gates on the final tree: full test suite, full parity (no scope, no deferral), `check`, `lint`, `fmt:check`, the image smoke, and a repository-wide Deno reference check.
- Tick the section 9 checklist in `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, each box linked to its evidence (change name and CI run or test).
- Bump the version to `0.37.0` (`package.json`, `helm/Chart.yaml` `appVersion`; chart `version` 0.21.0 → 0.22.0 because `values.yaml` changed) and add the `[0.37.0]` changelog entry with every **BREAKING** item, the parity exceptions summary, the drill comparison and the rollback reference (old digest and old parameters).
- Delete `migration/bun/` and `.github/workflows/bun-poc-arm64.yml`, and remove the `.parity/` line from `.gitignore`.
- Remove the requirements of the migration-only capabilities (`bun-go-no-go-gate`, `bun-go-no-go-outcome`, `bun-migration-baseline`, the seven `bun-poc-*` capabilities, `bun-test-parity`, `bun-conversion-codemod`, `bun-cutover-drill`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bun-go-no-go-gate`, `bun-go-no-go-outcome`, `bun-migration-baseline`, `bun-poc-acp-resilience`, `bun-poc-acp-transport`, `bun-poc-agent-process`, `bun-poc-egress-proxy`, `bun-poc-filesystem-ffi`, `bun-poc-harness`, `bun-poc-injection-defenses`, `bun-test-parity`, `bun-conversion-codemod`, `bun-cutover-drill`: every requirement removed (the described material is deleted).

## Impact

- Edited: `package.json`, `helm/Chart.yaml`, `CHANGELOG.md`, `.gitignore`, the design document's section 9. Deleted: `migration/bun/`, `.github/workflows/bun-poc-arm64.yml`.
- Owner actions after this change (not tasks of this change): merge `feat/migrate-to-bun` into `master`, tag `v0.37.0`, switch the image through ArgoCD with the new parameters, keep the pre-cutover data backup, watch production for one week while fixing only migration regressions, then unfreeze `master` (section 10 steps 3 to 5).
- P0 ownership: **P0-10** final part (no known cutover blocker; all P0 evidence recorded). Every other P0 is re-verified, not newly proved.
- No human review document beyond the owner sign-off already in `TRIAL.md` (`drill-bun-cutover-and-rollback`), whose summary moves into the changelog.

## Batch:

depends-on: drill-bun-cutover-and-rollback
depends-on: migrate-ci-and-docs-to-bun

Conflict note: last change of the batch. It deletes `migration/bun/`, which every earlier change reads or writes, so nothing may be applied after it.
