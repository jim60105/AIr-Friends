# Memory Management Redesign — Implementation Tasks

## 1. Type System & Schema Updates

- [ ] 1.1 Add `MemoryTier`, `MemoryCategory`, `MemoryScope` type aliases to `src/types/memory.ts`
- [ ] 1.2 Add `tier`, `category`, `scope`, `decay` fields to `MemoryEntry` interface
- [ ] 1.3 Extend `MemoryVisibility` to include `"channel"`
- [ ] 1.4 Add `tier`, `category`, `decay` to `PatchEvent.changes` (scope is immutable)
- [ ] 1.5 Add `tier`, `category`, `scope`, `decay` to `ResolvedMemory` type
- [ ] 1.6 Add `MemoryIndexEntry` interface (`id`, `tier`, `category`, `enabled`, `scope`, `visibility`, `file`, `lineNumber`)
- [ ] 1.7 Update `src/types/config.ts` with `memory.workingTierLimit` config field (default 20)

## 2. Memory Index Implementation

- [ ] 2.1 Create `src/core/memory-index.ts` with `MemoryIndex` class (in-memory map + file I/O)
- [ ] 2.2 Implement `MemoryIndex.rebuild(workspace)` — full scan of JSONL files, resolve all entries, write `memory.index.jsonl`
- [ ] 2.3 Implement `MemoryIndex.load(workspace)` — read existing index file into in-memory map
- [ ] 2.4 Implement `MemoryIndex.appendEntry(entry)` — append single index line to file and update in-memory map
- [ ] 2.5 Implement `MemoryIndex.updateEntry(id, changes)` — update in-memory map and append updated line to file
- [ ] 2.6 Implement `MemoryIndex.lookupById(id)` — O(1) lookup returning `{file, lineNumber}`
- [ ] 2.7 Implement `MemoryIndex.getByTier(tier)` — return all enabled entry IDs for a given tier
- [ ] 2.8 Implement `MemoryIndex.getByCategory(category)` — return all enabled entry IDs for a given category
- [ ] 2.9 Add startup index validation in `MemoryStore.initialize()` — rebuild if index missing or stale

## 3. Memory Store Enhancements

- [ ] 3.1 Update `saveMemory()` to accept and persist `tier`, `category`, `decay`, `scope` fields
- [ ] 3.2 Apply default values for new fields when not provided (`tier: "archive"`, `category: "fact"`, `scope: "user"`, `decay: 0.5`)
- [ ] 3.3 Update `findMemoryById()` to use `MemoryIndex.lookupById()` for O(1) lookup instead of full-file scan
- [ ] 3.4 Update `searchMemories()` to support optional `category` filter parameter
- [ ] 3.5 Update `searchMemories()` to apply decay-weighted scoring: `keyword_match_count * decay * recency_bonus`
- [ ] 3.6 Implement recency bonus calculation: `1.0 + (0.5 * (1.0 - age_days / 365))` clamped to `[1.0, 1.5]`
- [ ] 3.7 Update `patchMemory()` to handle `tier`, `category`, `decay` changes and update index
- [ ] 3.8 Replace `loadHighImportanceMemories()` with `loadCoreTierMemories()` using index for fast filtered reads
- [ ] 3.9 Add `loadRecentWorkingMemories(limit)` — return most recent N working-tier enabled entries
- [ ] 3.10 Retain `loadHighImportanceMemories()` as deprecated wrapper with fallback logic for un-migrated entries
- [ ] 3.11 Integrate `MemoryIndex` into all `MemoryStore` write operations (append index entry after JSONL append)

## 4. Channel Memory

- [ ] 4.1 Add channel workspace directory resolution to `WorkspaceManager`: `data/workspaces/{platform}/channels/{channelId}/`
- [ ] 4.2 Implement `WorkspaceManager.ensureChannelWorkspace(platform, channelId)` — create directory + initialize empty files
- [ ] 4.3 Add scope routing in `MemoryStore` — when `scope === "channel"`, resolve to channel workspace path
- [ ] 4.4 Update `memory-save` skill handler to accept `scope` and `channelId` parameters; reject `scope: "channel"` in DM context
- [ ] 4.5 Update `memory-search` skill handler to search channel memory files when `scope === "channel"` or when in channel context
- [ ] 4.6 Update `memory-patch` skill handler to resolve channel workspace for channel-scoped memories
- [ ] 4.7 Update `memory-stats` skill handler to include channel memory counts (tier/category breakdown)
- [ ] 4.8 Add channel memory index support (co-located `memory.index.jsonl` in channel workspace)

## 5. Context Assembly Updates

- [ ] 5.1 Update `ContextAssembler` to load core-tier memories (all enabled) instead of high-importance memories
- [ ] 5.2 Add loading of recent working-tier memories (last N entries, configurable via `memory.workingTierLimit`)
- [ ] 5.3 Add channel core + working memory loading when session occurs in a channel context
- [ ] 5.4 Format context into structured sections: "Core Memories", "Recent Context", "Channel Knowledge"
- [ ] 5.5 Ensure archive-tier memories are excluded from pre-loaded context (search-only)
- [ ] 5.6 Add backward compatibility: treat entries without `tier` field using `importance` fallback
- [ ] 5.7 Update prompt templates (`prompts/system_reply.md` and fragments) to describe tiered memory and channel scope to agent

## 6. Conversation Summary Pipeline

- [ ] 6.1 Create summary prompt template `prompts/system_summary.md` (instructs agent to call `memory-save` with structured summary)
- [ ] 6.2 Implement auto-summary trigger in `SessionOrchestrator` after successful session (at least one `send-reply`)
- [ ] 6.3 Send summary prompt on the same ACP session via `connector.prompt(sessionId, summaryPrompt)`
- [ ] 6.4 Store user summary as `{tier: "working", category: "summary", scope: "user"}`
- [ ] 6.5 Store channel summary as `{tier: "working", category: "summary", scope: "channel"}` when session involves a channel
- [ ] 6.6 Make summary generation fire-and-forget: catch and log errors without affecting session success status
- [ ] 6.7 Skip summary generation gracefully if agent subprocess has already exited
- [ ] 6.8 Add `conversationSummary.model` to config types in `src/types/config.ts`
- [ ] 6.9 Add `CONVERSATION_SUMMARY_MODEL` env var parsing in `src/utils/env.ts`
- [ ] 6.10 Implement model switching in `SessionOrchestrator`: save current model → `connector.setSessionModel(sessionId, summaryModel)` → send summary prompt → restore original model; skip switch if summary model equals agent model
- [ ] 6.11 Update `config.example.yaml` with `conversationSummary.model` setting
- [ ] 6.12 Update `.env.example` with `CONVERSATION_SUMMARY_MODEL`
- [ ] 6.13 Add unit tests for model switching: configured model triggers switch + restore, unconfigured model skips switch, restore runs even on summary failure

## 7. Importance Decay

- [ ] 7.1 Implement decay-weighted search scoring in `MemoryStore.searchMemories()`
- [ ] 7.2 Pin core-tier decay at 1.0 — reject decay changes for core-tier entries in `patchMemory()`
- [ ] 7.3 Set default decay values by tier: core=1.0, working=0.8, archive=0.5
- [ ] 7.4 Implement recency bonus formula and integrate into search result ranking

## 8. Memory Maintenance Updates

- [ ] 8.1 Add working-tier summary consolidation logic to maintenance prompt: merge older working summaries into fewer archive-tier entries
- [ ] 8.2 Add decay adjustment per maintenance cycle: `decay *= 0.95` for unaccessed working/archive entries via patch events
- [ ] 8.3 Add channel memory maintenance: scan channel workspaces alongside user workspaces
- [ ] 8.4 Update memory maintenance prompt template (`prompts/system_memory_maintenance.md`) for tier-aware instructions
- [ ] 8.5 Flag entries with `decay < 0.05` as disable candidates for agent review

## 9. Skill API & Shell Skill Updates

- [ ] 9.1 Update `memory-save` HTTP endpoint to accept `tier`, `category`, `scope`, `decay` parameters
- [ ] 9.2 Update `memory-search` HTTP endpoint to accept `category` filter and return decay-adjusted relevance scores
- [ ] 9.3 Update `memory-patch` HTTP endpoint to accept `tier`, `category`, `decay` changes
- [ ] 9.4 Update `memory-stats` HTTP endpoint to return per-tier, per-category, and channel breakdown
- [ ] 9.5 Update `skills/memory-save/SKILL.md` with new parameter documentation
- [ ] 9.6 Update `skills/memory-search/SKILL.md` with category filter and decay scoring documentation
- [ ] 9.7 Update `skills/memory-patch/SKILL.md` with new patchable fields documentation
- [ ] 9.8 Update `skills/memory-stats/SKILL.md` with tier/category/channel stats documentation
- [ ] 9.9 Update shell skill scripts (`skills/*/scripts/*.ts`) for new parameters

## 10. Migration Script

- [ ] 10.1 Create `scripts/migrate-memory-v2.ts` scaffold with CLI argument parsing (`--data-dir`)
- [ ] 10.2 Implement backup step: copy each JSONL file to `{filename}.backup.jsonl` before modification
- [ ] 10.3 Implement transform: `importance: "high"` → `tier: "core"`, `decay: 1.0`; `importance: "normal"` → `tier: "archive"`, `decay: 0.5`; all get `category: "fact"`, `scope: "user"`
- [ ] 10.4 Implement atomic write: write to temp file then rename to original path
- [ ] 10.5 Implement idempotency check: skip entries that already have a `tier` field
- [ ] 10.6 Implement index generation for each migrated workspace
- [ ] 10.7 Add unit tests for migration script (transform logic, idempotency, backup creation)

## 11. Design Document

- [ ] 11.1 Create `docs/MEMORY_DESIGN.md` covering tier lifecycle, decay math, channel scoping rules, index rebuild procedure, and progressive summarization algorithm

## 12. Tests

- [ ] 12.1 Unit tests for `MemoryIndex` (rebuild, load, append, update, lookup, getByTier, getByCategory)
- [ ] 12.2 Unit tests for updated `MemoryStore.saveMemory()` with new fields and defaults
- [ ] 12.3 Unit tests for `MemoryStore.findMemoryById()` using index-based O(1) lookup
- [ ] 12.4 Unit tests for `MemoryStore.searchMemories()` with category filter and decay-weighted scoring
- [ ] 12.5 Unit tests for `MemoryStore.patchMemory()` with tier, category, decay changes
- [ ] 12.6 Unit tests for `loadCoreTierMemories()` and `loadRecentWorkingMemories()`
- [ ] 12.7 Unit tests for channel memory operations (save, search, patch in channel workspace)
- [ ] 12.8 Unit tests for conversation summary generation (trigger conditions, storage, fire-and-forget failure handling)
- [ ] 12.9 Unit tests for decay scoring formula and recency bonus calculation
- [ ] 12.10 Unit tests for tiered context loading in `ContextAssembler`
- [ ] 12.11 Unit tests for backward compatibility (entries without `tier` field use `importance` fallback)
- [ ] 12.12 Integration tests for end-to-end memory flow: save with tier → search with category filter → patch decay → verify context assembly
- [ ] 12.13 Update existing memory tests to include new fields in test fixtures

## 13. Documentation & Config Updates

- [ ] 13.1 Update `AGENTS.md` memory system sections (tier model, channel memory, decay, categories)
- [ ] 13.2 Update `config.example.yaml` with `memory.workingTierLimit`, `conversationSummary.model`, and any new memory settings
- [ ] 13.3 Update `.env.example` with `CONVERSATION_SUMMARY_MODEL` and any other new environment variable overrides
- [ ] 13.4 Update `helm/values.yaml` `env:` section for new memory configuration variables
- [ ] 13.5 Update prompt templates to describe tiered memory model and channel scope to agent
