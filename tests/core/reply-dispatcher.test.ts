// tests/core/reply-dispatcher.test.ts

import { assertEquals } from "@std/assert";
import { ReplyDispatcher } from "@core/reply-dispatcher.ts";
import type { SessionResponse } from "@core/session-orchestrator.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PlatformCapabilities, ReplyOptions, ReplyResult } from "../../src/types/platform.ts";

// Mock PlatformAdapter
class MockPlatformAdapter implements Partial<PlatformAdapter> {
  platform = "discord" as const;
  capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: false,
    supportsDm: true,
    supportsGuild: true,
    supportsReactions: false,
    maxMessageLength: 2000,
  };

  sentReplies: Array<{ channelId: string; content: string; options?: ReplyOptions }> = [];
  shouldFail = false;

  sendReply(
    channelId: string,
    content: string,
    options?: ReplyOptions,
  ): Promise<ReplyResult> {
    if (this.shouldFail) {
      return Promise.resolve({
        success: false,
        error: "Mock send failure",
      });
    }

    this.sentReplies.push({ channelId, content, options });
    return Promise.resolve({
      success: true,
      messageId: "mock_msg_" + Date.now(),
    });
  }
}

Deno.test("ReplyDispatcher - does not dispatch for successful response", async () => {
  const dispatcher = new ReplyDispatcher();
  const mockAdapter = new MockPlatformAdapter();
  const adapter = mockAdapter as unknown as PlatformAdapter;

  const response: SessionResponse = {
    success: true,
    replySent: true,
  };

  const dispatched = await dispatcher.dispatchErrorIfNeeded(
    adapter,
    "channel_1",
    response,
  );

  assertEquals(dispatched, false);
  assertEquals(mockAdapter.sentReplies.length, 0);
});

Deno.test("ReplyDispatcher - does not dispatch if reply was already sent", async () => {
  const dispatcher = new ReplyDispatcher();
  const mockAdapter = new MockPlatformAdapter();
  const adapter = mockAdapter as unknown as PlatformAdapter;

  const response: SessionResponse = {
    success: false,
    replySent: true, // Reply was sent despite failure
    error: "Some error",
  };

  const dispatched = await dispatcher.dispatchErrorIfNeeded(
    adapter,
    "channel_2",
    response,
  );

  assertEquals(dispatched, false);
  assertEquals(mockAdapter.sentReplies.length, 0);
});

Deno.test("ReplyDispatcher - dispatches error message for failed response", async () => {
  const dispatcher = new ReplyDispatcher();
  const mockAdapter = new MockPlatformAdapter();
  const adapter = mockAdapter as unknown as PlatformAdapter;

  const response: SessionResponse = {
    success: false,
    replySent: false,
    error: "Processing failed",
  };

  const dispatched = await dispatcher.dispatchErrorIfNeeded(
    adapter,
    "channel_3",
    response,
    "original_msg_id",
  );

  assertEquals(dispatched, true);
  assertEquals(mockAdapter.sentReplies.length, 1);

  const sentReply = mockAdapter.sentReplies[0];
  assertEquals(sentReply.channelId, "channel_3");
  assertEquals(
    sentReply.content.includes("encountered an issue"),
    true,
  );
  assertEquals(sentReply.options?.replyToMessageId, "original_msg_id");
});

Deno.test("ReplyDispatcher - skips error dispatch for duplicate event errors", async () => {
  const dispatcher = new ReplyDispatcher();
  const mockAdapter = new MockPlatformAdapter();
  const adapter = mockAdapter as unknown as PlatformAdapter;

  const response: SessionResponse = {
    success: false,
    replySent: false,
    error: "Event already being processed",
  };

  const dispatched = await dispatcher.dispatchErrorIfNeeded(
    adapter,
    "channel_4",
    response,
  );

  assertEquals(dispatched, false);
  assertEquals(mockAdapter.sentReplies.length, 0);
});

Deno.test("ReplyDispatcher - skips error dispatch for cancelled errors", async () => {
  const dispatcher = new ReplyDispatcher();
  const mockAdapter = new MockPlatformAdapter();
  const adapter = mockAdapter as unknown as PlatformAdapter;

  const response: SessionResponse = {
    success: false,
    replySent: false,
    error: "Session was cancelled",
  };

  const dispatched = await dispatcher.dispatchErrorIfNeeded(
    adapter,
    "channel_5",
    response,
  );

  assertEquals(dispatched, false);
  assertEquals(mockAdapter.sentReplies.length, 0);
});

Deno.test("ReplyDispatcher - handles platform send failure gracefully", async () => {
  const dispatcher = new ReplyDispatcher();
  const mockAdapter = new MockPlatformAdapter();
  mockAdapter.shouldFail = true;
  const adapter = mockAdapter as unknown as PlatformAdapter;

  const response: SessionResponse = {
    success: false,
    replySent: false,
    error: "Processing failed",
  };

  const dispatched = await dispatcher.dispatchErrorIfNeeded(
    adapter,
    "channel_6",
    response,
  );

  assertEquals(dispatched, false); // Failed to send
});
