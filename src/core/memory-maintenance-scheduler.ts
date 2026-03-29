import { BaseScheduler } from "@core/base-scheduler.ts";
import type { MemoryMaintenanceConfig } from "../types/config.ts";

export type MemoryMaintenanceCallback = () => Promise<void>;

/**
 * Manages fixed-interval memory maintenance sessions.
 */
export class MemoryMaintenanceScheduler extends BaseScheduler {
  private config: MemoryMaintenanceConfig;
  private callback: MemoryMaintenanceCallback | null = null;

  constructor(config: MemoryMaintenanceConfig) {
    super();
    this.config = config;
  }

  setCallback(callback: MemoryMaintenanceCallback): void {
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
    return "memoryMaintenance";
  }

  protected async executeCallback(): Promise<void> {
    if (this.callback) {
      await this.callback();
    }
  }

  protected override onStarted(): void {
    this.logger.info("Memory maintenance scheduler started", {
      intervalMs: this.config.intervalMs,
      minMemoryCount: this.config.minMemoryCount,
    });
  }
}
