## Context

The AIr-Friends codebase has grown to 89 TypeScript source files with strong typing and consistent patterns. However, two structural issues have emerged from organic growth:

1. **Scheduler duplication**: 7 scheduler classes (`SpontaneousScheduler`, `SelfResearchScheduler`, `MemoryMaintenanceScheduler`, `GitBackupScheduler`, `ChannelLurkScheduler`, `AuditRetentionScheduler`, `ReminderScheduler`) each re-implement identical lifecycle logic — timer management, concurrency guards, state persistence, start/stop methods — totaling ~500 lines of duplicated code.

2. **Session orchestrator bloat**: `session-orchestrator.ts` at 2573 lines contains 6+ `process*` methods that each repeat ~80 lines of identical boilerplate: workspace creation → session registration → audit writer creation → model resolution → agent interaction → metrics recording → cleanup.

3. **Unsafe type casts**: `processMemoryMaintenance` and `processSelfResearch` use `undefined as unknown as PlatformAdapter` to satisfy type requirements when no platform adapter exists.

## Goals / Non-Goals

**Goals:**
- Extract a `BaseScheduler<TCallback>` abstract class to eliminate duplicated scheduler lifecycle code
- Extract session lifecycle boilerplate in `SessionOrchestrator` into a shared `runAgentSession()` method
- Make `platformAdapter` properly optional where sessions don't require platform interaction
- Maintain 100% behavioral compatibility — no observable changes to external behavior
- Maintain test coverage above 75% threshold

**Non-Goals:**
- Splitting `SessionOrchestrator` into multiple strategy classes (future work)
- Refactoring `config-loader.ts` (862 lines) or other large files not covered by this change
- Adding new features or changing any external APIs
- Changing the scheduling strategies (random vs fixed interval)
- Modifying the `SchedulerStateStore` persistence mechanism

## Decisions

### Decision 1: Generic `BaseScheduler<TCallback>` with template method pattern

**Choice**: Create an abstract `BaseScheduler<TCallback>` class that encapsulates the common lifecycle (timer management, concurrency guard, state persistence, `start`/`stop`/`execute`/`scheduleNext`) and requires subclasses to implement only `getNextDelayMs()` and `isEnabled()`.

**Rationale**: All 7 schedulers share identical `execute()` flow (concurrency guard → callback → error handling → reschedule) and `start()`/`stop()` logic. The only meaningful variation is how the next delay is computed (random interval vs fixed interval) and what "enabled" means.

**Alternatives considered**:
- *Composition over inheritance*: A `SchedulerLifecycle` helper object that schedulers delegate to. Rejected because the schedulers have such identical structure that inheritance is a cleaner fit, and TypeScript abstract classes provide good compile-time enforcement.
- *Mixin pattern*: Rejected as overly complex for this case; the schedulers have a clear single-inheritance hierarchy.

**Design**:
```typescript
abstract class BaseScheduler<TCallback extends (...args: unknown[]) => Promise<void> | void> {
  protected callback: TCallback | null = null;
  protected timerId: number | null = null;
  protected started = false;
  protected isRunning = false;
  protected lastExecutedAt: Date | null = null;
  protected nextScheduledAt: Date | null = null;
  protected stateStore: SchedulerStateStore | null = null;
  protected logger: Logger;

  abstract getNextDelayMs(): number;
  abstract isEnabled(): boolean;
  protected abstract executeCallback(): Promise<void>;

  // Common: setCallback, setStateStore, start, stop, getStatus, scheduleNext, execute
}
```

**Special cases**:
- `SpontaneousScheduler`: Uses per-platform `Map<Platform, PlatformSchedulerState>` — will override `start()`/`stop()` to manage multiple timers but still use base `execute()` pattern per-platform
- `ChannelLurkScheduler`: Takes callback in constructor — will call `setCallback()` from constructor
- `ReminderScheduler`: No state persistence — will simply not call `setStateStore()`

### Decision 2: `runAgentSession()` template method in SessionOrchestrator

**Choice**: Extract a private `runAgentSession(params: SessionRunParams)` method that handles the 10-step common lifecycle, accepting a callback for the unique prompt-building and agent-interaction logic.

**Rationale**: The 6 `process*` methods share identical code for workspace setup, session registration, audit writing, model resolution, metrics, and cleanup. Only the middle section (context assembly, prompt building, agent interaction specifics) differs.

**Design**:
```typescript
interface SessionRunParams {
  sessionType: string;
  platform: string;
  userId: string;
  channelId: string;
  guildId?: string;
  isDm: boolean;
  messageId?: string;
  platformAdapter?: PlatformAdapter;  // Optional — not all sessions need it
  modelOverride?: string;
  yolo?: boolean;
  buildAndRunAgent: (context: SessionRunContext) => Promise<SessionRunResult>;
}

interface SessionRunContext {
  workspace: WorkspaceInfo;
  agentWorkspacePath: string;
  shellSessionId: string;
  auditWriter: SessionAuditWriter | null;
  resolvedModel: string;
  logger: Logger;
}
```

**Alternatives considered**:
- *Strategy pattern with separate classes per session type*: Would be cleaner for long-term extensibility but is a larger change. Can be done as a follow-up refactor. The `runAgentSession()` approach is a smaller, safer first step.
- *Middleware/pipeline pattern*: Over-engineered for this use case where the steps are always the same in the same order.

### Decision 3: Optional `platformAdapter` via proper typing

**Choice**: Make `platformAdapter` an optional parameter in `SessionRunParams` and the relevant internal types, eliminating the need for `undefined as unknown as PlatformAdapter` casts.

**Rationale**: `processMemoryMaintenance` and `processSelfResearch` legitimately don't have a platform adapter. The current double-cast is unsafe and misleading. Making it properly optional is type-safe and self-documenting.

## Risks / Trade-offs

- **[Risk] Behavioral regression in schedulers** → Mitigation: Every existing scheduler test must pass unchanged after refactoring. Add new tests for `BaseScheduler` directly.
- **[Risk] `SpontaneousScheduler` may not fit the base class cleanly** → Mitigation: Its per-platform timer pattern is unique; it may need to override more methods than other schedulers. Accept some override complexity rather than forcing a poor fit.
- **[Risk] Large diff in `session-orchestrator.ts`** → Mitigation: Keep `process*` methods as thin wrappers that call `runAgentSession()` with their specific `buildAndRunAgent` callback. The public API of each method remains unchanged.
- **[Trade-off] Inheritance vs composition for schedulers** → Accepted: Inheritance is simpler here since all schedulers share the exact same lifecycle. If future schedulers diverge significantly, composition can be introduced then.
