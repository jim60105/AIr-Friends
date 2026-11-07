# Design

## Context

See `proposal.md` for motivation. Observed facts this design relies on:

- `master` and the merge base with `feat/migrate-to-bun` are both `734c8b0`; the branch adds only design documents so far.
- `deno test --junit-path=<file>` writes one `<testcase name classname>` per test and per step (step names look like `parent > step`). Ignored tests carry `<skipped/>`, failures carry `<failure>`.
- `deno coverage` prints `| File | Branch % | Function % | Line % |`. CI's awk reads `$3`, which is the Branch column, so the current "75%" floor is a branch floor. All three numbers are recorded; the design treats them as reference only.
- Bun loads `.env` from its working directory unless told otherwise, and the repository root has a real `.env`. Every Bun command here uses `--no-env-file` and runs with working directory `migration/bun/baseline/`.
- `deno test` with no path discovers `*.test.ts`, `*_test.ts` and `test.ts` anywhere in the repository, including under `migration/`. It does not match `*.spec.ts`, which `bun test` does match.
- The root `.gitignore` ignores entries named `coverage`, `data`, `dist`, `out`, `logs` and `*.lcov`. Do not use these names for record files.

## Goals / Non-Goals

**Goals:** committed, validated records of the freeze SHA, Deno test names and results, and coverage, plus a validated rollback reference for the deployed image.

**Non-Goals:**

- No Bun parity tooling; the parity gate belongs to the later cutover plan.
- No performance baseline (startup time, memory, file descriptors). Section 10 of the source design compares these, but step 1 does not list them and the old image stays runnable by digest, so the cutover plan owns them.
- No `master` branch-protection change. Freezing `master` is an owner decision outside the repository.
- No edit to `src/`, `tests/`, `deno.json`, `deno.lock`, `.gitignore`, the image, Helm or CI.
- No type-check, lint or format setup for `migration/`.
- No `/app/data` backup. Step 1 does not touch production data; cutover owns the backup decision.

## Decisions

### D1. Directory and files

Exact tree created by this change:

```text
migration/bun/README.md
migration/bun/baseline/package.json
migration/bun/baseline/bun.lock
migration/bun/baseline/junit.ts            # parseDenoJunit, parseCoverageTable
migration/bun/baseline/records-schema.ts   # validators; imports nothing outside node:*
migration/bun/baseline/capture.ts          # CLI
migration/bun/baseline/validate.ts         # CLI
migration/bun/baseline/baseline.spec.ts    # bun:test
migration/bun/baseline/records/deno-tests.json
migration/bun/baseline/records/baseline.json
migration/bun/baseline/records/rollback-reference.json
```

Alternative rejected: `docs/migration/`. `docs/` is a published docsify site and the records are large JSON files.

Tests use the `.spec.ts` suffix so bare `deno test` never discovers them. `records-schema.ts` stays free of third-party imports because the gate imports it without installing this package.

### D2. Record contracts

```ts
export type TestStatus = "passed" | "failed" | "ignored";
export interface BaselineTest { file: string; name: string; status: TestStatus }
export interface DenoTestRecord { schemaVersion: 1; tests: BaselineTest[] }
export interface CoverageSummary { branchPercent: number; functionPercent: number; linePercent: number }
export interface BaselineSummary {
  schemaVersion: 1;
  freezeSha: string;        // 40 hex
  branchHead: string;       // 40 hex
  capturedAt: string;       // ISO 8601
  denoVersion: string;      // first line of `deno --version`
  appVersion: string;       // "version" from deno.json
  command: string[];        // the exact deno test argv
  totals: { tests: number; passed: number; failed: number; ignored: number };
  coverage: CoverageSummary;
}
export interface RollbackReference {
  schemaVersion: 1;
  capturedAt: string;       // ISO 8601
  reference: string;        // <image>@sha256:<digest>
  digest: string;           // sha256:<64 hex>
  sourceRevision: string;   // 40 hex, org.opencontainers.image.revision label
  observedFrom: string;     // e.g. "kubectl imageID, namespace air-friends"
}
export type BaselineState = "valid" | "invalid";
export function validateBaselineDir(recordsDir: string): { state: BaselineState; problems: string[] };
```

`file` is the JUnit `classname` with a leading `./` removed. Sorting uses plain code-unit comparison on `file`, then `name`, and is stable, so repeated names keep their order. Durations are not recorded, so re-running capture yields a clean diff.

Validation rules: `digest` matches `^sha256:[0-9a-f]{64}$`; `reference` ends with `@<digest>`; `sourceRevision` equals `freezeSha` in `baseline.json`; `observedFrom` is non-empty; `capturedAt` parses as a date. A missing record file is `invalid`.

### D3. Capture flow

`capture.ts`, run as `bun run --no-env-file capture.ts` from `migration/bun/baseline/`:

1. `repoRoot = resolve(import.meta.dir, "../../..")`. All git and deno commands run with that working directory.
2. `freezeSha = git merge-base master HEAD`. If `git rev-parse master` differs, exit 2.
3. Drift check on the paths `src tests deno.json deno.lock`: `git diff --name-only <freezeSha> HEAD -- <paths>` and `git status --porcelain -- <paths>` must both be empty; otherwise print them and exit 2.
4. In a fresh `mkdtemp` directory run, with `NO_COLOR=1` added to the inherited environment:

   ```text
   deno test --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys --coverage=<tmp>/cov --junit-path=<tmp>/junit.xml tests/
   ```

   `tests/` is passed explicitly so the run ignores `test-repo/`, `build/` and `.worktrees/`. A non-zero exit is expected data. A missing `junit.xml` means exit 3.
5. `deno coverage <tmp>/cov --exclude=tests/` with `NO_COLOR=1`, then parse the table. This matches the exclude used by `.github/workflows/ci.yaml`.
6. Write `records/deno-tests.json` and `records/baseline.json` with two-space JSON and a trailing newline.

`fast-xml-parser` is configured with `ignoreAttributes: false`, `attributeNamePrefix: ""`, `processEntities: true`, and `isArray` returning true for `testsuite` and `testcase`. Walk `testsuites.testsuite[].testcase[]` and any nested `testsuite`. Do not read the `<failure>` body.

### D4. Rollback reference

The agent reads the deployed image itself. Both commands are read-only:

```bash
kubectl -n air-friends get pods -o jsonpath='{range .items[*].status.containerStatuses[?(@.name=="air-friends")]}{.imageID}{"\n"}{end}'
skopeo inspect --format '{{index .Labels "org.opencontainers.image.revision"}}' docker://<reference>
```

If the pod reports several digests, or the revision differs from `freezeSha`, stop and report it to the owner. Do not choose a digest and do not edit the record to pass. At proposal time the deployed image was `ghcr.io/jim60105/air-friends@sha256:fad837549aaeeadb7ac6be51d58cdb2f25c3effb0dedc8abbf0eb32df93b0059`, revision `734c8b03c60a021a3982a07d18c3c3f75962c472`; the record uses values read at capture time.

## Risks / Trade-offs

- [The host differs from CI, so environment-gated tests are ignored or fail] → Results are recorded as observed and `denoVersion` is recorded. The parity gate compares names; statuses are context.
- [Host `opencode` 1.18.23 and `omp` 18.18.0 are newer than the repository pins] → Same treatment; failures appear in the record instead of blocking capture.
- [`master` receives a security fix during the freeze] → Capture is refused on the moved `master`. Merge `master` into the branch, then run capture again.
