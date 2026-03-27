# Memory Index

## Purpose

Provides O(1) ID lookup and fast filtered iteration via a co-located index file, eliminating full-file scans in `findMemoryById` and `patchMemory`.

## ADDED Requirements

### Requirement: Index File Location

The index file SHALL be named `memory.index.jsonl` and SHALL be co-located with its corresponding memory files within the same workspace directory. Channel memory workspaces SHALL also have their own index file.

#### Scenario: User workspace index
- **GIVEN** a user workspace at `data/workspaces/discord/user123/`
- **THEN** the index file SHALL be at `data/workspaces/discord/user123/memory.index.jsonl`

#### Scenario: Channel workspace index
- **GIVEN** a channel workspace at `data/workspaces/discord/channels/ch-456/`
- **THEN** the index file SHALL be at `data/workspaces/discord/channels/ch-456/memory.index.jsonl`

### Requirement: Index Entry Schema

Each line in `memory.index.jsonl` SHALL be a JSON object with the following fields:

| Field        | Type      | Description                                    |
| ------------ | --------- | ---------------------------------------------- |
| `id`         | `string`  | Memory ID                                      |
| `tier`       | `string`  | Memory tier (`core`, `working`, `archive`)     |
| `category`   | `string`  | Memory category                                |
| `enabled`    | `boolean` | Current enabled state (after patches applied)  |
| `scope`      | `string`  | Memory scope (`user` or `channel`)             |
| `file`       | `string`  | Source JSONL file (`public`, `private`, or `channel`) |
| `visibility` | `string`  | Memory visibility (`public`, `private`, or `channel`) |
| `lineNumber` | `number`  | 1-based line number in the source JSONL file   |

#### Scenario: Index entry for a new memory
- **WHEN** a memory with ID `mem_abc_123` is saved at line 42 of `memory.public.jsonl`
- **THEN** the index SHALL contain `{"id":"mem_abc_123","tier":"archive","category":"fact","enabled":true,"scope":"user","file":"public","visibility":"public","lineNumber":42}`

### Requirement: Lazy-Loaded with Fallback

The system SHALL lazy-load the index on first access per workspace. If the index file does not exist, the system SHALL start with an empty in-memory map. Operations that depend on index lookup (e.g., `findMemoryById`) SHALL fall back to full JSONL file scanning when the index is empty or the entry is not found. A full rebuild from source JSONL files can be triggered explicitly via `rebuild()`.

#### Scenario: Index loaded on first access
- **GIVEN** a workspace has `memory.index.jsonl`
- **WHEN** the first memory operation is performed on that workspace
- **THEN** the index SHALL be loaded into an in-memory map

#### Scenario: Missing index starts empty with fallback
- **GIVEN** `memory.index.jsonl` does not exist but `memory.public.jsonl` has events
- **WHEN** `findMemoryById` is called
- **THEN** the in-memory index SHALL be empty
- **AND** the system SHALL fall back to scanning the source JSONL files

### Requirement: Incremental Maintenance

When a new memory or patch event is appended to a JSONL file, the system SHALL incrementally update the index file by appending or updating the corresponding entry. The system SHALL NOT rebuild the entire index on each append.

#### Scenario: New memory adds index entry
- **WHEN** a new memory is appended to the JSONL file
- **THEN** a new entry SHALL be appended to `memory.index.jsonl`

#### Scenario: Patch updates index entry
- **WHEN** a patch event disabling `mem_abc_123` is appended
- **THEN** the index SHALL be updated to reflect `enabled: false` for `mem_abc_123`

### Requirement: Explicit Rebuild Mechanism

The system SHALL provide a `rebuild()` method that regenerates the index from scratch by scanning the source JSONL files. This can be triggered explicitly when the index is known to be stale or corrupted.

#### Scenario: Explicit rebuild regenerates index
- **GIVEN** `memory.index.jsonl` is corrupted or stale
- **WHEN** `rebuild()` is called with the source memory file paths
- **THEN** a full rebuild SHALL be triggered from the source JSONL files
- **AND** the corrupted/stale file SHALL be replaced

### Requirement: O(1) ID Lookup via Index

The `findMemoryById` function SHALL use the index to locate a memory by ID in O(1) time (hash map lookup), rather than scanning the entire JSONL file.

#### Scenario: Fast lookup by ID
- **GIVEN** a workspace has 10,000 memories and a valid index
- **WHEN** `findMemoryById("mem_abc_123")` is called
- **THEN** the system SHALL look up the ID in the in-memory index map
- **AND** SHALL NOT scan the full JSONL file

#### Scenario: Lookup for non-existent ID
- **WHEN** `findMemoryById("mem_nonexistent")` is called
- **THEN** the system SHALL return `null` without scanning any file
