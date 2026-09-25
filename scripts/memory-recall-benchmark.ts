// scripts/memory-recall-benchmark.ts

/**
 * Offline calibration benchmark for Fast Recall (Memory Recall v2 design, §12).
 *
 * The script materializes the committed fixture (`tests/fixtures/memory-recall/`)
 * into a temporary workspace tree, runs Fast Recall over every labeled query
 * with a fixed clock, and grid-searches `minRecallScore` and `secondRecallScore`
 * under a false-positive cap of 5%. It reports Recall@1, Recall@2, the
 * false-positive rate, the average injected tokens and the p95 search latency,
 * and with `--write` it records the calibrated thresholds and the metrics in
 * `metrics.json` for the regression test.
 *
 * Two-stage search, as the requirement states it: `minRecallScore` is the grid
 * value that maximizes Recall@1 subject to the cap (evaluated with the second
 * selection disabled, so the metric isolates the first selection), and
 * `secondRecallScore` is the grid value that maximizes Recall@2 under the same
 * cap with `minRecallScore` fixed. Ties break on the lower false-positive rate,
 * then on the higher threshold.
 *
 * Grid search cost is bounded by capturing each query's ranked candidates once
 * with a permissive retriever and replaying the threshold rules purely, instead
 * of re-running `search()` for every grid value. The model is checked against
 * real `search()` results — at the calibrated pair and at deliberately wrong
 * probe pairs — and the script fails if the two ever disagree.
 *
 * The benchmark is offline: it makes no network request and no LLM call.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-env --allow-ffi \
 *     scripts/memory-recall-benchmark.ts [--write] [--quiet]
 */

import { parse as parseYaml } from "@std/yaml";
import { estimateMemorySectionTokens } from "@core/memory-recall/fast-recall.ts";
import { DEFAULT_RECALL_CONFIG } from "@core/memory-recall/recall-config.ts";
import { MemoryRetriever } from "@core/memory-recall/retriever.ts";
import type { MemoryRecallRequest, MemoryRecallResult } from "@core/memory-recall/retriever.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import type { Platform } from "../src/types/events.ts";
import type { MemoryLogEvent } from "../src/types/memory.ts";
import type { ChannelWorkspaceInfo, WorkspaceInfo } from "../src/types/workspace.ts";

/** Fixed clock of the fixture, so recency bonuses are stable (design §12). */
export const FIXED_CLOCK = new Date("2026-09-01T00:00:00.000Z");

const FIXTURE_DIR = new URL("../tests/fixtures/memory-recall/", import.meta.url);

/** The committed fixture files. */
export const CORPUS_URL = new URL("corpus.jsonl", FIXTURE_DIR);
export const QUERIES_URL = new URL("queries.yaml", FIXTURE_DIR);
export const METRICS_URL = new URL("metrics.json", FIXTURE_DIR);

/** Memory false-positive cap of the calibration (design §12). */
export const FALSE_POSITIVE_CAP = 0.05;

/** Generous p95 search-latency ceiling of the regression gate (design §12). */
export const LATENCY_CEILING_MS = 50;

/** Inclusive grid bounds and step of the threshold search (design §12). */
export const THRESHOLD_GRID_START = 0.5;
export const THRESHOLD_GRID_END = 12;
export const THRESHOLD_GRID_STEP = 0.25;

/** Second-to-first score ratio the engine applies; not searched by this change. */
export const SECOND_RESULT_RATIO = DEFAULT_RECALL_CONFIG.secondResultRatio;

/** The two thresholds this benchmark calibrates. */
export interface Thresholds {
  minRecallScore: number;
  secondRecallScore: number;
}

/** Inclusive grid, `0.5` to `12.0` in steps of `0.25` (47 values). */
export const THRESHOLD_GRID: readonly number[] = buildGrid();

function buildGrid(): number[] {
  const steps = Math.round((THRESHOLD_GRID_END - THRESHOLD_GRID_START) / THRESHOLD_GRID_STEP);
  const values: number[] = [];
  for (let index = 0; index <= steps; index++) {
    // Rounding keeps every value an exact multiple of the step.
    values.push(Math.round((THRESHOLD_GRID_START + index * THRESHOLD_GRID_STEP) * 100) / 100);
  }
  return values;
}

/** Memory file a corpus entry belongs to. */
export type CorpusSource = "user-public" | "user-private" | "channel";

const CORPUS_SOURCES: readonly CorpusSource[] = ["user-public", "user-private", "channel"];

/** One fixture memory event plus the file it is materialized into. */
export interface CorpusEntry {
  source: CorpusSource;
  event: MemoryLogEvent;
}

/** One labeled fixture query. */
export interface QuerySpec {
  id: string;
  case: string;
  context: "dm" | "guild";
  current: string;
  previous?: string;
  excludeIds?: string[];
  expected: string[];
}

/** The workspace tree the fixture is materialized into. */
export interface FixtureWorkspaces {
  store: MemoryStore;
  dmWorkspace: WorkspaceInfo;
  guildWorkspace: WorkspaceInfo;
  channelWorkspace: ChannelWorkspaceInfo;
}

/** A materialized fixture plus its temporary root, for cleanup. */
export interface Fixture {
  root: string;
  workspaces: FixtureWorkspaces;
}

/** One selected memory and its score, as the capture pass saw them. */
export interface RankedMemory {
  id: string;
  score: number;
}

/** A query's ranked candidates (at most two) and its rendered token costs. */
export interface CapturedQuery {
  query: QuerySpec;
  ranked: readonly RankedMemory[];
  /** Rendered tokens of the first candidate alone. */
  tokensTop: number;
  /** Rendered tokens of the first two candidates. */
  tokensBoth: number;
}

/** The selection of one query under one threshold pair. */
export interface Selection {
  ids: string[];
  tokens: number;
}

/** One query's measured outcome. */
export interface QueryOutcome {
  query: QuerySpec;
  selected: string[];
  tokens: number;
  latencyMs: number;
}

/** The four recorded metrics of the regression gate. */
export interface Metrics {
  recallAt1: number;
  recallAt2: number;
  falsePositiveRate: number;
  averageInjectedTokens: number;
}

/** One grid value and the metrics it produced. */
export interface GridRow {
  value: number;
  metrics: Metrics;
}

/** The calibration result, including the constraint evidence behind it. */
export interface Calibration {
  feasible: boolean;
  thresholds?: Thresholds;
  /** Rows of the `minRecallScore` search, evaluated with the second disabled. */
  stage1: GridRow[];
  /** Rows of the `secondRecallScore` search with `minRecallScore` fixed. */
  stage2: GridRow[];
  /** Feasible `minRecallScore` rows, best first. */
  stage1Feasible: GridRow[];
  /** Feasible `secondRecallScore` rows, best first. */
  stage2Feasible: GridRow[];
}

/** The complete result of one benchmark run. */
export interface BenchmarkResult {
  calibration: Calibration;
  corpus: readonly CorpusEntry[];
  queries: readonly QuerySpec[];
  captured: readonly CapturedQuery[];
  outcomes: readonly QueryOutcome[];
  metrics?: Metrics;
  p95LatencyMs?: number;
}

const MEMORY_EVENT_KEYS: readonly string[] = [
  "type",
  "id",
  "ts",
  "enabled",
  "visibility",
  "importance",
  "content",
  "tier",
  "category",
  "scope",
  "decay",
  "relatedTo",
  "supersedes",
  "author",
];

const PATCH_EVENT_KEYS: readonly string[] = [
  "type",
  "id",
  "ts",
  "targetId",
  "enabled",
  "visibility",
  "importance",
  "tier",
  "category",
  "decay",
  "relatedTo",
  "supersedes",
];

const VISIBILITIES: readonly string[] = ["public", "private"];
const IMPORTANCES: readonly string[] = ["high", "normal"];
const TIERS: readonly string[] = ["core", "working", "archive"];
const CATEGORIES: readonly string[] = ["fact", "preference", "episode", "summary", "relationship"];
const SCOPES: readonly string[] = ["user", "channel"];

class FixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureError";
  }
}

function fail(where: string, message: string): never {
  throw new FixtureError(`${where}: ${message}`);
}

function requireString(value: unknown, key: string, where: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(where, `"${key}" must be a non-empty string`);
  }
  return value;
}

function requireOptionalBoolean(value: unknown, key: string, where: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail(where, `"${key}" must be a boolean`);
  return value;
}

function requireOptionalEnum(
  value: unknown,
  key: string,
  allowed: readonly string[],
  where: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(where, `"${key}" must be one of ${allowed.join(", ")}`);
  }
  return value;
}

function requireOptionalStringArray(
  value: unknown,
  key: string,
  where: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    fail(where, `"${key}" must be an array of non-empty strings`);
  }
  return value as string[];
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(where, `unknown key "${key}"`);
  }
}

/** Validates one corpus line and splits its `source` tag from the memory event. */
export function parseCorpusLine(line: string, lineNumber: number): CorpusEntry {
  const where = `corpus.jsonl:${lineNumber}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    fail(where, `not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail(where, "must be a JSON object");
  }

  const { source, ...event } = parsed as Record<string, unknown>;
  if (typeof source !== "string" || !CORPUS_SOURCES.includes(source as CorpusSource)) {
    fail(where, `"source" must be one of ${CORPUS_SOURCES.join(", ")}`);
  }

  const type = event.type;
  if (type !== "memory" && type !== "patch") {
    fail(where, '"type" must be "memory" or "patch"');
  }
  rejectUnknownKeys(event, type === "memory" ? MEMORY_EVENT_KEYS : PATCH_EVENT_KEYS, where);

  requireString(event.id, "id", where);
  requireString(event.ts, "ts", where);
  requireOptionalEnum(event.tier, "tier", TIERS, where);
  requireOptionalEnum(event.category, "category", CATEGORIES, where);
  requireOptionalEnum(event.scope, "scope", SCOPES, where);
  if (
    event.decay !== undefined && (typeof event.decay !== "number" || !Number.isFinite(event.decay))
  ) {
    fail(where, '"decay" must be a finite number');
  }
  requireOptionalEnum(event.visibility, "visibility", VISIBILITIES, where);
  requireOptionalEnum(event.importance, "importance", IMPORTANCES, where);
  requireOptionalStringArray(event.relatedTo, "relatedTo", where);
  requireOptionalStringArray(event.supersedes, "supersedes", where);

  if (type === "memory") {
    requireOptionalBoolean(event.enabled, "enabled", where);
    if (typeof event.enabled !== "boolean") fail(where, '"enabled" is required');
    if (event.visibility === undefined) fail(where, '"visibility" is required');
    if (event.importance === undefined) fail(where, '"importance" is required');
    requireString(event.content, "content", where);
    if (event.author !== undefined) requireString(event.author, "author", where);
  } else {
    requireString(event.targetId, "targetId", where);
    requireOptionalBoolean(event.enabled, "enabled", where);
  }

  return { source: source as CorpusSource, event: event as unknown as MemoryLogEvent };
}

/** Parses and validates `corpus.jsonl`. */
export function parseCorpus(text: string): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line === "" || line.startsWith("#")) continue;
    entries.push(parseCorpusLine(line, index + 1));
  }
  if (entries.length === 0) fail("corpus.jsonl", "is empty");
  return entries;
}

/** Validates one query record. */
export function parseQuery(record: unknown, index: number): QuerySpec {
  const where = `queries.yaml[${index}]`;
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    fail(where, "must be a mapping");
  }
  const fields = record as Record<string, unknown>;
  rejectUnknownKeys(
    fields,
    ["id", "case", "context", "current", "previous", "excludeIds", "expected"],
    where,
  );
  const context = requireOptionalEnum(fields.context, "context", ["dm", "guild"], where);
  if (context === undefined) fail(where, '"context" is required');
  return {
    id: requireString(fields.id, "id", where),
    case: requireString(fields.case, "case", where),
    context: context as "dm" | "guild",
    current: requireString(fields.current, "current", where),
    previous: fields.previous === undefined
      ? undefined
      : requireString(fields.previous, "previous", where),
    excludeIds: requireOptionalStringArray(fields.excludeIds, "excludeIds", where),
    expected: requireOptionalStringArray(fields.expected, "expected", where) ?? [],
  };
}

/** Parses and validates `queries.yaml`. */
export function parseQueries(text: string): QuerySpec[] {
  const parsed = parseYaml(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail("queries.yaml", "must be a non-empty list");
  }
  return parsed.map((record, index) => parseQuery(record, index));
}

/** Loads and validates both fixture files. */
export async function loadFixture(): Promise<{ corpus: CorpusEntry[]; queries: QuerySpec[] }> {
  const [corpusText, queriesText] = await Promise.all([
    Deno.readTextFile(CORPUS_URL),
    Deno.readTextFile(QUERIES_URL),
  ]);
  return { corpus: parseCorpus(corpusText), queries: parseQueries(queriesText) };
}

/** Writes the corpus into a temporary workspace tree, one file per source tag. */
export async function materializeFixture(corpus: readonly CorpusEntry[]): Promise<Fixture> {
  const root = await Deno.makeTempDir({ prefix: "memory-recall-benchmark-" });
  const manager = new WorkspaceManager({ repoPath: root, workspacesDir: "workspaces" });
  const store = new MemoryStore(manager, { searchLimit: 10, maxChars: 2000 });
  const event = (isDm: boolean) => ({
    platform: "discord" as Platform,
    channelId: "channel123",
    userId: "user456",
    messageId: "msg789",
    guildId: "guild001",
    isDm,
    content: "benchmark",
    timestamp: FIXED_CLOCK,
  });
  const dmWorkspace = await manager.getOrCreateWorkspace(event(true));
  const guildWorkspace = await manager.getOrCreateWorkspace(event(false));
  const channelWorkspace = await manager.getOrCreateChannelWorkspace("discord", "channel123");

  const paths: Record<CorpusSource, string> = {
    "user-public": store.getMemoryFilePathFor(dmWorkspace, "public"),
    "user-private": store.getMemoryFilePathFor(dmWorkspace, "private"),
    "channel": store.getChannelMemoryFilePathFor(channelWorkspace),
  };
  const lines: Record<CorpusSource, string[]> = {
    "user-public": [],
    "user-private": [],
    "channel": [],
  };
  for (const entry of corpus) {
    lines[entry.source].push(JSON.stringify(entry.event));
  }
  // Fixed file set and fixed write order, so the script and the regression test
  // always build the same tree (the snapshot cache keys on size + mtime).
  for (const source of CORPUS_SOURCES) {
    if (lines[source].length === 0) continue;
    await Deno.writeTextFile(paths[source], lines[source].join("\n") + "\n");
  }

  return {
    root,
    workspaces: { store, dmWorkspace, guildWorkspace, channelWorkspace },
  };
}

/** Materializes the fixture, runs `fn`, then removes the temporary tree. */
export async function withFixture<T>(
  corpus: readonly CorpusEntry[],
  fn: (fixture: Fixture) => Promise<T>,
): Promise<T> {
  const fixture = await materializeFixture(corpus);
  try {
    return await fn(fixture);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
}

/** A retriever over the fixture with the given thresholds and the fixed clock. */
export function createRetriever(
  store: MemoryStore,
  thresholds: Thresholds,
  secondResultRatio: number = SECOND_RESULT_RATIO,
): MemoryRetriever {
  return new MemoryRetriever(
    store,
    { ...DEFAULT_RECALL_CONFIG, ...thresholds, secondResultRatio },
    { now: () => FIXED_CLOCK },
  );
}

/** The recall request a fixture query describes. */
export function toRequest(
  query: QuerySpec,
  workspaces: FixtureWorkspaces,
): MemoryRecallRequest {
  const request: MemoryRecallRequest = {
    mode: "fast",
    query: query.current,
    workspace: query.context === "dm" ? workspaces.dmWorkspace : workspaces.guildWorkspace,
  };
  if (query.previous !== undefined) request.previousUserMessage = query.previous;
  if (query.context === "guild") request.channelWorkspace = workspaces.channelWorkspace;
  if (query.excludeIds !== undefined) request.excludeIds = new Set(query.excludeIds);
  return request;
}

/**
 * Captures each query's ranked candidates with a permissive retriever: no
 * threshold and a zero ratio, so the first two candidates that fit the budget
 * come back whatever their score. The threshold and ratio rules are then
 * replayed over this capture offline. That replay is exact because the engine
 * applies both after ranking and after the `relatedTo` boost, and the fixture's
 * memories always fit the Fast Recall budget.
 */
export async function captureRanked(
  queries: readonly QuerySpec[],
  workspaces: FixtureWorkspaces,
): Promise<CapturedQuery[]> {
  const retriever = createRetriever(workspaces.store, {
    minRecallScore: 0,
    secondRecallScore: 0,
  }, 0);
  const captured: CapturedQuery[] = [];
  for (const query of queries) {
    const response = await retriever.search(toRequest(query, workspaces));
    captured.push(toCaptured(query, response.memories));
  }
  return captured;
}

function toCaptured(query: QuerySpec, memories: readonly MemoryRecallResult[]): CapturedQuery {
  const contents = memories.map((item) => item.memory);
  const tokensTop = contents.length === 0 ? 0 : estimateMemorySectionTokens(contents.slice(0, 1));
  const tokensBoth = contents.length === 0 ? 0 : estimateMemorySectionTokens(contents.slice(0, 2));
  return {
    query,
    ranked: memories.map((item) => ({ id: item.memory.id, score: item.score })),
    tokensTop,
    tokensBoth,
  };
}

/**
 * Replays the Fast Recall selection rule of the engine over a capture:
 * the first candidate is selected when it clears `minRecallScore`, the second
 * only when it is present, clears `secondRecallScore`, and reaches
 * `secondResultRatio` times the first score (the engine's own multiplication,
 * never a division).
 */
export function selectFromCapture(
  captured: CapturedQuery,
  thresholds: Thresholds,
  secondEnabled: boolean,
): Selection {
  const [top, second] = captured.ranked;
  if (top === undefined || top.score < thresholds.minRecallScore) return { ids: [], tokens: 0 };
  if (
    secondEnabled &&
    second !== undefined &&
    second.score >= thresholds.secondRecallScore &&
    second.score >= SECOND_RESULT_RATIO * top.score
  ) {
    return { ids: [top.id, second.id], tokens: captured.tokensBoth };
  }
  return { ids: [top.id], tokens: captured.tokensTop };
}

function offlineOutcome(
  captured: CapturedQuery,
  thresholds: Thresholds,
  secondEnabled: boolean,
): QueryOutcome {
  const selection = selectFromCapture(captured, thresholds, secondEnabled);
  return { query: captured.query, selected: selection.ids, tokens: selection.tokens, latencyMs: 0 };
}

/** Metrics over a set of outcomes (design §12). */
export function computeMetrics(outcomes: readonly QueryOutcome[]): Metrics {
  const positives = outcomes.filter((outcome) => outcome.query.expected.length > 0);
  const recallAt = (k: number): number => {
    if (positives.length === 0) return 0;
    const hits =
      positives.filter((outcome) =>
        outcome.selected.slice(0, k).some((id) => outcome.query.expected.includes(id))
      ).length;
    return hits / positives.length;
  };
  const falsePositives =
    outcomes.filter((outcome) =>
      outcome.selected.some((id) => !outcome.query.expected.includes(id))
    ).length;
  const tokens = outcomes.reduce((sum, outcome) => sum + outcome.tokens, 0);
  return {
    recallAt1: recallAt(1),
    recallAt2: recallAt(2),
    falsePositiveRate: falsePositives / outcomes.length,
    averageInjectedTokens: tokens / outcomes.length,
  };
}

/** Query ids of the false positives an outcome set contains. */
export function falsePositiveQueryIds(outcomes: readonly QueryOutcome[]): string[] {
  return outcomes
    .filter((outcome) => outcome.selected.some((id) => !outcome.query.expected.includes(id)))
    .map((outcome) => outcome.query.id);
}

/** Query ids whose expected memory is missing from the first `k` selections. */
export function missedQueryIds(outcomes: readonly QueryOutcome[], k: number): string[] {
  return outcomes
    .filter((outcome) =>
      outcome.query.expected.length > 0 &&
      !outcome.selected.slice(0, k).some((id) => outcome.query.expected.includes(id))
    )
    .map((outcome) => outcome.query.id);
}

/** Rows that meet the false-positive cap, best first under the spec's tie-breaks. */
function rankRows(
  rows: readonly GridRow[],
  objective: (metrics: Metrics) => number,
): GridRow[] {
  return rows
    .filter((row) => row.metrics.falsePositiveRate <= FALSE_POSITIVE_CAP)
    .sort((a, b) =>
      objective(b.metrics) - objective(a.metrics) ||
      a.metrics.falsePositiveRate - b.metrics.falsePositiveRate ||
      b.value - a.value
    );
}

/**
 * Grid-searches both thresholds. Returns `feasible: false` with the best
 * achievable rows when no grid value meets the cap, so the caller reports
 * instead of weakening the gate (design §12).
 */
export function calibrate(captured: readonly CapturedQuery[]): Calibration {
  const stage1 = THRESHOLD_GRID.map((value) => ({
    value,
    metrics: computeMetrics(captured.map((item) =>
      offlineOutcome(
        item,
        { minRecallScore: value, secondRecallScore: Number.POSITIVE_INFINITY },
        false,
      )
    )),
  }));
  const stage1Feasible = rankRows(stage1, (metrics) => metrics.recallAt1);
  if (stage1Feasible.length === 0) {
    return { feasible: false, stage1, stage2: [], stage1Feasible, stage2Feasible: [] };
  }

  const minRecallScore = stage1Feasible[0].value;
  const stage2 = THRESHOLD_GRID.map((value) => ({
    value,
    metrics: computeMetrics(
      captured.map((item) =>
        offlineOutcome(item, { minRecallScore, secondRecallScore: value }, true)
      ),
    ),
  }));
  const stage2Feasible = rankRows(stage2, (metrics) => metrics.recallAt2);
  if (stage2Feasible.length === 0) {
    return { feasible: false, stage1, stage2, stage1Feasible, stage2Feasible };
  }

  return {
    feasible: true,
    thresholds: { minRecallScore, secondRecallScore: stage2Feasible[0].value },
    stage1,
    stage2,
    stage1Feasible,
    stage2Feasible,
  };
}

/** Nearest-rank p95 of the measured latencies. */
export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.max(rank - 1, 0)];
}

/**
 * Materializes the fixture, warms it up, and measures one real `search()` pass
 * at the given thresholds. The regression test uses this to check the recorded
 * metrics at the default configuration and to perturb a threshold.
 */
export async function runPassOnFixture(
  corpus: readonly CorpusEntry[],
  queries: readonly QuerySpec[],
  thresholds: Thresholds,
): Promise<{ outcomes: QueryOutcome[]; p95LatencyMs: number }> {
  return await withFixture(corpus, async (fixture) => {
    await runPass(queries, fixture.workspaces, thresholds);
    const outcomes = await runPass(queries, fixture.workspaces, thresholds);
    return { outcomes, p95LatencyMs: percentile95(outcomes.map((item) => item.latencyMs)) };
  });
}

/** One real `search()` pass over every query, with per-query latency. */
export async function runPass(
  queries: readonly QuerySpec[],
  workspaces: FixtureWorkspaces,
  thresholds: Thresholds,
): Promise<QueryOutcome[]> {
  const retriever = createRetriever(workspaces.store, thresholds);
  const outcomes: QueryOutcome[] = [];
  for (const query of queries) {
    const started = performance.now();
    const response = await retriever.search(toRequest(query, workspaces));
    const latencyMs = performance.now() - started;
    const contents = response.memories.map((item) => item.memory);
    outcomes.push({
      query,
      selected: response.memories.map((item) => item.memory.id),
      tokens: contents.length === 0 ? 0 : estimateMemorySectionTokens(contents),
      latencyMs,
    });
  }
  return outcomes;
}

/**
 * Fails when the offline threshold model and the real retriever disagree for
 * any query. Called with the calibrated pair and with deliberately wrong probe
 * pairs, so the model the grid search trusts is validated away from a single
 * convenient point.
 */
export function assertModelMatches(
  captured: readonly CapturedQuery[],
  outcomes: readonly QueryOutcome[],
  thresholds: Thresholds,
  secondEnabled: boolean,
): void {
  for (let index = 0; index < captured.length; index++) {
    const expected = selectFromCapture(captured[index], thresholds, secondEnabled).ids;
    const actual = outcomes[index].selected;
    if (expected.join(",") !== actual.join(",")) {
      throw new FixtureError(
        `threshold model mismatch for ${captured[index].query.id} at ` +
          `min=${thresholds.minRecallScore} second=${thresholds.secondRecallScore}: ` +
          `model [${expected.join(", ")}] vs engine [${actual.join(", ")}]`,
      );
    }
  }
}

/** Threshold pairs the model is checked against, including wrong ones. */
function probePairs(calibrated: Thresholds): Thresholds[] {
  const probes: Thresholds[] = [
    calibrated,
    { minRecallScore: THRESHOLD_GRID_START, secondRecallScore: THRESHOLD_GRID_START },
    { minRecallScore: THRESHOLD_GRID_END, secondRecallScore: THRESHOLD_GRID_END },
    {
      minRecallScore: Math.max(calibrated.minRecallScore - 1, THRESHOLD_GRID_START),
      secondRecallScore: Math.min(calibrated.secondRecallScore + 1, THRESHOLD_GRID_END),
    },
    {
      minRecallScore: Math.min(calibrated.minRecallScore + 1, THRESHOLD_GRID_END),
      secondRecallScore: Math.max(calibrated.secondRecallScore - 1, THRESHOLD_GRID_START),
    },
  ];
  const seen = new Set<string>();
  return probes.filter((pair) => {
    const key = `${pair.minRecallScore}/${pair.secondRecallScore}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Runs the whole benchmark: capture, calibrate, measure, verify. */
export async function runBenchmark(): Promise<BenchmarkResult> {
  const { corpus, queries } = await loadFixture();
  return await withFixture(corpus, async (fixture) => {
    const captured = await captureRanked(queries, fixture.workspaces);
    const calibration = calibrate(captured);
    if (!calibration.feasible || calibration.thresholds === undefined) {
      return { calibration, corpus, queries, captured, outcomes: [] };
    }
    const thresholds = calibration.thresholds;

    // One warm-up pass over every query so the snapshot cache, the segmenter
    // and the file stats are hot before latency is measured (design §12).
    await runPass(queries, fixture.workspaces, thresholds);
    const outcomes = await runPass(queries, fixture.workspaces, thresholds);
    assertModelMatches(captured, outcomes, thresholds, true);

    for (const probe of probePairs(thresholds)) {
      if (
        probe.minRecallScore === thresholds.minRecallScore &&
        probe.secondRecallScore === thresholds.secondRecallScore
      ) {
        continue;
      }
      const probeOutcomes = await runPass(queries, fixture.workspaces, probe);
      assertModelMatches(captured, probeOutcomes, probe, true);
    }

    return {
      calibration,
      corpus,
      queries,
      captured,
      outcomes,
      metrics: computeMetrics(outcomes),
      p95LatencyMs: percentile95(outcomes.map((outcome) => outcome.latencyMs)),
    };
  });
}

/** The `metrics.json` payload, in a fixed key order. */
export function toMetricsFile(result: BenchmarkResult): Record<string, unknown> {
  if (result.metrics === undefined || result.calibration.thresholds === undefined) {
    throw new FixtureError("cannot record metrics for an infeasible calibration");
  }
  const thresholds = result.calibration.thresholds;
  const metrics = result.metrics;
  const positives = result.queries.filter((query) => query.expected.length > 0).length;
  return {
    clock: FIXED_CLOCK.toISOString(),
    grid: {
      start: THRESHOLD_GRID_START,
      end: THRESHOLD_GRID_END,
      step: THRESHOLD_GRID_STEP,
    },
    falsePositiveCap: FALSE_POSITIVE_CAP,
    secondResultRatio: SECOND_RESULT_RATIO,
    queryCount: result.queries.length,
    positiveQueryCount: positives,
    negativeQueryCount: result.queries.length - positives,
    minRecallScore: thresholds.minRecallScore,
    secondRecallScore: thresholds.secondRecallScore,
    recallAt1: metrics.recallAt1,
    recallAt2: metrics.recallAt2,
    falsePositiveRate: metrics.falsePositiveRate,
    falsePositiveQueryCount: falsePositiveQueryIds(result.outcomes).length,
    averageInjectedTokens: metrics.averageInjectedTokens,
  };
}

/** Writes `metrics.json` next to the fixture. */
export async function writeMetrics(result: BenchmarkResult): Promise<void> {
  const payload = toMetricsFile(result);
  await Deno.writeTextFile(METRICS_URL, `${JSON.stringify(payload, null, 2)}\n`);
}

function report(result: BenchmarkResult): void {
  const positives = result.queries.filter((query) => query.expected.length > 0).length;
  const maxFalsePositives = Math.floor(FALSE_POSITIVE_CAP * result.queries.length);
  console.log(
    `Memory Recall Fast-mode calibration — clock ${FIXED_CLOCK.toISOString()}`,
  );
  console.log(
    `fixture: ${result.corpus.filter((entry) => entry.event.type === "memory").length} memories ` +
      `(${result.corpus.length} events), ${result.queries.length} queries ` +
      `(${positives} positive, ${result.queries.length - positives} negative), ` +
      `false-positive cap ${FALSE_POSITIVE_CAP * 100}% ` +
      `(at most ${maxFalsePositives} false-positive queries)`,
  );
  console.log(
    `grid: ${THRESHOLD_GRID_START}..${THRESHOLD_GRID_END} step ${THRESHOLD_GRID_STEP} ` +
      `(${THRESHOLD_GRID.length} values), secondResultRatio ${SECOND_RESULT_RATIO}`,
  );

  const { calibration } = result;
  if (!calibration.feasible || calibration.thresholds === undefined) {
    console.log("");
    console.log("NO FEASIBLE CALIBRATION: no grid value meets the false-positive cap.");
    if (calibration.stage1Feasible.length > 0) {
      const best = calibration.stage1Feasible[0];
      console.log(
        `best top-only stage: minRecallScore=${best.value} ` +
          `Recall@1=${best.metrics.recallAt1.toFixed(4)} ` +
          `FP=${best.metrics.falsePositiveRate.toFixed(4)}`,
      );
    }
    if (calibration.stage2.length === 0) {
      console.log("stage 2 was not reached: no minRecallScore met the cap.");
    } else if (calibration.stage2Feasible.length === 0) {
      const best = [...calibration.stage2].sort((a, b) =>
        a.metrics.falsePositiveRate - b.metrics.falsePositiveRate
      )[0];
      console.log(
        `stage 2 has no feasible secondRecallScore at minRecallScore=` +
          `${calibration.stage1Feasible[0]?.value}; best FP=` +
          `${best.metrics.falsePositiveRate.toFixed(4)} at secondRecallScore=${best.value}`,
      );
      console.log(
        "the top-only configuration is the only one that meets the cap; " +
          "the fixture needs a query whose expected memory is ranked second.",
      );
    }
    return;
  }

  const thresholds = calibration.thresholds;
  console.log("");
  console.log(
    `calibrated: minRecallScore=${thresholds.minRecallScore} ` +
      `secondRecallScore=${thresholds.secondRecallScore}`,
  );
  if (result.metrics !== undefined) {
    console.log(
      `metrics: Recall@1=${result.metrics.recallAt1.toFixed(4)} ` +
        `Recall@2=${result.metrics.recallAt2.toFixed(4)} ` +
        `FP=${result.metrics.falsePositiveRate.toFixed(4)} ` +
        `avgTokens=${result.metrics.averageInjectedTokens.toFixed(4)}`,
    );
  }
  if (result.p95LatencyMs !== undefined) {
    console.log(
      `p95 search latency: ${result.p95LatencyMs.toFixed(3)} ms ` +
        `(ceiling ${LATENCY_CEILING_MS} ms)`,
    );
  }

  const falsePositives = falsePositiveQueryIds(result.outcomes);
  console.log(
    `false-positive queries: ${falsePositives.length === 0 ? "none" : falsePositives.join(", ")}`,
  );
  const missed = missedQueryIds(result.outcomes, 1);
  console.log(`Recall@1 misses: ${missed.length === 0 ? "none" : missed.join(", ")}`);

  const rejectedByCap =
    calibration.stage1.filter((row) => row.metrics.falsePositiveRate > FALSE_POSITIVE_CAP).length;
  const rejectedByRecall =
    calibration.stage1.filter((row) =>
      row.metrics.falsePositiveRate <= FALSE_POSITIVE_CAP &&
      row.metrics.recallAt1 < calibration.stage1Feasible[0].metrics.recallAt1
    ).length;
  console.log(
    `constraint analysis: minRecallScore — ${rejectedByCap}/${THRESHOLD_GRID.length} grid values ` +
      `rejected by the cap, ${rejectedByRecall} rejected by Recall@1`,
  );
  const stage2Cap =
    calibration.stage2.filter((row) => row.metrics.falsePositiveRate > FALSE_POSITIVE_CAP).length;
  const stage2Recall =
    calibration.stage2.filter((row) =>
      row.metrics.falsePositiveRate <= FALSE_POSITIVE_CAP &&
      row.metrics.recallAt2 < calibration.stage2Feasible[0].metrics.recallAt2
    ).length;
  console.log(
    `constraint analysis: secondRecallScore — ${stage2Cap}/${THRESHOLD_GRID.length} grid values ` +
      `rejected by the cap, ${stage2Recall} rejected by Recall@2`,
  );

  console.log("");
  console.log("per-query:");
  console.log(
    ["id", "case", "ctx", "expected", "selected", "ranked", "tokens", "ms"].join("\t"),
  );
  for (let index = 0; index < result.outcomes.length; index++) {
    const outcome = result.outcomes[index];
    console.log([
      outcome.query.id,
      outcome.query.case,
      outcome.query.context,
      outcome.query.expected.join("+") || "-",
      outcome.selected.join("+") || "-",
      result.captured[index].ranked.map((item) => `${item.id}:${item.score.toFixed(2)}`).join(
        " ",
      ) ||
      "-",
      String(outcome.tokens),
      outcome.latencyMs.toFixed(3),
    ].join("\t"));
  }
}

interface Options {
  write: boolean;
  quiet: boolean;
  help: boolean;
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = { write: false, quiet: false, help: false };
  for (const arg of args) {
    switch (arg) {
      case "--write":
        options.write = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new FixtureError(`unknown argument "${arg}"`);
    }
  }
  return options;
}

const USAGE = `Usage: deno run --allow-read --allow-write --allow-env --allow-ffi \\
  scripts/memory-recall-benchmark.ts [--write] [--quiet]

  --write   record the calibrated thresholds and metrics in metrics.json
  --quiet   print only the calibrated thresholds
`;

async function main(): Promise<void> {
  const options = parseArgs(Deno.args);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const result = await runBenchmark();
  if (!options.quiet) report(result);

  if (!result.calibration.feasible || result.calibration.thresholds === undefined) {
    console.error(
      "memory-recall-benchmark: the 5% false-positive cap is unattainable; " +
        "fix the fixture or the ranking, never the cap.",
    );
    Deno.exitCode = 1;
    return;
  }
  if (options.quiet) {
    const thresholds = result.calibration.thresholds;
    console.log(
      `minRecallScore=${thresholds.minRecallScore} secondRecallScore=${thresholds.secondRecallScore}`,
    );
  }
  if (options.write) {
    await writeMetrics(result);
    console.log(`wrote ${METRICS_URL.pathname}`);
  }
}

if (import.meta.main) {
  await main();
}
