# Proposal

## Why

The OMP trusted extension is bundled with `deno bundle --frozen` (`scripts/omp/bundle-extension.ts`), and the image build calls it. Source design section 5 replaces it with `bun build --format=esm` while keeping `scripts/omp/bundle-audit.ts` in force. The pinned OMP runtime is itself Bun-embedded, so the bundle target does not change.

## What Changes

- `scripts/omp/bundle-extension.ts` runs under Bun and invokes `bun build` instead of `deno bundle`, then applies the unchanged `bundle-audit.ts` predicate.
- `scripts/omp/bundle-omp-extension.sh` takes two arguments (`<src-root> <extension-target>`), requires `bun` instead of `deno`, and the bundler refuses to run when `<src-root>/bun.lock` or `<src-root>/node_modules` is missing. **BREAKING** for callers that pass the third `deno.lock` argument: the `Containerfile` (rewritten by `package-bun-container-image`) and `tests/utils/omp-packaging.test.ts` (converted by `convert-utils-platforms-and-test-support-to-bun`).
- Add the `bundle:omp-extension` script to `package.json`.
- `scripts/omp/prepare-native-cache.ts` is not part of this change: it imports `src/utils/omp-version.ts`, which spawns processes, so it moves with `port-command-call-sites-and-sandbox-probe-to-bun`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `container-packaging`: `Development-Path to Image-Path Resolution Contract` stops naming a "Deno-only" tree.
- Adds `OMP Extension Bundle Build` to `bun-toolchain` (introduced by `add-bun-package-manifest`).

## Impact

- Edited: `scripts/omp/bundle-extension.ts`, `scripts/omp/bundle-omp-extension.sh`, `package.json`. `scripts/omp/bundle-audit.ts` is unchanged.
- Until `package-bun-container-image` lands, the image build calls the wrapper with three arguments and fails. The branch may be red between steps 3 and 7 for the image (design section 8).
- P0 ownership: none.
- No human review document.

## Batch:

depends-on: add-bun-package-manifest

Conflict note: shares `package.json` and `bun.lock` with the other step 3 changes; apply one at a time. `convert-utils-platforms-and-test-support-to-bun` updates `tests/utils/omp-packaging.test.ts` to the two-argument wrapper.
