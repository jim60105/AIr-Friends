# Proposal

## Why

Step 4 of the source design converts `src/` and `tests/` together to `node:*` and `bun:test`. The tree holds about 460 `Deno.*` uses in `src/` and 7,870 in `tests/`, of which 3,376 are `Deno.test(` registrations and most of the rest are one-to-one filesystem and environment calls. Converting those by hand in seven separate changes would produce seven slightly different conventions. One tested codemod plus two small shared helper modules gives every step 4 change the same mechanical rewrite and leaves only the real decisions to people.

## What Changes

- Add `migration/bun/convert/codemod.ts`, a TypeScript-AST rewrite tool for the exact call shapes in the design table, with tests in `codemod.spec.ts` and a usage note in `migration/bun/convert/README.md`.
- Add `src/utils/runtime-platform.ts`: `runtimeArch()` and `runtimeOs()` return the values `Deno.build.arch` and `Deno.build.os` returned. Bun's `os.machine()` reports `arm64` on arm64 (Go record finding), so architecture names are normalized here once.
- Add `src/utils/fs-compat.ts`: errno classifiers for the three `Deno.errors` classes in use, `removePath` with `Deno.remove` semantics, `makeTempDir`/`makeTempFile` with Deno's option object, and `pathExists` with `@std/fs` `exists` semantics.
- Add Bun tests for both helper modules.
- No existing `src/` or `tests/` file is converted here.

## Capabilities

### New Capabilities

- `runtime-portability`: platform names, filesystem error classes and filesystem helper semantics that stay identical to the Deno behavior the application relied on.
- `bun-conversion-codemod`: the mechanical Deno-to-Bun rewrite tool used by the step 4 changes.

### Modified Capabilities

None.

## Impact

- New: `src/utils/runtime-platform.ts`, `src/utils/fs-compat.ts`, `tests/utils/runtime-platform.test.ts`, `tests/utils/fs-compat.test.ts`, `migration/bun/convert/codemod.ts`, `codemod.spec.ts`, `README.md`.
- The codemod imports the `typescript` package installed by `adopt-dprint-oxlint-and-tsc`.
- `migration/bun/convert/` is removed by `cut-over-to-bun-release`; the two `src/utils/` modules stay.
- P0 ownership: none directly. `runtimeArch()` is used by the FFI backend (P0-4) and the OMP native cache.
- No human review document.

## Batch:

depends-on: adopt-dprint-oxlint-and-tsc
depends-on: add-bun-test-parity-check

Conflict note: adds new files only. Every `convert-*` change depends on this change and runs the codemod on its own files.
