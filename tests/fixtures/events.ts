// tests/fixtures/events.ts

import type {
  NormalizedEvent,
  PlatformMessage,
  Platform,
} from "../../src/types/events.ts";

/**
 * Create a mock normalized event
 */
export function createMockEvent(
  overrides: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return {
    platform: "discord" as Platform,
    channelId: "test-channel-123",
    userId: "test-user-456",
    messageId: "test-message-789",
    isDm: false,
    guildId: "test-guild-000",
    content: "Hello bot!",
    timestamp: new Date("2024-01-01T12:00:00Z"),
    raw: {},
    ...overrides,
  };
}

/**
 * Create a mock platform message
 */
export function createMockPlatformMessage(
  overrides: Partial<PlatformMessage> = {},
): PlatformMessage {
  return {
    messageId: "msg-123",
    userId: "user-456",
    username: "TestUser",
    content: "Test message content",
    timestamp: new Date("2024-01-01T12:00:00Z"),
    isBot: false,
    ...overrides,
  };
}

/**
 * Create a series of mock conversation messages
 */
export function createMockConversation(count: number): PlatformMessage[] {
  const messages: PlatformMessage[] = [];
  const baseTime = new Date("2024-01-01T12:00:00Z").getTime();

  for (let i = 0; i < count; i++) {
    messages.push({
      messageId: `msg-${i}`,
      userId: i % 2 === 0 ? "user-456" : "bot-123",
      username: i % 2 === 0 ? "User" : "Bot",
      content: `Message ${i}`,
      timestamp: new Date(baseTime + i * 60000),
      isBot: i % 2 !== 0,
    });
  }

  return messages;
}
