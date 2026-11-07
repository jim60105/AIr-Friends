# identity-linked-recall Specification

## Purpose
Defines how memory read paths combine the memories of every account in the current account's identity group into one unattributed population, and the DM-only boundary for linked private memories.

## Requirements

### Requirement: Linked Memory Sources in Retrieval

Recall SHALL add the public memory file of every linked workspace, and their private files only when the current session is a DM, to the same ranking population as the current account's memories. Results SHALL carry no source attribution.

#### Scenario: Linked public memory recalled
- **GIVEN** account A and account B are in one identity group and A has a public memory matching the query
- **WHEN** recall runs for B in a guild channel
- **THEN** A's memory SHALL be returned in the same result shape as B's own memories

#### Scenario: Linked private memory only in DM
- **GIVEN** A and B are linked and A has a private memory matching the query
- **WHEN** recall runs for B in a guild channel, and again for B in a DM
- **THEN** the guild-channel result SHALL NOT contain it and the DM result SHALL contain it

#### Scenario: Relations work across accounts
- **GIVEN** B's memory supersedes A's memory, and another B memory lists an A memory in `relatedTo`
- **WHEN** Fast Recall runs without a historical hint
- **THEN** A's superseded memory SHALL NOT be eligible and the related A memory SHALL receive the relation bonus

#### Scenario: Exclusion applies across accounts
- **WHEN** an A memory id is in the request's exclusion set
- **THEN** it SHALL NOT be returned to B

#### Scenario: Unlinked account unchanged
- **WHEN** recall runs with an empty linked-workspace list
- **THEN** its memories, scores and notes SHALL equal those of the same request with no linked-workspace list

### Requirement: Linked Source Robustness

A linked source whose memory file is missing SHALL contribute nothing, and a linked source that fails to load SHALL be skipped without failing recall. A linked memory whose id already appeared from an earlier source SHALL be dropped.

#### Scenario: Missing linked workspace
- **GIVEN** a linked account whose workspace directory does not exist
- **WHEN** recall runs
- **THEN** recall SHALL succeed with the current account's results and the directory SHALL still not exist

#### Scenario: Unreadable linked source skipped
- **GIVEN** loading one linked account's memory file throws
- **WHEN** recall runs
- **THEN** recall SHALL return results from the other sources

#### Scenario: Duplicate id resolved by source order
- **GIVEN** the current account and a linked account each hold a memory with the same id
- **WHEN** recall runs
- **THEN** the id SHALL appear at most once and the returned memory SHALL be the current account's

### Requirement: Fixed Loading Across Linked Accounts

Session-start fixed loading, for both triggered and spontaneous sessions, SHALL select core and working memories from the current and linked workspaces together under the existing single core and working budgets; linked private memories SHALL be candidates only in a DM.

#### Scenario: Linked core memory injected
- **GIVEN** A and B are linked and A has an enabled core-tier public memory
- **WHEN** context is assembled for B
- **THEN** the assembled core memories SHALL include A's memory

#### Scenario: Budgets shared
- **GIVEN** A and B together hold more working-tier memories than `workingMaxItems`
- **WHEN** context is assembled for B
- **THEN** at most `workingMaxItems` working memories SHALL be selected in total, newest first across both accounts

#### Scenario: Spontaneous session merges
- **WHEN** spontaneous context is assembled for B
- **THEN** its core and working memories SHALL include A's eligible memories

#### Scenario: Linked failure does not fail assembly
- **GIVEN** loading A's memories throws
- **WHEN** context is assembled for B
- **THEN** assembly SHALL succeed with B's own memories

#### Scenario: Fast Recall excludes injected linked memories
- **GIVEN** A's memory was injected by fixed loading
- **WHEN** Fast Recall runs in the same assembly
- **THEN** that memory SHALL NOT appear in the Fast Recall result

### Requirement: Deep Recall Skill Uses Linked Sources

The `memory-search` skill SHALL search the linked workspaces of the session's account with the same rules as Fast Recall; `memory-save`, `memory-stats` and `memory-export` SHALL operate on the current account only.

#### Scenario: memory-search returns linked memory
- **GIVEN** A and B are linked and A has a public memory matching the query
- **WHEN** B's session calls `memory-search`
- **THEN** the result SHALL include A's memory

#### Scenario: Save, stats and export stay local
- **WHEN** B's session calls `memory-save`, `memory-stats` and `memory-export`
- **THEN** the save SHALL append only to B's file and stats and export SHALL count and list only B's memories

### Requirement: Identity Registry Wiring

The application SHALL build one identity registry from the loaded `identities` configuration at startup and use it for fixed loading, Fast Recall and `memory-search`.

#### Scenario: Configured groups reach the read paths
- **GIVEN** a configuration with one identity group of two accounts
- **WHEN** the application core is constructed
- **THEN** its identity registry SHALL report one group and a `memory-search` call through its skill registry for one account SHALL return the other account's matching memory
