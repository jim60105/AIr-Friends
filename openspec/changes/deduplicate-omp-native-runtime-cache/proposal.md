# Proposal

## Why

OMP v18.6.1 extracts both embedded x64 native addons into each mode/channel's XDG data root, adding 380,539,424 bytes per root in the pinned-binary investigation. Those generated files enter the data backup's unrestricted staging and caused the reported GitHub oversized-blob rejection.

## What Changes

- Prepare one deployment/version/platform native payload outside backed-up data and every agent workspace, using the checksum-verified pinned executable's real ACP initialization. Keep mutable databases and sessions private.
- Connect pooled and per-spawn mode roots to that payload through the loader-supported `omp/natives` symlink. Mount the shared native subtree read-only under existing confinement. No upstream upgrade or invented cache environment variable.
- **BREAKING**: Require prepared native payloads before OMP launch; report a preparation remedy for absent/mismatched payloads instead of extracting channel-local copies or downloading during sessions.
- Give every backup staging path a narrow reserved-runtime-cache policy that excludes both bytes and symlink entries, including already tracked entries, without changing operator `.gitignore` files.
- Leave existing-copy cleanup and Git-history recovery outside this change, as explicitly requested. Occupied legacy native directories are left unchanged and reported rather than deleted, so every already-affected root stays launch-blocked until an operator clears its `omp/natives` directory by hand; the preflight diagnostic names that path and action.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `container-packaging`: Real native payload preparation, deployment/development selection and packaging alongside the pinned executable.
- `acp-integration`: Shared immutable native payload with isolated mutable mode/pool state and confined read-only reachability.
- `git-backup`: Reserved native-cache index exclusions across initialization/periodic/final backup, independent of operator ignore rules.

## Impact

One cohesive engineer-day, using existing packaging scripts/tasks, `src/utils/omp-paths.ts`, `src/acp/agent-factory.ts`, the pool's data preparation, shared mount assembly, `src/core/git-backup-service.ts`, focused consumer tests and existing deployment/backup documentation. Keep OpenCode, global lease behavior, inherited HOME, cwd, Skill API staging and effective YOLO policy unchanged. No Git LFS, blanket `*.node`/size filtering, general runtime retention, compatibility layer, state/schema migration, retry redesign, existing-copy cleanup or Git-history recovery.

The investigation proves pinned Linux x64 extraction and a narrow read-only bwrap ACP start. It does not certify full production confinement or arm64 behavior. Implementation acceptance must exercise those consumers explicitly.

## Batch:

No prerequisite changes.

Code-conflict notes: `clarify-delivery-recovery-guidance` also touches `src/acp/agent-factory.ts` and potentially its tests, but edits the retry preamble rather than OMP runtime assembly. Serialize their application or review the combined diff; neither depends semantically on the other. No planned file conflicts with `clarify-platform-skill-recipes`, `classify-omp-interrupted-tool-updates` or `condition-harness-context-gathering`. Existing dependencies among those four proposals remain unchanged.
