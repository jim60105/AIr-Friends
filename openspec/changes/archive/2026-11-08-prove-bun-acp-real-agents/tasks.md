# Tasks

Prerequisite: `migration/bun/poc/process/agent-process.ts` and `migration/bun/poc/process/proc-tree.ts` exist. Verify with `test -f migration/bun/poc/process/agent-process.ts && test -f migration/bun/poc/process/proc-tree.ts`.

Gate design D5 applies: a failing check is a result. Never weaken an assertion, threshold or size, and never edit the catalog. Do not edit product files, `Containerfile`, `run-suite.sh`, `gate/` or `process/`. Do not commit `.evidence-wip/`. If `process.json` in `.evidence-wip/` shows `spawnBackend` of `bun`, prefix every run with `POC_SPAWN_BACKEND=bun`.

## 1. Fixtures and driver

- [x] 1.1 Create `acp/loopback-provider.ts` per design D1. Verify: covered by 2.2.
- [x] 1.2 Create `acp/agents.ts` per design D2. Verify: covered by 2.2.
- [x] 1.3 Create `acp/driver.ts` per design D3. Verify: covered by 2.2.

## 2. Suite

- [x] 2.1 Create `suites/acp.spec.ts` with tests titled `ACP-NN-OC:` and `ACP-NN-OMP:` for NN of 01, 02, 03, 09 and 10, following design D4 and covering every scenario in this change's spec. Put the two ACP-01 tests first. Verify: covered by 2.2.
- [x] 2.2 Run `migration/bun/poc/run-suite.sh acp`. If `ACP-01-OC` hangs under `--network=none`, stop and report it as the design D4 risk. Verify: exit 0 and `.evidence-wip/x86_64/acp.json` holds at least one test per ID, with `opencodeVersion` `1.18.21` and `ompVersion` `18.6.1`. Report any failed ID and whether the cause is transport, agent or harness.
  Result: 9 of 10 tests pass. `ACP-02-OMP` fails agent-side: the pinned OMP
  `18.6.1` ends each model stream with its own `...stream stall and retrying.`
  notice and forwards 12,990 of the 16 MiB as `agent_message_chunk`, after 11
  provider requests in one prompt. In the 16 MiB run the provider wrote 2.4–6 MB
  of each attempt before OMP aborted the stream; with a complete 1 MiB script
  OMP still forwarded only 12,990 bytes. The same provider and chunking deliver
  16 MiB byte-identically to OpenCode, so the loss is the agent's, not the
  transport's or the harness's; the size is not lowered.
- [x] 2.3 Confirm isolation. Verify: `git status --porcelain` lists only `migration/bun/poc/acp/`, `migration/bun/poc/suites/` and this change directory.
  Result: the tracked tree is clean; the only other entry is the local,
  uncommitted `.omp-workspace-authorization.json` that os-apply requires.
