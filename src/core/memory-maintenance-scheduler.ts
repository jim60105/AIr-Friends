import { createLogger } from "@utils/logger.ts";
import type { MemoryMaintenanceConfig } from "../types/config.ts";

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

  constructor(config: MemoryMaintenanceConfig) {
    this.config = config;
  }

  setCallback(callback: MemoryMaintenanceCallback): void {
    this.callback = callback;
  }

  start(): void {
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
    this.scheduleNext();
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
