# Proposal

## Why

The parity target is pinned OpenCode 1.18.21, whose dedicated `codesearch` tool was removed upstream on 2026-05-12. The OMP implementation has no production consumer or approved backend, so retaining its executor, pending row, and credential gap adds an unsupported capability rather than parity.

## What Changes

- **BREAKING**: Remove the dedicated public-code-search executor, route table, exports, inventory row, and compatibility subcase without aliases or fallback tools.
- Remove the inert OpenCode `codesearch` permission entry, obsolete tests, packaging slot, and current documentation/manual-check requirements.
- Amend the transport and inventory requirements to cover URL read and web search only. Preserve local grep/glob, public URL content, and general web search.
- Preserve archived artifacts and the upstream-removal evidence as historical records.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: Remove the six dedicated public-code-search requirements and obsolete clauses from retained transport/seam requirements.
- `container-packaging`: Remove the reserved public-code-search slot from the manifest contract.

## Impact

Targets: `src/acp/omp/code-search-{transport,routes}.ts`, inventory/validator/ledger, fetch routes, enforcement, daemon exports, `agent-config/opencode.json`, associated tests, bundling/Containerfile comments, and OMP runtime documentation. Recut owned digests. No new credentials or configuration. Apply first in the correction batch; serialize before C3 packaging and C5 seam modifications. Budget: 4.0h including focused verification and documentation.
