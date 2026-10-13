# Proposal

## Why

The installed extension bundle lives outside the mutable workspace/pool state root currently used as module ownership authority. Production also supplies no canonical module evidence, so controlled read URL, web_search and owned skill-URI replacement admission fails before its completing policy.

## What Changes

- Separate the exact immutable deployed module path/root from the observed process-state namespace and from session filesystem authorization.
- Produce and recheck physical deployment-module evidence using the pinned host's `node:fs` metadata APIs and shared canonical ownership policy, without manufacturing session-root evidence.
- Consume the direct native API roster adapter from the preceding serialized change, retaining source-specific origins and freshness.
- Admit existing controlled replacements through their existing route/backend/skill policies after genuine ownership admission; missing or changed evidence remains fail-closed.
- Update enforcement/network/skill ownership documentation and CHANGELOG; regenerate installed bundle/manifest through the existing packaging workflow during implementation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: exact generated-bundle ownership and independent module evidence consumed by native replacement admission.
- `container-packaging`: build-owned development artifact declaration alongside the fixed image artifact, without runtime configuration fields.

## Impact

Owns deployment evidence production, the canonical owned-module verifier and its registration/provenance consumers, default factory wiring, production-shaped native fixtures, and behavior documentation. Uses existing image `/opt/air/omp/extension/index.js` and development `build/omp-extension/index.js` path selection. No new configuration, credentials, readiness handshake or session authorization grants. Budget is 8h including implementation, focused mock/temporary-filesystem verification and docs.

## Batch:

depends-on: admit-trusted-omp-native-builtins
code-conflicts: admit-trusted-omp-native-builtins (native registration, provenance, inventory/enforcement specs and bundle inputs); consume its roster adapter after that writer.
code-conflicts: synchronize-omp-seam-correction-docs (current behavior docs and CHANGELOG); final consolidation last.
code-conflicts: render-delivered-skill-root-contract, thread-per-spawn-omp-recovery-context (append-only CHANGELOG ownership); serialize history commits without adding a behavioral dependency.

The predecessor dependency is shared-file serialization only (native registration, provenance, inventory/enforcement specs and bundle inputs); it is not an unmet runtime or mutation prerequisite, and this change is independently actionable once that serialization lands. Builtin authentication does not consume module evidence. This change also restores the installed owned read replacement's local delegation under the user's accepted native approval/ambient-OS posture; it does not add a confined filesystem broker.
