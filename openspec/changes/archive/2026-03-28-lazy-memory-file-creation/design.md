## Context

Currently, `WorkspaceManager.initializeWorkspaceFiles()` creates both `memory.public.jsonl` and `memory.private.jsonl` as empty files whenever a user workspace is first created. Similarly, `getOrCreateChannelWorkspace()` creates an empty `memory.channel.jsonl`. This means every first-time user interaction produces empty files that may never be written to (e.g., if the agent never saves a memory for that user). The migration script removed 57 such empty files.

## Goals / Non-Goals

**Goals:**
- Eliminate eager creation of empty memory files
- Create memory files only when the first memory entry is actually written
- Keep read operations safe (return empty results for missing files)

**Non-Goals:**
- Changing the JSONL format or memory event schema
- Changing workspace directory creation behavior (directories are still created eagerly)
- Changing channel workspace directory behavior

## Decisions

### Decision 1: Remove file creation from workspace initialization

Remove the `Deno.writeTextFile` calls for memory files in `initializeWorkspaceFiles()` and `getOrCreateChannelWorkspace()`. The workspace directory is still created eagerly — only file creation is deferred.

### Decision 2: Create-on-first-write via appendWorkspaceFile

`WorkspaceManager.appendWorkspaceFile()` already handles the append operation. Modify it (or the calling code in `MemoryStore`) to create the file if it doesn't exist before appending. This is the simplest approach since all memory writes go through `appendWorkspaceFile`.

### Decision 3: Safe reads for missing files

`MemoryStore.loadAllMemories()` already catches `NotFound` errors and returns `[]`. Verify all read paths behave the same. Channel memory reads (`readChannelMemoryFile`) should also return empty string for missing files.

## Risks / Trade-offs

- [Risk] Tests that assert memory file existence after workspace creation will fail → Fix: Update test assertions
- [Trade-off] `appendWorkspaceFile` now needs to handle file creation → Minimal complexity increase; Deno's `writeTextFile` with `append: true` creates the file if it doesn't exist, so this may already work
