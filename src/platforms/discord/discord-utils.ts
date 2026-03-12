// src/platforms/discord/discord-utils.ts

import type { GuildMember, Message, Sticker, User } from "discord.js";
import type { Attachment, NormalizedEvent, Platform, PlatformMessage } from "../../types/events.ts";

/**
 * Convert a Discord attachment to our Attachment type
 */
function discordAttachmentToAttachment(
  att: {
    id: string;
    url: string;
    contentType: string | null;
    name: string | null;
    size: number;
    width: number | null;
    height: number | null;
  },
): Attachment {
  return {
    id: att.id,
    url: att.url,
    mimeType: att.contentType ?? "application/octet-stream",
    filename: att.name ?? "unknown",
    size: att.size,
    width: att.width ?? undefined,
    height: att.height ?? undefined,
    isImage: att.contentType?.startsWith("image/") ?? false,
  };
}

/**
 * Format Discord stickers as text representation for context.
 * Stickers are separate from attachments and carry meaning (name/tags).
 */
function formatStickersAsText(stickers: Map<string, Sticker>): string {
  if (stickers.size === 0) return "";

  const parts = Array.from(stickers.values()).map((sticker) => {
    return sticker.tags
      ? `[Sticker: ${sticker.name} (${sticker.tags})]`
      : `[Sticker: ${sticker.name}]`;
  });

  return parts.join(" ");
}

/**
 * Convert Discord Message to NormalizedEvent
 */
export function normalizeDiscordMessage(
  message: Message,
  _botId: string,
): NormalizedEvent {
  const isDm = message.channel.isDMBased();

  const stickerText = formatStickersAsText(message.stickers);
  const content = stickerText
    ? (message.content ? `${message.content} ${stickerText}` : stickerText)
    : message.content;

  return {
    platform: "discord" as Platform,
    channelId: message.channelId,
    userId: message.author.id,
    username: message.author.displayName ?? message.author.username,
    messageId: message.id,
    isDm,
    guildId: message.guildId ?? "",
    content,
    timestamp: message.createdAt,
    attachments: message.attachments.size > 0
      ? Array.from(message.attachments.values()).map((att) => discordAttachmentToAttachment(att))
      : undefined,
    raw: message,
  };
}

/**
 * Convert Discord Message to PlatformMessage
 */
export function messageToPltatformMessage(
  message: Message,
  botId: string,
): PlatformMessage {
  const attachments = message.attachments.size > 0
    ? Array.from(message.attachments.values()).map((att) => discordAttachmentToAttachment(att))
    : undefined;

  const stickerText = formatStickersAsText(message.stickers);
  const content = stickerText
    ? (message.content ? `${message.content} ${stickerText}` : stickerText)
    : message.content;

  return {
    messageId: message.id,
    userId: message.author.id,
    username: message.author.displayName ?? message.author.username,
    content,
    timestamp: message.createdAt,
    isBot: message.author.id === botId || message.author.bot,
    attachments,
  };
}

/**
 * Check if message mentions the bot
 */
export function isBotMentioned(message: Message, botId: string): boolean {
  return message.mentions.users.has(botId);
}

/**
 * Remove bot mention from message content
 */
export function removeBotMention(content: string, botId: string): string {
  // Remove <@botId> or <@!botId> patterns
  return content
    .replace(new RegExp(`<@!?${botId}>`, "g"), "")
    .trim();
}

/**
 * Get display name for a user
 */
export function getDisplayName(
  user: User,
  member?: GuildMember | null,
): string {
  if (member?.displayName) {
    return member.displayName;
  }
  return user.displayName ?? user.username;
}

/**
 * Check if we should respond to this message
 */
export function shouldRespondToMessage(
  message: Message,
  botId: string,
  config: {
    allowDm: boolean;
    respondToMention: boolean;
    commandPrefix?: string;
  },
): boolean {
  // Never respond to bots
  if (message.author.bot) {
    return false;
  }

  // Never respond to self
  if (message.author.id === botId) {
    return false;
  }

  // Check DM
  if (message.channel.isDMBased()) {
    return config.allowDm;
  }

  // Check mention
  if (config.respondToMention && isBotMentioned(message, botId)) {
    return true;
  }

  // Check prefix
  if (config.commandPrefix && message.content.startsWith(config.commandPrefix)) {
    return true;
  }

  return false;
}

import type { ChannelConfig } from "../../types/config.ts";
import { parseChannelId } from "../../types/config.ts";

/**
 * Extract Discord channel IDs that have channelLurk enabled.
 * Only discord/channel/* type entries are valid for channel lurk.
 */
export function extractChannelLurkIds(channels: ChannelConfig[]): string[] {
  return channels
    .filter((ch) => {
      if (ch.enabled === false || !ch.channelLurk) return false;
      const parsed = parseChannelId(ch.id);
      return parsed?.platform === "discord" && parsed.type === "channel";
    })
    .map((ch) => parseChannelId(ch.id)!.value);
}

/**
 * Select a random Discord channel configured for spontaneous posting.
 * Returns the channel type and ID, or null if no valid targets exist.
 */
export function selectDiscordSpontaneousTarget(
  channels: ChannelConfig[],
): { type: string; id: string } | null {
  const targets = channels.filter((ch) => {
    if (ch.enabled === false || !ch.spontaneousPost) return false;
    const parsed = parseChannelId(ch.id);
    return parsed?.platform === "discord";
  });

  if (targets.length === 0) return null;

  const selected = targets[Math.floor(Math.random() * targets.length)];
  const parsed = parseChannelId(selected.id)!;
  return { type: parsed.type, id: parsed.value };
}
