# Design

## Context

See `proposal.md`. Observed facts:

- `migration/bun/baseline/records/deno-tests.json` is `{ schemaVersion: 1, tests: [{ file, name, status }] }` with 3,836 entries (3,827 passed, 9 ignored). `file` is repository-relative (`tests/acp/...`). Deno step names are recorded as `Parent > step` (for example `AgentConnector - MCP config conversion > should convert HTTP config correctly`). Repeated `file`/`name` pairs exist and are kept.
- `migration/bun/baseline/junit.ts` exports `parseDenoJunit` and `parseCoverageTable` and uses a `fast-xml-parser` `XMLParser` configured with `isArray` for `testsuite` and `testcase`; `records-schema.ts` exports `BaselineTest` and `validateBaselineDir`. `validate.ts` checks only the files in `records/`.
- Bun 1.4.2 JUnit output (`bun test --reporter=junit --reporter-outfile=<path>`), probed locally: `<testsuites><testsuite name="tests/x.test.ts" file="tests/x.test.ts">` holds `testcase` elements and one nested `<testsuite name="<describe>">` per `describe`. A `testcase` has `name`, `classname` (the innermost describe name or empty) and `file`. A skipped test has a `<skipped />` child. A failure has `<failure type="ReferenceError" message="Deno is not defined">`.
- Tests there are run with `cd migration/bun/baseline && bun test ./baseline.spec.ts` and use the `.spec.ts` suffix so `deno test` does not pick them up.

## Goals / Non-Goals

**Goals:** a deterministic scoped parity command with the three requirement behaviors and a JSON summary.

**Non-Goals:**

- No coverage comparison (the coverage floor is a CI check in `migrate-ci-and-docs-to-bun`).
- No edit to `records/`, `junit.ts`, `capture.ts` or `validate.ts` behavior.
- No running of `bun test` from inside the tool; the caller produces the report.

## Decisions

### D1. Command

```text
cd migration/bun/baseline
bun run --no-env-file parity.ts --junit <path> --scope <prefix> [--scope <prefix>...] [--allow-deferred]
```

`<path>` is resolved against the repository root (two levels up from this directory) when relative, never against the working directory: `--junit .parity/x.xml` run from `migration/bun/baseline` reads `<repo>/.parity/x.xml`. Every parity command in this batch relies on this. A baseline test is in scope when its `file` starts with any `--scope` value. No `--scope` means the whole baseline. Exit codes: 0 pass, 1 parity failure, 2 usage or unreadable input.

Standard producer, run from the repository root:

```text
mkdir -p .parity && bun test --timeout=120000 --reporter=junit --reporter-outfile=.parity/junit.xml <files or dirs>
```

`bun test` exits non-zero when a test fails; callers ignore that exit code and use the parity command's.

### D2. Bun report parsing

New exported function in `parity.ts`:

```ts
export interface BunTestResult {
  file: string;              // testsuite/testcase `file`, leading "./" removed
  name: string;              // describe chain and test name joined by " > "
  status: "passed" | "failed" | "skipped";
  failureType?: string;      // <failure type>
  failureMessage?: string;   // <failure message>
}
export function parseBunJunit(xml: string): BunTestResult[];
```

Walk each top-level `testsuite` (a file), then recurse into nested `testsuite` elements, pushing each nested suite's `name` onto a prefix stack. Use the same `XMLParser` options as `junit.ts`.

### D3. Exceptions record

`parity-exceptions.json`:

```json
{
  "schemaVersion": 1,
  "exceptions": [
    {
      "file": "tests/...",
      "name": "...",
      "disposition": "removed",
      "reason": "...",
      "replacement": { "file": "tests/...", "name": "..." }
    }
  ]
}
```

`disposition` is `removed`, `skipped` or `renamed`. `reason` must be non-empty after trim. `replacement` is required for `renamed` and forbidden otherwise. An exception that matches no baseline test is invalid. Invalid records make the check exit 1 with the problem listed. Initial content: `{ "schemaVersion": 1, "exceptions": [] }`.

### D4. Algorithm

1. Load the baseline and keep in-scope tests.
2. Count Bun results by `file + "\u0000" + name`.
3. For each in-scope baseline test, in record order: take one unconsumed Bun result with the same key. If none, look for an exception for that file and name: `removed`/`skipped` → accepted; `renamed` → take one unconsumed Bun result for the replacement key, else missing. Otherwise missing.
4. For each matched pair where the baseline status is `passed`: Bun `passed` → ok; Bun `failed` with `failureType === "ReferenceError"` and `failureMessage === "Deno is not defined"` → deferred; any other Bun `failed` → failure; Bun `skipped` → failure unless an exception with disposition `skipped` exists for it. Baseline `ignored` accepts any Bun status.
5. Exit 1 when there are missing names, failures, invalid exceptions, or deferred entries without `--allow-deferred`.

Output: one JSON object on stdout, `{ scope, baselineInScope, matched, missing: [{file,name}], failures: [{file,name,type,message}], deferred: [{file,name}], exceptionsApplied, invalidExceptions: [string] }`.

## Risks / Trade-offs

- [A converted test is renamed by accident, such as a whitespace change] → It shows as missing; the fix is to restore the exact name, not to add an exception.
- [Bun reports a describe-only skip differently] → `parseBunJunit` treats any `<skipped>` child as skipped; covered by a test case.
- [`ReferenceError: Deno is not defined` hides a test-side leftover] → The step 4 tasks also require `grep -c 'Deno\.'` to be zero in converted test files, so a deferred failure can only come from `src/`.
