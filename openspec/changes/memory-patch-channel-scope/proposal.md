## Why

The `memory-patch` skill can only patch user-scope memories: `handleMemoryPatch` (`src/skills/memory-handler.ts:482-644`) always calls `memoryStore.patchMemory(context.workspace, ...)`, never the channel store. When an agent lowers `decay` on memories found by `memory-search` — whose results carry `scope: "user" | "channel"` — every channel-scope ID fails with "Memory not found". A real user hit exactly this: 4 user-scope memories were patched (decay 0.8 → 0.4) but 4 channel-scope matches could not be touched, and the bot had to report the gap. The store layer already implements `patchChannelMemory()` (`src/core/memory-store.ts:802-852`) with identical append-only patch semantics; only the skill surface is missing the routing.

## What Changes

- Add an optional `scope` parameter (`"user"` | `"channel"`, default `"user"`) to the `memory-patch` skill: `--scope user|channel` on `skills/memory-patch/scripts/memory-patch.ts`, mapped to `MemoryPatchParams.scope` in `src/skills/types.ts`. Any other value is rejected with the same error `memory-save`/`memory-search` already use for invalid scope.
- Route `scope: "channel"` in `handleMemoryPatch` to `memoryStore.patchChannelMemory()` via `context.workspaceManager.getOrCreateChannelWorkspace(...)` — the same channel-branch pattern already used by `memory-save`, `memory-search`, and `memory-stats`.
- Gate channel-scope patching behind the existing `context.canWriteChannelMemory` capability (F15): a channel patch is a channel write and requires the same authorization as `memory-save --scope channel`.
- Reject `--visibility` combined with `--scope channel` with an instructive error (channel memories have no visibility field; they are always public).
- Make the user-scope "Memory not found" error instructive: when a patch on the user store finds no such ID, the error names the retry with `--scope channel`.
- Update `skills/memory-patch/SKILL.md`: document `--scope`, the channel-write authorization requirement, the visibility/channel interaction, and not-found guidance.
- No storage-layer changes: `patchMemory()` and `patchChannelMemory()` are unchanged; append-only patch-event semantics are preserved as-is.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `channel-memory`: Add a "Channel Memory Patching" requirement — `memory-patch` SHALL accept `scope: "channel"`, SHALL require the `canWriteChannelMemory` capability for channel-scope patches, SHALL reject `visibility` for channel scope, SHALL append a patch event to the channel memory file (append-only preserved), and the user-scope not-found error SHALL point at the `--scope channel` retry.

## Impact

- `src/skills/types.ts` — `MemoryPatchParams.scope?: string` (mirrors `MemorySaveParams`/`MemorySearchParams`)
- `src/skills/memory-handler.ts` — `handleMemoryPatch`: scope validation + channel branch (authz gate, `channelId`/`workspaceManager` guards, visibility rejection, `patchChannelMemory` call) + enhanced not-found error on the user path
- `skills/memory-patch/scripts/memory-patch.ts` — `--scope` string flag with enum validation (same pattern as `memory-save.ts`)
- `skills/memory-patch/SKILL.md` — usage example, capabilities, limitations, error guidance
- `tests/skills/` — new channel-scope patch tests mirroring `tests/skills/channel-memory-authz.test.ts` (handler-level, temp-dir `WorkspaceManager`/`MemoryStore`)
- `openspec/specs/channel-memory/spec.md` — synced on archive of this change
- No HTTP skill-API changes (`memory-patch` params pass through the generic registry route); no config, storage-layout, or `MemoryStore` changes.

## Batch

- depends-on: (none)
- code-conflicts: touches `src/skills/memory-handler.ts` (`handleMemoryPatch` only), `src/skills/types.ts` (`MemoryPatchParams` only), `skills/memory-patch/**`, `tests/skills/`; no other in-flight changes expected in `openspec/changes/`.
