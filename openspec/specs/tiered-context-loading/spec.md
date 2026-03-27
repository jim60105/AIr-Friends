# Tiered Context Loading

## Purpose

Defines how memory tiers (core, working, archive) are loaded into session context. Core memories are always fully loaded, working memories are bounded by a configurable limit, and archive memories are only accessible via explicit search.

## Requirements

### Requirement: Core Tier Always Fully Loaded

All enabled core-tier memories (`tier: "core"`) SHALL be fully loaded into the session context at startup. There SHALL be no count or character limit on core-tier loading.

#### Scenario: All core memories loaded
- **GIVEN** a user has 15 enabled core-tier memories
- **WHEN** context assembly runs
- **THEN** all 15 core-tier memories SHALL be included in the initial context
- **AND** they SHALL be sorted by `createdAt` ascending

#### Scenario: Disabled core memories excluded
- **GIVEN** a user has 5 core-tier memories, 2 of which are disabled
- **WHEN** context assembly runs
- **THEN** only the 3 enabled core-tier memories SHALL be loaded

### Requirement: Working Tier Loads Recent N Entries

The system SHALL load the most recent N enabled working-tier memories (`tier: "working"`) at session start. The value of N SHALL be configurable via `memory.workingTierLimit` (default: 20). Entries SHALL be ordered by `ts` descending (most recent first) for selection, then presented in chronological order.

#### Scenario: Default working tier limit
- **GIVEN** a user has 25 enabled working-tier memories and no custom `workingTierLimit`
- **WHEN** context assembly runs
- **THEN** the 20 most recent working-tier memories SHALL be loaded

#### Scenario: Custom working tier limit
- **GIVEN** `memory.workingTierLimit` is set to 5
- **AND** a user has 25 enabled working-tier memories
- **WHEN** context assembly runs
- **THEN** the 5 most recent working-tier memories SHALL be loaded

#### Scenario: Fewer entries than limit
- **GIVEN** a user has 3 enabled working-tier memories and `workingTierLimit` is 20
- **WHEN** context assembly runs
- **THEN** all 3 working-tier memories SHALL be loaded

### Requirement: Archive Tier Search-Only

Archive-tier memories (`tier: "archive"`) SHALL NOT be loaded at session start. They SHALL only be retrievable via explicit `memory-search` calls by the agent.

#### Scenario: Archive memories excluded from initial context
- **GIVEN** a user has 100 archive-tier memories
- **WHEN** context assembly runs
- **THEN** zero archive-tier memories SHALL be included in the initial context

#### Scenario: Archive memories searchable
- **GIVEN** a user has archive-tier memories containing "vacation plans"
- **WHEN** the agent calls `memory-search` with query "vacation plans"
- **THEN** matching archive-tier memories SHALL be returned in search results

### Requirement: Channel Core and Working Memories Loaded in Channel Context

When a conversation occurs in a channel, the system SHALL also load enabled core-tier and recent working-tier memories from the channel's memory file, in addition to the user's memories.

#### Scenario: Channel core memories included
- **GIVEN** channel `ch-456` has 3 core-tier channel memories
- **AND** the user has 5 core-tier personal memories
- **WHEN** context assembly runs for a conversation in channel `ch-456`
- **THEN** all 8 core-tier memories (3 channel + 5 user) SHALL be loaded

#### Scenario: Channel working-tier memories auto-loaded
- **GIVEN** channel `ch-456` has 5 working-tier channel memories
- **AND** `memory.workingTierLimit` is 20
- **WHEN** context assembly runs for a conversation in channel `ch-456`
- **THEN** the most recent working-tier channel memories (up to the limit) SHALL be auto-loaded

#### Scenario: Channel archive memories not auto-loaded
- **GIVEN** channel `ch-456` has 10 archive-tier channel memories
- **WHEN** context assembly runs for a conversation in channel `ch-456`
- **THEN** archive-tier channel memories SHALL NOT be auto-loaded
- **AND** they SHALL require explicit search

### Requirement: Backward Compatibility for Legacy Memories

Memories without a `tier` field SHALL default to `tier: "archive"` during loading. This ensures pre-migration memories are not auto-loaded into context but remain searchable.

#### Scenario: Legacy memory treated as archive
- **GIVEN** a memory event has no `tier` field
- **WHEN** context assembly runs
- **THEN** the memory SHALL be treated as `tier: "archive"`
- **AND** it SHALL NOT be included in the initial context
- **AND** it SHALL be searchable via `memory-search`
