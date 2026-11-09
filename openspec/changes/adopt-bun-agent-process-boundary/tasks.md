# Tasks

Prerequisite: `convert-acp-client-and-factory-to-bun` is applied. Verify with `test -f migration/bun/convert/README.md && ! grep -q '@std/yaml' src/acp/agent-factory.ts && command -v dumb-init`.

ACP timeouts stay client-side. Do not change the crash-signal message, timeouts or `DISCONNECT_TIMEOUT_MS`.

## 1. Boundary

- [x] 1.1 Create `src/acp/agent-process.ts` per design D1. Verify: `grep -n 'toWeb' src/acp/agent-process.ts` shows `Readable.toWeb` only (no `Writable.toWeb`), and `grep -n 'process.env' src/acp/agent-process.ts` prints only the warning comment. Prints `Readable.toWeb` on the stdout/stderr lines plus the `Writable.toWeb` warning in the stdin-adapter comment; `process.env` appears in the two "never spread" comments only.
- [x] 1.2 Add `tests/acp/agent-process.test.ts` per design D4 (five scenarios). Verify: `bun test tests/acp/agent-process.test.ts` passes. 6 pass, 0 fail: the five scenarios plus an extra regression case proving a write after the child closed stdin rejects instead of raising an uncaught stream error.

## 2. Connector and environment

- [x] 2.1 Apply design D2 to `src/acp/agent-connector.ts`. Verify: `grep -n 'Deno\.' src/acp/agent-connector.ts` prints only comment lines and `grep -n '\.status\b' src/acp/agent-connector.ts` prints nothing that refers to the process. `Deno.cwd()/skills` in a comment at line 449 is the only `Deno.` hit; `.status` prints nothing.
- [x] 2.2 Apply design D3. Verify: `grep -n 'DENO_DIR' src/acp/agent-factory.ts` prints nothing and `bun test tests/acp/agent-factory.test.ts tests/acp/agent-factory-omp.test.ts` passes. Prints nothing; 58 pass, 2 skip, 0 fail (the two egress-proxy `NO_PROXY` cases are the temporary, owner-owed skips recorded below, not failures).

## 3. Tests

- [x] 3.1 Rewrite `tests/acp/agent-connector-env-isolation.test.ts` per design D4, including the two production-env tests (P0-1). Verify: `bun test tests/acp/agent-connector-env-isolation.test.ts` passes and the report lists both new test names. 5 pass, 0 fail; the two new names are `F1 - OpenCode production env reaches the child exactly` and `F1 - OMP production env reaches the child exactly`. Both assert exact key equality with the built environment and the configured provider values.
- [x] 3.2 Convert `agent-connector.test.ts`, `agent-connector-crash-signal.test.ts`, `agent-connector-process-monitor.test.ts` and `agent-connector-omp-artifacts.test.ts` with the codemod and README. Verify: `bun test tests/acp/agent-connector*.test.ts` passes with no deferred failure. 115 pass, 0 fail. Process fakes now carry `exited`; the OMP realpath monkeypatches are `fsp.realpath`; the three `t.step` suites became `describe` + `test`.
- [x] 3.3 Parity. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/agent-process.xml tests/acp/agent-connector*.test.ts tests/acp/agent-factory.test.ts tests/acp/agent-factory-omp.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/agent-process.xml --scope tests/acp/agent-connector --scope tests/acp/agent-factory)` exits 0 without `--allow-deferred`. Exits 0: `baselineInScope 176, matched 173, missing [], failures [], deferred [], exceptionsApplied 5, ok true`. The same run with `--scope tests/acp/email-intent-runtime.test.ts` reports `baselineInScope 29, matched 29, deferred [], exceptionsApplied 0, ok true`, proving the restored 22 cases.

## 4. Housekeeping

- [x] 4.1 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory. Both exit 0. `git status --porcelain` lists the Impact files (`src/acp/agent-connector.ts`, `src/acp/agent-factory.ts`, the five `tests/acp/agent-connector*.test.ts`, `tests/acp/agent-factory.test.ts`, `migration/bun/baseline/parity-exceptions.json`), the two new files (`src/acp/agent-process.ts`, `tests/acp/agent-process.test.ts`) and this change directory. `tests/acp/email-intent-runtime.test.ts` carries the owner-owed un-skip of this change's 22 restored cases.
