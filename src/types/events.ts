// src/types/events.ts

/**
 * Supported platform identifiers
 */
export type Platform = "discord" | "misskey" | "email";

/** All valid platform identifiers, kept in sync with Platform type */
export const VALID_PLATFORMS: readonly Platform[] = ["discord", "misskey", "email"] as const;

/**
 * Type guard: check if a string is a valid Platform identifier.
 */
export function isValidPlatform(value: string): value is Platform {
  return (VALID_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Common properties shared across all attachment variants
 */
export interface BaseAttachment {
  /** Unique identifier for this attachment */
  id: string;

  /** MIME type (e.g., "image/png", "application/pdf") */
  mimeType: string;

  /** Original or sanitized filename */
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
 * Remote network attachment (Discord, Misskey, etc.)
 */
export interface NetworkAttachment extends BaseAttachment {
  kind?: "network";
  /** URL to access the attachment */
  url: string;
}

/**
 * Stored local email attachment reference (opaque owner/record/attachment IDs)
 */
export interface LocalEmailAttachment extends BaseAttachment {
  kind: "email-local";
  /** Owner userId whose mailbox stores this attachment */
  owner: string;
  /** Stored record ID within owner's mailbox */
  recordId: string;
  /** Attachment UUID within the stored email record */
  attachmentId: string;
  /** Materialized session path if prepared for the current session */
  sessionPath?: string;
}

/**
 * Attachment from a message (image, file, sticker, etc.)
 * Discriminated union between network attachments and local email attachments.
 */
export type Attachment = NetworkAttachment | LocalEmailAttachment;

/**
 * Type guard for LocalEmailAttachment
 */
export function isLocalEmailAttachment(att: Attachment): att is LocalEmailAttachment {
  return (att as LocalEmailAttachment).kind === "email-local";
}

/**
 * Type guard for NetworkAttachment
 */
export function isNetworkAttachment(att: Attachment): att is NetworkAttachment {
  return att.kind !== "email-local" && typeof (att as NetworkAttachment).url === "string";
}

/**
 * Internal typed email work receipt (owned by `email-session-receipts`).
 *
 * Bound to a mailbox entry that the poller (`email-poll-recovery`) already
 * accepted durably, and to the hand-off workId it emitted: the session
 * lifecycle records the journal `started` fence under that workId before the
 * agent acts, and the explicit terminal outcome afterwards. It lives on the
 * common event type because the platform adapter hands accepted email work to
 * the same normalized-event entry point as every other platform, but it is
 * ONLY ever set for email work — Discord and Misskey events never carry it.
 */
export interface EmailWorkReceipt {
  /** Typed discriminant; only `"email-work"` marks receipt-bearing work. */
  kind: "email-work";
  /** Hand-off work id; recorded as the journal `started` receipt. */
  workId: string;
  /** Durable mailbox identity of the accepted source entry. */
  mailboxKey: {
    /** Mailbox fingerprint (`host=...;account=...;folder=...`). */
    fingerprint: string;
    /** IMAP UIDVALIDITY the entry belongs to. */
    uidValidity: number;
    /** IMAP UID of the accepted source message. */
    uid: number;
  };
  /** Durable message record id produced by the owner message store. */
  recordId: string;
}

/**
 * Type guard for the typed email work receipt discriminant.
 */
export function isEmailWorkReceipt(value: unknown): value is EmailWorkReceipt {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Partial<EmailWorkReceipt>;
  if (receipt.kind !== "email-work") return false;
  if (typeof receipt.workId !== "string" || receipt.workId.trim() === "") return false;
  if (typeof receipt.recordId !== "string" || receipt.recordId.trim() === "") return false;
  const key = receipt.mailboxKey;
  if (typeof key !== "object" || key === null) return false;
  const { fingerprint, uidValidity, uid } = key as {
    fingerprint?: unknown;
    uidValidity?: unknown;
    uid?: unknown;
  };
  return (
    typeof fingerprint === "string" &&
    fingerprint.trim() !== "" &&
    Number.isInteger(uidValidity) &&
    Number.isInteger(uid)
  );
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

  /**
   * Internal typed email work receipt for email-platform work accepted by the
   * mailbox poller. Absent for every non-email platform and for email events
   * that are not bound to an accepted mailbox record.
   */
  emailWork?: EmailWorkReceipt;

  /** Raw platform-specific data for reference */
  raw?: unknown;
}

/**
 * Resolves the typed email work receipt carried by an event, enforcing BOTH
 * discriminators: the event must come from the email platform AND carry a
 * well-formed receipt. Every receipt sink uses this single resolver, so no
 * Discord/Misskey event can ever reach the mailbox journal.
 */
export function emailWorkReceiptOf(event: NormalizedEvent): EmailWorkReceipt | undefined {
  if (event.platform !== "email") return undefined;
  return isEmailWorkReceipt(event.emailWork) ? event.emailWork : undefined;
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
