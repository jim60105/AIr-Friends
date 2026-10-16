# Design

## Context

See `proposal.md` for motivation. `filesystem-roots.ts` currently has workspace/staging/shared/trusted-skills roles; `buildSessionFilesystemContext()` carries neither an OMP data root nor a native artifact location. `authorizeFilesystemRead()` permits ordinary `.jsonl`, `.md` and `.txt` reads. `ChatbotClient.readTextFile()` still requires protected IO in YOLO mode. OpenCode tool-output command handling is in `command-path-policy.ts` and does not supply an ACP filesystem root.

`agent-factory.ts` chooses `XDG_DATA_HOME` with `ompXdgDataHome(baseRoot, mode)`. The base is `{repoPath}/omp-pools/{poolKey}` for pooled processes and `{workspace}/tmp` for per-spawn processes. Both modes retain separate native data children. The connector receives the factory-produced environment, so it can register session provenance without trusting a requested path or the first pooled user's frozen client configuration.

### Pinned native evidence

These are static source observations at OMP v18.6.1, revision `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, not a new native execution claim.

- [Native ACP session creation][acp-source] calls `ensureOnDisk()` before returning `sessionId`. Neither the new-session response nor list-session metadata supplies the journal path. Load selects persisted state by native UUID.
- [SessionManager][manager-source] mints a UUIDv7 and persists `<file-safe ISO timestamp>_<UUID>.jsonl` with a session header containing `id` and `cwd`. `getArtifactsDir()` removes the `.jsonl` suffix from that actual journal path.
- [Session paths][paths-source] computes a cwd bucket using canonical home/temp/absolute classification. Reconstructing a bucket from the Skill API ID or always assuming an absolute-path bucket is incorrect.
- [ArtifactManager][artifacts-source] creates its directory lazily and publishes `<numeric-id>.<tool>.log`. Parent/subagent artifacts share the parent artifact directory.

[acp-source]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/modes/acp/acp-agent.ts
[manager-source]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/session/session-manager.ts
[paths-source]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/session/session-paths.ts
[artifacts-source]: https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/packages/coding-agent/src/session/artifacts.ts

## Goals / Non-Goals

The goal is a callback-only, current-native-session read capability for spilled bash text. Preserve the existing supported-platform, no-follow and exact-identity requirements. Ordinary workspace extension allowances remain unchanged outside reserved OMP state.

No whole-data-root grant, arbitrary `.log` allowance, transcript access, auth access, new command approval, upstream patch, native tool facade, filesystem URI implementation or permission-mode change is included. Native operations that bypass ACP callbacks remain outside this guarantee.

## Decisions

### D1. Discover from trusted lifecycle identity and actual persisted journal

Add a small OMP session-artifact resolver consumed by connector registration. Inputs are the connector's configured `agentType`, factory-produced absolute `XDG_DATA_HOME`, returned ACP UUID and registered session cwd. It never consumes a request path, tool output string, shell Skill API ID, ambient HOME or caller-provided artifact root as authority.

After OMP `session/new` succeeds, enumerate only `<factory XDG_DATA_HOME>/omp/sessions` and its immediate bucket directories. Match regular journal basenames against the pinned timestamp shape and the exact ACP UUID suffix. No recursive filesystem search, journal-content search or legacy layout migration is introduced. Bound discovery to 4,096 bucket directories and 16,384 total immediate entries per resolution; exceedance yields an unavailable artifact capability. Only matching candidates' first 64 KiB are read using the existing protected no-follow read mechanism with a bounded-prefix operation. Parse JSONL metadata records to locate the session header, allowing the native title-slot prefix; require matching header UUID and canonical cwd. Require exactly one match, usable identities and physically contained, link-free data/session/bucket/journal components. Malformed, ambiguous, missing or inaccessible evidence grants no artifact root and does not fail otherwise-valid session creation.

This scan avoids duplicating upstream home/temp bucket encoding and never parses unrelated transcript bodies. Canonicalize both the persisted header cwd and registered cwd with the same existing physical path helper before comparison, so host-provisioned workspace aliases work without admitting a different directory identity. The resulting expected artifact directory is exactly the selected journal path minus `.jsonl`. Cache it on that ACP session's gate context with the factory data-root identity, journal identity and parent anchor. Discovery happens at registration/load, never by interpreting a failed read request.

### D2. Represent lazy roots without creating them

Add an optional `omp-session-artifacts` source and role through `SessionGateContext`, filesystem `SessionContext` and canonical root observations. The source is connector-owned and bound to the ACP ID, cwd, factory data root and current registration generation. The Skill API ID remains exclusively the payload-staging owner.

A journal exists at registration, but its artifact directory may be absent. Retain a prospective artifact path anchored to the observed journal parent, without mkdir and without making an absent optional artifact root break unrelated workspace reads. On the first artifact read after native creation, observe the expected directory under the same parent/journal identities and bind its device/inode to that registration. Any later replacement denies. Unavailable capability or directory denies the artifact request with the existing bounded filesystem path/access/context reason and never falls back to a broad root. No partial capability is exposed.

### D3. Give the reserved-state rule precedence over broad workspace roles

Per-spawn native state sits under the ordinary workspace, so adding a new role alone would leave workspace-derived write/read bypasses. For OMP callback contexts, reserve `{session cwd}/tmp/omp-agent` (both mode children) and the connector's selected native data root from ordinary workspace/staging/shared authorization. Reject overlaps with trusted skills or shared writable roots rather than borrowing those roles. A target in reserved OMP state can be admitted only by the current artifact capability; sibling sessions and sibling modes gain no authority even when their files have `.md` or `.jsonl` extensions.

Within that role, allow only a direct regular child whose basename matches `^[0-9]+\.bash\.log$`. The role is read-only even for native-YOLO and even if a broader workspace role also applies. All callback writes, edit permission and destructive authorization of reserved-state targets deny before the YOLO write branch. This is an intentional narrow callback restriction needed for a read-only state exception; native-YOLO shell execution remains unchanged. The exception never enters generic-command roots or payload containment.

The existing `Canonical ACP Session Root Identity`, `Permission Handling — YOLO Mode` and `Shared ACP Canonical Observation And Evidence Scope` requirements receive explicit current-artifact/reserved-state exceptions. The reservation is selected only for OMP callback contexts; OpenCode callback outcomes remain unchanged. It is an intentional OMP-specific read-only native-state boundary, rather than a restricted-mode command clamp.

Restricted generic `cat`/`rg` commands retain their existing workspace path grants and can still reach per-spawn state that native execution can access. The reservation does not apply to that command path or claim to prevent those reads. Ordinary callback `.log` and extension rules remain unchanged outside the distinct artifact role.

### D4. Reuse protected IO and session-generation fences

Extend existing role-aware callback access dispatch and exhaustive denial maps rather than bypassing them with `Deno.readTextFile()`. Preserve line/limit behavior of the read callback, existing fd ownership and bounded diagnostic/audit handling.

Add connector-internal `readOmpSessionHeaderPrefix()` in the existing protected-access module for lifecycle discovery. It takes the factory-selected native sessions-root identity and an observed candidate's root-relative components/identity, and reuses the existing low-level constrained-open backend for a descriptor-bound 64 KiB maximum read and resource cleanup. Its authority is the connector's trusted lifecycle root, never a callback `RootRole`; it does not call the callback role dispatcher or expose a sessions-root grant. Directory metadata enumeration is likewise lifecycle-internal and link-free. The state reservation governs model-requested callback decisions, so this bounded discovery operation can establish provenance before any artifact role exists.

On context replacement, disconnect or session removal, revoke the cached artifact capability. Reconnect may replay ordinary gate contexts but must not replay artifact authority from the prior client epoch. After successful `session/load`, re-resolve the native journal and attach fresh provenance to the restored context before reporting recovery success. Re-registration for the same session with updated permission flags must either retain proven same-epoch identity and rebind its generation or re-resolve it; stale generations never authorize IO. Siblings retain their own cached metadata without borrowing the recovered session's root. An unavailable artifact registration does not add a new recovery failure or retry trigger.

## Risks / Trade-offs

Scanning the bounded native index costs metadata work once per registration/load. Large indexes beyond the bound lose this optional read capability with a bounded diagnostic; they do not authorize a broader root. The pinned native layout can change in a later version and must then receive a new source-backed resolver change.

The callback reservation intentionally denies native state that broad workspace reads previously classified as ordinary per-spawn files. This prevents the new exception from exposing sibling state. Documentation must distinguish this callback boundary from native shell permissions, including unchanged restricted generic-command access to per-spawn state, and avoid claiming sandbox-wide isolation.

Acceptance uses real temporary files and protected access with deterministic replacement hooks, plus connector/mock lifecycle tests. A native integration leg may use the existing pinned-runtime harness where its prerequisites are available; absent native prerequisites must be reported as unexercised. No provider or platform call is needed for the core regression.
