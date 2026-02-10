// src/core/spontaneous-target.ts

import { createLogger } from "@utils/logger.ts";
import type { Config } from "../types/config.ts";
import type { Platform } from "../types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

const logger = createLogger("SpontaneousTarget");

/**
 * Represents a target destination for a spontaneous post.
 */
export interface SpontaneousTarget {
  /** Channel ID to send the message to */
  channelId: string;
}

/**
 * Determine the target for a spontaneous post on Discord.
 * Randomly selects a channel or account from the whitelist.
 */
export async function determineDiscordTarget(
  adapter: PlatformAdapter,
  config: Config,
): Promise<SpontaneousTarget | null> {
  const discordEntries = config.accessControl.whitelist.filter(
    (entry) => entry.startsWith("discord/"),
  );

  if (discordEntries.length === 0) {
    logger.warn("No Discord whitelist entries available for spontaneous post");
    return null;
  }

  const selectedEntry = discordEntries[Math.floor(Math.random() * discordEntries.length)];
  const parts = selectedEntry.split("/");
  const type = parts[1]; // "account" or "channel"
  const id = parts[2];

  if (type === "channel") {
    logger.debug("Selected channel target", { channelId: id });
    return { channelId: id };
  }

  if (type === "account") {
    try {
      const dmChannelId = await (adapter as PlatformAdapter & {
        getDmChannelId(userId: string): Promise<string | null>;
      }).getDmChannelId(id);

      if (!dmChannelId) {
        logger.warn("Failed to create DM channel for user", { userId: id });
        return null;
      }
      logger.debug("Selected DM target", { userId: id, channelId: dmChannelId });
      return { channelId: dmChannelId };
    } catch (error) {
      logger.error("Failed to resolve DM channel", {
        userId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  logger.warn("Unknown whitelist entry type", { entry: selectedEntry });
  return null;
}

/**
 * Determine the target for a spontaneous post on Misskey.
 * Always returns the bot's own timeline (creates a new note).
 */
export function determineMisskeyTarget(): SpontaneousTarget {
  return { channelId: "timeline:self" };
}

/**
 * Determine the target for a spontaneous post on any platform.
 */
export async function determineSpontaneousTarget(
  platform: Platform,
  adapter: PlatformAdapter,
  config: Config,
): Promise<SpontaneousTarget | null> {
  switch (platform) {
    case "discord":
      return await determineDiscordTarget(adapter, config);
    case "misskey":
      return determineMisskeyTarget();
    default:
      logger.warn("Unsupported platform for spontaneous post", { platform });
      return null;
  }
}
