import { createLogger } from "@utils/logger.ts";
import type { MemoryMaintenanceConfig } from "../types/config.ts";
import type { SchedulerStateStore } from "@core/scheduler-state-store.ts";
import { resolveScheduleTime } from "@core/scheduler-state-store.ts";

const logger = createLogger("MemoryMaintenanceScheduler");

export type MemoryMaintenanceCallback = () => Promise<void>;

/**
 * Manages fixed-interval memory maintenance sessions.
 */
export class MemoryMaintenanceScheduler {
  private config: MemoryMaintenanceConfig;
  private callback: MemoryMaintenanceCallback | null = null;
  private timerId: number | null = null;
  private started = false;
  private isRunning = false;
  private lastExecutedAt: Date | null = null;
  private nextScheduledAt: Date | null = null;
  private stateStore: SchedulerStateStore | null = null;

  constructor(config: MemoryMaintenanceConfig) {
    this.config = config;
  }

  setCallback(callback: MemoryMaintenanceCallback): void {
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
      logger.info("Memory maintenance is disabled");
      return;
    }
    if (this.started) return;
    this.started = true;
    logger.info("Memory maintenance scheduler started", {
      intervalMs: this.config.intervalMs,
      minMemoryCount: this.config.minMemoryCount,
    });

    const restoredNextAt = restoredState?.["memoryMaintenance"]
      ? new Date(restoredState["memoryMaintenance"])
      : undefined;

    if (restoredNextAt && !isNaN(restoredNextAt.getTime())) {
      const { delayMs, nextAt } = resolveScheduleTime(
        restoredNextAt,
        this.config.intervalMs,
        this.config.intervalMs,
        () => this.config.intervalMs,
      );
      this.nextScheduledAt = nextAt;
      this.stateStore?.save("memoryMaintenance", nextAt);

      if (delayMs === 0) {
        this.execute();
      } else {
        this.timerId = setTimeout(() => this.execute(), delayMs);
      }
    } else {
      this.scheduleNext();
    }
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.started = false;
    this.nextScheduledAt = null;
    logger.info("Memory maintenance scheduler stopped");
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
    this.stateStore?.save("memoryMaintenance", this.nextScheduledAt);

    logger.info("Next memory maintenance scheduled", {
      nextAt: this.nextScheduledAt.toISOString(),
    });
    this.timerId = setTimeout(() => this.execute(), intervalMs);
  }

  private async execute(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Memory maintenance already running, skipping");
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
      logger.error("Memory maintenance execution failed", {
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
