## Why

The scoring core from `memory-recall-scoring` needs a retriever around it. The retriever reads memory files efficiently, applies scope, visibility, exclusion and supersede rules, expands `relatedTo`, and selects results for Fast and Deep modes within confidence thresholds and token budgets. With it, Memory Recall v2 has a complete memory engine that callers can adopt.

This is change 3 of 9. It depends on `memory-recall-scoring`.

## What Changes

- Add an in-process memory snapshot per JSONL file, refreshed by file size and modification time, so writes are visible to the next search without write hooks.
- Add memory eligibility: enabled, scope and visibility, exclusion set, minimum lexical overlap, and supersede filtering with the historical and Deep overrides. Optional `category` and `scope` filters are supported.
- Add one-hop `relatedTo` expansion.
- Add Fast and Deep selection, with thresholds, the second-result rule and token budgets.
- Add the `memory.recall` configuration keys used by selection. Threshold defaults are provisional until `memory-recall-calibration`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-recall`: Adds execution, snapshot, eligibility, expansion, result and selection requirements.
- `configuration-and-deployment`: Adds "Memory Recall Configuration".

## Impact

- **New code**: `src/core/memory-recall/snapshot-cache.ts` and `src/core/memory-recall/retriever.ts`, with tests.
- **Changed code**: `src/types/config.ts`, `src/core/config-loader.ts`, `config.example.yaml`.
- **Callers**: none yet. Changes 5 and 7 wire the retriever in.
