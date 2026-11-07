# Tasks

Run every `bun` command with working directory `migration/bun/baseline/` and with `--no-env-file`. Change nothing outside `migration/bun/`. Do not commit anything from `tmp/` or `coverage/`.

## 1. Record tool

- [ ] 1.1 Create `migration/bun/baseline/package.json` with `"private": true`, `"type": "module"`, and `fast-xml-parser` added by `bun add --exact fast-xml-parser@5.12.0`; commit the generated `bun.lock`. Create `migration/bun/README.md` stating that `migration/bun/` holds migration records and proof-of-concept material, is not part of the product, and can be deleted after a No-Go without affecting it. Verify: `bun install --frozen-lockfile` exits 0.
- [ ] 1.2 Create `junit.ts` with `parseDenoJunit(xml: string): BaselineTest[]` and `parseCoverageTable(text: string): CoverageSummary` per design D2 and D3, and `records-schema.ts` with the types and `validateBaselineDir` from D2. `records-schema.ts` imports only `node:*`. Verify: `bun test ./baseline.spec.ts` passes after task 1.3.
- [ ] 1.3 Create `baseline.spec.ts` using `bun:test` with inline XML, table and record fixtures covering every scenario of the requirements "Deno Test Result Record", "Coverage Summary Record", "Baseline Record Validation" and "Operator Record Validation". Records for `validateBaselineDir` are written into a `mkdtemp` directory. Verify: `bun test ./baseline.spec.ts` passes.
- [ ] 1.4 Create `capture.ts` per design D3. Export `decideFreeze(masterSha: string, mergeBase: string, driftedPaths: string[]): { ok: boolean; exitCode: 0 | 2; reasons: string[] }` and `decideCapture(junitExists: boolean): "write" | "abort"`, and add tests for the scenarios of "Capture Refuses A Drifted Tree" and "Failed Tests Are Recorded" with literal inputs. Verify: `bun test ./baseline.spec.ts` passes.
- [ ] 1.5 Create `validate.ts`: call `validateBaselineDir("records")`, print the state and problems, and exit 0 for `valid`, 3 for `pending`, 1 for `invalid`. Verify: run it now and confirm exit 1 because records do not exist yet.
- [ ] 1.6 Create `OPERATOR-RUNBOOK.md` with the steps of design D4 and `records/operator-record.template.json` holding every `OperatorRecord` field with placeholder values. Verify: `bun -e 'JSON.parse(await Bun.file("records/operator-record.template.json").text())'` exits 0.

## 2. Agent-run capture

- [ ] 2.1 Confirm `git rev-parse master` equals `git merge-base master HEAD`. Run `bun run --no-env-file capture.ts` in the background; the full Deno suite takes several minutes. Do not fix failing tests and do not retry to obtain a greener result. Verify: `records/deno-tests.json` and `records/baseline.json` exist, `freezeSha` equals the merge base, and `bun run --no-env-file validate.ts` exits 3 (`pending`). State `totals` and `coverage` in the task report.
- [ ] 2.2 Confirm isolation. Verify: `git status --porcelain` lists only paths under `migration/bun/` and this change directory, and `cd ../../.. && deno test --no-run migration/` reports "No test modules found".

## 3. Operator-run steps (agent must not attempt)

- [ ] 3.1 OPERATOR: follow `OPERATOR-RUNBOOK.md` to read the deployed image digest. Expected: a `sha256:` digest from `imageID`, not a tag. An agent stops here and reports that a human with production access must continue.
- [ ] 3.2 OPERATOR: back up `/app/data` per the runbook and store the archive outside the repository. Expected: checksum, byte size and entry count noted. The archive is never committed.
- [ ] 3.3 OPERATOR: copy the template to `records/operator-record.json`, fill in the real values, commit it, and confirm completion. Verify: `bun run --no-env-file validate.ts` exits 0 (`valid`).

## Workflow follow-up

- Archive only after tasks 3.1 to 3.3 are done by a human.
