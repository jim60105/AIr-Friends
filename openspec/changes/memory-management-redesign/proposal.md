# Memory Management Redesign

## Why

The current memory system is a flat append-only log with keyword search. It works at small scale but degrades as conversations accumulate: `findMemoryById` scans the entire file, there is no way to store channel-shared knowledge, and conversation context is lost between sessions. Users interacting across many channels generate unbounded JSONL files with no structural way to distinguish identity facts from ephemeral episodes.

Research systems (MemGPT, A-Mem, MemMA, VARS, Field-Theoretic Memory) demonstrate that **tiered storage**, **categorized entries**, and **importance decay** dramatically improve retrieval relevance. We can adopt these ideas while keeping plain-text JSONL files — preserving compatibility with `git diff`, `rg`, and the existing skill API.

## What Changes

### 1. Tiered Memory Architecture

Split the flat importance:high/normal distinction into three tiers:

| Tier | Persistence | Loaded at session start | Examples |
|------|-------------|------------------------|----------|
| **Core** | Permanent, rarely changes | Always (full content) | Identity facts, preferences, relationships |
| **Working** | Auto-managed, bounded | Always (recent N entries) | Conversation summaries, short-term context |
| **Archive** | Permanent, grows over time | On-demand via search only | Episode logs, old summaries, detailed facts |

All tiers remain append-only JSONL in the same workspace directory. Tier is a field on the memory event, not a separate file.

### 2. Channel-Scoped Memory

New directory layout: `workspaces/{platform}/{channelId}/memory.channel.jsonl`. The agent chooses `scope: "user"` (existing per-user workspace) or `scope: "channel"` when saving. Channel memories are visible to all users in that channel and included in context assembly when the conversation occurs in that channel.

### 3. Conversation Summaries as Working Memory

At session end, the system auto-generates a summary entry (`category: "summary"`, `tier: "working"`). Summaries capture key topics, decisions, and emotional tone. Progressive consolidation: the memory maintenance scheduler merges older working-tier summaries into fewer archive-tier entries, keeping the working set bounded. A configurable `conversationSummary.model` setting allows using a cheaper/faster model for summary generation — the ACP client switches the session model before sending the summary prompt, then restores it afterward.

### 4. Enhanced Memory Event Fields

| New Field | Type | Purpose |
|-----------|------|---------|
| `tier` | `"core" \| "working" \| "archive"` | Storage tier (replaces semantic overload of `importance`) |
| `category` | `"fact" \| "preference" \| "episode" \| "summary" \| "relationship"` | Structured retrieval and filtering |
| `decay` | `number` (0.0–1.0) | Importance-weighted temporal relevance; maintenance can lower this over time |
| `scope` | `"user" \| "channel"` | Whether this memory is per-user or per-channel |

Existing `importance` and `visibility` fields are retained for backward compatibility. `tier` takes over the structural role that `importance` partially served.

### 5. Memory Index File

A co-located `memory.index.jsonl` maps `{id, tier, category, enabled, lineOffset}`. Built on startup by scanning the main JSONL once, then maintained incrementally on appends. Enables O(1) lookup by ID and fast filtered iteration by tier/category without loading all events.

### 6. Migration

A one-time `scripts/migrate-memory-v2.ts` script:
- `importance: "high"` → `tier: "core"`, `category: "fact"`, `decay: 1.0`
- `importance: "normal"` → `tier: "archive"`, `category: "fact"`, `decay: 0.5`
- Generates the index file for each workspace
- Idempotent (skips already-migrated files detected by presence of `tier` field)

### 7. Design Document

A new `docs/MEMORY_DESIGN.md` covering tier lifecycle, decay math, channel scoping rules, index rebuild procedure, and progressive summarization algorithm.

## Capabilities

### New Capabilities

- **Channel memory** — agent can persist and retrieve memories scoped to a channel, shared across all users in that channel
- **Automatic conversation summaries** — every session produces a structured summary for future context, no agent action required
- **Tiered context loading** — core memories are always present, working memory is bounded, archive is search-only; reduces token waste
- **Category-based retrieval** — skills can filter by `category` (e.g., "show me all relationship memories") for more targeted recall
- **Importance decay** — temporal relevance scoring lets search and maintenance prioritize fresh, high-signal memories
- **O(1) ID lookup** — index file eliminates full-file scans in `findMemoryById` and `patchMemory`

### Modified Capabilities

- **memory-save skill** — accepts new `tier`, `category`, `scope`, `decay` parameters (defaults preserve current behavior)
- **memory-search skill** — supports filtering by tier, category, scope; results include decay-adjusted relevance
- **memory-patch skill** — can update `tier`, `category`, `decay` in addition to existing fields
- **memory-stats skill** — reports counts per tier and category, plus index health
- **Context assembly** — loads core tier fully, working tier (recent N), and optionally channel memories for the active channel
- **Memory maintenance** — additionally consolidates working-tier summaries and adjusts decay values across archive entries

## Impact

- **Breaking**: Memory event schema adds required `tier` and `scope` fields. Migration script required for existing deployments.
- **Storage**: Index file adds ~5–10% overhead per workspace. Channel memory directories are new.
- **Performance**: Index eliminates O(n) scans for ID lookup and patch. Context assembly becomes tier-aware, loading fewer tokens by default.
- **Skills API**: All memory skills gain new optional parameters; existing calls without new params work via defaults (`tier: "archive"`, `scope: "user"`, `category: "fact"`, `decay: 0.5`).
- **Prompt templates**: System prompts updated to describe tiered memory and channel scope to the agent.
- **Tests**: New tests for tier routing, channel scoping, index maintenance, migration script, and summary generation. Existing memory tests updated for new fields.
