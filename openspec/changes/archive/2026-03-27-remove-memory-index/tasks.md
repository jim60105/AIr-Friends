# Remove Memory Index — Implementation Tasks

## 1. Remove Index Code

- [x] 1.1 Delete `src/core/memory-index.ts`
- [x] 1.2 Remove `MemoryIndexEntry` interface from `src/types/memory.ts`
- [x] 1.3 Remove `MemoryFileType.INDEX` from `src/types/workspace.ts`
- [x] 1.4 Remove index imports and usage from `src/core/memory-store.ts` (indexes map, getOrCreateIndex, appendEntry/updateEntry calls)
- [x] 1.5 Revert `findMemoryById` to pre-index sequential scan behavior
- [x] 1.6 Remove index generation from `scripts/migrate-memory-v2.ts`

## 2. Remove Index Tests

- [x] 2.1 Delete `tests/core/memory-index.test.ts`
- [x] 2.2 Update `tests/core/memory-store-v2.test.ts` to remove index-related test cases
- [x] 2.3 Update `tests/scripts/migrate-memory-v2.test.ts` to remove index generation assertions

## 3. Update Documentation

- [x] 3.1 Remove memory index section from `docs/MEMORY_DESIGN.md`
- [x] 3.2 Remove index references from `AGENTS.md`
- [x] 3.3 Remove `openspec/specs/memory-index/` directory (main spec)

## 4. Cleanup

- [x] 4.1 Delete existing `memory.index.jsonl` files from migrated workspaces
- [x] 4.2 Run `deno fmt`, `deno lint`, `deno check`, and `deno task test` to verify
