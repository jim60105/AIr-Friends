import { createLogger } from "@utils/logger.ts";
import type { GitBackupConfig } from "../types/config.ts";
import type { SchedulerStateStore } from "@core/scheduler-state-store.ts";
import { resolveScheduleTime } from "@core/scheduler-state-store.ts";

const logger = createLogger("GitBackupScheduler");

export type GitBackupCallback = () => Promise<void>;

/**
 * Manages fixed-interval Git backup execution.
 */
export class GitBackupScheduler {
  private config: GitBackupConfig;
  private callback: GitBackupCallback | null = null;
  private timerId: number | null = null;
  private started = false;
  private isRunning = false;
  private lastExecutedAt: Date | null = null;
  private nextScheduledAt: Date | null = null;
  private stateStore: SchedulerStateStore | null = null;

  constructor(config: GitBackupConfig) {
    this.config = config;
  }

  setCallback(callback: GitBackupCallback): void {
    this.callback = callback;
  }

  /**
   * Set the state store for persisting schedule times.
   */
  setStateStore(store: SchedulerStateStore): void {
    this.stateStore = store;
  }

  start(restoredState?: Record<string, string>): void {
    if (!this.config.enabled) {
      logger.info("Git backup is disabled");
      return;
    }
    if (this.started) return;
    this.started = true;
    logger.info("Git backup scheduler started", {
      intervalMs: this.config.intervalMs,
    });

    const restoredNextAt = restoredState?.["gitBackup"]
      ? new Date(restoredState["gitBackup"])
      : undefined;

    if (restoredNextAt && !isNaN(restoredNextAt.getTime())) {
      const { delayMs, nextAt } = resolveScheduleTime(
        restoredNextAt,
        this.config.intervalMs,
        this.config.intervalMs,
        () => this.config.intervalMs,
      );
      this.nextScheduledAt = nextAt;
      this.stateStore?.save("gitBackup", nextAt);

      if (delayMs === 0) {
        this.execute();
      } else {
        this.timerId = setTimeout(() => this.execute(), delayMs);
      }
    } else {
      // No restored state — execute immediately (current behavior)
      this.execute();
    }
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.started = false;
    this.nextScheduledAt = null;
    logger.info("Git backup scheduler stopped");
  }

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

  private scheduleNext(): void {
    if (!this.started) return;
    const intervalMs = this.config.intervalMs;
    this.nextScheduledAt = new Date(Date.now() + intervalMs);

    // Persist the scheduled time
    this.stateStore?.save("gitBackup", this.nextScheduledAt);

    logger.info("Next git backup scheduled at {nextAt}", {
      nextAt: this.nextScheduledAt.toISOString(),
    });
    this.timerId = setTimeout(() => this.execute(), intervalMs);
  }

  private async execute(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Git backup already running, skipping");
      this.scheduleNext();
      return;
    }
    this.isRunning = true;
    this.timerId = null;
    try {
      if (this.callback) {
        await this.callback();
      }
      this.lastExecutedAt = new Date();
    } catch (error) {
      logger.error("Git backup execution failed", {
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
