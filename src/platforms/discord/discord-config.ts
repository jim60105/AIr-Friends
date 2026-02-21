// src/platforms/discord/discord-config.ts

import { GatewayIntentBits, Partials } from "discord.js";

/**
 * Discord adapter configuration
 */
export interface DiscordAdapterConfig {
  /** Bot token */
  token: string;

  /** Gateway intents to enable */
  intents?: GatewayIntentBits[];

  /** Partials to enable (for DM support) */
  partials?: Partials[];

  /** Specific guild IDs to operate in (empty = all guilds) */
  guildIds?: string[];

  /** Whether to respond to DMs */
  allowDm?: boolean;

  /** Whether to respond when mentioned */
  respondToMention?: boolean;

  /** Prefix for command triggering (optional) */
  commandPrefix?: string;

  /** Typing indicator configuration */
  typingIndicator?: {
    enabled: boolean;
  };
}

/**
 * Default Discord configuration
 */
export const DEFAULT_DISCORD_CONFIG: Partial<DiscordAdapterConfig> = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel, // Required for DM support
    Partials.Message,
  ],
  allowDm: true,
  respondToMention: true,
};

/** Discord IDs are Snowflake format: 17-20 digit integers */
export const DISCORD_WHITELIST_PATTERN = /^discord\/(account|channel)\/\d{17,20}$/;
