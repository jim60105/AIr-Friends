// src/core/spontaneous-scheduler.ts

import type { Config } from "../types/config.ts";
import { VALID_PLATFORMS } from "../types/events.ts";
import type { Platform } from "../types/events.ts";
import { resolveScheduleTime } from "@core/scheduler-state-store.ts";
import { BaseScheduler } from "@core/base-scheduler.ts";

/**
 * Callback function invoked when a spontaneous post should be triggered.
 */
export type SpontaneousPostCallback = (platform: Platform) => Promise<void>;

/**
 * Per-platform scheduler state
 */
export interface PlatformSchedulerState {
  platform: Platform;
  timerId: ReturnType<typeof setTimeout> | null;
  isRunning: boolean;
  lastExecutedAt: Date | null;
  nextScheduledAt: Date | null;
}

/**
 * Manages periodic spontaneous posting for each platform.
 * Schedules random intervals between configured min and max values.
 * Each platform has its own independent timer.
 *
 * Extends BaseScheduler for class hierarchy but overrides start/stop/getStatus
 * entirely because it manages per-platform independent timers.
 */
export class SpontaneousScheduler extends BaseScheduler {
  private readonly states: Map<Platform, PlatformSchedulerState> = new Map();
  private callback: SpontaneousPostCallback | null = null;
  private readonly config: Config;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  /**
   * Set the callback function to invoke when a spontaneous post is triggered.
   * Must be called before start().
   */
  setCallback(callback: SpontaneousPostCallback): void {
    this.callback = callback;
  }

  // --- Abstract method stubs (required by BaseScheduler but unused) ---
  // Per-platform logic is handled entirely in the overridden start/stop/getStatus.
  protected isEnabled(): boolean {
    return false;
  }
  protected getNextDelayMs(): number {
    return 0;
  }
  protected getMaxIntervalMs(): number {
    return 0;
  }
  protected getStateKey(): string {
    return "spontaneous";
  }
  protected executeCallback(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Start scheduling for all enabled platforms.
   * Only schedules for platforms that have spontaneousPost.enabled = true.
   */
  override start(restoredState?: Record<string, string>): void {
    if (this.started) {
      this.logger.warn("Scheduler already started");
      return;
    }
    this.started = true;

    for (const platformName of VALID_PLATFORMS) {
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

      const key = `spontaneous:${platformName}`;
      const restoredNextAt = restoredState?.[key] ? new Date(restoredState[key]) : undefined;

      if (restoredNextAt && !isNaN(restoredNextAt.getTime())) {
        const sp = platformConfig.spontaneousPost!;
        const { delayMs, nextAt } = resolveScheduleTime(
          restoredNextAt,
          sp.minIntervalMs,
          sp.maxIntervalMs,
          () => this.getRandomInterval(platformName),
        );
        state.nextScheduledAt = nextAt;
        this.stateStore?.save(key, nextAt);

        if (delayMs === 0) {
          this.executeForPlatform(platformName);
        } else {
          state.timerId = setTimeout(() => this.executeForPlatform(platformName), delayMs);
        }
      } else {
        this.scheduleNextForPlatform(platformName);
      }

      this.logger.info("Spontaneous posting enabled for {platform}", {
        platform: platformName,
        minIntervalMs: platformConfig.spontaneousPost.minIntervalMs,
        maxIntervalMs: platformConfig.spontaneousPost.maxIntervalMs,
      });
    }
  }

  /**
   * Stop all scheduled timers and clean up.
   */
  override stop(): void {
    for (const [platform, state] of this.states) {
      if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
        this.logger.debug("Timer cleared", { platform });
      }
    }
    this.states.clear();
    this.started = false;
    this.logger.info("Spontaneous scheduler stopped");
  }

  /**
   * Get the current status of all platform schedulers.
   */
  // @ts-ignore: Return type intentionally differs from base — per-platform Record vs single object
  override getStatus(): Record<string, {
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
  private scheduleNextForPlatform(platform: Platform): void {
    const state = this.states.get(platform);
    if (!state) return;

    const interval = this.getRandomInterval(platform);
    const nextTime = new Date(Date.now() + interval);
    state.nextScheduledAt = nextTime;

    // Persist the scheduled time
    this.stateStore?.save(`spontaneous:${platform}`, nextTime);

    this.logger.info("Next spontaneous post for {platform} scheduled at {scheduledAt}", {
      platform,
      intervalMs: interval,
      scheduledAt: nextTime.toISOString(),
    });

    state.timerId = setTimeout(() => {
      this.executeForPlatform(platform);
    }, interval);
  }

  /**
   * Execute the spontaneous post for a platform.
   * Catches all errors to prevent crashing the bot.
   * Schedules the next execution after completion.
   */
  private async executeForPlatform(platform: Platform): Promise<void> {
    const state = this.states.get(platform);
    if (!state || !this.callback) return;

    // Prevent concurrent execution for the same platform
    if (state.isRunning) {
      this.logger.warn("Previous spontaneous post still running on {platform}, skipping", {
        platform,
      });
      this.scheduleNextForPlatform(platform);
      return;
    }

    state.isRunning = true;
    state.timerId = null;

    try {
      this.logger.info("Executing spontaneous post on {platform}", { platform });
      await this.callback(platform);
      state.lastExecutedAt = new Date();
      this.logger.info("Spontaneous post completed on {platform}", { platform });
    } catch (error) {
      // Critical: never crash the bot due to spontaneous post failure
      this.logger.error("Spontaneous post failed on {platform}", {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      state.isRunning = false;
      // Always schedule next, even on failure
      if (this.started) {
        this.scheduleNextForPlatform(platform);
      }
    }
  }
}
