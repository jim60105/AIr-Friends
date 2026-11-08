# Tasks

Prerequisite: `convert-acp-client-and-factory-to-bun` is applied. Verify with `test -f migration/bun/convert/README.md && ! grep -q '@std/yaml' src/acp/agent-factory.ts && command -v dumb-init`.

ACP timeouts stay client-side. Do not change the crash-signal message, timeouts or `DISCONNECT_TIMEOUT_MS`.

## 1. Boundary

- [ ] 1.1 Create `src/acp/agent-process.ts` per design D1. Verify: `grep -n 'toWeb' src/acp/agent-process.ts` shows `Readable.toWeb` only (no `Writable.toWeb`), and `grep -n 'process.env' src/acp/agent-process.ts` prints only the warning comment.
- [ ] 1.2 Add `tests/acp/agent-process.test.ts` per design D4 (five scenarios). Verify: `bun test tests/acp/agent-process.test.ts` passes.

## 2. Connector and environment

- [ ] 2.1 Apply design D2 to `src/acp/agent-connector.ts`. Verify: `grep -n 'Deno\.' src/acp/agent-connector.ts` prints only comment lines and `grep -n '\.status\b' src/acp/agent-connector.ts` prints nothing that refers to the process.
- [ ] 2.2 Apply design D3. Verify: `grep -n 'DENO_DIR' src/acp/agent-factory.ts` prints nothing and `bun test tests/acp/agent-factory.test.ts tests/acp/agent-factory-omp.test.ts` passes.

## 3. Tests

- [ ] 3.1 Rewrite `tests/acp/agent-connector-env-isolation.test.ts` per design D4, including the two production-env tests (P0-1). Verify: `bun test tests/acp/agent-connector-env-isolation.test.ts` passes and the report lists both new test names.
- [ ] 3.2 Convert `agent-connector.test.ts`, `agent-connector-crash-signal.test.ts`, `agent-connector-process-monitor.test.ts` and `agent-connector-omp-artifacts.test.ts` with the codemod and README. Verify: `bun test tests/acp/agent-connector*.test.ts` passes with no deferred failure.
- [ ] 3.3 Parity. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/agent-process.xml tests/acp/agent-connector*.test.ts tests/acp/agent-factory.test.ts tests/acp/agent-factory-omp.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/agent-process.xml --scope tests/acp/agent-connector --scope tests/acp/agent-factory)` exits 0 without `--allow-deferred`.

## 4. Housekeeping

- [ ] 4.1 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
