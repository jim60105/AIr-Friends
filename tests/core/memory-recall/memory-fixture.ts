// tests/core/memory-recall/memory-fixture.ts

import { indexMemory, lexicalIndex } from "@core/memory-recall/indexed-memory.ts";
import { MemoryTokenizer } from "@core/memory-recall/tokenizer.ts";
import type { IndexedMemory, IndexedNoteFile } from "@core/memory-recall/types.ts";
import { estimateTokens } from "@utils/token-counter.ts";
import type { NoteRecallResult, ResolvedMemory } from "../../../src/types/memory.ts";

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

/** An indexed note file built from chunk texts with their heading paths. */
export function noteFile(
  path: string,
  chunks: Array<{ headingPath: string[]; text: string }>,
): IndexedNoteFile {
  let lineStart = 1;
  return {
    path,
    title: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
    fileTokens: estimateTokens(chunks.map((chunk) => chunk.text).join("\n")),
    modifiedAt: NOW_ISO,
    chunks: chunks.map((chunk) => {
      const lineEnd = lineStart + chunk.text.split("\n").length - 1;
      const indexed = {
        headingPath: chunk.headingPath,
        lineStart,
        lineEnd,
        text: chunk.text,
        ...lexicalIndex(chunk.text, tokenizer),
      };
      lineStart = lineEnd + 2;
      return indexed;
    }),
  };
}

/** A note pointer with neutral fields; tests override only what they assert. */
export function makeNote(overrides: Partial<NoteRecallResult> = {}): NoteRecallResult {
  return {
    path: "/app/data/agent-workspace/notes/cooking.md",
    title: "Cooking Notes",
    headingPath: ["Cooking Notes", "Pasta"],
    lineStart: 3,
    lineEnd: 9,
    excerpt: "Best pasta recipe uses fresh tomatoes.",
    fileTokens: 420,
    modifiedAt: "2026-08-29T10:11:12.000Z",
    score: 4.5,
    matchedTerms: ["pasta"],
    ...overrides,
  };
}
