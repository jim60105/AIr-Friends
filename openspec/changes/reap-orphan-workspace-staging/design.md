# Design

## Context

See `proposal.md` for motivation. `SessionOrchestrator.cleanupWorkspaceTmp()` already performs a synchronous active-registry check followed by recursive removal of `workspace.tmpPath`; success, dry-run and several other completion paths call it. `WorkspaceManager.getOrCreateWorkspace()` recreates `tmp` on access. Neither observation implies old files belong to another user: workspace keys are `{platform}/{userId}` and the same user's conversations share the workspace.

Two lifecycle details constrain cleanup. `SessionRegistry.get()` and its timer can evict idle-authentication entries, so registry absence alone is not proof that a per-spawn process stopped. `AgentProcessPool.executeInFlight()` currently settles the public result before its `finally` drains children and removes pointer/JWT state. An orchestrator awaiting that result can begin cleanup while a tool child still uses a staged file.

Temporary and persistent engine paths overlap today. Native per-spawn OMP data is `{workspace}/tmp/omp-agent/{mode}/xdg-data/omp`, including sessions/databases and a `natives` link to the shared prepared runtime payload. OpenCode uses `{workspace}/tmp/opencode-data/{sessionId}` (or the workspace-level root when no ID is supplied). Pooled roots such as `omp-pools`, `opencode-pools`, `channel-tmp` and `channel-cwd` are outside per-user workspaces and have separate owners. The existing whole-`tmp` deletion does not distinguish these categories.

`bootstrap.ts` constructs AgentCore before registering adapters, then later exposes dashboard and platform/scheduler ingress. Startup reclamation must be awaited before any session-producing ingress becomes reachable.

## Goals / Non-Goals

Reclaim disposable workspace temporary entries after interruption and ordinary completion without deleting live producers' files or existing resumable engine state. Keep work finite per workspace and failure handling nonfatal.

No periodic janitor, age policy, new retention option, state migration, engine-data pruning, cross-instance lock protocol or general filesystem security backend is introduced. This follows the existing single-bot ownership model for the configured workspace volume. Operators must stop the previous bot/agent process tree before reusing that volume; concurrent independent bots or hostile external filesystem mutation on the same tree remain unsupported.

## Decisions

### D1. Partition cleanup by existing path ownership

Replace whole-root removal with one workspace-manager-owned synchronous entry cleanup function shared by teardown and startup. Preserve the `tmp` directory itself and every entry named `omp-agent` or `opencode-data` regardless of the currently selected engine, file type or mode. Never enumerate inside those reserved entries, follow the native `natives` link, or infer that engine state becomes disposable after an idle timeout. Reuse the existing path helper constants/functions for these names where possible.

All other entries directly under a recognized workspace's `tmp` are disposable when that workspace has no live temporary-use owner. This includes orphan Skill API staging directories, browser profiles/screenshots and attachment conversions. No timestamp is required because liveness is the deletion criterion. Current temporary-use ownership protects the whole workspace, including any old session directory the current agent might be reading. This avoids a broader per-file ownership/retention system.

### D2. Track producer lifetime independently of authentication

Add a small per-workspace temporary-use reference count to the existing workspace lifecycle owner, with synchronous acquire/release operations. A runner acquires before its first await that may create the workspace/`tmp`, using the already-computable workspace key. All session-producing orchestrator entrypoints use an outer `try/finally` so setup exceptions, dry runs, cancellation, missing replies, research retries and normal failures release exactly once. Registry membership remains an additional conservative busy check; registry expiry never clears a temporary-use reference.

Hold the reference through connector teardown and the existing pool child-drain/pointer/JWT release. Change pool result settlement to occur after that existing release path completes, preserving the result's existing ACP ID/deadline classification. Capture the runner result before `finally`, complete release, then settle once. Acquire/runner/release errors must still settle the public promise exactly once and preserve primary error reporting; queue-expired items that never ran settle immediately. Keep global queue serialization and the existing release order unchanged. This avoids a second ownership-transfer callback protocol.

On the last reference release, synchronously check both reference count and registry occupancy and clean eligible entries with no await between the check and filesystem mutation. Existing scattered cleanup calls delegate to this owner and cannot delete while the finishing runner still holds its reference. The final release performs the actual idle cleanup. Per-spawn disconnect/termination and pooled child drain must finish first; uncertain teardown keeps the workspace unreclaimable for that process lifetime and reports the cleanup skip, rather than declaring it idle.

### D3. Reclaim startup orphans before exposing ingress

Add an awaited startup cleanup entrypoint on the workspace manager. Invoke it in `bootstrap()` before constructing/exposing session-producing services, including AgentCore's Skill API server and the dashboard listener, and before platform connections or schedulers can run. No runtime producer exists at that point in the supported single-instance model. Cleanup completes or logs its bounded failures before startup continues; it does not run as fire-and-forget work beside active sessions.

Enumerate the configured `workspacesRoot` in its known layout. Visit `{platform}/{user}` and, separately, `{platform}/channels/{channel}` only when they have an actual `tmp` child; never treat the `channels` container as a user workspace. Accept the existing internal/synthetic workspace platform names without hard-coding just Discord/Misskey. Do not recursively discover every directory named `tmp` and do not scan the repository root, shared agent workspace, pool roots, runtime caches, backups or channel memory files. Missing workspace roots are a no-op. Reuse enumeration logic with explicit workspace-shape handling rather than treating `listWorkspaces()`'s `channels` entry as a workspace.

### D4. Bound traversal and avoid symlink descent

Validate the configured root once against its canonical host-provisioned path. Require ordinary link-free workspace/platform/user/channel/tmp components below that root; skip a linked or replaced component with a diagnostic. Use `lstat`, never `stat`, for disposable entries. Unlink disposable symlink entries themselves without visiting their targets. Recurse into ordinary directories only, preserve reserved direct-child names before traversal, and remove a directory after its eligible contents have been removed. Preserve unexpected special nodes with a warning.

Use a synchronous depth-first iterator bounded to 2,048 examined disposable filesystem nodes per workspace per invocation and depth 64. Stop that workspace's pass when a bound is reached; retain unvisited entries for its next teardown/startup. Do not use unbounded recursive `Deno.removeSync(..., { recursive: true })`. This limits main-thread work per workspace and prevents an unexpectedly deep browser tree from producing unbounded recursion. Startup can await between workspace passes while ingress remains disabled; it walks the finite recognized workspace layout once and creates no periodic service.

A missing entry is harmless. Permission, replacement or IO failures warn and skip the affected candidate while other safe candidates continue within budget. No retry loop runs during a pass. Same-process exclusion and completed child teardown prevent producer races; this design does not claim descriptor-relative protection against an independent hostile process racing the filesystem. Existing secure ACP content-access guarantees are unchanged.

## Risks / Trade-offs

Preserving complete engine subtrees retains engine journals/tool outputs indefinitely. This is required for resumable-state safety; pruning those stores is outside the requested disposable-temp fix. Reserved names may also preserve unrelated files placed under those names, a conservative choice preferable to data loss.

A workspace containing more than the traversal budget can retain some disposable data until the next normal lifecycle pass or restart. Tests use an injected small budget to prove bounded partial cleanup and later completion. Startup duration still depends on the number of recognized workspaces; no fixed total boot-time claim is made.

An omitted temporary-use owner would create a cleanup race. Cover every current producer path and the pre-registration/TTL-expired/child-drain windows with explicit barriers in lifecycle tests. Do not rely on time-based expiry as a substitute for teardown evidence.

## Deployment

Deploy the ownership and entry-cleanup cutover together. There is no state relocation or migration. Rollback stops startup reclamation and restores old cleanup behavior, so operators should retain the state-preserving policy if reverting unrelated code. Existing native data and the shared runtime payload remain at their current paths.
