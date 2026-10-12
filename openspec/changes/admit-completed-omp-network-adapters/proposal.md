# Proposal

## Why

URL-read and web-search adapters advertise completion, but `composeEnforcementDecisions()` still blocks every `allow-gated-pending-adapter` verdict. Supported adapters therefore cannot execute through the real restricted enforcement path.

## What Changes

- Consume typed, trusted completion decisions from the existing URL-read and web-search route owners after inventory/provenance admission.
- Admit only completed replacement routes; web search additionally requires a supported configured backend.
- Keep absent adapters, unsupported backends, uncovered native routes, and wrong/stale provenance blocked with bounded errors and zero dispatch.
- Reconcile retained seam requirements and route tables without plain allows, string-marker bypasses, or native transport fallback.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: Replace unconditional pending enforcement with route-scoped adapter completion consumption and backend-gated admission.

## Impact

Targets: `tool-enforcement-wiring.ts`, `extension/enforcement.ts`, tool inventory, fetch/search route consumers, and real-composer fixtures. Prerequisites: C1 removes obsolete public-search clauses; C4 wires native registration and includes C2/C3. Serialize before C6 in shared replacement/entry files. Rebuild/recut owned artifacts and update network/runtime docs and changelog. Budget: 5.0h. Existing credentials, SSRF rules, egress postures, and native-YOLO behavior remain unchanged.
