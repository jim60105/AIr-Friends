// src/core/spontaneous-scheduler.ts

import type { Config } from "../types/config.ts";
import { VALID_PLATFORMS } from "../types/events.ts";
import type { Platform } from "../types/events.ts";
import { resolveScheduleTime } from "@core/scheduler-state-store.ts";
import { BaseScheduler } from "@core/base-scheduler.ts";
import type {
  EmailSpontaneousStore,
  SpontaneousDispatchOutcome,
  SpontaneousOccurrence,
} from "@platforms/email/spontaneous-store.ts";

/**
 * Callback function invoked when a spontaneous post should be triggered.
 *
 * `occurrence` is supplied only for durable occurrence lanes (email). It carries the
 * restored or freshly persisted occurrence identity, so the consumer never allocates a
 * replacement identity and never re-fires an occurrence whose delivery is resolved.
 * Non-email callbacks keep their existing single-argument meaning.
 */
export type SpontaneousPostCallback = (
  platform: Platform,
  occurrence?: SpontaneousOccurrence,
) => Promise<void>;

/**
 * The only platform with a durable occurrence lane. Discord and Misskey keep their
 * existing best-effort `scheduler-state.json` scheduling unchanged.
 */
const DURABLE_OCCURRENCE_PLATFORM: Platform = "email";

/** A platform whose schedule state is owned by a durable occurrence store. */
interface DurableOccurrenceLane {
  platform: Platform;
  store: EmailSpontaneousStore;
}

/**
 * Per-platform scheduler state
 */
export interface PlatformSchedulerState {
  platform: Platform;
  timerId: ReturnType<typeof setTimeout> | null;
  isRunning: boolean;
  lastExecutedAt: Date | null;
  nextScheduledAt: Date | null;
  /** Current durable occurrence of this platform (occurrence lanes only). */
  occurrence?: SpontaneousOccurrence;
}

/**
 * Manages periodic spontaneous posting for each platform.
 * Schedules random intervals between configured min and max values.
 * Each platform has its own independent timer.
 *
 * Extends BaseScheduler for class hierarchy but overrides start/stop/getStatus
 * entirely because it manages per-platform independent timers.
 *
 * A platform may instead be configured with a durable occurrence store. Such a lane
 * persists its occurrence identity and due time through the crash-safe email store
 * BEFORE any timer is armed, restores overdue occurrences without re-identifying them,
 * and finalizes an occurrence and its distinct successor in one atomic snapshot write.
 */
export class SpontaneousScheduler extends BaseScheduler {
  private readonly states: Map<Platform, PlatformSchedulerState> = new Map();
  private callback: SpontaneousPostCallback | null = null;
  private readonly config: Config;
  private occurrenceStore: EmailSpontaneousStore | null = null;
  private startupPromise: Promise<void> = Promise.resolve();
  private generation = 0;

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

  /**
   * Attach the durable occurrence store of the email spontaneous lane.
   * The store's own snapshot is the authoritative schedule state for that platform;
   * the best-effort scheduler state file is not used for it.
   */
  setOccurrenceStore(store: EmailSpontaneousStore): void {
    this.occurrenceStore = store;
  }

  /**
   * Resolves when durable occurrence lanes have finished their startup restore,
   * persistence and timer arming. It does not imply that a lane blocked for review is
   * operational, nor that an overdue occurrence has already executed.
   */
  whenReady(): Promise<void> {
    return this.startupPromise;
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
    const generation = ++this.generation;
    const occurrenceStore = this.occurrenceStore;
    const durableLanes: DurableOccurrenceLane[] = [];

    for (const platformName of VALID_PLATFORMS) {
      const platformConfig = this.config.platforms[platformName];
      if (!platformConfig || !platformConfig.enabled || !platformConfig.spontaneousPost?.enabled) {
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

      // Durable occurrence lane: identity and due time are restored from, and persisted
      // to, the occurrence store instead of the best-effort scheduler state file.
      if (occurrenceStore && platformName === DURABLE_OCCURRENCE_PLATFORM) {
        durableLanes.push({ platform: platformName, store: occurrenceStore });
        continue;
      }

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

    this.startupPromise = this.startDurableLanes(durableLanes, generation);
  }

  /**
   * Stop all scheduled timers and clean up.
   */
  override stop(): void {
    this.generation++;
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
    if (!platformConfig || !platformConfig.spontaneousPost) {
      return 10800000;
    }
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
   * Restore and arm durable occurrence lanes.
   * A lane is only armed after its occurrence is durably persisted. A lane whose state is
   * corrupt, whose write fails, or whose occurrence requires review is left unarmed instead
   * of allocating a replacement identity.
   */
  private async startDurableLanes(
    lanes: DurableOccurrenceLane[],
    generation: number,
  ): Promise<void> {
    for (const { platform, store } of lanes) {
      try {
        const state = await store.restore();
        if (!this.isCurrentLifecycle(generation)) return;

        const active = store.activeOccurrence(state);
        if (!active) {
          if (state.occurrence !== null) {
            // A terminal occurrence without a planned successor is a review state: no
            // dispatch, no selection and no replacement identity are produced for it.
            this.logger.warn(
              "Email spontaneous occurrence lane stopped for review at {occurrenceId}",
              {
                occurrenceId: state.occurrence.occurrenceId,
                status: state.occurrence.status,
              },
            );
            continue;
          }
          const occurrence = await store.schedule(
            new Date(Date.now() + this.getRandomInterval(platform)),
          );
          if (!this.isCurrentLifecycle(generation)) return;
          this.armDurableOccurrence(platform, occurrence);
          continue;
        }

        // A dispatch that was already claimed before the crash can never be re-fired:
        // accepted or uncertain evidence terminalizes it and installs a distinct successor.
        if (active.status === "started" && store.deliveryResolved(active)) {
          const successor = await store.finishAndScheduleNext(
            active.occurrenceId,
            "unavailable",
            new Date(Date.now() + this.getRandomInterval(platform)),
          );
          if (!this.isCurrentLifecycle(generation)) return;
          this.logger.warn(
            "Email spontaneous occurrence {occurrenceId} required review; successor {successorId} scheduled",
            { occurrenceId: active.occurrenceId, successorId: successor.occurrenceId },
          );
          this.armDurableOccurrence(platform, successor);
          continue;
        }

        // Restored overdue occurrences keep their identity and due time; the delay simply
        // becomes zero without re-identifying the occurrence or its bound target.
        this.armDurableOccurrence(platform, active);
      } catch (error) {
        this.logger.error("Email spontaneous occurrence lane blocked during startup", {
          platform,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Arm a timer for a durably persisted occurrence.
   * The occurrence is already durable, so only the delay is computed here.
   */
  private armDurableOccurrence(platform: Platform, occurrence: SpontaneousOccurrence): void {
    const state = this.states.get(platform);
    if (!state || !this.started) return;

    const delayMs = Math.max(0, occurrence.dueAt.getTime() - Date.now());
    state.occurrence = occurrence;
    state.nextScheduledAt = occurrence.dueAt;
    this.logger.info("Spontaneous occurrence {occurrenceId} armed at {dueAt}", {
      platform,
      occurrenceId: occurrence.occurrenceId,
      dueAt: occurrence.dueAt.toISOString(),
      delayMs,
    });
    state.timerId = setTimeout(() => {
      this.executeForPlatform(platform);
    }, delayMs);
  }

  private isCurrentLifecycle(generation: number): boolean {
    return this.started && generation === this.generation;
  }

  /**
   * Execute the spontaneous post for a platform.
   * Catches all errors to prevent crashing the bot.
   * Schedules the next execution after completion.
   */
  private async executeForPlatform(platform: Platform): Promise<void> {
    const occurrenceStore = this.occurrenceStore;
    if (occurrenceStore && platform === DURABLE_OCCURRENCE_PLATFORM) {
      await this.executeDurablePlatform(platform, occurrenceStore);
      return;
    }

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

  /**
   * Execute one durable occurrence: dispatch the bound occurrence, then terminalize it and
   * install its distinct successor in one atomic snapshot write.
   *
   * The terminalizing write always runs, even if the scheduler is stopping, because the
   * occurrence was really claimed. Only arming the successor timer is lifecycle-gated, so a
   * stopped or restarted scheduler cannot leave an obsolete timer behind. A failed write
   * fences the lane: no timer is armed and no replacement identity is allocated.
   */
  private async executeDurablePlatform(
    platform: Platform,
    store: EmailSpontaneousStore,
  ): Promise<void> {
    const state = this.states.get(platform);
    const occurrence = state?.occurrence;
    if (!state || !this.callback || !occurrence) return;

    if (state.isRunning) {
      // The running invocation owns finalization and successor arming for this occurrence.
      this.logger.warn("Previous spontaneous post still running on {platform}, skipping", {
        platform,
      });
      return;
    }

    const generation = this.generation;
    state.isRunning = true;
    state.timerId = null;
    let outcome: SpontaneousDispatchOutcome = "completed";

    try {
      this.logger.info("Executing spontaneous post on {platform}", {
        platform,
        occurrenceId: occurrence.occurrenceId,
      });
      await this.callback(platform, occurrence);
      state.lastExecutedAt = new Date();
      this.logger.info("Spontaneous post completed on {platform}", {
        platform,
        occurrenceId: occurrence.occurrenceId,
      });
    } catch (error) {
      // Critical: never crash the bot due to spontaneous post failure
      outcome = "unavailable";
      this.logger.error("Spontaneous post failed on {platform}", {
        platform,
        occurrenceId: occurrence.occurrenceId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      state.isRunning = false;
    }

    try {
      const successor = await store.finishAndScheduleNext(
        occurrence.occurrenceId,
        outcome,
        new Date(Date.now() + this.getRandomInterval(platform)),
      );
      if (this.isCurrentLifecycle(generation) && this.states.has(platform)) {
        this.armDurableOccurrence(platform, successor);
      }
    } catch (error) {
      this.logger.error(
        "Email spontaneous occurrence lane stopped for review after {occurrenceId}",
        {
          platform,
          occurrenceId: occurrence.occurrenceId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
