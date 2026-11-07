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

**Goals:** committed, validated records of the freeze SHA, Deno test names and results, and coverage; a runbook and a validated record for the two operator steps.

**Non-Goals:**

- No Bun parity tooling; the parity gate belongs to the later cutover plan.
- No performance baseline (startup time, memory, file descriptors). Section 10 of the source design compares these, but step 1 does not list them and the old image stays runnable by digest, so the cutover plan owns them.
- No `master` branch-protection change. Freezing `master` is an owner decision outside the repository.
- No edit to `src/`, `tests/`, `deno.json`, `deno.lock`, `.gitignore`, the image, Helm or CI.
- No type-check, lint or format setup for `migration/`.

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
migration/bun/baseline/OPERATOR-RUNBOOK.md
migration/bun/baseline/records/deno-tests.json
migration/bun/baseline/records/baseline.json
migration/bun/baseline/records/operator-record.template.json
migration/bun/baseline/records/operator-record.json   # created by the operator
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
export interface OperatorRecord {
  schemaVersion: 1;
  performedBy: string;
  performedAt: string;      // ISO 8601
  image: { reference: string; digest: string; observedFrom: string };
  dataBackup: { archiveSha256: string; sizeBytes: number; entryCount: number; storageLabel: string };
}
export type BaselineState = "valid" | "pending" | "invalid";
export function validateBaselineDir(recordsDir: string): { state: BaselineState; problems: string[] };
```

`file` is the JUnit `classname` with a leading `./` removed. Sorting uses plain code-unit comparison on `file`, then `name`, and is stable, so repeated names keep their order. Durations are not recorded, so re-running capture yields a clean diff.

Validation rules: `image.digest` matches `^sha256:[0-9a-f]{64}$`; `image.reference` ends with `@<digest>`; `archiveSha256` matches `^[0-9a-f]{64}$`; `sizeBytes` and `entryCount` are integers above 0; `performedBy`, `observedFrom` and `storageLabel` are non-empty; `performedAt` parses as a date.

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

### D4. Operator boundary

The agent has no production access. It writes the runbook and the template and never fabricates `operator-record.json`. `validate.ts` reports `pending` until the operator commits that file. Runbook content, verbatim steps:

```bash
# Kubernetes deployment. Replace <ns> and <pod>.
kubectl -n <ns> get pod -l app.kubernetes.io/name=air-friends \
  -o jsonpath='{.items[0].metadata.name}{"\n"}{.items[0].status.containerStatuses[?(@.name=="air-friends")].imageID}{"\n"}'
kubectl -n <ns> exec <pod> -- tar -C /app -czf - data > air-friends-data-baseline.tgz
sha256sum air-friends-data-baseline.tgz
stat -c %s air-friends-data-baseline.tgz
tar -tzf air-friends-data-baseline.tgz | wc -l
```

For a Compose deployment, the digest comes from `docker inspect --format '{{index .RepoDigests 0}}' <image>` and the archive from `docker compose exec -T <service> tar -C /app -czf - data`. The runbook states that the archive holds user data and must stay outside the repository, and that `tar` reporting "file changed as we read it" means the operator repeats the step during a quiet period. Because this backup is the rollback safety net, it also states: run `kubectl -n <ns> exec <pod> -- find /app/data -name '*.db'` first; if any database file exists, stop the bot before taking the archive, because a file copied mid-write can be corrupt.

## Risks / Trade-offs

- [The host differs from CI, so environment-gated tests are ignored or fail] → Results are recorded as observed and `denoVersion` is recorded. The parity gate compares names; statuses are context.
- [Host `opencode` 1.18.23 and `omp` 18.18.0 are newer than the repository pins] → Same treatment; failures appear in the record instead of blocking capture.
- [`master` receives a security fix during the freeze] → Capture is refused on the moved `master`. Merge `master` into the branch, then run capture again.
