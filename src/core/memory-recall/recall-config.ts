// src/core/memory-recall/recall-config.ts

import type { MemoryRecallConfig } from "../../types/config.ts";

/**
 * Default `memory.recall` selection configuration (Memory Recall v2 design, §10).
 *
 * The config loader seeds `memory.recall` with these values, so the engine and
 * the application share one source of truth, and a holder of a `MemoryStore`
 * can build a default `MemoryRetriever` without application configuration.
 *
 * `minRecallScore` and `secondRecallScore` are calibrated from the committed
 * fixture (`tests/fixtures/memory-recall/`) by
 * `scripts/memory-recall-benchmark.ts`: `minRecallScore` maximizes Recall@1 and
 * `secondRecallScore` maximizes Recall@2, both subject to a memory
 * false-positive rate of at most 5%. `tests/core/memory-recall/benchmark.test.ts`
 * fails when a ranking change moves the recorded metrics.
 */
export const DEFAULT_RECALL_CONFIG: MemoryRecallConfig = {
  fastRecallMaxResults: 2,
  fastRecallMaxTokens: 192,
  minRecallScore: 6.75,
  secondRecallScore: 6.5,
  secondResultRatio: 0.65,
  deepRecallMaxTokens: 1024,
  deepMinRecallScore: 0,
};
