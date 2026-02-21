// src/platforms/platform-adapter.ts

import { createLogger } from "@utils/logger.ts";
import type { NormalizedEvent, Platform, PlatformMessage } from "../types/events.ts";
import type { SpontaneousTarget } from "../core/spontaneous-target.ts";
import type { Config } from "../types/config.ts";
import {
  ConnectionState,
  type ConnectionStatus,
  type EventHandler,
  type PlatformCapabilities,
  type PlatformEmoji,
  type ReactionResult,
  type ReplyOptions,
  type ReplyResult,
  type SendFileOptions,
  type SendFileResult,
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
   * Whether this platform supports and has enabled typing indicator.
   * Override in subclasses to return true when typing is supported and configured.
   */
  supportsTypingIndicator(): boolean {
    return false;
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

    logger.info("Connection state changed to {newState} for {platform}", {
      platform: this.platform,
      previousState,
      newState: state,
      reconnectAttempts: this.connectionStatus.reconnectAttempts,
    });
  }

  /**
   * Get the guild/server ID used for message search scope.
   * Default returns empty string (no guild concept).
   * Override for platforms with guild/server support.
   */
  getSearchGuildId(_channelId: string, _isDm: boolean): string {
    return "";
  }

  // ============ Abstract methods to be implemented by each platform ============

  /**
   * Determine the target for a spontaneous post on this platform.
   * Each platform implements its own target selection strategy.
   *
   * @param config - Application configuration (for whitelist access etc.)
   * @returns Target with channelId, or null if no valid target found
   */
  abstract determineSpontaneousTarget(config: Config): Promise<SpontaneousTarget | null>;

  /**
   * Connect to the platform
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the platform
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a typing indicator to a channel.
   * Platforms that do not support typing should implement as no-op.
   */
  abstract sendTyping(channelId: string): Promise<void>;

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
   * Fetch available custom emojis on the platform.
   * Returns an array of custom emojis the bot can use.
   * Unicode emojis are universally available and do not need to be listed.
   *
   * Implementations should cache results to avoid excessive API calls.
   */
  abstract fetchEmojis(): Promise<PlatformEmoji[]>;

  /**
   * Add a reaction to a message.
   *
   * @param channelId - The channel containing the message
   * @param messageId - The message to react to
   * @param emoji - The emoji to use for the reaction (Unicode character or platform-specific format)
   */
  abstract addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<ReactionResult>;

  /**
   * Edit an existing message on the platform
   */
  abstract editMessage(
    channelId: string,
    messageId: string,
    newContent: string,
    replyToMessageId?: string,
  ): Promise<ReplyResult>;

  /**
   * Send a file to a channel
   *
   * @param channelId - Target channel ID
   * @param fileContent - File content as Uint8Array
   * @param fileName - File name (e.g., "memory-export.md")
   * @param options - Optional: reply threading, comment text
   */
  abstract sendFile(
    channelId: string,
    fileContent: Uint8Array,
    fileName: string,
    options?: SendFileOptions,
  ): Promise<SendFileResult>;

  /**
   * Get username for a user ID
   */
  abstract getUsername(userId: string): Promise<string>;

  /**
   * Check if a user ID is the bot itself
   */
  abstract isSelf(userId: string): boolean;

  /**
   * Get the bot user ID (null if not yet connected)
   */
  abstract getBotId(): string | null;

  /**
   * Get or create a DM channel with a user.
   * Discord: creates/fetches a DM channel, returns channel ID
   * Misskey: returns "chat:{userId}" convention string
   *
   * @param userId - The target user's platform ID
   * @returns DM channel ID string, or null if DM creation failed
   */
  abstract getDmChannelId(userId: string): Promise<string | null>;

  /**
   * Check if the bot has reacted to a specific message.
   * Used by channel lurk scheduler to avoid duplicate responses.
   */
  abstract hasBotReaction(channelId: string, messageId: string): Promise<boolean>;

  /**
   * Check if a specific message mentions the bot.
   * Used by channel lurk scheduler to skip already-handled mentions.
   */
  abstract hasBotMention(channelId: string, messageId: string): Promise<boolean>;
}
