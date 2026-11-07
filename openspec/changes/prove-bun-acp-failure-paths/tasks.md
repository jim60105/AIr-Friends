# Tasks

Prerequisite: `migration/bun/poc/acp/driver.ts` and `migration/bun/poc/suites/acp.spec.ts` exist. Verify with `test -f migration/bun/poc/acp/driver.ts && test -f migration/bun/poc/suites/acp.spec.ts`.

Gate design D5 applies: a failing check is a result. Never weaken an assertion, threshold or size, and never edit the catalog. Do not edit product files, `Containerfile`, `run-suite.sh`, `gate/`, `process/` or `acp/`. Do not commit `.evidence-wip/`. If `.evidence-wip/x86_64/acp.json` shows `spawnBackend` of `bun`, prefix the run with `POC_SPAWN_BACKEND=bun`.

## 1. Suite

- [x] 1.1 Create `suites/acp-failure.spec.ts` with tests titled `ACP-NN-OC:` and `ACP-NN-OMP:` for NN of 04 to 08, following design D1 and covering every scenario in this change's spec. Every test calls `expect`. Verify: covered by 1.2.
- [x] 1.2 Run `migration/bun/poc/run-suite.sh acp-failure`. Verify: exit 0 and `.evidence-wip/x86_64/acp-failure.json` holds at least one test per ID. Report any failed ID and whether the cause is transport, agent or harness.
- [x] 1.3 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/poc/suites/` and this change directory.
