// src/core/memory-recall/indexed-memory.ts

import type { ResolvedMemory } from "../../types/memory.ts";
import type { MemoryTokenizer } from "./tokenizer.ts";
import type { IndexedMemory } from "./types.ts";
import { tokenKey } from "./types.ts";

/**
 * Builds the lexical index of one resolved memory (Memory Recall v2 design,
 * §5.3). The tokenizer is the same instance the retriever uses for queries, so
 * a query and a memory can never disagree about how a text is tokenized.
 */
export function indexMemory(memory: ResolvedMemory, tokenizer: MemoryTokenizer): IndexedMemory {
  const tokens = tokenizer.tokenize(memory.content);
  const tf = new Map<string, number>();
  const entities = new Set<string>();
  for (const token of tokens) {
    const key = tokenKey(token.kind, token.term);
    tf.set(key, (tf.get(key) ?? 0) + 1);
    if (token.kind === "entity") entities.add(token.term);
  }
  return {
    memory,
    tf,
    entities,
    normalizedText: memory.content.normalize("NFKC").toLowerCase(),
    length: tokens.length,
  };
}
