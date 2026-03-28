// tests/skill-api/session-registry.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";

Deno.test("SessionRegistry - generates unique session IDs", () => {
  const registry = new SessionRegistry();

  const id1 = registry.generateSessionId();
  const id2 = registry.generateSessionId();

  assertExists(id1);
  assertExists(id2);
  assertEquals(id1.startsWith("sess_"), true);
  assertEquals(id2.startsWith("sess_"), true);
  assertEquals(id1 === id2, false);

  registry.stop();
});

Deno.test("SessionRegistry - registers and retrieves sessions", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: {
      platform: "discord" as const,
      userId: "123",
    },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const mockAdapter = {
    platform: "discord",
    // deno-lint-ignore no-explicit-any
  } as any;

  const mockEvent = {
    platform: "discord",
    channelId: "456",
    userId: "123",
    messageId: "789",
    isDm: false,
    guildId: "",
    content: "test",
    timestamp: new Date(),
    // deno-lint-ignore no-explicit-any
  } as any;

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    platformAdapter: mockAdapter,
    triggerEvent: mockEvent,
  });

  assertExists(sessionId);
  assertEquals(registry.has(sessionId), true);

  const session = registry.get(sessionId);
  assertExists(session);
  assertEquals(session!.platform, "discord");
  assertEquals(session!.channelId, "456");
  assertEquals(session!.replySent, false);

  registry.stop();
});

Deno.test("SessionRegistry - tracks reply sent status", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: {
      platform: "discord" as const,
      userId: "123",
    },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.hasReplySent(sessionId), false);

  const marked = registry.markReplySent(sessionId);
  assertEquals(marked, true);
  assertEquals(registry.hasReplySent(sessionId), true);

  // Try to mark again - should succeed (multiple replies allowed)
  const remarked = registry.markReplySent(sessionId);
  assertEquals(remarked, true);

  registry.stop();
});

Deno.test("SessionRegistry - removes sessions", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: {
      platform: "discord" as const,
      userId: "123",
    },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.has(sessionId), true);
  assertEquals(registry.activeCount, 1);

  registry.remove(sessionId);

  assertEquals(registry.has(sessionId), false);
  assertEquals(registry.activeCount, 0);

  registry.stop();
});

Deno.test("SessionRegistry - sessions do not expire by time (only removed explicitly)", async () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: {
      platform: "discord" as const,
      userId: "123",
    },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  // Register session with very short timeout
  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.has(sessionId), true);

  // Wait past the old timeout
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Session should still be valid — no time-based expiry
  const session = registry.get(sessionId);
  assertExists(session);
  assertEquals(registry.has(sessionId), true);

  // Only explicit remove clears it
  registry.remove(sessionId);
  assertEquals(registry.has(sessionId), false);

  registry.stop();
});

Deno.test("SessionRegistry - replyCount initializes to 0", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.getReplyCount(sessionId), 0);
  registry.stop();
});

Deno.test("SessionRegistry - incrementReplyCount increments correctly", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.incrementReplyCount(sessionId), 1);
  assertEquals(registry.incrementReplyCount(sessionId), 2);
  assertEquals(registry.incrementReplyCount(sessionId), 3);
  assertEquals(registry.getReplyCount(sessionId), 3);
  registry.stop();
});

Deno.test("SessionRegistry - incrementReplyCount returns -1 for unknown session", () => {
  const registry = new SessionRegistry();
  assertEquals(registry.incrementReplyCount("nonexistent"), -1);
  registry.stop();
});

Deno.test("SessionRegistry - getReplyCount returns 0 for unknown session", () => {
  const registry = new SessionRegistry();
  assertEquals(registry.getReplyCount("nonexistent"), 0);
  registry.stop();
});

Deno.test("SessionRegistry - register session without triggerEvent", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "discord/bot-123",
    components: {
      platform: "discord" as const,
      userId: "bot-123",
    },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "bot-123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // triggerEvent is omitted
  });

  const session = registry.get(sessionId);
  assertEquals(session?.triggerEvent, undefined);
  assertEquals(session?.platform, "discord");
  assertEquals(session?.userId, "bot-123");

  registry.stop();
});

Deno.test("SessionRegistry - setTerminateCallback stores callback", async () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  let called = false;
  registry.setTerminateCallback(sessionId, () => {
    called = true;
    return Promise.resolve();
  });

  const session = registry.get(sessionId);
  assertExists(session?.onTerminateRequest);

  await session!.onTerminateRequest!();
  assertEquals(called, true);

  registry.stop();
});

Deno.test("SessionRegistry - setTerminateCallback ignores unknown session", () => {
  const registry = new SessionRegistry();

  // Should not throw
  registry.setTerminateCallback("nonexistent", async () => {});

  registry.stop();
});

Deno.test("SessionRegistry - setLastSentMessageId and getLastSentMessageId", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.setLastSentMessageId(sessionId, "msg_abc");
  assertEquals(registry.getLastSentMessageId(sessionId), "msg_abc");

  // Overwrite with a new ID
  registry.setLastSentMessageId(sessionId, "msg_def");
  assertEquals(registry.getLastSentMessageId(sessionId), "msg_def");

  registry.stop();
});

Deno.test("SessionRegistry - getLastSentMessageId returns undefined for non-existent session", () => {
  const registry = new SessionRegistry();
  assertEquals(registry.getLastSentMessageId("nonexistent"), undefined);
  registry.stop();
});

Deno.test("SessionRegistry - getLastSentMessageId returns undefined when not set", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.getLastSentMessageId(sessionId), undefined);

  registry.stop();
});

Deno.test("SessionRegistry - setLastSentMessageId ignores unknown session", () => {
  const registry = new SessionRegistry();

  // Should not throw
  registry.setLastSentMessageId("nonexistent", "msg_xyz");
  assertEquals(registry.getLastSentMessageId("nonexistent"), undefined);

  registry.stop();
});

Deno.test("SessionRegistry - setTerminateCallback overwrites previous callback", async () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  let firstCalled = false;
  let secondCalled = false;

  registry.setTerminateCallback(sessionId, () => {
    firstCalled = true;
    return Promise.resolve();
  });
  registry.setTerminateCallback(sessionId, () => {
    secondCalled = true;
    return Promise.resolve();
  });

  const session = registry.get(sessionId);
  await session!.onTerminateRequest!();

  assertEquals(firstCalled, false);
  assertEquals(secondCalled, true);

  registry.stop();
});

Deno.test("SessionRegistry - editCount initializes to 0", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.getEditCount(sessionId), 0);
  registry.stop();
});

Deno.test("SessionRegistry - incrementEditCount increments correctly", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.incrementEditCount(sessionId), 1);
  assertEquals(registry.incrementEditCount(sessionId), 2);
  assertEquals(registry.incrementEditCount(sessionId), 3);
  assertEquals(registry.getEditCount(sessionId), 3);
  registry.stop();
});

Deno.test("SessionRegistry - incrementEditCount returns -1 for unknown session", () => {
  const registry = new SessionRegistry();
  assertEquals(registry.incrementEditCount("nonexistent"), -1);
  registry.stop();
});

Deno.test("SessionRegistry - getEditCount returns 0 for unknown session", () => {
  const registry = new SessionRegistry();
  assertEquals(registry.getEditCount("nonexistent"), 0);
  registry.stop();
});

Deno.test("SessionRegistry - editCount and replyCount are independent", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.incrementReplyCount(sessionId);
  registry.incrementReplyCount(sessionId);
  assertEquals(registry.getReplyCount(sessionId), 2);
  assertEquals(registry.getEditCount(sessionId), 0);

  registry.incrementEditCount(sessionId);
  assertEquals(registry.getEditCount(sessionId), 1);
  assertEquals(registry.getReplyCount(sessionId), 2);

  registry.stop();
});

Deno.test("SessionRegistry - hasActiveSessionsForWorkspace returns true when active sessions exist", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "discord/user1",
    components: { platform: "discord" as const, userId: "user1" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const id1 = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "user1",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.register({
    platform: "discord",
    channelId: "789",
    userId: "user1",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.remove(id1);

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/user1"), true);

  registry.stop();
});

Deno.test("SessionRegistry - hasActiveSessionsForWorkspace returns false when no active sessions", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "discord/user1",
    components: { platform: "discord" as const, userId: "user1" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "user1",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.remove(sessionId);

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/user1"), false);

  registry.stop();
});

Deno.test("SessionRegistry - hasActiveSessionsForWorkspace returns false after remove", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "discord/user1",
    components: { platform: "discord" as const, userId: "user1" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "user1",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/user1"), true);

  registry.remove(sessionId);

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/user1"), false);

  registry.stop();
});

Deno.test("SessionRegistry - hasActiveSessionsForWorkspace different workspaces are independent", () => {
  const registry = new SessionRegistry();

  const workspaceA = {
    key: "discord/userA",
    components: { platform: "discord" as const, userId: "userA" },
    path: "/tmp/testA",
    tmpPath: "/tmp/testA/tmp",
    isDm: false,
  };

  const workspaceB = {
    key: "discord/userB",
    components: { platform: "discord" as const, userId: "userB" },
    path: "/tmp/testB",
    tmpPath: "/tmp/testB/tmp",
    isDm: false,
  };

  const idA = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "userA",
    isDm: false,
    workspace: workspaceA,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.register({
    platform: "discord",
    channelId: "789",
    userId: "userB",
    isDm: false,
    workspace: workspaceB,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.remove(idA);

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/userA"), false);
  assertEquals(registry.hasActiveSessionsForWorkspace("discord/userB"), true);

  registry.stop();
});
