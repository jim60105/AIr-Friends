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
| `lineNumber` | `number`  | 1-based line number in the source JSONL file   |

#### Scenario: Index entry for a new memory
- **WHEN** a memory with ID `mem_abc_123` is saved at line 42 of `memory.public.jsonl`
- **THEN** the index SHALL contain `{"id":"mem_abc_123","tier":"archive","category":"fact","enabled":true,"scope":"user","lineNumber":42}`

### Requirement: Built on Startup

The system SHALL build the index by scanning the memory JSONL files on application startup. The build process SHALL read all memory and patch events, apply patches chronologically, and write the resulting index.

#### Scenario: Index built from existing memories
- **GIVEN** a workspace has `memory.public.jsonl` with 100 events
- **WHEN** the application starts
- **THEN** the system SHALL scan the file and generate `memory.index.jsonl` with entries for all resolved memories

#### Scenario: Patches reflected in index
- **GIVEN** memory `mem_abc_123` has a patch setting `enabled: false`
- **WHEN** the index is built on startup
- **THEN** the index entry for `mem_abc_123` SHALL have `enabled: false`

### Requirement: Incremental Maintenance

When a new memory or patch event is appended to a JSONL file, the system SHALL incrementally update the index file by appending or updating the corresponding entry. The system SHALL NOT rebuild the entire index on each append.

#### Scenario: New memory adds index entry
- **WHEN** a new memory is appended to the JSONL file
- **THEN** a new entry SHALL be appended to `memory.index.jsonl`

#### Scenario: Patch updates index entry
- **WHEN** a patch event disabling `mem_abc_123` is appended
- **THEN** the index SHALL be updated to reflect `enabled: false` for `mem_abc_123`

### Requirement: Rebuild Mechanism for Corruption Recovery

The system SHALL provide a rebuild mechanism that regenerates the index from scratch by scanning the source JSONL files. This SHALL be triggered when the index file is missing, corrupted (unparseable), or explicitly requested.

#### Scenario: Missing index triggers rebuild
- **GIVEN** `memory.index.jsonl` does not exist but `memory.public.jsonl` has events
- **WHEN** the system attempts to load the index
- **THEN** a full rebuild SHALL be triggered from the source JSONL files

#### Scenario: Corrupted index triggers rebuild
- **GIVEN** `memory.index.jsonl` contains invalid JSON on line 5
- **WHEN** the system attempts to load the index
- **THEN** a full rebuild SHALL be triggered
- **AND** the corrupted file SHALL be replaced

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
