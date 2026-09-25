## Why

Fast Recall injects memories into every turn without the agent asking, so a false positive costs more than a miss. `memory-recall-retriever` ships provisional score thresholds. This change replaces them with values derived from a committed, deterministic benchmark, and turns that benchmark into a regression gate.

This is change 4 of 9. It depends on `memory-recall-retriever`. It can run in parallel with `memory-deep-recall`.

## What Changes

- Add a fixture corpus of about 40 memories, mainly Traditional Chinese with mixed English, product names and model numbers. It includes supersede chains, `relatedTo` links, channel memories, and DM and guild contexts.
- Add about 35 labeled queries, roughly 40% of which expect no memory. Negatives include adversarial uses of English hint words ("before 5pm", "the latest build").
- Add `scripts/memory-recall-benchmark.ts`. It reports Recall@1, Recall@2, false-positive rate, average injected tokens and p95 latency, and grid-searches `minRecallScore` and `secondRecallScore` under a false-positive cap of 5%.
- Replace the provisional threshold defaults with the calibrated values in the config loader and `config.example.yaml`.
- Add a regression test that asserts the recorded metrics exactly and gates p95 search latency with a generous ceiling.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-recall`: Adds the "Memory Threshold Calibration" requirement.

## Impact

- **New files**: `tests/fixtures/memory-recall/corpus.jsonl`, `tests/fixtures/memory-recall/queries.yaml`, `tests/fixtures/memory-recall/metrics.json`, `scripts/memory-recall-benchmark.ts`, `tests/core/memory-recall/benchmark.test.ts`.
- **Changed files**: `src/core/config-loader.ts` and `config.example.yaml` (threshold defaults).
- **Runtime behavior**: none until Fast Recall is wired in by `memory-fast-recall-context`.
