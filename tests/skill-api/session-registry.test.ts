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

Deno.test("SessionRegistry - tracks file sent status per session", () => {
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

  // Defaults to false
  assertEquals(registry.hasFileSent(sessionId), false);

  // Mark after delivery
  assertEquals(registry.markFileSent(sessionId), true);
  assertEquals(registry.hasFileSent(sessionId), true);

  // Unknown session handling
  assertEquals(registry.hasFileSent("nonexistent"), false);
  assertEquals(registry.markFileSent("nonexistent"), false);

  registry.stop();
});

Deno.test("SessionRegistry - fileSendCount increments, rolls back, and defaults", () => {
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

  // Starts at 0 (not counted by reply counters)
  assertEquals(registry.getFileSendCount(sessionId), 0);
  assertEquals(registry.getReplyCount(sessionId), 0);

  // Reserve before execution
  assertEquals(registry.incrementFileSendCount(sessionId), 1);
  assertEquals(registry.getFileSendCount(sessionId), 1);

  // Rollback on zero delivery
  registry.decrementFileSendCount(sessionId);
  assertEquals(registry.getFileSendCount(sessionId), 0);

  // Rollback never goes below zero
  registry.decrementFileSendCount(sessionId);
  assertEquals(registry.getFileSendCount(sessionId), 0);

  // Unknown session handling
  assertEquals(registry.incrementFileSendCount("nonexistent"), -1);
  assertEquals(registry.getFileSendCount("nonexistent"), 0);
  registry.decrementFileSendCount("nonexistent");

  registry.stop();
});

Deno.test("SessionRegistry - register session without triggerEvent", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "discord/bot-123",
    components: {
      platform: "discord" as const,
      userId: "b1",
    },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "b1",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // triggerEvent is omitted
  });

  const session = registry.get(sessionId);
  assertEquals(session?.triggerEvent, undefined);
  assertEquals(session?.platform, "discord");
  assertEquals(session?.userId, "b1");

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

Deno.test("SessionRegistry - setLastFileMessageId and getLastFileMessageId", () => {
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

  assertEquals(registry.getLastFileMessageId(sessionId), undefined);

  registry.setLastFileMessageId(sessionId, "file_msg_1");
  assertEquals(registry.getLastFileMessageId(sessionId), "file_msg_1");

  // Overwrite with a new ID
  registry.setLastFileMessageId(sessionId, "file_msg_2");
  assertEquals(registry.getLastFileMessageId(sessionId), "file_msg_2");

  // setLastFileMessageId must not touch lastSentMessageId
  assertEquals(registry.getLastSentMessageId(sessionId), undefined);

  registry.stop();
});

Deno.test("SessionRegistry - setLastFileMessageId ignores unknown session", () => {
  const registry = new SessionRegistry();

  // Should not throw
  registry.setLastFileMessageId("nonexistent", "file_msg_xyz");
  assertEquals(registry.getLastFileMessageId("nonexistent"), undefined);

  registry.stop();
});

Deno.test("SessionRegistry - setLastReplyAnchorMessageId and getLastReplyAnchorMessageId", () => {
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

  assertEquals(registry.getLastReplyAnchorMessageId(sessionId), undefined);

  registry.setLastReplyAnchorMessageId(sessionId, "anchor_1");
  assertEquals(registry.getLastReplyAnchorMessageId(sessionId), "anchor_1");

  // Overwrite with a new ID
  registry.setLastReplyAnchorMessageId(sessionId, "anchor_2");
  assertEquals(registry.getLastReplyAnchorMessageId(sessionId), "anchor_2");

  registry.stop();
});

Deno.test("SessionRegistry - message ID roles are stored per session (isolation)", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: { platform: "discord" as const, userId: "123" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionA = registry.register({
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
  const sessionB = registry.register({
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

  registry.setLastFileMessageId(sessionA, "file_a");
  registry.setLastReplyAnchorMessageId(sessionA, "anchor_a");

  // Session B is untouched
  assertEquals(registry.getLastFileMessageId(sessionB), undefined);
  assertEquals(registry.getLastReplyAnchorMessageId(sessionB), undefined);

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
    key: "discord/u1",
    components: { platform: "discord" as const, userId: "u1" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const id1 = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "u1",
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
    userId: "u1",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.remove(id1);

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/u1"), true);

  registry.stop();
});

Deno.test("SessionRegistry - hasActiveSessionsForWorkspace returns false when no active sessions", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "discord/u1",
    components: { platform: "discord" as const, userId: "u1" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "u1",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.remove(sessionId);

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/u1"), false);

  registry.stop();
});

Deno.test("SessionRegistry - hasActiveSessionsForWorkspace returns false after remove", () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "discord/u1",
    components: { platform: "discord" as const, userId: "u1" },
    path: "/tmp/test",
    tmpPath: "/tmp/test/tmp",
    isDm: false,
  };

  const sessionId = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "u1",
    isDm: false,
    workspace: mockWorkspace,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/u1"), true);

  registry.remove(sessionId);

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/u1"), false);

  registry.stop();
});

Deno.test("SessionRegistry - hasActiveSessionsForWorkspace different workspaces are independent", () => {
  const registry = new SessionRegistry();

  const workspaceA = {
    key: "discord/ua",
    components: { platform: "discord" as const, userId: "ua" },
    path: "/tmp/testA",
    tmpPath: "/tmp/testA/tmp",
    isDm: false,
  };

  const workspaceB = {
    key: "discord/ub",
    components: { platform: "discord" as const, userId: "ub" },
    path: "/tmp/testB",
    tmpPath: "/tmp/testB/tmp",
    isDm: false,
  };

  const idA = registry.register({
    platform: "discord",
    channelId: "456",
    userId: "ua",
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
    userId: "ub",
    isDm: false,
    workspace: workspaceB,
    // deno-lint-ignore no-explicit-any
    platformAdapter: {} as any,
    // deno-lint-ignore no-explicit-any
    triggerEvent: {} as any,
  });

  registry.remove(idA);

  assertEquals(registry.hasActiveSessionsForWorkspace("discord/ua"), false);
  assertEquals(registry.hasActiveSessionsForWorkspace("discord/ub"), true);

  registry.stop();
});

// deno-lint-ignore no-explicit-any
const registrationBase: any = {
  platform: "discord",
  channelId: "456",
  userId: "u",
  isDm: false,
  workspace: {
    key: "discord/u",
    components: { platform: "discord", userId: "u" },
    path: "/tmp/u",
    tmpPath: "/tmp/u/tmp",
    isDm: false,
  },
  platformAdapter: {},
};

Deno.test("SessionRegistry - register mints a unique caller token distinct from the session ID (F13)", () => {
  const registry = new SessionRegistry();

  const id1 = registry.register(registrationBase);
  const id2 = registry.register(registrationBase);

  const t1 = registry.getCallerToken(id1);
  const t2 = registry.getCallerToken(id2);

  assertExists(t1);
  assertExists(t2);
  assertEquals(t1 === id1, false); // token is not the session ID
  assertEquals(t1 === t2, false); // tokens are per-session
  assertEquals(t1!.length >= 32, true); // high entropy

  registry.stop();
});

Deno.test("SessionRegistry - get() treats an idle-expired session as absent (F13)", async () => {
  const registry = new SessionRegistry(80); // 80ms idle timeout

  const id = registry.register(registrationBase);
  assertExists(registry.get(id));

  await new Promise((r) => setTimeout(r, 150));
  assertEquals(registry.get(id), undefined);

  registry.stop();
});

Deno.test("SessionRegistry - touch() refreshes the idle timer (F13)", async () => {
  const registry = new SessionRegistry(120);

  const id = registry.register(registrationBase);
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 70));
    registry.touch(id);
    assertExists(registry.get(id));
  }

  registry.stop();
});
