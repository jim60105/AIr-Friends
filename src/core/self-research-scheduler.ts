// src/core/self-research-scheduler.ts

import { BaseScheduler } from "@core/base-scheduler.ts";
import type { Config } from "../types/config.ts";

/**
 * Callback function invoked when a self-research session should be triggered.
 */
export type SelfResearchCallback = () => Promise<void>;

/**
 * Manages periodic self-research sessions.
 */
export class SelfResearchScheduler extends BaseScheduler {
  private callback: SelfResearchCallback | null = null;
  private readonly config: Config;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  /**
   * Set the callback function to invoke when a self-research session is triggered.
   * Must be called before start().
   */
  setCallback(callback: SelfResearchCallback): void {
    this.callback = callback;
  }

  protected isEnabled(): boolean {
    return !!this.config.selfResearch?.enabled;
  }

  protected getNextDelayMs(): number {
    const sr = this.config.selfResearch!;
    const range = sr.maxIntervalMs - sr.minIntervalMs;
    return sr.minIntervalMs + Math.floor(Math.random() * range);
  }

  protected getMaxIntervalMs(): number {
    return this.config.selfResearch!.maxIntervalMs;
  }

  protected getStateKey(): string {
    return "selfResearch";
  }

  protected async executeCallback(): Promise<void> {
    if (!this.callback) return;
    this.logger.info("Executing self-research session");
    await this.callback();
    this.logger.info("Self-research session completed");
  }

  protected override onStarted(): void {
    const sr = this.config.selfResearch!;
    this.logger.info("Self-research scheduler started", {
      minIntervalMs: sr.minIntervalMs,
      maxIntervalMs: sr.maxIntervalMs,
      model: sr.model,
      feedCount: sr.rssFeeds.length,
    });
  }
}
