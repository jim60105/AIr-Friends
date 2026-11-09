# Design

## Context

See `proposal.md`. Observed facts:

- `getRealLinuxNativeCalls()` (lines 202 to about 355): caches result or error; `Deno.build.os !== "linux"` → `unsupported_platform`; `Deno.build.arch` `x86_64`/`aarch64` → `X86_64_CONSTANTS`/`AARCH64_CONSTANTS`, else `unsupported_platform`; `OWNED_DEBIAN_LIBC_PATHS[arch]`; `Deno.realPathSync(libcPath)` failure → `secure_access_unavailable`; `Deno.dlopen` with eight symbols (`syscall`, `open`, `statx`, `read`, `write`, `ftruncate`, `close`, `__errno_location`) using `buffer` parameters, failure → `secure_access_unavailable`; `__errno_location()` null → `secure_access_unavailable`; errno read through `new Deno.UnsafePointerView(errnoPtr).getInt32()`; then builds `cachedRealNativeCalls`. These are the file's only seven `Deno.` uses.
- PoC `createBunLinuxNativeCalls(init?)` uses the same checks with `process.platform`/`process.arch`, `realpathSync`, `dlopen(realLibcPath, SYMBOLS)` where `SYMBOLS` uses `ptr` for buffers and `i64`/`u64` for sizes, `ptr(buffer)` to pass `Uint8Array`s, and `read(errnoLocation, 0)` (`bun:ffi` `read.i32`) re-resolving `__errno_location()` per failure. It returns `{ calls }` or `{ error }` without caching.
- PoC criteria proved: constants alignment, `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS` returning `ELOOP` (40), `EXDEV` (18), `ENOENT` (2), `statx` parsing, 10,000 alternating failures with yields and no errno mismatch, and ENOSYS (seccomp, `deny-openat2.json`) mapped to `secure_access_unavailable`.

## Goals / Non-Goals

**Goals:** the production backend on `bun:ffi` with the exact failure reasons and messages; real-backend errno tests in `tests/`.

**Non-Goals:**

- No change to `LinuxNativeCalls`, constants, `encodeOpenHow`, `parseStatxBuffer`, `performLinuxSecureAccess`, `mapLinuxErrnoToFailure` or any caller.
- No seccomp test in `tests/` (needs a container; owned by `package-bun-container-image`).
- No libc path change.

## Decisions

### D1. Backend body

Inside `getRealLinuxNativeCalls()`, keep the caching and the exact `reason`/`message` strings, and replace:

| Deno | Bun |
| --- | --- |
| `Deno.build.os` | `runtimeOs()` |
| `Deno.build.arch` | `runtimeArch()` (`x86_64`/`aarch64`) |
| `Deno.realPathSync` | `fs.realpathSync` |
| `Deno.dlopen(path, {...parameters/result...})` | `dlopen(path, SYMBOLS)` from `bun:ffi`, with `SYMBOLS` copied from the PoC |
| passing `Uint8Array` for `buffer` | `ptr(view)` from `bun:ffi` for each buffer argument |
| `new Deno.UnsafePointerView(errnoPtr).getInt32()` | `read.i32(symbols.__errno_location(), 0)`, re-resolved per call as in the PoC |
| `Deno.DynamicLibrary<...>` type | `DynamicLibrary<typeof SYMBOLS>` |
| `isize`/`usize` results | `i64`/`u64` results converted with `Number()` where the interface returns `number` |

Copy each `LinuxNativeCalls` method body from the PoC where it differs only by these mappings. The errno read must happen immediately after the failing call, before any other FFI or allocating call, as in both implementations.

### D2. Tests

- Convert both test files with the codemod and README. Names unchanged.
- Add to `tests/acp/filesystem-access-linux.test.ts`, gated by `test.skipIf(runtimeOs() !== "linux")`: `Real backend - openat2 reports ELOOP for a symlink and EXDEV for an escape`, `Real backend - 10,000 alternating ENOENT and success with event-loop yields`, ported from `migration/bun/poc/suites/ffi.spec.ts` (FFI-03, FFI-04, FFI-06), calling `getRealLinuxNativeCalls()` instead of the PoC factory.
- `tests/acp/filesystem-confinement.test.ts` (a design section 6 security test) keeps its intent; the `/home/deno` and `/deno-dir` expectations stay until `rename-deno-runtime-identifiers`.

## Risks / Trade-offs

- [errno is clobbered by Bun internals between the call and the read] → The PoC's 10,000-call alternation is the check, now on the production backend.
- [`ptr()` of a zero-length buffer] → Keep the existing `emptyCString` (one NUL byte) for empty paths, as production does.

## Design deviations (apply time)

| File | Change | Owner / authority |
| --- | --- | --- |
| `src/acp/filesystem-access-linux.ts` | D1's table names `DynamicLibrary<typeof SYMBOLS>`; the installed `@types/bun` 1.4.2 exports the equivalent public type as `Library<Fns extends Symbols>` (`node_modules/bun-types/ffi.d.ts:531`), so `dylib` is typed `Library<typeof symbolSpec>`. The symbol table, signatures, conversions and failure messages are otherwise exactly D1's. | This change owns the file. `tests/acp/filesystem-access-linux.test.ts` passes against the real backend. |
| `src/acp/filesystem-access-linux.ts` | The symbol table is a `symbolSpec` const inside `getRealLinuxNativeCalls()` rather than a module-level `SYMBOLS`. Task 1.1 requires the diff to stay inside the function and the import block; the function is the table's only user and it is built once per successful initialization. | This change owns the file. |
| `tests/acp/filesystem-access-linux.test.ts` | D2 gates the two real-backend tests with `test.skipIf(runtimeOs() !== "linux")`. The gate additionally skips when the design's owned libc path (`OWNED_DEBIAN_LIBC_PATHS[runtimeArch()]`) does not exist, so the suite stays green on a non-Debian Linux development host. It inspects only that named prerequisite: once the owned libc exists, any `dlopen`/symbol/null-errno initialization failure fails the test instead of skipping. The real ELOOP/EXDEV/ENOENT and 10,000-alternation proofs were executed on the real backend in the project's Debian 13.6 / bun 1.4.2 PoC image on the same host kernel; the Fedora host returns the designed `secure_access_unavailable`. | This change owns the file. |
