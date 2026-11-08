# Tasks

Prerequisite: the baseline records validate. Verify with `cd migration/bun/baseline && bun install --frozen-lockfile && bun run --no-env-file validate.ts` printing `valid`.

Do not edit `migration/bun/baseline/records/`, `junit.ts`, `capture.ts`, `validate.ts`, `src/` or `tests/`.

## 1. Parser and record

- [ ] 1.1 Create `parity-exceptions.json` with the initial content in design D3.
- [ ] 1.2 Implement `parseBunJunit` in `migration/bun/baseline/parity.ts` per design D2, and add `parity.spec.ts` tests that parse a fixture string covering a flat test, a nested `describe` two levels deep, a skipped test and a failure with type and message. Verify: `cd migration/bun/baseline && bun test ./parity.spec.ts` passes.

## 2. Check

- [ ] 2.1 Implement the command, exception validation and algorithm per design D1, D3 and D4. Add one `parity.spec.ts` test per scenario in this change's spec (eleven scenarios), using small in-memory baseline, report and exception fixtures passed to an exported `checkParity(baseline, results, exceptions, options)` function. Verify: `cd migration/bun/baseline && bun test ./parity.spec.ts` passes with at least eleven additional tests.
- [ ] 2.2 Run the command end to end on real input. Verify: from the repository root, `mkdir -p .parity && bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/junit.xml tests/utils/hash.test.ts; (cd migration/bun/baseline && bun run --no-env-file parity.ts --junit .parity/junit.xml --scope tests/utils/hash.test.ts; echo "exit=$?")` prints a JSON summary listing every baseline test of that file as missing, then `exit=1`. The file is still Deno code, so Bun reports a load error and no test cases; this proves the failure path on real data.
- [ ] 2.3 Add `.parity/` to `.gitignore`. Verify: `git check-ignore .parity/junit.xml` prints the path.

## 3. Housekeeping

- [ ] 3.1 Confirm the existing tool tests still pass. Verify: `cd migration/bun/baseline && bun test ./baseline.spec.ts` passes and `bun run --no-env-file validate.ts` prints `valid`.
- [ ] 3.2 Verify scope: `git status --porcelain` lists only `migration/bun/baseline/parity.ts`, `parity.spec.ts`, `parity-exceptions.json`, `.gitignore` and this change directory.
