## Why

The codebase has grown organically to 89 source files with strong typing and consistent patterns overall, but two significant structural issues have emerged that increase maintenance burden and bug risk: (1) `session-orchestrator.ts` at 2573 lines contains 6+ `process*` methods that each repeat ~80 lines of identical session lifecycle boilerplate (workspace creation → session registration → audit writing → metrics → cleanup), and (2) 7 scheduler classes duplicate nearly identical fields (`timerId`, `isRunning`, `started`, `lastExecutedAt`, `nextScheduledAt`, `stateStore`) and lifecycle methods (`start`, `stop`, `execute`, `scheduleNext`, `setCallback`). Addressing these now prevents the duplication from compounding as new session types and schedulers are added.

## What Changes

- **Extract a `BaseScheduler` abstract class** that encapsulates the shared scheduler lifecycle (timer management, concurrency guards, state persistence, start/stop/execute/scheduleNext) and have all 7 scheduler classes extend it, reducing ~500 lines of duplicated code
- **Extract session lifecycle boilerplate in `SessionOrchestrator`** into a shared `runSession()` template method that handles the common 10-step setup/teardown pattern (workspace creation, session registration, audit writer creation, model resolution, metrics, cleanup), with each `process*` method providing only its unique prompt-building and agent-interaction logic via a callback or strategy
- **Eliminate unsafe `as unknown as PlatformAdapter` double casts** in `processMemoryMaintenance` and `processSelfResearch` by making `platformAdapter` properly optional in the session context type

## Capabilities

### New Capabilities
- `base-scheduler`: Abstract base class for all scheduler implementations, encapsulating shared timer lifecycle, concurrency guards, state persistence, and scheduling logic
- `session-lifecycle`: Shared session lifecycle orchestration pattern that extracts the common setup/teardown/audit/metrics boilerplate from SessionOrchestrator's process methods

### Modified Capabilities
- `spontaneous-posting`: Refactor `SpontaneousScheduler` to extend `BaseScheduler` while preserving its unique per-platform timer map
- `self-research`: Refactor `SelfResearchScheduler` to extend `BaseScheduler`
- `memory-maintenance`: Refactor `MemoryMaintenanceScheduler` to extend `BaseScheduler`
- `git-backup`: Refactor `GitBackupScheduler` to extend `BaseScheduler`
- `channel-lurk-reply`: Refactor `ChannelLurkScheduler` to extend `BaseScheduler` while preserving its unique adapter/channels dependencies
- `session-audit-log`: Refactor audit writer creation into the shared session lifecycle pattern
- `scheduled-reminders`: Refactor `ReminderScheduler` to extend `BaseScheduler`

## Impact

- **Code**: `src/core/session-orchestrator.ts` (major refactor), all 7 `src/core/*-scheduler.ts` files, new `src/core/base-scheduler.ts`, new session lifecycle helper
- **Types**: `src/types/` — optional `platformAdapter` in session context interfaces
- **Tests**: Existing scheduler and orchestrator tests must be updated; new tests for `BaseScheduler` and session lifecycle helper
- **APIs**: No external API changes — all changes are internal structural refactoring
- **Dependencies**: No new dependencies
- **Risk**: Medium — these are internal refactors with high test coverage requirements, but no behavioral changes to external interfaces
