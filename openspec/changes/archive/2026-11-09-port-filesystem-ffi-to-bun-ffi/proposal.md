# Proposal

## Why

`src/acp/filesystem-access-linux.ts` reaches libc through `Deno.dlopen` and `Deno.UnsafePointerView` for descriptor-only `openat2` and `statx` access, which has no `node:*` equivalent (source design sections 2 and 4.2). The Go record proved a `bun:ffi` backend (`migration/bun/poc/ffi/bun-linux-native-calls.ts`, FFI-01 to FFI-09, including the ENOSYS fail-closed path) on x86_64 and aarch64. P0-4 needs the production backend itself to pass on both architectures.

## What Changes

- Replace only the `Deno.dlopen` backend inside `getRealLinuxNativeCalls()` with `bun:ffi`, following the PoC backend. The `LinuxNativeCalls` interface, constants, struct encoders, caching and every caller stay unchanged (design section 4.2).
- Select the architecture with `runtimeArch()` (Bun reports `arm64`, Go record finding 2) and the OS with `runtimeOs()`.
- Convert `tests/acp/filesystem-access-linux.test.ts` and `tests/acp/filesystem-confinement.test.ts`, and add real-backend errno tests from the PoC suite.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: `Explicit Secure ACP Filesystem Platform Policy` names a working foreign-function interface instead of Deno FFI permission; adds `Real Backend Reports Kernel Errno`.

## Impact

- Edited: `src/acp/filesystem-access-linux.ts` (`getRealLinuxNativeCalls` body and imports only), two test files.
- P0 ownership: **P0-4** on x86_64 (real backend, errno path, fail-closed on unsupported platform). The aarch64 run of the same tests is `migrate-ci-and-docs-to-bun`'s native arm64 job; the seccomp-denied `openat2` run inside the image is `package-bun-container-image`.
- No human review document.

## Batch:

depends-on: convert-acp-policy-and-filesystem-to-bun
depends-on: add-bun-conversion-codemod

Conflict note: only this change edits `filesystem-access-linux.ts`. `rename-deno-runtime-identifiers` later edits `filesystem-confinement.ts`, not this file.
