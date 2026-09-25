// scripts/memory-recall-benchmark.ts

/**
 * Offline calibration benchmark for Fast Recall (Memory Recall v2 design, §12).
 *
 * The script materializes the committed fixture (`tests/fixtures/memory-recall/`)
 * into a temporary workspace tree — the memory files and the agent workspace
 * notes — runs Fast Recall over every labeled query with a fixed clock, and
 * grid-searches `minRecallScore`/`secondRecallScore` and, independently,
 * `noteMinRecallScore`/`secondNoteRecallScore` under a false-positive cap of 5%.
 * It reports Recall@1, Recall@2, the false-positive rate, the average injected
 * tokens and the p95 search latency, for memories and notes separately, and with
 * `--write` it records the calibrated thresholds and the metrics in
 * `metrics.json` for the regression test.
 *
 * Two-stage search, as the requirement states it: `minRecallScore` is the grid
 * value that maximizes Recall@1 subject to the cap (evaluated with the second
 * selection disabled, so the metric isolates the first selection), and
 * `secondRecallScore` is the grid value that maximizes Recall@2 under the same
 * cap with `minRecallScore` fixed. The note thresholds follow the same two
 * stages over the note selection. Ties break on the lower false-positive rate,
 * then on the higher threshold.
 *
 * The memory metrics and the memory thresholds are computed over the memory
 * queries alone (`!isNoteQuery`), so extending the fixture with note queries
 * cannot move the committed memory gate. The note metrics are computed over
 * every query, because a note pointer injected into a memory turn is still a
 * note false positive.
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

import { dirname } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  estimateMemorySectionTokens,
  estimateNoteSectionTokens,
} from "@core/memory-recall/fast-recall.ts";
import { DEFAULT_RECALL_CONFIG } from "@core/memory-recall/recall-config.ts";
import { MemoryRetriever } from "@core/memory-recall/retriever.ts";
import type {
  MemoryRecallRequest,
  MemoryRecallResult,
  RecallResponse,
} from "@core/memory-recall/retriever.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import type { Platform } from "../src/types/events.ts";
import type { MemoryLogEvent, NoteRecallResult } from "../src/types/memory.ts";
import type { ChannelWorkspaceInfo, WorkspaceInfo } from "../src/types/workspace.ts";

/** Fixed clock of the fixture, so recency bonuses are stable (design §12). */
export const FIXED_CLOCK = new Date("2026-09-01T00:00:00.000Z");

const FIXTURE_DIR = new URL("../tests/fixtures/memory-recall/", import.meta.url);

/** The committed fixture files. */
export const CORPUS_URL = new URL("corpus.jsonl", FIXTURE_DIR);
export const QUERIES_URL = new URL("queries.yaml", FIXTURE_DIR);
export const METRICS_URL = new URL("metrics.json", FIXTURE_DIR);
/** The committed agent workspace notes, materialized into the fixture tree. */
export const NOTES_URL = new URL("notes/", FIXTURE_DIR);

/**
 * Agent workspace root the fixture's note metrics are measured at, which is the
 * path the design documents. The fixture's real root is a temporary directory
 * whose length varies by a character or two, and a note pointer renders its
 * absolute path, so measuring at the temporary root would move
 * `averageInjectedTokens` between runs and between machines.
 */
export const FIXTURE_AGENT_WORKSPACE = "/app/data/agent-workspace";

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

/** The two memory thresholds this benchmark calibrates. */
export interface Thresholds {
  minRecallScore: number;
  secondRecallScore: number;
}

/** The two note thresholds this benchmark calibrates. */
export interface NoteThresholds {
  noteMinRecallScore: number;
  secondNoteRecallScore: number;
}

/** All four thresholds, as the retriever configuration holds them. */
export interface RecallThresholds extends Thresholds, NoteThresholds {}

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
  /** Note paths this query may select without a false positive, `notes/x.md`. */
  expectedNotes: string[];
}

/** One committed agent workspace note. */
export interface NoteFixture {
  /** Workspace-relative path, e.g. `notes/cooking.md`. */
  path: string;
  content: string;
}

/** The workspace tree the fixture is materialized into. */
export interface FixtureWorkspaces {
  store: MemoryStore;
  dmWorkspace: WorkspaceInfo;
  guildWorkspace: WorkspaceInfo;
  channelWorkspace: ChannelWorkspaceInfo;
  /** Root of the materialized agent workspace, holding the fixture notes. */
  agentWorkspacePath: string;
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

/** One selected note and its score, as the capture pass saw them. */
export interface RankedNote {
  path: string;
  score: number;
}

/** A query's ranked candidates (at most two each) and its rendered token costs. */
export interface CapturedQuery {
  query: QuerySpec;
  ranked: readonly RankedMemory[];
  /** Rendered tokens of the first candidate alone. */
  tokensTop: number;
  /** Rendered tokens of the first two candidates. */
  tokensBoth: number;
  rankedNotes: readonly RankedNote[];
  /** Rendered tokens of the first note entry plus the note heading. */
  noteTokensTop: number;
  /** Rendered tokens of the first two note entries plus the note heading. */
  noteTokensBoth: number;
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
  /** Selected note paths, in ranking order. */
  selectedNotes: string[];
  /** Rendered tokens of the selected note entries plus their heading. */
  noteTokens: number;
  latencyMs: number;
}

/** The four recorded metrics of the regression gate. */
export interface Metrics {
  recallAt1: number;
  recallAt2: number;
  falsePositiveRate: number;
  averageInjectedTokens: number;
}

/** The four recorded note metrics of the regression gate. */
export type NoteMetrics = Metrics;

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
  /** The note search, the same two stages over the note thresholds. */
  noteFeasible: boolean;
  noteThresholds?: NoteThresholds;
  noteStage1: GridRow[];
  noteStage2: GridRow[];
  noteStage1Feasible: GridRow[];
  noteStage2Feasible: GridRow[];
}

/** The complete result of one benchmark run. */
export interface BenchmarkResult {
  calibration: Calibration;
  corpus: readonly CorpusEntry[];
  queries: readonly QuerySpec[];
  notes: readonly NoteFixture[];
  captured: readonly CapturedQuery[];
  outcomes: readonly QueryOutcome[];
  metrics?: Metrics;
  noteMetrics?: NoteMetrics;
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
    [
      "id",
      "case",
      "context",
      "current",
      "previous",
      "excludeIds",
      "expected",
      "expectedNotes",
    ],
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
    expectedNotes: requireOptionalStringArray(fields.expectedNotes, "expectedNotes", where) ?? [],
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

/** Reads the committed agent workspace notes, in name order. */
export async function loadNotes(): Promise<NoteFixture[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(NOTES_URL)) {
    if (entry.isFile && entry.name.endsWith(".md")) names.push(entry.name);
  }
  names.sort();
  if (names.length === 0) fail("notes/", "holds no Markdown note");

  const notes: NoteFixture[] = [];
  for (const name of names) {
    notes.push({
      path: `notes/${name}`,
      content: await Deno.readTextFile(new URL(name, NOTES_URL)),
    });
  }
  return notes;
}

/** Loads and validates every fixture file. */
export async function loadFixture(): Promise<{
  corpus: CorpusEntry[];
  queries: QuerySpec[];
  notes: NoteFixture[];
}> {
  const [corpusText, queriesText, notes] = await Promise.all([
    Deno.readTextFile(CORPUS_URL),
    Deno.readTextFile(QUERIES_URL),
    loadNotes(),
  ]);
  return { corpus: parseCorpus(corpusText), queries: parseQueries(queriesText), notes };
}

/**
 * Writes the corpus into a temporary workspace tree, one file per source tag,
 * and the notes into the agent workspace of the same tree.
 */
export async function materializeFixture(
  corpus: readonly CorpusEntry[],
  notes: readonly NoteFixture[],
): Promise<Fixture> {
  const root = await Deno.makeTempDir({ prefix: "memory-recall-benchmark-" });
  const manager = new WorkspaceManager({ repoPath: root, workspacesDir: "workspaces" });
  const store = new MemoryStore(manager, {});
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

  // Fixed file set and fixed write order here too, so the note walk of the
  // snapshot cache sees the same tree in every run.
  const agentWorkspacePath = `${root}/agent-workspace`;
  for (const note of notes) {
    const path = `${agentWorkspacePath}/${note.path}`;
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, note.content);
  }

  return {
    root,
    workspaces: {
      store,
      dmWorkspace,
      guildWorkspace,
      channelWorkspace,
      agentWorkspacePath,
    },
  };
}

/** Materializes the fixture, runs `fn`, then removes the temporary tree. */
export async function withFixture<T>(
  corpus: readonly CorpusEntry[],
  notes: readonly NoteFixture[],
  fn: (fixture: Fixture) => Promise<T>,
): Promise<T> {
  const fixture = await materializeFixture(corpus, notes);
  try {
    return await fn(fixture);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
}

/** Engine settings a probe needs to differ from the shipped defaults. */
export interface RetrieverOptions {
  secondResultRatio?: number;
  /** 1 admits only the first candidate, which is how the engine disables the second. */
  fastRecallMaxResults?: number;
  /** The note equivalent of `fastRecallMaxResults`. */
  fastRecallNoteMaxResults?: number;
}

/** A retriever over the fixture with the given thresholds and the fixed clock. */
export function createRetriever(
  store: MemoryStore,
  thresholds: RecallThresholds,
  options: RetrieverOptions = {},
): MemoryRetriever {
  return new MemoryRetriever(
    store,
    {
      ...DEFAULT_RECALL_CONFIG,
      ...thresholds,
      secondResultRatio: options.secondResultRatio ?? SECOND_RESULT_RATIO,
      fastRecallMaxResults: options.fastRecallMaxResults ??
        DEFAULT_RECALL_CONFIG.fastRecallMaxResults,
      fastRecallNoteMaxResults: options.fastRecallNoteMaxResults ??
        DEFAULT_RECALL_CONFIG.fastRecallNoteMaxResults,
    },
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
    agentWorkspacePath: workspaces.agentWorkspacePath,
  };
  if (query.previous !== undefined) request.previousUserMessage = query.previous;
  if (query.context === "guild") request.channelWorkspace = workspaces.channelWorkspace;
  if (query.excludeIds !== undefined) request.excludeIds = new Set(query.excludeIds);
  return request;
}

/** Note queries carry a `note-` case tag; the memory metrics skip them. */
export function isNoteQuery(query: QuerySpec): boolean {
  return query.case.startsWith("note-");
}

/**
 * Fixture key of a materialized note: its path inside the agent workspace, the
 * form `expectedNotes` uses. The engine reports absolute paths, which embed the
 * temporary root, so every comparison normalizes through here.
 */
export function noteFixturePath(agentWorkspacePath: string, path: string): string {
  const prefix = `${agentWorkspacePath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Rendered tokens of the given note pointers, measured at the canonical
 * workspace root rather than the fixture's temporary one, so the recorded note
 * metric is the same on every run and every machine.
 *
 * This is a measurement-stability device only: the engine measures the real
 * absolute path, whose length varies with `workspace.repoPath` and with the
 * temporary root, and this value is a reported average that no selection ever
 * reads. A deployment whose repo path is not the documented one injects a note
 * entry a couple of tokens larger or smaller than the recorded average.
 */
function noteSectionTokens(
  notes: readonly NoteRecallResult[],
  agentWorkspacePath: string,
): number {
  if (notes.length === 0) return 0;
  return estimateNoteSectionTokens(notes.map((note) => ({
    ...note,
    path: `${FIXTURE_AGENT_WORKSPACE}/${noteFixturePath(agentWorkspacePath, note.path)}`,
  })));
}

/** The outcomes of the memory queries: the population the memory metrics use. */
export function memoryOutcomes(outcomes: readonly QueryOutcome[]): QueryOutcome[] {
  return outcomes.filter((outcome) => !isNoteQuery(outcome.query));
}

/**
 * Captures each query's ranked candidates with a permissive retriever: no
 * threshold and a zero ratio, for memories and for notes, so the first two
 * candidates of each kind that fit their budget come back whatever their score.
 * The threshold and ratio rules are then replayed over this capture offline.
 * That replay is exact because the engine applies both after ranking and after
 * the `relatedTo` boost, and the fixture's memories and notes always fit their
 * Fast Recall budgets — the memory budget and the note budget both, which is
 * why the note capture is permissive on its own thresholds too. The model does
 * not replay either budget; `assertModelMatches` fails the run when one of them
 * starts to bind, because the engine would then drop an entry the model keeps.
 */
export async function captureRanked(
  queries: readonly QuerySpec[],
  workspaces: FixtureWorkspaces,
): Promise<CapturedQuery[]> {
  const retriever = createRetriever(workspaces.store, {
    minRecallScore: 0,
    secondRecallScore: 0,
    noteMinRecallScore: 0,
    secondNoteRecallScore: 0,
  }, { secondResultRatio: 0 });
  const captured: CapturedQuery[] = [];
  for (const query of queries) {
    const response = await retriever.search(toRequest(query, workspaces));
    captured.push(toCaptured(query, response, workspaces.agentWorkspacePath));
  }
  return captured;
}

function toCaptured(
  query: QuerySpec,
  response: RecallResponse,
  agentWorkspacePath: string,
): CapturedQuery {
  const contents = response.memories.map((item) => item.memory);
  const tokensTop = contents.length === 0 ? 0 : estimateMemorySectionTokens(contents.slice(0, 1));
  const tokensBoth = contents.length === 0 ? 0 : estimateMemorySectionTokens(contents.slice(0, 2));
  const notes = response.notes;
  return {
    query,
    ranked: response.memories.map((item) => ({ id: item.memory.id, score: item.score })),
    tokensTop,
    tokensBoth,
    rankedNotes: notes.map((note) => ({
      path: noteFixturePath(agentWorkspacePath, note.path),
      score: note.score,
    })),
    noteTokensTop: noteSectionTokens(notes.slice(0, 1), agentWorkspacePath),
    noteTokensBoth: noteSectionTokens(notes.slice(0, 2), agentWorkspacePath),
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

/**
 * Replays the Fast Recall note selection rule over a capture, the note twin of
 * `selectFromCapture`: the first note is selected when it clears
 * `noteMinRecallScore`, the second only when it clears `secondNoteRecallScore`
 * and reaches `secondResultRatio` times the first score.
 */
export function selectNotesFromCapture(
  captured: CapturedQuery,
  thresholds: NoteThresholds,
  secondEnabled: boolean,
): Selection {
  const [top, second] = captured.rankedNotes;
  if (top === undefined || top.score < thresholds.noteMinRecallScore) {
    return { ids: [], tokens: 0 };
  }
  if (
    secondEnabled &&
    second !== undefined &&
    second.score >= thresholds.secondNoteRecallScore &&
    second.score >= SECOND_RESULT_RATIO * top.score
  ) {
    return { ids: [top.path, second.path], tokens: captured.noteTokensBoth };
  }
  return { ids: [top.path], tokens: captured.noteTokensTop };
}

function offlineOutcome(
  captured: CapturedQuery,
  thresholds: RecallThresholds,
  memorySecondEnabled: boolean,
  noteSecondEnabled: boolean,
): QueryOutcome {
  const memory = selectFromCapture(captured, thresholds, memorySecondEnabled);
  const notes = selectNotesFromCapture(captured, thresholds, noteSecondEnabled);
  return {
    query: captured.query,
    selected: memory.ids,
    tokens: memory.tokens,
    selectedNotes: notes.ids,
    noteTokens: notes.tokens,
    latencyMs: 0,
  };
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

/**
 * The note metrics (design §12): the same four, over the note selection. The
 * population is every outcome, because a note injected on a memory query is a
 * note false positive; the positives are the queries with an expected note.
 */
export function computeNoteMetrics(outcomes: readonly QueryOutcome[]): NoteMetrics {
  const positives = outcomes.filter((outcome) => outcome.query.expectedNotes.length > 0);
  const recallAt = (k: number): number => {
    if (positives.length === 0) return 0;
    const hits =
      positives.filter((outcome) =>
        outcome.selectedNotes.slice(0, k).some((path) => outcome.query.expectedNotes.includes(path))
      ).length;
    return hits / positives.length;
  };
  const falsePositives =
    outcomes.filter((outcome) =>
      outcome.selectedNotes.some((path) => !outcome.query.expectedNotes.includes(path))
    ).length;
  const tokens = outcomes.reduce((sum, outcome) => sum + outcome.noteTokens, 0);
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

/** Query ids where Fast Recall selected an unexpected note. */
export function noteFalsePositiveQueryIds(outcomes: readonly QueryOutcome[]): string[] {
  return outcomes
    .filter((outcome) =>
      outcome.selectedNotes.some((path) => !outcome.query.expectedNotes.includes(path))
    )
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

/** Query ids whose expected note is missing from the first `k` selections. */
export function noteMissedQueryIds(outcomes: readonly QueryOutcome[], k: number): string[] {
  return outcomes
    .filter((outcome) =>
      outcome.query.expectedNotes.length > 0 &&
      !outcome.selectedNotes.slice(0, k).some((path) => outcome.query.expectedNotes.includes(path))
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
 * Grid-searches the two memory thresholds. Returns `feasible: false` with the
 * best achievable rows when no grid value meets the cap, so the caller reports
 * instead of weakening the gate (design §12).
 */
function calibrateMemory(
  captured: readonly CapturedQuery[],
): Pick<
  Calibration,
  "feasible" | "thresholds" | "stage1" | "stage2" | "stage1Feasible" | "stage2Feasible"
> {
  const stage1 = THRESHOLD_GRID.map((value) => ({
    value,
    metrics: computeMetrics(memoryOutcomes(captured.map((item) =>
      offlineOutcome(
        item,
        {
          minRecallScore: value,
          secondRecallScore: Number.POSITIVE_INFINITY,
          noteMinRecallScore: Number.POSITIVE_INFINITY,
          secondNoteRecallScore: Number.POSITIVE_INFINITY,
        },
        false,
        false,
      )
    ))),
  }));
  const stage1Feasible = rankRows(stage1, (metrics) => metrics.recallAt1);
  if (stage1Feasible.length === 0) {
    return { feasible: false, stage1, stage2: [], stage1Feasible, stage2Feasible: [] };
  }

  const minRecallScore = stage1Feasible[0].value;
  const stage2 = THRESHOLD_GRID.map((value) => ({
    value,
    metrics: computeMetrics(
      memoryOutcomes(captured.map((item) =>
        offlineOutcome(
          item,
          {
            minRecallScore,
            secondRecallScore: value,
            noteMinRecallScore: Number.POSITIVE_INFINITY,
            secondNoteRecallScore: Number.POSITIVE_INFINITY,
          },
          true,
          false,
        )
      )),
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

/**
 * Grid-searches the two note thresholds with the same two stages and the same
 * cap, over every query. The memory thresholds are held out of the way, so the
 * rows measure the note selection alone.
 */
function calibrateNotes(
  captured: readonly CapturedQuery[],
): Pick<
  Calibration,
  | "noteFeasible"
  | "noteThresholds"
  | "noteStage1"
  | "noteStage2"
  | "noteStage1Feasible"
  | "noteStage2Feasible"
> {
  const memoryOutOfTheWay: Thresholds = {
    minRecallScore: Number.POSITIVE_INFINITY,
    secondRecallScore: Number.POSITIVE_INFINITY,
  };
  const noteStage1 = THRESHOLD_GRID.map((value) => ({
    value,
    metrics: computeNoteMetrics(captured.map((item) =>
      offlineOutcome(
        item,
        {
          ...memoryOutOfTheWay,
          noteMinRecallScore: value,
          secondNoteRecallScore: Number.POSITIVE_INFINITY,
        },
        false,
        false,
      )
    )),
  }));
  const noteStage1Feasible = rankRows(noteStage1, (metrics) => metrics.recallAt1);
  if (noteStage1Feasible.length === 0) {
    return {
      noteFeasible: false,
      noteStage1,
      noteStage2: [],
      noteStage1Feasible,
      noteStage2Feasible: [],
    };
  }

  const noteMinRecallScore = noteStage1Feasible[0].value;
  const noteStage2 = THRESHOLD_GRID.map((value) => ({
    value,
    metrics: computeNoteMetrics(captured.map((item) =>
      offlineOutcome(
        item,
        { ...memoryOutOfTheWay, noteMinRecallScore, secondNoteRecallScore: value },
        false,
        true,
      )
    )),
  }));
  const noteStage2Feasible = rankRows(noteStage2, (metrics) => metrics.recallAt2);
  if (noteStage2Feasible.length === 0) {
    return {
      noteFeasible: false,
      noteStage1,
      noteStage2,
      noteStage1Feasible,
      noteStage2Feasible,
    };
  }

  return {
    noteFeasible: true,
    noteThresholds: {
      noteMinRecallScore,
      secondNoteRecallScore: noteStage2Feasible[0].value,
    },
    noteStage1,
    noteStage2,
    noteStage1Feasible,
    noteStage2Feasible,
  };
}

/**
 * Grid-searches all four thresholds. The memory and the note searches are
 * independent, so an infeasible one never hides the other's evidence.
 */
export function calibrate(captured: readonly CapturedQuery[]): Calibration {
  const memory = calibrateMemory(captured);
  const notes = calibrateNotes(captured);
  return {
    feasible: memory.feasible,
    ...(memory.thresholds === undefined ? {} : { thresholds: memory.thresholds }),
    stage1: memory.stage1,
    stage2: memory.stage2,
    stage1Feasible: memory.stage1Feasible,
    stage2Feasible: memory.stage2Feasible,
    noteFeasible: notes.noteFeasible,
    ...(notes.noteThresholds === undefined ? {} : { noteThresholds: notes.noteThresholds }),
    noteStage1: notes.noteStage1,
    noteStage2: notes.noteStage2,
    noteStage1Feasible: notes.noteStage1Feasible,
    noteStage2Feasible: notes.noteStage2Feasible,
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
  notes: readonly NoteFixture[],
  queries: readonly QuerySpec[],
  thresholds: RecallThresholds,
): Promise<{ outcomes: QueryOutcome[]; p95LatencyMs: number }> {
  return await withFixture(corpus, notes, async (fixture) => {
    await runPass(queries, fixture.workspaces, thresholds);
    const outcomes = await runPass(queries, fixture.workspaces, thresholds);
    return { outcomes, p95LatencyMs: percentile95(outcomes.map((item) => item.latencyMs)) };
  });
}

/** One real `search()` pass over every query, with per-query latency. */
export async function runPass(
  queries: readonly QuerySpec[],
  workspaces: FixtureWorkspaces,
  thresholds: RecallThresholds,
  options: RetrieverOptions = {},
): Promise<QueryOutcome[]> {
  const retriever = createRetriever(workspaces.store, thresholds, options);
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
      selectedNotes: response.notes.map((note) =>
        noteFixturePath(workspaces.agentWorkspacePath, note.path)
      ),
      noteTokens: noteSectionTokens(response.notes, workspaces.agentWorkspacePath),
      latencyMs,
    });
  }
  return outcomes;
}

/**
 * Fails when the offline threshold model and the real retriever disagree for
 * any query, for the memory selection and the note selection. Called with the
 * calibrated thresholds and with deliberately wrong probe pairs, so the model
 * the grid search trusts is validated away from a single convenient point.
 */
export function assertModelMatches(
  captured: readonly CapturedQuery[],
  outcomes: readonly QueryOutcome[],
  thresholds: RecallThresholds,
  memorySecondEnabled: boolean,
  noteSecondEnabled: boolean,
): void {
  for (let index = 0; index < captured.length; index++) {
    const expected = selectFromCapture(captured[index], thresholds, memorySecondEnabled).ids;
    const actual = outcomes[index].selected;
    if (expected.join(",") !== actual.join(",")) {
      throw new FixtureError(
        `memory threshold model mismatch for ${captured[index].query.id} at ` +
          `min=${thresholds.minRecallScore} second=${thresholds.secondRecallScore}: ` +
          `model [${expected.join(", ")}] vs engine [${actual.join(", ")}]`,
      );
    }

    const expectedNotes = selectNotesFromCapture(captured[index], thresholds, noteSecondEnabled)
      .ids;
    const actualNotes = outcomes[index].selectedNotes;
    if (expectedNotes.join(",") !== actualNotes.join(",")) {
      throw new FixtureError(
        `note threshold model mismatch for ${captured[index].query.id} at ` +
          `min=${thresholds.noteMinRecallScore} second=${thresholds.secondNoteRecallScore}: ` +
          `model [${expectedNotes.join(", ")}] vs engine [${actualNotes.join(", ")}]`,
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

/**
 * Threshold pairs that sit exactly on the comparisons the model shares with the
 * engine: the first candidate is admitted at score equality with
 * `minRecallScore`, and the second at score equality with `secondRecallScore`
 * but not just above it. Taken from the first captured query with a second
 * candidate.
 */
function boundaryPairs(captured: readonly CapturedQuery[]): Thresholds[] {
  const item = captured.find((entry) => entry.ranked.length > 1);
  if (item === undefined) return [];
  const [top, second] = item.ranked;
  return [
    { minRecallScore: top.score, secondRecallScore: second.score },
    { minRecallScore: top.score, secondRecallScore: second.score + 0.01 },
  ];
}

/** Threshold pairs the note model is checked against, including wrong ones. */
function noteProbePairs(calibrated: NoteThresholds): NoteThresholds[] {
  const probes: NoteThresholds[] = [
    calibrated,
    { noteMinRecallScore: THRESHOLD_GRID_START, secondNoteRecallScore: THRESHOLD_GRID_START },
    { noteMinRecallScore: THRESHOLD_GRID_END, secondNoteRecallScore: THRESHOLD_GRID_END },
    {
      noteMinRecallScore: Math.max(calibrated.noteMinRecallScore - 1, THRESHOLD_GRID_START),
      secondNoteRecallScore: Math.min(calibrated.secondNoteRecallScore + 1, THRESHOLD_GRID_END),
    },
    {
      noteMinRecallScore: Math.min(calibrated.noteMinRecallScore + 1, THRESHOLD_GRID_END),
      secondNoteRecallScore: Math.max(calibrated.secondNoteRecallScore - 1, THRESHOLD_GRID_START),
    },
  ];
  const seen = new Set<string>();
  return probes.filter((pair) => {
    const key = `${pair.noteMinRecallScore}/${pair.secondNoteRecallScore}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The note twin of `boundaryPairs`: score equality with `noteMinRecallScore`
 * and with `secondNoteRecallScore`, taken from the first captured query with a
 * second note.
 */
function noteBoundaryPairs(captured: readonly CapturedQuery[]): NoteThresholds[] {
  const item = captured.find((entry) => entry.rankedNotes.length > 1);
  if (item === undefined) return [];
  const [top, second] = item.rankedNotes;
  return [
    { noteMinRecallScore: top.score, secondNoteRecallScore: second.score },
    { noteMinRecallScore: top.score, secondNoteRecallScore: second.score + 0.01 },
  ];
}

/** Runs the whole benchmark: capture, calibrate, measure, verify. */
export async function runBenchmark(): Promise<BenchmarkResult> {
  const { corpus, queries, notes } = await loadFixture();
  return await withFixture(corpus, notes, async (fixture) => {
    const captured = await captureRanked(queries, fixture.workspaces);
    const calibration = calibrate(captured);
    if (
      !calibration.feasible || calibration.thresholds === undefined ||
      !calibration.noteFeasible || calibration.noteThresholds === undefined
    ) {
      return { calibration, corpus, queries, notes, captured, outcomes: [] };
    }
    const thresholds: RecallThresholds = {
      ...calibration.thresholds,
      ...calibration.noteThresholds,
    };

    // One warm-up pass over every query so the snapshot cache, the segmenter
    // and the file stats are hot before latency is measured (design §12).
    await runPass(queries, fixture.workspaces, thresholds);
    const outcomes = await runPass(queries, fixture.workspaces, thresholds);
    assertModelMatches(captured, outcomes, thresholds, true, true);

    // The calibration also trusts the model with the second selection disabled,
    // so that geometry is checked against an engine that can only return one
    // candidate of each kind, together with the equality boundaries of the
    // comparisons the model re-implements.
    assertModelMatches(
      captured,
      await runPass(queries, fixture.workspaces, thresholds, { fastRecallMaxResults: 1 }),
      thresholds,
      false,
      true,
    );
    assertModelMatches(
      captured,
      await runPass(queries, fixture.workspaces, thresholds, { fastRecallNoteMaxResults: 1 }),
      thresholds,
      true,
      false,
    );
    for (const probe of boundaryPairs(captured)) {
      assertModelMatches(
        captured,
        await runPass(queries, fixture.workspaces, { ...thresholds, ...probe }),
        { ...thresholds, ...probe },
        true,
        true,
      );
    }
    for (const probe of noteBoundaryPairs(captured)) {
      assertModelMatches(
        captured,
        await runPass(queries, fixture.workspaces, { ...thresholds, ...probe }),
        { ...thresholds, ...probe },
        true,
        true,
      );
    }

    for (const probe of probePairs(calibration.thresholds)) {
      if (
        probe.minRecallScore === calibration.thresholds.minRecallScore &&
        probe.secondRecallScore === calibration.thresholds.secondRecallScore
      ) {
        continue;
      }
      const pair: RecallThresholds = { ...thresholds, ...probe };
      assertModelMatches(
        captured,
        await runPass(queries, fixture.workspaces, pair),
        pair,
        true,
        true,
      );
    }
    for (const probe of noteProbePairs(calibration.noteThresholds)) {
      if (
        probe.noteMinRecallScore === calibration.noteThresholds.noteMinRecallScore &&
        probe.secondNoteRecallScore === calibration.noteThresholds.secondNoteRecallScore
      ) {
        continue;
      }
      const pair: RecallThresholds = { ...thresholds, ...probe };
      assertModelMatches(
        captured,
        await runPass(queries, fixture.workspaces, pair),
        pair,
        true,
        true,
      );
    }

    return {
      calibration,
      corpus,
      queries,
      notes,
      captured,
      outcomes,
      metrics: computeMetrics(memoryOutcomes(outcomes)),
      noteMetrics: computeNoteMetrics(outcomes),
      p95LatencyMs: percentile95(outcomes.map((outcome) => outcome.latencyMs)),
    };
  });
}

/** The `metrics.json` payload, in a fixed key order. */
export function toMetricsFile(result: BenchmarkResult): Record<string, unknown> {
  if (
    result.metrics === undefined || result.calibration.thresholds === undefined ||
    result.noteMetrics === undefined || result.calibration.noteThresholds === undefined
  ) {
    throw new FixtureError("cannot record metrics for an infeasible calibration");
  }
  const thresholds = result.calibration.thresholds;
  const noteThresholds = result.calibration.noteThresholds;
  const metrics = result.metrics;
  const noteMetrics = result.noteMetrics;
  // The memory metrics cover the memory queries alone, so adding note queries
  // to the fixture can never move the committed memory gate.
  const memoryQueries = result.queries.filter((query) => !isNoteQuery(query));
  const positives = memoryQueries.filter((query) => query.expected.length > 0).length;
  const notePositives = result.queries.filter((query) => query.expectedNotes.length > 0).length;
  return {
    clock: FIXED_CLOCK.toISOString(),
    grid: {
      start: THRESHOLD_GRID_START,
      end: THRESHOLD_GRID_END,
      step: THRESHOLD_GRID_STEP,
    },
    falsePositiveCap: FALSE_POSITIVE_CAP,
    secondResultRatio: SECOND_RESULT_RATIO,
    queryCount: memoryQueries.length,
    positiveQueryCount: positives,
    negativeQueryCount: memoryQueries.length - positives,
    minRecallScore: thresholds.minRecallScore,
    secondRecallScore: thresholds.secondRecallScore,
    recallAt1: metrics.recallAt1,
    recallAt2: metrics.recallAt2,
    falsePositiveRate: metrics.falsePositiveRate,
    falsePositiveQueryCount: falsePositiveQueryIds(memoryOutcomes(result.outcomes)).length,
    averageInjectedTokens: metrics.averageInjectedTokens,
    notes: {
      noteCount: result.notes.length,
      noteQueryCount: result.queries.length,
      notePositiveQueryCount: notePositives,
      noteMinRecallScore: noteThresholds.noteMinRecallScore,
      secondNoteRecallScore: noteThresholds.secondNoteRecallScore,
      recallAt1: noteMetrics.recallAt1,
      recallAt2: noteMetrics.recallAt2,
      falsePositiveRate: noteMetrics.falsePositiveRate,
      falsePositiveQueryCount: noteFalsePositiveQueryIds(result.outcomes).length,
      averageInjectedTokens: noteMetrics.averageInjectedTokens,
    },
  };
}

/** Writes `metrics.json` next to the fixture. */
export async function writeMetrics(result: BenchmarkResult): Promise<void> {
  const payload = toMetricsFile(result);
  await Deno.writeTextFile(METRICS_URL, `${JSON.stringify(payload, null, 2)}\n`);
}

/** The two constraint-analysis counters of one threshold search stage. */
function constraintCounts(
  rows: readonly GridRow[],
  feasible: readonly GridRow[],
  objective: (metrics: Metrics) => number,
): { rejectedByCap: number; rejectedByObjective: number } {
  return {
    rejectedByCap: rows.filter((row) => row.metrics.falsePositiveRate > FALSE_POSITIVE_CAP).length,
    rejectedByObjective: rows.filter((row) =>
      row.metrics.falsePositiveRate <= FALSE_POSITIVE_CAP &&
      objective(row.metrics) < objective(feasible[0].metrics)
    ).length,
  };
}

function reportMemoryCalibration(result: BenchmarkResult): void {
  const { calibration } = result;
  const outcomes = memoryOutcomes(result.outcomes);
  console.log("");
  console.log("memory thresholds (memory queries only)");
  if (!calibration.feasible || calibration.thresholds === undefined) {
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
      const highestSecond = Math.max(
        0,
        ...result.captured.map((entry) =>
          entry.ranked[1]?.score ?? 0
        ),
      );
      console.log(
        `highest second-candidate score in the capture: ${highestSecond.toFixed(3)} ` +
          `(grid ceiling ${THRESHOLD_GRID_END}); a value above the ceiling means the ` +
          "second selection cannot be disabled through the grid at all.",
      );
    }
    return;
  }

  const thresholds = calibration.thresholds;
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
  const falsePositives = falsePositiveQueryIds(outcomes);
  console.log(
    `false-positive queries: ${falsePositives.length === 0 ? "none" : falsePositives.join(", ")}`,
  );
  const missed = missedQueryIds(outcomes, 1);
  console.log(`Recall@1 misses: ${missed.length === 0 ? "none" : missed.join(", ")}`);

  const stage1 = constraintCounts(
    calibration.stage1,
    calibration.stage1Feasible,
    (metrics) => metrics.recallAt1,
  );
  console.log(
    `constraint analysis: minRecallScore — ${stage1.rejectedByCap}/${THRESHOLD_GRID.length} ` +
      `grid values rejected by the cap, ${stage1.rejectedByObjective} rejected by Recall@1`,
  );
  const stage2 = constraintCounts(
    calibration.stage2,
    calibration.stage2Feasible,
    (metrics) => metrics.recallAt2,
  );
  console.log(
    `constraint analysis: secondRecallScore — ${stage2.rejectedByCap}/${THRESHOLD_GRID.length} ` +
      `grid values rejected by the cap, ${stage2.rejectedByObjective} rejected by Recall@2`,
  );
}

function reportNoteCalibration(result: BenchmarkResult): void {
  const { calibration } = result;
  console.log("");
  console.log("note thresholds (every query)");
  if (!calibration.noteFeasible || calibration.noteThresholds === undefined) {
    console.log("NO FEASIBLE NOTE CALIBRATION: no grid value meets the false-positive cap.");
    if (calibration.noteStage1Feasible.length > 0) {
      const best = calibration.noteStage1Feasible[0];
      console.log(
        `best top-only stage: noteMinRecallScore=${best.value} ` +
          `Recall@1=${best.metrics.recallAt1.toFixed(4)} ` +
          `FP=${best.metrics.falsePositiveRate.toFixed(4)}`,
      );
    }
    if (calibration.noteStage2.length === 0) {
      console.log("stage 2 was not reached: no noteMinRecallScore met the cap.");
    } else if (calibration.noteStage2Feasible.length === 0) {
      const best = [...calibration.noteStage2].sort((a, b) =>
        a.metrics.falsePositiveRate - b.metrics.falsePositiveRate
      )[0];
      console.log(
        `stage 2 has no feasible secondNoteRecallScore at noteMinRecallScore=` +
          `${calibration.noteStage1Feasible[0]?.value}; best FP=` +
          `${best.metrics.falsePositiveRate.toFixed(4)} at secondNoteRecallScore=${best.value}`,
      );
      const highestSecond = Math.max(
        0,
        ...result.captured.map((entry) =>
          entry.rankedNotes[1]?.score ?? 0
        ),
      );
      console.log(
        `highest second-note score in the capture: ${highestSecond.toFixed(3)} ` +
          `(grid ceiling ${THRESHOLD_GRID_END}).`,
      );
    }
    reportNoteCandidates(result);
    return;
  }

  const thresholds = calibration.noteThresholds;
  console.log(
    `calibrated: noteMinRecallScore=${thresholds.noteMinRecallScore} ` +
      `secondNoteRecallScore=${thresholds.secondNoteRecallScore}`,
  );
  if (result.noteMetrics !== undefined) {
    console.log(
      `metrics: Recall@1=${result.noteMetrics.recallAt1.toFixed(4)} ` +
        `Recall@2=${result.noteMetrics.recallAt2.toFixed(4)} ` +
        `FP=${result.noteMetrics.falsePositiveRate.toFixed(4)} ` +
        `avgTokens=${result.noteMetrics.averageInjectedTokens.toFixed(4)}`,
    );
  }
  const falsePositives = noteFalsePositiveQueryIds(result.outcomes);
  console.log(
    `note false-positive queries: ` +
      `${falsePositives.length === 0 ? "none" : falsePositives.join(", ")}`,
  );
  const missed = noteMissedQueryIds(result.outcomes, 1);
  console.log(`note Recall@1 misses: ${missed.length === 0 ? "none" : missed.join(", ")}`);

  const stage1 = constraintCounts(
    calibration.noteStage1,
    calibration.noteStage1Feasible,
    (metrics) => metrics.recallAt1,
  );
  console.log(
    `constraint analysis: noteMinRecallScore — ${stage1.rejectedByCap}/` +
      `${THRESHOLD_GRID.length} grid values rejected by the cap, ` +
      `${stage1.rejectedByObjective} rejected by Recall@1`,
  );
  const stage2 = constraintCounts(
    calibration.noteStage2,
    calibration.noteStage2Feasible,
    (metrics) => metrics.recallAt2,
  );
  console.log(
    `constraint analysis: secondNoteRecallScore — ${stage2.rejectedByCap}/` +
      `${THRESHOLD_GRID.length} grid values rejected by the cap, ` +
      `${stage2.rejectedByObjective} rejected by Recall@2`,
  );
  if (thresholds.noteMinRecallScore >= THRESHOLD_GRID_END) {
    console.log(
      `noteMinRecallScore sits at the grid ceiling ${THRESHOLD_GRID_END}: every note ` +
        "positive scores above it, so the fixture cannot pin the threshold more tightly.",
    );
  }
}

/**
 * Every query whose note candidates are non-empty, with their scores. A cap
 * that cannot be met is a fixture problem, so the tool prints the evidence the
 * maintainer needs to fix the notes or the queries.
 */
function reportNoteCandidates(result: BenchmarkResult): void {
  console.log("");
  console.log("note candidates (queries with at least one candidate):");
  for (const entry of result.captured) {
    if (entry.rankedNotes.length === 0) continue;
    console.log([
      entry.query.id,
      entry.query.case,
      entry.query.expectedNotes.map((path) => path.replace("notes/", "")).join("+") || "-",
      entry.rankedNotes
        .map((note) => `${note.path.replace("notes/", "")}:${note.score.toFixed(2)}`)
        .join(" "),
    ].join("\t"));
  }
}

function reportQueries(result: BenchmarkResult): void {
  console.log("");
  console.log("per-query:");
  console.log(
    [
      "id",
      "case",
      "ctx",
      "expected",
      "selected",
      "ranked",
      "expectedNotes",
      "selectedNotes",
      "rankedNotes",
      "tokens",
      "noteTokens",
      "ms",
    ].join("\t"),
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
      outcome.query.expectedNotes.map((path) => path.replace("notes/", "")).join("+") || "-",
      outcome.selectedNotes.map((path) => path.replace("notes/", "")).join("+") || "-",
      result.captured[index].rankedNotes
        .map((item) => `${item.path.replace("notes/", "")}:${item.score.toFixed(2)}`)
        .join(" ") || "-",
      String(outcome.tokens),
      String(outcome.noteTokens),
      outcome.latencyMs.toFixed(3),
    ].join("\t"));
  }
}

function report(result: BenchmarkResult): void {
  const memoryQueries = result.queries.filter((query) => !isNoteQuery(query));
  const positives = memoryQueries.filter((query) => query.expected.length > 0).length;
  const notePositives = result.queries.filter((query) => query.expectedNotes.length > 0).length;
  const maxFalsePositives = Math.floor(FALSE_POSITIVE_CAP * result.queries.length);
  console.log(
    `Memory Recall Fast-mode calibration — clock ${FIXED_CLOCK.toISOString()}`,
  );
  console.log(
    `fixture: ${result.corpus.filter((entry) => entry.event.type === "memory").length} memories ` +
      `(${result.corpus.length} events), ${result.notes.length} notes, ` +
      `${memoryQueries.length} memory queries (${positives} positive, ` +
      `${memoryQueries.length - positives} negative), ` +
      `${result.queries.length - memoryQueries.length} note queries ` +
      `(${notePositives} positive), false-positive cap ${FALSE_POSITIVE_CAP * 100}% ` +
      `(at most ${maxFalsePositives} of ${result.queries.length} queries)`,
  );
  console.log(
    `grid: ${THRESHOLD_GRID_START}..${THRESHOLD_GRID_END} step ${THRESHOLD_GRID_STEP} ` +
      `(${THRESHOLD_GRID.length} values), secondResultRatio ${SECOND_RESULT_RATIO}`,
  );

  reportMemoryCalibration(result);
  reportNoteCalibration(result);
  reportQueries(result);
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

  if (
    !result.calibration.feasible || result.calibration.thresholds === undefined ||
    !result.calibration.noteFeasible || result.calibration.noteThresholds === undefined
  ) {
    console.error(
      "memory-recall-benchmark: the 5% false-positive cap is unattainable; " +
        "fix the fixture or the ranking, never the cap.",
    );
    Deno.exitCode = 1;
    return;
  }
  if (options.quiet) {
    const thresholds = result.calibration.thresholds;
    const noteThresholds = result.calibration.noteThresholds;
    console.log(
      `minRecallScore=${thresholds.minRecallScore} ` +
        `secondRecallScore=${thresholds.secondRecallScore} ` +
        `noteMinRecallScore=${noteThresholds.noteMinRecallScore} ` +
        `secondNoteRecallScore=${noteThresholds.secondNoteRecallScore}`,
    );
  }
  if (options.write) {
    await writeMetrics(result);
    console.log(`wrote ${METRICS_URL.pathname}`);
    const thresholds = result.calibration.thresholds;
    const noteThresholds = result.calibration.noteThresholds;
    console.log("paste into config.example.yaml and recall-config.ts:");
    console.log(`    minRecallScore: ${thresholds.minRecallScore}`);
    console.log(`    secondRecallScore: ${thresholds.secondRecallScore}`);
    console.log(`    noteMinRecallScore: ${noteThresholds.noteMinRecallScore}`);
    console.log(`    secondNoteRecallScore: ${noteThresholds.secondNoteRecallScore}`);
  }
}

if (import.meta.main) {
  await main();
}
