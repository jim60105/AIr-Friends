## Why

Every core memory and up to 20 working memories are injected on every turn with no token bound, so the prompt grows with the memory store. Memory Recall v2 bounds fixed injection and relies on retrieval for the rest. Now that `memory-search` has a relevance-ranked Deep Recall, memories left out of the fixed set are still reachable.

This is change 6 of 9. It depends on `memory-deep-recall`.

## What Changes

- **BREAKING**: Core memories (user first, then channel) are injected within `memory.recall.coreMaxTokens` (512). A memory that does not fit is skipped whole.
- **BREAKING**: Working memories (user and channel merged) are injected from the newest `workingMaxItems` (4) within `workingMaxTokens` (384). `workingTierLimit` no longer controls injection.
- **BREAKING**: Only tier decides fixed loading. A memory with `importance: "high"` but a non-core tier is no longer guaranteed injection; importance becomes a ranking bonus only.
- Spontaneous contexts use the same budgets.
- Assembly records the ids of injected memories, which Fast Recall uses as its exclusion set in change 7.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tiered-context-loading`: Core, working, archive and channel loading requirements are replaced by budgeted equivalents.
- `context-assembly`: Initial composition is restated around fixed budgets, and the token budget, `/clear` and spontaneous requirements are updated.
- `channel-memory`: Context loading is subject to the shared budgets.
- `configuration-and-deployment`: Adds "Fixed Memory Budget Configuration".

## Impact

- **Code**: new `src/core/memory-recall/fixed-selection.ts`; `src/core/context-assembler.ts` (`assembleContext()` and `assembleSpontaneousContext()`); config types and loader.
- **Docs**: `config.example.yaml`, `docs/MEMORY_DESIGN.md`.
- **Tests**: context-assembler tests that assert "all core memories loaded" or 20 working memories are updated.
