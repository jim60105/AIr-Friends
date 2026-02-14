// src/platforms/connection-manager.ts

import { createLogger } from "@utils/logger.ts";
import type { PlatformAdapter } from "./platform-adapter.ts";
import { ConnectionState } from "../types/platform.ts";

const logger = createLogger("ConnectionManager");

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Base delay in milliseconds */
  baseDelay: number;

  /** Maximum delay in milliseconds */
  maxDelay: number;

  /** Maximum number of retry attempts (0 = infinite) */
  maxAttempts: number;

  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  baseDelay: 1000,
  maxDelay: 60000,
  maxAttempts: 0, // infinite
  backoffMultiplier: 2,
};

/**
 * Manages platform connections with automatic retry
 */
export class ConnectionManager {
  private readonly adapter: PlatformAdapter;
  private readonly config: RetryConfig;
  private retryTimeoutId: number | null = null;
  private isShuttingDown = false;

  constructor(adapter: PlatformAdapter, config: Partial<RetryConfig> = {}) {
    this.adapter = adapter;
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Calculate delay for current retry attempt
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: baseDelay * (multiplier ^ attempt)
    const delay = this.config.baseDelay *
      Math.pow(this.config.backoffMultiplier, attempt);

    // Add jitter (±10%)
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);

    // Clamp to maxDelay
    return Math.min(delay + jitter, this.config.maxDelay);
  }

  /**
   * Connect with automatic retry on failure
   */
  async connectWithRetry(): Promise<void> {
    this.isShuttingDown = false;
    let attempt = 0;

    while (!this.isShuttingDown) {
      try {
        logger.info("Attempting to connect: attempt {attempt}/{maxAttempts}", {
          platform: this.adapter.platform,
          attempt: attempt + 1,
          maxAttempts: this.config.maxAttempts || "∞",
        });

        await this.adapter.connect();

        // Connection successful
        logger.info("Connected successfully on attempt {attempt}", {
          platform: this.adapter.platform,
          attempt: attempt + 1,
        });

        // Set up reconnection on disconnect
        this.monitorConnection();
        return;
      } catch (error) {
        attempt++;

        logger.error("Connection failed on attempt {attempt}", {
          platform: this.adapter.platform,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });

        // Check if we've exceeded max attempts
        if (
          this.config.maxAttempts > 0 &&
          attempt >= this.config.maxAttempts
        ) {
          logger.fatal("Max connection attempts ({maxAttempts}) reached", {
            platform: this.adapter.platform,
            maxAttempts: this.config.maxAttempts,
          });
          throw new Error(
            `Failed to connect to ${this.adapter.platform} after ${attempt} attempts`,
          );
        }

        // Calculate delay and wait
        const delay = this.calculateDelay(attempt);
        logger.info("Waiting {delayMs}ms before retry attempt {nextAttempt}", {
          platform: this.adapter.platform,
          delayMs: Math.round(delay),
          nextAttempt: attempt + 1,
        });

        await this.sleep(delay);
      }
    }
  }

  /**
   * Monitor connection and reconnect on disconnect
   */
  private monitorConnection(): void {
    // This would typically be implemented differently based on the platform
    // For now, we'll check status periodically
    const checkInterval = setInterval(() => {
      if (this.isShuttingDown) {
        clearInterval(checkInterval);
        return;
      }

      const status = this.adapter.getConnectionStatus();
      if (
        status.state === ConnectionState.DISCONNECTED ||
        status.state === ConnectionState.ERROR
      ) {
        logger.warn("Connection lost, attempting to reconnect", {
          platform: this.adapter.platform,
          state: status.state,
        });

        clearInterval(checkInterval);
        this.connectWithRetry().catch((error) => {
          logger.fatal("Reconnection failed permanently", {
            platform: this.adapter.platform,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }, 5000);
  }

  /**
   * Gracefully disconnect
   */
  async disconnect(): Promise<void> {
    this.isShuttingDown = true;

    if (this.retryTimeoutId !== null) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }

    try {
      await this.adapter.disconnect();
      logger.info("Disconnected gracefully", {
        platform: this.adapter.platform,
      });
    } catch (error) {
      logger.error("Error during disconnect", {
        platform: this.adapter.platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.retryTimeoutId = setTimeout(resolve, ms) as unknown as number;
    });
  }
}
