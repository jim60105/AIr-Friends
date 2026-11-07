# Tasks

Run every `bun` command with working directory `migration/bun/baseline/` and with `--no-env-file`. Change nothing outside `migration/bun/`. Do not commit anything from `tmp/` or `coverage/`.

## 1. Record tool

- [x] 1.1 Create `migration/bun/baseline/package.json` with `"private": true`, `"type": "module"`, and `fast-xml-parser` added by `bun add --exact fast-xml-parser@5.12.0`; commit the generated `bun.lock`. Create `migration/bun/README.md` stating that `migration/bun/` holds migration records and proof-of-concept material, is not part of the product, and can be deleted after a No-Go without affecting it. Verify: `bun install --frozen-lockfile` exits 0.
- [x] 1.2 Create `junit.ts` with `parseDenoJunit(xml: string): BaselineTest[]` and `parseCoverageTable(text: string): CoverageSummary` per design D2 and D3, and `records-schema.ts` with the types and `validateBaselineDir` from D2. `records-schema.ts` imports only `node:*`. Verify: `bun test ./baseline.spec.ts` passes after task 1.3.
- [x] 1.3 Create `baseline.spec.ts` using `bun:test` with inline XML, table and record fixtures covering every scenario of the requirements "Deno Test Result Record", "Coverage Summary Record", "Baseline Record Validation" and "Rollback Reference Validation". Records for `validateBaselineDir` are written into a `mkdtemp` directory. Verify: `bun test ./baseline.spec.ts` passes.
- [x] 1.4 Create `capture.ts` per design D3. Export `decideFreeze(masterSha: string, mergeBase: string, driftedPaths: string[]): { ok: boolean; exitCode: 0 | 2; reasons: string[] }` and `decideCapture(junitExists: boolean): "write" | "abort"`, and add tests for the scenarios of "Capture Refuses A Drifted Tree" and "Failed Tests Are Recorded" with literal inputs. Verify: `bun test ./baseline.spec.ts` passes.
- [x] 1.5 Create `validate.ts`: call `validateBaselineDir("records")`, print the state and problems, and exit 0 for `valid`, 1 for `invalid`. Verify: run it now and confirm exit 1 because records do not exist yet.

## 2. Agent-run capture

- [x] 2.1 Confirm `git rev-parse master` equals `git merge-base master HEAD`. Run `bun run --no-env-file capture.ts` in the background; the full Deno suite takes several minutes. Do not fix failing tests and do not retry to obtain a greener result. Verify: `records/deno-tests.json` and `records/baseline.json` exist, `freezeSha` equals the merge base, and `bun run --no-env-file validate.ts` exits 1 and its only problem is the absent rollback reference. State `totals` and `coverage` in the task report.
- [x] 2.2 Confirm isolation. Verify: `git status --porcelain` lists only paths under `migration/bun/` and this change directory, and `cd ../../.. && deno test --no-run migration/` reports "No test modules found".

## 3. Rollback reference

- [x] 3.1 Run the two commands in design D4 and write `records/rollback-reference.json`. Stop and report if design D4's stop condition applies.
- [x] 3.2 Commit `records/rollback-reference.json`. Verify: `bun run --no-env-file validate.ts` exits 0 (`valid`).

## Workflow follow-up

- Archive after `validate.ts` exits 0.
