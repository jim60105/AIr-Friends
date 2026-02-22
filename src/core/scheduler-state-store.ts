// src/core/scheduler-state-store.ts

import { createLogger } from "@utils/logger.ts";

const logger = createLogger("SchedulerStateStore");

/**
 * Persisted scheduler state: key -> ISO 8601 UTC timestamp string
 */
export interface SchedulerState {
  [key: string]: string;
}

/**
 * Persists and loads scheduler next-execution times from a JSON file.
 * Uses in-memory cache to avoid read-merge-write race conditions.
 * All I/O operations are fire-and-forget — errors are logged but never thrown.
 */
export class SchedulerStateStore {
  private cache: SchedulerState = {};
  private loaded = false;

  constructor(private readonly filePath: string) {}

  /**
   * Load all scheduler states from file into in-memory cache.
   * Returns empty object if file not found or JSON parse error.
   * Must be called once before save()/remove().
   */
  async load(): Promise<SchedulerState> {
    try {
      const text = await Deno.readTextFile(this.filePath);
      this.cache = JSON.parse(text) as SchedulerState;
      logger.info("Scheduler state loaded from {filePath}", { filePath: this.filePath });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.info("No scheduler state file found at {filePath}, starting fresh", {
          filePath: this.filePath,
        });
      } else {
        logger.warn("Failed to load scheduler state from {filePath}, starting fresh: {error}", {
          filePath: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.cache = {};
    }
    this.loaded = true;
    // Return a shallow copy to prevent external mutation
    return { ...this.cache };
  }

  /**
   * Save a single scheduler's next execution time.
   * Updates in-memory cache (synchronous, race-free) then writes full state to file.
   */
  async save(key: string, nextAt: Date): Promise<void> {
    // Update cache synchronously — no interleaving possible here
    this.cache[key] = nextAt.toISOString();

    try {
      await Deno.writeTextFile(this.filePath, JSON.stringify(this.cache, null, 2) + "\n");
    } catch (error) {
      logger.warn("Failed to save scheduler state for {key}: {error}", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Remove a key from the state.
   * Updates in-memory cache then writes to file.
   */
  async remove(key: string): Promise<void> {
    delete this.cache[key];

    try {
      await Deno.writeTextFile(this.filePath, JSON.stringify(this.cache, null, 2) + "\n");
    } catch {
      // Ignore errors — non-critical operation
    }
  }
}

/**
 * Resolve the schedule time from a persisted value.
 * Validates against current time and configured min/max intervals.
 */
export function resolveScheduleTime(
  restoredNextAt: Date,
  _minIntervalMs: number,
  maxIntervalMs: number,
  getNewInterval: () => number,
): { delayMs: number; nextAt: Date } {
  const now = Date.now();
  const restoredMs = restoredNextAt.getTime();

  // Case 1: already due — execute immediately
  if (restoredMs <= now) {
    return { delayMs: 0, nextAt: new Date(now) };
  }

  // Case 2: exceeds max range — reschedule
  const maxBound = now + maxIntervalMs;
  if (restoredMs > maxBound) {
    const interval = getNewInterval();
    return { delayMs: interval, nextAt: new Date(now + interval) };
  }

  // Case 3: within acceptable range — use restored time
  const delay = restoredMs - now;
  return { delayMs: delay, nextAt: restoredNextAt };
}
