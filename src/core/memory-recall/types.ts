// src/core/memory-recall/types.ts

import type { ResolvedMemory } from "../../types/memory.ts";

/** Kind of a lexical token produced by the memory-recall tokenizer. */
export type TokenKind = "word" | "entity" | "bigram";

/**
 * A single term produced by the memory-recall tokenizer. Weights are fixed per
 * kind: entity 1.5, word 1.0, bigram 0.25 (Memory Recall v2 design, §4).
 */
export interface SearchToken {
  term: string;
  kind: TokenKind;
  weight: number;
}

/**
 * Key of a term inside `IndexedMemory.tf` and `RecallQuery.tokens`. The kind is
 * part of the key so a word and a bigram with the same characters (for example
 * `喜歡`) stay distinct.
 */
export function tokenKey(kind: TokenKind, term: string): string {
  return `${kind}:${term}`;
}

/** A query term with its effective weight, `kindWeight × sourceWeight`. */
export interface QueryToken {
  /** `tokenKey(kind, term)`; the key `IndexedMemory.tf` is looked up with. */
  key: string;
  term: string;
  kind: TokenKind;
  /** Largest effective weight across the current and the previous message. */
  weight: number;
}

/** Query tokens plus the current-message sources of the entity and phrase bonuses. */
export interface RecallQuery {
  /** Effective weight per token key, keyed by `QueryToken.key`. */
  tokens: Map<string, QueryToken>;
  /** Entity terms of the current message only. */
  entities: Set<string>;
  /** Word and entity tokens of the current message, in tokenizer order. */
  phraseTokens: SearchToken[];
}

/** Hints detected in the current user message (Memory Recall v2 design, §5.4). */
export interface QueryHints {
  current: boolean;
  historical: boolean;
  preference: boolean;
}

/** A resolved memory with its lexical index (Memory Recall v2 design, §5.3). */
export interface IndexedMemory {
  memory: ResolvedMemory;
  /** Term frequencies keyed by `tokenKey`. */
  tf: Map<string, number>;
  /** Entity terms of the memory. */
  entities: Set<string>;
  /** Content normalized with NFKC and lowercased, for the phrase check. */
  normalizedText: string;
  /** Token count, the BM25 document length. */
  length: number;
}

/**
 * A scored memory. Only memories that matched at least one query token are
 * returned, so `lexicalScore` is always greater than zero: every bonus is gated
 * on it (Memory Recall v2 design, §5.3). Kind-level matches, which the retriever
 * needs for its overlap rule, are the intersection of `indexed.tf` keys and
 * `RecallQuery.tokens` keys.
 */
export interface ScoredMemory {
  indexed: IndexedMemory;
  /** BM25 sum over the matched query terms, before bonuses. */
  lexicalScore: number;
  /** `lexicalScore` plus every applicable bonus. */
  score: number;
  /** Distinct matched query terms, sorted. */
  matchedTerms: string[];
}

/**
 * One note chunk with its lexical index (Memory Recall v2 design, §6). The
 * tokenizer is the same instance the retriever uses for queries, so a query and
 * a chunk can never disagree about how a text is tokenized.
 */
export interface IndexedNoteChunk {
  /** Heading path of the chunk, `[title]` for text before the first `##`. */
  headingPath: string[];
  /** 1-based inclusive line range of the chunk. */
  lineStart: number;
  lineEnd: number;
  /** Original chunk text, the source of excerpts. */
  text: string;
  /** Term frequencies keyed by `tokenKey`. */
  tf: Map<string, number>;
  /** Entity terms of the chunk. */
  entities: Set<string>;
  /** Content normalized with NFKC and lowercased, for the phrase check. */
  normalizedText: string;
  /** Token count, the BM25 document length. */
  length: number;
}

/** An indexed agent workspace note file. */
export interface IndexedNoteFile {
  /** Absolute path, built from the workspace path the caller passed. */
  path: string;
  /** Document title: the first level-1 heading, otherwise the file name. */
  title: string;
  /** Estimated tokens of the whole file. */
  fileTokens: number;
  /** ISO date the file was last modified. */
  modifiedAt: string;
  /** Chunks in line order. */
  chunks: IndexedNoteChunk[];
}
