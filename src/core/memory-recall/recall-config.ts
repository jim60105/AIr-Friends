// src/core/memory-recall/recall-config.ts

import type { MemoryRecallConfig } from "../../types/config.ts";

/**
 * Default `memory.recall` selection configuration (Memory Recall v2 design, §10).
 *
 * The config loader seeds `memory.recall` with these values, so the engine and
 * the application share one source of truth, and a holder of a `MemoryStore`
 * can build a default `MemoryRetriever` without application configuration.
 *
 * `minRecallScore` and `secondRecallScore` are provisional until
 * `memory-recall-calibration` derives them from the offline benchmark.
 */
export const DEFAULT_RECALL_CONFIG: MemoryRecallConfig = {
  fastRecallMaxResults: 2,
  fastRecallMaxTokens: 192,
  minRecallScore: 3.0,
  secondRecallScore: 3.0,
  secondResultRatio: 0.65,
  deepRecallMaxTokens: 1024,
  deepMinRecallScore: 0,
};
