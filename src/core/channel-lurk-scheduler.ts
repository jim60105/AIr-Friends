// src/core/channel-lurk-scheduler.ts

import { createLogger } from "@utils/logger.ts";
import type { ChannelLurkConfig } from "../types/config.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PlatformMessage } from "../types/events.ts";

const logger = createLogger("ChannelLurkScheduler");

/**
 * Target information for a channel lurk trigger.
 */
export interface ChannelLurkTarget {
  platform: string;
  channelId: string;
}

/**
 * Callback invoked when a channel lurk trigger fires.
 */
export type ChannelLurkCallback = (
  target: ChannelLurkTarget,
  lastMessage: PlatformMessage,
) => Promise<void> | void;

/**
 * Extract Discord channel IDs from whitelist entries.
 */
export function extractDiscordChannelIds(whitelist: string[]): string[] {
  return whitelist
    .filter((entry) => entry.startsWith("discord/channel/"))
    .map((entry) => entry.replace("discord/channel/", ""));
}

/**
 * Periodically checks whitelisted Discord channels and triggers a callback
 * when the last message meets all conditions for a lurk reply.
 */
export class ChannelLurkScheduler {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private lastProcessedMessageId: Map<string, string> = new Map();

  constructor(
    private readonly config: ChannelLurkConfig,
    private readonly adapter: PlatformAdapter,
    private readonly channels: string[],
    private readonly callback: ChannelLurkCallback,
  ) {}

  start(): void {
    if (!this.config.enabled) return;

    logger.info("Channel lurk scheduler started", {
      channelCount: this.channels.length,
      intervalMs: this.config.intervalMs,
    });

    this.scheduleNext();
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    logger.info("Channel lurk scheduler stopped");
  }

  private scheduleNext(): void {
    if (!this.config.enabled) return;

    this.timer = setTimeout(() => {
      this.execute().catch((error) => {
        logger.error("Channel lurk execution failed", {
          error: (error as Error).message,
        });
      });
    }, this.config.intervalMs);
  }

  private async execute(): Promise<void> {
    if (this.running) {
      logger.info("Skipping channel lurk — previous execution still running");
      this.scheduleNext();
      return;
    }

    this.running = true;
    try {
      for (const channelId of this.channels) {
        try {
          await this.checkChannel(channelId);
        } catch (error) {
          logger.error("Channel lurk check failed for {channelId}", {
            channelId,
            error: (error as Error).message,
          });
        }
      }
    } finally {
      this.running = false;
      this.scheduleNext();
    }
  }

  private async checkChannel(channelId: string): Promise<void> {
    const messages = await this.adapter.fetchRecentMessages(channelId, 1);
    if (messages.length === 0) return;

    const lastMessage = messages[0];

    // Check if already processed this message
    if (this.lastProcessedMessageId.get(channelId) === lastMessage.messageId) {
      return;
    }

    // Condition 1: not from bot itself
    if (this.adapter.isSelf(lastMessage.userId)) return;

    // Condition 2: not mentioning the bot
    if (await this.adapter.hasBotMention(channelId, lastMessage.messageId)) return;

    // Condition 3: bot hasn't reacted to this message
    if (await this.adapter.hasBotReaction(channelId, lastMessage.messageId)) return;

    // All conditions passed
    this.lastProcessedMessageId.set(channelId, lastMessage.messageId);

    logger.info("Channel lurk triggered for {channelId} by message {messageId}", {
      channelId,
      messageId: lastMessage.messageId,
    });

    await this.callback({ platform: "discord", channelId }, lastMessage);
  }
}
