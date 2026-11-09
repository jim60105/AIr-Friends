# Tasks

Prerequisite: `migrate-ci-and-docs-to-bun` is applied and its CI run succeeded. Verify with `! git ls-files --error-unmatch deno.json 2>/dev/null && podman image exists localhost/air-friends:bun-local || podman build --target final -t air-friends:bun-local .`.

## 1. Restart persistence (P0-8)

- [x] 1.1 Create `tests/integration/restart-persistence.integration.test.ts` per design D1. Verify: `bun test tests/integration/restart-persistence.integration.test.ts` passes with four tests named after the spec scenarios.

## 2. Drill tooling

- [x] 2.1 Create `migration/bun/cutover/config.drill.yaml` and `drill.sh` per design D2. Verify: `sh migration/bun/cutover/drill.sh localhost/air-friends:bun-local <empty temp dir> smoke 1` writes `measurements/smoke.json` with one run whose `restartReady` is true; delete that file afterwards.
- [x] 2.2 Create `compare.ts` and `compare.spec.ts` per design D3. Verify: `cd migration/bun/cutover && bun test ./compare.spec.ts` passes (four scenarios).

## 3. Drill on the data copy

- [x] 3.1 Ask the owner for the data copy path and record its provenance in `TRIAL.md`. Verify: the path exists and `du -sh` of it is recorded.
- [x] 3.2 Measure the rollback image. Verify: `sh migration/bun/cutover/drill.sh ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059 <copy> deno 5` writes `measurements/deno.json` with five ready runs.
- [x] 3.3 Write `thresholds.json` from `measurements/deno.json` per design D3 and commit it (with `measurements/deno.json`) before the next task. Verify: `git log -1 --format=%cI -- migration/bun/cutover/thresholds.json` prints a time.
- [x] 3.4 Measure the Bun image and compare. Verify: `sh migration/bun/cutover/drill.sh localhost/air-friends:bun-local <copy> bun 5` then `cd migration/bun/cutover && bun run --no-env-file compare.ts measurements/deno.json measurements/bun.json thresholds.json` exits 0 (P0-3 stop and restart: `stopExit`, `stopSeconds`, `restartReady`, no leftover process).
- [x] 3.5 Rollback drill (P0-10). Verify: `sh migration/bun/cutover/drill.sh --rollback ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059 <bun scratch dir>` reports the rollback image ready.

## 4. Live trial (human-reviewed)

- [ ] 4.1 Write `migration/bun/cutover/TRIAL.md` per design D4 with the drill results filled in, and hand it to the owner for the live checks and sign-off. Verify: the owner's sign-off line is filled in; record the date.

## 5. Housekeeping

- [x] 5.1 Verify: `bun run fmt:check` and `bun run lint` exit 0, no data-copy file is tracked (`git status --porcelain` lists only the new test, `migration/bun/cutover/` files from design D2 to D4, and this change directory), and the scratch copies are deleted.
