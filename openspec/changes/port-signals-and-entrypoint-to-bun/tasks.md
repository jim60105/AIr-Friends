# Tasks

Prerequisite: `port-http-servers-to-bun-serve` and `port-process-lifecycle-and-pool-to-bun` are applied. Verify with `! grep -q 'Deno.serve' src/dashboard/server.ts && grep -q 'killProcessTree' src/utils/process-lifecycle.ts`.

## 1. Handlers and entry point

- [ ] 1.1 Apply design D1 to `src/shutdown.ts` and `src/core/error-handler.ts`, and design D2 to `src/core/error-handler.ts`. Verify: `grep -n 'Deno\.\|globalThis.addEventListener' src/shutdown.ts src/core/error-handler.ts` prints only comments.
- [ ] 1.2 Apply design D3 to `src/main.ts`. Verify: `grep -n 'Deno\.\|@std/flags' src/main.ts` prints nothing, and `bun run --no-env-file src/main.ts --help` prints the help text and exits 0.

## 2. Tests

- [ ] 2.1 Convert `tests/main.test.ts` per design D4. Verify: `bun test tests/main.test.ts` passes.
- [ ] 2.2 Add `tests/core/shutdown-signals.test.ts` per design D4 with one test per scenario in this change's specs plus the unhandled-rejection test. Verify: `bun test tests/core/shutdown-signals.test.ts` passes.

## 3. Step 5 source check

- [ ] 3.1 Verify: `grep -rnE 'Deno\.[A-Za-z]+' src | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)'` prints nothing other than uses in files owned by step 5 changes that are not applied yet (list them in the task report; the list is empty once all step 5 changes are applied).

## 4. Housekeeping

- [ ] 4.1 Parity. Verify: `bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/signals.xml tests/main.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/signals.xml --scope tests/main.test.ts)` exits 0.
- [ ] 4.2 Verify: `bun run fmt:check` and `bun run lint` exit 0, and `git status --porcelain` lists only the files in `proposal.md` Impact and this change directory.
