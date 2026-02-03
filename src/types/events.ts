// src/types/events.ts

/**
 * Supported platform identifiers
 */
export type Platform = "discord" | "misskey";

/**
 * Normalized event from any platform
 * All platform-specific events are converted to this format
 */
export interface NormalizedEvent {
  /** Platform identifier */
  platform: Platform;

  /** Channel/room identifier where the message was sent */
  channelId: string;

  /** User identifier of the message author */
  userId: string;

  /** Original message identifier */
  messageId: string;

  /** Whether this is a direct message */
  isDm: boolean;

  /** Guild/server identifier (empty string if not applicable) */
  guildId: string;

  /** Message content text */
  content: string;

  /** Original timestamp of the message */
  timestamp: Date;

  /** Raw platform-specific data for reference */
  raw?: unknown;
}

/**
 * Message from platform history
 */
export interface PlatformMessage {
  messageId: string;
  userId: string;
  username: string;
  content: string;
  timestamp: Date;
  isBot: boolean;
}

/**
 * Context fetched from platform
 */
export interface PlatformContext {
  recentMessages: PlatformMessage[];
  relatedMessages?: PlatformMessage[];
}
