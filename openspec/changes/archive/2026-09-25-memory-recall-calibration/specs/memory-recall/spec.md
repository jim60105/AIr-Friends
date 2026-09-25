## ADDED Requirements

### Requirement: Memory Threshold Calibration

The default values of `minRecallScore` and `secondRecallScore` SHALL be derived from a committed offline benchmark fixture. The fixture SHALL:

- contain Traditional Chinese and mixed-script memories;
- include supersede chains, `relatedTo` links, channel memories, and both DM and guild contexts;
- label every query with its expected memory ids, with roughly 40% of queries expecting none.

The memory false-positive rate SHALL be defined as the share of queries for which Fast Recall selects at least one memory outside the query's expected set.

- `minRecallScore` SHALL be the grid value that maximizes Recall@1 subject to a false-positive rate of at most 5%.
- `secondRecallScore` SHALL be the grid value that maximizes Recall@2 under the same limit, with `minRecallScore` fixed.
- Ties SHALL be broken by the lower false-positive rate, then by the higher threshold.

A regression test SHALL run Fast Recall over the fixture with the default configuration and a fixed clock. It SHALL assert that Recall@1, Recall@2, false-positive rate and average injected tokens equal the recorded values. It SHALL also assert that the p95 search latency over the fixture, measured after one warm-up pass, is below 50 ms. The ceiling is deliberately generous so that only large regressions fail.

#### Scenario: Benchmark gate
- **WHEN** the regression test runs with default configuration
- **THEN** the memory false-positive rate SHALL be at most 5%
- **AND** Recall@1, Recall@2, false-positive rate and average injected tokens SHALL equal the recorded values
- **AND** p95 search latency SHALL be below 50 ms

#### Scenario: Benchmark is offline
- **WHEN** the benchmark script or regression test runs
- **THEN** it SHALL NOT perform network or LLM requests

#### Scenario: Fixture covers required cases
- **WHEN** the fixture is inspected
- **THEN** it SHALL include at least one query for each case:
  - natural-question paraphrase
  - mixed-script entity
  - current state over a superseded memory
  - historical query for a superseded memory
  - preference query
  - `relatedTo` expansion
  - negative query
  - negative query that contains an English current or historical hint word used in an unrelated sense
