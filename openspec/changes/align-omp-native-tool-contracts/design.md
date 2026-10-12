# Design

## Context

OMP v18.6.1 requires `ToolDefinition.parameters` and an `AgentToolResult` containing `content`. `ctx.invokeTool()` delegates only to the native builtin of the same registered name. The pinned legacy compatibility loader exposes the TypeBox builder through its host facade, including the bare `@sinclair/typebox` import. Current replacement-specific types omit this schema and invent `contentBlocks`.

## Goals / Non-Goals

**Goals:** Make replacement definitions and results acceptable to native registration and consumers.

**Non-Goals:** Reimplement native local read, expand accepted URI schemes here, or change provider selection.

## Decisions

1. Use the pinned loader-supported TypeBox builder facade for concrete object schemas. Keep its canonical bare import host-resolved in C3's bundle; Deno fixtures resolve the compatible locked builder via the project import mapping. Do not invent handwritten schema/result interfaces that omit native mandatory fields. Preserve the current accepted read/query fields and apply the same schema/parser contract.
2. Return native `content` entries and `details` with current controlled-transport attribution. Text remains text; supported image bytes become base64 image data with the supported transport-reported MIME. Other binary results retain their exact retrieved bytes as base64 data and MIME in result `details`, with a text descriptor in `content`; no arbitrary byte array is labelled image and no new filesystem materialization sink is added. Errors retain native error semantics and no fabricated success/citation.
3. Preserve all existing controlled-transport limits and cancellation. For ordinary local input, call the same-tool `ctx.invokeTool()` once and return its native result unchanged. Absence of that delegate fails explicitly rather than silently calling an unguarded replacement filesystem implementation.
4. Leave `skill://` routing to C6, which adds owned URI authority after native registration exists. C4 consumes these definitions without adapting them again.

## Risks / Trade-offs

- [Bundling a second TypeBox runtime breaks the host schema boundary] → C3 preserves only the documented host-facade external import and verifies the emitted specifier.
- [Binary rendering mistakes expose corrupt image content] → Exercise actual native result consumption for text, supported images, and non-image binary metadata using fixture bytes, not result-copy assertions.
- [Schema accepts a field the parser ignores] → Exercise valid and invalid native inputs against schema and executor together.

## Migration Plan

Remove custom definition/result substitutes and migrate consumers. Apply before C3/C4. Recut owned artifacts and update network/compatibility docs and changelog. Budget: contract adaptation 2.5h, focused consumer smoke 1.5h, docs/digests 1.0h, total 5.0h. Native executable observation remains user-owned.
