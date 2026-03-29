import { BaseScheduler } from "@core/base-scheduler.ts";
import type { GitBackupConfig } from "../types/config.ts";

export type GitBackupCallback = () => Promise<void>;

/**
 * Manages fixed-interval Git backup execution.
 */
export class GitBackupScheduler extends BaseScheduler {
  private config: GitBackupConfig;
  private callback: GitBackupCallback | null = null;

  constructor(config: GitBackupConfig) {
    super();
    this.config = config;
  }

  setCallback(callback: GitBackupCallback): void {
    this.callback = callback;
  }

  protected isEnabled(): boolean {
    return this.config.enabled;
  }

  protected getNextDelayMs(): number {
    return this.config.intervalMs;
  }

  protected getMaxIntervalMs(): number {
    return this.config.intervalMs;
  }

  protected getStateKey(): string {
    return "gitBackup";
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
    this.logger.info("Git backup scheduler started", {
      intervalMs: this.config.intervalMs,
    });
  }
}
