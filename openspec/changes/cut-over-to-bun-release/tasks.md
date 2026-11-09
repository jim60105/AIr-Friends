# Tasks

Prerequisite: `drill-bun-cutover-and-rollback` is applied and `migration/bun/cutover/TRIAL.md` carries the owner's sign-off. Verify with `grep -qi 'sign-off' migration/bun/cutover/TRIAL.md && test -f migration/bun/cutover/measurements/bun.json`.

## 1. Final gates (before any deletion)

- [x] 1.1 Verify: `bun install --frozen-lockfile && bun run fmt:check && bun run lint && bun run check && bun test --timeout=120000 tests/` all exit 0.
- [x] 1.2 Full parity. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/final.xml tests/; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/final.xml)` exits 0; record the summary totals.
- [x] 1.3 Image smoke on the final tree. Verify: `podman build --target final -t air-friends:final . && podman build -f tests/image/Containerfile --build-arg IMAGE=localhost/air-friends:final -t air-friends:final-test . && sh scripts/image-smoke.sh localhost/air-friends:final localhost/air-friends:final-test` exits 0.

## 2. Evidence and release notes

- [x] 2.1 Apply design D2 to section 9 of `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`. Verify: `grep -c '^- \[x\]' docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md` prints `10` and no `- [ ]` remains in section 9.
- [x] 2.2 Bump versions (`package.json` `0.37.0`, `helm/Chart.yaml` `appVersion: "0.37.0"` and `version: 0.22.0`) and add the changelog entry per design D3. Verify: `grep -n '"version": "0.37.0"' package.json`, `grep -n 'appVersion: "0.37.0"' helm/Chart.yaml` and `grep -n '^## \[0.37.0\]' CHANGELOG.md` each print one line.

## 3. Remove migration material

- [x] 3.1 Delete `migration/bun/` and `.github/workflows/bun-poc-arm64.yml`, and remove `.parity/` from `.gitignore`. Verify: `git ls-files migration .github/workflows/bun-poc-arm64.yml` prints nothing, and `bun test --timeout=120000 tests/` still passes.
- [x] 3.2 Run design D1 (amended 2026-11-10; see the design's Recorded deviations). Verify: the five runtime-independence `git grep` checks all print nothing, and every reference-inventory hit is classified into the six recorded evidence classes with counts and examples in the task report; list any main-spec Deno mention found by `grep -rni deno openspec/specs` in the task report.

## 4. Housekeeping

- [x] 4.1 Verify: `openspec validate cut-over-to-bun-release --strict` exits 0, and `git status --porcelain` lists only the files in `proposal.md` Impact, `tests/acp/agent-factory-omp.test.ts`, `tests/acp/omp-owned-module-bundle-smoke.test.ts` (the recorded out-of-Impact fix) and this change directory.

## Workflow follow-up

- Owner: merge `feat/migrate-to-bun` into `master`, tag `v0.37.0`, and switch the ArgoCD application to the new image digest with `env.ENV` and the `/home/air` skill directory.
- Owner: keep the pre-cutover `/app/data` backup; on failure, return to the rollback digest and old parameters.
- Owner: unfreeze `master` after one week of stable production, fixing only migration regressions during that week.
