## Why

Memory retrieval today ranks results by `decay × recency`, so relevance never affects the order. Memory Recall v2 (`docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`) ranks by lexical relevance and uses metadata only to break near ties. This change builds the pure scoring core: query hints, BM25, bonuses and deterministic ordering. It has no I/O, so it can be tested exhaustively on its own.

This is change 2 of 9. It depends on `memory-recall-tokenizer`.

## What Changes

- Add query hint detection (current, historical, preference) using fixed term lists.
- Add query token merging: the current message counts ×1.0 and the previous message ×0.35.
- Add indexing of a resolved memory into term frequencies, an entity set and normalized text.
- Add weighted BM25 over a caller-supplied population, the exact entity and phrase bonuses, bounded metadata and temporal bonuses, bonus gating, and deterministic ordering.

## Capabilities

### New Capabilities

None. The `memory-recall` capability is introduced by `memory-recall-tokenizer`.

### Modified Capabilities

- `memory-recall`: Adds "Query Hints" and "Relevance Scoring".

## Impact

- **New code**: `src/core/memory-recall/query-hints.ts`, `src/core/memory-recall/indexed-memory.ts`, `src/core/memory-recall/ranker.ts`, and their tests.
- **Callers**: none yet. `memory-recall-retriever` uses these modules.
