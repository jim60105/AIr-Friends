# Importance Decay

## Purpose

Implements temporal relevance decay scoring for memories, allowing search and maintenance to prioritize fresh, high-signal entries over stale ones.

## ADDED Requirements

### Requirement: Decay Field Range and Defaults

Each memory entry SHALL have a `decay` field of type `number` in the range 0.0 to 1.0 (inclusive). Default values SHALL vary by tier:

| Tier      | Default Decay |
| --------- | ------------- |
| `core`    | `1.0`         |
| `working` | `0.7`         |
| `archive` | `0.5`         |

#### Scenario: Core tier default decay
- **WHEN** a memory is saved with `tier: "core"` and no `decay` specified
- **THEN** the `decay` field SHALL default to `1.0`

#### Scenario: Working tier default decay
- **WHEN** a memory is saved with `tier: "working"` and no `decay` specified
- **THEN** the `decay` field SHALL default to `0.7`

#### Scenario: Archive tier default decay
- **WHEN** a memory is saved with `tier: "archive"` and no `decay` specified
- **THEN** the `decay` field SHALL default to `0.5`

#### Scenario: Custom decay value
- **WHEN** a memory is saved with `decay: 0.8`
- **THEN** the `decay` field SHALL be `0.8`

#### Scenario: Decay value clamped to range
- **WHEN** a memory is saved with `decay: 1.5`
- **THEN** the `decay` field SHALL be clamped to `1.0`

### Requirement: Search Scoring Formula

Memory search results SHALL be ranked using the formula: `effective_score = match_score * decay * recency_bonus`. The `recency_bonus` SHALL be a multiplier derived from the memory's age, giving higher weight to more recent entries.

#### Scenario: High-decay memory ranks higher
- **GIVEN** two memories match a search query equally
- **AND** memory A has `decay: 0.9` and memory B has `decay: 0.3`
- **WHEN** search results are ranked
- **THEN** memory A SHALL rank higher than memory B

#### Scenario: Recency bonus applied
- **GIVEN** two memories have the same `decay` and match score
- **AND** memory A was created 1 day ago, memory B was created 30 days ago
- **WHEN** search results are ranked
- **THEN** memory A SHALL rank higher than memory B due to recency bonus

### Requirement: Maintenance Decay Adjustment

During memory maintenance, the system SHALL reduce the `decay` value of archive-tier entries that have not been accessed. The adjustment formula SHALL be: `new_decay = current_decay * 0.95` per maintenance cycle.

#### Scenario: Archive decay reduced during maintenance
- **GIVEN** an archive-tier memory has `decay: 0.5` and was not accessed since last maintenance
- **WHEN** memory maintenance runs
- **THEN** the memory's `decay` SHALL be updated to `0.475` (0.5 × 0.95) via `memory-patch`

#### Scenario: Multiple maintenance cycles compound decay
- **GIVEN** an archive-tier memory starts with `decay: 0.5`
- **WHEN** 3 maintenance cycles run without access
- **THEN** the decay SHALL be approximately `0.5 * 0.95^3 ≈ 0.429`

### Requirement: Core Tier Decay Pinned

Core-tier memories SHALL always have `decay: 1.0`. The system SHALL NOT reduce decay for core-tier entries during maintenance or any other process. If a `memory-patch` attempts to change a core-tier memory's decay, it SHALL be ignored.

#### Scenario: Core decay unchanged during maintenance
- **GIVEN** a core-tier memory has `decay: 1.0`
- **WHEN** memory maintenance runs
- **THEN** the core-tier memory's `decay` SHALL remain `1.0`

#### Scenario: Patch to core decay ignored
- **WHEN** `memory-patch` is called to set `decay: 0.5` on a core-tier memory
- **THEN** the `decay` change SHALL be ignored
- **AND** the memory SHALL retain `decay: 1.0`

### Requirement: Backward Compatibility

Memories without a `decay` field SHALL default to `0.5` during loading and scoring.

#### Scenario: Legacy memory default decay
- **GIVEN** a memory event has no `decay` field
- **WHEN** the memory is loaded or scored during search
- **THEN** it SHALL be treated as `decay: 0.5`
