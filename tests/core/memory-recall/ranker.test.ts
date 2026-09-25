// tests/core/memory-recall/ranker.test.ts

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { buildQuery, detectHints } from "@core/memory-recall/query-hints.ts";
import {
  compareScoredMemories,
  scoreMemories,
  scoreNoteFiles,
} from "@core/memory-recall/ranker.ts";
import type { QueryHints, ScoredMemory } from "@core/memory-recall/types.ts";
import { DAY_MS, index, noteFile, NOW } from "./memory-fixture.ts";

const NO_HINTS: QueryHints = { current: false, historical: false, preference: false };

/** Recency bonus of a memory created at the fixed clock. */
const RECENCY_AT_NOW = 0.2;

function ids(scored: ScoredMemory[]): string[] {
  return scored.map((item) => item.indexed.memory.id);
}

function byId(scored: ScoredMemory[], id: string): ScoredMemory {
  const found = scored.find((item) => item.indexed.memory.id === id);
  assert(found !== undefined, `no scored memory ${id}`);
  return found;
}

Deno.test("scoreMemories - BM25 over a three-document population", () => {
  const population = [
    index({ id: "d1", content: "keyboard" }),
    index({ id: "d2", content: "keyboard mouse pad" }),
    index({ id: "d3", content: "monitor" }),
  ];
  const scored = scoreMemories(population, buildQuery("keyboard"), NO_HINTS, NOW);

  // d3 shares no token with the query and is not scored at all.
  assertEquals(ids(scored), ["d1", "d2"]);
  assertEquals(scored[0].matchedTerms, ["keyboard"]);

  // N = 3, df = 2, avgdl = (1 + 3 + 1) / 3 = 5/3, idf = ln(1 + (3 - 2 + 0.5) / 2.5) = ln(1.6).
  // d1: dl = 1 -> 2.2 / (1 + 1.2 * (0.25 + 0.75 * 3/5)) = 2.2 / 1.84.
  // d2: dl = 3 -> 2.2 / (1 + 1.2 * (0.25 + 0.75 * 9/5)) = 2.2 / 2.92.
  assertAlmostEquals(scored[0].lexicalScore, Math.log(1.6) * (2.2 / 1.84), 1e-9);
  assertAlmostEquals(scored[1].lexicalScore, Math.log(1.6) * (2.2 / 2.92), 1e-9);
});

Deno.test("scoreMemories - the entity and phrase bonuses of a current-message entity", () => {
  const population = [index({ content: "air75 v3" })];
  const scored = scoreMemories(population, buildQuery("air75 v3"), NO_HINTS, NOW);

  // N = df = 1 and dl = avgdl = 3, so every matched term scores idf * 1.
  const entity = scored[0];
  assertAlmostEquals(entity.lexicalScore, Math.log(4 / 3) * (1.5 + 1.0 + 1.0), 1e-9);
  // 1.5 exact entity + 2.0 exact phrase ("air75 v3") + 0.20 recency.
  assertAlmostEquals(entity.score, Math.log(4 / 3) * 3.5 + 3.7, 1e-9);
});

Deno.test("scoreMemories - the phrase bonus spans a CJK and an entity boundary", () => {
  const population = [index({ content: "我在 AIr-Friends 用 OpenClaw 搭配 Air75 V3" })];
  const scored = scoreMemories(population, buildQuery("用 Air75 V3"), NO_HINTS, NOW);

  // 1.5 entity + 2.0 phrase ("用 air75 v3") + 0.20 recency.
  assertAlmostEquals(scored[0].score - scored[0].lexicalScore, 3.7, 1e-9);
});

Deno.test("scoreMemories - the phrase bonus needs two adjacent tokens and four characters", () => {
  const population = [index({ content: "我喜歡喝無糖綠茶" })];

  // 無糖 + 綠茶 join into the four-character span 無糖綠茶: 2.0 phrase + 0.20 recency.
  const span = scoreMemories(population, buildQuery("無糖綠茶"), NO_HINTS, NOW);
  assertAlmostEquals(span[0].score - span[0].lexicalScore, 2.2, 1e-9);

  // A single two-character term is below both the token and the character minimum.
  const single = scoreMemories(population, buildQuery("綠茶"), NO_HINTS, NOW);
  assertAlmostEquals(single[0].score - single[0].lexicalScore, RECENCY_AT_NOW, 1e-9);
});

Deno.test("scoreMemories - the metadata bonus adds importance, tier and decay", () => {
  const population = [
    index({ id: "plain", content: "keyboard" }),
    index({ id: "rich", content: "keyboard", importance: "high", tier: "working", decay: 1.0 }),
  ];
  const scored = scoreMemories(population, buildQuery("keyboard"), NO_HINTS, NOW);

  assertEquals(ids(scored), ["rich", "plain"]);
  // Identical content, so only the bonuses differ: 0.20 + 0.15 + 0.20 * 1.0.
  assertAlmostEquals(scored[0].lexicalScore, scored[1].lexicalScore, 1e-9);
  assertAlmostEquals(scored[0].score - scored[1].score, 0.55, 1e-9);
});

Deno.test("scoreMemories - the recency bonus fades to zero over a year", () => {
  const population = [
    index({ id: "fresh", content: "keyboard" }),
    index({
      id: "old",
      content: "keyboard",
      createdAt: new Date(NOW.getTime() - 365 * DAY_MS).toISOString(),
    }),
  ];
  const scored = scoreMemories(population, buildQuery("keyboard"), NO_HINTS, NOW);

  assertEquals(ids(scored), ["fresh", "old"]);
  assertAlmostEquals(scored[0].lexicalScore, scored[1].lexicalScore, 1e-9);
  assertAlmostEquals(scored[0].score - scored[1].score, RECENCY_AT_NOW, 1e-9);
});

Deno.test("scoreMemories - a preference query boosts preference memories", () => {
  const message = "我喜歡什麼茶";
  const hints = detectHints(message);
  assert(hints.preference);
  const scored = scoreMemories(
    [
      index({ id: "fact", content: "喜歡喝茶" }),
      index({ id: "preference", content: "喜歡喝茶", category: "preference" }),
    ],
    buildQuery(message),
    hints,
    NOW,
  );

  assertEquals(ids(scored), ["preference", "fact"]);
  assertAlmostEquals(scored[0].lexicalScore, scored[1].lexicalScore, 1e-9);
  assertAlmostEquals(scored[0].score - scored[1].score, 0.3, 1e-9);
});

Deno.test("scoreMemories - a current hint adds the recency term once more", () => {
  const population = [index({ id: "m", content: "keyboard" })];
  const query = buildQuery("keyboard");
  const [without] = scoreMemories(population, query, NO_HINTS, NOW);
  const [withCurrent] = scoreMemories(population, query, { ...NO_HINTS, current: true }, NOW);

  assertEquals(withCurrent.lexicalScore, without.lexicalScore);
  assertAlmostEquals(withCurrent.score - without.score, RECENCY_AT_NOW, 1e-9);
});

Deno.test("scoreMemories - a historical hint boosts superseded memories", () => {
  const population = [
    index({ id: "old", content: "keyboard" }),
    index({ id: "new", content: "keyboard", supersedes: ["old"] }),
  ];
  const query = buildQuery("keyboard");
  const without = scoreMemories(population, query, NO_HINTS, NOW);
  const withHistorical = scoreMemories(population, query, { ...NO_HINTS, historical: true }, NOW);

  assertAlmostEquals(byId(withHistorical, "old").score - byId(without, "old").score, 0.2, 1e-9);
  assertEquals(byId(withHistorical, "new").score, byId(without, "new").score);
});

Deno.test("scoreMemories - an explicit supersede set is authoritative", () => {
  // The superseder was filtered out of the population, so the set is passed in.
  const population = [index({ id: "old", content: "keyboard" })];
  const query = buildQuery("keyboard");
  const hints: QueryHints = { ...NO_HINTS, historical: true };
  const [inferred] = scoreMemories(population, query, hints, NOW);
  const [explicit] = scoreMemories(population, query, hints, NOW, new Set(["old"]));

  assertAlmostEquals(explicit.score - inferred.score, 0.2, 1e-9);
});

Deno.test("scoreMemories - bonuses never apply without a lexical match", () => {
  const scored = scoreMemories(
    [
      index({ id: "match", content: "keyboard" }),
      index({
        id: "unmatched",
        content: "monitor",
        importance: "high",
        tier: "working",
        decay: 1.0,
        category: "preference",
      }),
    ],
    buildQuery("keyboard"),
    { ...NO_HINTS, preference: true, current: true },
    NOW,
  );

  assertEquals(ids(scored), ["match"]);
});

Deno.test("scoreMemories - an empty population scores nothing", () => {
  assertEquals(scoreMemories([], buildQuery("keyboard"), NO_HINTS, NOW), []);
});

Deno.test("scoreMemories - lexical relevance outranks metadata", () => {
  // The weak memory carries every metadata bonus; the strong one only decay 0.3.
  const scored = scoreMemories(
    [
      index({ id: "zzz-strong", content: "keyboard mouse", decay: 0.3 }),
      index({
        id: "aaa-weak",
        content: "keyboard notes about my old desk setup",
        importance: "high",
        tier: "working",
        decay: 1.0,
      }),
    ],
    buildQuery("keyboard mouse"),
    NO_HINTS,
    NOW,
  );

  // The id order would place aaa-weak first on a tie, so this asserts the scores.
  assertEquals(ids(scored), ["zzz-strong", "aaa-weak"]);
  assert(scored[0].score > scored[1].score + 0.4);
});

Deno.test("scoreMemories - metadata breaks a near tie", () => {
  const scored = scoreMemories(
    [
      index({ id: "aaa-normal", content: "keyboard" }),
      index({ id: "zzz-high", content: "keyboard", importance: "high" }),
    ],
    buildQuery("keyboard"),
    NO_HINTS,
    NOW,
  );

  assertEquals(ids(scored), ["zzz-high", "aaa-normal"]);
  assertAlmostEquals(scored[0].score - scored[1].score, 0.2, 1e-9);
});

Deno.test("scoreMemories - the previous message has limited influence", () => {
  const scored = scoreMemories(
    [
      index({ id: "previous-only", content: "mouse" }),
      index({ id: "current", content: "keyboard" }),
    ],
    buildQuery("keyboard", "mouse"),
    NO_HINTS,
    NOW,
  );

  assertEquals(ids(scored), ["current", "previous-only"]);
  // Equal document statistics, so the source weights are the whole difference.
  assertAlmostEquals(scored[1].lexicalScore / scored[0].lexicalScore, 0.35, 1e-12);
});

Deno.test("compareScoredMemories - orders by score, then createdAt, then id", () => {
  const older = "2026-01-01T00:00:00.000Z";
  const newer = "2026-06-01T00:00:00.000Z";
  const items: ScoredMemory[] = [
    { indexed: index({ id: "b", createdAt: older }), lexicalScore: 1, score: 1, matchedTerms: [] },
    { indexed: index({ id: "c", createdAt: older }), lexicalScore: 2, score: 2, matchedTerms: [] },
    { indexed: index({ id: "a", createdAt: older }), lexicalScore: 1, score: 1, matchedTerms: [] },
    { indexed: index({ id: "z", createdAt: newer }), lexicalScore: 1, score: 1, matchedTerms: [] },
  ];

  assertEquals(ids([...items].sort(compareScoredMemories)), ["c", "z", "a", "b"]);
});

Deno.test("scoreMemories - repeated and reordered input gives deep-equal results", () => {
  const build = () => [
    index({ id: "a", content: "我喜歡喝無糖綠茶" }),
    index({ id: "b", content: "keyboard mouse", decay: 0.5, importance: "high" }),
    index({ id: "c", content: "Air75 V3", tier: "working" }),
  ];
  const message = "無糖綠茶 keyboard Air75";

  const first = scoreMemories(build(), buildQuery(message), NO_HINTS, NOW);
  const second = scoreMemories(build(), buildQuery(message), NO_HINTS, NOW);
  // Statistics and the comparator are order independent, so the population
  // order cannot leak into the ranking.
  const reversed = scoreMemories(build().reverse(), buildQuery(message), NO_HINTS, NOW);

  assert(first.length > 1);
  assertEquals(first, second);
  assertEquals(first, reversed);
});

Deno.test("scoreNoteFiles - scores a chunk with note-only statistics and no memory metadata", () => {
  const scored = scoreNoteFiles(
    [noteFile("/ws/notes/a.md", [{ headingPath: ["A"], text: "keyboard" }])],
    buildQuery("keyboard"),
  );

  assertEquals(scored.length, 1);
  // N = df = 1 and dl = avgdl = 1, so the score is the bare idf: no recency and
  // no metadata bonus, which a memory of the same content would carry.
  assertAlmostEquals(scored[0].best.score, Math.log(4 / 3), 1e-9);
  assertEquals(scored[0].best.matchedTerms, ["keyboard"]);
  assertEquals(scored[0].best.chunk.headingPath, ["A"]);
});

Deno.test("scoreNoteFiles - aggregates per file with the best chunk as representative", () => {
  const file = noteFile("/ws/notes/a.md", [
    { headingPath: ["A"], text: "keyboard" },
    { headingPath: ["B"], text: "keyboard keyboard keyboard" },
  ]);

  const scored = scoreNoteFiles([file], buildQuery("keyboard"));

  assertEquals(scored.length, 1);
  assertEquals(scored[0].chunks.length, 2);
  assertEquals(scored[0].best.chunk.headingPath, ["B"]);
  assertEquals(scored[0].best.score, scored[0].chunks[0].score);
  assert(scored[0].best.score > scored[0].chunks[1].score);
});

Deno.test("scoreNoteFiles - a file without a matching chunk is absent", () => {
  const files = [noteFile("/ws/notes/a.md", [{ headingPath: ["A"], text: "monitor" }])];

  assertEquals(scoreNoteFiles(files, buildQuery("keyboard")), []);
  assertEquals(scoreNoteFiles([], buildQuery("keyboard")), []);
});

Deno.test("scoreNoteFiles - files rank by best score, then by path", () => {
  const byScore = scoreNoteFiles(
    [
      noteFile("/ws/notes/a.md", [{ headingPath: ["A"], text: "keyboard" }]),
      noteFile("/ws/notes/z.md", [{ headingPath: ["Z"], text: "keyboard keyboard keyboard" }]),
    ],
    buildQuery("keyboard"),
  );
  assertEquals(byScore.map((item) => item.file.path), ["/ws/notes/z.md", "/ws/notes/a.md"]);

  const byPath = scoreNoteFiles(
    [
      noteFile("/ws/notes/b.md", [{ headingPath: ["B"], text: "keyboard" }]),
      noteFile("/ws/notes/a.md", [{ headingPath: ["A"], text: "keyboard" }]),
    ],
    buildQuery("keyboard"),
  );
  assertEquals(byPath.map((item) => item.file.path), ["/ws/notes/a.md", "/ws/notes/b.md"]);
});

Deno.test("scoreNoteFiles - chunks of one file rank by score, then by line", () => {
  const file = noteFile("/ws/notes/a.md", [
    { headingPath: ["A"], text: "keyboard" },
    { headingPath: ["B"], text: "keyboard" },
    { headingPath: ["C"], text: "keyboard keyboard" },
  ]);

  const scored = scoreNoteFiles([file], buildQuery("keyboard"));

  assertEquals(
    scored[0].chunks.map((item) => item.chunk.headingPath[0]),
    ["C", "A", "B"],
  );
  assert(scored[0].chunks[1].chunk.lineStart < scored[0].chunks[2].chunk.lineStart);
});

Deno.test("scoreNoteFiles - the entity and phrase bonuses apply to a note chunk", () => {
  const scored = scoreNoteFiles(
    [noteFile("/ws/notes/a.md", [{ headingPath: ["A"], text: "air75 v3" }])],
    buildQuery("air75 v3"),
  );

  // N = df = 1 and dl = avgdl = 3, so every matched term scores idf; 1.5 exact
  // entity + 2.0 exact phrase, and no recency term.
  assertAlmostEquals(scored[0].best.score, Math.log(4 / 3) * 3.5 + 3.5, 1e-9);
});
