// src/core/rate-limiter.ts

import { createLogger } from "@utils/logger.ts";
import type { RateLimitConfig } from "../types/config.ts";

const logger = createLogger("RateLimiter");

interface UserRateState {
  /** Timestamps of requests within the current window */
  timestamps: number[];
  /** If set, user is in cooldown until this time */
  cooldownUntil: number | null;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private userStates: Map<string, UserRateState> = new Map();

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a request from the given user should be allowed.
   * Returns true if allowed, false if rate-limited.
   *
   * @param userKey - Unique user identifier, format: "{platform}:{userId}"
   */
  isAllowed(userKey: string): boolean {
    if (!this.config.enabled) return true;

    const now = Date.now();
    let state = this.userStates.get(userKey);

    if (!state) {
      state = { timestamps: [], cooldownUntil: null };
      this.userStates.set(userKey, state);
    }

    // Check cooldown period
    if (state.cooldownUntil && now < state.cooldownUntil) {
      logger.debug("User in cooldown", {
        userKey,
        cooldownRemainingMs: state.cooldownUntil - now,
      });
      return false;
    }

    // Clear expired cooldown
    if (state.cooldownUntil && now >= state.cooldownUntil) {
      state.cooldownUntil = null;
      state.timestamps = [];
    }

    // Remove timestamps outside the sliding window
    const windowStart = now - this.config.windowMs;
    state.timestamps = state.timestamps.filter((t) => t > windowStart);

    // Check if limit exceeded
    if (state.timestamps.length >= this.config.maxRequestsPerWindow) {
      state.cooldownUntil = now + this.config.cooldownMs;
      logger.warn("Rate limit exceeded, entering cooldown", {
        userKey,
        requestCount: state.timestamps.length,
        maxRequests: this.config.maxRequestsPerWindow,
        cooldownMs: this.config.cooldownMs,
      });
      return false;
    }

    // Allow request and record timestamp
    state.timestamps.push(now);
    return true;
  }

  /**
   * Get the number of remaining requests for a user in the current window.
   */
  getRemainingRequests(userKey: string): number {
    if (!this.config.enabled) return Infinity;

    const now = Date.now();
    const state = this.userStates.get(userKey);

    if (!state) return this.config.maxRequestsPerWindow;

    if (state.cooldownUntil && now < state.cooldownUntil) return 0;

    const windowStart = now - this.config.windowMs;
    const activeCount = state.timestamps.filter((t) => t > windowStart).length;
    return Math.max(0, this.config.maxRequestsPerWindow - activeCount);
  }

  /**
   * Clean up expired entries to prevent memory leaks.
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [key, state] of this.userStates.entries()) {
      const cooldownExpired = !state.cooldownUntil || now >= state.cooldownUntil;
      const noRecentActivity = state.timestamps.every((t) => t <= windowStart);

      if (cooldownExpired && noRecentActivity) {
        this.userStates.delete(key);
      }
    }
  }

  reset(userKey: string): void {
    this.userStates.delete(userKey);
  }

  resetAll(): void {
    this.userStates.clear();
  }
}
