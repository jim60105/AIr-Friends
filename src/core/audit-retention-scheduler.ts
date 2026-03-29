// src/core/audit-retention-scheduler.ts

import { BaseScheduler } from "@core/base-scheduler.ts";
import type { AuditConfig } from "../types/config.ts";

export type AuditRetentionCallback = () => Promise<void>;

/** Fixed-interval (24h) cleanup of expired audit log files. */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Manages periodic audit log retention cleanup.
 */
export class AuditRetentionScheduler extends BaseScheduler {
  private config: AuditConfig;
  private callback: AuditRetentionCallback | null = null;

  constructor(config: AuditConfig) {
    super();
    this.config = config;
  }

  setCallback(callback: AuditRetentionCallback): void {
    this.callback = callback;
  }

  protected isEnabled(): boolean {
    return this.config.enabled && this.config.retentionDays > 0;
  }

  protected getNextDelayMs(): number {
    return CLEANUP_INTERVAL_MS;
  }

  protected getMaxIntervalMs(): number {
    return CLEANUP_INTERVAL_MS;
  }

  protected getStateKey(): string {
    return "auditRetention";
  }

  protected async executeCallback(): Promise<void> {
    if (this.callback) {
      await this.callback();
    }
  }

  protected override onFirstStart(): void {
    this.execute();
  }

  protected override onStarted(): void {
    this.logger.info("Audit retention scheduler started", {
      retentionDays: this.config.retentionDays,
      intervalMs: CLEANUP_INTERVAL_MS,
    });
  }
}
