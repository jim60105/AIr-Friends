# Proposal

## Why

Source design section 10 requires, before the merge, an isolated run of the new image against a copy of `/app/data`, a comparison of startup time, memory, file descriptors and leftover processes with numeric thresholds fixed from baseline data before the comparison runs, and a working rollback to the old image. The Go record leaves P0-3 container stop and restart, all of P0-8 (restart persistence) and the rollback drill of P0-10 to step 8. The baseline records hold the rollback image digest (`migration/bun/baseline/records/rollback-reference.json`) but no resource measurements, so the Deno numbers are measured here from that image first.

## What Changes

- Add `tests/integration/restart-persistence.integration.test.ts`: memories, reminders, workspace files, the Skill API secret and JWT, and workspace isolation across a simulated restart on one data directory (P0-8, process level).
- Add `migration/bun/cutover/`: `drill.sh` (runs an image on a data copy, measures, stops, restarts, and runs the rollback image afterwards), `compare.ts` (threshold comparison) with `compare.spec.ts`, `config.drill.yaml` (all platforms disabled, health on), `thresholds.json` (written from the Deno measurements and committed before the Bun run), and `measurements/` (JSON results).
- Add the human-reviewed `migration/bun/cutover/TRIAL.md`: the live trial checklist (Discord, Misskey, Email, reminders, memory, Skill API, OpenCode, OMP with test accounts) and the deployment-parameter checklist (`env.ENV`, `AGENT_SKILLS_DIR`, ArgoCD Helm parameters), signed off by the owner.

## Capabilities

### New Capabilities

- `restart-persistence`: persisted state behaves the same after a daemon restart on the same data directory.
- `bun-cutover-drill`: the scripted pre-cutover container drill, threshold comparison and rollback check.

### Modified Capabilities

None.

## Impact

- New files only: the integration test and `migration/bun/cutover/`.
- Needs from the owner: a copy of production `/app/data` on the drill host (for example `kubectl cp`), the rollback image pull, and the live trial with test accounts. `TRIAL.md` is a human-reviewed document; its live checks are not automated.
- P0 ownership: **P0-8** (complete: process-level test plus container restart on a data copy), **P0-3** container stop and restart, **P0-10** rollback drill.
- `migration/bun/cutover/` is removed with the rest of `migration/bun/` by `cut-over-to-bun-release`, after its results are summarized in the changelog.

## Batch:

depends-on: migrate-ci-and-docs-to-bun
depends-on: package-bun-container-image

Conflict note: new files only. `cut-over-to-bun-release` depends on its recorded results.
