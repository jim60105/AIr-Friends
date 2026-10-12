# Proposal

## Why

The extension factory currently returns a handler/tools object, but the pinned OMP loader calls the factory with `ExtensionAPI` and ignores its return value. Enforcement defaults to an empty synthetic registry, leaving the completed policy modules disconnected from native events and tools.

## What Changes

- Register the restricted handler through `api.on("tool_call", ...)` and replacement definitions through `api.registerTool(...)` during factory evaluation.
- Decode actual native events/context into existing policy inputs without trusting model-supplied provenance or session permissions.
- Adapt fresh `api.getAllTools().sourceInfo` observations per call to canonical provenance and resource-generation decisions.
- Remove the production empty-registry default and returned-object registration convention; retain explicit fixture injection only where needed.
- Preserve native-YOLO exclusion, bounded denial results, and the cancelled readiness-handshake decision.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: Require native registration, trusted event decoding, and fresh native registry observations for restricted enforcement.

## Impact

Targets: `src/acp/omp/extension/index.ts`, `enforcement.ts`, replacement load adapters, provenance/bootstrap consumers, and their integration fixtures. Use the exact OMP v18.6.1 pinned API. Prerequisites: C2 native tool contracts and C3 native-loadable packaging. C5 consumes this live path. Rebuild owned artifacts and recut digests; update compatibility/runtime docs and changelog. Budget: 8.0h. No native agent execution or client readiness protocol is introduced.
