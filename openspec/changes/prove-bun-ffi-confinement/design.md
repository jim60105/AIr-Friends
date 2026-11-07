# Design

## Context

See `proposal.md` for motivation. Observed code facts:

- `src/acp/filesystem-access-linux.ts` touches `Deno` only inside `getRealLinuxNativeCalls()`. Its other imports are `import type`. Under Bun the module loads, and `performLinuxSecureAccess` runs without `Deno` when `options.nativeCalls` is given.
- Existing tests use `createFilesystemTestCalls`, which "does not certify libc or openat2". This change is the first real-kernel proof under Bun.
- `CanonicalRootInfo` needs `role`, `configuredPath`, `canonicalPath`, `identity`, `readOnly`. `CanonicalTarget` needs `targetIdentity` for reads and overwrites.
- The image runs the suites on Debian, so the owned libc paths exist, and `open`, `statx`, `read` and the rest are real.

## Goals / Non-Goals

**Goals:** implement `LinuxNativeCalls` with `bun:ffi` as the design section 4.2 backend would be, and prove criteria FFI-01 to FFI-09 through production logic.

**Non-Goals:**

- No edit to `src/acp/filesystem-access-linux.ts` or any other product file.
- No wiring into `filesystem-access.ts`, `client.ts` or the connector.
- No new native calls; the interface stays as it is.
- No change to `gate/catalog.ts`, `Containerfile` or `run-suite.sh`.

## Decisions

### D1. Backend

`migration/bun/poc/ffi/bun-linux-native-calls.ts`:

```ts
import { dlopen, ptr, read } from "bun:ffi";
import { realpathSync } from "node:fs";
import {
  AARCH64_CONSTANTS, encodeOpenHow, type LinuxArchitectureConstants, type LinuxNativeCalls,
  OWNED_DEBIAN_LIBC_PATHS, parseStatxBuffer, X86_64_CONSTANTS,
} from "../../../../src/acp/filesystem-access-linux.ts";

export interface BunNativeInit { libcPath?: string }
export interface BunNativeResult {
  calls?: LinuxNativeCalls;
  error?: { reason: "unsupported_platform" | "secure_access_unavailable"; message: string };
}
export function createBunLinuxNativeCalls(init?: BunNativeInit): BunNativeResult;
```

Mirror `getRealLinuxNativeCalls()` step for step and keep its messages: platform check through `process.platform`, architecture mapping `x64` to `x86_64` and `arm64` to `aarch64`, `OWNED_DEBIAN_LIBC_PATHS` lookup, `realpathSync`, `dlopen` in a `try`. `init.libcPath` exists only so tests can force the failure paths. Do not cache the result in module state, so tests can build independent backends.

Symbol table, verbatim:

```ts
{
  syscall: { args: ["i64", "i64", "ptr", "ptr", "u64"], returns: "i64" },
  open: { args: ["ptr", "i32", "u32"], returns: "i32" },
  statx: { args: ["i32", "ptr", "i32", "u32", "ptr"], returns: "i32" },
  read: { args: ["i32", "ptr", "u64"], returns: "i64" },
  write: { args: ["i32", "ptr", "u64"], returns: "i64" },
  ftruncate: { args: ["i32", "i64"], returns: "i32" },
  close: { args: ["i32"], returns: "i32" },
  __errno_location: { args: [], returns: "ptr" },
}
```

Rules:

- Bun has no `isize`, so `read` and `write` return `i64`; apply `Number()` to every `i64` result.
- Pass buffers as `ptr(u8)`, and keep the `Uint8Array` in a local until the call returns. `ptr()` throws on an empty array; production callers never pass one, and a defensive early return is not needed.
- `getImmediateErrno = () => read.i32(symbols.__errno_location()!)`. Call it on the line after the failing call, with no allocation between. Resolving the location per failure, rather than once as the Deno backend does, avoids assuming that a cached thread-local address stays valid. A `null` from `__errno_location` at init fails closed as in production.
- `encodeCString` is private in production, so reimplement those six lines locally.

Alternative rejected: changing production to export `encodeCString` or accept a backend factory. That edits a product file.

### D2. Suite helpers and suites

`suites/ffi-helpers.ts` exports:

```ts
export function rootInfo(path: string): CanonicalRootInfo;   // role "workspace", readOnly false, identity from lstat
export function targetFor(path: string, relativePath: string): CanonicalTarget;
export function openFdCount(): number;                       // readdirSync("/proc/self/fd").length
```

Build the remaining `CanonicalTarget` fields with empty strings and empty arrays, cast through `unknown`. Identity numbers come from `lstatSync`.

Each test title starts with its criterion ID and a colon. All fixtures live in a `mkdtemp` directory under `/tmp`, removed in `afterAll`. Fixture tree: `root/real.txt`, `root/link.txt` (symlink to `real.txt`), `root/dir/`, and `outside.txt` next to `root/`.

| ID | Method |
| --- | --- |
| FFI-01 | Open `root` with `open(root, O_PATH or O_DIRECTORY or O_CLOEXEC)`; call `calls.openat2(rootFd, "link.txt", O_RDONLY or O_CLOEXEC, 0n, RESOLVE_BENEATH or RESOLVE_NO_SYMLINKS or RESOLVE_NO_MAGICLINKS)`; expect `errno` 40. Then `performLinuxSecureAccess` with `relativePath: "link.txt"`; expect `unsafe_traversal`. |
| FFI-02 | Same with `"../outside.txt"`; expect 18 and `outside_roots`. |
| FFI-03 | Same with `"missing.txt"`; expect 2 and `path_changed`. Then a write with `isNewFile: true` and `relativePath: "no-such-dir/new.txt"`; expect `parent_missing`. |
| FFI-04 | Loop `i` from 0 to 9,999 over the three failing paths by `i % 3`, asserting each `errno`. `await Bun.sleep(0)` when `i % 256 === 0`, `Bun.gc(false)` when `i % 1024 === 0`. |
| FFI-05 | Open `real.txt` read-only and `dir` with `O_PATH`; compare `statx` to `lstatSync(path, { bigint: true })` through `decodeLinuxDev`. Assert `mask` includes `STATX_TYPE` and `STATX_INO`. |
| FFI-06 | Three tests from the scenarios of "Secure Access Round Trip". Read content is 200 KiB of a repeated string containing `正體中文`. |
| FFI-07 | `createBunLinuxNativeCalls({ libcPath: "/nonexistent/libc.so.6" })`, then with a `mkdtemp` text file. Both: `calls` undefined, reason `secure_access_unavailable`. |
| FFI-08 | `suites/ffi-enosys.spec.ts`, run under the seccomp profile. `calls.openat2` returns `errno` 38; a read returns `secure_access_unavailable`. |
| FFI-09 | Record `openFdCount()`, run 1,000 operations cycling a read, a write and a denied symlink read, compare. |

## Risks / Trade-offs

- [A garbage collector or JIT frame clobbers `errno` between the call and the read] → FFI-04 is designed to expose this. A failure is No-Go evidence, under gate design D7.
- [Overlay filesystem identity on `/tmp`] → `lstat` and `statx` both report the same layer; if FFI-05 fails only because of the overlay, move fixtures to a path on the same filesystem and note it.
- [arm64 behavior differs] → Identical suites run on a native arm64 host in `record-bun-go-no-go`.
