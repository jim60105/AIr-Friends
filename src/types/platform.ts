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

  /**
   * Whether the platform can edit an already-sent message in place.
   *
   * Optional for backward compatibility. Discord and Misskey declare `true`
   * explicitly; email declares `false`, and email's edit-reply path fails
   * explicitly instead of emulating an edit by sending another message.
   */
  supportsEditing?: boolean;

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

  /**
   * Host-assigned email operation context. Required by email adapters; ignored
   * by every other platform. Never read from `platformSpecific`.
   */
  emailSend?: EmailSendContext;

  /** Additional platform-specific options */
  platformSpecific?: Record<string, unknown>;
}

/**
 * Submission lifecycle phases for durable email operations.
 */
export type EmailSubmissionPhase =
  | "prepared"
  | "submitting"
  | "submitted"
  | "failed"
  | "unknown";

export interface EmailSubmissionMetadata {
  operationId: string;
  phase: EmailSubmissionPhase;
  targetKind?: "user" | "third-party";
  sentCopy?: "pending" | "appended" | "failed";
  safeCode?: string;
}

/**
 * Host-assigned operation context for one email send.
 *
 * It is supplied ONLY by the host session/scheduler that owns the durable work
 * item (never by the model or by a tool request's `platformSpecific` data), and
 * it is what binds an outgoing mail to its logical operation:
 *
 * - `workId`: the durable work/session id the host recorded before the agent
 *   acted (for inbound mail, the mailbox hand-off workId carried by the event's
 *   typed email receipt).
 * - `owner`: the mailbox owner (`e_<sha256>`) the send belongs to. It must match
 *   the owner encoded in the channel id.
 * - `actionSlot`: the host-assigned operation slot. When omitted, the adapter
 *   binds the ordinary slot for the send kind (`reply` for ordinary replies,
 *   `files` for file deliveries) so a reply and a file delivery in one session
 *   can never share one operation key. A caller performing several sends for the
 *   same `workId` MUST give each send a distinct slot.
 */
export interface EmailSendContext {
  workId: string;
  actionSlot?: string;
  owner: string;
}

/**
 * Result of sending a reply
 */
export interface ReplyResult {
  success: boolean;
  messageId?: string;
  error?: string;
  emailSubmission?: EmailSubmissionMetadata;
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

  /**
   * Misskey: the instance flags this emoji as sensitive (NSFW), so some
   * contexts (e.g. non-sensitive-only reaction acceptance) reject it as a
   * reaction.
   */
  isSensitive?: boolean;

  /**
   * Misskey: the emoji is intended for local users only. Metadata only — it is
   * not a reaction restriction.
   */
  localOnly?: boolean;

  /**
   * Misskey: role IDs allowed to use this emoji as a reaction. Absent or empty
   * means unrestricted; a non-empty array means emojis outside those roles
   * cannot react with it.
   */
  roleIdsThatCanBeUsedThisEmojiAsReaction?: string[];
}

/**
 * A single file to send via the send-file skill
 */
export interface SendFilePayload {
  /** File content bytes */
  content: Uint8Array;
  /** File name for the attachment */
  fileName: string;
}

/**
 * Options for sending a file to a channel
 */
export interface SendFileOptions {
  /** Reply to a specific message (thread) */
  replyToMessageId?: string;
  /** Optional text message to accompany the file */
  comment?: string;
  /**
   * Host-assigned email operation context. Required by email adapters; ignored
   * by every other platform. Never read from any platform-specific data.
   */
  emailSend?: EmailSendContext;
}

/**
 * Result of sending a file
 */
export interface SendFileResult {
  success: boolean;
  /** Last delivered message ID (backward-compatible field for logs/result consumers) */
  messageId?: string;
  /** All delivered message IDs, in send order (multi-file/partial delivery) */
  messageIds?: string[];
  error?: string;
  emailSubmission?: EmailSubmissionMetadata;
}

/**
 * Result of adding a reaction to a message
 */
export interface ReactionResult {
  success: boolean;
  error?: string;

  /**
   * The reaction the server actually stored, as reported by a post-send
   * readback (Misskey note reactions). Present only when verification ran and
   * found a stored reaction; a value different from the requested emoji means
   * the server downgraded it.
   */
  storedReaction?: string;

  /**
   * `false` when post-send verification was attempted but could not confirm the
   * stored reaction (readback failed, or the readback reported no reaction).
   * A confirmed readback reports `true`; platforms without verification leave
   * this undefined.
   */
  verified?: boolean;
}
