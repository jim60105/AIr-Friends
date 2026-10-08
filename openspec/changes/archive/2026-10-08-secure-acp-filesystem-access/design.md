## Context

See proposal.md and approved integration design sections 8 and 14–15. Direct dependencies are `establish-omp-compatibility-contracts` and `canonicalize-acp-filesystem-roots`; consume their actual compatibility verdict, `CriticalSkillContract` provenance and `CanonicalSessionRoots`/`CanonicalTarget` observations. Those observations are neither grants nor held descriptors. Existing callbacks still use `Deno.readTextFile`/`Deno.writeTextFile` and remain unchanged here; the latter does not recursively create parents. Current start/test tasks already request `--allow-ffi`, and the Containerfile uses a Debian Deno/glibc image on x64/arm64.

The P0 reset incompatibility and unresolved native boundaries remain application gates. These artifacts can be complete while downstream application is blocked; a successful local filesystem test cannot clear the native verdict.

## Goals / Non-Goals

**Goals:** Complete reusable read/overwrite/create operations that bind protected content IO to a regular file opened by a supported constrained resolver under the caller-selected root. Return precise, bounded failures and release all native resources. Preserve the predecessor's session generation, root roles and read-only skills provenance without inventing permissions.

**Non-Goals:** Client callback adoption, per-mode/extension authorization, command parsing, mkdir/delete/move/patch, process/state root allocation, lifecycle staging provisioning, native OMP enforcement, cross-platform emulation, automatic fallback/retry or atomic replacement/rollback. No migration, shim, new deployment knob or native build pipeline.

## Decisions

### 1. Small operation API, explicit authority selection

Create `src/acp/filesystem-access.ts` exposing proposed AIr-owned `readCanonicalTextFile` and `writeCanonicalTextFile` operations; these names are not OMP/ACP wire APIs. Inputs are the current exact ACP session/context generation, predecessor roots and target observation, and one caller-selected root role already present in that observation. Writes receive text. Return a discriminated result: complete text/write success or one `FilesystemAccessFailure`, never partial successful authority. Reuse predecessor reasons where applicable and add only access-specific reasons below.

Reject missing/mismatched generation, invalid/nonrelative components, absent selected role, unavailable/nonexact `dev`/`ino`, and writes selecting `trusted-skills`. Linux metadata numbers must be finite safe integers before conversion to BigInt; no rounded identity or fabricated zero. The normalized/canonical observation is the only path input to the backend. Do not expand tokens again, consult process environment, look up another session, select a broader workspace root after a staging failure, or return descriptors to policy callers. A matching role is not a grant: row 4 remains responsible for authorization before invoking these operations. The access API does not take a YOLO flag or extension list.

The production backend lives in `src/acp/filesystem-access-linux.ts`. A small injectable native-call boundary supports deterministic failures/swap scheduling in tests, not a general filesystem abstraction. Ordinary Deno metadata/setup calls can be used in fixtures, never as an unsafe production content-IO fallback.

### 2. Explicit supported platform and existing system-libc dependency

Support **Linux, little-endian x86_64 and aarch64, GNU glibc >=2.28, kernel >=5.6 with working `openat2`, descriptor `statx`, and Deno FFI permission**. The actual constrained syscall, not an OS/version string, establishes capability; seccomp may deny it even on a new kernel. Initial owned libc locations are Debian's architecture paths `/lib/x86_64-linux-gnu/libc.so.6` and `/lib/aarch64-linux-gnu/libc.so.6`, resolved canonically to the system library before `Deno.dlopen`. No cwd/bare-name/LD_LIBRARY_PATH search, user-supplied module path or downloaded dependency. Other libc layouts are unsupported unless explicitly added with tests, not silently searched. The daemon's system library and ancestors are deployment-owned, outside agent-writable roots.

Use documented `Deno.dlopen` FFI with libc `syscall` for `openat2` (glibc has no public `openat2` wrapper), and fixed-signature libc `open`, `statx`, `read`, `write`, `ftruncate`, `close`, `__errno_location`. Keep Linux ABI constants, integer/pointer-only syscall declaration and the zero-filled 24-byte `open_how`/Linux `statx` layout together in the backend. Verify the x64/arm64 ABI/constant tables against Linux UAPI and glibc source during the bounded alignment task; do not use architecture-dependent `struct stat` offsets. `statx` device major/minor is compared to the predecessor Linux device encoding with exact integer arithmetic. Check returned metadata masks rather than assuming requested fields were supplied.

Calls remain synchronous, including immediate same-thread errno capture: a separate asynchronous FFI worker call followed by main-thread `__errno_location` would read the wrong thread's errno. Use only necessary operation-scoped descriptors and reuse content buffers. FFI bypasses Deno read/write sandbox checks; authority is established by this adapter and its trusted callers, not by `--allow-read`/`--allow-write`. No new FFI grant is needed in the existing tasks. A missing library/symbol/permission, unsupported architecture/libc, unavailable identity or missing/denied constrained syscall fails closed. A real supported-backend mismatch is an application blocker, not grounds to substitute a mock backend.

Source references (API/source evidence, not exercised native behavior):

- [Deno OpenOptions](https://docs.deno.com/api/deno/~/Deno.OpenOptions): no public root-relative dirfd/resolve controls; do not invent `noFollow` or `openat2` options.
- [Deno FFI](https://docs.deno.com/runtime/fundamentals/ffi/): library loading, native type declarations, permission and sandbox limits.
- [Linux openat2](https://man7.org/linux/man-pages/man2/openat2.2.html): libc syscall entry, resolve flags, kernel 5.6 availability, EAGAIN/ELOOP/EXDEV behavior. Do not require the much newer `OPENAT2_REGULAR` flag.
- [Linux statx](https://man7.org/linux/man-pages/man2/statx.2.html): fixed metadata contract and `AT_EMPTY_PATH` on an owned descriptor.
- [Linux UAPI openat2 structure](https://github.com/torvalds/linux/blob/v6.12/include/uapi/linux/openat2.h), [statx structure](https://github.com/torvalds/linux/blob/v6.12/include/uapi/linux/stat.h), and [glibc Linux device encoding](https://sourceware.org/git/?p=glibc.git;a=blob;f=sysdeps/unix/sysv/linux/bits/sysmacros.h;hb=glibc-2.40): concrete ABI/layout alignment references.

### 3. Pin canonical root identity, never reopen its alias

Open `/` as a directory capability, then open the selected existing canonical root relative to it with `openat2`, `O_PATH|O_DIRECTORY|O_CLOEXEC` and `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS`. Compare descriptor `statx` directory type/device/inode to the root observation before opening any content target. This avoids following newly introduced symlinks in an absolute root's parents. A configured root alias is supported because only the observed canonical destination is opened; changing the alias cannot redirect this operation. A replaced canonical root gives `path_changed`/no-follow failure, never a new authority.

The selected staging/shared/skills root itself is the target's dirfd boundary. Never open beneath the broader workspace and merely check a staging prefix. This prevents a later in-workspace staging-to-sibling symlink from acquiring the narrower grant. Root equality/overlap remains the predecessor's decision; the caller explicitly selects the allowed role.

Prospective roots and missing directory suffixes cannot supply a directory capability. Return `root_unavailable` or `parent_missing` without mkdir. Only a missing final file whose entire parent path exists is creatable. This deliberately preserves current write-with-existing-parents behavior; it does not erase predecessor prospective observations or relocate/precreate staging. Existing lifecycle owners provision staging, and row 4 must surface a missing provision rather than invent a mkdir fallback. Recursive safe directory materialization would require its own reviewed design because check-parent-then-mkdirat can race a directory rename; it is not smuggled into this read/write slice.

### 4. No-follow actual opens and descriptor-only content IO

Reject a target observation containing request-time parent/final symlink evidence as `unsafe_traversal`, even when contained. This is the predecessor's explicitly allowed unsupported-traversal outcome, not a change to its canonicalization eligibility. Root alias evidence is distinct from child traversal. For all admitted root-relative target opens use `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS` and `O_CLOEXEC|O_NOFOLLOW`; a newly inserted symlink likewise fails. `O_NOFOLLOW` alone only protects the last component and is not the chosen mechanism. Do not traverse `/proc/self/fd` or use a path-checked openat component walk as an equivalent resolver.

- **Existing read:** open the full root-relative canonical destination read-only, without creation. Check regular-file type and exact target device/inode using descriptor `statx`, then read and UTF-8 decode from that descriptor until EOF. Empty and multibyte text are returned correctly. No raw-path readback or line-policy expansion.
- **Existing overwrite:** open write-only without `O_TRUNC` or `O_CREAT`; check the same type/identity before `ftruncate(fd, 0)` and writing encoded UTF-8 on that same descriptor. Complete short writes; zero-progress/error is failure. Do not reopen by path after the check. A replacement file must never be truncated just because opening it succeeded.
- **New final file:** verify the observed existing directory ancestor through a constrained root-relative directory open and descriptor identity. Then open the **full destination relative to the selected root**, not a detached parent descriptor, with `O_CREAT|O_EXCL` and mode `0600` (subject to umask). `O_EXCL` ensures a raced-in regular file or final symlink cannot be overwritten. A raced-in parent symlink is rejected by constrained resolution. Encode/write on the returned new regular-file descriptor. Missing intermediate directories fail with no creation attempt. No atomic rename protocol or path-based cleanup unlink.

Use nonblocking open flags to avoid hanging on a raced-in FIFO, and check descriptor type before content calls. Reject special nodes and directories; this does not claim that arbitrary device creation or hostile privileged mounts are sandboxed by a pathname helper. Partial writes/create failures may leave a partial or empty file **inside the selected root**: there is no transaction/rollback promise. Preserve existing overwrite semantics rather than introduce temp-file replacement, permission migration or inode-changing behavior.

### 5. Honest replacement semantics and error contract

The containment boundary is constrained kernel name resolution beneath the identity-checked root descriptor, followed by IO on that opened file, not continuously frozen pathname membership. External rename/unlink cannot make this descriptor reopen a different target; the adapter does not promise to revoke an already opened inode if another actor later moves it. Likewise inode identity does not detect concurrent same-inode content edits or prove inode uniqueness across hard links. Deployment/root ownership and native non-ACP execution remain separate boundaries. No portable sequence of pre/post realPath checks supplies namespace freezing or atomic rollback.

| Condition before protected content IO | Result |
| --- | --- |
| Context/generation or selected role mismatch | `invalid_context` / `outside_roots`; no native target content operation |
| Missing or nonexact metadata identity | `identity_unavailable`; no optimistic equality |
| Existing canonical root/final file identity differs | `path_changed`; no read/truncate/write of replacement |
| Known or newly introduced child/parent/final symlink | `unsafe_traversal`; no content access through link |
| Resolver cannot establish beneath containment (EAGAIN/EXDEV) | `path_changed` / `outside_roots`; no automatic retry |
| Existing file disappears | `path_changed` (or `not_found` for a freshly missing existing-only request); no create downgrade |
| Observed new file races an existing entry (EEXIST) | `path_changed`; no overwrite downgrade |
| Missing root/parent directory | `root_unavailable` / `parent_missing`; no recursive mutation |
| Directory, nonregular node, or ENOTDIR | `wrong_target_type`; no content mutation |
| OS/libc/FFI/syscall mechanism unavailable | `unsupported_platform` / `secure_access_unavailable`; no ordinary IO fallback |
| Access denied or read/write/truncate failure | `access_denied` / `io_failed`; preserve cause internally, not content/secret/raw unbounded error |

Revalidate available root/ancestor/final identities before the relevant content step, with detectable changes reported. Ancestor identity checks are not atomic rename locks: a replacement that remains beneath the same selected root may be indistinguishable after the check, particularly during new-file creation. The security guarantee is no external/sibling redirection, not detection of every possible in-root namespace rearrangement. Tests must state the exact swap point and assert this real guarantee instead of simulating a nonexistent filesystem transaction.

Close every successfully acquired file/root/ancestor descriptor in `finally` on all paths. Native handles are not Deno resource IDs: do not fabricate `new Deno.FsFile(fd)` or route them through Node/Deno fd tables. Capture errno immediately; do not retry `close` after EINTR because descriptor reuse can make that unsafe. Preserve a primary IO failure while recording cleanup failure internally; a cleanup failure without another failure returns `io_failed`, not false success. No content or secret logging is added; row 4 maps the bounded reason to its existing diagnostics.

### 6. Tests and documentation are delivered with primitives

Tests call the actual exported operations with real predecessor observations, and the actual libc backend on supported local Linux. Temp fixtures verify bytes, target identity/roles and unchanged external/sibling sentinels. Cover workspace/shared/staging/skills reads, existing overwrite, empty/Unicode/multichunk content, exclusive creation, root aliases, absent parents/prospective staging, directories, parent/final contained/escaping links, same-prefix siblings, and trusted-skills write rejection. Modes are not implemented here: tests show the caller-selected broad workspace role is not narrowed to staging, while selecting staging cannot broaden to workspace.

A narrow native-call mock/instrumented boundary schedules real fixture replacement before root/target opens and between file-open/identity/truncate steps, then invokes real primitives. Assert replacement rejection before protected content calls, external bytes unchanged, exclusive-create EEXIST denial, and descriptor-only behavior after a validated file is detached/replaced. Mock native results cover unavailable OS/ABI/FFI/syscalls, missing statx fields/nonexact identities, errno mapping, short reads/writes, interruption/error, zero-progress and cleanup on failure. ABI-layout fixture tests cover both supported architecture tables; they do not attest an unexecuted architecture. Never assert success by merely copying flags or counting forwarding calls.

Update `docs/AGENT_PERMISSIONS.md` and `CHANGELOG.md` with supported platform requirements, symlink/missing-parent outcomes, direct-system-libc/no-new-package decision, descriptor/namespace distinction, partial-IO limits, unchanged callbacks and row 4 handoff. Explicitly mark real agent delegation, deployment libc/seccomp behavior, architecture images and bwrap as user-owned/unverified. Examples/env/Helm and packaging are intentionally unchanged because no field or native artifact is added.

## Risks / Trade-offs

- **FFI is privileged and ABI-sensitive** → Fixed owned system paths, narrow declarations, exact layouts/masks, two-architecture fixture checks and fail-closed runtime capability detection; no claim of native acceptance from mocks.
- **Blocking libc IO** → Regular-file-only content IO, reusable bounded chunks and synchronous errno correctness. No worker/retry subsystem; existing APIs already read/write entire text payloads.
- **Contained symlinks now fail on adoption** → Explicit rejection contract and documentation, permitted by the root-observation predecessor; no hidden raw-path fallback.
- **Stale namespace/partial writes** → Pin root/file descriptors, reject observable replacement, constrain each open, and state the lack of rename freeze or rollback. Do not claim every post-open rename must fail.
- **Unsupported platform or actual P0 boundary** → Named application gate, never a fake compatible backend. Additional platform support is a separate approved change.
- **Shared docs/specs** → Apply predecessors first and the client consumer afterward; no edit to their artifacts or root contracts. This change is a complete operation library, not a claim that existing callbacks are already hardened.

## Dependency, conflicts and workday

Both direct predecessors are required, including their application gates. Row 4 imports the two operations and selects an authorized physical role before IO; this change never edits client callbacks. Shared apply conflicts are existing permissions docs/changelog and additive `acp-integration` deltas, as enumerated in proposal.md's Batch section. Budget: **8h maximum**, 0.50 alignment + 3.00 implementation + 2.00 unit/temp/mock tests + 0.50 docs + 0.50 applicable verification + 1.50 contingency. No native compilation, live agent/container/bwrap acceptance or deployment migration is part of the workday.
