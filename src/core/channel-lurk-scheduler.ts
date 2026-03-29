// src/core/channel-lurk-scheduler.ts

import type { ChannelLurkConfig } from "../types/config.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PlatformMessage } from "../types/events.ts";
import { BaseScheduler } from "@core/base-scheduler.ts";

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
 * Periodically checks whitelisted Discord channels and triggers a callback
 * when the last message meets all conditions for a lurk reply.
 */
export class ChannelLurkScheduler extends BaseScheduler {
  private lastProcessedMessageId: Map<string, string> = new Map();

  constructor(
    private readonly config: ChannelLurkConfig,
    private readonly adapter: PlatformAdapter,
    private readonly channels: string[],
    private readonly callback: ChannelLurkCallback,
  ) {
    super();
  }

  protected isEnabled(): boolean {
    return this.config.enabled;
  }

  protected getNextDelayMs(): number {
    return this.config.intervalMs;
  }

  protected getMaxIntervalMs(): number {
    return this.config.intervalMs;
  }

  protected getStateKey(): string {
    return "channelLurk";
  }

  protected override onStarted(): void {
    this.logger.info("Channel lurk scheduler started", {
      channelCount: this.channels.length,
      intervalMs: this.config.intervalMs,
    });
  }

  protected async executeCallback(): Promise<void> {
    for (const channelId of this.channels) {
      try {
        await this.checkChannel(channelId);
      } catch (error) {
        this.logger.error("Channel lurk check failed for {channelId}", {
          channelId,
          error: (error as Error).message,
        });
      }
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

    this.logger.info("Channel lurk triggered for {channelId} by message {messageId}", {
      channelId,
      messageId: lastMessage.messageId,
    });

    await this.callback({ platform: this.adapter.platform, channelId }, lastMessage);
  }
}
