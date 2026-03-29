## 1. BaseScheduler Abstract Class

- [x] 1.1 Create `src/core/base-scheduler.ts` with abstract `BaseScheduler<TCallback>` class implementing shared lifecycle: timer management, concurrency guards, `start()`/`stop()`/`execute()`/`scheduleNext()`/`getStatus()`/`setCallback()`/`setStateStore()`, with abstract methods `getNextDelayMs()`, `isEnabled()`, `executeCallback()`
- [x] 1.2 Write unit tests for `BaseScheduler` in `tests/core/base-scheduler.test.ts` covering: start/stop, double-start prevention, concurrency guard, error handling in callback, state persistence, restored state, status reporting
- [x] 1.3 Export `BaseScheduler` from `src/core/mod.ts`

## 2. Refactor Schedulers to Extend BaseScheduler

- [x] 2.1 Refactor `GitBackupScheduler` to extend `BaseScheduler`, implementing `getNextDelayMs()` (fixed interval), `isEnabled()`, and `executeCallback()`, preserving immediate-first-execution behavior
- [x] 2.2 Refactor `AuditRetentionScheduler` to extend `BaseScheduler`, implementing fixed 24h interval
- [x] 2.3 Refactor `MemoryMaintenanceScheduler` to extend `BaseScheduler`, implementing fixed interval
- [x] 2.4 Refactor `SelfResearchScheduler` to extend `BaseScheduler`, implementing random interval
- [x] 2.5 Refactor `ReminderScheduler` to extend `BaseScheduler`, preserving no-state-persistence behavior
- [x] 2.6 Refactor `ChannelLurkScheduler` to extend `BaseScheduler`, preserving constructor-injected callback and channel-check logic
- [x] 2.7 Refactor `SpontaneousScheduler` to extend `BaseScheduler`, preserving per-platform `Map<Platform, PlatformSchedulerState>` timer management
- [x] 2.8 Verify all existing scheduler tests pass without modification (or with minimal test updates for constructor changes)

## 3. Session Lifecycle Extraction

- [x] 3.1 Define `SessionRunParams` and `SessionRunContext` interfaces in `src/types/` or inline in `session-orchestrator.ts`
- [x] 3.2 Make `platformAdapter` optional in `SessionRunParams` — remove `undefined as unknown as PlatformAdapter` casts from `processMemoryMaintenance` and `processSelfResearch`
- [x] 3.3 Extract `runAgentSession()` private method in `SessionOrchestrator` implementing the shared 10-step lifecycle: workspace creation → session registration → audit writer → trigger_received audit → model resolution → session_start audit → callback invocation → metrics → cleanup → completed session store
- [x] 3.4 Refactor `processMessageInternal` to delegate to `runAgentSession()` with message-specific `buildAndRunAgent` callback
- [x] 3.5 Refactor `processSpontaneousPost` to delegate to `runAgentSession()` with spontaneous-specific callback
- [x] 3.6 Refactor `processSelfResearch` to delegate to `runAgentSession()` without `platformAdapter`
- [x] 3.7 Refactor `processMemoryMaintenance` to delegate to `runAgentSession()` without `platformAdapter`
- [x] 3.8 Refactor `processChannelMemoryMaintenance` to delegate to `runAgentSession()`
- [x] 3.9 Refactor `processReminder` to delegate to `runAgentSession()`
- [x] 3.10 Verify all existing orchestrator tests pass

## 4. Validation and Cleanup

- [x] 4.1 Run `deno fmt src/ tests/` and `deno lint src/ tests/` to ensure code style compliance
- [x] 4.2 Run `deno check src/main.ts` to verify type checking passes
- [x] 4.3 Run full test suite (`deno task test`) and verify coverage remains above 75%
- [x] 4.4 Remove any dead code left from the refactoring (unused imports, duplicate type definitions)
