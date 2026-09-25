// src/core/memory-recall/types.ts

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
