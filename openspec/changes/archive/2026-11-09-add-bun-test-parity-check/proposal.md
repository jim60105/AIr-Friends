# Proposal

## Why

Source design section 6 makes test parity a cutover gate: every Deno test name recorded in `migration/bun/baseline/records/deno-tests.json` (3,836 tests) needs a Bun counterpart, or the migration record must say why it was removed or skipped. Each step 4 to 6 change needs a command that checks its own files against that record, and that tells a real failure apart from an expected "not converted yet" failure while the branch is allowed to be red (section 8).

## What Changes

- Add `migration/bun/baseline/parity.ts`, a command that reads a Bun JUnit report and compares it with `deno-tests.json`, limited to the file prefixes given with `--scope`.
- Add `migration/bun/baseline/parity-exceptions.json`, the migration record of removed, skipped and renamed tests, starting empty.
- Add `--allow-deferred`, which accepts a failing test only when its failure is `ReferenceError: Deno is not defined`, the signature of code a later step 5 change still has to port.
- Add tests in `migration/bun/baseline/parity.spec.ts`.
- Ignore `.parity/` (scratch JUnit output) in `.gitignore`.

## Capabilities

### New Capabilities

- `bun-test-parity`: comparison of Bun test results with the Deno baseline and the record of accepted differences.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/baseline/parity.ts`, `parity.spec.ts`, `parity-exceptions.json`. Edited: `.gitignore`.
- Reuses `migration/bun/baseline/junit.ts` (`fast-xml-parser` is already a dependency there) and `records-schema.ts`. No `src/` or `tests/` change.
- Removed with the rest of `migration/bun/` by `cut-over-to-bun-release`, after the final full-suite parity run.
- P0 ownership: none directly; it is the test-parity gate of success criterion 1.
- No human review document.

## Batch:

depends-on: add-bun-package-manifest

Conflict note: touches only `migration/bun/baseline/` and `.gitignore`. Every later change that needs an exception appends to `parity-exceptions.json`; apply those changes one at a time.
