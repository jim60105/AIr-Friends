## Why

`memory-search` still uses the ripgrep substring match ranked by `decay × recency`. The agent gets results that happen to contain a keyword, in an order unrelated to relevance, and without any signal of match strength. With the engine and calibrated thresholds in place, `memory-search` can become Deep Recall: the same ranking as Fast Recall, with a lower bar and more results.

This is change 5 of 9. It depends on `memory-recall-retriever`. It can proceed in parallel with `memory-recall-calibration`, because Deep Recall does not use the Fast Recall thresholds.

## What Changes

- **BREAKING**: `memory-search` memory results come from the recall engine in Deep mode. They are ordered by relevance and each carries `score` and `matchedTerms`. The query is tokenized as a whole instead of being split on whitespace.
- `memory-search` searches both user and channel memories when `scope` is omitted. This matches today's code; the spec was stale.
- `limit` is capped at 10, and memory output is bounded by `memory.recall.deepRecallMaxTokens`.
- **BREAKING**: remove `MemoryStore.searchMemories`, `MemoryStore.searchChannelMemories`, the `decay × recency` score, and `MemoryStore.getImportantMemories()`, which has no production caller. Agent note search is unchanged here; `note-recall` replaces it.
- Update `skills/memory-search/SKILL.md` Response Format.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-system`: "High-Importance vs Normal Memory Loading" is replaced by "Memory Retrieval by Relevance". The ripgrep clause and the unused `getImportantMemories()` contract are dropped.
- `importance-decay`: "Search Scoring Formula" turns decay and recency into bounded bonuses on top of lexical relevance.
- `channel-memory`: "Channel Memory Search" is replaced by "Channel Memory Recall Search", which uses recall and defaults to both scopes.
- `memory-recall`: Adds the "Deep Recall Skill Output" requirement.

## Impact

- **Code**:
  - `src/skills/memory-handler.ts` (Deep Recall).
  - `src/skills/types.ts` (`MemorySearchResult` memory entries gain `score` and `matchedTerms`).
  - `src/core/memory-store.ts` (search methods removed).
  - `src/skills/registry.ts` (constructs `MemoryHandler` with the shared retriever).
- **Tests**:
  - `tests/core/memory-store.test.ts`, `tests/core/memory-store-v2.test.ts` and `tests/integration/memory-v2.integration.test.ts` drop or port their search cases.
  - `memory-handler` tests are updated.
- **Docs**: `skills/memory-search/SKILL.md`, `docs/MEMORY_DESIGN.md`.
