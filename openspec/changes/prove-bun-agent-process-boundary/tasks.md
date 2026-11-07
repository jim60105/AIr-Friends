# Tasks

Prerequisite: `migration/bun/poc/run-suite.sh` and `migration/bun/poc/gate/evidence.ts` exist. Verify with `test -x migration/bun/poc/run-suite.sh && test -f migration/bun/poc/gate/evidence.ts`.

Gate design D7 applies: a failing check is a result. Never weaken an assertion, threshold or size, and never edit the catalog. Do not edit product files, `Containerfile`, `run-suite.sh` or `gate/`. Do not commit `.evidence-wip/`.

## 1. Boundary

- [ ] 1.1 Create `process/agent-process.ts` per design D1 and `process/proc-tree.ts` per design D2. Verify: covered by 2.2.
- [ ] 1.2 Create `fixtures/children/producer.ts` and `fixtures/children/dual-writer.ts` per design D3. Verify: `bun run --no-env-file migration/bun/poc/fixtures/children/dual-writer.ts 131072 2>/dev/null | wc -c` prints `131072`.

## 2. Suite

- [ ] 2.1 Create `suites/process.spec.ts` with tests titled `PROC-01:` to `PROC-09:` following design D4, covering every scenario in this change's spec. Verify: covered by 2.2.
- [ ] 2.2 Run `migration/bun/poc/run-suite.sh process`. Verify: exit 0 and `.evidence-wip/x86_64/process.json` holds at least one test per ID, with `observations.spawnBackend` of `node` and a numeric `observations.sigkillSurvivors`. Report any failed ID.

## 3. Conditional fallback

- [ ] 3.1 Only if a PROC criterion failed in 2.2 from runtime behavior: add `process/agent-process-bun.ts` from design D5, dispatch to it when `POC_SPAWN_BACKEND=bun`, and rerun `POC_SPAWN_BACKEND=bun migration/bun/poc/run-suite.sh process`. Report results for both backends. If every criterion passed in 2.2, make no change, and mark this task done with the note `not required`. Verify: the note, or a `process.json` with `spawnBackend` of `bun`.
- [ ] 3.2 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/poc/process/`, `migration/bun/poc/fixtures/children/`, `migration/bun/poc/suites/` and this change directory.
