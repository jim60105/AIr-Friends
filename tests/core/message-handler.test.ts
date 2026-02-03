// tests/core/message-handler.test.ts

import { assertEquals } from "@std/assert";
import { MessageHandler } from "@core/message-handler.ts";
import type { SessionOrchestrator, SessionResponse } from "@core/session-orchestrator.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

// Mock SessionOrchestrator that implements the interface
class MockSessionOrchestrator {
  private shouldSucceed: boolean;
  private shouldSendReply: boolean;

  constructor(shouldSucceed = true, shouldSendReply = true) {
    this.shouldSucceed = shouldSucceed;
    this.shouldSendReply = shouldSendReply;
  }

  async processMessage(
    _event: NormalizedEvent,
    _platformAdapter: PlatformAdapter,
  ): Promise<SessionResponse> {
    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 10));

    return {
      success: this.shouldSucceed,
      replySent: this.shouldSendReply,
      error: this.shouldSucceed ? undefined : "Mock error",
    };
  }
}

// Mock PlatformAdapter
const mockPlatformAdapter = {} as PlatformAdapter;

// Helper to create test event
function createTestEvent(messageId: string): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "test_channel",
    userId: "test_user",
    messageId,
    isDm: false,
    guildId: "test_guild",
    content: "Hello bot!",
    timestamp: new Date(),
  };
}

Deno.test("MessageHandler - handles event successfully", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const handler = new MessageHandler(orchestrator);

  const event = createTestEvent("msg_1");
  const response = await handler.handleEvent(event, mockPlatformAdapter);

  assertEquals(response.success, true);
  assertEquals(response.replySent, true);
});

Deno.test("MessageHandler - handles failed events", async () => {
  const orchestrator = new MockSessionOrchestrator(false, false) as unknown as SessionOrchestrator;
  const handler = new MessageHandler(orchestrator);

  const event = createTestEvent("msg_2");
  const response = await handler.handleEvent(event, mockPlatformAdapter);

  assertEquals(response.success, false);
  assertEquals(response.replySent, false);
  assertEquals(response.error, "Mock error");
});

Deno.test("MessageHandler - prevents duplicate event processing", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const handler = new MessageHandler(orchestrator);

  const event = createTestEvent("msg_3");

  // Start processing first event
  const promise1 = handler.handleEvent(event, mockPlatformAdapter);

  // Try to process same event while first is still active
  const promise2 = handler.handleEvent(event, mockPlatformAdapter);

  const [response1, response2] = await Promise.all([promise1, promise2]);

  // One should succeed, one should fail as duplicate
  const successCount = [response1, response2].filter((r) => r.success).length;
  assertEquals(successCount, 1, "Only one event should succeed");

  const duplicateError = [response1, response2].find(
    (r) => r.error?.includes("already being processed"),
  );
  assertEquals(!!duplicateError, true, "Should have duplicate error");
});

Deno.test("MessageHandler - tracks processing state", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const handler = new MessageHandler(orchestrator);

  const event = createTestEvent("msg_4");

  // Initially not processing
  assertEquals(handler.isProcessing("discord", "msg_4"), false);

  // Start processing
  const promise = handler.handleEvent(event, mockPlatformAdapter);

  // Should be processing now
  assertEquals(handler.isProcessing("discord", "msg_4"), true);
  assertEquals(handler.getActiveCount(), 1);

  // Wait for completion
  await promise;

  // Should no longer be processing
  assertEquals(handler.isProcessing("discord", "msg_4"), false);
  assertEquals(handler.getActiveCount(), 0);
});

Deno.test("MessageHandler - handles multiple events concurrently", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const handler = new MessageHandler(orchestrator);

  const event1 = createTestEvent("msg_5");
  const event2 = createTestEvent("msg_6");
  const event3 = createTestEvent("msg_7");

  // Process multiple events concurrently
  const promises = [
    handler.handleEvent(event1, mockPlatformAdapter),
    handler.handleEvent(event2, mockPlatformAdapter),
    handler.handleEvent(event3, mockPlatformAdapter),
  ];

  const responses = await Promise.all(promises);

  // All should succeed
  assertEquals(responses.every((r) => r.success), true);
  assertEquals(responses.every((r) => r.replySent), true);

  // All should be completed
  assertEquals(handler.getActiveCount(), 0);
});
