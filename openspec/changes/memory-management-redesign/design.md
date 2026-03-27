# Memory Management Redesign — Technical Design

## Context

AIr-Friends stores per-user memories as append-only JSONL files (`memory.public.jsonl`, `memory.private.jsonl`) within isolated workspaces at `data/workspaces/{platform}/{userId}/`. Memories are searched via ripgrep (`rg`), resolved by replaying patch events in order, and loaded into agent context based on `importance: "high" | "normal"`. The memory maintenance scheduler periodically summarizes and compacts memories using the same ACP agent and memory skills.

This design works at small scale but has structural limitations:

- **O(n) ID lookup**: `findMemoryById` loads and resolves the entire JSONL file to find one entry.
- **No shared channel knowledge**: All memories are per-user. Channel-specific facts (e.g., "this channel's topic is X") must be redundantly saved per-user.
- **No conversation continuity**: Session context is assembled from scratch each time; there is no structured record of what was discussed.
- **Flat importance model**: `high`/`normal` is too coarse to express "identity fact" vs "yesterday's episode" vs "last week's summary."
- **No temporal decay**: Old memories compete equally with fresh ones in search results.

## Goals / Non-Goals

### Goals

1. Introduce a tiered memory model (core / working / archive) that replaces the semantic overload of `importance`.
2. Add channel-scoped memory so shared knowledge lives in one place.
3. Generate conversation summaries automatically after each session, stored as working-tier memories.
4. Create an index file for O(1) ID lookup and fast filtered iteration.
5. Add a `decay` field for temporal relevance scoring in search.
6. Add a `category` field for structured retrieval without vector embeddings.
7. Migrate existing data with an idempotent script.

### Non-Goals

- Vector stores, embeddings, or any database backend. Storage remains plain-text JSONL.
- Changing the append-only guarantee. Original lines are never modified or deleted.
- Per-memory file storage. All memories for a scope stay in one JSONL file per visibility level.
- Real-time cross-workspace memory sharing beyond channel scope.
- Changes to the ACP protocol or skill API HTTP contract (new parameters are additive).

## Decisions

### Decision 1: Tier as a field, not separate files

Add `tier: "core" | "working" | "archive"` to `MemoryEntry`. Keep the existing two-file layout (`memory.public.jsonl`, `memory.private.jsonl`) per user workspace. Tier is metadata within each line, not a file-organization axis.

**Rationale**: Splitting tiers into separate files would triple the file count per workspace, complicate `rg` search (must target more files), and break the existing append/resolve model where patches reference entries in the same file. A single file per visibility keeps search simple (`rg pattern memory.public.jsonl`) and avoids the "many small files" anti-pattern that degrades Git and filesystem performance.

**Tier semantics**:

| Tier | Context loading | Mutability | Decay |
|------|----------------|------------|-------|
| `core` | Always loaded in full | Agent can promote/demote via patch | Pinned at 1.0 |
| `working` | Recent N entries loaded (configurable, default 20) | Auto-created (summaries); agent can promote to core | Starts at 0.8, decays over time |
| `archive` | Search-only (never pre-loaded) | Demoted from working by maintenance | Starts at 0.5, decays per cycle |

**Backward compatibility**: Existing `importance` field is retained. New code reads `tier` when present; if absent, falls back to `importance === "high" → core`, `importance === "normal" → archive`. This means un-migrated entries work without the migration script, at the cost of no working-tier behavior.

### Decision 2: Channel memory directory structure

```
data/workspaces/{platform}/channels/{channelId}/
├── memory.channel.jsonl
└── memory.index.jsonl
```

Channel memories use a new visibility value `"channel"` (extending `MemoryVisibility` to `"public" | "private" | "channel"`). The `scope` field on each entry is `"channel"` and the `visibility` is always `"public"` — there are no private channel memories.

**Context assembly rule**: When a session occurs in channel X, the context assembler loads:
1. User's core-tier memories (public; + private if DM)
2. User's recent working-tier memories
3. Channel X's core-tier channel memories
4. Channel X's recent working-tier channel memories

Channel archive memories are search-only, same as user archive.

**Rationale**: Channels are shared spaces. Private information belongs in the user's personal workspace. Storing channel knowledge once (instead of duplicated per-user) reduces redundancy and ensures all participants see the same channel facts. The `channels/` subdirectory under the platform directory avoids namespace collisions with user workspace directories (user IDs vs channel IDs).

**Skill API changes**: `memory-save` accepts `scope: "channel"` parameter. When `scope === "channel"`, the skill handler resolves the channel workspace from the session's `channelId` and writes to the channel's JSONL file. The session must have a valid `channelId` (not available in DM context for channel scope — rejected with error).

### Decision 3: Conversation summary pipeline

After a session completes successfully (at least one `send-reply` was called), `SessionOrchestrator` triggers an auto-summary step:

1. **Same session reuse**: The summary prompt is sent on the **same ACP session** that just completed, via `connector.prompt(sessionId, summaryPrompt)`. This avoids spawning a new agent process and leverages the agent's existing context window.
2. **Summary prompt**: A dedicated template (`prompts/system_summary.md`) instructs the agent to call `memory-save` with a structured summary containing: timestamp range, participants, key topics, decisions made, emotional tone, and unresolved questions.
3. **Storage**: The summary is saved as `{tier: "working", category: "summary", scope: "user"}` in the user's workspace. If the session involved a channel, a second summary with `scope: "channel"` is saved to the channel workspace.
4. **Fire-and-forget**: Summary generation is non-blocking. Failures are logged but do not affect the session's success status. The reply has already been sent.
5. **Progressive consolidation**: During memory maintenance, the agent merges older working-tier summaries (e.g., last 7 days) into fewer archive-tier summary entries, keeping the working set bounded.

**Rationale**: Summaries are just memories with `category: "summary"`. No new storage mechanism is needed. Reusing the same ACP session avoids the overhead of a new agent spawn (connection, authentication, MCP server registration). The agent already has full conversation context in its window, making summary generation trivial.

**Latency consideration**: Summary generation adds 5–15 seconds after the reply is sent. Since it runs after `send-reply` and is non-blocking, the user perceives no delay. If the agent process has already exited, the summary step is skipped gracefully.

### Decision 4: Memory index file

A `memory.index.jsonl` file is co-located with each memory JSONL file (both user and channel workspaces):

```
data/workspaces/{platform}/{userId}/
├── memory.public.jsonl
├── memory.private.jsonl
└── memory.index.jsonl
```

**Index entry schema**:

```typescript
interface MemoryIndexEntry {
  id: string;                    // Memory ID
  tier: "core" | "working" | "archive";
  category: MemoryCategory;
  enabled: boolean;              // Current resolved state
  scope: "user" | "channel";
  visibility: "public" | "private" | "channel";
  file: "public" | "private" | "channel"; // Which JSONL file contains this entry
  lineNumber: number;            // 1-based line number in the source file
}
```

**Lifecycle**:

1. **Startup**: `MemoryStore.initializeIndex(workspace)` scans each JSONL file once, resolves all entries, and writes/overwrites `memory.index.jsonl`. This is a full rebuild — always produces a correct index regardless of prior state.
2. **Incremental update**: When `addMemory()` or `patchMemory()` appends a line, the index is updated in-memory and the new/changed index entry is appended to the index file. The in-memory map is the source of truth during runtime.
3. **ID lookup**: `findMemoryById()` reads the in-memory index to get `{file, lineNumber}`, then reads that single line from the JSONL file, instead of loading the entire file. This is O(1) vs the current O(n).
4. **Filtered iteration**: `getImportantMemories()` becomes `getCoreMemories()` — the index provides all IDs with `tier === "core" && enabled === true` without scanning the full file.
5. **Rebuild**: A `rebuildIndex(workspace)` method re-scans from scratch. Available as a maintenance operation if index corruption is suspected.

**Rationale**: The current `findMemoryById` loads and parses the entire JSONL file, builds a map, resolves all patches, then searches. For a workspace with 1000+ memories, this is expensive. The index trades ~5–10% storage overhead for O(1) lookup. The index is trivially rebuildable from the source JSONL (it's a pure derivation), so corruption is recoverable. The append-only index file format matches the existing JSONL pattern.

### Decision 5: Decay field and temporal relevance

Add `decay: number` (0.0–1.0) to `MemoryEntry`. Default values by tier:

| Tier | Initial decay | Behavior |
|------|--------------|----------|
| `core` | 1.0 | Pinned — never modified by maintenance |
| `working` | 0.8 | Decays per maintenance cycle: `decay *= 0.95` |
| `archive` | 0.5 | Decays per maintenance cycle: `decay *= 0.95` |

**Search scoring formula**:

```
relevance = keyword_match_count * decay * recency_bonus
```

Where `recency_bonus = 1.0 + (0.5 * (1.0 - age_days / 365))`, clamped to `[1.0, 1.5]`. Memories less than a day old get a 1.5x bonus; memories over a year old get no bonus.

**Maintenance decay update**: During each maintenance cycle, for every archive-tier and working-tier entry that was not accessed (searched or loaded) since the last maintenance run, `decay *= 0.95`. This is applied via a patch event with the new decay value. Entries with `decay < 0.05` are candidates for disabling (agent decides).

**Rationale**: Inspired by Field-Theoretic Memory's Ebbinghaus forgetting curve, but simplified to a single multiplicative factor. The decay value is stored in plain text, visible in `rg` output, and debuggable by inspecting the JSONL directly. No opaque embedding scores or hidden state. The 0.95 multiplier means an unaccessed archive memory reaches ~0.18 after 20 maintenance cycles (140 days at weekly intervals) — still searchable but ranked below fresh content.

### Decision 6: Category field

Add `category: "fact" | "preference" | "episode" | "summary" | "relationship"` to `MemoryEntry`.

| Category | Description | Examples |
|----------|-------------|---------|
| `fact` | Objective information about the user or world | "User is a software engineer", "Project uses Deno" |
| `preference` | User preferences and opinions | "Prefers dark mode", "Dislikes small talk" |
| `episode` | Specific events or interactions | "Had a long debugging session on 2025-01-15" |
| `summary` | Conversation or period summaries | Auto-generated session summaries |
| `relationship` | Interpersonal relationship information | "User is close friends with @alice" |

**Agent responsibility**: The agent chooses the category when calling `memory-save`. Default is `"fact"` for backward compatibility (existing memories without the field are treated as `"fact"`).

**Search filtering**: `memory-search` gains an optional `category` parameter. When provided, only entries matching that category are returned. The index file enables fast category filtering without scanning the full JSONL.

**Rationale**: Categories enable structured retrieval patterns ("show me all relationship memories") without requiring vector embeddings or semantic search. This is inspired by A-Mem's categorized memory pools and Zettelkasten's typed notes. The fixed enum keeps the schema predictable and the agent's choice simple — five categories are enough to distinguish structurally different memory types without overwhelming the agent with taxonomy decisions.

### Decision 7: MemoryEntry and MemoryPatch schema changes

**MemoryEntry additions**:

```typescript
export type MemoryTier = "core" | "working" | "archive";
export type MemoryCategory = "fact" | "preference" | "episode" | "summary" | "relationship";
export type MemoryScope = "user" | "channel";

export interface MemoryEntry extends BaseMemoryEvent {
  type: "memory";
  enabled: boolean;
  visibility: MemoryVisibility;
  importance: MemoryImportance;     // Retained for backward compat
  content: string;
  tier: MemoryTier;                 // NEW
  category: MemoryCategory;         // NEW
  scope: MemoryScope;               // NEW
  decay: number;                    // NEW (0.0–1.0)
  relatedTo?: string[];
  supersedes?: string[];
}
```

**MemoryPatch additions**: `tier`, `category`, `decay` become patchable fields. `scope` is immutable after creation (cannot move a memory between user and channel scope).

**ResolvedMemory additions**: Gains `tier`, `category`, `scope`, `decay` fields. The `getImportantMemories()` method is replaced by `getCoreMemories()` (returns `tier === "core" && enabled`) and `getRecentWorkingMemories(limit)` (returns most recent N `tier === "working" && enabled`).

### Decision 8: Context assembly changes

Current flow: load all `importance: "high"` memories → include in context.

New flow:

```
1. Load user's core-tier memories (all enabled, from index)
2. Load user's recent working-tier memories (last N, from index + file reads)
3. If in a channel: load channel's core + recent working memories
4. Format all into context sections:
   - "## Core Memories" (user core)
   - "## Recent Context" (user working)
   - "## Channel Knowledge" (channel core + working, if applicable)
5. Archive-tier memories are NOT pre-loaded — available only via memory-search
```

This replaces the current single "Important Memories" section with structured sections that give the agent clearer signal about memory provenance and reliability.

### Decision 9: Configurable summary model

Summary generation is a simpler task than full conversation handling — it does not need an expensive frontier model. A dedicated `conversationSummary.model` configuration allows users to specify a cheaper/faster model for summary generation.

**Configuration** (in `config.yaml`):

```yaml
conversationSummary:
  model: "gpt-5-mini"  # Model for summary generation (default: agent.model)
```

**Environment Variable Override:**

- `CONVERSATION_SUMMARY_MODEL` → `conversationSummary.model`

**Default behavior**: When `conversationSummary.model` is not configured (empty or absent), the system uses `agent.model` — no model switch occurs and behavior is identical to pre-change.

**Implementation**: `SessionOrchestrator` performs the following sequence during the summary step:

1. Save the current session model (from `agent.model` config)
2. Call `connector.setSessionModel(sessionId, summaryModel)` to switch to the summary model
3. Send the summary prompt via `connector.prompt(sessionId, summaryPrompt)`
4. Call `connector.setSessionModel(sessionId, originalModel)` to restore the original model

If the summary model equals the agent model, steps 2 and 4 are skipped entirely.

**Rationale**: Summaries are structured extraction tasks — they distill a conversation into timestamps, topics, and tone. A smaller model like `gpt-5-mini` handles this adequately at a fraction of the cost and latency of frontier models. Making the model configurable (rather than hardcoded) lets operators tune the cost/quality tradeoff per deployment. The restore step ensures subsequent operations on the same session (if any) are unaffected.

## Risks / Trade-offs

### Index file synchronization

**Risk**: The index file can get out of sync with the source JSONL if the process crashes between writing the JSONL append and the index append.

**Mitigation**: The index is rebuilt from scratch on every startup. During runtime, the in-memory index is the source of truth. The on-disk index is an optimization for future features (e.g., external tools reading the index). A `rebuildIndex()` method is available for manual recovery.

### Channel memory complexity

**Risk**: Channel memory adds a new dimension to context assembly, increasing code complexity and the number of file reads per session.

**Mitigation**: Clear scoping rules (channel memories are always public, stored in a separate directory tree). Context assembly reads at most 4 sources (user public core, user public working, channel core, channel working) instead of the current 2 (public high-importance, private high-importance). The index makes each read targeted rather than full-file.

### Auto-summary latency

**Risk**: Generating a summary after each session adds 5–15 seconds of agent compute time.

**Mitigation**: Summary generation is fire-and-forget — it runs after the reply is sent and does not block the user. Failures are logged but tolerated. The cost is one additional `connector.prompt()` call on an already-open session. If the agent subprocess has exited, the step is skipped.

### Decay opacity

**Risk**: Users cannot easily understand why some memories rank higher than others in search results.

**Mitigation**: `memory-stats` skill reports decay distribution (min, max, mean, median per tier). The `memory-search` response includes the `decay` value for each result. The decay value is stored as a plain number in JSONL — users can inspect it directly with `rg` or `jq`.

### Summary model switch timing

**Risk**: If the model switch via `setSessionModel` fails or the agent does not support mid-session model changes, the summary may fail or run on the wrong model.

**Mitigation**: The model switch is wrapped in the same fire-and-forget error handling as the summary itself. If `setSessionModel` throws, the error is logged and the summary is attempted on the current model as a fallback. The restore step runs in a `finally` block to ensure the original model is always restored.

### Migration on large workspaces

**Risk**: Workspaces with thousands of memories may take significant time to migrate.

**Mitigation**: The migration script is idempotent (skips entries that already have a `tier` field) and can be restarted safely. It processes one workspace at a time. A backup of the original files is created before modification.

### Working-tier memory growth

**Risk**: If sessions are frequent, working-tier summaries accumulate faster than maintenance consolidates them.

**Mitigation**: The "recent N" loading limit (default 20) bounds the token cost regardless of total working-tier count. Memory maintenance consolidates older summaries into archive-tier entries. The agent can also manually promote important working memories to core tier.

## Migration Plan

### Script: `scripts/migrate-memory-v2.ts`

A standalone Deno script that transforms existing JSONL files in-place:

1. **Backup**: Copy each JSONL file to `{filename}.backup.jsonl` before modification.
2. **Transform**: Read each line. If it's a `type: "memory"` event without a `tier` field:
   - `importance: "high"` → `tier: "core"`, `decay: 1.0`
   - `importance: "normal"` → `tier: "archive"`, `decay: 0.5`
   - All entries get `category: "fact"`, `scope: "user"`
   - Patch events are left unchanged (they inherit tier changes via resolution)
3. **Write**: Overwrite the original file with transformed lines (same path, atomic via temp file + rename).
4. **Index**: Generate `memory.index.jsonl` for each workspace by scanning the migrated file.
5. **Idempotency**: If a line already has a `tier` field, it is written unchanged. Running the script twice produces the same output.

**Execution**:

```bash
deno run --allow-read --allow-write scripts/migrate-memory-v2.ts --data-dir ./data
```

**Rollback**: Restore from `*.backup.jsonl` files created in step 1.

### Compatibility window

During the period between deployment and migration:
- New code handles entries without `tier`/`category`/`scope`/`decay` by applying defaults at read time.
- `getImportantMemories()` is retained as a deprecated wrapper around `getCoreMemories()` with fallback logic.
- The migration script can be run at any time after deployment. It is not required for the system to function — only for full feature availability.

## Open Questions

1. **Working-tier loading limit**: Should the default be 20 entries, or should it be configurable per workspace or per channel? Current proposal: global config `memory.workingTierLimit` with default 20.

2. **Channel memory cleanup**: When a channel is deleted or the bot is removed, should channel memories be archived or left in place? Current leaning: leave in place (append-only philosophy), but stop loading them if the channel is no longer in the `channels` config.

3. **Summary granularity**: Should every session produce a summary, or only sessions above a minimum length (e.g., >3 exchanges)? Short sessions like `/clear` or single-message interactions may not warrant a summary.

4. **Decay floor**: Should there be a minimum decay value (e.g., 0.01) to prevent memories from becoming effectively invisible, or should the agent be allowed to disable them at that point?

5. **Cross-platform channel identity**: If the same logical community exists on both Discord and Misskey, should there be a way to link channel workspaces? Current answer: no — each platform's channels are independent. Cross-platform linking is out of scope.
