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
  computeNoteMetrics,
  FALSE_POSITIVE_CAP,
  isNoteQuery,
  LATENCY_CEILING_MS,
  loadFixture,
  memoryOutcomes,
  METRICS_URL,
  noteFalsePositiveQueryIds,
  runBenchmark,
  runPassOnFixture,
} from "../../../scripts/memory-recall-benchmark.ts";
import type {
  Metrics,
  QueryOutcome,
  RecallThresholds,
} from "../../../scripts/memory-recall-benchmark.ts";

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

/** Note scenarios the fixture must cover; each maps to a `case` tag. */
const REQUIRED_NOTE_CASES: Record<string, string> = {
  "note query in Traditional Chinese": "note-natural",
  "note query with a mixed-script entity": "note-mixed-script",
  "note query whose expected note is ranked second": "note-hard-ranking",
  "negative note query": "note-negative",
  "negative note query close to a note's topic": "note-negative-near-miss",
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
  notes: {
    noteCount: number;
    notePositiveQueryCount: number;
    noteMinRecallScore: number;
    secondNoteRecallScore: number;
    recallAt1: number;
    recallAt2: number;
    falsePositiveRate: number;
    falsePositiveQueryCount: number;
    averageInjectedTokens: number;
  };
}

const recorded = JSON.parse(await Deno.readTextFile(METRICS_URL)) as RecordedMetrics;
const { corpus, queries, notes } = await loadFixture();
const defaults: RecallThresholds = {
  minRecallScore: DEFAULT_RECALL_CONFIG.minRecallScore,
  secondRecallScore: DEFAULT_RECALL_CONFIG.secondRecallScore,
  noteMinRecallScore: DEFAULT_RECALL_CONFIG.noteMinRecallScore,
  secondNoteRecallScore: DEFAULT_RECALL_CONFIG.secondNoteRecallScore,
};
/** The fixture's memory queries: the population the memory metrics cover. */
const memoryQueries = queries.filter((query) => !isNoteQuery(query));
/** The fixture's note queries: every query with a `note-` case tag. */
const noteQueries = queries.filter((query) => isNoteQuery(query));

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
  for (const [scenario, tag] of Object.entries(REQUIRED_NOTE_CASES)) {
    assert(cases.has(tag), `no fixture query covers "${scenario}" (case ${tag})`);
  }

  // The memory fixture's own balance: the note queries are a separate labeled
  // set and never enter the memory metrics.
  const negatives = memoryQueries.filter((query) => query.expected.length === 0).length;
  const share = negatives / memoryQueries.length;
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

Deno.test("fixture - every expected note exists and the note queries are labeled", () => {
  const noteKeys = new Set(notes.map((note) => note.path));
  assert(notes.length >= 10, `expected about 10 notes, got ${notes.length}`);
  for (const note of notes) {
    assert(note.path.startsWith("notes/"), `${note.path} is not under notes/`);
    assert(note.content.length > 0, `${note.path} is empty`);
    assert(note.content.startsWith("# "), `${note.path} starts with a level-1 heading`);
  }

  const noteQueriesWithExpectation = noteQueries.filter((query) => query.expectedNotes.length > 0);
  assert(
    noteQueriesWithExpectation.length >= 10,
    `expected about 10 note queries, got ${noteQueriesWithExpectation.length}`,
  );
  assert(
    noteQueries.some((query) => query.expectedNotes.length === 0),
    "the note query set has negatives",
  );

  for (const query of queries) {
    for (const path of query.expectedNotes) {
      assert(
        noteKeys.has(path),
        `${query.id} expects ${path}, which is not a fixture note`,
      );
    }
    if (query.expectedNotes.length > 0) {
      assert(
        isNoteQuery(query),
        `${query.id} expects a note but carries no note- case tag`,
      );
    }
  }
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
  assertEquals(memoryQueries.length, recorded.queryCount);
  assertEquals(
    memoryQueries.filter((query) => query.expected.length > 0).length,
    recorded.positiveQueryCount,
  );
  assertEquals(recorded.falsePositiveCap, FALSE_POSITIVE_CAP);
  assertEquals(defaults.minRecallScore, recorded.minRecallScore);
  assertEquals(defaults.secondRecallScore, recorded.secondRecallScore);
  assertEquals(recorded.secondResultRatio, DEFAULT_RECALL_CONFIG.secondResultRatio);
  assertEquals(notes.length, recorded.notes.noteCount);
  assertEquals(
    queries.filter((query) => query.expectedNotes.length > 0).length,
    recorded.notes.notePositiveQueryCount,
  );
  assertEquals(defaults.noteMinRecallScore, recorded.notes.noteMinRecallScore);
  assertEquals(defaults.secondNoteRecallScore, recorded.notes.secondNoteRecallScore);
});

Deno.test("benchmark - the default configuration reproduces the recorded metrics", async () => {
  const { outcomes, p95LatencyMs } = await runPassOnFixture(corpus, notes, queries, defaults);
  const metrics = computeMetrics(memoryOutcomes(outcomes));

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

Deno.test("benchmark - the default configuration reproduces the recorded note metrics", async () => {
  const { outcomes } = await runPassOnFixture(corpus, notes, queries, defaults);
  const metrics = computeNoteMetrics(outcomes);

  assertEquals(metrics.recallAt1, recorded.notes.recallAt1);
  assertEquals(metrics.recallAt2, recorded.notes.recallAt2);
  assertEquals(metrics.falsePositiveRate, recorded.notes.falsePositiveRate);
  assertEquals(metrics.averageInjectedTokens, recorded.notes.averageInjectedTokens);
  assert(
    metrics.falsePositiveRate <= FALSE_POSITIVE_CAP,
    `note false-positive rate ${metrics.falsePositiveRate} exceeds ${FALSE_POSITIVE_CAP}`,
  );
  assertEquals(
    noteFalsePositiveQueryIds(outcomes).length,
    recorded.notes.falsePositiveQueryCount,
  );
});

Deno.test("benchmark - the relatedTo expansion returns the related memory", async () => {
  const { outcomes } = await runPassOnFixture(corpus, notes, queries, defaults);
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
  assertEquals(result.calibration.thresholds, {
    minRecallScore: defaults.minRecallScore,
    secondRecallScore: defaults.secondRecallScore,
  });
  assert(result.metrics !== undefined, "a feasible calibration records metrics");
  assertEquals(
    metricTuple(result.metrics),
    metricTuple(computeMetrics(memoryOutcomes(result.outcomes))),
  );
});

Deno.test("benchmark - the note grid search finds the recorded thresholds", async () => {
  const result = await runBenchmark();
  assert(result.calibration.noteFeasible, "the fixture has a feasible note calibration");
  assertEquals(result.calibration.noteThresholds, {
    noteMinRecallScore: defaults.noteMinRecallScore,
    secondNoteRecallScore: defaults.secondNoteRecallScore,
  });
  assert(result.noteMetrics !== undefined, "a feasible note calibration records metrics");
  assertEquals(metricTuple(result.noteMetrics), metricTuple(computeNoteMetrics(result.outcomes)));
});

Deno.test("benchmark - the note thresholds are pinned away from the grid bounds", async () => {
  const result = await runBenchmark();
  const thresholds = result.calibration.noteThresholds;
  assert(thresholds !== undefined, "the note calibration is feasible");

  // A value on a grid bound means the fixture could not separate the notes it
  // claims to separate, so the recorded number would be an artifact.
  assert(
    thresholds.noteMinRecallScore > 0.5,
    `noteMinRecallScore ${thresholds.noteMinRecallScore} sits on the grid floor`,
  );
  assert(
    thresholds.secondNoteRecallScore > 0.5,
    `secondNoteRecallScore ${thresholds.secondNoteRecallScore} sits on the grid floor`,
  );
  assert(
    result.calibration.noteStage1.some((row) =>
      row.value > thresholds.noteMinRecallScore &&
      row.metrics.recallAt1 < result.calibration.noteStage1Feasible[0].metrics.recallAt1
    ),
    "no grid value above the calibrated noteMinRecallScore loses Recall@1, so it is " +
      "pinned by the grid rather than by the fixture",
  );
  assert(
    result.calibration.noteStage2.some((row) =>
      row.value > thresholds.secondNoteRecallScore &&
      row.metrics.recallAt2 < result.calibration.noteStage2Feasible[0].metrics.recallAt2
    ),
    "no grid value above the calibrated secondNoteRecallScore loses Recall@2, so it is " +
      "pinned by the grid rather than by the fixture",
  );
});

Deno.test("benchmark - lowering minRecallScore by 1.0 moves the metrics", async () => {
  const lowered = await runPassOnFixture(corpus, notes, queries, {
    minRecallScore: defaults.minRecallScore - 1,
    secondRecallScore: defaults.secondRecallScore,
    noteMinRecallScore: defaults.noteMinRecallScore,
    secondNoteRecallScore: defaults.secondNoteRecallScore,
  });
  const baseline = await runPassOnFixture(corpus, notes, queries, defaults);
  const loweredMetrics = computeMetrics(memoryOutcomes(lowered.outcomes));
  const baselineMetrics = computeMetrics(memoryOutcomes(baseline.outcomes));

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

Deno.test("benchmark - lowering noteMinRecallScore by 1.0 moves the note metrics", async () => {
  const lowered = await runPassOnFixture(corpus, notes, queries, {
    ...defaults,
    noteMinRecallScore: defaults.noteMinRecallScore - 1,
  });
  const baseline = await runPassOnFixture(corpus, notes, queries, defaults);
  const loweredMetrics = computeNoteMetrics(lowered.outcomes);
  const baselineMetrics = computeNoteMetrics(baseline.outcomes);

  assertNotEquals(
    metricTuple(loweredMetrics),
    metricTuple(baselineMetrics),
    "the note gate does not react to a weaker threshold, so it is not a gate",
  );
  assert(
    loweredMetrics.falsePositiveRate > baselineMetrics.falsePositiveRate,
    "a weaker note threshold admits more false positives",
  );
});
