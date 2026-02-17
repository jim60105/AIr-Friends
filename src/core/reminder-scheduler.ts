// src/core/reminder-scheduler.ts

import { createLogger } from "@utils/logger.ts";
import type { RemindersConfig } from "../types/config.ts";

const logger = createLogger("ReminderScheduler");

export type ReminderCallback = () => Promise<void>;

/**
 * Manages fixed-interval polling for due reminders.
 * Uses polling instead of per-reminder timers so that
 * bot restarts automatically pick up overdue reminders.
 */
export class ReminderScheduler {
  private timerId: number | null = null;
  private started = false;
  private isRunning = false;
  private callback: ReminderCallback | null = null;
  private lastExecutedAt: Date | null = null;
  private nextScheduledAt: Date | null = null;

  constructor(private readonly config: RemindersConfig) {}

  setCallback(callback: ReminderCallback): void {
    this.callback = callback;
  }

  start(): void {
    if (!this.config.enabled) {
      logger.info("Reminder scheduler is disabled");
      return;
    }
    if (this.started) return;
    if (!this.callback) {
      logger.warn("No callback set, cannot start");
      return;
    }
    this.started = true;
    this.scheduleNext();
    logger.info("Reminder scheduler started, check interval: {checkIntervalMs}ms", {
      checkIntervalMs: this.config.checkIntervalMs,
    });
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.started = false;
    this.nextScheduledAt = null;
    logger.info("Reminder scheduler stopped");
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
    this.nextScheduledAt = new Date(Date.now() + this.config.checkIntervalMs);
    this.timerId = setTimeout(() => this.execute(), this.config.checkIntervalMs);
  }

  private async execute(): Promise<void> {
    if (this.isRunning) {
      logger.debug("Previous check still running, skipping");
      this.scheduleNext();
      return;
    }

    this.isRunning = true;
    this.timerId = null;
    try {
      await this.callback?.();
      this.lastExecutedAt = new Date();
    } catch (error) {
      logger.error("Reminder check failed: {error}", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isRunning = false;
      if (this.started) this.scheduleNext();
    }
  }
}
