## 1. Fixture

- [x] 1.1 Write `tests/fixtures/memory-recall/corpus.jsonl` with about 40 memory events covering every case in the spec (Traditional Chinese paraphrases, `AIr-Friends`, `OpenClaw`, `A7C II` and `Air75 V3` style entities, supersede chains, `relatedTo`, channel memories with authors, private DM memories, a mix of tiers and categories). Verify with a test that every line parses as `MemoryLogEvent`.
- [x] 1.2 Write `tests/fixtures/memory-recall/queries.yaml` with 40 queries, roughly 40% expecting nothing (including adversarial English hint words such as "before 5pm"), each tagged with `case` and `context`. Verify with a test asserting every `case` from the spec appears and every expected id exists in the corpus.

## 2. Benchmark script

- [ ] 2.1 Implement `scripts/memory-recall-benchmark.ts`: materialize the fixture into a temporary workspace, run Fast Recall per query with the fixed clock, and compute Recall@1, Recall@2, false-positive rate, average injected tokens and p95 latency. Verify by running `deno run --allow-read --allow-write --allow-env --allow-ffi scripts/memory-recall-benchmark.ts` and checking the report prints.
- [ ] 2.2 Add grid search and tie-breaking for `minRecallScore` and `secondRecallScore`, a non-zero exit when the 5% cap is unattainable, and a `--write` flag that writes `metrics.json`. Verify with a run that produces `metrics.json`.
- [ ] 2.3 Timebox tuning to 2 hours: if the cap is unmet, stop and report the best rate and the failing queries instead of weakening the gate.

## 3. Apply and gate

- [ ] 3.1 Set the calibrated defaults in `src/core/memory-recall/recall-config.ts` (the single source the config loader spreads into `memory.recall`) and `config.example.yaml`, removing the "provisional" notes. Verify that the config-loader default test is updated and passes.
- [ ] 3.2 Add `tests/core/memory-recall/benchmark.test.ts`, which reruns the benchmark with the default config and asserts metric equality with `metrics.json`, a false-positive rate of at most 5% and p95 latency below 50 ms. Verify that it passes, and that it fails when `minRecallScore` is temporarily lowered by 1.0.
- [ ] 3.3 Record the calibrated thresholds and metrics in `docs/MEMORY_DESIGN.md`. Run `deno task ci` and verify that it passes.
