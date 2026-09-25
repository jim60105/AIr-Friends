// src/core/memory-recall/ranker.ts

import type {
  IndexedMemory,
  IndexedNoteChunk,
  IndexedNoteFile,
  QueryHints,
  RecallQuery,
  ScoredMemory,
  SearchToken,
} from "./types.ts";

/** BM25 parameters (Memory Recall v2 design, §5.3). */
const K1 = 1.2;
const B = 0.75;

/** Fixed bonus weights (Memory Recall v2 design, §5.3). */
const EXACT_ENTITY_BONUS = 1.5;
const EXACT_PHRASE_BONUS = 2.0;
const IMPORTANCE_HIGH_BONUS = 0.2;
const WORKING_TIER_BONUS = 0.15;
const RECENCY_BONUS_MAX = 0.2;
const DECAY_BONUS_MAX = 0.2;
const PREFERENCE_CATEGORY_BONUS = 0.3;
const SUPERSEDED_HISTORICAL_BONUS = 0.2;

/** Recency reaches zero at this age. */
const RECENCY_HORIZON_DAYS = 365;

/** Phrase window bounds (Memory Recall v2 design, §5.3). */
const PHRASE_MIN_TOKENS = 2;
const PHRASE_MAX_TOKENS = 6;
const PHRASE_MIN_CHARS = 4;

const MS_PER_DAY = 86_400_000;

/**
 * CJK Unified Ideographs incl. Extension A. The tokenizer emits single-script
 * terms, so a term is either entirely CJK or entirely alphanumeric.
 */
const CJK_CHAR_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** The part of a document BM25 is computed from. */
interface LexicalDocument {
  tf: Map<string, number>;
  length: number;
}

/** BM25 statistics of one population: its size, average length and term `df`. */
interface CorpusStats {
  n: number;
  avgdl: number;
  df: Map<string, number>;
}

/** A scored note chunk. */
export interface ScoredNoteChunk {
  file: IndexedNoteFile;
  chunk: IndexedNoteChunk;
  /** BM25 sum over the matched query terms, before bonuses. */
  lexicalScore: number;
  /** `lexicalScore` plus the entity and phrase bonuses. */
  score: number;
  /** Distinct matched query terms, sorted. */
  matchedTerms: string[];
}

/** One note file with its matching chunks, aggregated per file. */
export interface ScoredNoteFile {
  file: IndexedNoteFile;
  /** The file's best-scoring chunk, which represents the file. */
  best: ScoredNoteChunk;
  /** Every matching chunk of the file, score descending then line ascending. */
  chunks: ScoredNoteChunk[];
}

/**
 * Scores every memory that matches at least one query token, in ranking order:
 * score descending, then `createdAt` descending, then id ascending. Bonuses are
 * gated on a positive lexical score, so a memory without a lexical match is
 * absent from the result (Memory Recall v2 design, §5.3).
 *
 * `supersededIds` is the authoritative set of superseded memory ids, as defined
 * over every enabled memory in scope. Omit it to infer the set from the
 * population, which misses a superseded memory whose superseder the caller
 * filtered out of the population.
 */
export function scoreMemories(
  population: readonly IndexedMemory[],
  query: RecallQuery,
  hints: QueryHints,
  now: Date,
  supersededIds?: ReadonlySet<string>,
): ScoredMemory[] {
  const stats = corpusStats(population, query);
  if (stats.n === 0) return [];

  const superseded = supersededIds ?? collectSupersededIds(population);
  const scored: ScoredMemory[] = [];
  for (const doc of population) {
    const lexical = lexicalScoreFor(doc, stats, query);
    if (lexical.score <= 0) continue;

    const recency = recencyBonus(doc.memory.createdAt, now);
    const score = lexical.score +
      entityBonus(doc.entities, query) +
      (hasExactPhrase(query.phraseTokens, doc.normalizedText) ? EXACT_PHRASE_BONUS : 0) +
      metadataBonus(doc, hints, recency) +
      temporalBonus(doc, hints, superseded, recency);
    scored.push({
      indexed: doc,
      lexicalScore: lexical.score,
      score,
      matchedTerms: lexical.matchedTerms,
    });
  }

  return scored.sort(compareScoredMemories);
}

/**
 * Scores the note chunks of every file and aggregates them per file (Memory
 * Recall v2 design, §6). `N`, `df` and the average length come from note chunks
 * alone, because chunk and memory lengths differ widely, and only the lexical,
 * entity and phrase terms apply: a note carries no memory metadata. A file's
 * best-scoring chunk is its representative and its score.
 */
export function scoreNoteFiles(
  files: readonly IndexedNoteFile[],
  query: RecallQuery,
): ScoredNoteFile[] {
  const stats = corpusStats(files.flatMap((file) => file.chunks), query);
  const scored: ScoredNoteFile[] = [];

  for (const file of files) {
    const chunks: ScoredNoteChunk[] = [];
    for (const chunk of file.chunks) {
      const lexical = lexicalScoreFor(chunk, stats, query);
      if (lexical.score <= 0) continue;
      const score = lexical.score +
        entityBonus(chunk.entities, query) +
        (hasExactPhrase(query.phraseTokens, chunk.normalizedText) ? EXACT_PHRASE_BONUS : 0);
      chunks.push({
        file,
        chunk,
        lexicalScore: lexical.score,
        score,
        matchedTerms: lexical.matchedTerms,
      });
    }
    if (chunks.length === 0) continue;
    chunks.sort(compareScoredNoteChunks);
    scored.push({ file, best: chunks[0], chunks });
  }

  return scored.sort(compareScoredNoteFiles);
}

/**
 * Ranking order: score descending, then `createdAt` descending, then id
 * ascending. Exported so callers can merge scored lists deterministically.
 */
export function compareScoredMemories(a: ScoredMemory, b: ScoredMemory): number {
  if (a.score !== b.score) return b.score - a.score;
  const aCreatedAt = a.indexed.memory.createdAt;
  const bCreatedAt = b.indexed.memory.createdAt;
  if (aCreatedAt !== bCreatedAt) return aCreatedAt < bCreatedAt ? 1 : -1;
  const aId = a.indexed.memory.id;
  const bId = b.indexed.memory.id;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/** Note chunk order: score descending, then line ascending. */
function compareScoredNoteChunks(a: ScoredNoteChunk, b: ScoredNoteChunk): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.chunk.lineStart - b.chunk.lineStart;
}

/** Note file order: score descending, then path ascending. */
function compareScoredNoteFiles(a: ScoredNoteFile, b: ScoredNoteFile): number {
  if (a.best.score !== b.best.score) return b.best.score - a.best.score;
  return a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0;
}

/** Size, average length and per-query-term document frequency of one population. */
function corpusStats(docs: readonly LexicalDocument[], query: RecallQuery): CorpusStats {
  const n = docs.length;
  let totalLength = 0;
  for (const doc of docs) totalLength += doc.length;

  // `df` is seeded for every query key, so counting needs a single probe per
  // document term and a matched key always has a count.
  const df = new Map<string, number>();
  for (const key of query.tokens.keys()) df.set(key, 0);
  for (const doc of docs) {
    for (const key of doc.tf.keys()) {
      const count = df.get(key);
      if (count !== undefined) df.set(key, count + 1);
    }
  }

  return { n, avgdl: n === 0 ? 0 : totalLength / n, df };
}

/** BM25 sum of one document over the matched query terms, before bonuses. */
function lexicalScoreFor(
  doc: LexicalDocument,
  stats: CorpusStats,
  query: RecallQuery,
): { score: number; matchedTerms: string[] } {
  let score = 0;
  const matched = new Set<string>();
  for (const token of query.tokens.values()) {
    const tf = doc.tf.get(token.key);
    if (tf === undefined) continue;
    score += bm25(tf, doc.length, stats.avgdl, stats.df.get(token.key) ?? 0, stats.n) *
      token.weight;
    matched.add(token.term);
  }
  return { score, matchedTerms: [...matched].sort() };
}

function bm25(tf: number, dl: number, avgdl: number, df: number, n: number): number {
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  const lengthNorm = 1 - B + B * (dl / avgdl);
  return (idf * (tf * (K1 + 1))) / (tf + K1 * lengthNorm);
}

/** Ids named by any document's `supersedes`, used when the caller passes none. */
function collectSupersededIds(population: readonly IndexedMemory[]): Set<string> {
  const ids = new Set<string>();
  for (const doc of population) {
    for (const id of doc.memory.supersedes) ids.add(id);
  }
  return ids;
}

function recencyBonus(createdAt: string, now: Date): number {
  const ageDays = (now.getTime() - Date.parse(createdAt)) / MS_PER_DAY;
  return RECENCY_BONUS_MAX * Math.max(0, 1 - ageDays / RECENCY_HORIZON_DAYS);
}

/** At most once, when an entity of the current message appears in the document. */
function entityBonus(entities: ReadonlySet<string>, query: RecallQuery): number {
  for (const entity of query.entities) {
    if (entities.has(entity)) return EXACT_ENTITY_BONUS;
  }
  return 0;
}

/**
 * Slides windows of 2 to 6 adjacent current-message tokens over the normalized
 * text and stops at the first hit of at least four characters. The bonus is a
 * fixed amount, so which window hits first cannot change the score.
 */
function hasExactPhrase(phraseTokens: readonly SearchToken[], normalizedText: string): boolean {
  if (phraseTokens.length < PHRASE_MIN_TOKENS) return false;
  for (let size = PHRASE_MIN_TOKENS; size <= PHRASE_MAX_TOKENS; size++) {
    for (let start = 0; start + size <= phraseTokens.length; start++) {
      const joined = joinPhrase(phraseTokens.slice(start, start + size));
      // Terms are BMP-only, so the string length is the character count.
      if (joined.length >= PHRASE_MIN_CHARS && normalizedText.includes(joined)) return true;
    }
  }
  return false;
}

/**
 * CJK terms join without a separator and every other adjacent pair joins with a
 * single space, which reproduces the original text across dropped punctuation
 * and entity-internal spaces.
 */
function joinPhrase(window: readonly SearchToken[]): string {
  let joined = window[0].term;
  for (let i = 1; i < window.length; i++) {
    const bothCjk = CJK_CHAR_RE.test(window[i - 1].term) && CJK_CHAR_RE.test(window[i].term);
    if (!bothCjk) joined += " ";
    joined += window[i].term;
  }
  return joined;
}

/** Memories only: importance, tier, recency, decay and the preference category. */
function metadataBonus(doc: IndexedMemory, hints: QueryHints, recency: number): number {
  const { memory } = doc;
  let bonus = recency + DECAY_BONUS_MAX * memory.decay;
  if (memory.importance === "high") bonus += IMPORTANCE_HIGH_BONUS;
  if (memory.tier === "working") bonus += WORKING_TIER_BONUS;
  if (hints.preference && memory.category === "preference") bonus += PREFERENCE_CATEGORY_BONUS;
  return bonus;
}

/** Memories only: a current hint re-adds recency, a historical one rewards supersession. */
function temporalBonus(
  doc: IndexedMemory,
  hints: QueryHints,
  superseded: ReadonlySet<string>,
  recency: number,
): number {
  let bonus = 0;
  if (hints.current) bonus += recency;
  if (hints.historical && superseded.has(doc.memory.id)) bonus += SUPERSEDED_HISTORICAL_BONUS;
  return bonus;
}
