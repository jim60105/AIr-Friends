# Memory System Design

## 1. Overview

AIr-Friends uses a **plain-text, append-only, tiered memory system** stored as JSONL files within isolated workspaces. Memories are never modified in place — changes are expressed as patch events appended after the original entry.

**Design philosophy:**

- **Plain-text JSONL** — readable with `rg`, `jq`, `cat`; diffable with `git diff`
- **Append-only** — no line is ever modified or deleted; full audit trail by default
- **Git-friendly** — the entire `data/` directory can be backed up via `git push`
- **No embeddings or databases** — retrieval uses keyword search + decay scoring
- **Tiered storage** — not all memories deserve equal context budget

## 2. Tier Lifecycle

Memories are organized into three tiers that control how they participate in context assembly:

| Tier | Loaded at session start | Initial decay | Mutability |
|------|------------------------|---------------|------------|
| **Core** | Always (full content) | 1.0 (pinned) | Agent promotes/demotes via patch |
| **Working** | Recent N entries (default 20) | 0.8 | Auto-created (summaries); promoted to core or consolidated to archive by maintenance |
| **Archive** | Never (search-only) | 0.5 | Demoted from working by maintenance; decay decreases over time |

### Tier transitions

```
                    agent patch (promote)
              ┌──────────────────────────┐
              │                          ▼
         ┌─────────┐   auto-create   ┌──────┐   maintenance   ┌─────────┐
         │ Archive │ ◄────────────── │Working│ ──────────────► │  Core   │
         └─────────┘   consolidate   └──────┘   promote        └─────────┘
              ▲                          │                          │
              │     maintenance          │    agent patch (demote)  │
              └──────────────────────────┘◄─────────────────────────┘
```

- **New user memories** default to `tier: "archive"` (general facts, episodes).
- **Conversation summaries** are auto-created as `tier: "working"`.
- **Maintenance** consolidates old working summaries → archive, and may promote frequently-accessed archive entries → core.
- **Agent** can explicitly promote/demote via `memory-patch` skill.

## 3. Memory Event Schema

### MemoryEntry

```typescript
interface MemoryEntry {
  type: "memory";
  id: string;                          // Unique ID (e.g., "mem_abc123")
  ts: string;                          // ISO 8601 timestamp
  enabled: boolean;                    // Active or disabled
  visibility: "public" | "private";    // Public = shared in context; private = DM only
  importance: "high" | "normal";       // Legacy field, retained for backward compat
  content: string;                     // Plain text content
  tier?: "core" | "working" | "archive";        // Storage tier
  category?: "fact" | "preference" | "episode" | "summary" | "relationship";
  scope?: "user" | "channel";          // Per-user or per-channel
  decay?: number;                      // 0.0–1.0 temporal relevance
  relatedTo?: string[];                // Semantically related memory IDs
  supersedes?: string[];               // IDs this entry replaces
}
```

### MemoryPatch

```typescript
interface MemoryPatch {
  type: "patch";
  id: string;                          // Patch event's own ID
  ts: string;                          // ISO 8601 timestamp
  targetId: string;                    // ID of the memory being patched
  // All fields below are optional — only include what changes:
  enabled?: boolean;
  visibility?: "public" | "private";
  importance?: "high" | "normal";
  tier?: "core" | "working" | "archive";
  category?: "fact" | "preference" | "episode" | "summary" | "relationship";
  decay?: number;                      // Ignored for core tier (always 1.0)
  relatedTo?: string[];
  supersedes?: string[];
}
```

> **Immutable fields**: `content` and `scope` cannot be changed after creation.

### ResolvedMemory

The computed state after replaying all patches for a given ID:

```typescript
interface ResolvedMemory {
  id: string;
  enabled: boolean;
  visibility: "public" | "private";
  importance: "high" | "normal";
  content: string;
  createdAt: string;
  lastModifiedAt: string;
  tier: MemoryTier;         // Defaults: "archive" for legacy entries
  category: MemoryCategory; // Defaults: "fact" for legacy entries
  scope: MemoryScope;       // Defaults: "user" for legacy entries
  decay: number;            // Defaults: based on tier
  relatedTo: string[];
  supersedes: string[];
}
```

## 4. Channel Memory

### Directory structure

```
data/workspaces/
├── discord/
│   ├── 123456789/                          # User workspace (userId)
│   │   ├── memory.public.jsonl
│   │   ├── memory.private.jsonl
│   │   └── memory.index.jsonl
│   └── channels/
│       └── 987654321/                      # Channel workspace (channelId)
│           ├── memory.channel.jsonl
│           └── memory.index.jsonl
└── misskey/
    ├── abcdef1234/                         # User workspace
    │   └── ...
    └── channels/
        └── note_xyz789/                    # Channel workspace
            └── ...
```

### Scoping rules

| Scope | Storage location | Visibility | When to use |
|-------|-----------------|------------|-------------|
| `user` | `workspaces/{platform}/{userId}/` | Public or private | Personal facts, preferences, private episodes |
| `channel` | `workspaces/{platform}/channels/{channelId}/` | Always public | Channel-specific facts, shared context, group decisions |

- **Channel memories are always `visibility: "public"`** — no private channel memories.
- **`scope` is immutable** — a memory cannot move between user and channel after creation.
- **DM context**: Channel-scope save is rejected in DM sessions (no meaningful shared channel).
- **Channel deletion**: Memories remain on disk (append-only philosophy) but stop being loaded if the channel is removed from config.

## 5. Conversation Summaries

### Auto-generation pipeline

```
Session completes (send-reply called)
        │
        ▼
SessionOrchestrator triggers summary step
        │
        ▼
(Optional) Switch model → conversationSummary.model
        │
        ▼
Send summary prompt on SAME ACP session
        │
        ▼
Agent calls memory-save with:
  tier: "working", category: "summary", scope: "user"
        │
        ▼
(If channel session) Also save scope: "channel" summary
        │
        ▼
Restore original model (if switched)
```

- **Fire-and-forget**: Failures are logged but never affect session success.
- **Latency**: 5–15 seconds after reply is sent; user perceives no delay.
- **Minimum threshold**: Short sessions (e.g., `/clear`, single exchange) may skip summary generation.

### Progressive consolidation

During memory maintenance:

1. Collect working-tier summaries older than the consolidation window (e.g., 7 days).
2. Agent merges them into fewer archive-tier summary entries covering the period.
3. Original working summaries are disabled via patch (never deleted).
4. Working set stays bounded regardless of session frequency.

### Configurable summary model

```yaml
conversationSummary:
  model: "gpt-5-mini"  # Default: falls back to agent.model
```

| Env var | Config path |
|---------|-------------|
| `CONVERSATION_SUMMARY_MODEL` | `conversationSummary.model` |

## 6. Decay Math

### Formula

```
relevance = keyword_match_count × decay × recency_bonus
```

### Recency bonus

```
recency_bonus = 1.0 + 0.5 × (1.0 − age_days / 365)
```

Clamped to **[1.0, 1.5]**:

| Memory age | Recency bonus |
|-----------|---------------|
| < 1 day | 1.5 |
| 6 months | ~1.25 |
| 1 year | 1.0 |
| > 1 year | 1.0 |

### Decay defaults per tier

| Tier | Initial | Maintenance multiplier | Behavior |
|------|---------|----------------------|----------|
| Core | 1.0 | None (pinned) | Never decays |
| Working | 0.8 | N/A (managed via consolidation) | Not subject to decay adjustment |
| Archive | 0.5 | `× 0.95` per cycle | Unaccessed entries decay each maintenance run |

### Decay over time (archive, weekly maintenance)

| Cycles | Days | Decay value |
|--------|------|-------------|
| 0 | 0 | 0.50 |
| 5 | 35 | 0.39 |
| 10 | 70 | 0.30 |
| 20 | 140 | 0.18 |
| 40 | 280 | 0.06 |

Entries with `decay < 0.05` are candidates for disabling (agent decides during maintenance).

## 7. Category System

| Category | Description | Typical tier | Examples |
|----------|-------------|-------------|---------|
| `fact` | Objective information | Core or Archive | "User is a software engineer", "Project uses Deno" |
| `preference` | Opinions and preferences | Core | "Prefers dark mode", "Dislikes small talk" |
| `episode` | Specific events or interactions | Archive | "Debugged a CORS issue on 2025-01-15" |
| `summary` | Conversation/period summaries | Working → Archive | Auto-generated session summaries |
| `relationship` | Interpersonal information | Core | "User is close friends with @alice" |

**Usage guidance for agents:**

- Default category is `"fact"` when unspecified (backward compatible).
- Use `"summary"` only for auto-generated or maintenance-consolidated summaries.
- Use `"episode"` for time-bound events the user may want to recall later.
- Use `"relationship"` sparingly — only for explicitly stated interpersonal connections.
- `memory-search` accepts an optional `category` filter for targeted retrieval.

## 8. Memory Index

### Index file format

Each workspace contains a `memory.index.jsonl` co-located with its memory files. Each line is:

```json
{"id":"mem_abc","tier":"core","category":"fact","enabled":true,"scope":"user","visibility":"public","file":"public","lineNumber":42}
```

### MemoryIndexEntry schema

```typescript
interface MemoryIndexEntry {
  id: string;
  tier: MemoryTier;
  category: MemoryCategory;
  enabled: boolean;
  scope: MemoryScope;
  visibility: "public" | "private";
  file: "public" | "private" | "channel";
  lineNumber: number;  // 1-based line in source JSONL
}
```

### O(1) lookup

At runtime, the index is loaded into an in-memory `Map<string, MemoryIndexEntry>`. `findMemoryById(id)` reads the map to get `{file, lineNumber}`, then reads that single line from the JSONL — O(1) vs the previous O(n) full-file scan.

### Lifecycle

1. **Startup**: `initializeIndex()` scans all JSONL files, resolves patches, writes a fresh `memory.index.jsonl`. Always produces a correct index.
2. **Runtime appends**: When `addMemory()` or `patchMemory()` appends a line, the in-memory map is updated and the new index entry is appended to the index file.
3. **Filtered iteration**: `getCoreMemories()` iterates the in-memory map filtering `tier === "core" && enabled === true` — no file scan needed.

### Rebuild procedure

```bash
# Programmatic
await memoryStore.rebuildIndex(workspacePath);

# Or delete the index file — it will be rebuilt on next startup
rm data/workspaces/discord/123456/memory.index.jsonl
```

The index is a **pure derivation** of the source JSONL files. Deleting it is always safe.

## 9. Context Assembly

At session start, the context assembler loads memories in this order:

```
┌─────────────────────────────────────────────────┐
│            Context Assembly Pipeline             │
├─────────────────────────────────────────────────┤
│ 1. User core-tier memories (all enabled)        │  ── always loaded
│ 2. User working-tier memories (recent N=20)     │  ── bounded
│ 3. Channel core memories (if in channel)        │  ── always loaded
│ 4. Channel working memories (if in channel)     │  ── bounded
│ 5. Recent channel messages (last 20)            │  ── unchanged
├─────────────────────────────────────────────────┤
│ Archive tier → NOT pre-loaded                   │
│ Available via memory-search skill only          │
└─────────────────────────────────────────────────┘
```

### Rendered context sections

```markdown
## Core Memories
- [fact] User is a TypeScript developer (decay: 1.0)
- [preference] Prefers concise responses (decay: 1.0)

## Recent Context
- [summary] 2025-07-15: Discussed deployment pipeline... (decay: 0.76)
- [summary] 2025-07-14: Debugged memory leak... (decay: 0.72)

## Channel Knowledge
- [fact] This channel is for #backend-team discussions (decay: 1.0)
```

### Token budget

| Source | Approximate budget |
|--------|-------------------|
| User core memories | Unlimited (all enabled) |
| User working memories | Last 20 entries |
| Channel core memories | Unlimited (all enabled) |
| Channel working memories | Last 20 entries |
| Archive memories | 0 (search-only) |

The working-tier limit is configurable via `memory.workingTierLimit` (default: 20).

## 10. Search Scoring

When `memory-search` executes a keyword query:

```
score = keyword_match_count × decay × recency_bonus
```

1. `rg` finds matching lines across JSONL files (user + channel + agent workspace).
2. Each match is resolved to a `ResolvedMemory`.
3. `recency_bonus` is calculated from `ts` field: `clamp(1.0 + 0.5 × (1.0 − age_days/365), 1.0, 1.5)`.
4. Results are sorted by score descending.
5. `decay` value is included in each result for transparency.

**Tier filtering**: Search accepts optional `tier` and `category` parameters. The index enables fast pre-filtering before hitting the JSONL files.

## 11. Migration (v1 → v2)

### Script: `scripts/migrate-memory-v2.ts`

```bash
deno run --allow-read --allow-write scripts/migrate-memory-v2.ts --data-dir ./data
```

### Mapping rules

| v1 field | v2 field | Mapping |
|----------|----------|---------|
| `importance: "high"` | `tier: "core"`, `decay: 1.0` | High-importance → always-loaded core |
| `importance: "normal"` | `tier: "archive"`, `decay: 0.5` | Normal → search-only archive |
| (absent) | `category: "fact"` | Default category for all migrated entries |
| (absent) | `scope: "user"` | All existing memories are user-scoped |

### Procedure

1. **Backup**: Each file → `{filename}.backup.jsonl`.
2. **Transform**: Add `tier`, `category`, `scope`, `decay` to `type: "memory"` events missing `tier`. Patch events are unchanged.
3. **Write**: Atomic write via temp file + rename.
4. **Index**: Generate `memory.index.jsonl` per workspace.
5. **Idempotent**: Lines with existing `tier` field are written unchanged.

### Rollback

```bash
# Restore from backups
find data/workspaces -name "*.backup.jsonl" -exec sh -c \
  'mv "$1" "${1%.backup.jsonl}.jsonl"' _ {} \;
```

### Compatibility without migration

New code handles missing fields gracefully:

| Missing field | Default |
|--------------|---------|
| `tier` | `"core"` if `importance === "high"`, else `"archive"` |
| `category` | `"fact"` |
| `scope` | `"user"` |
| `decay` | Based on resolved tier default |

The system is fully functional without running the migration script — but working-tier and channel features require v2 fields.

## 12. Configuration

### Memory config (`config.yaml`)

```yaml
memory:
  search_limit: 10            # Max results per search
  max_chars: 2000             # Max characters per memory content
  workingTierLimit: 20        # Working-tier entries loaded per session

conversationSummary:
  model: "gpt-5-mini"         # Model for summary generation (default: agent.model)

memoryMaintenance:
  enabled: false
  model: "gpt-5-mini"
  minMemoryCount: 50          # Skip workspaces below this threshold
  intervalMs: 604800000       # 7 days
```

### Environment variable overrides

| Env var | Config path | Type |
|---------|-------------|------|
| `MEMORY_SEARCH_LIMIT` | `memory.search_limit` | Integer |
| `MEMORY_MAX_CHARS` | `memory.max_chars` | Integer |
| `MEMORY_WORKING_TIER_LIMIT` | `memory.workingTierLimit` | Integer |
| `CONVERSATION_SUMMARY_MODEL` | `conversationSummary.model` | String |
| `MEMORY_MAINTENANCE_ENABLED` | `memoryMaintenance.enabled` | `"true"` / `"false"` |
| `MEMORY_MAINTENANCE_MODEL` | `memoryMaintenance.model` | String |
| `MEMORY_MAINTENANCE_MIN_MEMORY_COUNT` | `memoryMaintenance.minMemoryCount` | Integer |
| `MEMORY_MAINTENANCE_INTERVAL_MS` | `memoryMaintenance.intervalMs` | Integer |

### Skill API parameters (additive, backward compatible)

| Skill | New parameters | Defaults |
|-------|---------------|----------|
| `memory-save` | `tier`, `category`, `scope`, `decay` | `"archive"`, `"fact"`, `"user"`, `0.5` |
| `memory-search` | `tier`, `category`, `scope` | (unfiltered) |
| `memory-patch` | `tier`, `category`, `decay` | (no change) |
| `memory-stats` | — | Reports `byTier`, `byCategory` breakdowns |
