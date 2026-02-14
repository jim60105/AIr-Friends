// tests/core/message-handler.test.ts

import { assertEquals } from "@std/assert";
import { MessageHandler } from "@core/message-handler.ts";
import { ReplyPolicyEvaluator } from "@core/reply-policy.ts";
import type { SessionOrchestrator, SessionResponse } from "@core/session-orchestrator.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { RateLimitConfig } from "../../src/types/config.ts";

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  enabled: false,
  maxRequestsPerWindow: 10,
  windowMs: 600000,
  cooldownMs: 600000,
};

const DEFAULT_REPLY_POLICY = new ReplyPolicyEvaluator({
  replyTo: "all",
  whitelist: [],
});

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
  const handler = new MessageHandler(orchestrator, DEFAULT_RATE_LIMIT, DEFAULT_REPLY_POLICY);

  const event = createTestEvent("msg_1");
  const response = await handler.handleEvent(event, mockPlatformAdapter);

  assertEquals(response.success, true);
  assertEquals(response.replySent, true);
});

Deno.test("MessageHandler - handles failed events", async () => {
  const orchestrator = new MockSessionOrchestrator(false, false) as unknown as SessionOrchestrator;
  const handler = new MessageHandler(orchestrator, DEFAULT_RATE_LIMIT, DEFAULT_REPLY_POLICY);

  const event = createTestEvent("msg_2");
  const response = await handler.handleEvent(event, mockPlatformAdapter);

  assertEquals(response.success, false);
  assertEquals(response.replySent, false);
  assertEquals(response.error, "Mock error");
});

Deno.test("MessageHandler - prevents duplicate event processing", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const handler = new MessageHandler(orchestrator, DEFAULT_RATE_LIMIT, DEFAULT_REPLY_POLICY);

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
  const handler = new MessageHandler(orchestrator, DEFAULT_RATE_LIMIT, DEFAULT_REPLY_POLICY);

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
  const handler = new MessageHandler(orchestrator, DEFAULT_RATE_LIMIT, DEFAULT_REPLY_POLICY);

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

Deno.test("MessageHandler - rate limited event returns error", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    maxRequestsPerWindow: 1,
    windowMs: 600000,
    cooldownMs: 600000,
  };
  const handler = new MessageHandler(orchestrator, rateLimitConfig, DEFAULT_REPLY_POLICY);

  const event1 = createTestEvent("msg_rl_1");
  const event2 = createTestEvent("msg_rl_2");

  const response1 = await handler.handleEvent(event1, mockPlatformAdapter);
  assertEquals(response1.success, true);

  const response2 = await handler.handleEvent(event2, mockPlatformAdapter);
  assertEquals(response2.success, false);
  assertEquals(response2.error, "Rate limited");
  assertEquals(response2.replySent, false);

  handler.dispose();
});

Deno.test("MessageHandler - rate limited event does not call orchestrator", async () => {
  let orchestratorCallCount = 0;
  const orchestrator = {
    processMessage(): Promise<SessionResponse> {
      orchestratorCallCount++;
      return Promise.resolve({ success: true, replySent: true });
    },
  } as unknown as SessionOrchestrator;

  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    maxRequestsPerWindow: 1,
    windowMs: 600000,
    cooldownMs: 600000,
  };
  const handler = new MessageHandler(orchestrator, rateLimitConfig, DEFAULT_REPLY_POLICY);

  await handler.handleEvent(createTestEvent("msg_rl_3"), mockPlatformAdapter);
  await handler.handleEvent(createTestEvent("msg_rl_4"), mockPlatformAdapter);

  assertEquals(orchestratorCallCount, 1, "Orchestrator should only be called once");

  handler.dispose();
});

Deno.test("MessageHandler - duplicate events not counted in rate limit", async () => {
  let orchestratorCallCount = 0;
  const orchestrator = {
    async processMessage(): Promise<SessionResponse> {
      orchestratorCallCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { success: true, replySent: true };
    },
  } as unknown as SessionOrchestrator;

  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    maxRequestsPerWindow: 1,
    windowMs: 600000,
    cooldownMs: 600000,
  };
  const handler = new MessageHandler(orchestrator, rateLimitConfig, DEFAULT_REPLY_POLICY);

  // Send same message ID twice concurrently — duplicate should not count toward rate limit
  const event = createTestEvent("msg_rl_dup");
  const [r1, r2] = await Promise.all([
    handler.handleEvent(event, mockPlatformAdapter),
    handler.handleEvent(event, mockPlatformAdapter),
  ]);

  const duplicateResponse = [r1, r2].find((r) => r.error?.includes("already being processed"));
  assertEquals(!!duplicateResponse, true);

  // The duplicate should not have consumed a rate limit slot, so a new message should still work
  // But since maxRequestsPerWindow is 1 and first event consumed it, next will be rate-limited
  assertEquals(orchestratorCallCount, 1);

  handler.dispose();
});

Deno.test("MessageHandler - whitelisted account bypasses rate limit", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    maxRequestsPerWindow: 1,
    windowMs: 600000,
    cooldownMs: 600000,
  };
  const replyPolicy = new ReplyPolicyEvaluator({
    replyTo: "whitelist",
    whitelist: ["discord/account/test_user"],
  });
  const handler = new MessageHandler(orchestrator, rateLimitConfig, replyPolicy);

  // Send more than maxRequestsPerWindow messages — all should succeed
  const r1 = await handler.handleEvent(createTestEvent("msg_wl_1"), mockPlatformAdapter);
  const r2 = await handler.handleEvent(createTestEvent("msg_wl_2"), mockPlatformAdapter);
  const r3 = await handler.handleEvent(createTestEvent("msg_wl_3"), mockPlatformAdapter);

  assertEquals(r1.success, true);
  assertEquals(r2.success, true);
  assertEquals(r3.success, true);

  handler.dispose();
});

Deno.test("MessageHandler - whitelisted channel user still rate limited", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    maxRequestsPerWindow: 1,
    windowMs: 600000,
    cooldownMs: 600000,
  };
  const replyPolicy = new ReplyPolicyEvaluator({
    replyTo: "whitelist",
    whitelist: ["discord/channel/test_channel"],
  });
  const handler = new MessageHandler(orchestrator, rateLimitConfig, replyPolicy);

  const r1 = await handler.handleEvent(createTestEvent("msg_ch_1"), mockPlatformAdapter);
  const r2 = await handler.handleEvent(createTestEvent("msg_ch_2"), mockPlatformAdapter);

  assertEquals(r1.success, true);
  assertEquals(r2.success, false);
  assertEquals(r2.error, "Rate limited");

  handler.dispose();
});

Deno.test("MessageHandler - non-whitelisted account rate limited normally", async () => {
  const orchestrator = new MockSessionOrchestrator(true, true) as unknown as SessionOrchestrator;
  const rateLimitConfig: RateLimitConfig = {
    enabled: true,
    maxRequestsPerWindow: 1,
    windowMs: 600000,
    cooldownMs: 600000,
  };
  const replyPolicy = new ReplyPolicyEvaluator({
    replyTo: "whitelist",
    whitelist: ["discord/account/other_user"],
  });
  const handler = new MessageHandler(orchestrator, rateLimitConfig, replyPolicy);

  const r1 = await handler.handleEvent(createTestEvent("msg_nwl_1"), mockPlatformAdapter);
  const r2 = await handler.handleEvent(createTestEvent("msg_nwl_2"), mockPlatformAdapter);

  assertEquals(r1.success, true);
  assertEquals(r2.success, false);
  assertEquals(r2.error, "Rate limited");

  handler.dispose();
});
