# Memory System (Delta)

Modifies: `openspec/specs/memory-system/spec.md`

## Purpose

Extends the existing memory system with tiered storage, category, decay, and scope fields on MemoryEntry and PatchEvent to support the memory management redesign.

## MODIFIED Requirements

### Requirement: Memory Event Structure

Each memory event (type `"memory"`) SHALL contain the following required fields:

| Field        | Type                    | Description                          |
| ------------ | ----------------------- | ------------------------------------ |
| `id`         | `string`                | Unique ID (format: `mem_{base36_ts}_{random6}`) |
| `ts`         | `string`                | ISO 8601 timestamp                   |
| `type`       | `"memory"`              | Event type literal                   |
| `enabled`    | `boolean`               | Whether the memory is active         |
| `visibility` | `"public" \| "private"` | Visibility scope                     |
| `importance` | `"high" \| "normal"`    | Importance level (retained for backward compatibility) |
| `content`    | `string`                | Plain text content                   |
| `tier`       | `"core" \| "working" \| "archive"` | Storage tier                |
| `category`   | `"fact" \| "preference" \| "episode" \| "summary" \| "relationship"` | Content category |
| `decay`      | `number`                | Importance-weighted temporal relevance (0.0–1.0) |
| `scope`      | `"user" \| "channel"`   | Whether this memory is per-user or per-channel |

Each memory event MAY contain the following optional fields:

| Field        | Type       | Description                                    |
| ------------ | ---------- | ---------------------------------------------- |
| `relatedTo`  | `string[]` | IDs of semantically related memories           |
| `supersedes` | `string[]` | IDs of memories this entry logically supersedes |

#### Scenario: Memory with all new fields
- **WHEN** a memory is saved with `tier: "core"`, `category: "preference"`, `decay: 1.0`, `scope: "user"`
- **THEN** the stored event SHALL include all four new fields with the specified values

#### Scenario: Memory ID generation
- **GIVEN** a new memory is being created
- **WHEN** the system generates an ID
- **THEN** the ID SHALL follow the format `mem_{timestamp_base36}_{random_6_chars}`

### Requirement: Default Values for Backward Compatibility

When new fields are not provided, the system SHALL apply the following defaults:

| Field      | Default     |
| ---------- | ----------- |
| `tier`     | `"archive"` (or `"core"` when `importance` is `"high"` for backward compatibility) |
| `category` | `"fact"`    |
| `scope`    | `"user"`    |
| `decay`    | Per-tier default (see importance-decay spec) |

These defaults ensure that existing memory-save calls without the new fields continue to work, and that pre-migration memories loaded without these fields behave predictably. When `importance` is `"high"` and `tier` is not explicitly provided, the system SHALL derive `tier: "core"` to maintain backward compatibility with the legacy importance-based context loading.

#### Scenario: Save without new fields uses defaults
- **WHEN** `memory-save` is called with only `content`, `visibility`, and `importance`
- **THEN** the saved event SHALL have `tier: "archive"`, `category: "fact"`, `scope: "user"`, `decay: 0.5`

#### Scenario: Legacy memory loaded with defaults
- **GIVEN** a memory event in JSONL has no `tier`, `category`, `scope`, or `decay` fields
- **WHEN** the memory is loaded by `loadAllMemories()`
- **THEN** it SHALL be treated as `tier: "archive"`, `category: "fact"`, `scope: "user"`, `decay: 0.5`

### Requirement: Patch Events

The system SHALL support patch events (type `"patch"`) to modify memory attributes without deleting memories. Memories SHALL NOT be deleted; they can only be disabled via a patch event setting `enabled = false`. Patch events SHALL be appended to the same JSONL file as the original memory.

A patch event SHALL contain:

| Field      | Type     | Description                |
| ---------- | -------- | -------------------------- |
| `id`       | `string` | Unique patch event ID      |
| `ts`       | `string` | ISO 8601 timestamp         |
| `type`     | `"patch"`| Event type literal         |
| `targetId` | `string` | ID of the memory to modify |

A patch event MAY modify these fields: `enabled`, `visibility`, `importance`, `relatedTo`, `supersedes`, `tier`, `category`, `decay`.

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

### Requirement: Memory Statistics

The system SHALL provide memory statistics via `getMemoryStats()` returning per-visibility (`public`/`private`) counts:

- `total`: total number of memories
- `enabled`: count of enabled memories
- `disabled`: count of disabled memories
- `highImportance`: count of high-importance memories
- `normalImportance`: count of normal-importance memories

Additionally, statistics SHALL include:
- Per-tier counts (`core`, `working`, `archive`)
- Per-category counts (`fact`, `preference`, `episode`, `summary`, `relationship`)

A summary section SHALL aggregate counts across all visibility levels.

#### Scenario: Stats reflect current memory state with tiers and categories
- **GIVEN** a workspace with memories across different tiers and categories
- **WHEN** `getMemoryStats()` is called
- **THEN** the system SHALL return accurate per-visibility, per-tier, and per-category counts
