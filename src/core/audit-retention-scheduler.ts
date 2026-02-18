// src/core/audit-retention-scheduler.ts

import { createLogger } from "@utils/logger.ts";
import type { AuditConfig } from "../types/config.ts";

const logger = createLogger("AuditRetentionScheduler");

export type AuditRetentionCallback = () => Promise<void>;

/** Fixed-interval (24h) cleanup of expired audit log files. */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Manages periodic audit log retention cleanup.
 */
export class AuditRetentionScheduler {
  private config: AuditConfig;
  private callback: AuditRetentionCallback | null = null;
  private timerId: number | null = null;
  private started = false;
  private isRunning = false;
  private lastExecutedAt: Date | null = null;
  private nextScheduledAt: Date | null = null;

  constructor(config: AuditConfig) {
    this.config = config;
  }

  setCallback(callback: AuditRetentionCallback): void {
    this.callback = callback;
  }

  start(): void {
    if (!this.config.enabled || this.config.retentionDays <= 0) {
      logger.info("Audit retention cleanup is disabled");
      return;
    }
    if (this.started) return;
    this.started = true;
    logger.info("Audit retention scheduler started", {
      retentionDays: this.config.retentionDays,
      intervalMs: CLEANUP_INTERVAL_MS,
    });
    // Execute immediately on start, then schedule subsequent runs
    this.execute();
  }

  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.started = false;
    this.nextScheduledAt = null;
    logger.info("Audit retention scheduler stopped");
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
    this.nextScheduledAt = new Date(Date.now() + CLEANUP_INTERVAL_MS);
    logger.info("Next audit cleanup scheduled at {nextAt}", {
      nextAt: this.nextScheduledAt.toISOString(),
    });
    this.timerId = setTimeout(() => this.execute(), CLEANUP_INTERVAL_MS);
  }

  private async execute(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Audit cleanup already running, skipping");
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
      logger.error("Audit retention cleanup failed", {
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
