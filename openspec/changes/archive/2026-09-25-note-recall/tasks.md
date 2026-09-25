## 1. Types

- [x] 1.1 Replace `AgentNoteSearchResult` with `NoteRecallResult` in `src/types/memory.ts`, and update `MemorySearchResult.agentNotes`. Verify with `deno task check` (existing references will fail until task 3.1). — `NoteRecallResult` and `NoteRecallChunk` added; `MemorySearchResult.agentNotes` is `NoteRecallResult[]`; `deno task check` passes.

## 2. Indexing and ranking

- [x] 2.1 Implement `note-chunker.ts`. Verify with unit tests for headings, a fenced code block containing `#`, a heading-less file, the 600-character split, and line ranges. — `tests/core/memory-recall/note-chunker.test.ts` (11 cases, all passing).
- [x] 2.2 Extend `snapshot-cache.ts` with the note walk: exclusions, symlink skip, real-path containment through `validatePathWithinBoundary()`, size and mtime reuse, and `fileTokens`. Verify with tests: `_index.md` and the root `README.md` are excluded, a symlinked file and a symlinked directory pointing outside are not read, an edited note is refreshed, and journal files are included. — Six note tests in `tests/core/memory-recall/snapshot-cache.test.ts` cover the exclusions (a nested `README.md` stays eligible), the symlinked file and directory, the symlinked workspace root, cache reuse versus an edited note, a missing workspace and an unreadable note.
- [x] 2.3 Implement note ranking (separate statistics, per-file aggregation) and the excerpt builder (tie goes to the earliest sentence, Deep limit about 320 characters, up to 3 chunks). Verify with tests: one entry per file, the excerpt contains a matched term, the tie-break, and at most 3 chunks. — `scoreNoteFiles` in `ranker.ts` plus `buildExcerpt` in `note-chunker.ts`; covered by `ranker.test.ts` (note-only statistics, per-file aggregation, ordering), `note-chunker.test.ts` (tie-break, cutting) and `retriever.test.ts` (one entry per file, at most three chunks, excerpt contains the term).

## 3. Deep Recall

- [x] 3.1 Switch `handleMemorySearch` `agentNotes` to retriever note results, with the shared score-ordered budget merge measured on serialized entries. Verify with handler tests for the pointer fields and a shared-budget case where a lower-scoring memory is dropped in favor of a higher-scoring note. — `admitDeepOutput` merges memories and notes by score and admits items while `estimateTokens(JSON.stringify(entry))` fits `memory.recall.deepRecallMaxTokens`; `tests/skills/memory-handler.test.ts` covers the pointer fields, an oversized memory skipped for a smaller one, the note-over-memory case and a note whose pointer exceeds the budget.
- [x] 3.2 Delete `MemoryStore.searchAgentWorkspace`, `collectMdFiles`, `src/utils/text-search.ts` and `tests/utils/text-search.test.ts`, after `grep -rn "text-search" src tests scripts` shows no other importer. Verify with `deno task check` and `deno task test`. — `memory-store.ts` was the only importer; both files are deleted and `deno task check` plus the full `deno task test` pass.

## 4. Docs and verification

- [x] 4.1 Update `skills/memory-search/SKILL.md` (the `agentNotes` pointer format; read the file with its path when needed), `prompts/agent_workspace.md` and `docs/MEMORY_DESIGN.md`. Run `deno task ci` and verify that it passes. — All three documents updated. `deno task ci` runs a repo-wide `deno fmt --check`, which fails on 260 pre-existing unrelated files on `master` as well; the CI workflow itself runs `deno task fmt:check` (path-scoped), so the CI-equivalent gates were run and pass: `deno task fmt:check`, `deno task lint`, `deno task check`, `deno task test` (2092 passed, 0 failed, 2 ignored).
