import { createLogger } from "@utils/logger.ts";
import type { GitBackupConfig } from "../types/config.ts";

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

  constructor(config: GitBackupConfig) {
    this.config = config;
  }

  setCallback(callback: GitBackupCallback): void {
    this.callback = callback;
  }

  start(): void {
    if (!this.config.enabled) {
      logger.info("Git backup is disabled");
      return;
    }
    if (this.started) return;
    this.started = true;
    logger.info("Git backup scheduler started", {
      intervalMs: this.config.intervalMs,
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
