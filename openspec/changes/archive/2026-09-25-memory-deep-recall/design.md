## Context

Series design: `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, sections 7 and 8 (Deep mode). `MemoryHandler.handleMemorySearch` currently:

1. splits the query on whitespace;
2. calls `MemoryStore.searchMemories` and `MemoryStore.searchChannelMemories`;
3. merges the results and truncates them to `limit`;
4. appends `agentNotes` from `MemoryStore.searchAgentWorkspace`.

## Goals / Non-Goals

**Goals:**

- Swap the memory portion of `memory-search` to Deep Recall with no change to the skill's CLI contract (flags, payload file, error codes).
- Delete the now-unused memory search code in `MemoryStore`.

**Non-Goals:**

- Note search (change 8, `note-recall`, replaces `searchAgentWorkspace` and `text-search.ts`).
- Fast Recall (change 7, `memory-fast-recall-context`).

## Decisions

- **Dependency injection**: `MemoryHandler` takes an optional `MemoryRetriever` as its second constructor argument. When it is omitted, the handler builds `new MemoryRetriever(memoryStore, DEFAULT_RECALL_CONFIG)`. Production (`src/skills/registry.ts`) passes one shared instance created at bootstrap, so snapshots are reused across sessions. The 40+ existing `new MemoryHandler(memoryStore)` call sites in tests keep compiling and exercise real retrieval, not a no-op.
- **Channel workspace resolution** stays in the handler, as today (`workspaceManager.getOrCreateChannelWorkspace`). A failure is logged, and the search proceeds with user scope only, matching current behavior.
- **Budget**: the handler passes `maxTokens: config.memory.recall.deepRecallMaxTokens`. Notes join this budget in change 8 (`note-recall`).
- **The `limit` default stays 10.** The cap is enforced by the engine, so the handler does not duplicate it.
- **Output shape**: extend the existing memory object with `score` and `matchedTerms` rather than nesting it. Agents and `SKILL.md` examples keep working with the familiar fields.

## Risks / Trade-offs

- [Agents that relied on keyword-OR semantics for multi-word queries get different results] → BM25 over all tokens is a superset signal: any memory matching one strong term is still eligible. `SKILL.md` explains that the query is natural language.
- [Removing `searchMemories` breaks tests that used it as a helper] → Tasks port those cases to retriever tests or drop duplicates.

## Migration Plan

None. The skill contract is unchanged except for the added fields and ordering.
