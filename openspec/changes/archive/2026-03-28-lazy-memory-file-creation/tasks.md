# Lazy Memory File Creation — Implementation Tasks

## 1. Remove Eager File Creation

- [x] 1.1 Remove `memory.public.jsonl` creation from `WorkspaceManager.initializeWorkspaceFiles()`
- [x] 1.2 Remove `memory.private.jsonl` creation from `WorkspaceManager.initializeWorkspaceFiles()`
- [x] 1.3 Remove `memory.channel.jsonl` creation from `WorkspaceManager.getOrCreateChannelWorkspace()`

## 2. Ensure Write-on-First-Use

- [x] 2.1 Verify `Deno.writeTextFile(path, content, { append: true })` creates the file if it doesn't exist (it does per Deno docs)
- [x] 2.2 If needed, add file-existence check or create-if-missing logic in `appendWorkspaceFile()` — Not needed; Deno append auto-creates

## 3. Ensure Safe Reads

- [x] 3.1 Verify `MemoryStore.loadAllMemories()` handles missing files (returns `[]`) — Confirmed via WorkspaceError/NotFound catch
- [x] 3.2 Verify `MemoryStore.readChannelMemoryFile()` handles missing files (returns `""`) — Confirmed via Deno.errors.NotFound catch
- [x] 3.3 Verify `searchMemories()` handles missing files in keyword search — Confirmed: text-search.ts returns `[]` on NotFound

## 4. Update Tests

- [x] 4.1 Update workspace-manager tests that assert memory file existence after workspace creation
- [x] 4.2 ~~Add test: memory file created on first `addMemory()` call~~ — Covered by existing memory-store tests
- [x] 4.3 ~~Add test: `loadAllMemories()` returns `[]` for workspace with no memory files~~ — Already covered by existing tests

## 5. Verification

- [x] 5.1 Run `deno fmt`, `deno lint`, `deno check`, `deno task test` — All 1418 tests pass
