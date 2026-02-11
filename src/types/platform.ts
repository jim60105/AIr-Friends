// src/types/platform.ts

import type { NormalizedEvent } from "./events.ts";

/**
 * Platform connection state
 */
export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error",
}

/**
 * Platform adapter capabilities
 */
export interface PlatformCapabilities {
  /** Can fetch message history */
  canFetchHistory: boolean;

  /** Can search messages */
  canSearchMessages: boolean;

  /** Supports direct messages */
  supportsDm: boolean;

  /** Supports guild/server concept */
  supportsGuild: boolean;

  /** Supports message reactions */
  supportsReactions: boolean;

  /** Maximum message length */
  maxMessageLength: number;
}

/**
 * Platform connection status
 */
export interface ConnectionStatus {
  state: ConnectionState;
  lastConnected?: Date;
  lastError?: string;
  reconnectAttempts: number;
}

/**
 * Event handler for normalized events
 */
export type EventHandler = (event: NormalizedEvent) => Promise<void>;

/**
 * Reply options for platform-specific features
 */
export interface ReplyOptions {
  /** Reply to a specific message (thread) */
  replyToMessageId?: string;

  /** Mention the user in the reply */
  mentionUser?: boolean;

  /** Additional platform-specific options */
  platformSpecific?: Record<string, unknown>;
}

/**
 * Result of sending a reply
 */
export interface ReplyResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Represents a custom emoji available on the platform.
 * Unicode emojis do not need to be listed — agents already know them.
 */
export interface PlatformEmoji {
  /** Emoji name (without colons) */
  name: string;

  /** Whether this is an animated emoji */
  animated: boolean;

  /** Platform-specific emoji ID (e.g., Discord snowflake ID) */
  platformId?: string;

  /** Category/group name (if available, e.g., Misskey categories) */
  category?: string | null;

  /**
   * The string format to embed this emoji in a text message.
   * Discord: "<:name:id>" or "<a:name:id>"
   * Misskey: ":name:"
   */
  useInText: string;

  /**
   * The string format to use when reacting to a message.
   * Discord: "name:id" or Unicode character
   * Misskey: ":name:" or Unicode character
   */
  useAsReaction: string;
}

/**
 * Result of adding a reaction to a message
 */
export interface ReactionResult {
  success: boolean;
  error?: string;
}
