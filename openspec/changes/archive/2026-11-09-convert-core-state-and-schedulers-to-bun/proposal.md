# Proposal

## Why

Source design section 8 step 4 converts `src/` and `tests/` together to `node:*` and `bun:test`. This slice converts the persistent stores, schedulers, configuration loading, template rendering, memory recall and the two memory scripts. These hold the data formats that must stay byte-compatible with an existing `/app/data` (success criterion 4).

## What Changes

- Convert the 27 `src/core/` modules in design D1, `src/core/memory-recall/`, `scripts/migrate-memory-v2.ts`, `scripts/memory-recall-benchmark.ts`, and their tests, including four data-oriented integration tests.
- Replace `@std/yaml` with the `yaml` package in `src/core/config-loader.ts`, `@std/fs` `exists` with `pathExists`, and the Vento type import with the npm path.
- The memory tokenizer reads the vendored jieba dictionary with `fs.readFileSync` instead of `Deno.readFileSync`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-audit-log`: `Retention Cleanup` names the not-found condition without the Deno error class.

## Impact

- Files: design D1 (81 files).
- No persisted format changes: JSONL, Markdown memory files, reminder and scheduler state keep their exact bytes.
- `DENO_ENV` is still read; `rename-deno-runtime-identifiers` removes it.
- P0 ownership: none here; restart persistence (P0-8) is proved end to end by `drill-bun-cutover-and-rollback`, which reuses these stores.
- No human review document.

## Batch:

depends-on: add-bun-conversion-codemod
depends-on: add-bun-test-parity-check
depends-on: adopt-dprint-oxlint-and-tsc
depends-on: convert-utils-platforms-and-test-support-to-bun

Conflict note: file set disjoint from the other `convert-*` changes. Can be applied in any order relative to them after `convert-utils-platforms-and-test-support-to-bun`.
