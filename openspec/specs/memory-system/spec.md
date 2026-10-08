# Memory System

## Purpose

Defines the append-only memory storage, retrieval, visibility scoping, patch semantics, and memory statistics. Memories are stored as JSONL files per workspace with full-text search support.

## Requirements

### Requirement: Append-Only JSONL Storage

The system SHALL store memory events as append-only JSONL (one JSON object per line) in two files within each workspace:

- `memory.public.jsonl` — public memories
- `memory.private.jsonl` — private memories

Events SHALL only be appended; existing lines SHALL NOT be modified or deleted. Memory files SHALL NOT be pre-created at workspace initialization; they SHALL be created lazily on first write.

#### Scenario: Saving a new memory
- **GIVEN** a user saves a memory with visibility `"public"`
- **WHEN** `addMemory()` is called
- **THEN** the system SHALL append a JSON line to `memory.public.jsonl` in the user's workspace

#### Scenario: Private memory stored in private file
- **GIVEN** a user saves a memory with visibility `"private"`
- **WHEN** `addMemory()` is called
- **THEN** the system SHALL append a JSON line to `memory.private.jsonl`

#### Scenario: First memory save creates file
- **GIVEN** a workspace with no memory files
- **WHEN** `addMemory()` is called for the first time
- **THEN** the appropriate memory file (public or private) is created
- **AND** the memory entry is written as the first line

#### Scenario: Read returns empty for missing file
- **GIVEN** a workspace with no memory files
- **WHEN** `loadAllMemories()` is called
- **THEN** an empty array is returned
- **AND** no error is thrown

#### Scenario: Channel memory file creation
- **GIVEN** a channel workspace with no memory file
- **WHEN** `addChannelMemory()` is called
- **THEN** `memory.channel.jsonl` is created with the first entry

### Requirement: Memory Event Structure

Each memory event of type `"memory"` SHALL contain the required fields and MAY contain the optional fields `relatedTo` and `supersedes`; the scenarios below specify every field's type, format, and meaning.

#### Scenario: Memory with all new fields
- **WHEN** a memory is saved with `tier: "core"`, `category: "preference"`, `decay: 1.0`, `scope: "user"`
- **THEN** the stored event SHALL include all four new fields with the specified values

#### Scenario: Memory ID generation
- **GIVEN** a new memory is being created
- **WHEN** the system generates an ID
- **THEN** the ID SHALL follow the format `mem_{timestamp_base36}_{random_6_chars}`

#### Scenario: Required fields stored on every memory
- **WHEN** a memory event is saved
- **THEN** the stored event SHALL contain the required fields `id`, `ts`, `type`, `enabled`, `visibility`, `importance`, `content`, `tier`, `category`, `decay`, and `scope`

#### Scenario: Required field types and formats
- **GIVEN** a memory event in JSONL
- **WHEN** its fields are inspected
- **THEN** `id` SHALL be a string formatted `mem_{base36_ts}_{random6}`
- **AND** `ts` SHALL be an ISO 8601 timestamp string
- **AND** `type` SHALL be the literal `"memory"`
- **AND** `enabled` SHALL be a boolean
- **AND** `visibility` SHALL be `"public"` or `"private"`
- **AND** `importance` SHALL be `"high"` or `"normal"` (retained for backward compatibility)
- **AND** `content` SHALL be plain text
- **AND** `tier` SHALL be `"core"`, `"working"`, or `"archive"`
- **AND** `category` SHALL be one of `"fact"`, `"preference"`, `"episode"`, `"summary"`, and `"relationship"`
- **AND** `decay` SHALL be a number from 0.0 to 1.0 representing importance-weighted temporal relevance
- **AND** `scope` SHALL be `"user"` or `"channel"`, indicating per-user or per-channel storage

#### Scenario: Optional relationship fields
- **WHEN** a memory is saved with related or superseded memories
- **THEN** the event MAY include `relatedTo` as a `string[]` of IDs of semantically related memories
- **AND** MAY include `supersedes` as a `string[]` of IDs of memories this entry logically supersedes

### Requirement: Default Values for Backward Compatibility

When new fields are not provided, the system SHALL apply default values so existing memory-save calls without the new fields and pre-migration memories loaded without them behave predictably; the specific defaults and the high-importance tier derivation are specified in the scenarios below.

#### Scenario: Save without new fields uses defaults
- **WHEN** `memory-save` is called with only `content`, `visibility`, and `importance`
- **THEN** the saved event SHALL have `tier: "archive"`, `category: "fact"`, `scope: "user"`, `decay: 0.5`

#### Scenario: Legacy memory loaded with defaults
- **GIVEN** a memory event in JSONL has no `tier`, `category`, `scope`, or `decay` fields
- **WHEN** the memory is loaded by `loadAllMemories()`
- **THEN** it SHALL be treated as `tier: "archive"`, `category: "fact"`, `scope: "user"`, `decay: 0.5`

#### Scenario: High-importance default tier derivation
- **GIVEN** a memory saved with `importance: "high"` and no explicit `tier`
- **WHEN** the memory is stored
- **THEN** the system SHALL derive `tier: "core"` for backward compatibility with legacy importance-based context loading

#### Scenario: Per-tier default decay values
- **GIVEN** a memory saved or loaded without an explicit `decay` value
- **WHEN** its `decay` value is resolved
- **THEN** `decay` SHALL be set to the per-tier default defined in the importance-decay spec

### Requirement: Visibility Scoping

The system SHALL enforce visibility scoping based on the conversation context:

- **DM context** (`isDm = true`): Load, save, and search SHALL include both `memory.public.jsonl` and `memory.private.jsonl`. Default save visibility SHALL be `"private"`.
- **Non-DM context** (`isDm = false`): Load, save, and search SHALL include only `memory.public.jsonl`. Default save visibility SHALL be `"public"`. The system SHALL NOT access private memory files in non-DM contexts.

#### Scenario: DM includes both public and private memories
- **GIVEN** a user interacts via DM
- **WHEN** memories are loaded or searched
- **THEN** both `memory.public.jsonl` and `memory.private.jsonl` SHALL be accessed

#### Scenario: Non-DM excludes private memories
- **GIVEN** a user interacts in a guild channel
- **WHEN** memories are loaded or searched
- **THEN** only `memory.public.jsonl` SHALL be accessed
- **AND** `memory.private.jsonl` SHALL NOT be read

### Requirement: Patch Events

The system SHALL support patch events (type `"patch"`) that modify memory attributes without deleting memories; memories SHALL NOT be deleted and SHALL be disabled only via a patch event setting `enabled = false`, appended to the same JSONL file as the original memory.

#### Scenario: Disabling a memory via patch
- **GIVEN** an enabled memory with ID `mem_abc_123`
- **WHEN** `patchMemory()` is called with `{ enabled: false }`
- **THEN** the system SHALL append a patch event with `targetId = "mem_abc_123"` and `enabled = false`
- **AND** the original memory line SHALL remain unchanged

#### Scenario: Patching tier and category
- **GIVEN** an archive-tier memory with ID `mem_abc_123`
- **WHEN** `patchMemory()` is called with `{ tier: "core", category: "relationship" }`
- **THEN** the system SHALL append a patch event with `tier: "core"` and `category: "relationship"`

#### Scenario: Patching decay value
- **GIVEN** a memory with `decay: 0.5`
- **WHEN** `patchMemory()` is called with `{ decay: 0.3 }`
- **THEN** the system SHALL append a patch event with `decay: 0.3`

#### Scenario: Patch resolution applies chronologically
- **GIVEN** a memory has multiple patch events
- **WHEN** `loadAllMemories()` resolves the final state
- **THEN** patches SHALL be applied in chronological order by `ts`
- **AND** `relatedTo` and `supersedes` arrays SHALL be merged via Set union (deduplicated) across the original entry and all patches
- **AND** `lastModifiedAt` SHALL reflect the timestamp of the most recent patch

#### Scenario: Patch event required fields
- **WHEN** a patch event is appended
- **THEN** it SHALL contain the fields `id` (unique patch event ID), `ts` (ISO 8601 timestamp), `type` (literal `"patch"`), and `targetId` (ID of the memory to modify)

#### Scenario: Patchable memory attributes
- **GIVEN** an existing memory
- **WHEN** `patchMemory()` is called
- **THEN** the patch event MAY modify the fields `enabled`, `visibility`, `importance`, `relatedTo`, `supersedes`, `tier`, `category`, and `decay`

### Requirement: Memory Statistics

The system SHALL provide memory statistics via `getMemoryStats()` returning per-visibility (`public`/`private`) counts, per-tier and per-category counts, and a summary section aggregating counts across all visibility levels.

#### Scenario: Stats reflect current memory state with tiers and categories
- **GIVEN** a workspace with memories across different tiers and categories
- **WHEN** `getMemoryStats()` is called
- **THEN** the system SHALL return accurate per-visibility, per-tier, and per-category counts

#### Scenario: Per-visibility counts
- **WHEN** `getMemoryStats()` is called
- **THEN** the returned statistics SHALL include per-visibility counts of `total` memories, `enabled` memories, `disabled` memories, `highImportance` memories, and `normalImportance` memories

#### Scenario: Per-tier and per-category counts
- **WHEN** `getMemoryStats()` is called
- **THEN** the statistics SHALL include per-tier counts for `core`, `working`, and `archive`
- **AND** per-category counts for `fact`, `preference`, `episode`, `summary`, and `relationship`

#### Scenario: Summary aggregates across visibilities
- **WHEN** `getMemoryStats()` is called
- **THEN** a summary section SHALL aggregate counts across all visibility levels

### Requirement: Memory Export

The system SHALL support memory export via `handleMemoryExport()`. Exports SHALL always include both public and private memories (delivered via DM to ensure privacy boundary). Exports SHALL support filtering by `enabled_only` (default: `true`) and `importance` (`"high"`, `"normal"`, or `"all"`). Exports SHALL support two formats: `markdown` (file: `memory-export.md`) and `json` (file: `memory-export.json`). Agent workspace notes SHALL NOT be included in exports.

#### Scenario: Export as markdown
- **GIVEN** a user requests memory export in markdown format
- **WHEN** `handleMemoryExport()` is called with `format = "markdown"`
- **THEN** the system SHALL generate a `memory-export.md` file containing both public and private memories
- **AND** the file SHALL be delivered via DM

#### Scenario: Export filtered by importance
- **GIVEN** a user requests export with `importance = "high"`
- **WHEN** `handleMemoryExport()` is called
- **THEN** only high-importance memories SHALL be included in the export

### Requirement: Memory Retrieval by Relevance

Enabled memories SHALL be retrieved by query through the `memory-recall` capability, which ranks by lexical relevance and returns deduplicated memories within the requested result count and token budget. The system SHALL NOT use substring search over raw JSONL lines for memory retrieval.

#### Scenario: Normal memories retrieved by relevance
- **GIVEN** a user has many normal-importance memories
- **WHEN** `memory-search` is called with a query
- **THEN** results SHALL be produced by the `memory-recall` capability, ordered by relevance score
- **AND** results SHALL be deduplicated by memory ID
- **AND** results SHALL be limited by the requested count and the Deep Recall token budget
