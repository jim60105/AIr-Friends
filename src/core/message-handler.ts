// src/core/message-handler.ts

import { createLogger } from "@utils/logger.ts";
import type { SessionOrchestrator, SessionResponse } from "./session-orchestrator.ts";
import type { NormalizedEvent } from "../types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { RateLimitConfig } from "../types/config.ts";
import { RateLimiter } from "./rate-limiter.ts";

const logger = createLogger("MessageHandler");

/**
 * MessageHandler processes incoming platform events
 * and coordinates with SessionOrchestrator
 */
export class MessageHandler {
  private orchestrator: SessionOrchestrator;
  private activeEvents: Set<string> = new Set();
  private rateLimiter: RateLimiter;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(orchestrator: SessionOrchestrator, rateLimitConfig: RateLimitConfig) {
    this.orchestrator = orchestrator;
    this.rateLimiter = new RateLimiter(rateLimitConfig);

    // Periodic cleanup every hour to prevent memory leaks
    if (rateLimitConfig.enabled) {
      this.cleanupInterval = setInterval(() => {
        this.rateLimiter.cleanup();
      }, 3600000);
    }
  }

  /**
   * Handle an incoming normalized event
   */
  async handleEvent(
    event: NormalizedEvent,
    platformAdapter: PlatformAdapter,
  ): Promise<SessionResponse> {
    // Generate unique event key to prevent duplicates
    const eventKey = `${event.platform}:${event.messageId}`;

    // Check for duplicate processing
    if (this.activeEvents.has(eventKey)) {
      logger.warn("Duplicate event ignored", {
        platform: event.platform,
        messageId: event.messageId,
        channelId: event.channelId,
      });
      return {
        success: false,
        replySent: false,
        error: "Event already being processed",
      };
    }

    // Mark event as active
    this.activeEvents.add(eventKey);

    try {
      // Rate limit check (after duplicate check, before any resource allocation)
      const userKey = `${event.platform}:${event.userId}`;
      if (!this.rateLimiter.isAllowed(userKey)) {
        logger.info("Rate limited", {
          platform: event.platform,
          userId: event.userId,
          channelId: event.channelId,
        });
        return { success: false, replySent: false, error: "Rate limited" };
      }

      logger.info("Handling event", {
        platform: event.platform,
        userId: event.userId,
        channelId: event.channelId,
        messageId: event.messageId,
        isDm: event.isDm,
      });

      // Process through orchestrator
      const response = await this.orchestrator.processMessage(event, platformAdapter);

      if (response.success) {
        logger.info("Event processed successfully", {
          platform: event.platform,
          messageId: event.messageId,
          replySent: response.replySent,
        });
      } else {
        logger.warn("Event processing failed", {
          platform: event.platform,
          messageId: event.messageId,
          error: response.error,
        });
      }

      return response;
    } finally {
      // Always remove from active set
      this.activeEvents.delete(eventKey);
    }
  }

  /**
   * Check if an event is currently being processed
   */
  isProcessing(platform: string, messageId: string): boolean {
    return this.activeEvents.has(`${platform}:${messageId}`);
  }

  /**
   * Get count of currently active events
   */
  getActiveCount(): number {
    return this.activeEvents.size;
  }

  /**
   * Dispose resources (cleanup interval)
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
