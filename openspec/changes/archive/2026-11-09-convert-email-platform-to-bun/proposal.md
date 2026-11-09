# Proposal

## Why

Source design section 8 step 4 converts `src/` and `tests/` together to `node:*` and `bun:test`. This slice converts the Email platform: `src/platforms/email/`, the four `src/core/email-*` modules and their tests. Email persists journals and durable files with careful `open`/`sync`/`rename` sequences, so the hand-converted file-handle code is the risk here.

## What Changes

- Convert the 23 production files and 35 test files in design D1 with the codemod and the manual guide.
- Hand-convert `Deno.open`/`Deno.FsFile` in `durable-files.ts`, `mail-service.ts` and `message-store.ts` to `fsp.open` `FileHandle` calls with the same flags, mode and `sync` points.
- Test-side `Deno.serve`, `Deno.Command`, `Deno.open` and `Deno.exit` are converted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Behavior is unchanged; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Files: design D1 (58 files).
- Durable-file durability (write, `fsync`, rename, directory `fsync`) must stay step for step identical.
- P0 ownership: none.
- No human review document.

## Batch:

depends-on: add-bun-conversion-codemod
depends-on: add-bun-test-parity-check
depends-on: adopt-dprint-oxlint-and-tsc
depends-on: convert-utils-platforms-and-test-support-to-bun

Conflict note: file set disjoint from the other `convert-*` changes; any order after `convert-utils-platforms-and-test-support-to-bun`.
