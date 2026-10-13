# Proposal

## Why

Restricted OMP misrecords authentic native builtins as untrusted host tools, preventing bash, write/edit and native read/search from reaching their intended routes. Official v18.10.3 still lacks a complete confined read/search interface; the user accepts native local IO and requires using built-in search rather than a custom broker or denied-only parity.

## What Changes

- Authenticate a distinct `native-builtin` origin from the supported direct live `api.getAllTools()` registry; keep SDK/RPC-host injection, workspace and unknown sources denied.
- Restore genuine local read/search through native activation/approval and ambient OS permissions, with no false claim of daemon descriptor-bound filesystem confinement.
- Keep ACP command/write/destructive boundaries unchanged: restore ordinary local native write/edit under the pinned native approval path and the process's ambient OS permissions, mirroring the accepted native read/search posture, while destructive/multi-file mutation keeps its shared complete fail-closed decision; positively screen alternate/URI roots across all native read/search inputs and retain owned URL/skill replacement routes.
- Pin supported restricted settings for local builtin search, preserving model-dependent native find selection and disabling native fetch materialization as defense in depth. No public runtime field or new backend is added.
- Record the v18.10.3 source/settings investigation, the accepted native local read/search status and the user's explicit authorization of the ambient native mutation risk; retain deployment v18.6.1 because the newer version does not fix the seam.
- Update tool/enforcement/settings documentation and CHANGELOG with the approved native-versus-ACP boundary split.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: authentic builtin admission, supported native-local read/search posture and truthful completion authorities.

## Impact

Owns native registration/roster, provenance and inventory composition, native input/route screening, restricted settings composition/catalog/overlay and focused native fixtures. Shared provenance/bundle writers are serialized before owned module evidence. No credentials, new configuration fields, broker, fork, version bump, readiness assertion or compatibility alias. Native-YOLO registration, both-agent/both-mode LSP, sandbox mounts and egress remain unchanged. Budget is 8h including implementation, focused mock verification and docs.

The full requested builtin scope is retained in these artifacts. Direct native reads/search can access paths outside daemon session roots when OS permissions permit it; this is the user's accepted native status. Controlled read's actual owned registration is completed by the following module-evidence change.

## Accepted Ambient Native Mutation

The user explicitly authorized accepting the ambient native mutation risk. Ordinary local native write/edit therefore restores and executes under the pinned native approval path and the process's ambient OS permissions, mirroring the accepted native local read/search posture. Truthful residual risk stays stated: an absolute native session-sandbox/plan target or an unavailable client bridge does not reach the ACP sink and mutates directly, and no ACP-sink protection is claimed for those paths. No pre-dispatch sink-route evidence requirement, invented `ctx` getter, `ToolSession` cast, custom IO broker, fabricated sink guarantee, readiness mechanism, new runtime/config/env field or compatibility alias is introduced. Destructive and multi-file mutation keep their existing shared complete fail-closed decision.

## Batch:

code-conflicts: bind-omp-owned-module-evidence (native registration, provenance, inventory/enforcement specs and package inputs); apply this writer first.
code-conflicts: synchronize-omp-seam-correction-docs (current tool/settings/enforcement docs and CHANGELOG); docs writer last.
code-conflicts: render-delivered-skill-root-contract, thread-per-spawn-omp-recovery-context (append-only CHANGELOG ownership); serialize history commits without adding a behavioral dependency.

Builtin authentication does not consume module evidence. The following module change depends on this change for shared roster/provenance serialization and restores the actual owned read replacement's production origin admission. Both changes are required for the full installed read route; neither invents a daemon protected-read broker.
