# Tasks

Prerequisite: every other change in the batch is applied, and `bun run --no-env-file validate.ts` in `migration/bun/baseline/` exits 0. Verify with `test -f migration/bun/poc/suites/injection-noconfig.spec.ts && test -f migration/bun/poc/suites/acp.spec.ts && test -f migration/bun/poc/suites/acp-failure.spec.ts && test -f migration/bun/poc/suites/process.spec.ts && test -f migration/bun/poc/suites/ffi.spec.ts && test -f migration/bun/poc/suites/egress.spec.ts`.

Do not edit anything under `migration/bun/poc/` except what the commands below generate and the arch-label normalization recorded as a deviation in `design.md`: without it Bun's `os.machine()` value (`arm64`) never matches the catalog's `aarch64`, so the gate drops the arm64 evidence. Do not weaken, rerun selectively or hand-edit any evidence or record file.

## 1. Final x86_64 runs

- [x] 1.1 Commit all pending work, then record the commit: `git rev-parse HEAD`. Verify: `git status --porcelain` is empty.
- [x] 1.2 Run `migration/bun/poc/run-suite.sh <suite> --final` for each suite in design D1 order, in the background because `acp` is slow. Verify: `migration/bun/poc/evidence/x86_64/` holds eight JSON files, and each has the same `pocTreeSha256` and `gitHead` equal to the commit in 1.1. Report each failed test name.

## 2. Arm64 runs through CI

- [x] 2.1 Scan the commits since `master` for secrets and private details, and stop and report any finding. Then push `feat/migrate-to-bun`, tag the commit from task 1.1 as `bun-poc-final-<short sha>`, and push that tag. Do not delete or move a pushed tag. Verify: `gh run list --workflow=bun-poc-arm64.yml` shows a run whose `headSha` is that commit.
- [x] 2.2 Wait for the run with `gh run watch <run id>`, then run `gh run download <run id> -n bun-poc-aarch64-evidence -D migration/bun/poc/evidence/aarch64/`. Verify: `ffi.json` and `ffi-enosys.json` exist with `arch` of `aarch64`, the `pocTreeSha256` from task 1.2 and `gitHead` equal to the commit from task 1.1. If the workflow produced no evidence, this is a harness bug: fix it in `build-bun-poc-harness` and restart from task 1.1 with a new tag. A failed test is evidence and is not a reason to rerun.

## 3. Decision

- [ ] 3.1 From `migration/bun/poc/`, run `bun install --frozen-lockfile`, then `bun run --no-env-file gate/record.ts`. Verify: `GO-NO-GO.json` and `GO-NO-GO.md` exist, and `GO-NO-GO.md` has one `Outcome:` line. Report the outcome, blockers and observations.
- [ ] 3.2 Commit `migration/bun/poc/evidence/`, `GO-NO-GO.md` and `GO-NO-GO.json`. Then run `bun run --no-env-file gate/verify-record.ts --live`. Verify: exit 0.
- [ ] 3.3 Run the three commands in design D3. Verify: results as design D3 states.

## Workflow follow-up

- On Go: plan design section 8 steps 3 to 8 with these findings in a new proposal.
- On No-Go: an owner decides whether a blocker is solvable, and if not, `master` unfreezes.
