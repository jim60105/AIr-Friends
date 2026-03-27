## Why

The memory index (`memory.index.jsonl`) was introduced as a performance optimization for O(1) ID lookups. Analysis of production data shows this is premature optimization: the largest workspace has ~60 entries (~15-25KB), full-file scans take microseconds, and `findMemoryById()` still loads the entire JSONL file even after an index hit. Three of four index query methods (`getByTier`, `getByCategory`, `getEnabled`) are dead code — never called outside the index class itself. The index adds maintenance complexity (sync, corruption recovery) without measurable benefit.

## What Changes

- Remove `memory.index.jsonl` file generation from all code paths
- Remove `src/core/memory-index.ts` module entirely
- Remove index integration from `MemoryStore` (addMemory, patchMemory, findMemoryById)
- Remove `MemoryIndexEntry` type from `src/types/memory.ts`
- Remove `MemoryFileType.INDEX` from `src/types/workspace.ts`
- Remove index generation from migration script (`scripts/migrate-memory-v2.ts`)
- Remove index-related tests
- Update `docs/MEMORY_DESIGN.md` to remove index section
- Update `AGENTS.md` to remove index references
- Remove existing `memory.index.jsonl` files from migrated workspaces
- Update openspec specs to remove index-related requirements

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `memory-index`: **REMOVED** — The entire memory-index capability is removed
- `memory-system`: Remove `MemoryIndexEntry` from schema documentation

## Impact

- **Code**: Removes ~200 lines of index code, ~150 lines of tests
- **Storage**: Eliminates index files from all workspaces
- **Performance**: No measurable impact (files are too small for index to matter)
- **Migration**: Index generation step removed from migration script
- **Simplicity**: Reduces maintenance burden and potential sync/corruption issues
