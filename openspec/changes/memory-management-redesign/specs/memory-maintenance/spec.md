# Memory Maintenance (Delta)

Modifies: `openspec/specs/memory-maintenance/spec.md`

## Purpose

Extends the existing memory maintenance capability with working-tier summary consolidation, importance decay adjustment, and channel memory maintenance support.

## MODIFIED Requirements

### Requirement: Uses Existing Memory Skills

The agent SHALL use existing memory skills (`memory-search`, `memory-save`, `memory-patch`) to perform maintenance operations. No special maintenance-only skills are required.

In addition to existing summarization, the agent SHALL:
1. Consolidate older working-tier summaries into archive-tier entries
2. Adjust decay values for archive-tier entries
3. Process channel memory workspaces using the same rules

#### Scenario: Agent summarizes memories
- **GIVEN** the agent identifies a group of related memories
- **WHEN** the agent performs summarization
- **THEN** `memory-save` is used to create the summary entry
- **AND** `memory-patch` is used to disable the original memories

#### Scenario: Agent consolidates working-tier summaries
- **GIVEN** the agent identifies working-tier summaries older than the consolidation threshold
- **WHEN** the agent performs summary consolidation
- **THEN** `memory-save` is used to create a consolidated archive-tier entry with `tier: "archive"` and `category: "summary"`
- **AND** `memory-patch` is used to disable the original working-tier summaries
- **AND** the consolidated entry SHALL include `supersedes` referencing original summary IDs

### Requirement: Summary Consolidation

During maintenance, the agent SHALL consolidate working-tier summary entries. Summaries older than a configurable threshold (determined by the agent) SHALL be grouped by time proximity or topic similarity, merged into fewer archive-tier entries, and the originals disabled.

#### Scenario: Working summaries consolidated to archive
- **GIVEN** a workspace has 15 working-tier summaries, 10 of which are older than 7 days
- **WHEN** memory maintenance runs
- **THEN** the agent SHALL create consolidated archive-tier summary entries
- **AND** the original 10 working-tier summaries SHALL be disabled via `memory-patch`
- **AND** the working-tier summary count SHALL decrease

#### Scenario: Recent summaries preserved
- **GIVEN** a workspace has 5 working-tier summaries all created within the last 2 days
- **WHEN** memory maintenance runs
- **THEN** those summaries SHALL NOT be consolidated
- **AND** they SHALL remain as working-tier entries

### Requirement: Decay Value Adjustment

During maintenance, the agent SHALL adjust `decay` values for archive-tier entries that have not been accessed since the last maintenance cycle. The adjustment formula SHALL be: `new_decay = current_decay * 0.95`.

Core-tier memories SHALL NOT have their decay adjusted (pinned at 1.0). Working-tier memories SHALL NOT have their decay adjusted by maintenance.

#### Scenario: Archive decay reduced
- **GIVEN** 20 archive-tier memories with `decay: 0.5` have not been accessed
- **WHEN** memory maintenance runs
- **THEN** each SHALL receive a `memory-patch` setting `decay: 0.475`

#### Scenario: Core decay unchanged
- **GIVEN** 5 core-tier memories exist
- **WHEN** memory maintenance runs
- **THEN** their `decay` values SHALL remain `1.0`
- **AND** no `memory-patch` for decay SHALL be issued for core-tier entries

#### Scenario: Working tier decay unchanged
- **GIVEN** 10 working-tier memories exist
- **WHEN** memory maintenance runs
- **THEN** their `decay` values SHALL NOT be adjusted by the maintenance cycle

### Requirement: Channel Memory Maintenance

The maintenance process SHALL also scan and process channel memory workspaces (`data/workspaces/{platform}/channels/*/`) using the same rules as user workspaces: threshold check, summary consolidation, and decay adjustment.

#### Scenario: Channel workspace processed
- **GIVEN** channel `ch-456` has 60 enabled memories and `minMemoryCount` is 50
- **WHEN** the maintenance callback runs
- **THEN** `processMemoryMaintenance()` SHALL be executed for channel `ch-456`

#### Scenario: Channel workspace skipped below threshold
- **GIVEN** channel `ch-789` has 20 enabled memories and `minMemoryCount` is 50
- **WHEN** the maintenance callback runs
- **THEN** channel `ch-789` SHALL be skipped

### Requirement: Workspace Scanning with Threshold

The maintenance callback SHALL scan all user workspaces AND all channel workspaces. Workspaces with enabled memory count below `minMemoryCount` SHALL be skipped.

#### Scenario: Skip low-memory workspace
- **GIVEN** a workspace has 30 enabled memories and `minMemoryCount` is 50
- **WHEN** the maintenance callback runs
- **THEN** that workspace is skipped without creating an ACP session

#### Scenario: Process workspace above threshold
- **GIVEN** a workspace has 60 enabled memories and `minMemoryCount` is 50
- **WHEN** the maintenance callback runs
- **THEN** `processMemoryMaintenance()` is executed for that workspace

### Requirement: Per-Workspace Failure Isolation

Failures during maintenance of one workspace SHALL NOT prevent processing of other workspaces. This applies to both user workspaces and channel workspaces. Errors are caught, logged, and the next workspace is processed.

#### Scenario: Isolated failure across workspace types
- **GIVEN** maintenance fails for user workspace A and channel workspace B
- **WHEN** the callback continues to user workspace C
- **THEN** workspace C is still processed
- **AND** errors for workspaces A and B are logged
- **AND** the application remains healthy
