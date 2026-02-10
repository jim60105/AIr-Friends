// src/platforms/misskey/misskey-utils.ts

import type { entities } from "misskey-js";
import type { NormalizedEvent, Platform, PlatformMessage } from "../../types/events.ts";

/**
 * Misskey Note type (using misskey-js entities)
 */
export type MisskeyNote = entities.Note;

/**
 * Misskey ChatMessage type (using misskey-js entities)
 */
export type MisskeyMessage = entities.ChatMessage;

/**
 * Misskey ChatMessageLiteFor1on1 type for API responses
 * The API returns a lighter version without full user objects
 */
export interface ChatMessageLite {
  id: string;
  createdAt: string;
  fromUserId: string;
  fromUser?: {
    id: string;
    name: string | null;
    username: string;
    isBot?: boolean;
  };
  toUserId: string;
  text: string | null;
  fileId: string | null;
  file?: unknown;
  reactions: Array<{ reaction: string }>;
}

/**
 * Convert Misskey Note to NormalizedEvent
 */
export function normalizeMisskeyNote(
  note: MisskeyNote,
  _botId: string,
  isDm: boolean,
): NormalizedEvent {
  return {
    platform: "misskey" as Platform,
    channelId: isDm ? `dm:${note.userId}` : `note:${note.id}`,
    userId: note.userId,
    messageId: note.id,
    isDm,
    guildId: "", // Misskey doesn't have guilds
    content: note.text ?? "",
    timestamp: new Date(note.createdAt),
    raw: note,
  };
}

/**
 * Convert Misskey Note to PlatformMessage
 */
export function noteToPlatformMessage(
  note: MisskeyNote,
  botId: string,
): PlatformMessage {
  const displayName = note.user.name ?? note.user.username;
  const formattedUsername = `@${displayName} (${note.userId})`;

  return {
    messageId: note.id,
    userId: note.userId,
    username: formattedUsername,
    content: note.text ?? "",
    timestamp: new Date(note.createdAt),
    isBot: note.userId === botId || !!note.user.isBot,
  };
}

/**
 * Check if a note is a mention to the bot
 */
export function isMentionToBot(
  note: MisskeyNote,
  botUsername: string,
): boolean {
  if (!note.text) return false;

  // Check for @username mention
  const mentionPattern = new RegExp(`@${botUsername}(?:@[\\w.-]+)?\\b`, "i");
  return mentionPattern.test(note.text);
}

/**
 * Remove bot mention from note text
 */
export function removeBotMention(
  text: string,
  botUsername: string,
): string {
  const mentionPattern = new RegExp(`@${botUsername}(?:@[\\w.-]+)?\\s*`, "gi");
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
    messageId: message.id,
    isDm: true, // Chat messages are always DMs
    guildId: "", // Misskey doesn't have guilds
    content: message.text ?? "",
    timestamp: new Date(message.createdAt),
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
  const formattedUsername = `@${displayName} (${message.fromUserId})`;

  return {
    messageId: message.id,
    userId: message.fromUserId,
    username: formattedUsername,
    content: message.text ?? "",
    timestamp: new Date(message.createdAt),
    isBot: message.fromUserId === botId || !!fromUser?.isBot,
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
