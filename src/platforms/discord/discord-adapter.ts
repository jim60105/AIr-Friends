// src/platforms/discord/discord-adapter.ts

import {
  ChannelType,
  Client,
  type DMChannel,
  type Message,
  type NewsChannel,
  REST,
  Routes,
  type TextChannel,
} from "discord.js";
import { createLogger } from "@utils/logger.ts";
import { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { Platform, PlatformMessage } from "../../types/events.ts";
import {
  ConnectionState,
  type PlatformCapabilities,
  type PlatformEmoji,
  type ReactionResult,
  type ReplyOptions,
  type ReplyResult,
} from "../../types/platform.ts";
import { ErrorCode, PlatformError } from "../../types/errors.ts";
import { DEFAULT_DISCORD_CONFIG, type DiscordAdapterConfig } from "./discord-config.ts";
import {
  isBotMentioned,
  messageToPltatformMessage,
  normalizeDiscordMessage,
  removeBotMention,
  shouldRespondToMessage,
} from "./discord-utils.ts";

const logger = createLogger("DiscordAdapter");

type TextBasedChannel = TextChannel | DMChannel | NewsChannel;

export class DiscordAdapter extends PlatformAdapter {
  readonly platform: Platform = "discord";
  readonly capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: true,
    supportsDm: true,
    supportsGuild: true,
    supportsReactions: true,
    maxMessageLength: 2000,
  };

  private readonly client: Client;
  private readonly config: Required<DiscordAdapterConfig>;
  private botId: string | null = null;
  private emojiCache: PlatformEmoji[] | null = null;
  private emojiCacheTimestamp = 0;
  private readonly EMOJI_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(config: DiscordAdapterConfig) {
    super();

    this.config = {
      ...DEFAULT_DISCORD_CONFIG,
      ...config,
    } as Required<DiscordAdapterConfig>;

    this.client = new Client({
      intents: this.config.intents,
      partials: this.config.partials,
    });

    this.setupEventHandlers();
  }

  /**
   * Set up Discord event handlers
   */
  private setupEventHandlers(): void {
    this.client.on("ready", async () => {
      this.botId = this.client.user?.id ?? null;
      this.updateConnectionState(ConnectionState.CONNECTED);

      logger.info("Discord bot ready as {username} (id: {botId})", {
        username: this.client.user?.username,
        botId: this.botId,
        guilds: this.client.guilds.cache.size,
      });

      // Cleanup all slash commands
      await this.cleanupSlashCommands();
    });

    this.client.on("messageCreate", async (message) => {
      await this.handleMessage(message);
    });

    this.client.on("error", (error) => {
      logger.error("Discord client error", {
        error: error.message,
      });
      this.updateConnectionState(ConnectionState.ERROR, error.message);
    });

    this.client.on("disconnect", () => {
      logger.warn("Discord client disconnected");
      this.updateConnectionState(ConnectionState.DISCONNECTED);
    });

    this.client.on("reconnecting", () => {
      logger.info("Discord client reconnecting");
      this.updateConnectionState(ConnectionState.RECONNECTING);
    });
  }

  /**
   * Cleanup all slash commands (global and guild-based)
   */
  private async cleanupSlashCommands(): Promise<void> {
    if (!this.botId) {
      logger.warn("Cannot cleanup commands: bot ID not set");
      return;
    }

    const rest = new REST().setToken(this.config.token);

    try {
      // Delete all global commands
      logger.info("Deleting all global slash commands");
      await rest.put(Routes.applicationCommands(this.botId), { body: [] });
      logger.info("Successfully deleted all global slash commands");
    } catch (error) {
      logger.error("Failed to delete global commands", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Delete guild-based commands for all guilds
    const guilds = this.client.guilds.cache;
    for (const [guildId, guild] of guilds) {
      try {
        logger.info("Deleting slash commands for guild", {
          guildId,
          guildName: guild.name,
        });
        await rest.put(Routes.applicationGuildCommands(this.botId, guildId), { body: [] });
        logger.info("Successfully deleted all guild commands", {
          guildId,
          guildName: guild.name,
        });
      } catch (error) {
        logger.error("Failed to delete guild commands", {
          guildId,
          guildName: guild.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: Message): Promise<void> {
    if (!this.botId) {
      logger.warn("Received message before bot ID was set");
      return;
    }

    // Check if we should respond
    if (
      !shouldRespondToMessage(message, this.botId, {
        allowDm: this.config.allowDm,
        respondToMention: this.config.respondToMention,
        commandPrefix: this.config.commandPrefix,
      })
    ) {
      return;
    }

    // Check guild filter
    if (
      this.config.guildIds &&
      this.config.guildIds.length > 0 &&
      message.guildId &&
      !this.config.guildIds.includes(message.guildId)
    ) {
      return;
    }

    logger.debug("Processing message", {
      messageId: message.id,
      channelId: message.channelId,
      isDm: message.channel.isDMBased(),
    });

    // Normalize and emit event
    const normalizedEvent = normalizeDiscordMessage(message, this.botId);

    // Clean up content (remove bot mention if present)
    if (isBotMentioned(message, this.botId)) {
      normalizedEvent.content = removeBotMention(normalizedEvent.content, this.botId);
    }

    await this.emitEvent(normalizedEvent);
  }

  /**
   * Connect to Discord
   */
  async connect(): Promise<void> {
    logger.info("Connecting to Discord");
    this.updateConnectionState(ConnectionState.CONNECTING);

    try {
      await this.client.login(this.config.token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateConnectionState(ConnectionState.ERROR, message);

      throw new PlatformError(
        ErrorCode.PLATFORM_AUTH_FAILED,
        `Failed to connect to Discord: ${message}`,
        { platform: this.platform },
      );
    }
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    logger.info("Disconnecting from Discord");

    try {
      await this.client.destroy();
      this.updateConnectionState(ConnectionState.DISCONNECTED);
    } catch (error) {
      logger.error("Error during Discord disconnect", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Send a reply to a channel
   */
  async sendReply(
    channelId: string,
    content: string,
    options?: ReplyOptions,
  ): Promise<ReplyResult> {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !this.isTextBasedChannel(channel)) {
        return {
          success: false,
          error: "Channel not found or not text-based",
        };
      }

      // Truncate content if necessary
      const truncatedContent = content.length > this.capabilities.maxMessageLength
        ? content.slice(0, this.capabilities.maxMessageLength - 3) + "..."
        : content;

      // Send reply
      const messageOptions: { content: string; reply?: { messageReference: string } } = {
        content: truncatedContent,
      };

      if (options?.replyToMessageId) {
        messageOptions.reply = {
          messageReference: options.replyToMessageId,
        };
      }

      const sentMessage = await channel.send(messageOptions);

      logger.debug("Reply sent", {
        channelId,
        messageId: sentMessage.id,
        contentLength: content.length,
      });

      return {
        success: true,
        messageId: sentMessage.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error("Failed to send reply", {
        channelId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch recent messages from a channel
   */
  async fetchRecentMessages(
    channelId: string,
    limit: number,
  ): Promise<PlatformMessage[]> {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !this.isTextBasedChannel(channel)) {
        throw new PlatformError(
          ErrorCode.PLATFORM_API_ERROR,
          "Channel not found or not text-based",
          { channelId },
        );
      }

      const messages = await channel.messages.fetch({ limit });

      // Convert and sort by timestamp (oldest first)
      const platformMessages = Array.from(messages.values())
        .map((msg) => messageToPltatformMessage(msg, this.botId!))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      logger.debug("Fetched recent messages", {
        channelId,
        count: platformMessages.length,
      });

      return platformMessages;
    } catch (error) {
      if (error instanceof PlatformError) throw error;

      throw new PlatformError(
        ErrorCode.PLATFORM_API_ERROR,
        `Failed to fetch messages: ${error instanceof Error ? error.message : String(error)}`,
        { channelId },
      );
    }
  }

  /**
   * Search messages in a guild (basic implementation using Discord's limited search)
   */
  override async searchRelatedMessages(
    guildId: string,
    channelId: string,
    query: string,
    limit: number,
  ): Promise<PlatformMessage[]> {
    // Discord doesn't have a public message search API for bots
    // This is a simplified implementation that searches recent messages
    // in the same channel
    try {
      const recentMessages = await this.fetchRecentMessages(channelId, 50);

      // Simple keyword matching
      const keywords = query.toLowerCase().split(/\s+/);
      const filtered = recentMessages.filter((msg) => {
        const content = msg.content.toLowerCase();
        return keywords.some((kw) => content.includes(kw));
      });

      return filtered.slice(0, limit);
    } catch (error) {
      logger.warn("Failed to search related messages", {
        guildId,
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Fetch available custom emojis from all guilds the bot is in and application emojis
   */
  async fetchEmojis(): Promise<PlatformEmoji[]> {
    const now = Date.now();
    if (this.emojiCache && (now - this.emojiCacheTimestamp) < this.EMOJI_CACHE_TTL_MS) {
      return this.emojiCache;
    }

    const emojis: PlatformEmoji[] = [];

    // Fetch guild emojis from cache
    for (const guild of this.client.guilds.cache.values()) {
      for (const emoji of guild.emojis.cache.values()) {
        if (!emoji.name || !emoji.id) continue;

        emojis.push({
          name: emoji.name,
          animated: emoji.animated ?? false,
          platformId: emoji.id,
          useInText: emoji.animated
            ? `<a:${emoji.name}:${emoji.id}>`
            : `<:${emoji.name}:${emoji.id}>`,
          useAsReaction: `${emoji.name}:${emoji.id}`,
        });
      }
    }

    // Fetch application emojis via REST API
    if (this.botId) {
      try {
        const rest = new REST().setToken(this.config.token);
        const response = await rest.get(Routes.applicationEmojis(this.botId)) as {
          items: Array<{ id: string; name: string; animated?: boolean }>;
        };

        const seenIds = new Set(emojis.map((e) => e.platformId));
        for (const emoji of response.items ?? []) {
          if (!emoji.name || !emoji.id || seenIds.has(emoji.id)) continue;

          emojis.push({
            name: emoji.name,
            animated: emoji.animated ?? false,
            platformId: emoji.id,
            useInText: emoji.animated
              ? `<a:${emoji.name}:${emoji.id}>`
              : `<:${emoji.name}:${emoji.id}>`,
            useAsReaction: `${emoji.name}:${emoji.id}`,
          });
        }
      } catch (error) {
        logger.warn("Failed to fetch application emojis", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.emojiCache = emojis;
    this.emojiCacheTimestamp = now;

    logger.debug("Fetched Discord emojis", { count: emojis.length });
    return emojis;
  }

  /**
   * Add a reaction to a Discord message
   * @param emoji - Unicode emoji character (e.g., "👍") or custom emoji "name:id" format
   */
  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<ReactionResult> {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !this.isTextBasedChannel(channel)) {
        return {
          success: false,
          error: "Channel not found or not text-based",
        };
      }

      const message = await channel.messages.fetch(messageId);
      await message.react(emoji);

      logger.debug("Reaction added", { channelId, messageId, emoji });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to add reaction", { channelId, messageId, emoji, error: errorMessage });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Edit an existing message
   */
  async editMessage(
    channelId: string,
    messageId: string,
    newContent: string,
    _replyToMessageId?: string,
  ): Promise<ReplyResult> {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !this.isTextBasedChannel(channel)) {
        return {
          success: false,
          error: "Channel not found or not text-based",
        };
      }

      const truncatedContent = newContent.length > this.capabilities.maxMessageLength
        ? newContent.slice(0, this.capabilities.maxMessageLength - 3) + "..."
        : newContent;

      const message = await channel.messages.fetch(messageId);
      await message.edit({ content: truncatedContent });

      logger.debug("Message edited", {
        channelId,
        messageId,
        contentLength: newContent.length,
      });

      return {
        success: true,
        messageId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to edit message", {
        channelId,
        messageId,
        error: errorMessage,
      });
      return {
        success: false,
        error: `Failed to edit message: ${errorMessage}`,
      };
    }
  }

  /**
   * Get or create a DM channel with a user.
   * Used by spontaneous posting to send DMs to whitelisted accounts.
   */
  async getDmChannelId(userId: string): Promise<string | null> {
    try {
      const user = await this.client.users.fetch(userId);
      const dmChannel = await user.createDM();
      return dmChannel.id;
    } catch (error) {
      logger.error("Failed to create DM channel", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get username for a user ID
   */
  async getUsername(userId: string): Promise<string> {
    try {
      const user = await this.client.users.fetch(userId);
      return user.displayName ?? user.username;
    } catch {
      return userId;
    }
  }

  /**
   * Check if a user ID is the bot itself
   */
  isSelf(userId: string): boolean {
    return userId === this.botId;
  }

  /**
   * Type guard for text-based channels
   */
  private isTextBasedChannel(channel: unknown): channel is TextBasedChannel {
    if (!channel || typeof channel !== "object") return false;
    const ch = channel as { type?: ChannelType };
    return (
      ch.type === ChannelType.GuildText ||
      ch.type === ChannelType.DM ||
      ch.type === ChannelType.GuildAnnouncement
    );
  }

  /**
   * Get the bot user ID
   */
  getBotId(): string | null {
    return this.botId;
  }
}
