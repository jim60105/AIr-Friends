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

  /** Display name of the message author (platform-resolved) */
  username?: string;

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

  /**
   * The immediately quoted source note, when this message quotes one.
   * Third-party reference data: it never replaces the outer content, author,
   * identity or attachments described above.
   */
  quotedNote?: QuotedNote;

  /** Raw platform-specific data for reference */
  raw?: unknown;
}

/**
 * Original author of a quoted source note.
 */
export interface QuotedNoteAuthor {
  /** Author's user id on the configured instance */
  userId: string;

  /** Author's username (without the leading `@`) */
  username: string;

  /** Remote instance host, when the author is not local to the configured instance */
  host?: string;

  /** Author's display name, when the platform supplies one */
  displayName?: string;
}

/**
 * Why a quoted source note could not be materialized.
 *
 * - `not_loaded`: only the source id is known and no resolution was attempted yet
 * - `lookup_failed`: the source lookup failed (missing, inaccessible, rate-limited, 5xx)
 * - `timeout`: the source lookup exceeded the enrichment deadline and was aborted
 * - `budget_exhausted`: the enrichment deadline had already expired before this source
 * - `invalid_source`: the available source data was unusable or conflicted with the known id
 */
export type QuotedNoteUnavailableReason =
  | "not_loaded"
  | "lookup_failed"
  | "timeout"
  | "budget_exhausted"
  | "invalid_source";

/**
 * A materialized quoted source note.
 */
export interface AvailableQuotedNote {
  status: "available";

  /** Source note id on the configured instance */
  noteId: string;

  /** Validated HTTP(S) source URL, when the platform supplies or implies one */
  sourceUrl?: string;

  /** Original author of the source note */
  author: QuotedNoteAuthor;

  /** Source text; empty for an attachment-only or empty source note */
  content: string;

  /** Source attachments, kept separate from the outer message's attachments */
  attachments?: Attachment[];
}

/**
 * A quoted source note whose content is not available. Carries no fabricated
 * author, text or attachments.
 */
export interface UnavailableQuotedNote {
  status: "unavailable";

  /** Known source note id */
  noteId: string;

  /** Why the source content is unavailable */
  reason: QuotedNoteUnavailableReason;
}

/**
 * The immediately quoted source of a message, as typed third-party reference
 * data. Exactly one hop deep: a source's own quote is never represented.
 */
export type QuotedNote = AvailableQuotedNote | UnavailableQuotedNote;

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

  /**
   * The immediately quoted source note, when this message quotes one. Same
   * typed contract as `NormalizedEvent.quotedNote`.
   */
  quotedNote?: QuotedNote;
}

/**
 * Context fetched from platform
 */
export interface PlatformContext {
  recentMessages: PlatformMessage[];
  relatedMessages?: PlatformMessage[];
}
