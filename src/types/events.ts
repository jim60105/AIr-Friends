// src/types/events.ts

/**
 * Supported platform identifiers
 */
export type Platform = "discord" | "misskey";

/** All valid platform identifiers, kept in sync with Platform type */
export const VALID_PLATFORMS: readonly Platform[] = ["discord", "misskey"] as const;

/**
 * Type guard: check if a string is a valid Platform identifier.
 */
export function isValidPlatform(value: string): value is Platform {
  return (VALID_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Attachment from a message (image, file, sticker, etc.)
 */
export interface Attachment {
  /** Unique identifier for this attachment (platform-specific) */
  id: string;

  /** URL to access the attachment */
  url: string;

  /** MIME type (e.g., "image/png", "application/pdf") */
  mimeType: string;

  /** Original filename */
  filename: string;

  /** File size in bytes (if available) */
  size?: number;

  /** Width in pixels (for images/videos) */
  width?: number;

  /** Height in pixels (for images/videos) */
  height?: number;

  /** Whether this is an image type that could be sent as ContentBlock::Image */
  isImage: boolean;
}

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

  /** Attachments (images, files, stickers) associated with this message */
  attachments?: Attachment[];

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

  /** Attachments (images, files, stickers) associated with this message */
  attachments?: Attachment[];
}

/**
 * Context fetched from platform
 */
export interface PlatformContext {
  recentMessages: PlatformMessage[];
  relatedMessages?: PlatformMessage[];
}
