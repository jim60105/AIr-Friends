// src/core/reminder-scheduler.ts

import { BaseScheduler } from "@core/base-scheduler.ts";
import type { RemindersConfig } from "../types/config.ts";

export type ReminderCallback = () => Promise<void>;

/**
 * Manages fixed-interval polling for due reminders.
 * Uses polling instead of per-reminder timers so that
 * bot restarts automatically pick up overdue reminders.
 */
export class ReminderScheduler extends BaseScheduler {
  private callback: ReminderCallback | null = null;

  constructor(private readonly config: RemindersConfig) {
    super();
  }

  setCallback(callback: ReminderCallback): void {
    this.callback = callback;
  }

  override start(restoredState?: Record<string, string>): void {
    if (!this.callback) {
      this.logger.warn("No callback set, cannot start");
      return;
    }
    super.start(restoredState);
  }

  protected isEnabled(): boolean {
    return this.config.enabled;
  }

  protected getNextDelayMs(): number {
    return this.config.checkIntervalMs;
  }

  protected getMaxIntervalMs(): number {
    return this.config.checkIntervalMs;
  }

  protected getStateKey(): string {
    return "reminder";
  }

  protected async executeCallback(): Promise<void> {
    await this.callback?.();
  }

  protected override onStarted(): void {
    this.logger.info("Reminder scheduler started, check interval: {checkIntervalMs}ms", {
      checkIntervalMs: this.config.checkIntervalMs,
    });
  }
}
