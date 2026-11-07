# Proposal

## Why

`src/acp/filesystem-access-linux.ts` enforces filesystem confinement through `Deno.dlopen`, and no `node:*` API can replace it. If `bun:ffi` cannot deliver correct `errno` through the real `openat2`/`statx` path, the migration is not viable (source design `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`, sections 4.2, 8 and 9; section 3 notes the earlier probe does not count). Coverage reaches the production confinement logic, which already accepts an injected native-call object.

## What Changes

- Add a `bun:ffi` implementation of the existing `LinuxNativeCalls` interface under `migration/bun/poc/ffi/`.
- Add the `ffi` and `ffi-enosys` suites, which drive the unmodified production `performLinuxSecureAccess` through that backend against a real kernel, implementing criteria FFI-01 to FFI-09.
- No product file changes. The production backend stays on `Deno.dlopen` until the later plan.

## Capabilities

### New Capabilities

- `bun-poc-filesystem-ffi`: behavior the `bun:ffi` filesystem backend must prove against a real kernel before the migration may proceed.

### Modified Capabilities

None.

## Impact

- New: `migration/bun/poc/ffi/bun-linux-native-calls.ts`, `migration/bun/poc/suites/ffi.spec.ts`, `migration/bun/poc/suites/ffi-enosys.spec.ts`, `migration/bun/poc/suites/ffi-helpers.ts`.
- Reads production `src/acp/filesystem-access-linux.ts` at run time, unmodified.
- No human review document: every requirement is established by tests.

## Batch:

depends-on: define-bun-go-no-go-gate

Needs the image, `run-suite.sh`, the catalog and the failure policy (gate design D7). Conflict note: touches only its own new files, so it can be applied in any order relative to the other `prove-*` changes.

Deferred, not part of this batch: replacing the production backend is design section 8 step 5, planned only after a Go result.
