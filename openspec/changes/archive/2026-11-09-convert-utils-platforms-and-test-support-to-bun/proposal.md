# Proposal

## Why

Source design section 8 step 4 converts `src/` and `tests/` together to `node:*` and `bun:test`. This slice converts the shared utilities, types, the Discord and Misskey adapters, and the test helpers, mocks and fixtures that every later slice imports. It goes first so later slices find converted test support.

## What Changes

- Convert 14 `src/utils/` modules, `src/types/`, `src/platforms/` (except `email/`), and their tests with the codemod and the manual guide.
- Convert `tests/helpers/`, `tests/mocks/` and `tests/fixtures/`. The mock ACP agent and the OMP drivers become Bun programs (stdin and stdout through `process.stdin`/`process.stdout`); the commands that launch them are changed by the changes that own those launching tests.
- Convert `tests/utils/omp-packaging.test.ts` to the two-argument bundle wrapper introduced by `bundle-omp-extension-with-bun`.
- Hand-convert the two leftover non-high-risk uses in this slice's production files: `Deno.pid` in `src/utils/omp-native-cache.ts` and `Deno.open` in `src/utils/skill-secret.ts`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Behavior is unchanged; `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Files: design D1 (75 files).
- Not in this slice: `egress-proxy.ts`, `gelf-transport.ts` (`port-egress-proxy-and-gelf-to-node-net`), `process-lifecycle.ts` (`port-process-lifecycle-and-pool-to-bun`), `omp-version.ts`, `opencode-version.ts` (`port-command-call-sites-and-sandbox-probe-to-bun`).
- User-facing remedy strings that say `deno task ...` (for example in `omp-native-cache.ts`) stay until `rename-deno-runtime-identifiers`.
- P0 ownership: none. `tests/utils/ssrf.test.ts` (a design section 6 security test) is converted here with its intent unchanged.
- No human review document.

## Batch:

depends-on: add-bun-conversion-codemod
depends-on: add-bun-test-parity-check
depends-on: adopt-dprint-oxlint-and-tsc
depends-on: bundle-omp-extension-with-bun

Conflict note: first `convert-*` slice; every other `convert-*` change depends on it because they import `tests/helpers/` and `tests/mocks/`. File sets of all `convert-*` changes are disjoint; only `parity-exceptions.json` can be shared.
