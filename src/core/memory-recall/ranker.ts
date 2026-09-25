// src/core/memory-recall/ranker.ts

import type { IndexedMemory, QueryHints, RecallQuery, ScoredMemory, SearchToken } from "./types.ts";

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
  const n = population.length;
  if (n === 0) return [];

  let totalLength = 0;
  for (const doc of population) totalLength += doc.length;
  const avgdl = totalLength / n;

  // `df` is seeded for every query key, so counting needs a single probe per
  // document term and a matched key always has a count.
  const df = new Map<string, number>();
  for (const key of query.tokens.keys()) df.set(key, 0);
  for (const doc of population) {
    for (const key of doc.tf.keys()) {
      const count = df.get(key);
      if (count !== undefined) df.set(key, count + 1);
    }
  }

  const superseded = supersededIds ?? collectSupersededIds(population);
  const scored: ScoredMemory[] = [];
  for (const doc of population) {
    let lexicalScore = 0;
    const matched = new Set<string>();
    for (const token of query.tokens.values()) {
      const tf = doc.tf.get(token.key);
      if (tf === undefined) continue;
      lexicalScore += bm25(tf, doc.length, avgdl, df.get(token.key) ?? 0, n) * token.weight;
      matched.add(token.term);
    }
    if (lexicalScore <= 0) continue;

    const recency = recencyBonus(doc.memory.createdAt, now);
    const score = lexicalScore +
      entityBonus(doc, query) +
      (hasExactPhrase(query.phraseTokens, doc.normalizedText) ? EXACT_PHRASE_BONUS : 0) +
      metadataBonus(doc, hints, recency) +
      temporalBonus(doc, hints, superseded, recency);
    scored.push({ indexed: doc, lexicalScore, score, matchedTerms: [...matched].sort() });
  }

  return scored.sort(compareScoredMemories);
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

/** At most once, when an entity of the current message appears in the memory. */
function entityBonus(doc: IndexedMemory, query: RecallQuery): number {
  for (const entity of query.entities) {
    if (doc.entities.has(entity)) return EXACT_ENTITY_BONUS;
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
