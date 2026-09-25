// tests/core/memory-recall/memory-fixture.ts

import { indexMemory } from "@core/memory-recall/indexed-memory.ts";
import { MemoryTokenizer } from "@core/memory-recall/tokenizer.ts";
import type { IndexedMemory } from "@core/memory-recall/types.ts";
import type { ResolvedMemory } from "../../../src/types/memory.ts";

/** Fixed clock for every scoring test. ISO-8601, so string order is chronological. */
export const NOW = new Date("2026-09-25T00:00:00.000Z");
export const NOW_ISO = NOW.toISOString();
export const DAY_MS = 86_400_000;

/** Shared instance: the vendored dictionary loads once per process. */
export const tokenizer = new MemoryTokenizer();

/** A resolved memory with neutral metadata; tests override only what they assert. */
export function makeMemory(overrides: Partial<ResolvedMemory> = {}): ResolvedMemory {
  return {
    id: "m1",
    enabled: true,
    visibility: "public",
    importance: "normal",
    content: "keyboard",
    createdAt: NOW_ISO,
    lastModifiedAt: NOW_ISO,
    tier: "archive",
    category: "fact",
    scope: "user",
    decay: 0,
    relatedTo: [],
    supersedes: [],
    ...overrides,
  };
}

/** Indexes a memory with the shared tokenizer. */
export function index(overrides: Partial<ResolvedMemory> = {}): IndexedMemory {
  return indexMemory(makeMemory(overrides), tokenizer);
}
