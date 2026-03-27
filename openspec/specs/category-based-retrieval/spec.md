# Category-Based Retrieval

## Purpose

Adds a `category` field to memory entries and enables filtered retrieval by category, allowing the agent to perform targeted recall (e.g., "show all relationship memories").

## Requirements

### Requirement: Category Field Values

Each memory entry SHALL have a `category` field with one of the following values: `"fact"`, `"preference"`, `"episode"`, `"summary"`, `"relationship"`. The default category SHALL be `"fact"` when not specified.

#### Scenario: Agent specifies category on save
- **WHEN** the agent calls `memory-save` with `category: "preference"`
- **THEN** the saved memory event SHALL have `category: "preference"`

#### Scenario: Default category applied
- **WHEN** the agent calls `memory-save` without specifying `category`
- **THEN** the saved memory event SHALL have `category: "fact"`

### Requirement: Category Filter in memory-search

The `memory-search` skill SHALL accept an optional `category` parameter. When provided, search results SHALL be filtered to only include memories matching the specified category. When omitted, all categories SHALL be searched.

#### Scenario: Search filtered by category
- **GIVEN** a user has 5 "fact" memories and 3 "relationship" memories
- **WHEN** `memory-search` is called with `category: "relationship"`
- **THEN** only the 3 "relationship" memories SHALL be eligible for matching
- **AND** no "fact" memories SHALL appear in results

#### Scenario: Search without category filter
- **GIVEN** a user has memories across multiple categories
- **WHEN** `memory-search` is called without a `category` parameter
- **THEN** memories from all categories SHALL be eligible for matching

### Requirement: Agent Chooses Category on Save

The agent SHALL select the appropriate category when saving a memory via `memory-save`. The skill SHALL validate that the provided category is one of the allowed values.

#### Scenario: Invalid category rejected
- **WHEN** the agent calls `memory-save` with `category: "invalid_type"`
- **THEN** the system SHALL return an error indicating the category is not valid

#### Scenario: Valid category accepted
- **WHEN** the agent calls `memory-save` with `category: "episode"`
- **THEN** the memory SHALL be saved with `category: "episode"`

### Requirement: Per-Category Counts in memory-stats

The `memory-stats` skill SHALL report memory counts grouped by category, in addition to existing per-visibility counts.

#### Scenario: Stats include category breakdown
- **GIVEN** a workspace has 10 "fact", 5 "preference", 3 "episode", 7 "summary", and 2 "relationship" memories
- **WHEN** `memory-stats` is called
- **THEN** the response SHALL include per-category counts: `fact: 10`, `preference: 5`, `episode: 3`, `summary: 7`, `relationship: 2`

#### Scenario: Stats include both visibility and category
- **WHEN** `memory-stats` is called
- **THEN** the response SHALL include per-visibility counts (existing behavior)
- **AND** per-category counts (new behavior)

### Requirement: Backward Compatibility for Legacy Memories

Memories without a `category` field SHALL default to `"fact"` during loading and search.

#### Scenario: Legacy memory defaults to fact
- **GIVEN** a memory event has no `category` field
- **WHEN** the memory is loaded or searched
- **THEN** it SHALL be treated as `category: "fact"`
