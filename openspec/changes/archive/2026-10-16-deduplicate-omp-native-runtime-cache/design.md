# Design

## Context

See proposal.md for the problem and scope. The latest user instruction explicitly excludes existing-copy cleanup and Git-history recovery.

`src/acp/agent-factory.ts` selects `{workspace.repoPath}/omp-pools/{poolKey}` for pooled OMP and `{workingDir}/tmp` for per-spawn OMP. `ompXdgDataHome()` adds `omp-agent/{restricted|native-yolo}/xdg-data`, and startup creates its `omp` child. The pool also prepares those roots. Native OMP consequently selects that application directory for both mutable state and `natives/{version}`. Idle pool disposal removes processes, without removing disk state.

The pinned v18.6.1 loader selects `$XDG_DATA_HOME/omp/natives` when the `omp` child exists, otherwise `~/.omp/natives`. It appends the package version and extracts all files in the embedded archive, including both x64 variants. There is no independent native-cache environment override. Existing matching-size files can load read-only after the loader catches directory timestamp/write failures.

`Containerfile` verifies the standalone executable and notices but does not prepare native payloads. Existing owned artifacts use `/opt/air/omp`, `$UID:0` and ordinary project permissions. The shared bubblewrap builder already emits per-launch read-only inputs after writable roots and mode-parent shadowing. Backup initialization has four `git add -A` sites; periodic/final backups use another. Backup `.gitignore` files are operator-owned.

### Investigation evidence and limits

The investigation used the official Linux x64 v18.6.1 executable with SHA-256 `c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463`. A real ACP `initialize` with isolated HOME and an existing XDG `omp` directory produced baseline 190,354,064 bytes and modern 190,185,360 bytes. Two channel roots produced distinct inodes totaling 761,078,848 bytes. `--version` alone produced no native files. A throwaway Git dry-run selected those addons alongside databases.

A fresh third root linked to the first root's extracted native payload initialized successfully without changing payload inode/size/mtime. A separate ACP initialize succeeded through bubblewrap with the shared payload read-only and ordinary `/proc` and `/dev` mounts. These are loader/ACP cache proofs, not full production factory, authored-extension, sibling-isolation, image or arm64 acceptance. No provider/model request or production push was performed. The reported GH001 failure is user evidence; it was not reproduced against a remote.

Pinned source reference: [loader-state.js][loader]. Upstream tag tree SHA `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, specifically `getNativesDir`, `initLoaderContext`, `maybeExtractEmbeddedAddon` and `prepareNativeVersionDir`.

[loader]: https://raw.githubusercontent.com/can1357/oh-my-pi/v18.6.1/packages/natives/native/loader-state.js

## Goals / Non-Goals

**Goals**

Keep native code bytes constant as channel/mode/per-spawn root count grows. Preserve private databases/sessions, normal inherited HOME, existing cwd/TMPDIR/staging and shared lease behavior. Make cache availability a deployment prerequisite, with no session-time download or private extraction fallback. Exclude the reserved cache entry and descendants from every future backup index.

**Non-Goals**

Existing-copy removal/replacement, state migration, Git-history recovery/rewrite, force-push, LFS, generic large-file filtering, cache-version retention, arbitrary runtime/tmp/log cleanup, new permissions policy, upstream upgrades and OpenCode changes. Existing oversized ancestor blobs remain outside this change's remedy.

## Decisions

### 1. Prepare one native payload with the real pinned consumer

Add one Deno preparation entry under the existing `scripts/omp/` area and a `deno task prepare:omp-natives` task. Reuse its extraction procedure in the OMP unpacker stage after executable checksum verification. Do not add a JS/Bun runtime or parse undocumented embedded binary formats.

The task accepts an explicit executable path for preparation; its normal default is the resolved `omp` executable on PATH. Resolve that executable once, require version 18.6.1 and verify the existing per-architecture official executable checksum before extraction. Cache identity is exact version plus OS/architecture (`linux-x64` or `linux-arm64`). An unsupported platform/version fails with the supported pin named. The existing general version-warning facility need not become a new compatibility framework; the cache consumer independently requires a matching prepared identity.

Run `omp acp` in an empty temporary HOME/cwd with an existing temporary `XDG_DATA_HOME/omp`, a clean environment without provider credentials and a bounded JSON-RPC initialize handshake. Require a valid successful response, terminate the process cleanly, and validate the extracted regular addon files against the platform's expected set: the two x64 variants (`pi_natives.linux-x64-baseline.node`, `pi_natives.linux-x64-modern.node`) for `linux-x64`, and the arm64 payload files the pinned executable extracts for `linux-arm64`. `--version` or directory creation is insufficient preparation. No model session/prompt or network request is needed. Publish only the native subtree; discard probe databases, HOME and sessions. Record the published file set (names and sizes) in a small sidecar manifest outside the payload, so "complete" is defined as exactly the manifest's set for the resolver and per-root preflight instead of re-deriving variant naming per consumer. An explicit native load of the published read-only payload must also succeed before preparation reports success.

Image payload layout is `/opt/air/omp/native-cache/{platform}/natives/18.6.1/`. The final image contains one copy for its target platform, with the verified executable and notices unchanged. Follow existing `$UID:0`/ordinary install conventions; runtime immutability is enforced by confinement mounts, rather than a new ownership/provenance authority or internal digest manifest.

Development payload layout is `${XDG_CACHE_HOME:-$HOME/.cache}/air-friends/omp/{platform}/natives/18.6.1/`. This is a daemon-side resolver convention, never an invented OMP environment override. Export image/development native-path selection through `src/utils/omp-paths.ts`, like other owned artifacts. An installed image cache root selects image mode; an incomplete installed root fails rather than falling back to development bytes. The preparation task and launch consumer use the same mapping. Refuse a canonical cache location inside the backup data root or any configured user/shared workspace root. Document the preparation command alongside the extension bundle command in existing deployment guidance.

Preparation happens before application sessions, and changing a published payload requires the deployment to be stopped. Use an exclusive preparation lock and same-filesystem temporary sibling plus atomic rename; never expose partial output. Concurrent preparation returns a bounded busy error. Repeating preparation for a complete matching payload validates/reuses it without rewriting it. An incomplete destination fails explicitly rather than overwriting it. Clean only temporary paths created by this preparation invocation. Cache garbage collection and old-version removal are excluded.

### 2. Connect only the loader's native subtree

Both pooled and per-spawn root preparation use one helper. Keep each mode's existing XDG `omp` directory writable and private. At `<XDG_DATA_HOME>/omp/natives`, create an absolute symlink to the selected shared `.../{platform}/natives` directory so the pinned loader appends `18.6.1` itself.

Validate payload version/platform, the manifest's expected addon files and executable-version agreement before connecting or spawning. Cache identity is the pinned version `18.6.1` plus platform, never the operator-tunable `AGENT_OMP_MIN_VERSION` override. Resolve the actual launch executable consistently with preparation, so a cache prepared for another version is never consumed on a version-mismatched PATH. Do not spawn the full consumer merely to check every session's cache.

The existing bootstrap check in `src/utils/omp-version.ts` keeps its contract unchanged for `agent-version-compatibility`: WARN-only `OK|BELOW_MINIMUM|UNKNOWN`, never blocking startup. Its outcome is not the cache gate. The launch failure for an absent, incomplete, or mismatched payload belongs to the native-cache preflight alone, which derives agreement from the pin and the manifest plus a cheap per-root entry check, and an undeterminable or absent probe result simply means that preflight performs its own check rather than inheriting a fatal verdict. Deployment binaries are replaced only with the bot stopped, and no repeated hashing of hundreds of MiB happens on the launch hot path.

Create the symlink atomically. A concurrent creator that has already installed the identical symlink is success. Reuse an existing exact managed symlink idempotently; a dangling link, different target, regular file or real directory at the reserved entry fails before agent spawn with an occupied/invalid-cache diagnostic. Never follow an unexpected link, recursively delete a legacy directory or modify private data to make launch succeed. Symlinked/escaping managed parent components are refused. Preflight failure leaves native payload and existing state untouched, apart from empty managed directories created for a fresh root. The user excluded legacy-copy remediation; roots still holding real native copies therefore require separate operator action outside this change. Because every already-affected root holds a real `omp/natives` directory, this is a launch-blocking deployment step rather than an edge case: the diagnostic names the exact occupied path and the operator removal action, and pre-existing roots must be cleared before OMP sessions resume.

Do not share `XDG_DATA_HOME`, the whole `omp` child, model/auth databases, session directories or HOME. Pool keys remain `poolKey:mode`, and pool restarts reuse their existing private state. No cache cleanup is attached to idle process reclamation. Session staging remains `{session cwd}/tmp/{Skill API session ID}`.

### 3. Reuse shared confinement without broad parent mounts

Add only the selected shared `natives` subtree to per-launch runtime read-only mounts, alongside existing authored files. Bind it at its literal symlink target after every writable bind, including a writable ancestor such as the development HOME cache. Do not expose the cache's parent HOME, `/opt/air`, all pool roots or sibling mode data to make the symlink resolve. Keep the existing selected native data child read-write and mode-parent tmpfs shadowing. The payload bind must fail hard when its source is absent: it SHALL NOT be emitted as a lenient `--ro-bind-try`-style mount, or a vanished source would silently produce a dangling link surfaced later as an opaque loader error.

Order matters in both directions. The payload bind SHALL be applied last, after every writable bind and after all mode-parent shadowing. For a per-spawn root the payload's destination lies beneath the tmpfs-shadowed `omp-agent` parent, so the later writable re-bind of that root's own `xdg-data/omp` must restore the path the `natives` link resolves through; task 6.1 tests that property directly. One loader-level behavior remains read as inference from the pinned call sites rather than proven by the investigation, namely that `prepareNativeVersionDir`'s caught `mkdir`/`utimes` failures still let an existing read-only payload load; task 6.1 makes it an explicit pass criterion of the confined multi-root run. Implementation measurement refines it: the loader touches its version directory's timestamp on every start, and with the payload tree write-protected but owned by the same user that touch still SUCCEEDS (POSIX lets an owner set times regardless of the write bit), while a genuine read-only bind makes it fail and the load continue. The read-only invariant preparation enforces is therefore payload FILE identity, not the version directory's own mtime.

Check canonical source overlap so no separately bound writable alias or nested writable runtime path can expose the shared payload read-write. The existing skill-root overlap checks remain intact. A missing source or failed mount remains a launch failure; a successful unconfined fallback is forbidden. Filesystem-confinement-disabled/native-YOLO sessions keep their existing operator-trusted posture; this change does not claim same-UID host immutability for those sessions, and the development cache root is likewise unprotected on the host under the same trust posture. Their launches still reuse the shared payload, and no new YOLO tool restriction is added.

### 4. Enforce a narrow backup index policy

Introduce one common staging operation in `GitBackupService`, called by every initialization commit path and by periodic/final backup. It de-registers submodules as today, removes reserved cache entries from the index without touching working files, then stages normal changes using `git add -A` with explicit exclusions. Failure in any stage aborts that commit/push path.

Reserved repository-relative shapes are exactly:

- `omp-pools/<pool-key path>/omp-agent/<mode>/xdg-data/omp/natives`, where the pool-key path holds one or more components: real keys include `memory-maintenance:<platform>/<user-id>` as well as single-component `<platform>:<channel-id>` keys
- `<any working-directory path within the backup root>/tmp/omp-agent/<mode>/xdg-data/omp/natives`, including `tmp/...` directly below that root

`<mode>` is exactly `restricted` or `native-yolo`. Reserve each entry itself and every descendant, independent of whether it is a real directory, a dangling/valid symlink, currently missing, ignored, staged or tracked. This shape policy covers configured workspace directories and shared workspace/cwd layouts without inventing a default-only `workspaces/` filter. All other names remain ordinary backup data, including user-created `.node` files and unrelated `natives` directories.

For tracked/staged entries, enumerate the index with NUL-delimited paths, match only those lexical reserved shapes, and remove matching entries with literal NUL-delimited index-only Git arguments; the per-root entry count is small enough to pass them as argv, so no stdin plumbing is required. Then use top-anchored `:(glob)` exclusion pathspecs whose pool-key segment spans one or more components (`**/`), for both each cache root entry and its descendants, one pattern per mode. The exclusion pathspecs cover every reserved shape variant and act as the last line of defense, so a root created or linked between index removal and staging (a spawn racing the backup) still cannot be staged. Do not follow symlinks or rely on `.gitignore`, `.git/info/exclude`, `skip-worktree` or global ignore settings. Never first stage the native bytes and remove them afterward. Removing a previously committed cache path stages its deletion in a future ordinary backup commit, leaving the working tree intact. Removing an index-only staged cache addition prevents its first commit.

This explicitly narrows the current Smart Initialization wording that promises all files, the Backup Execution unrestricted `git add -A` contract, and the operator-ignore requirement's index clause. The exception is the named reserved-runtime-cache policy alone; do not untrack files because of generated ignore rules. Preserve operator `.gitignore` bytes, normal notes/memories/databases/sessions and existing push/retry behavior. Index removal does not erase historical objects, and the new policy makes no claim that already-rejected history will push successfully. No recovery procedure is part of the requested deliverable.

## Acceptance and evidence boundaries

Use actual temporary repositories for index outcomes. Cover empty clone with/without HEAD, non-Git populated initialization, existing-Git initialization, periodic and graceful-final backup. Exercise both modes and pooled/per-spawn shapes with untracked real payloads, symlinks, staged additions and committed cache entries. Inspect resulting index/commit trees, not only mocked Git argv. Include adversarial filenames with spaces/newlines, a missing tracked cache path, normal databases/memories and nonreserved `.node` files. Operator ignore bytes remain identical; any staging failure must prevent commit/push.

Extend existing factory/pool and native acceptance consumers. With exact pinned executable, generated restricted extension, authored settings and functional bubblewrap, initialize multiple pool keys in both modes plus per-spawn roots. Native payload byte count/file identities remain constant, private state remains distinct, restart succeeds, and no local addon files appear. Use real filesystem writes from the confined view to prove shared native code cannot be changed and sibling mode/pool markers cannot be read, while selected mutable state remains writable. Cover concurrent/idempotent preparation/link creation, mismatched or partial payload failure, occupied legacy entry preservation and unsafe parent/link refusal. Keep OpenCode configuration/mount/staging observations unchanged. Unit fixtures prove helper behavior only.

Image acceptance must perform actual preparation and read-only consumption on both supported target architectures using a native runner or functioning target emulation. The x64 byte totals above are measured evidence, not arm64 size assertions. Existing strict native acceptance mode must fail when required executable, extension, supported target runner or confinement prerequisites are absent; ordinary runs may label native cases UNEXERCISED without claiming success.

## Risks / Trade-offs

A complete prepared cache is now a hard OMP launch prerequisite. Operators using an unpinned newer local `omp` must install the supported pin for this path; arbitrary-version support is out of scope. The preparation command must be run again as part of a deliberate future version/platform change.

Legacy directories are intentionally retained and can prevent the new link from being installed. Already-rejected ancestor blobs remain in Git history after future index exclusions. Both limitations follow the user's explicit exclusion of existing-copy and Git-history recovery.

Cross-architecture image preparation executes the target executable and therefore needs target execution support. Missing support fails explicitly. Linux x64 loader proof reduces design uncertainty but does not replace the implementation's production factory and image acceptance.

Preparation runs a child process inside the packaging stage, so the builder must permit subprocess execution there; a builder that cannot run it fails the build explicitly rather than shipping a cacheless image. The published payload is deterministic for a fixed version and platform, and probe databases, HOME and session state are discarded, so no probe side effect enters an image layer.
