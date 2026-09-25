// src/core/memory-recall/indexed-memory.ts

import type { ResolvedMemory } from "../../types/memory.ts";
import type { MemoryTokenizer } from "./tokenizer.ts";
import type { IndexedMemory } from "./types.ts";
import { tokenKey } from "./types.ts";

/** Lexical index of one text: its term frequencies, entities and token count. */
export interface LexicalIndex {
  /** Term frequencies keyed by `tokenKey`. */
  tf: Map<string, number>;
  /** Entity terms of the text. */
  entities: Set<string>;
  /** Content normalized with NFKC and lowercased, for the phrase check. */
  normalizedText: string;
  /** Token count, the BM25 document length. */
  length: number;
}

/**
 * Builds the lexical index of one text with the given tokenizer (Memory Recall
 * v2 design, §5.3). Memories and note chunks share this step, so a query and a
 * document can never disagree about how a text is tokenized.
 */
export function lexicalIndex(text: string, tokenizer: MemoryTokenizer): LexicalIndex {
  const tokens = tokenizer.tokenize(text);
  const tf = new Map<string, number>();
  const entities = new Set<string>();
  for (const token of tokens) {
    const key = tokenKey(token.kind, token.term);
    tf.set(key, (tf.get(key) ?? 0) + 1);
    if (token.kind === "entity") entities.add(token.term);
  }
  return {
    tf,
    entities,
    normalizedText: text.normalize("NFKC").toLowerCase(),
    length: tokens.length,
  };
}

/**
 * Builds the lexical index of one resolved memory (Memory Recall v2 design,
 * §5.3).
 */
export function indexMemory(memory: ResolvedMemory, tokenizer: MemoryTokenizer): IndexedMemory {
  return { memory, ...lexicalIndex(memory.content, tokenizer) };
}
