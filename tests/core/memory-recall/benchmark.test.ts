// tests/core/memory-recall/benchmark.test.ts

/**
 * Regression gate for the calibrated Fast Recall thresholds (Memory Recall v2
 * design, §12). It reruns the committed fixture with the default configuration
 * and fails when ranking changes move the recorded metrics.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { detectHints } from "@core/memory-recall/query-hints.ts";
import { DEFAULT_RECALL_CONFIG } from "@core/memory-recall/recall-config.ts";
import {
  computeMetrics,
  FALSE_POSITIVE_CAP,
  LATENCY_CEILING_MS,
  loadFixture,
  METRICS_URL,
  runBenchmark,
  runPassOnFixture,
} from "../../../scripts/memory-recall-benchmark.ts";
import type { Metrics, QueryOutcome } from "../../../scripts/memory-recall-benchmark.ts";

/** Fixture scenarios the requirement lists; each maps to a `case` tag. */
const REQUIRED_CASES: Record<string, string> = {
  "natural-question paraphrase": "natural-paraphrase",
  "mixed-script entity": "mixed-script-entity",
  "current state over a superseded memory": "current-state-over-superseded",
  "historical query for a superseded memory": "historical-superseded",
  "preference query": "preference",
  "`relatedTo` expansion": "related-to-expansion",
  "negative query": "negative",
  "negative query with an English hint word in an unrelated sense": "negative-hint-word",
};

/** The hint each adversarial negative must fire, so the case is behavioral. */
const HINT_WORD_EXPECTATIONS: Record<
  string,
  { current: boolean; historical: boolean; preference: boolean }
> = {
  n13: { current: false, historical: true, preference: false },
  n14: { current: true, historical: false, preference: false },
  n15: { current: false, historical: false, preference: true },
  n16: { current: true, historical: false, preference: false },
};

interface RecordedMetrics {
  minRecallScore: number;
  secondRecallScore: number;
  secondResultRatio: number;
  recallAt1: number;
  recallAt2: number;
  falsePositiveRate: number;
  averageInjectedTokens: number;
  queryCount: number;
  positiveQueryCount: number;
  falsePositiveCap: number;
}

const recorded = JSON.parse(await Deno.readTextFile(METRICS_URL)) as RecordedMetrics;
const { corpus, queries } = await loadFixture();
const defaults = {
  minRecallScore: DEFAULT_RECALL_CONFIG.minRecallScore,
  secondRecallScore: DEFAULT_RECALL_CONFIG.secondRecallScore,
};

/** The four metrics the requirement records exactly. */
function metricTuple(metrics: Metrics): number[] {
  return [
    metrics.recallAt1,
    metrics.recallAt2,
    metrics.falsePositiveRate,
    metrics.averageInjectedTokens,
  ];
}

function idsOf(outcome: QueryOutcome): string[] {
  return outcome.selected;
}

Deno.test("fixture - every corpus line is a memory log event of a known source", () => {
  const sources = new Set(corpus.map((entry) => entry.source));
  assertEquals([...sources].sort(), ["channel", "user-private", "user-public"]);

  const memoryEvents = corpus.filter((entry) => entry.event.type === "memory");
  assert(memoryEvents.length >= 40, `expected about 40 memories, got ${memoryEvents.length}`);

  for (const entry of corpus) {
    assert(entry.event.id.length > 0, "every event carries an id");
    assert(entry.event.ts.length > 0, "every event carries a timestamp");
    if (entry.event.type === "memory") {
      assert(entry.event.content.length > 0, `${entry.event.id} carries content`);
      assert(
        ["public", "private"].includes(entry.event.visibility),
        `${entry.event.id} carries a visibility`,
      );
    } else {
      assert(entry.event.targetId.length > 0, `${entry.event.id} targets a memory`);
    }
  }

  const ids = corpus.map((entry) => entry.event.id);
  assertEquals(new Set(ids).size, ids.length, "memory ids are unique");

  const scopes = new Set(
    memoryEvents.map((entry) => entry.event.type === "memory" ? entry.event.scope : undefined),
  );
  assert(scopes.has("user") && scopes.has("channel"), "both scopes are present");
  assert(
    memoryEvents.some((entry) =>
      entry.event.type === "memory" && entry.event.visibility === "private"
    ),
    "a private memory is present",
  );
  assert(
    memoryEvents.some((entry) =>
      entry.event.type === "memory" && (entry.event.supersedes?.length ?? 0) > 0
    ),
    "a supersede chain is present",
  );
  assert(
    memoryEvents.some((entry) =>
      entry.event.type === "memory" && (entry.event.relatedTo?.length ?? 0) > 0
    ),
    "a relatedTo link is present",
  );
  assert(
    memoryEvents.some((entry) =>
      entry.event.type === "memory" && entry.event.scope === "channel" &&
      entry.event.author !== undefined
    ),
    "a channel memory carries its author",
  );
  assert(
    corpus.some((entry) => entry.event.type === "patch"),
    "a patch event is present",
  );
});

Deno.test("fixture - queries are labeled, cover every required case, and reference the corpus", () => {
  const ids = new Set(corpus.map((entry) => entry.event.id));
  const queryIds = queries.map((query) => query.id);
  assertEquals(new Set(queryIds).size, queryIds.length, "query ids are unique");

  for (const query of queries) {
    assert(query.case.length > 0, `${query.id} is tagged with a case`);
    assert(["dm", "guild"].includes(query.context), `${query.id} has a valid context`);
    assert(query.current.length > 0, `${query.id} has a current message`);
    for (const id of query.expected) {
      assert(ids.has(id), `${query.id} expects ${id}, which is not in the corpus`);
    }
    for (const id of query.excludeIds ?? []) {
      assert(ids.has(id), `${query.id} excludes ${id}, which is not in the corpus`);
    }
  }

  const cases = new Set(queries.map((query) => query.case));
  for (const [scenario, tag] of Object.entries(REQUIRED_CASES)) {
    assert(cases.has(tag), `no fixture query covers "${scenario}" (case ${tag})`);
  }

  const negatives = queries.filter((query) => query.expected.length === 0).length;
  const share = negatives / queries.length;
  assert(
    share >= 0.3 && share <= 0.5,
    `negative share ${share.toFixed(2)} is not roughly 40%`,
  );
  assert(
    queries.some((query) => query.context === "guild"),
    "a guild-context query is present",
  );
  assert(
    queries.some((query) => query.previous !== undefined),
    "a query with a previous message is present",
  );
});

Deno.test("benchmark - adversarial hint-word negatives fire the intended hint", () => {
  for (const [id, expected] of Object.entries(HINT_WORD_EXPECTATIONS)) {
    const query = queries.find((item) => item.id === id);
    assert(query !== undefined, `fixture query ${id} is missing`);
    assertEquals(query.case, "negative-hint-word");
    assertEquals(detectHints(query.current), expected, `${id} hints`);
  }
});

Deno.test("benchmark - the fixture and the recorded thresholds stay in sync", () => {
  assertEquals(queries.length, recorded.queryCount);
  assertEquals(
    queries.filter((query) => query.expected.length > 0).length,
    recorded.positiveQueryCount,
  );
  assertEquals(recorded.falsePositiveCap, FALSE_POSITIVE_CAP);
  assertEquals(defaults.minRecallScore, recorded.minRecallScore);
  assertEquals(defaults.secondRecallScore, recorded.secondRecallScore);
  assertEquals(recorded.secondResultRatio, DEFAULT_RECALL_CONFIG.secondResultRatio);
});

Deno.test("benchmark - the default configuration reproduces the recorded metrics", async () => {
  const { outcomes, p95LatencyMs } = await runPassOnFixture(corpus, queries, defaults);
  const metrics = computeMetrics(outcomes);

  assertEquals(metrics.recallAt1, recorded.recallAt1);
  assertEquals(metrics.recallAt2, recorded.recallAt2);
  assertEquals(metrics.falsePositiveRate, recorded.falsePositiveRate);
  assertEquals(metrics.averageInjectedTokens, recorded.averageInjectedTokens);
  assert(
    metrics.falsePositiveRate <= FALSE_POSITIVE_CAP,
    `false-positive rate ${metrics.falsePositiveRate} exceeds ${FALSE_POSITIVE_CAP}`,
  );
  assert(
    p95LatencyMs < LATENCY_CEILING_MS,
    `p95 search latency ${p95LatencyMs} ms is not below ${LATENCY_CEILING_MS} ms`,
  );
});

Deno.test("benchmark - the relatedTo expansion returns the related memory", async () => {
  const { outcomes } = await runPassOnFixture(corpus, queries, defaults);
  const related = queries.find((query) => query.case === "related-to-expansion");
  assert(related !== undefined, "the fixture has a relatedTo query");
  const outcome = outcomes.find((item) => item.query.id === related.id);
  assert(outcome !== undefined, "the relatedTo query ran");

  // m03 links to m20; the query must return both, the link being what lifts the
  // second above the second-result ratio.
  assert(
    idsOf(outcome).includes("m03"),
    `expected the related memory m03, got [${idsOf(outcome).join(", ")}]`,
  );
  assert(idsOf(outcome).includes("m20"), `expected the parent memory m20`);
});

Deno.test("benchmark - the grid search finds the recorded thresholds", async () => {
  const result = await runBenchmark();
  assert(result.calibration.feasible, "the fixture has a feasible calibration");
  assertEquals(result.calibration.thresholds, defaults);
  assert(result.metrics !== undefined, "a feasible calibration records metrics");
  assertEquals(metricTuple(result.metrics), metricTuple(computeMetrics(result.outcomes)));
});

Deno.test("benchmark - lowering minRecallScore by 1.0 moves the metrics", async () => {
  const lowered = await runPassOnFixture(corpus, queries, {
    minRecallScore: defaults.minRecallScore - 1,
    secondRecallScore: defaults.secondRecallScore,
  });
  const baseline = await runPassOnFixture(corpus, queries, defaults);
  const loweredMetrics = computeMetrics(lowered.outcomes);
  const baselineMetrics = computeMetrics(baseline.outcomes);

  assertNotEquals(
    metricTuple(loweredMetrics),
    metricTuple(baselineMetrics),
    "the gate does not react to a weaker threshold, so it is not a gate",
  );
  assert(
    loweredMetrics.falsePositiveRate > baselineMetrics.falsePositiveRate,
    "a weaker threshold admits more false positives",
  );
});
