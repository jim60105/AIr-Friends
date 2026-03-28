## Why

Memory files (`memory.public.jsonl`, `memory.private.jsonl`, `memory.channel.jsonl`) are currently created eagerly as empty files when a workspace is first created (on first conversation trigger). This produces many empty files that never get written to — the migration script just cleaned up 57 such files. Memory files should only be created when actually needed (first `memory-save` or post-conversation summarization).

## What Changes

- Remove eager empty memory file creation from `WorkspaceManager.initializeWorkspaceFiles()` and `getOrCreateChannelWorkspace()`
- Create memory files lazily on first write (in `MemoryStore.addMemory()`, `addChannelMemory()`, or via `appendWorkspaceFile`)
- Ensure all read paths handle missing files gracefully (return empty results, not errors)

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workspace-trust-boundary`: Workspace initialization no longer creates memory files; files are created on first write
- `memory-system`: Memory file creation is deferred to first write; read operations return empty for missing files

## Impact

- `src/core/workspace-manager.ts`: Remove memory file creation from `initializeWorkspaceFiles()` and `getOrCreateChannelWorkspace()`
- `src/core/memory-store.ts`: Ensure `appendWorkspaceFile` creates file if missing (or use `ensureFile` pattern)
- Tests that assert file existence at workspace creation need updating
