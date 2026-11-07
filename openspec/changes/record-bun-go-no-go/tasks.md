# Tasks

Prerequisite: every other change in the batch is applied, and `bun run --no-env-file validate.ts` in `migration/bun/baseline/` exits 0. Verify with `test -f migration/bun/poc/suites/injection-noconfig.spec.ts && test -f migration/bun/poc/suites/acp.spec.ts && test -f migration/bun/poc/suites/process.spec.ts && test -f migration/bun/poc/suites/ffi.spec.ts && test -f migration/bun/poc/suites/egress.spec.ts`.

Do not edit anything under `migration/bun/poc/` except what the commands below generate. Do not weaken, rerun selectively or hand-edit any evidence or record file.

## 1. Final x86_64 runs

- [ ] 1.1 Commit all pending work, then record the commit: `git rev-parse HEAD`. Verify: `git status --porcelain` is empty.
- [ ] 1.2 Run `migration/bun/poc/run-suite.sh <suite> --final` for each suite in design D1 order, in the background because `acp` is slow. Verify: `migration/bun/poc/evidence/x86_64/` holds seven JSON files, and each has the same `pocTreeSha256` and `gitHead` equal to the commit in 1.1. Report each failed test name.

## 2. Operator-run arm64 runs (agent must not attempt)

- [ ] 2.1 OPERATOR: on a native arm64 Linux host (not QEMU), with `git` and `podman`, check out the commit from task 1.1 and run `migration/bun/poc/run-suite.sh ffi --final` and `migration/bun/poc/run-suite.sh ffi-enosys --final`. Bring `migration/bun/poc/evidence/aarch64/ffi.json` and `ffi-enosys.json` back to this branch. Expected: both have `arch` of `aarch64` and the `pocTreeSha256` from task 1.2. An agent stops here and reports that a human with an arm64 host must continue.

## 3. Decision

- [ ] 3.1 From `migration/bun/poc/`, run `bun install --frozen-lockfile`, then `bun run --no-env-file gate/record.ts`. Verify: `GO-NO-GO.json` and `GO-NO-GO.md` exist, and `GO-NO-GO.md` has one `Outcome:` line. Report the outcome, blockers and observations.
- [ ] 3.2 Commit `migration/bun/poc/evidence/`, `GO-NO-GO.md` and `GO-NO-GO.json`. Then run `bun run --no-env-file gate/verify-record.ts`. Verify: exit 0.
- [ ] 3.3 Run the three commands in design D3. Verify: results as design D3 states.

## Workflow follow-up

- On Go: plan design section 8 steps 3 to 8 with these findings in a new proposal.
- On No-Go: an owner decides whether a blocker is solvable, and if not, `master` unfreezes.
