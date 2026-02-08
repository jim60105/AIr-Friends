// tests/skills/context-handler.test.ts

import { assertEquals } from "@std/assert";
import { ContextHandler } from "@skills/context-handler.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PlatformMessage } from "../../src/types/events.ts";

// Create a mock platform adapter
const createMockPlatformAdapter = (
  options: {
    fetchRecentMessagesResult?: PlatformMessage[];
    searchRelatedMessagesResult?: PlatformMessage[];
    getUsernameResult?: string;
    hasSearchSupport?: boolean;
    throwError?: boolean;
  } = {},
): PlatformAdapter => {
  const {
    fetchRecentMessagesResult = [],
    searchRelatedMessagesResult = [],
    getUsernameResult = "test_user",
    hasSearchSupport = true,
    throwError = false,
  } = options;

  return {
    platform: "discord",
    capabilities: {
      canFetchHistory: true,
      canSearchMessages: true,
      supportsDm: true,
      supportsGuild: true,
      supportsReactions: true,
      maxMessageLength: 2000,
    },
    getConnectionStatus: () => ({
      state: "connected" as const,
      reconnectAttempts: 0,
    }),
    onEvent: () => {},
    offEvent: () => {},
    connect: async () => {},
    disconnect: async () => {},
    sendReply: () => Promise.resolve({ success: true }),
    fetchRecentMessages: () => {
      if (throwError) throw new Error("Fetch failed");
      return Promise.resolve(fetchRecentMessagesResult);
    },
    searchRelatedMessages: hasSearchSupport
      ? () => {
        if (throwError) throw new Error("Search failed");
        return Promise.resolve(searchRelatedMessagesResult);
      }
      : undefined,
    getUsername: () => {
      if (throwError) throw new Error("Username fetch failed");
      return Promise.resolve(getUsernameResult);
    },
    isSelf: () => false,
  } as unknown as PlatformAdapter;
};

const createTestContext = (platformAdapter: PlatformAdapter): SkillContext => {
  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: {
      platform: "discord",
      userId: "123",
    },
    path: "/tmp/workspaces/discord/123",
    isDm: true,
  };

  return {
    workspace,
    platformAdapter,
    channelId: "456",
    userId: "123",
  };
};

Deno.test("ContextHandler - handleFetchContext validates type parameter", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(createMockPlatformAdapter());

  // Missing type
  const result1 = await handler.handleFetchContext({}, context);
  assertEquals(result1.success, false);
  assertEquals(result1.error, "Missing or invalid 'type' parameter");

  // Invalid type (not string)
  const result2 = await handler.handleFetchContext({ type: 123 }, context);
  assertEquals(result2.success, false);
  assertEquals(result2.error, "Missing or invalid 'type' parameter");

  // Invalid type value
  const result3 = await handler.handleFetchContext({ type: "invalid_type" }, context);
  assertEquals(result3.success, false);
  assertEquals(
    result3.error,
    "Invalid 'type' parameter. Must be one of: recent_messages, search_messages, user_info",
  );
});

Deno.test("ContextHandler - handleFetchContext validates limit parameter", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(createMockPlatformAdapter());

  // Invalid limit (not a number)
  const result1 = await handler.handleFetchContext(
    { type: "recent_messages", limit: "ten" },
    context,
  );
  assertEquals(result1.success, false);
  assertEquals(result1.error, "Invalid 'limit' parameter. Must be a positive number");

  // Invalid limit (negative)
  const result2 = await handler.handleFetchContext(
    { type: "recent_messages", limit: -5 },
    context,
  );
  assertEquals(result2.success, false);
  assertEquals(result2.error, "Invalid 'limit' parameter. Must be a positive number");

  // Invalid limit (zero)
  const result3 = await handler.handleFetchContext(
    { type: "recent_messages", limit: 0 },
    context,
  );
  assertEquals(result3.success, false);
  assertEquals(result3.error, "Invalid 'limit' parameter. Must be a positive number");
});

Deno.test("ContextHandler - handleFetchContext fetches recent messages", async () => {
  const handler = new ContextHandler();
  const mockMessages: PlatformMessage[] = [
    {
      messageId: "msg1",
      userId: "user1",
      username: "User One",
      content: "Hello",
      timestamp: new Date(),
      isBot: false,
    },
    {
      messageId: "msg2",
      userId: "user2",
      username: "User Two",
      content: "World",
      timestamp: new Date(),
      isBot: false,
    },
  ];

  const context = createTestContext(
    createMockPlatformAdapter({ fetchRecentMessagesResult: mockMessages }),
  );

  const result = await handler.handleFetchContext(
    { type: "recent_messages", limit: 10 },
    context,
  );

  assertEquals(result.success, true);
  assertEquals(typeof result.data, "object");
  const data = result.data as { type: string; data: PlatformMessage[] };
  assertEquals(data.type, "recent_messages");
  assertEquals(data.data.length, 2);
  assertEquals(data.data[0].messageId, "msg1");
});

Deno.test("ContextHandler - handleFetchContext uses default limit", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(createMockPlatformAdapter());

  const result = await handler.handleFetchContext(
    { type: "recent_messages" },
    context,
  );

  assertEquals(result.success, true);
});

Deno.test("ContextHandler - handleFetchContext search_messages validates query", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(createMockPlatformAdapter());

  // Missing query
  const result1 = await handler.handleFetchContext(
    { type: "search_messages" },
    context,
  );
  assertEquals(result1.success, false);
  assertEquals(result1.error, "Missing or invalid 'query' parameter for search_messages type");

  // Invalid query (not string)
  const result2 = await handler.handleFetchContext(
    { type: "search_messages", query: 123 },
    context,
  );
  assertEquals(result2.success, false);
  assertEquals(result2.error, "Missing or invalid 'query' parameter for search_messages type");
});

Deno.test("ContextHandler - handleFetchContext search_messages checks platform support", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(
    createMockPlatformAdapter({ hasSearchSupport: false }),
  );

  const result = await handler.handleFetchContext(
    { type: "search_messages", query: "test" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Platform does not support message search");
});

Deno.test("ContextHandler - handleFetchContext search_messages works", async () => {
  const handler = new ContextHandler();
  const mockMessages: PlatformMessage[] = [
    {
      messageId: "msg1",
      userId: "user1",
      username: "User One",
      content: "Test message",
      timestamp: new Date(),
      isBot: false,
    },
  ];

  const context = createTestContext(
    createMockPlatformAdapter({ searchRelatedMessagesResult: mockMessages }),
  );

  const result = await handler.handleFetchContext(
    { type: "search_messages", query: "test", limit: 5 },
    context,
  );

  assertEquals(result.success, true);
  const data = result.data as { type: string; data: PlatformMessage[] };
  assertEquals(data.type, "search_messages");
  assertEquals(data.data.length, 1);
});

Deno.test("ContextHandler - handleFetchContext user_info works", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(
    createMockPlatformAdapter({ getUsernameResult: "TestUser" }),
  );

  const result = await handler.handleFetchContext(
    { type: "user_info" },
    context,
  );

  assertEquals(result.success, true);
  const data = result.data as {
    type: string;
    data: { userId: string; username: string; platform: string; isDm: boolean };
  };
  assertEquals(data.type, "user_info");
  assertEquals(data.data.userId, "123");
  assertEquals(data.data.username, "TestUser");
  assertEquals(data.data.platform, "discord");
  assertEquals(data.data.isDm, true);
});

Deno.test("ContextHandler - handleFetchContext handles errors in recent_messages", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(
    createMockPlatformAdapter({ throwError: true }),
  );

  const result = await handler.handleFetchContext(
    { type: "recent_messages" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Fetch failed");
});

Deno.test("ContextHandler - handleFetchContext handles errors in search_messages", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(
    createMockPlatformAdapter({ throwError: true }),
  );

  const result = await handler.handleFetchContext(
    { type: "search_messages", query: "test" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Search failed");
});

Deno.test("ContextHandler - handleFetchContext handles errors in user_info", async () => {
  const handler = new ContextHandler();
  const context = createTestContext(
    createMockPlatformAdapter({ throwError: true }),
  );

  const result = await handler.handleFetchContext(
    { type: "user_info" },
    context,
  );

  assertEquals(result.success, false);
  assertEquals(result.error, "Username fetch failed");
});
