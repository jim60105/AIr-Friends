# Tasks

Prerequisite: `adopt-bun-agent-process-boundary` is applied. Verify with `test -f src/acp/agent-process.ts && command -v pgrep && command -v dumb-init`.

Do not change `awaitChildQuiescence` verdict logic or its timing constants.

## 1. Primitives

- [ ] 1.1 Port `processAlive`, `listChildPids` and `killPids` per design D1, export `listDescendantPids`, and add `killProcessTree` per design D2. Verify: `grep -n 'Deno\.' src/utils/process-lifecycle.ts` prints only comments.
- [ ] 1.2 Convert `tests/utils/process-lifecycle.test.ts` with the codemod and README, then add `killProcessTree - signals descendants deepest first, then the root` using the D5 fixture. Verify: `bun test tests/utils/process-lifecycle.test.ts` passes.

## 2. Connector and pool

- [ ] 2.1 Apply design D3. Verify: the `Escalated Disconnect Reaps The Agent Process Tree` tests (both scenarios, in `tests/acp/agent-connector-process-monitor.test.ts`) pass with `bun test tests/acp/agent-connector-process-monitor.test.ts`.
- [ ] 2.2 Convert `src/core/agent-process-pool.ts` (codemod) and apply design D4, including the `await` in `src/core/agent-core.ts`. Verify: `grep -n 'Deno\.' src/core/agent-process-pool.ts` prints only comments.
- [ ] 2.3 Convert `tests/core/agent-process-pool.test.ts` and `tests/core/omp-pool-modes.test.ts`, and add the two `Pool Stop Terminates Every Pooled Agent` scenarios to `agent-process-pool.test.ts`. Verify: `bun test tests/core/agent-process-pool.test.ts tests/core/omp-pool-modes.test.ts` passes.

## 3. Verification

- [ ] 3.1 Parity without deferral. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/lifecycle.xml tests/utils/process-lifecycle.test.ts tests/core/agent-process-pool.test.ts tests/core/omp-pool-modes.test.ts tests/acp/agent-connector-process-monitor.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/lifecycle.xml --scope tests/utils/process-lifecycle.test.ts --scope tests/core/agent-process-pool.test.ts --scope tests/core/omp-pool-modes.test.ts --scope tests/acp/agent-connector-process-monitor.test.ts)` exits 0.
- [ ] 3.2 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
