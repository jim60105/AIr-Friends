# Memory Maintenance

## Purpose

Enables periodic, agent-driven memory summarization and compaction per user workspace to control long-term memory growth. The agent uses existing memory skills to summarize groups of memories, save consolidated entries, and disable originals — preserving the append-only guarantee.

## Requirements

### Requirement: Fixed-Interval Scheduling

The `MemoryMaintenanceScheduler` SHALL trigger maintenance at a fixed interval (default 604,800,000 ms / 7 days, configurable via `memoryMaintenance.intervalMs`).

#### Scenario: Default interval
- **GIVEN** no custom `intervalMs` is configured
- **WHEN** the scheduler starts
- **THEN** the maintenance interval defaults to 604,800,000 ms (7 days)

#### Scenario: Reschedule after execution
- **GIVEN** a maintenance cycle completes (success or failure)
- **WHEN** the scheduler determines the next execution
- **THEN** the next execution is scheduled at the same fixed interval

### Requirement: Default Configuration

The system SHALL apply the following defaults when `memoryMaintenance` is not defined in config:

| Setting          | Default Value  |
| ---------------- | -------------- |
| `enabled`        | `false`        |
| `model`          | `"gpt-5-mini"` |
| `minMemoryCount` | `50`           |
| `intervalMs`     | `604800000`    |

#### Scenario: Defaults applied
- **GIVEN** config.yaml does not define `memoryMaintenance`
- **WHEN** the configuration is loaded
- **THEN** all default values are applied

### Requirement: Disabled by Default

The scheduler SHALL NOT start when `memoryMaintenance.enabled` is `false`.

#### Scenario: Disabled
- **GIVEN** `memoryMaintenance.enabled` is `false`
- **WHEN** `start()` is called
- **THEN** no timer is created and an info log "Memory maintenance is disabled" is emitted

### Requirement: Workspace Scanning with Threshold

The maintenance callback SHALL scan all user workspaces. Workspaces with enabled memory count below `minMemoryCount` SHALL be skipped.

#### Scenario: Skip low-memory workspace
- **GIVEN** a workspace has 30 enabled memories and `minMemoryCount` is 50
- **WHEN** the maintenance callback runs
- **THEN** that workspace is skipped without creating an ACP session

#### Scenario: Process workspace above threshold
- **GIVEN** a workspace has 60 enabled memories and `minMemoryCount` is 50
- **WHEN** the maintenance callback runs
- **THEN** `processMemoryMaintenance()` is executed for that workspace

### Requirement: One ACP Session Per Workspace

The system SHALL create one ACP agent session per workspace that meets the threshold. Each session uses the model specified in `memoryMaintenance.model`.

#### Scenario: Per-workspace session
- **GIVEN** three workspaces exceed the memory threshold
- **WHEN** maintenance runs
- **THEN** three separate ACP sessions are created, one per workspace

#### Scenario: Configured model
- **GIVEN** `memoryMaintenance.model` is `"gpt-5-mini"`
- **WHEN** an ACP session is created for maintenance
- **THEN** the session model is set to `"gpt-5-mini"`

### Requirement: Uses Existing Memory Skills

The agent SHALL use existing memory skills (`memory-search`, `memory-save`, `memory-patch`) to perform maintenance operations. No special maintenance-only skills are required.

#### Scenario: Agent summarizes memories
- **GIVEN** the agent identifies a group of related memories
- **WHEN** the agent performs summarization
- **THEN** `memory-save` is used to create the summary entry
- **AND** `memory-patch` is used to disable the original memories

### Requirement: Append-Only Preservation

Original memories SHALL NOT be deleted. They SHALL be disabled via `memory-patch` (setting `enabled: false`). The original memory events remain in the JSONL log files.

#### Scenario: Disable originals
- **GIVEN** memories `mem1`, `mem2`, `mem3` are summarized
- **WHEN** maintenance completes
- **THEN** patch events with `enabled: false` are appended for `mem1`, `mem2`, `mem3`
- **AND** the original memory events are still present in the JSONL file

### Requirement: Supersedes Lineage Tracking

Summary entries created via `memory-save` SHALL include `supersedes` field listing the IDs of the original memories they replace. This preserves the summarization lineage.

#### Scenario: Supersession recorded
- **GIVEN** the agent summarizes memories `mem1`, `mem2`, `mem3`
- **WHEN** the summary is saved via `memory-save`
- **THEN** the new entry contains `supersedes: ["mem1", "mem2", "mem3"]`

### Requirement: Per-Workspace Failure Isolation

Failures during maintenance of one workspace SHALL NOT prevent processing of other workspaces. Errors are caught, logged, and the next workspace is processed.

#### Scenario: Isolated failure
- **GIVEN** maintenance fails for workspace A
- **WHEN** the callback continues to workspace B and C
- **THEN** workspaces B and C are still processed
- **AND** the error for workspace A is logged
- **AND** the application remains healthy

### Requirement: Session Type

Memory maintenance sessions SHALL use session type `"memory-maintenance"`.

#### Scenario: Session type
- **GIVEN** a memory maintenance session is triggered
- **WHEN** `SessionOrchestrator.processMemoryMaintenance()` is called
- **THEN** the session type is `"memory-maintenance"`

### Requirement: Concurrent Execution Guard

The scheduler SHALL skip execution if a previous maintenance cycle is still running, and schedule the next cycle.

#### Scenario: Overlapping execution
- **GIVEN** a maintenance cycle is in progress (`isRunning === true`)
- **WHEN** the timer fires again
- **THEN** the execution is skipped with a warning log
- **AND** the next timer is scheduled

### Requirement: Error Resilience

Maintenance execution failures SHALL be caught and logged. The scheduler SHALL always reschedule. Errors SHALL NOT crash the bot.

#### Scenario: Execution failure
- **GIVEN** the maintenance callback throws an error
- **WHEN** the error is caught
- **THEN** the error is logged
- **AND** the next cycle is scheduled normally

### Requirement: Lifecycle Management

The scheduler SHALL support `start()`, `stop()`, and `getStatus()` methods. Calling `start()` twice SHALL be a no-op (guarded by `started` flag).

#### Scenario: Double start prevention
- **GIVEN** the scheduler is already started
- **WHEN** `start()` is called again
- **THEN** no duplicate timer is created

#### Scenario: Graceful stop
- **GIVEN** the scheduler is running
- **WHEN** `stop()` is called
- **THEN** the timer is cleared, `started` is `false`, and `nextScheduledAt` is `null`

### Requirement: Environment Variable Overrides

The following environment variables SHALL override the corresponding config values:

| Environment Variable                  | Config Path                        |
| ------------------------------------- | ---------------------------------- |
| `MEMORY_MAINTENANCE_ENABLED`          | `memoryMaintenance.enabled`        |
| `MEMORY_MAINTENANCE_MODEL`            | `memoryMaintenance.model`          |
| `MEMORY_MAINTENANCE_MIN_MEMORY_COUNT` | `memoryMaintenance.minMemoryCount` |
| `MEMORY_MAINTENANCE_INTERVAL_MS`      | `memoryMaintenance.intervalMs`     |

#### Scenario: Override via environment
- **GIVEN** `MEMORY_MAINTENANCE_ENABLED=true` and `MEMORY_MAINTENANCE_MIN_MEMORY_COUNT=80`
- **WHEN** the configuration is loaded
- **THEN** maintenance is enabled with threshold 80

### Requirement: State Persistence

The scheduler SHALL persist its next scheduled time via `SchedulerStateStore`. On restart, a restored schedule time is honored via `resolveScheduleTime()`.

#### Scenario: Restored schedule time
- **GIVEN** the persisted `memoryMaintenance` schedule time has already elapsed
- **WHEN** the scheduler starts with restored state
- **THEN** execution runs immediately
