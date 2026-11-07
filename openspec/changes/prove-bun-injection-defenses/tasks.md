# Tasks

Prerequisite: `migration/bun/poc/run-suite.sh` and `migration/bun/poc/gate/evidence.ts` exist. Verify with `test -x migration/bun/poc/run-suite.sh && test -f migration/bun/poc/gate/evidence.ts`.

Gate design D7 applies: a failing check is a result. Never weaken an assertion, threshold or size, and never edit the catalog. Do not edit product files, `Containerfile`, `run-suite.sh` or `gate/`. Do not commit `.evidence-wip/`.

## 1. Fixtures

- [x] 1.1 Create `fixtures/skills/poc-skill/scripts/report.ts` (git mode 0755) and `helper.ts` beside it per design D1. Verify: `git ls-files -s` shows mode 100755 for `report.ts` after staging, and the first line matches design D1 byte for byte.
- [x] 1.2 Create `injection/attacker-dir.ts` per design D2. Verify: covered by 2.2.
- [x] 1.3 Create `injection/approval-grammar.ts` per design D3, importing from `../../../../src/acp/command-syntax.ts`. Verify: covered by 2.2.

## 2. Suites

- [x] 2.1 Create `suites/injection.spec.ts` with tests titled `INJ-01:` to `INJ-07:` following design D4, covering every scenario of the requirements "Working Directory Cannot Alter A Trusted Skill", "Home Directory Cannot Alter A Trusted Skill", "Trusted Config File Shape" and "Exact Approval Grammar". Verify: covered by 2.2.
- [x] 2.2 Run `migration/bun/poc/run-suite.sh injection`. Verify: exit 0 and `.evidence-wip/x86_64/injection.json` holds at least one test per ID and an `observations.bunOptionsEffective` value. Report any failed ID.
- [x] 2.3 Create `suites/injection-noconfig.spec.ts` following design D4, covering the requirement "Missing Trusted Config Stops The Skill". Run `migration/bun/poc/run-suite.sh injection-noconfig`. Verify: exit 0 and `.evidence-wip/x86_64/injection-noconfig.json` holds an `INJ-08:` test and `observations.missingConfigBehavior`. State the value, exit codes and stderr line in the task report.

## 3. Conditional launcher

- [x] 3.1 Only if `missingConfigBehavior` is `fallback`: add `injection/skill-launcher.sh` verbatim from design D5, add a variant of the INJ-01 to INJ-03 tests that starts the skill through the launcher, and rerun tasks 2.2 and 2.3. If it is `fail-stop`, make no change and mark this task done with the note `not required`. Verify: the note, or `INJ-08:` passed with the launcher present. — `not required`: observed `missingConfigBehavior` is `fail-stop`.
- [x] 3.2 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/poc/injection/`, `migration/bun/poc/fixtures/skills/`, `migration/bun/poc/suites/` and this change directory.
