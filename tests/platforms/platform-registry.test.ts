// tests/platforms/platform-registry.test.ts

import { assertEquals } from "@std/assert";
import { PlatformRegistry, resetPlatformRegistry } from "@platforms/platform-registry.ts";
import { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { NormalizedEvent, Platform, PlatformMessage } from "../../src/types/events.ts";
import {
  ConnectionState,
  type PlatformCapabilities,
  type PlatformEmoji,
  type ReactionResult,
  type ReplyResult,
} from "../../src/types/platform.ts";

// Mock adapter for testing
class MockAdapter extends PlatformAdapter {
  readonly platform: Platform = "discord";
  readonly capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: false,
    supportsDm: true,
    supportsGuild: true,
    supportsReactions: false,
    maxMessageLength: 2000,
  };

  private connected = false;
  private selfId = "bot123";

  connect(): Promise<void> {
    this.connected = true;
    this.updateConnectionState(ConnectionState.CONNECTED);
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.connected = false;
    this.updateConnectionState(ConnectionState.DISCONNECTED);
    return Promise.resolve();
  }

  sendReply(
    _channelId: string,
    _content: string,
  ): Promise<ReplyResult> {
    return Promise.resolve({ success: true, messageId: "reply123" });
  }

  fetchRecentMessages(
    _channelId: string,
    limit: number,
  ): Promise<PlatformMessage[]> {
    return Promise.resolve(
      Array(limit).fill(null).map((_, i) => ({
        messageId: `msg${i}`,
        userId: `user${i}`,
        username: `User${i}`,
        content: `Message ${i}`,
        timestamp: new Date(),
        isBot: false,
      })),
    );
  }

  getUsername(_userId: string): Promise<string> {
    return Promise.resolve("TestUser");
  }

  fetchEmojis(): Promise<PlatformEmoji[]> {
    return Promise.resolve([]);
  }

  addReaction(
    _channelId: string,
    _messageId: string,
    _emoji: string,
  ): Promise<ReactionResult> {
    return Promise.resolve({ success: true });
  }

  isSelf(userId: string): boolean {
    return userId === this.selfId;
  }

  // Helper for testing
  simulateEvent(event: NormalizedEvent): Promise<void> {
    return this.emitEvent(event);
  }
}

Deno.test({
  name: "PlatformRegistry - should register adapter",
  fn() {
    resetPlatformRegistry();
    const registry = new PlatformRegistry();
    const adapter = new MockAdapter();

    registry.register(adapter);

    const retrieved = registry.getAdapter("discord");
    assertEquals(retrieved, adapter);
  },
});

Deno.test({
  name: "PlatformRegistry - should throw on duplicate registration",
  fn() {
    resetPlatformRegistry();
    const registry = new PlatformRegistry();
    const adapter1 = new MockAdapter();
    const adapter2 = new MockAdapter();

    registry.register(adapter1);

    try {
      registry.register(adapter2);
      throw new Error("Should have thrown");
    } catch (error) {
      assertEquals(
        (error as Error).message.includes("already registered"),
        true,
      );
    }
  },
});

Deno.test({
  name: "PlatformRegistry - should forward events to global handlers",
  async fn() {
    resetPlatformRegistry();
    const registry = new PlatformRegistry();
    const adapter = new MockAdapter();

    registry.register(adapter);

    const receivedEvents: NormalizedEvent[] = [];
    registry.onEvent((event) => {
      receivedEvents.push(event);
      return Promise.resolve();
    });

    const testEvent: NormalizedEvent = {
      platform: "discord",
      channelId: "ch1",
      userId: "user1",
      messageId: "msg1",
      isDm: false,
      guildId: "guild1",
      content: "Hello",
      timestamp: new Date(),
    };

    await adapter.simulateEvent(testEvent);

    assertEquals(receivedEvents.length, 1);
    assertEquals(receivedEvents[0].messageId, "msg1");
  },
});

Deno.test({
  name: "PlatformRegistry - should get all adapters",
  fn() {
    resetPlatformRegistry();
    const registry = new PlatformRegistry();
    const adapter = new MockAdapter();

    registry.register(adapter);

    const adapters = registry.getAllAdapters();
    assertEquals(adapters.length, 1);
  },
});

Deno.test({
  name: "PlatformRegistry - should check connection status",
  async fn() {
    resetPlatformRegistry();
    const registry = new PlatformRegistry();
    const adapter = new MockAdapter();

    registry.register(adapter);

    // Not connected initially
    assertEquals(registry.isAllConnected(), false);

    // Connect
    await adapter.connect();

    // Now connected
    assertEquals(registry.isAllConnected(), true);
  },
});
