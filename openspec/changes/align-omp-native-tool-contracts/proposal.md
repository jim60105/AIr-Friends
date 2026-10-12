# Proposal

## Why

The read and web-search replacement definitions lack the native mandatory `parameters` schema, and URL read returns `contentBlocks` rather than native `AgentToolResult.content`. Binary bytes are also labelled as images without a valid native image representation.

## What Changes

- Supply native-compatible parameter schemas and the pinned tool definition/execute contract for both replacements.
- Return native `content` arrays with honest text, image, binary metadata, attribution, and error representations.
- Preserve same-tool native delegation for non-network input, cancellation, and controlled-transport policy; remove custom result/schema substitutes.
- Make the definitions consumable by C4 native registration rather than changing provider or search behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `acp-integration`: Require schema-valid native replacement definitions and result representations consumable by the pinned OMP runtime.

## Impact

Targets: `extension/read-replacement.ts`, `search-replacement.ts`, definition exports and behavioral consumers. Use pinned native API types and its accepted schema vocabulary. Serialize after C1 and before C3/C4/C6. Recut owned artifacts; update network/compatibility docs and changelog. Budget: 5.0h. No new public fields or alternative transport.
