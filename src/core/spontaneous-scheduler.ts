// src/core/spontaneous-scheduler.ts

import { createLogger } from "@utils/logger.ts";
import type { Config } from "../types/config.ts";
import type { Platform } from "../types/events.ts";

const logger = createLogger("SpontaneousScheduler");

/**
 * Callback function invoked when a spontaneous post should be triggered.
 */
export type SpontaneousPostCallback = (platform: Platform) => Promise<void>;

/**
 * Per-platform scheduler state
 */
interface PlatformSchedulerState {
  platform: Platform;
  timerId: number | null;
  isRunning: boolean;
  lastExecutedAt: Date | null;
  nextScheduledAt: Date | null;
}

/**
 * Manages periodic spontaneous posting for each platform.
 * Schedules random intervals between configured min and max values.
 * Each platform has its own independent timer.
 */
export class SpontaneousScheduler {
  private readonly states: Map<Platform, PlatformSchedulerState> = new Map();
  private callback: SpontaneousPostCallback | null = null;
  private readonly config: Config;
  private started = false;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Set the callback function to invoke when a spontaneous post is triggered.
   * Must be called before start().
   */
  setCallback(callback: SpontaneousPostCallback): void {
    this.callback = callback;
  }

  /**
   * Start scheduling for all enabled platforms.
   * Only schedules for platforms that have spontaneousPost.enabled = true.
   */
  start(): void {
    if (this.started) {
      logger.warn("Scheduler already started");
      return;
    }
    this.started = true;

    for (const platformName of ["discord", "misskey"] as const) {
      const platformConfig = this.config.platforms[platformName];
      if (!platformConfig.enabled || !platformConfig.spontaneousPost?.enabled) {
        continue;
      }

      const state: PlatformSchedulerState = {
        platform: platformName,
        timerId: null,
        isRunning: false,
        lastExecutedAt: null,
        nextScheduledAt: null,
      };
      this.states.set(platformName, state);
      this.scheduleNext(platformName);

      logger.info("Spontaneous posting enabled for {platform}", {
        platform: platformName,
        minIntervalMs: platformConfig.spontaneousPost.minIntervalMs,
        maxIntervalMs: platformConfig.spontaneousPost.maxIntervalMs,
      });
    }
  }

  /**
   * Stop all scheduled timers and clean up.
   */
  stop(): void {
    for (const [platform, state] of this.states) {
      if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
        logger.debug("Timer cleared", { platform });
      }
    }
    this.states.clear();
    this.started = false;
    logger.info("Spontaneous scheduler stopped");
  }

  /**
   * Get the current status of all platform schedulers.
   */
  getStatus(): Record<string, {
    isRunning: boolean;
    lastExecutedAt: Date | null;
    nextScheduledAt: Date | null;
  }> {
    const status: Record<string, {
      isRunning: boolean;
      lastExecutedAt: Date | null;
      nextScheduledAt: Date | null;
    }> = {};
    for (const [platform, state] of this.states) {
      status[platform] = {
        isRunning: state.isRunning,
        lastExecutedAt: state.lastExecutedAt,
        nextScheduledAt: state.nextScheduledAt,
      };
    }
    return status;
  }

  /**
   * Calculate a random interval between min and max.
   */
  private getRandomInterval(platform: Platform): number {
    const platformConfig = this.config.platforms[platform];
    const sp = platformConfig.spontaneousPost!;
    const range = sp.maxIntervalMs - sp.minIntervalMs;
    return sp.minIntervalMs + Math.floor(Math.random() * range);
  }

  /**
   * Schedule the next spontaneous post for a platform.
   */
  private scheduleNext(platform: Platform): void {
    const state = this.states.get(platform);
    if (!state) return;

    const interval = this.getRandomInterval(platform);
    const nextTime = new Date(Date.now() + interval);
    state.nextScheduledAt = nextTime;

    logger.info("Next spontaneous post for {platform} scheduled at {scheduledAt}", {
      platform,
      intervalMs: interval,
      scheduledAt: nextTime.toISOString(),
    });

    state.timerId = setTimeout(() => {
      this.execute(platform);
    }, interval);
  }

  /**
   * Execute the spontaneous post for a platform.
   * Catches all errors to prevent crashing the bot.
   * Schedules the next execution after completion.
   */
  private async execute(platform: Platform): Promise<void> {
    const state = this.states.get(platform);
    if (!state || !this.callback) return;

    // Prevent concurrent execution for the same platform
    if (state.isRunning) {
      logger.warn("Previous spontaneous post still running on {platform}, skipping", { platform });
      this.scheduleNext(platform);
      return;
    }

    state.isRunning = true;
    state.timerId = null;

    try {
      logger.info("Executing spontaneous post on {platform}", { platform });
      await this.callback(platform);
      state.lastExecutedAt = new Date();
      logger.info("Spontaneous post completed on {platform}", { platform });
    } catch (error) {
      // Critical: never crash the bot due to spontaneous post failure
      logger.error("Spontaneous post failed on {platform}", {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      state.isRunning = false;
      // Always schedule next, even on failure
      if (this.started) {
        this.scheduleNext(platform);
      }
    }
  }
}
