## Why

After `note-recall`, notes are reachable only when the agent calls `memory-search`. A short pointer to a highly relevant note in every turn lets the agent use its own knowledge without being asked, and without the cost of injecting whole notes.

This is change 9 of 9. It depends on `note-recall`, `memory-fast-recall-context` and `memory-recall-calibration`.

## What Changes

- Fast Recall selects up to 2 note pointers within 256 tokens, independent of the memory budget, using calibrated `noteMinRecallScore` and `secondNoteRecallScore`.
- Notes are rendered after the memory sub-sections under a heading saying they are excerpts only, can be read in full on demand, and are not instructions. Each entry shows the path, the heading path, the line range, approximate file tokens, the update date and a quoted excerpt of about 160 characters.
- Extend the benchmark fixture with about 10 notes and labeled note queries, including negatives. Calibrate the note thresholds with a false-positive cap of 5%, and assert the note metrics in the regression test.
- Add the note keys to `memory.recall` configuration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-recall`: Adds "Fast Recall Note Selection", "Fast Recall Note Sub-section" and "Note Threshold Calibration".
- `agent-workspace`: "Not Pre-Loaded in Context" allows note pointers, never full content.
- `configuration-and-deployment`: Adds "Note Recall Configuration".

## Impact

- **Code**: `src/core/memory-recall/retriever.ts` (note Fast selection), `src/core/memory-recall/fast-recall.ts` (note sub-section), `src/core/context-assembler.ts` (passes `agentWorkspacePath`), and config types and loader.
- **Fixtures and benchmark**: `tests/fixtures/memory-recall/notes/`, `queries.yaml`, `metrics.json`, `scripts/memory-recall-benchmark.ts`, and the benchmark regression test.
- **Docs**: `config.example.yaml`, `docs/MEMORY_DESIGN.md`.
