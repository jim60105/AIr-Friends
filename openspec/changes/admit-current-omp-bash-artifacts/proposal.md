# Proposal

## Why

Native OMP can spill bash output beside its persisted ACP session journal, but the ACP read callback has no role for that directory and ordinary reads reject `.log`. The observed denial concerns the native ACP UUID's `17.bash.log`, so deriving a directory from the unrelated Skill API session ID would leave the failure unresolved.

## What Changes

- Register a read-only capability for the current OMP ACP session's bash artifacts using the factory-selected data root and persisted native session identity.
- Admit direct regular files named `<numeric-id>.bash.log` only inside that exact artifact directory, through existing protected filesystem IO in restricted and native-YOLO modes.
- Reserve OMP native state from broad workspace callback grants, including when per-spawn state sits beneath `workspace/tmp`, so sibling artifacts, journals and credentials gain no callback authority.
- Refresh registration after native load; reject stale registrations, path substitution and every artifact write without changing native shell approval or OpenCode tool-output command policy.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: current-session OMP bash-artifact provenance, protected read authorization and read-only isolation.

## Impact

Touches connector registration/recovery, filesystem roots/policy/access and callback consumers, their existing tests, and ACP engine documentation. No upstream OMP changes, new dependencies, image-generation changes, Pillow installation or permission-mode redesign. Implementation is one focused engineer-day, including regression coverage and documentation.

## Batch:

depends-on: none

Code-conflict notes: `scope-agent-permission-guidance` may touch the connector-facing orchestrator context and `docs/agent/acp-engine.md`, but owns no artifact authorization. `reap-orphan-workspace-staging` touches orchestrator cleanup and the same engine documentation; it must preserve the native data trees used here. Changes are semantically independent. Apply sequentially to avoid shared-file conflicts.
