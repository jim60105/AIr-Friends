## Why

`memory-search` returns agent workspace notes as unordered single matching lines with a relative path, which is not enough to judge whether a file is worth opening. Notes are long, so returning them whole would waste context. The agent needs a ranked pointer: path, section, line range and a relevant excerpt.

This is change 8 of 9. It depends on `memory-deep-recall`.

## What Changes

- Index every `.md` file in the agent workspace, except the root `README.md` and `notes/_index.md`, as heading-based chunks. Never follow symbolic links, and never read anything that resolves outside the workspace.
- Rank notes with the same tokenizer and BM25 over note-only statistics, aggregated per file.
- **BREAKING**: `memory-search` `agentNotes` returns ranked pointers:
  - absolute path, title and heading path;
  - line range and excerpt;
  - estimated tokens of the whole file and modification date;
  - score and matched terms;
  - up to 3 matching chunks.

  Notes share the Deep Recall token budget with memories.
- Remove the ripgrep path: `MemoryStore.searchAgentWorkspace`, `collectMdFiles`, `src/utils/text-search.ts` and its test.
- Update `skills/memory-search/SKILL.md` and `prompts/agent_workspace.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `memory-recall`: Adds "Note Indexing", "Note Result Format" and "Deep Recall Notes".
- `agent-workspace`: "Memory-Search Integration" returns notes in the pointer format.

## Impact

- **New code**: `src/core/memory-recall/note-chunker.ts`, plus note support in `snapshot-cache.ts` and `retriever.ts`.
- **Changed code**: `src/skills/memory-handler.ts`, `src/skills/types.ts`, and `src/types/memory.ts` (`AgentNoteSearchResult` is replaced by `NoteRecallResult`).
- **Deleted**: `MemoryStore.searchAgentWorkspace`, `MemoryStore.collectMdFiles`, `src/utils/text-search.ts`, `tests/utils/text-search.test.ts`.
- **Docs**: `skills/memory-search/SKILL.md`, `prompts/agent_workspace.md`, `docs/MEMORY_DESIGN.md`.
