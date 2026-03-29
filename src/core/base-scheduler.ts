// src/core/base-scheduler.ts

import { createLogger } from "@utils/logger.ts";
import type { SchedulerStateStore } from "@core/scheduler-state-store.ts";
import { resolveScheduleTime } from "@core/scheduler-state-store.ts";
import type { Logger } from "@utils/logger.ts";

/**
 * Abstract base class for all schedulers, encapsulating shared lifecycle:
 * timer management, concurrency guards, state persistence, start/stop.
 *
 * Subclasses implement:
 * - `isEnabled()`: whether the scheduler should run
 * - `getNextDelayMs()`: scheduling interval (fixed or random)
 * - `executeCallback()`: the actual work to perform
 * - `getSchedulerName()`: unique name for logging and state persistence
 * - `getMaxIntervalMs()`: max interval for restored state validation
 */
export abstract class BaseScheduler {
  protected timerId: number | null = null;
  protected started = false;
  protected isRunning = false;
  protected lastExecutedAt: Date | null = null;
  protected nextScheduledAt: Date | null = null;
  protected stateStore: SchedulerStateStore | null = null;
  protected logger: Logger;

  constructor() {
    this.logger = createLogger(this.constructor.name);
  }

  /** Whether the scheduler is enabled based on configuration. */
  protected abstract isEnabled(): boolean;

  /** Compute the next scheduling delay in milliseconds. */
  protected abstract getNextDelayMs(): number;

  /** Execute the scheduler's callback. */
  protected abstract executeCallback(): Promise<void>;

  /** Unique key for state persistence (e.g., "gitBackup", "selfResearch"). */
  protected abstract getStateKey(): string;

  /** Max interval for restored state validation. */
  protected abstract getMaxIntervalMs(): number;

  /**
   * Set the state store for persisting schedule times.
   */
  setStateStore(store: SchedulerStateStore): void {
    this.stateStore = store;
  }

  /**
   * Start the scheduler with optional restored state.
   */
  start(restoredState?: Record<string, string>): void {
    if (!this.isEnabled()) {
      this.logger.info("{name} is disabled", { name: this.constructor.name });
      return;
    }
    if (this.started) {
      this.logger.warn("{name} already started", { name: this.constructor.name });
      return;
    }
    this.started = true;

    const stateKey = this.getStateKey();
    const restoredNextAt = restoredState?.[stateKey]
      ? new Date(restoredState[stateKey])
      : undefined;

    if (restoredNextAt && !isNaN(restoredNextAt.getTime())) {
      const { delayMs, nextAt } = resolveScheduleTime(
        restoredNextAt,
        this.getNextDelayMs(),
        this.getMaxIntervalMs(),
        () => this.getNextDelayMs(),
      );
      this.nextScheduledAt = nextAt;
      this.stateStore?.save(stateKey, nextAt);

      if (delayMs === 0) {
        this.execute();
      } else {
        this.timerId = setTimeout(() => this.execute(), delayMs);
      }
    } else {
      this.onFirstStart();
    }

    this.onStarted();
  }

  /**
   * Stop the scheduler and clean up the timer.
   */
  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.started = false;
    this.nextScheduledAt = null;
    this.logger.info("{name} stopped", { name: this.constructor.name });
  }

  /**
   * Get the current operational status.
   */
  getStatus(): {
    isRunning: boolean;
    lastExecutedAt: Date | null;
    nextScheduledAt: Date | null;
  } {
    return {
      isRunning: this.isRunning,
      lastExecutedAt: this.lastExecutedAt,
      nextScheduledAt: this.nextScheduledAt,
    };
  }

  /**
   * Called on first start with no restored state.
   * Default: schedule next execution. Override to execute immediately.
   */
  protected onFirstStart(): void {
    this.scheduleNext();
  }

  /**
   * Called after start() completes (for subclass logging).
   * Default: no-op.
   */
  protected onStarted(): void {}

  /**
   * Schedule the next execution.
   */
  protected scheduleNext(): void {
    if (!this.started) return;
    const delayMs = this.getNextDelayMs();
    this.nextScheduledAt = new Date(Date.now() + delayMs);

    const stateKey = this.getStateKey();
    this.stateStore?.save(stateKey, this.nextScheduledAt);

    this.logger.info("Next {name} scheduled at {nextAt}", {
      name: this.constructor.name,
      nextAt: this.nextScheduledAt.toISOString(),
    });
    this.timerId = setTimeout(() => this.execute(), delayMs);
  }

  /**
   * Execute the callback with concurrency guard and error handling.
   */
  protected async execute(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("{name} already running, skipping", { name: this.constructor.name });
      this.scheduleNext();
      return;
    }
    this.isRunning = true;
    this.timerId = null;
    try {
      await this.executeCallback();
      this.lastExecutedAt = new Date();
    } catch (error) {
      this.logger.error("{name} execution failed", {
        name: this.constructor.name,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isRunning = false;
      if (this.started) {
        this.scheduleNext();
      }
    }
  }
}
