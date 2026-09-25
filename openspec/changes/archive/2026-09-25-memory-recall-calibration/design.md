## Context

Series design: `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, section 12. `memory-recall-retriever` provides `MemoryRetriever` with an injectable clock and provisional thresholds.

## Goals / Non-Goals

**Goals:**

- Reproducible thresholds, where one script run on a clean checkout yields the committed defaults.
- A test that fails when ranking changes move the metrics.

**Non-Goals:**

- Note thresholds, which `note-recall` adds to the same fixture and script.
- Tuning scoring constants. Only the two thresholds are searched.
- The `notes/` fixture directory that section 12 of the series design lists: note indexing arrives with `note-recall`, which extends this fixture directory and the script then.

## Decisions

- **Fixture layout**:
  - `corpus.jsonl` holds memory events tagged with a synthetic workspace and file (`user-public`, `user-private`, `channel`).
  - The benchmark materializes them into a temporary workspace tree, so the real snapshot and file code paths are exercised.
  - `queries.yaml` entries have `id`, `context` (`dm` or `guild`), `current`, optional `previous`, optional `excludeIds`, `expected` (memory ids, possibly empty) and `case` (the category from the spec).
- **Fixed clock** `2026-09-01T00:00:00Z` in both the script and the test, so recency bonuses are stable.
- **Grid**: 0.5 to 12.0 in steps of 0.25 for both thresholds. This is coarse enough to run in a few seconds and fine enough for BM25 scales on short documents.
- **Query count**: 40, of which 17 expect nothing. The 5% cap is a share of all queries, so the count decides how many false positives are admissible: 40 queries allow two (`floor(0.05 × 40)`). The fixture keeps a few near-miss negatives that do match a memory lexically, so the cap binds and the thresholds are not pushed to the grid ceiling, and one deliberately hard positive whose expected memory ranks second, so `secondRecallScore` is bounded by Recall@2 rather than by the tie-break.
- **Recorded results** go to `tests/fixtures/memory-recall/metrics.json` (thresholds and metrics). The regression test reads the defaults from the config loader and the expectations from `metrics.json`. The script's `--write` flag updates both `metrics.json` and prints the defaults to paste, which keeps config edits explicit and reviewed.
- **Metric definitions**:
  - Recall@k is computed over positive queries only: at least one expected id among the first k selected.
  - The false-positive rate is computed over all queries.
  - Average injected tokens is the mean rendered-token count over all queries.
  - p95 latency uses `performance.now()` around `search()` after one warm-up pass.
- **Timebox**: authoring the fixture takes about 3 hours and the script about 2 hours. Tuning is capped at 2 hours. If the 5% cap is still unmet after that, the change stops and reports the best rate and the failing queries for a decision. The fixture starts at 41 memories and 40 queries and can grow in a follow-up.
- **Handling an unattainable cap**: if no grid value satisfies the 5% cap, the script exits non-zero and prints the best achievable rate. The fix is then in the fixture or the ranking, never in relaxing the cap silently.

## Risks / Trade-offs

- [The fixture overfits the thresholds] → Queries are written to be natural and varied, 40% are negatives, and paraphrase cases are required. Real-world tuning can extend the fixture later.
- [Latency varies on CI machines] → The 50 ms p95 ceiling is roughly an order of magnitude above the expected cost of a linear scan over 40 memories. It exists to catch pathological regressions, such as re-reading files on every search.
- [Floating-point drift across platforms breaks exact metric equality] → The metrics are ratios over small integers and token counts are integers. Only thresholds are floats, and they are grid values.

## Migration Plan

None beyond the changed defaults. Operators who override thresholds in `config.yaml` are unaffected.
