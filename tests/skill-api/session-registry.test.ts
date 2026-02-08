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
    timeoutMs: 60000,
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
    timeoutMs: 60000,
  });

  assertEquals(registry.hasReplySent(sessionId), false);

  const marked = registry.markReplySent(sessionId);
  assertEquals(marked, true);
  assertEquals(registry.hasReplySent(sessionId), true);

  // Try to mark again - should fail
  const remarked = registry.markReplySent(sessionId);
  assertEquals(remarked, false);

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
    timeoutMs: 60000,
  });

  assertEquals(registry.has(sessionId), true);
  assertEquals(registry.activeCount, 1);

  registry.remove(sessionId);

  assertEquals(registry.has(sessionId), false);
  assertEquals(registry.activeCount, 0);

  registry.stop();
});

Deno.test("SessionRegistry - cleans up expired sessions", async () => {
  const registry = new SessionRegistry();

  const mockWorkspace = {
    key: "test/123",
    components: {
      platform: "discord" as const,
      userId: "123",
    },
    path: "/tmp/test",
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
    timeoutMs: 100, // 100ms timeout
  });

  assertEquals(registry.has(sessionId), true);

  // Wait for expiration
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Try to get - should return undefined due to expiration
  const session = registry.get(sessionId);
  assertEquals(session, undefined);
  assertEquals(registry.has(sessionId), false);

  registry.stop();
});
