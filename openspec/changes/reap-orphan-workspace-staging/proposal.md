# Proposal

## Why

`cleanupWorkspaceTmp()` already removes a workspace's whole temporary directory after registered sessions finish, but interrupted runs can leave disposable files until that workspace runs again. A bounded startup pass and explicit runtime ownership can reclaim those files while preserving engine state already stored beneath per-spawn `tmp`.

## What Changes

- Reuse one conservative temporary-entry cleanup policy at startup and normal session teardown, preserving native OMP `tmp/omp-agent` and OpenCode `tmp/opencode-data` state subtrees.
- Run startup cleanup after core construction but before session-producing ingress, including dashboard chat, platform events and schedulers; the empty-registry Skill API listener cannot create sessions.
- Track workspace temporary-use lifetime independently of Skill API authentication expiry, from before workspace creation until agent/child teardown completes; reclaim only an idle workspace.
- Visit the configured workspace layout only, never pooled state, shared runtime payloads, memory files or the shared agent workspace; skip unsafe filesystem entries and retain failures for a later lifecycle pass.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-lifecycle`: bounded orphan temporary-data reclamation with live-use and resumable-state preservation.
- `workspace-trust-boundary`: replace the existing whole-`tmp` session-end deletion requirement with state-preserving entry cleanup and independent live-use protection.

## Impact

Changes workspace-manager cleanup/discovery, session-orchestrator ownership and existing teardown callsites, reuse of bounded child drain for per-spawn teardown, process-pool result settlement after child drain, bootstrap ordering, focused lifecycle/workspace/pool/bootstrap tests and ACP engine documentation. Existing cleanup tests that expect removal of the entire `tmp` root become entry-level cleanup tests. No new scheduler, age/retention configuration, database, migration, multi-instance coordination platform or image-generation work. The work is a single engineer-day focused on the existing single-bot workspace lifecycle.

## Batch:

depends-on: none

Code-conflict notes: shares `src/core/session-orchestrator.ts`, lifecycle tests and engine documentation with `scope-agent-permission-guidance`; shares engine-state documentation and may share lifecycle context tests with `admit-current-omp-bash-artifacts`. Native state is preserved regardless of whether artifact reads are implemented. Apply sequentially to avoid shared-file conflicts.
