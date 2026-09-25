## Batch:
- id: docs-recall-engine-alignment
- depends-on: (none)
- conflicts: docs/DESIGN.md and AGENTS.md are also touched by `remove-dead-memory-config` (the `searchLimit`/`maxChars` example lines in their config blocks and in `config.example.yaml`); this change deliberately does not touch those lines. Queue `remove-dead-memory-config` after this one.

## Why

The Memory Recall v2 series replaced the ripgrep/keyword memory search and the "high-importance always loaded" context rule with the lexical recall engine (tier budgets decide fixed loading; importance is only a ranking bonus), but three reference documents still carry v1-era text that contradicts the shipped behavior and the main `memory-recall` spec. Stale documentation is the only surviving surface of the removed engine.

## What Changes

- `docs/DESIGN.md`:
  - Memory field table (~line 424): `importance` row no longer says "high (always loaded) or normal (searched)"; it states that `importance` is a retrieval ranking bonus and the tier plus `memory.recall` budgets decide fixed loading.
  - "Memory Retrieval" section (~lines 448-460): remove "Automatically loaded during context assembly" for high-importance memories and the `rg` (ripgrep) full-text-search / hit-count-and-character-limit description; describe the shipped behavior: fixed loading by tier within the `memory.recall` budgets, and `memory-search` retrieval by the lexical recall engine (BM25 lexical score plus entity, phrase and metadata bonuses, including the importance bonus).
  - Container binaries (~lines 623 and ~1321): `rg` stays in the image but its stated purpose becomes agent-side file reading under the ACP permission gate, not memory search.
- `docs/SKILLS_IMPLEMENTATION.md`:
  - `memory-save` key features (~line 68): drop "High importance memories always loaded into context".
  - `memory-search` (~lines 72-76): queries are natural-language (not "search keywords"); results come from the recall engine in relevance order with `score` and `matchedTerms`, split into `userMemories` and `agentNotes` sections.
  - Memory handler (~line 228): `handleMemorySearch` delegates to the `memory-recall` retriever instead of "searches memories by keywords".
- `AGENTS.md`: the memory/context sections were already updated during the series; the only stale line left is the container binary entry (~line 1321) "rg - ripgrep 15.1.0 for memory search", fixed the same way as in `docs/DESIGN.md`. The `searchLimit`/`maxChars` example lines (~391-392) are left to `remove-dead-memory-config`.

No behavior, code, or configuration changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change aligns prose documentation with the requirements already in `openspec/specs/memory-recall/spec.md`; no spec-level behavior changes.

## Impact

- **Docs only**: `docs/DESIGN.md`, `docs/SKILLS_IMPLEMENTATION.md`, `AGENTS.md`.
- **Reference**: canonical behavior lives in `openspec/specs/memory-recall/spec.md` and `docs/MEMORY_DESIGN.md` (both already current).
