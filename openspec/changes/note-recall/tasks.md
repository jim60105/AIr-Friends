## 1. Types

- [ ] 1.1 Replace `AgentNoteSearchResult` with `NoteRecallResult` in `src/types/memory.ts`, and update `MemorySearchResult.agentNotes`. Verify with `deno task check` (existing references will fail until task 3.1).

## 2. Indexing and ranking

- [ ] 2.1 Implement `note-chunker.ts`. Verify with unit tests for headings, a fenced code block containing `#`, a heading-less file, the 600-character split, and line ranges.
- [ ] 2.2 Extend `snapshot-cache.ts` with the note walk: exclusions, symlink skip, real-path containment through `validatePathWithinBoundary()`, size and mtime reuse, and `fileTokens`. Verify with tests: `_index.md` and the root `README.md` are excluded, a symlinked file and a symlinked directory pointing outside are not read, an edited note is refreshed, and journal files are included.
- [ ] 2.3 Implement note ranking (separate statistics, per-file aggregation) and the excerpt builder (tie goes to the earliest sentence, Deep limit about 320 characters, up to 3 chunks). Verify with tests: one entry per file, the excerpt contains a matched term, the tie-break, and at most 3 chunks.

## 3. Deep Recall

- [ ] 3.1 Switch `handleMemorySearch` `agentNotes` to retriever note results, with the shared score-ordered budget merge measured on serialized entries. Verify with handler tests for the pointer fields and a shared-budget case where a lower-scoring memory is dropped in favor of a higher-scoring note.
- [ ] 3.2 Delete `MemoryStore.searchAgentWorkspace`, `collectMdFiles`, `src/utils/text-search.ts` and `tests/utils/text-search.test.ts`, after `grep -rn "text-search" src tests scripts` shows no other importer. Verify with `deno task check` and `deno task test`.

## 4. Docs and verification

- [ ] 4.1 Update `skills/memory-search/SKILL.md` (the `agentNotes` pointer format; read the file with its path when needed), `prompts/agent_workspace.md` and `docs/MEMORY_DESIGN.md`. Run `deno task ci` and verify that it passes.
