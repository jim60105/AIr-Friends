# Design

## Context

The pinned loader invokes `factory(api)` and ignores its return value. Its supported API exposes `on("tool_call", handler)`, `registerTool(definition)`, and `getAllTools()` with `sourceInfo` (`path`, `source`, `scope`, `origin`, `baseDir`). Source: OMP commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, `extensions/types.ts` and `loader.ts`. C2 supplies native definitions; C3 supplies the loadable closure.

## Goals / Non-Goals

**Goals:** Connect native events to existing policy decisions with trustworthy origin and session context.

**Non-Goals:** Reintroduce client readiness, create an upstream fork, authorize by factory return value, or copy restricted enforcement into YOLO.

## Decisions

1. Accept the native API in the default factory and register the restricted callback synchronously during evaluation. Register read/search once through the same API. Eliminate the production returned-object/module-local registration convention; explicit test fixtures use the native API boundary rather than proving a private slot exists.
2. Obtain fresh `getAllTools()` data inside each callback, after replacement registration. Translate source metadata to the existing canonical provenance model, including owned-extension origins for replacements. Never identify a replacement as builtin merely because its name is `read`. Missing, duplicate, foreign, or stale origin observations deny. Refresh the observed epoch/resource-generation context through existing ownership observations, not a startup registry cache or a readiness channel.
3. Decode native `{toolCallId, toolName, input}` plus trusted native context and existing acquired-session ownership/gate context into policy inputs. Model input cannot supply origin, workspace ownership, approval records, shared-write authority, or completion flags. Use existing command/destructive/URI decoders and completing policies; decode all targets. Missing/unrepresentable required context denies rather than inventing a permission.
4. Map policy denial to the pinned native `ToolCallEventResult` block/reason shape. An allowed hook result permits continuation only through the named completing boundary; it does not stand in for path authorization or a completed adapter. Preserve bounded error vocabulary and zero tool execution after denial.
5. Use only runtime-supported metadata readers at the native boundary. Pass them explicitly to shared canonical-observation seams rather than reaching Deno-only defaults from Bun. Keep policy code single-sourced and native-YOLO unregistered.

## Risks / Trade-offs

- [Synthetic fixtures conceal native shape differences] → Drive the default factory with an API-shaped harness and invoke its captured native callbacks with actual pinned event/source shapes, observing policy and dispatch effects.
- [Replacement registration changes tool provenance] → Test owned replacement, foreign same-name shadow, missing metadata, and mid-session metadata replacement.
- [A named completing authority is mistaken for execution authorization] → Cover allowed/denied command and all-target mutation inputs through the existing real composer, not forwarded mock echoes.
- [Missing extension load is not client-observable] → Retain the accepted residual risk; do not claim a new fail-start guarantee.

## Migration Plan

Apply after C2/C3. Replace the registration contract and migrate all fixtures together; rebuild/recut owned artifacts. Update compatibility and manual-check docs. Whole-change revert is the rollback. Budget: bridge/decoding 4.5h, focused behavioral smoke 2.0h, docs/digests 1.5h, total 8.0h. Source/API harness evidence is not native executable evidence.
