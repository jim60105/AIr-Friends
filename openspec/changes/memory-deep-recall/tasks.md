## 1. Handler

- [ ] 1.1 Add an optional `retriever` constructor argument to `MemoryHandler` (default: `new MemoryRetriever(memoryStore, DEFAULT_RECALL_CONFIG)`), and pass a shared bootstrap instance from `src/skills/registry.ts`. Verify with `deno task check`. The existing call sites in `tests/skills/memory-handler.test.ts`, `tests/skills/channel-memory-authz.test.ts`, `tests/skills/memory-patch-channel-scope.test.ts` and `tests/integration/agent-workspace.integration.test.ts` must still compile unchanged.
- [ ] 1.2 Rewrite the memory part of `handleMemorySearch` to call `retriever.search({ mode: "deep", query, workspace, channelWorkspace, category, scope, maxResults: limit, maxTokens: deepRecallMaxTokens })`, keeping the validation and error messages. Verify with handler tests for relevance order, `score` and `matchedTerms` presence, default both-scope search, channel-only search, DM with `scope: "channel"`, and whole-query tokenization.
- [ ] 1.3 Extend the memory entries in `MemorySearchResult` in `src/skills/types.ts` with `score` and `matchedTerms`. Verify with `deno task check`.

## 2. Remove legacy memory search

- [ ] 2.1 Delete `searchMemories`, `searchChannelMemories`, `computeRecencyBonus` and `getImportantMemories` from `MemoryStore`, keeping `searchAgentWorkspace`. Verify with `grep -rn "searchMemories\|searchChannelMemories\|computeRecencyBonus\|getImportantMemories" src tests`, which must return nothing.
- [ ] 2.2 Port or remove the search and `getImportantMemories` cases in `tests/core/memory-store.test.ts`, `tests/core/memory-store-v2.test.ts` and `tests/integration/memory-v2.integration.test.ts`, so that equivalent behavior is covered by retriever or handler tests. Verify with `deno task test`.

## 3. Docs and verification

- [ ] 3.1 Update `skills/memory-search/SKILL.md` Response Format: relevance order, `score`, `matchedTerms`, natural-language queries, and both scopes by default. Verify by reading it against the spec.
- [ ] 3.2 Update the search section of `docs/MEMORY_DESIGN.md`. Run `deno task ci` and verify that it passes.
