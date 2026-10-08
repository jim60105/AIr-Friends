# Tiered Context Loading

## Purpose

Defines how memory tiers (core, working, archive) are loaded into session context. Core memories are always fully loaded, working memories are bounded by a configurable limit, and archive memories are only accessible via explicit search.

## Requirements

### Requirement: Backward Compatibility for Legacy Memories

Memories without a `tier` field SHALL default to `tier: "archive"` during loading. This ensures pre-migration memories are not auto-loaded into context but remain searchable.

#### Scenario: Legacy memory treated as archive
- **GIVEN** a memory event has no `tier` field
- **WHEN** context assembly runs
- **THEN** the memory SHALL be treated as `tier: "archive"`
- **AND** it SHALL NOT be included in the initial context
- **AND** it SHALL be searchable via `memory-search`

### Requirement: Core Tier Loaded Within Token Budget

Only tier decides fixed loading; `importance` SHALL NOT cause fixed loading. Enabled core-tier memories (`tier: "core"`) SHALL be loaded at startup within the `memory.recall.coreMaxTokens` budget (default 512), user memories before channel memories, each in `createdAt` ascending order. A memory SHALL be added only if its rendered line fits the remaining budget; later memories SHALL still be considered.

#### Scenario: Core memories within budget all loaded
- **GIVEN** a user has 15 enabled core-tier memories totaling 300 estimated tokens
- **WHEN** context assembly runs
- **THEN** all 15 core-tier memories SHALL be included, sorted by `createdAt` ascending

#### Scenario: Core memories over budget
- **GIVEN** a user's enabled core-tier memories total 900 estimated tokens
- **WHEN** context assembly runs with `coreMaxTokens: 512`
- **THEN** the injected core memories SHALL total at most 512 estimated tokens
- **AND** the skipped core memories SHALL be eligible for Fast Recall in the same session

#### Scenario: High importance outside core tier is not fixed-loaded
- **GIVEN** a memory with `importance: "high"` and `tier: "archive"`
- **WHEN** context assembly runs
- **THEN** the memory SHALL NOT be loaded by fixed tier loading
- **AND** it SHALL be reachable only through retrieval, where importance contributes a ranking bonus

#### Scenario: Disabled core memories excluded
- **GIVEN** a user has 5 core-tier memories, 2 of which are disabled
- **WHEN** context assembly runs
- **THEN** only the 3 enabled core-tier memories SHALL be considered for loading

#### Scenario: Skipped core memories remain reachable
- **GIVEN** a core-tier memory was skipped because it did not fit the remaining token budget
- **WHEN** context assembly runs
- **THEN** the memory SHALL keep its `tier: "core"`
- **AND** it SHALL remain reachable through Fast Recall and `memory-search`

### Requirement: Working Tier Loads Newest Entries Within Budget

The system SHALL load the newest enabled working-tier memories (`tier: "working"`) at session start, taking at most `memory.recall.workingMaxItems` (default 4) newest candidates by `createdAt`, keeping each one whose rendered line fits the remaining `memory.recall.workingMaxTokens` budget (default 384), and presenting the selected memories in chronological order. `memory.workingTierLimit` SHALL NOT control injection.

#### Scenario: Default working selection
- **GIVEN** a user has 25 enabled working-tier memories of 50 estimated tokens each
- **WHEN** context assembly runs with default configuration
- **THEN** the 4 newest working-tier memories SHALL be loaded

#### Scenario: Custom working item limit
- **GIVEN** `memory.recall.workingMaxItems` is set to 2
- **AND** a user has 25 enabled working-tier memories
- **WHEN** context assembly runs
- **THEN** at most the 2 newest working-tier memories SHALL be loaded

#### Scenario: Working token budget enforced
- **GIVEN** the 4 newest working-tier memories total 600 estimated tokens
- **WHEN** context assembly runs with `workingMaxTokens: 384`
- **THEN** the injected working memories SHALL total at most 384 estimated tokens

#### Scenario: workingTierLimit does not affect injection
- **GIVEN** `memory.workingTierLimit` is 20 and `memory.recall.workingMaxItems` is 4
- **WHEN** context assembly runs for a user with 10 working memories
- **THEN** at most 4 working memories SHALL be injected

#### Scenario: Channel working memories merged before selection
- **GIVEN** a channel context with both user and channel working-tier memories
- **WHEN** context assembly runs
- **THEN** the user's and the channel's working memories SHALL be merged before selecting the newest candidates

#### Scenario: Skipped working candidates not replaced
- **GIVEN** a candidate working-tier memory exceeds the remaining token budget and is skipped
- **WHEN** context assembly walks the candidates from newest to oldest
- **THEN** older candidates beyond the first `workingMaxItems` SHALL NOT replace the skipped one

#### Scenario: Non-injected working memories remain reachable
- **GIVEN** a working-tier memory was not injected due to the item or token budget
- **WHEN** context assembly runs
- **THEN** the memory SHALL keep its `tier: "working"`
- **AND** it SHALL remain reachable through Fast Recall and `memory-search`

### Requirement: Archive Tier Retrieval-Only

Archive-tier memories (`tier: "archive"`) SHALL NOT be loaded by fixed tier loading at session start. They SHALL be reachable only through retrieval: automatic Fast Recall when they clear its confidence thresholds, and explicit `memory-search` calls by the agent.

#### Scenario: Archive memories excluded from fixed loading
- **GIVEN** a user has 100 archive-tier memories
- **WHEN** context assembly runs
- **THEN** zero archive-tier memories SHALL be included by fixed tier loading

#### Scenario: Archive memory surfaced by Fast Recall
- **GIVEN** an archive-tier memory is the only eligible memory and scores above `minRecallScore` for the trigger message
- **WHEN** context assembly runs
- **THEN** the memory SHALL appear in the Fast Recall section
- **AND** it SHALL NOT appear in the fixed core or working sections

#### Scenario: Archive memories searchable
- **GIVEN** a user has archive-tier memories containing "vacation plans"
- **WHEN** the agent calls `memory-search` with query "vacation plans"
- **THEN** matching archive-tier memories SHALL be returned

### Requirement: Channel Memories Share Fixed Budgets

In a channel context, the system SHALL consider the channel's enabled core-tier and working-tier memories together with the user's, under the core and working budgets defined in this capability. Channel archive-tier memories SHALL NOT be loaded by fixed tier loading.

#### Scenario: Channel and user core memories within budget
- **GIVEN** channel `ch-456` has 3 core-tier channel memories and the user has 5 core-tier memories
- **AND** all 8 total fewer than 512 estimated tokens
- **WHEN** context assembly runs in channel `ch-456`
- **THEN** all 8 core-tier memories SHALL be loaded, user memories before channel memories

#### Scenario: Channel and user working memories merged
- **GIVEN** channel `ch-456` has 5 working-tier memories and the user has 5 working-tier memories
- **WHEN** context assembly runs in channel `ch-456` with default configuration
- **THEN** the 4 newest working-tier memories across both sources SHALL be selected, subject to the token budget

#### Scenario: Channel archive memories not auto-loaded
- **GIVEN** channel `ch-456` has 10 archive-tier channel memories
- **WHEN** context assembly runs in channel `ch-456`
- **THEN** archive-tier channel memories SHALL NOT be loaded by fixed tier loading
