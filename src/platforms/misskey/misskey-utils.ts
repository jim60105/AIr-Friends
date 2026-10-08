// src/platforms/misskey/misskey-utils.ts

import type { entities } from "misskey-js";
import type {
  Attachment,
  AvailableQuotedNote,
  NormalizedEvent,
  Platform,
  PlatformMessage,
  QuotedNote,
  QuotedNoteAuthor,
} from "../../types/events.ts";

/**
 * Misskey Note type (using misskey-js entities)
 */
export type MisskeyNote = entities.Note;

/**
 * Misskey ChatMessage type (using misskey-js entities)
 */
export type MisskeyMessage = entities.ChatMessage;

/**
 * Misskey chat message as returned by the 1-on-1 chat endpoints
 * (`chat/messages/create-to-user`, `chat/messages/user-timeline`).
 *
 * Those responses carry only `fromUserId`; the optional `fromUser` keeps them
 * usable through the same helpers as the streaming `newChatMessage` payload
 * (`entities.ChatMessage`), which does carry the sender.
 */
export type ChatMessageLite = entities.ChatMessageLiteFor1on1 & {
  fromUser?: Pick<entities.UserLite, "id" | "name" | "username" | "isBot"> | null;
};

/**
 * Convert one Drive file to the platform-neutral attachment shape.
 *
 * Shared by the outer message conversions and the quoted-source conversion so
 * both describe the same file the same way.
 */
function driveFileToAttachment(file: entities.DriveFile): Attachment {
  // A malformed remote payload must not throw here: the MIME type decides
  // `isImage`, and an absent type would otherwise fail on `.startsWith`.
  const mimeType = typeof file.type === "string" ? file.type : "";

  return {
    id: file.id,
    url: file.url,
    mimeType,
    filename: file.name,
    size: file.size,
    width: file.properties?.width ?? undefined,
    height: file.properties?.height ?? undefined,
    isImage: mimeType.startsWith("image/"),
  };
}

/**
 * Map a note's Drive files to attachments, tolerating malformed entries.
 *
 * Quoted-source data is untrusted, so a broken file list degrades to "no
 * attachment metadata" instead of failing the whole conversion.
 */
function mapDriveFiles(files: unknown): Attachment[] {
  if (!Array.isArray(files)) return [];

  try {
    return files.map((file) => driveFileToAttachment(file as entities.DriveFile));
  } catch {
    return [];
  }
}

/**
 * A usable HTTP(S) URL candidate, kept verbatim.
 *
 * Values that are not absolute http/https URLs with a host (including malformed
 * strings such as `https://` and non-HTTP schemes) are omitted.
 */
function httpUrl(candidate: unknown): string | undefined {
  if (typeof candidate !== "string" || candidate.length === 0) return undefined;

  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) {
      return candidate;
    }
  } catch {
    // Not an absolute URL; fall through to the next candidate.
  }

  return undefined;
}

/**
 * The source note's own author, or `undefined` when the identity is incomplete.
 */
function quotedNoteAuthor(note: entities.Note): QuotedNoteAuthor | undefined {
  const user = note.user;
  if (typeof user?.id !== "string" || user.id.length === 0) return undefined;
  if (typeof user.username !== "string" || user.username.length === 0) return undefined;

  return {
    userId: user.id,
    username: user.username,
    ...(typeof user.host === "string" && user.host.length > 0 ? { host: user.host } : {}),
    ...(typeof user.name === "string" && user.name.length > 0 ? { displayName: user.name } : {}),
  };
}

/**
 * The source note's URL: its remote `uri` first, then its local-instance `url`,
 * then a URL derived from the configured instance origin and the local id.
 *
 * These URLs are metadata only; nothing in this change fetches them.
 */
function quotedNoteSourceUrl(
  note: entities.Note,
  instanceOrigin?: string,
): string | undefined {
  const supplied = httpUrl(note.uri) ?? httpUrl(note.url);
  if (supplied !== undefined) return supplied;
  if (!instanceOrigin || typeof note.id !== "string" || note.id.length === 0) return undefined;

  return httpUrl(`${instanceOrigin.replace(/\/+$/, "")}/notes/${encodeURIComponent(note.id)}`);
}

/**
 * Convert a source note to an available reference, or `undefined` when its own
 * identity is unusable.
 *
 * The source's own text is never appended to the outer content and its own
 * quote is never expanded (one hop only).
 */
export function toAvailableQuotedNote(
  note: entities.Note,
  instanceOrigin?: string,
): AvailableQuotedNote | undefined {
  const author = quotedNoteAuthor(note);
  if (typeof note.id !== "string" || note.id.length === 0 || !author) return undefined;

  const sourceUrl = quotedNoteSourceUrl(note, instanceOrigin);
  const attachments = mapDriveFiles(note.files);

  return {
    status: "available",
    noteId: note.id,
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    author,
    content: typeof note.text === "string" ? note.text : "",
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

/**
 * Extract the immediately quoted source of a Misskey note (design D1).
 *
 * A reference is produced only for a note that both quotes another note and has
 * its own text or files; a pure renote keeps its previous behavior and triggers
 * no source work. Embedded source data is preferred and needs no request.
 * `not_loaded` is produced only when an authoritative `renoteId` exists, which
 * is what makes a reference eligible for the bounded single lookup.
 */
export function extractQuotedNote(
  note: entities.Note,
  instanceOrigin?: string,
): QuotedNote | undefined {
  const hasOwnContent = (typeof note.text === "string" && note.text.length > 0) ||
    (Array.isArray(note.files) && note.files.length > 0);
  if (!hasOwnContent) return undefined;

  const authoritativeId = typeof note.renoteId === "string" && note.renoteId.length > 0
    ? note.renoteId
    : undefined;
  const embedded = typeof note.renote === "object" && note.renote !== null
    ? note.renote
    : undefined;
  if (authoritativeId === undefined && embedded === undefined) return undefined;

  const embeddedId = typeof embedded?.id === "string" && embedded.id.length > 0
    ? embedded.id
    : undefined;
  // Validate the embedded identity against the authoritative id when both are
  // known, so a conflicting id never becomes source content.
  const usableEmbedded = embeddedId !== undefined &&
    quotedNoteAuthor(embedded!) !== undefined &&
    (authoritativeId === undefined || embeddedId === authoritativeId);

  if (usableEmbedded) return toAvailableQuotedNote(embedded!, instanceOrigin);

  if (authoritativeId !== undefined) {
    return { status: "unavailable", noteId: authoritativeId, reason: "not_loaded" };
  }

  // Unusable embedded data with no authoritative id to look up: the reference
  // is reported as invalid and is not lookup-eligible.
  return embeddedId === undefined
    ? undefined
    : { status: "unavailable", noteId: embeddedId, reason: "invalid_source" };
}

/**
 * Convert Misskey Note to NormalizedEvent
 */
export function normalizeMisskeyNote(
  note: MisskeyNote,
  _botId: string,
  isDm: boolean,
  instanceOrigin?: string,
): NormalizedEvent {
  const quotedNote = extractQuotedNote(note, instanceOrigin);

  return {
    platform: "misskey" as Platform,
    channelId: isDm ? `dm:${note.userId}` : `note:${note.id}`,
    userId: note.userId,
    username: note.user.name ?? note.user.username,
    messageId: note.id,
    isDm,
    guildId: "", // Misskey doesn't have guilds
    content: note.text ?? "",
    timestamp: new Date(note.createdAt),
    attachments: (note.files ?? []).length > 0 ? mapDriveFiles(note.files) : undefined,
    ...(quotedNote === undefined ? {} : { quotedNote }),
    raw: note,
  };
}

/**
 * Convert Misskey Note to PlatformMessage
 */
export function noteToPlatformMessage(
  note: MisskeyNote,
  botId: string,
  instanceOrigin?: string,
): PlatformMessage {
  const displayName = note.user.name ?? note.user.username;

  const attachments = mapDriveFiles(note.files);
  const quotedNote = extractQuotedNote(note, instanceOrigin);

  return {
    messageId: note.id,
    userId: note.userId,
    username: `@${displayName}`,
    content: note.text ?? "",
    timestamp: new Date(note.createdAt),
    isBot: note.userId === botId || !!note.user.isBot,
    attachments: attachments.length > 0 ? attachments : undefined,
    ...(quotedNote === undefined ? {} : { quotedNote }),
  };
}

// Escape regex metacharacters so a remote-supplied username cannot inject
// metacharacters or trigger a pathological (ReDoS) pattern when embedded in
// a RegExp. Escaping keeps every legitimate username functional (dots, etc.)
// while neutralizing the ReDoS risk.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitize a username for safe use inside a regular expression.
 * Returns the username with its metacharacters escaped, or null when empty.
 */
export function sanitizeMentionUsername(
  username: string | null | undefined,
): string | null {
  if (!username) return null;
  return escapeRegExp(username);
}

/**
 * Check if a note is a mention to the bot
 */
export function isMentionToBot(
  note: MisskeyNote,
  botUsername: string,
): boolean {
  const safeName = sanitizeMentionUsername(botUsername);
  if (!note.text || !safeName) return false;

  // Check for @username mention
  const mentionPattern = new RegExp(`@${safeName}(?:@[\\w.-]+)?\\b`, "i");
  return mentionPattern.test(note.text);
}

/**
 * Remove bot mention from note text
 */
export function removeBotMention(
  text: string,
  botUsername: string,
): string {
  const safeName = sanitizeMentionUsername(botUsername);
  if (!safeName) return text;
  const mentionPattern = new RegExp(`@${safeName}(?:@[\\w.-]+)?\\s*`, "gi");
  return text.replace(mentionPattern, "").trim();
}

/**
 * Check if a note is a direct message (specified visibility)
 */
export function isDirectMessage(note: MisskeyNote): boolean {
  return note.visibility === "specified";
}

/**
 * Check if we should respond to this note
 */
export function shouldRespondToNote(
  note: MisskeyNote,
  botId: string,
  botUsername: string,
  config: {
    allowDm: boolean;
    respondToMention: boolean;
  },
): boolean {
  // Never respond to self
  if (note.userId === botId) {
    return false;
  }

  // Never respond to bots
  if (note.user.isBot) {
    return false;
  }

  // Check DM
  if (isDirectMessage(note)) {
    return config.allowDm;
  }

  // Check mention
  if (config.respondToMention && isMentionToBot(note, botUsername)) {
    return true;
  }

  return false;
}

/**
 * Build reply visibility and parameters
 */
export function buildReplyParams(
  originalNote: MisskeyNote,
): {
  visibility: "public" | "home" | "followers" | "specified";
  visibleUserIds?: string[];
} {
  // For DMs, reply with specified visibility
  if (originalNote.visibility === "specified") {
    return {
      visibility: "specified",
      visibleUserIds: [originalNote.userId],
    };
  }

  // For other notes, use the same visibility level
  return {
    visibility: originalNote.visibility,
  };
}

/**
 * Convert Misskey ChatMessage to NormalizedEvent
 */
export function normalizeMisskeyChatMessage(
  message: MisskeyMessage,
  _botId: string,
): NormalizedEvent {
  return {
    platform: "misskey" as Platform,
    channelId: `chat:${message.fromUserId}`,
    userId: message.fromUserId,
    username: message.fromUser?.name ?? message.fromUser?.username ?? message.fromUserId,
    messageId: message.id,
    isDm: true, // Chat messages are always DMs
    guildId: "", // Misskey doesn't have guilds
    content: message.text ?? "",
    timestamp: new Date(message.createdAt),
    attachments: message.file ? [driveFileToAttachment(message.file)] : undefined,
    raw: message,
  };
}

/**
 * Convert Misskey ChatMessage to PlatformMessage
 */
export function chatMessageToPlatformMessage(
  message: MisskeyMessage | ChatMessageLite,
  botId: string,
): PlatformMessage {
  // Handle both full ChatMessage and lite versions from API
  const fromUser = message.fromUser;
  const displayName = fromUser?.name ?? fromUser?.username ?? message.fromUserId;

  // Extract file attachment if present
  const attachments: Attachment[] = [];
  const file = message.file;
  if (file) {
    attachments.push(driveFileToAttachment(file));
  }

  return {
    messageId: message.id,
    userId: message.fromUserId,
    username: `@${displayName}`,
    content: message.text ?? "",
    timestamp: new Date(message.createdAt),
    isBot: message.fromUserId === botId || !!fromUser?.isBot,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

/**
 * Check if we should respond to this chat message
 */
export function shouldRespondToChatMessage(
  message: MisskeyMessage,
  botId: string,
  config: {
    allowDm: boolean;
  },
): boolean {
  // Never respond to self
  if (message.fromUserId === botId) {
    return false;
  }

  // Never respond to bots
  if (message.fromUser?.isBot) {
    return false;
  }

  // Chat messages are always DMs
  return config.allowDm;
}
