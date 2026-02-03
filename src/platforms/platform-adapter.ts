// src/platforms/platform-adapter.ts

import { createLogger } from "@utils/logger.ts";
import type { NormalizedEvent, Platform, PlatformMessage } from "../types/events.ts";
import {
  ConnectionState,
  type ConnectionStatus,
  type EventHandler,
  type PlatformCapabilities,
  type ReplyOptions,
  type ReplyResult,
} from "../types/platform.ts";
import type { MessageFetcher } from "../types/context.ts";

const logger = createLogger("PlatformAdapter");

/**
 * Abstract base class for platform adapters
 *
 * Each platform (Discord, Misskey, etc.) must extend this class
 * and implement all abstract methods.
 */
export abstract class PlatformAdapter implements MessageFetcher {
  /** Platform identifier */
  abstract readonly platform: Platform;

  /** Platform capabilities */
  abstract readonly capabilities: PlatformCapabilities;

  /** Current connection status */
  protected connectionStatus: ConnectionStatus = {
    state: ConnectionState.DISCONNECTED,
    reconnectAttempts: 0,
  };

  /** Event handlers */
  protected eventHandlers: EventHandler[] = [];

  /**
   * Get current connection status
   */
  getConnectionStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  /**
   * Register an event handler
   */
  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove an event handler
   */
  offEvent(handler: EventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Emit an event to all handlers
   */
  protected async emitEvent(event: NormalizedEvent): Promise<void> {
    logger.debug("Emitting event", {
      platform: this.platform,
      messageId: event.messageId,
      channelId: event.channelId,
    });

    const errors: Error[] = [];

    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        logger.error("Event handler error", {
          platform: this.platform,
          error: error instanceof Error ? error.message : String(error),
        });
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // Log if any handlers failed but don't throw
    // This ensures one failed handler doesn't block others
    if (errors.length > 0) {
      logger.warn("Some event handlers failed", {
        platform: this.platform,
        failedCount: errors.length,
        totalHandlers: this.eventHandlers.length,
      });
    }
  }

  /**
   * Update connection state
   */
  protected updateConnectionState(
    state: ConnectionState,
    error?: string,
  ): void {
    const previousState = this.connectionStatus.state;
    this.connectionStatus.state = state;

    if (state === ConnectionState.CONNECTED) {
      this.connectionStatus.lastConnected = new Date();
      this.connectionStatus.reconnectAttempts = 0;
      this.connectionStatus.lastError = undefined;
    } else if (state === ConnectionState.ERROR) {
      this.connectionStatus.lastError = error;
    } else if (state === ConnectionState.RECONNECTING) {
      this.connectionStatus.reconnectAttempts++;
    }

    logger.info("Connection state changed", {
      platform: this.platform,
      previousState,
      newState: state,
      reconnectAttempts: this.connectionStatus.reconnectAttempts,
    });
  }

  // ============ Abstract methods to be implemented by each platform ============

  /**
   * Connect to the platform
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the platform
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a reply to a channel
   */
  abstract sendReply(
    channelId: string,
    content: string,
    options?: ReplyOptions,
  ): Promise<ReplyResult>;

  /**
   * Fetch recent messages from a channel
   * Part of MessageFetcher interface
   */
  abstract fetchRecentMessages(
    channelId: string,
    limit: number,
  ): Promise<PlatformMessage[]>;

  /**
   * Search messages in a guild (optional)
   * Part of MessageFetcher interface
   */
  searchRelatedMessages?(
    guildId: string,
    channelId: string,
    query: string,
    limit: number,
  ): Promise<PlatformMessage[]>;

  /**
   * Get username for a user ID
   */
  abstract getUsername(userId: string): Promise<string>;

  /**
   * Check if a user ID is the bot itself
   */
  abstract isSelf(userId: string): boolean;
}
