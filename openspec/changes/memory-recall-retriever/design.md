## Context

Series design: `docs/superpowers/specs/2026-09-25-memory-recall-v2-design.md`, sections 3, 5.2, 5.5, 7 and 8. `MemoryStore.loadAllMemories(workspace, visibility)` and `loadChannelMemories(channelWorkspace)` read a JSONL file and resolve patches. The retriever reuses them unchanged.

## Goals / Non-Goals

**Goals:**

- A `MemoryRetriever.search()` whose memory results satisfy every `memory-recall` requirement, testable with an injected clock and a temporary workspace.

**Non-Goals:**

- Callers (changes 5 and 7).
- Notes (changes 8 and 9).
- Final thresholds (change 4).

## Decisions

- **Freshness by `Deno.stat` (size and mtime)**, not by write-path hooks. JSONL is append-only, so any save or patch grows the file. Hooks would be needed in the skill handlers, the dashboard and maintenance, and a missed one yields stale results.
- **Snapshot entry**: `{ size, mtimeMs, docs: IndexedMemory[] }` keyed by absolute path. A missing file becomes an empty entry. Concurrent searches for the same stale file share one in-flight rebuild promise, so the work is not duplicated.
- **Source files**:
  - DM: `memory.public.jsonl` and `memory.private.jsonl`.
  - Guild: `memory.public.jsonl` plus `memory.channel.jsonl` when a channel workspace is supplied.

  Paths come from the `MemoryStore` path helpers.
- **Population for statistics**: memories after the enabled, scope, visibility, category, scope-filter and supersede rules, before exclusion and the overlap rule. Excluded memories still count toward `df`, because they are real documents in scope. This keeps scores stable whether or not a memory happens to be injected.
- **Supersede map**: built per request from enabled in-scope memories.
- **`relatedTo` expansion**: runs after direct scoring over the same population. Related targets must be scored (lexical > 0) and eligible.
- **Selection**:
  - The retriever returns ranked items.
  - `selectFast()` and `selectDeep()` apply thresholds and budgets using `estimateTokens()` on the exact rendered line (`- <content>`, or `- [from <author>] <content>` for channel memories) plus the heading once.
- **Constructor**: `new MemoryRetriever(memoryStore, recallConfig, { now?, tokenizer? })`. `MemoryStore` gains two public read-only path helpers, `getMemoryFilePathFor(workspace, visibility)` and `getChannelMemoryFilePathFor(channelWorkspace)`, which wrap its existing private lookups. The retriever therefore needs no `WorkspaceManager`, and any holder of a `MemoryStore` can build a default retriever.
- **Provisional thresholds**: `minRecallScore: 3.0` and `secondRecallScore: 3.0`, replaced by change 4.

## Risks / Trade-offs

- [A long-lived process accumulates snapshot entries for every workspace it has touched] → Entries hold only resolved memories and term maps. Workspace counts are small, and the process restarts on every deploy. An LRU can be added behind the cache interface if needed.
- [Linear scans slow down on very large stores] → The benchmark in change 4 gates p95 latency.

## Migration Plan

None.
