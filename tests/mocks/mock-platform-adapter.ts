// tests/mocks/mock-platform-adapter.ts

import { PlatformAdapter } from "../../src/platforms/platform-adapter.ts";
import type { NormalizedEvent, Platform, PlatformMessage } from "../../src/types/events.ts";
import {
  ConnectionState,
  PlatformCapabilities,
  type PlatformEmoji,
  type ReactionResult,
  type ReplyOptions,
  type ReplyResult,
} from "../../src/types/platform.ts";

/**
 * Mock platform adapter for testing
 */
export class MockPlatformAdapter extends PlatformAdapter {
  readonly platform: Platform = "discord";
  readonly capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: true,
    supportsDm: true,
    supportsGuild: true,
    supportsReactions: false,
    maxMessageLength: 2000,
  };

  public sentReplies: {
    channelId: string;
    content: string;
    options?: ReplyOptions;
  }[] = [];
  public connected = false;
  public mockMessages: PlatformMessage[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    this.updateConnectionState(ConnectionState.CONNECTED);
    await Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.updateConnectionState(ConnectionState.DISCONNECTED);
    await Promise.resolve();
  }

  async sendReply(
    channelId: string,
    content: string,
    options?: ReplyOptions,
  ): Promise<ReplyResult> {
    this.sentReplies.push({ channelId, content, options });
    return await Promise.resolve({
      success: true,
      messageId: `reply-${this.sentReplies.length}`,
    });
  }

  async fetchRecentMessages(
    _channelId: string,
    limit: number,
  ): Promise<PlatformMessage[]> {
    return await Promise.resolve(this.mockMessages.slice(0, limit));
  }

  override async searchRelatedMessages(
    _guildId: string,
    _channelId: string,
    query: string,
    limit: number,
  ): Promise<PlatformMessage[]> {
    return await Promise.resolve(
      this.mockMessages
        .filter((m) => m.content.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit),
    );
  }

  async getUsername(userId: string): Promise<string> {
    return await Promise.resolve(`User-${userId}`);
  }

  fetchEmojis(): Promise<PlatformEmoji[]> {
    return Promise.resolve([]);
  }

  async addReaction(
    _channelId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<ReactionResult> {
    return await Promise.resolve({ success: true });
  }

  isSelf(userId: string): boolean {
    return userId === "bot-123";
  }

  getBotId(): string | null {
    return "bot-123";
  }

  /**
   * Simulate receiving an event
   */
  simulateEvent(event: NormalizedEvent): void {
    this.emitEvent(event);
  }

  /**
   * Set mock messages for fetch operations
   */
  setMockMessages(messages: PlatformMessage[]): void {
    this.mockMessages = messages;
  }

  /**
   * Reset the mock state
   */
  reset(): void {
    this.sentReplies = [];
    this.mockMessages = [];
    this.connected = false;
  }
}
