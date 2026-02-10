// tests/integration/agent-flow.integration.test.ts

import { assert, assertEquals } from "@std/assert";
import { MockPlatformAdapter } from "../mocks/mock-platform-adapter.ts";
import { createMockConversation, createMockEvent } from "../fixtures/events.ts";
import { createTestEnvironment } from "../helpers/test-context.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";

Deno.test({
  name: "Integration: Mock platform adapter works correctly",
  async fn() {
    const env = createTestEnvironment();

    // Set up mock conversation history
    env.platform.setMockMessages(createMockConversation(5));

    // Connect platform
    await env.platform.connect();
    assertEquals(env.platform.connected, true);

    // Fetch messages
    const messages = await env.platform.fetchRecentMessages("test-channel", 3);
    assertEquals(messages.length, 3);
    assertEquals(messages[0].content, "Message 0");

    // Send reply
    const result = await env.platform.sendReply(
      "test-channel",
      "Test reply",
    );
    assertEquals(result.success, true);
    assertEquals(env.platform.sentReplies.length, 1);
    assertEquals(env.platform.sentReplies[0].content, "Test reply");

    // Disconnect
    await env.platform.disconnect();
    assertEquals(env.platform.connected, false);

    // Clean up
    env.cleanup();
  },
});

Deno.test({
  name: "Integration: Mock platform can search messages",
  async fn() {
    const env = createTestEnvironment();

    // Set up messages with specific content
    env.platform.setMockMessages([
      {
        messageId: "msg-1",
        userId: "user-1",
        username: "User1",
        content: "I love TypeScript",
        timestamp: new Date(),
        isBot: false,
      },
      {
        messageId: "msg-2",
        userId: "user-2",
        username: "User2",
        content: "JavaScript is great",
        timestamp: new Date(),
        isBot: false,
      },
      {
        messageId: "msg-3",
        userId: "user-3",
        username: "User3",
        content: "Python is also good",
        timestamp: new Date(),
        isBot: false,
      },
    ]);

    // Search for TypeScript
    const results = await env.platform.searchRelatedMessages(
      "guild-1",
      "channel-1",
      "typescript",
      10,
    );

    assertEquals(results.length, 1);
    assertEquals(results[0].content, "I love TypeScript");

    env.cleanup();
  },
});

Deno.test({
  name: "Integration: Platform event emission works",
  async fn() {
    const platform = new MockPlatformAdapter();
    let eventReceived = false;
    const receivedEvents: NormalizedEvent[] = [];

    // Register event handler
    platform.onEvent((event) => {
      eventReceived = true;
      receivedEvents.push(event);
      return Promise.resolve();
    });

    // Simulate event
    const mockEvent = createMockEvent({ content: "Hello!" });
    platform.simulateEvent(mockEvent);

    // Give event handler time to execute
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert(eventReceived);
    assertEquals(receivedEvents.length, 1);
    assertEquals(receivedEvents[0].content, "Hello!");
  },
});

Deno.test({
  name: "Integration: Test environment cleanup works",
  fn() {
    const env = createTestEnvironment();

    // Add some data
    env.platform.setMockMessages(createMockConversation(5));
    env.platform.sentReplies.push({
      channelId: "test",
      content: "test",
    });
    env.workspace.setMockFile("/test/file.txt", "content");

    // Cleanup
    env.cleanup();

    // Verify cleanup
    assertEquals(env.platform.mockMessages.length, 0);
    assertEquals(env.platform.sentReplies.length, 0);
  },
});

Deno.test({
  name: "Integration: Mock platform adapter returns bot ID",
  fn() {
    const platform = new MockPlatformAdapter();
    assertEquals(platform.getBotId(), "bot-123");
    assertEquals(platform.isSelf("bot-123"), true);
    assertEquals(platform.isSelf("not-bot"), false);
  },
});
