## Context

See proposal.md and its matrix. Archived settings exposes a faithful merge counterexample plus `recordResetGate`. `SandboxManager` currently allowlists HOME/XDG_DATA_HOME, does not list PI_CONFIG_FILES in NEVER_PASS_ENV, and bypasses filtering when filterEnv is false. Source precedence is recorded in pinned `docs/settings.md` and `config/settings.ts`; native project settings use actual cwd, while foreign discovery providers may contribute project settings. A neutral process launch cwd alone does not cover ACP session/new or session/load changing the project context.

## Goals / Non-Goals

Only owned `--config` overlays may contribute persistent settings for an OMP session, beyond built-in defaults and intentionally owned launch overrides. Preserve existing supported credentials, mode-distinct mutable state, egress and payload paths. No fork, reset overlay, invented native isolated-settings flag, permission rewrite or generic sandbox redesign.

## Decisions

### D1. One source plan owned by settings composition

Extend `ompSettingsForMode` with a typed settings-source plan carrying the existing mode/state namespace, deployment-owned launch cwd, owned HOME path, exact `PI_CODING_AGENT_DIR`, allowed overlays and forbidden discovery selectors/source paths. Generate owned HOME beneath the process's existing mode-scoped namespace; it must be distinct from session payload staging. Do not move the owned models/SYSTEM.md assets or mutable session database. Read root identity through existing canonical filesystem-root primitives.

Use pinned `config/settings.ts`, discovery settings providers and environment-variable documentation to enumerate native global `config.yml`, compatibility `config.yaml`, legacy `settings.json`; native project `.omp/config.yml`/`.omp/settings.json`; foreign provider project/global files; and direct HOME/XDG/profile/config selectors. Record source symbols and scope in `docs/OMP_SETTINGS.md`. This inventory is a bounded path table, not a general filesystem scan and not a newly fabricated disable key. Native config.yaml/settings.json compatibility input is explicitly rejected; the project introduces no migration.

### D2. Mandatory OMP-only environment control

Remove inherited HOME, every XDG discovery selector (including XDG_DATA_HOME), OMP_PROFILE, PI_PROFILE, PI_CONFIG_FILES, inherited PI_CODING_AGENT_DIR and discovered feature/config-source overrides for OMP, regardless of filterEnv or allowedEnvVars. Extend the existing never-pass policy without changing OpenCode's HOME/XDG_DATA_HOME semantics. After ordinary filtering, assign deployment-owned HOME and PI_CODING_AGENT_DIR from the plan, never from operator passthrough or workspace data. The final spawn environment is observed and checked against the plan so later sandbox assembly cannot drop or overwrite trusted values. Leave profile flags absent and permit only the exact owned `--config` list. Credentials and proxy/session markers retain their established rules.

HOME and XDG content are filtered out of settings discovery by the owned replacement HOME and absent XDG selectors. An unset HOME by itself is insufficient because native homedir fallback can return the daemon home. Foreign provider selectors such as CLAUDE_CONFIG_DIR cannot reintroduce a host source. Reject any source selector discovered by the pinned inventory outside the plan even when global environment filtering is disabled.

### D3. Observe lower-layer absence before any native session request

Build one metadata-only source observer using the plan. It verifies canonical ownership/non-agent-writability of overlay files and the neutral launch directory, and rejects a nonempty global settings source or any project/foreign settings source at the actual ACP cwd. Missing forbidden files is success; IO errors, missing authoritative roots, symlinks/links and replacement identity mismatches fail closed. Never delete, rename, parse-merge, chmod or rewrite user files to make the check succeed. Legitimate non-settings workspace files remain visible to tools.

Wire the observer before OMP spawn, before each native `session/new`, before native `session/load` on reuse/restart, and before any repository-triggered settings/registry rediscovery. The actual requested workspace and relevant ancestor/repo roots from the pinned foreign providers are inspected even though the process launches in a neutral cwd. Retain the existing mode namespace and gate-context restoration order. A check failure rejects before sending the native request; successful newSession followed by a check is too late. Check both restricted and native-YOLO deployments and pooled/per-spawn entry points. No dependence on an extension lifecycle exception to produce a client error.

The accepted deployment posture keeps these discovery files absent for the entire process lifetime. A preflight is a repository snapshot decision, not a race-free native watcher filter. Any repository-observed change or explicit reload is rechecked before dispatch; observation failure rejects the operation. Document native autonomous reload/host mutation as user-owned runtime evidence and deployment-control responsibility, without claiming the check stops an undetectable race.

### D4. Separate native reset evidence from the decided application disposition

Keep the reset recipe counterexample, exact merge order and `recordResetGate` native `unresolved`/incompatible evidence. Add a separate disposition with decision number 3, `DECIDED (2026-10-09)`, selected settings-discovery-path control and residual risks. Remove live launch/docs/tests conditions that require a native reset support verdict or another user decision before using an owned-only source plan. Admission requires actual source-plan checks; a passing mock never changes native evidence. Restricted runtime default-deny remains the second boundary; YOLO receives no restricted tool policy.

## Risks / Trade-offs

A populated reused agent directory can contain persistent native settings; reject rather than migrate or silently merge it. The user may need to remove hostile settings under deployment ownership before launch; no automated user-file cleanup is added. Filtering HOME can alter native caches, so keep mode-scoped state/model/prompt paths explicit and regression-test them. Foreign providers can search ancestor roots; a cwd-only path check is incomplete. Snapshot races and native reload behavior remain recorded deployment/runtime limits. This package does not claim the original reset recipe works.

## Migration Plan

Clean cutover to mandatory OMP source control with existing mode namespaces and no migration. Existing unrelated OpenCode environment behavior remains intact. Rollback reverts this package's source control only; it cannot be presented as preserving decision 3 if hostile lower layers become visible again.

## Verification and Handoff

Temporary-filesystem unit fixtures cover HOME/XDG/project/native/foreign lower files, selector override attempts, reused-state pollution, missing roots and links. Mock factory/ACP tests assert zero spawn/new/load calls on rejection and preserved allowed overlays, credentials, mode identity, egress and payload staging on accepted clean inputs. Exercise filterEnv both values, both modes and pooled/per-spawn/recovery. Docs/checklist distinguish decision acceptance from native precedence/reload runtime evidence.
