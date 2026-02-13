// src/core/self-research-scheduler.ts

import { createLogger } from "@utils/logger.ts";
import type { Config } from "../types/config.ts";

const logger = createLogger("SelfResearchScheduler");

/**
 * Callback function invoked when a self-research session should be triggered.
 */
export type SelfResearchCallback = () => Promise<void>;

/**
 * Manages periodic self-research sessions.
 * Design pattern mirrors SpontaneousScheduler.
 */
export class SelfResearchScheduler {
  private timerId: number | null = null;
  private isRunning = false;
  private lastExecutedAt: Date | null = null;
  private nextScheduledAt: Date | null = null;
  private callback: SelfResearchCallback | null = null;
  private readonly config: Config;
  private started = false;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Set the callback function to invoke when a self-research session is triggered.
   * Must be called before start().
   */
  setCallback(callback: SelfResearchCallback): void {
    this.callback = callback;
  }

  /**
   * Start scheduling self-research sessions.
   */
  start(): void {
    if (this.started) {
      logger.warn("Self-research scheduler already started");
      return;
    }
    if (!this.config.selfResearch?.enabled) return;

    this.started = true;
    this.scheduleNext();
    logger.info("Self-research scheduler started", {
      minIntervalMs: this.config.selfResearch.minIntervalMs,
      maxIntervalMs: this.config.selfResearch.maxIntervalMs,
      model: this.config.selfResearch.model,
      feedCount: this.config.selfResearch.rssFeeds.length,
    });
  }

  /**
   * Stop the scheduler and clean up.
   */
  stop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.started = false;
    this.nextScheduledAt = null;
    logger.info("Self-research scheduler stopped");
  }

  /**
   * Get the current status of the scheduler.
   */
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

  /**
   * Calculate a random interval between min and max.
   */
  private getRandomInterval(): number {
    const sr = this.config.selfResearch!;
    const range = sr.maxIntervalMs - sr.minIntervalMs;
    return sr.minIntervalMs + Math.floor(Math.random() * range);
  }

  /**
   * Schedule the next self-research session.
   */
  private scheduleNext(): void {
    const interval = this.getRandomInterval();
    const nextTime = new Date(Date.now() + interval);
    this.nextScheduledAt = nextTime;

    logger.info("Next self-research session scheduled", {
      intervalMs: interval,
      scheduledAt: nextTime.toISOString(),
    });

    this.timerId = setTimeout(() => {
      this.execute();
    }, interval);
  }

  /**
   * Execute the self-research session.
   * Catches all errors to prevent crashing the bot.
   */
  private async execute(): Promise<void> {
    if (!this.callback) return;

    if (this.isRunning) {
      logger.warn("Previous self-research session still running, skipping");
      this.scheduleNext();
      return;
    }

    this.isRunning = true;
    this.timerId = null;

    try {
      logger.info("Executing self-research session");
      await this.callback();
      this.lastExecutedAt = new Date();
      logger.info("Self-research session completed");
    } catch (error) {
      logger.error("Self-research session failed", {
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
