# Tasks

Prerequisite: `migration/bun/poc/process/agent-process.ts` and `migration/bun/poc/process/proc-tree.ts` exist. Verify with `test -f migration/bun/poc/process/agent-process.ts && test -f migration/bun/poc/process/proc-tree.ts`.

Gate design D7 applies: a failing check is a result. Never weaken an assertion, threshold or size, and never edit the catalog. Do not edit product files, `Containerfile`, `run-suite.sh`, `gate/` or `process/`. Do not commit `.evidence-wip/`. If `process.json` in `.evidence-wip/` shows `spawnBackend` of `bun`, prefix every run with `POC_SPAWN_BACKEND=bun`.

## 1. Fixtures and driver

- [ ] 1.1 Create `acp/loopback-provider.ts` per design D1. Verify: covered by 2.2.
- [ ] 1.2 Create `acp/agents.ts` per design D2. Verify: covered by 2.2.
- [ ] 1.3 Create `acp/driver.ts` per design D3. Verify: covered by 2.2.

## 2. Suite

- [ ] 2.1 Create `suites/acp.spec.ts` with tests titled `ACP-NN-OC:` and `ACP-NN-OMP:` for NN of 01, 02, 03, 09 and 10, following design D4 and covering every scenario in this change's spec. Put the two ACP-01 tests first. Verify: covered by 2.2.
- [ ] 2.2 Run `migration/bun/poc/run-suite.sh acp`. If `ACP-01-OC` hangs under `--network=none`, stop and report it as the design D4 risk. Verify: exit 0 and `.evidence-wip/x86_64/acp.json` holds at least one test per ID, with `opencodeVersion` `1.18.21` and `ompVersion` `18.6.1`. Report any failed ID and whether the cause is transport, agent or harness.
- [ ] 2.3 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/poc/acp/`, `migration/bun/poc/suites/` and this change directory.
