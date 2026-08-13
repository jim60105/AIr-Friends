// tests/skill-api/server.test.ts

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";

// Build request headers, optionally with the per-session caller token (F13).
function jsonHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// Helper to wait for server to be ready
async function waitForServer(port: number, maxAttempts = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/api/skill/test`);
      await response.body?.cancel();
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return false;
}

Deno.test("SkillAPIServer - constructs successfully", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port: 3002,
      host: "127.0.0.1",
    });

    assertExists(server);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - starts and stops", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const port = 3003;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Server should be running (POST to invalid skill returns 404)
    const response = await fetch(`http://localhost:${port}/api/skill/test`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: "test" }),
    });
    await response.text(); // Consume the body
    assertEquals(response.status, 401); // Invalid session

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - handles OPTIONS preflight", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const port = 3004;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/test`, {
      method: "OPTIONS",
    });

    assertEquals(response.status, 204);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - rejects non-POST methods", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const port = 3005;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/test`, {
      method: "GET",
    });

    assertEquals(response.status, 405);
    const body = await response.json();
    assertEquals(body.success, false);
    assertEquals(body.error, "Method not allowed");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - returns 404 for invalid routes", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const port = 3006;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/invalid/path`, {
      method: "POST",
    });

    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.success, false);
    assertEquals(body.error, "Not found");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - validates session ID", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const port = 3007;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Test with missing sessionId
    const response1 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });

    assertEquals(response1.status, 400);
    const body1 = await response1.json();
    assertEquals(body1.success, false);
    assertEquals(body1.error, "Missing sessionId");

    // Test with invalid sessionId
    const response2 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: "invalid-session-id" }),
    });

    assertEquals(response2.status, 401);
    const body2 = await response2.json();
    assertEquals(body2.success, false);
    assertEquals(body2.error, "Invalid or expired session");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - validates skill name", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    // Create a valid session
    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      // deno-lint-ignore no-explicit-any
      platformAdapter: {} as any,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3008;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Test with unknown skill
    const response = await fetch(`http://localhost:${port}/api/skill/unknown-skill`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId }),
    });

    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.success, false);
    assertEquals(body.error?.includes("Unknown skill"), true);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - allows multiple replies within limit", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    // Create workspace
    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "test123" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3009;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // First reply should succeed (limit is now 1)
    const response = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Message 1" },
      }),
    });

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.success, true);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-reply rejected after reaching limit", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "test123" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3010;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send 1 successful reply (new limit is 1)
    const response1 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Message 1" },
      }),
    });
    await response1.json();

    // 2nd reply should be rejected with 429
    const response4 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Fourth message" },
      }),
    });

    assertEquals(response4.status, 429);
    const body4 = await response4.json();
    assertEquals(body4.success, false);
    assertEquals(body4.error?.includes("edit-reply"), true);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - reply count not incremented on failed send-reply", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: false, error: "Platform error" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3011;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send a reply that will fail
    const response = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Test message" },
      }),
    });
    await response.json();

    // Reply count should still be 0
    assertEquals(sessionRegistry.getReplyCount(sessionId), 0);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - edit-reply not affected by reply limit", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "test123" }),
      editMessage: () => Promise.resolve({ success: true, messageId: "test123" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3012;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send 1 reply to reach the limit (new limit is 1)
    const replyResponse = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Message 1" },
      }),
    });
    await replyResponse.json();

    // edit-reply should still work
    const editResponse = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "test123", message: "Edited message" },
      }),
    });

    assertEquals(editResponse.status, 200);
    const editBody = await editResponse.json();
    assertEquals(editBody.success, true);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - reply count incremented even on rejection", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "test123" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3013;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // First reply succeeds
    const response1 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Message 1" },
      }),
    });
    assertEquals(response1.status, 200);
    await response1.json();
    assertEquals(sessionRegistry.getReplyCount(sessionId), 1);

    // Second reply rejected but count still increments
    const response2 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Message 2" },
      }),
    });
    assertEquals(response2.status, 429);
    await response2.json();
    assertEquals(sessionRegistry.getReplyCount(sessionId), 2);

    // Third reply rejected, count increments again
    const response3 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Message 3" },
      }),
    });
    assertEquals(response3.status, 429);
    await response3.json();
    assertEquals(sessionRegistry.getReplyCount(sessionId), 3);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - doom-loop triggers agent termination on 4th attempt", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "test123" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    // Set up termination callback tracker
    let terminateCalled = false;
    sessionRegistry.setTerminateCallback(sessionId, () => {
      terminateCalled = true;
      return Promise.resolve();
    });

    const port = 3014;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send 4 replies: 1 succeeds, 3 rejected, 4th triggers termination
    for (let i = 1; i <= 4; i++) {
      const response = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
        method: "POST",
        headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
        body: JSON.stringify({
          sessionId,
          parameters: { message: `Message ${i}` },
        }),
      });
      await response.json();
    }

    // Wait for setTimeout(100ms) to fire
    await new Promise((resolve) => setTimeout(resolve, 200));

    assertEquals(terminateCalled, true);
    assertEquals(sessionRegistry.getReplyCount(sessionId), 4);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - no crash when onTerminateRequest not set on doom-loop", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "test123" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    // Do NOT set onTerminateRequest callback

    const port = 3015;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send 4 replies without termination callback — should not crash
    for (let i = 1; i <= 4; i++) {
      const response = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
        method: "POST",
        headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
        body: JSON.stringify({
          sessionId,
          parameters: { message: `Message ${i}` },
        }),
      });
      const body = await response.json();
      if (i === 1) {
        assertEquals(response.status, 200);
        assertEquals(body.success, true);
      } else {
        assertEquals(response.status, 429);
        assertEquals(body.success, false);
      }
    }

    // Wait for setTimeout to fire (should be no-op since callback is not set)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // No crash occurred — test passes
    assertEquals(sessionRegistry.getReplyCount(sessionId), 4);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-reply success updates lastSentMessageId", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "sent_msg_001" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    // Verify no lastSentMessageId initially
    assertEquals(sessionRegistry.getLastSentMessageId(sessionId), undefined);

    const port = 3016;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Hello!" },
      }),
    });

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.success, true);

    // Verify lastSentMessageId was updated
    assertEquals(sessionRegistry.getLastSentMessageId(sessionId), "sent_msg_001");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - edit-reply success updates lastSentMessageId", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "original_msg" }),
      editMessage: () => Promise.resolve({ success: true, messageId: "edited_msg_new" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3017;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // First send a reply
    const sendResponse = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Original" },
      }),
    });
    await sendResponse.json();
    assertEquals(sessionRegistry.getLastSentMessageId(sessionId), "original_msg");

    // Now edit the reply
    const editResponse = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "original_msg", message: "Edited" },
      }),
    });

    assertEquals(editResponse.status, 200);
    const editBody = await editResponse.json();
    assertEquals(editBody.success, true);

    // Verify lastSentMessageId was updated to the new ID from edit
    assertEquals(sessionRegistry.getLastSentMessageId(sessionId), "edited_msg_new");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - get-message skill via API", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      fetchMessage: () =>
        Promise.resolve({
          messageId: "fetched_msg",
          userId: "user_abc",
          username: "SomeUser",
          content: "Hello from platform",
          timestamp: new Date("2024-07-01T10:00:00Z"),
          isBot: false,
        }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3018;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/get-message`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "fetched_msg" },
      }),
    });

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.success, true);
    assertEquals(body.data.messageId, "fetched_msg");
    assertEquals(body.data.userId, "user_abc");
    assertEquals(body.data.content, "Hello from platform");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - get-message uses lastSentMessageId from session", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    let capturedMessageId = "";
    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "sent_for_get" }),
      fetchMessage: (_channelId: string, messageId: string) => {
        capturedMessageId = messageId;
        return Promise.resolve({
          messageId,
          userId: "bot_user",
          username: "Bot",
          content: "Bot's message",
          timestamp: new Date("2024-07-01T12:00:00Z"),
          isBot: true,
        });
      },
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3019;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // First send a reply to set lastSentMessageId
    const sendResponse = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Hello!" },
      }),
    });
    await sendResponse.json();

    // Now call get-message without messageId — should use lastSentMessageId
    const getResponse = await fetch(`http://localhost:${port}/api/skill/get-message`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: {},
      }),
    });

    assertEquals(getResponse.status, 200);
    const body = await getResponse.json();
    assertEquals(body.success, true);
    assertEquals(capturedMessageId, "sent_for_get");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - edit-reply succeeds for first 2 calls", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "sent_msg_001" }),
      editMessage: () => Promise.resolve({ success: true, messageId: "edited_msg_001" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3020;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send initial reply to get a messageId
    const sendResponse = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Initial message" },
      }),
    });
    await sendResponse.json();

    // First edit — should succeed (editCount: 0 → 1)
    const editResponse1 = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "sent_msg_001", message: "First edit" },
      }),
    });
    assertEquals(editResponse1.status, 200);
    const editBody1 = await editResponse1.json();
    assertEquals(editBody1.success, true);
    assertEquals(sessionRegistry.getEditCount(sessionId), 1);

    // Second edit — should succeed (editCount: 1 → 2)
    const editResponse2 = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "edited_msg_001", message: "Second edit" },
      }),
    });
    assertEquals(editResponse2.status, 200);
    const editBody2 = await editResponse2.json();
    assertEquals(editBody2.success, true);
    assertEquals(sessionRegistry.getEditCount(sessionId), 2);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - edit-reply rejected on 3rd call and triggers termination", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "sent_msg_001" }),
      editMessage: () => Promise.resolve({ success: true, messageId: "edited_msg_001" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    let terminateCalled = false;
    sessionRegistry.setTerminateCallback(sessionId, () => {
      terminateCalled = true;
      return Promise.resolve();
    });

    const port = 3021;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send initial reply
    await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Initial message" },
      }),
    }).then((r) => r.json());

    // Edit 1 — succeeds (editCount: 0 → 1)
    await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "sent_msg_001", message: "First edit" },
      }),
    }).then((r) => r.json());

    // Edit 2 — succeeds (editCount: 1 → 2)
    await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "edited_msg_001", message: "Second edit" },
      }),
    }).then((r) => r.json());

    assertEquals(sessionRegistry.getEditCount(sessionId), 2);

    // Edit 3 — should be rejected (editCount=2 >= 3) and trigger termination
    const editResponse3 = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "edited_msg_001", message: "Third edit" },
      }),
    });
    assertEquals(editResponse3.status, 429);
    const editBody3 = await editResponse3.json();
    assertEquals(editBody3.success, false);
    assertEquals(editBody3.error?.includes("Edit limit reached"), true);

    // editCount should NOT increment on rejected call (rejection happens before execution)
    assertEquals(sessionRegistry.getEditCount(sessionId), 2);

    // Wait for setTimeout(100ms) to fire
    await new Promise((resolve) => setTimeout(resolve, 200));
    assertEquals(terminateCalled, true);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - edit-reply no crash when onTerminateRequest not set", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "sent_msg_001" }),
      editMessage: () => Promise.resolve({ success: true, messageId: "edited_msg_001" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    // Do NOT set onTerminateRequest

    const port = 3022;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send initial reply
    await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Initial message" },
      }),
    }).then((r) => r.json());

    // Execute 2 successful edits to bring editCount to 2. The edit-reply is scoped to the
    // session's last-sent message (F7); since editMessage here returns "edited_msg_001",
    // the tracked lastSentMessageId is "sent_msg_001" for the first edit and
    // "edited_msg_001" for the second.
    const editIds = ["sent_msg_001", "edited_msg_001"];
    for (let i = 1; i <= 2; i++) {
      await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
        method: "POST",
        headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
        body: JSON.stringify({
          sessionId,
          parameters: { messageId: editIds[i - 1], message: `Edit ${i}` },
        }),
      }).then((r) => r.json());
    }

    // 3rd edit should be rejected but not crash (no termination callback)
    const editResponse3 = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "edited_msg_001", message: "Third edit" },
      }),
    });
    assertEquals(editResponse3.status, 429);
    const editBody3 = await editResponse3.json();
    assertEquals(editBody3.success, false);

    // Wait for setTimeout to fire (should be no-op)
    await new Promise((resolve) => setTimeout(resolve, 200));

    // No crash — test passes
    assertEquals(sessionRegistry.getEditCount(sessionId), 2);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - edit-reply count independent from reply count", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: {
        platform: "discord" as const,
        userId: "123",
      },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "sent_msg_001" }),
      editMessage: () => Promise.resolve({ success: true, messageId: "edited_msg_001" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3023;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Send 1 reply — replyCount=1, editCount=0
    const sendResponse = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Initial message" },
      }),
    });
    assertEquals(sendResponse.status, 200);
    await sendResponse.json();
    assertEquals(sessionRegistry.getReplyCount(sessionId), 1);
    assertEquals(sessionRegistry.getEditCount(sessionId), 0);

    // Edit reply once — editCount=1, replyCount still 1
    const editResponse = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "sent_msg_001", message: "Edited" },
      }),
    });
    assertEquals(editResponse.status, 200);
    await editResponse.json();
    assertEquals(sessionRegistry.getEditCount(sessionId), 1);
    assertEquals(sessionRegistry.getReplyCount(sessionId), 1);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - skill API call refreshes session timeout", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Create workspace directory structure for memory-stats
    await Deno.mkdir(`${tempDir}/workspaces/discord/123`, { recursive: true });

    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const port = 3024;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });

    server.start();
    await waitForServer(port);

    // Register session with short timeout (500ms)
    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: {
        key: "discord/123",
        components: { platform: "discord" as const, userId: "123" },
        path: `${tempDir}/workspaces/discord/123`,
        tmpPath: `${tempDir}/workspaces/discord/123/tmp`,
        isDm: false,
      },
      // deno-lint-ignore no-explicit-any
      platformAdapter: { platform: "discord" } as any,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "789",
        isDm: false,
        guildId: "",
        content: "test",
        timestamp: new Date(),
        // deno-lint-ignore no-explicit-any
      } as any,
    });

    // Wait 300ms (past half the original timeout)
    await new Promise((r) => setTimeout(r, 300));

    // Make a skill API call to refresh timeout
    const response = await fetch(`http://localhost:${port}/api/skill/memory-stats`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: {} }),
    });
    const result = await response.json();
    assertEquals(result.success, true);

    // Wait another 300ms (total 600ms from start, exceeds original 500ms timeout,
    // but only 300ms from the touch via API call)
    await new Promise((r) => setTimeout(r, 300));

    // Session should still be valid because the API call refreshed the timeout
    const session = sessionRegistry.get(sessionId);
    assertExists(session);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// 8.4: edit-reply writes reply_edited audit entry
Deno.test("SkillAPIServer - edit-reply success writes reply_edited audit entry", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const mockWorkspace = {
      key: "test/123",
      components: { platform: "discord" as const, userId: "123" },
      path: tempDir,
      tmpPath: tempDir + "/tmp",
      isDm: false,
    };

    const mockAdapter = {
      sendReply: () => Promise.resolve({ success: true, messageId: "original_msg" }),
      editMessage: () => Promise.resolve({ success: true, messageId: "edited_msg" }),
      // deno-lint-ignore no-explicit-any
    } as any;

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      platformAdapter: mockAdapter,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    // Attach audit writer
    const { SessionAuditWriter } = await import("@core/audit-logger.ts");
    const auditDir = `${tempDir}/audit`;
    const auditWriter = new SessionAuditWriter(auditDir, "discord", "123", sessionId, {
      enabled: true,
      retentionDays: 7,
      hashContent: false,
      includedPhases: [],
    });
    sessionRegistry.setAuditWriter(sessionId, auditWriter);

    const port = 3025;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, { port, host: "127.0.0.1" });
    server.start();
    await waitForServer(port);

    // Send initial reply
    await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { message: "Original" } }),
    }).then((r) => r.json());

    // Edit reply
    const editResponse = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { messageId: "original_msg", message: "Edited content" },
      }),
    });
    assertEquals(editResponse.status, 200);
    await editResponse.json();

    // Wait for async audit writes
    await new Promise((r) => setTimeout(r, 200));

    // Read audit file and verify reply_edited entry
    const auditPath = `${auditDir}/discord/123/${sessionId}.jsonl`;
    const content = await Deno.readTextFile(auditPath);
    const entries = content.trim().split("\n").map((l: string) => JSON.parse(l));
    const editedEntry = entries.find((e: { phase: string }) => e.phase === "reply_edited");
    assertExists(editedEntry);
    assertEquals(editedEntry.data.originalMessageId, "original_msg");
    assertEquals(editedEntry.data.replyLength, 14);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// 8.5: memory-save writes memory_operation audit entry
Deno.test("SkillAPIServer - memory-save writes memory_operation audit entry", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const wsDir = `${tempDir}/workspaces/discord/123`;
    await Deno.mkdir(wsDir, { recursive: true });

    const mockWorkspace = {
      key: "discord/123",
      components: { platform: "discord" as const, userId: "123" },
      path: wsDir,
      tmpPath: wsDir + "/tmp",
      isDm: false,
    };

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      // deno-lint-ignore no-explicit-any
      platformAdapter: {} as any,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const { SessionAuditWriter } = await import("@core/audit-logger.ts");
    const auditDir = `${tempDir}/audit`;
    const auditWriter = new SessionAuditWriter(auditDir, "discord", "123", sessionId, {
      enabled: true,
      retentionDays: 7,
      hashContent: false,
      includedPhases: [],
    });
    sessionRegistry.setAuditWriter(sessionId, auditWriter);

    const port = 3026;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, { port, host: "127.0.0.1" });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/memory-save`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { content: "User likes cats", visibility: "public", tier: "working" },
      }),
    });
    assertEquals(response.status, 200);
    await response.json();

    await new Promise((r) => setTimeout(r, 200));

    const auditPath = `${auditDir}/discord/123/${sessionId}.jsonl`;
    const content = await Deno.readTextFile(auditPath);
    const entries = content.trim().split("\n").map((l: string) => JSON.parse(l));
    const memEntry = entries.find((e: { phase: string }) => e.phase === "memory_operation");
    assertExists(memEntry);
    assertEquals(memEntry.data.operation, "save");
    assertEquals(memEntry.data.visibility, "public");
    assertEquals(memEntry.data.tier, "working");
    assertEquals(auditWriter.getSummaryCounters().memoryOpsCount, 1);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// 8.5: memory-search writes memory_operation audit entry
Deno.test("SkillAPIServer - memory-search writes memory_operation audit entry", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const wsDir = `${tempDir}/workspaces/discord/123`;
    await Deno.mkdir(wsDir, { recursive: true });

    const mockWorkspace = {
      key: "discord/123",
      components: { platform: "discord" as const, userId: "123" },
      path: wsDir,
      tmpPath: wsDir + "/tmp",
      isDm: false,
    };

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: mockWorkspace,
      // deno-lint-ignore no-explicit-any
      platformAdapter: {} as any,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const { SessionAuditWriter } = await import("@core/audit-logger.ts");
    const auditDir = `${tempDir}/audit`;
    const auditWriter = new SessionAuditWriter(auditDir, "discord", "123", sessionId, {
      enabled: true,
      retentionDays: 7,
      hashContent: false,
      includedPhases: [],
    });
    sessionRegistry.setAuditWriter(sessionId, auditWriter);

    const port = 3027;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, { port, host: "127.0.0.1" });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/memory-search`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { query: "cats" },
      }),
    });
    assertEquals(response.status, 200);
    await response.json();

    await new Promise((r) => setTimeout(r, 200));

    const auditPath = `${auditDir}/discord/123/${sessionId}.jsonl`;
    const content = await Deno.readTextFile(auditPath);
    const entries = content.trim().split("\n").map((l: string) => JSON.parse(l));
    const memEntry = entries.find((e: { phase: string }) => e.phase === "memory_operation");
    assertExists(memEntry);
    assertEquals(memEntry.data.operation, "search");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============ Send-file quota, doom-loop, and audit tests ============

function createSendFileRig(
  tempDir: string,
  options?: { hashContent?: boolean; adapter?: unknown },
) {
  const sessionRegistry = new SessionRegistry();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  const skillRegistry = new SkillRegistry(
    memoryStore,
    undefined,
    undefined,
    { enabled: true, allowedExtensions: [] },
  );

  const mockWorkspace = {
    key: "discord/123",
    components: { platform: "discord" as const, userId: "123" },
    path: tempDir,
    tmpPath: tempDir + "/tmp",
    isDm: false,
  };

  const mockAdapter = options?.adapter ?? {
    sendFile: () =>
      Promise.resolve({
        success: true,
        messageId: "file_msg_1",
        messageIds: ["file_msg_1"],
      }),
    // deno-lint-ignore no-explicit-any
  } as any;

  const sessionId = sessionRegistry.register({
    platform: "discord",
    channelId: "456",
    userId: "123",
    isDm: false,
    workspace: mockWorkspace,
    platformAdapter: mockAdapter,
    triggerEvent: {
      platform: "discord",
      channelId: "456",
      userId: "123",
      messageId: "msg_trigger",
      isDm: false,
      guildId: "",
      content: "",
      timestamp: new Date(),
    },
  });

  return { sessionRegistry, skillRegistry, sessionId, mockWorkspace };
}

Deno.test("SkillAPIServer - send-file rejected after one successful call", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir);
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.txt`, "aaa");

    const port = 3101;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const callSendFile = (filePaths: string[]) =>
      fetch(`http://localhost:${port}/api/skill/send-file`, {
        method: "POST",
        headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
        body: JSON.stringify({ sessionId: rig.sessionId, parameters: { filePaths } }),
      });

    const response1 = await callSendFile(["a.txt"]);
    const body1 = await response1.json();
    assertEquals(response1.status, 200, JSON.stringify(body1));
    assertEquals(body1.success, true);

    // Second send-file (different parameters to bypass the dedup cache) must be
    // rejected with 429
    const response2 = await callSendFile(["b.txt"]);
    assertEquals(response2.status, 429);
    const body2 = await response2.json();
    assertEquals(body2.success, false);
    assertEquals(body2.error?.includes("File send limit reached"), true);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-file quota not consumed on total failure (rollback)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir, {
      adapter: {
        sendFile: () => Promise.resolve({ success: false, error: "Platform error" }),
        // deno-lint-ignore no-explicit-any
      } as any,
    });
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.txt`, "aaa");

    const port = 3102;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const callSendFile = (filePath: string) =>
      fetch(`http://localhost:${port}/api/skill/send-file`, {
        method: "POST",
        headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
        body: JSON.stringify({
          sessionId: rig.sessionId,
          parameters: { filePaths: [filePath] },
        }),
      });

    // First attempt fails entirely → slot rolled back
    const response1 = await callSendFile("a.txt");
    assertEquals(response1.status, 400);
    await response1.json();

    // Second attempt (different parameters to bypass the dedup cache) still
    // allowed — the failed attempt did not consume the quota
    const response2 = await callSendFile("b.txt");
    assertEquals(response2.status, 400);
    await response2.json();

    assertEquals(rig.sessionRegistry.getFileSendCount(rig.sessionId), 0);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-file doom-loop terminates agent after 4 attempts", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir);
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.txt`, "aaa");

    let terminated = false;
    rig.sessionRegistry.setTerminateCallback(rig.sessionId, () => {
      terminated = true;
      return Promise.resolve();
    });

    const port = 3103;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const callSendFile = (filePath: string) =>
      fetch(`http://localhost:${port}/api/skill/send-file`, {
        method: "POST",
        headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
        body: JSON.stringify({
          sessionId: rig.sessionId,
          parameters: { filePaths: [filePath] },
        }),
      });

    // Attempt 1: succeeds (count 1). Attempts 2-4 (distinct params to bypass the
    // dedup cache): rejected; the 4th triggers doom-loop.
    const r1 = await callSendFile("a.txt");
    assertEquals(r1.status, 200);
    await r1.json();
    const attempts = ["b.txt", "c.txt", "d.txt"];
    for (const filePath of attempts) {
      const r = await callSendFile(filePath);
      assertEquals(r.status, 429);
      await r.json();
    }
    assertEquals(rig.sessionRegistry.getFileSendCount(rig.sessionId), 4);

    // Termination is scheduled after the response is sent
    await new Promise((r) => setTimeout(r, 300));
    assertEquals(terminated, true);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-file writes file_sent audit entry (hashContent true)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir);
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.png`, "aaa");
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/b.png`, "bbb");

    const { SessionAuditWriter } = await import("@core/audit-logger.ts");
    const auditDir = `${tempDir}/audit`;
    const auditWriter = new SessionAuditWriter(auditDir, "discord", "123", rig.sessionId, {
      enabled: true,
      retentionDays: 7,
      hashContent: true,
      includedPhases: [],
    });
    rig.sessionRegistry.setAuditWriter(rig.sessionId, auditWriter);

    const port = 3104;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
      body: JSON.stringify({
        sessionId: rig.sessionId,
        parameters: { filePaths: ["a.png", "b.png"], caption: "here you go" },
      }),
    });
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.success, true);

    await new Promise((r) => setTimeout(r, 200));

    const auditPath = `${auditDir}/discord/123/${rig.sessionId}.jsonl`;
    const content = await Deno.readTextFile(auditPath);
    const entries = content.trim().split("\n").map((l: string) => JSON.parse(l));
    const sentEntry = entries.find((e: { phase: string }) => e.phase === "file_sent");
    assertExists(sentEntry);
    assertEquals(sentEntry.data.filesCount, 2);
    assertEquals(sentEntry.data.platform, "discord");
    // Delivered message IDs are recorded verbatim (not user content)
    assertEquals(sentEntry.data.messageId, "file_msg_1");
    assertEquals(sentEntry.data.messageIds, ["file_msg_1"]);
    assertStringIncludes(sentEntry.data.captionHash as string, "sha256:");
    assertStringIncludes(sentEntry.data.fileNamesHash as string, "sha256:");
    // File content itself is never hashed/recorded
    assertEquals("fileContent" in sentEntry.data, false);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - file_sent audit entry without caption and without hashing", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir);
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.png`, "aaa");

    const { SessionAuditWriter } = await import("@core/audit-logger.ts");
    const auditDir = `${tempDir}/audit`;
    const auditWriter = new SessionAuditWriter(auditDir, "discord", "123", rig.sessionId, {
      enabled: true,
      retentionDays: 7,
      hashContent: false,
      includedPhases: [],
    });
    rig.sessionRegistry.setAuditWriter(rig.sessionId, auditWriter);

    const port = 3105;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
      body: JSON.stringify({
        sessionId: rig.sessionId,
        parameters: { filePaths: ["a.png"] },
      }),
    });
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.success, true);

    await new Promise((r) => setTimeout(r, 200));

    const auditPath = `${auditDir}/discord/123/${rig.sessionId}.jsonl`;
    const content = await Deno.readTextFile(auditPath);
    const entries = content.trim().split("\n").map((l: string) => JSON.parse(l));
    const sentEntry = entries.find((e: { phase: string }) => e.phase === "file_sent");
    assertExists(sentEntry);
    assertEquals(sentEntry.data.filesCount, 1);
    // No caption → no captionHash field; no hashing → plain file names
    assertEquals("captionHash" in sentEntry.data, false);
    assertEquals(sentEntry.data.fileNames, "a.png");

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-file rejected for triggerless sessions (no triggerEvent)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(
      memoryStore,
      undefined,
      undefined,
      { enabled: true, allowedExtensions: [] },
    );

    // Session registered WITHOUT a trigger event (spontaneous-like)
    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: {
        key: "discord/123",
        components: { platform: "discord" as const, userId: "123" },
        path: tempDir,
        tmpPath: tempDir + "/tmp",
        isDm: false,
      },
      platformAdapter: {
        sendFile: () =>
          Promise.resolve({
            success: true,
            messageId: "m",
            messageIds: ["m"],
          }),
        // deno-lint-ignore no-explicit-any
      } as any,
    });

    const port = 3106;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { filePaths: ["a.txt"] },
      }),
    });

    assertEquals(response.status, 403);
    const body = await response.json();
    assertEquals(body.success, false);
    assertStringIncludes(body.error as string, "user-triggered");
    // Nothing was marked or counted
    assertEquals(sessionRegistry.hasFileSent(sessionId), false);
    assertEquals(sessionRegistry.getFileSendCount(sessionId), 0);

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - partial delivery marks fileSent and keeps the quota slot", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir, {
      adapter: {
        sendFile: () =>
          Promise.resolve({
            success: false,
            messageId: "chat_1",
            messageIds: ["chat_1"],
            error: "Mid-batch failure",
          }),
        // deno-lint-ignore no-explicit-any
      } as any,
    });
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.txt`, "aaa");

    const port = 3107;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
      body: JSON.stringify({ sessionId: rig.sessionId, parameters: { filePaths: ["a.txt"] } }),
    });
    assertEquals(response.status, 400);
    const body = await response.json();
    assertEquals(body.success, false);
    assertEquals(body.error, "Mid-batch failure");

    // 1 of 2 delivered → session counts as responded, quota slot kept
    assertEquals(rig.sessionRegistry.hasFileSent(rig.sessionId), true);
    assertEquals(rig.sessionRegistry.getFileSendCount(rig.sessionId), 1);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - identical repeated send-file calls still reach the doom-loop gate (no result caching)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir);
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.txt`, "aaa");

    let terminated = false;
    rig.sessionRegistry.setTerminateCallback(rig.sessionId, () => {
      terminated = true;
      return Promise.resolve();
    });

    const port = 3108;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    // All calls use IDENTICAL parameters — the 1s dedup cache must NOT swallow
    // them, otherwise the quota gate and doom-loop detection would be starved.
    const callSendFile = () =>
      fetch(`http://localhost:${port}/api/skill/send-file`, {
        method: "POST",
        headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
        body: JSON.stringify({ sessionId: rig.sessionId, parameters: { filePaths: ["a.txt"] } }),
      });

    const r1 = await callSendFile();
    assertEquals(r1.status, 200);
    await r1.json();
    for (let i = 0; i < 3; i++) {
      const r = await callSendFile();
      assertEquals(r.status, 429);
      await r.json();
    }
    assertEquals(rig.sessionRegistry.getFileSendCount(rig.sessionId), 4);

    await new Promise((r) => setTimeout(r, 300));
    assertEquals(terminated, true);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============ Reply threading anchor tests (file-message-reply-threading) ============

Deno.test("SkillAPIServer - send-file success stores lastFileMessageId (not lastSentMessageId)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir);
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.txt`, "aaa");

    const port = 3201;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
      body: JSON.stringify({ sessionId: rig.sessionId, parameters: { filePaths: ["a.txt"] } }),
    });
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.success, true);

    // The delivered ID lands in lastFileMessageId ONLY — the edit scope
    // (lastSentMessageId) must stay untouched so file messages are not
    // editable.
    assertEquals(rig.sessionRegistry.getLastFileMessageId(rig.sessionId), "file_msg_1");
    assertEquals(rig.sessionRegistry.getLastSentMessageId(rig.sessionId), undefined);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-file total failure records no message ID", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir, {
      adapter: {
        sendFile: () => Promise.resolve({ success: false, error: "Platform error" }),
        // deno-lint-ignore no-explicit-any
      } as any,
    });
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.txt`, "aaa");

    const port = 3202;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
      body: JSON.stringify({ sessionId: rig.sessionId, parameters: { filePaths: ["a.txt"] } }),
    });
    assertEquals(response.status, 400);
    await response.json();

    assertEquals(rig.sessionRegistry.getLastFileMessageId(rig.sessionId), undefined);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-file delivery without a usable message ID records no anchor", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const rig = createSendFileRig(tempDir, {
      adapter: {
        sendFile: () => Promise.resolve({ success: true }),
        // deno-lint-ignore no-explicit-any
      } as any,
    });
    await Deno.writeTextFile(`${rig.mockWorkspace.path}/a.txt`, "aaa");

    const port = 3203;
    const server = new SkillAPIServer(rig.sessionRegistry, rig.skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(rig.sessionRegistry.getCallerToken(rig.sessionId)),
      body: JSON.stringify({ sessionId: rig.sessionId, parameters: { filePaths: ["a.txt"] } }),
    });
    const body = await response.json();
    assertEquals(response.status, 200, JSON.stringify(body));
    assertEquals(body.success, true);

    // Files were delivered (fileSent marked) but no usable ID exists — the
    // anchor stays on the trigger, never a bogus ID.
    assertEquals(rig.sessionRegistry.hasFileSent(rig.sessionId), true);
    assertEquals(rig.sessionRegistry.getLastFileMessageId(rig.sessionId), undefined);

    await server.stop();
    rig.sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-reply success records the per-reply anchor", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: {
        key: "discord/123",
        components: { platform: "discord" as const, userId: "123" },
        path: tempDir,
        tmpPath: tempDir + "/tmp",
        isDm: false,
      },
      platformAdapter: {
        sendReply: () => Promise.resolve({ success: true, messageId: "reply_1" }),
        // deno-lint-ignore no-explicit-any
      } as any,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });

    const port = 3204;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const response = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { message: "Hello!" } }),
    });
    assertEquals(response.status, 200);
    await response.json();

    // The reply was created as a reply to the trigger (no file sent yet)
    assertEquals(sessionRegistry.getLastReplyAnchorMessageId(sessionId), "msg_trigger");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - send-reply after send-file threads to the file message", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(
      memoryStore,
      undefined,
      undefined,
      { enabled: true, allowedExtensions: [] },
    );

    let capturedReplyAnchor: string | undefined;
    let capturedEditAnchor: string | undefined;
    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: {
        key: "discord/123",
        components: { platform: "discord" as const, userId: "123" },
        path: tempDir,
        tmpPath: tempDir + "/tmp",
        isDm: false,
      },
      platformAdapter: {
        sendFile: () =>
          Promise.resolve({
            success: true,
            messageId: "file_msg_1",
            messageIds: ["file_msg_1"],
          }),
        sendReply: (
          _channelId: string,
          _content: string,
          options?: { replyToMessageId?: string },
        ) => {
          capturedReplyAnchor = options?.replyToMessageId;
          return Promise.resolve({ success: true, messageId: "reply_1" });
        },
        fetchMessage: () => Promise.resolve(null),
        editMessage: (
          _channelId: string,
          _messageId: string,
          _newContent: string,
          replyToMessageId?: string,
        ) => {
          capturedEditAnchor = replyToMessageId;
          return Promise.resolve({ success: true, messageId: "reply_1_edited" });
        },
        // deno-lint-ignore no-explicit-any
      } as any,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });
    await Deno.writeTextFile(`${tempDir}/a.txt`, "aaa");

    const port = 3205;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    // 1. Send files
    const fileResponse = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { filePaths: ["a.txt"] } }),
    });
    assertEquals(fileResponse.status, 200);
    await fileResponse.json();

    // 2. Send a reply — the skill context resolves replyToMessageId to the
    //    file message, NOT the trigger
    const replyResponse = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { message: "Here are the files" } }),
    });
    assertEquals(replyResponse.status, 200);
    await replyResponse.json();

    assertEquals(capturedReplyAnchor, "file_msg_1");
    // The per-reply anchor recorded is the anchor that call used
    assertEquals(sessionRegistry.getLastReplyAnchorMessageId(sessionId), "file_msg_1");
    // Edit scope stays on the text reply
    assertEquals(sessionRegistry.getLastSentMessageId(sessionId), "reply_1");
    assertEquals(sessionRegistry.getLastFileMessageId(sessionId), "file_msg_1");

    // 3. Edit the reply — the recreated message keeps the reply's OWN anchor
    //    (the file message), so Misskey delete-and-recreate never re-threads
    //    the reply to a different parent
    const editResponse = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { messageId: "reply_1", message: "Edited" } }),
    });
    assertEquals(editResponse.status, 200);
    await editResponse.json();

    assertEquals(capturedEditAnchor, "file_msg_1");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - react-message after a file send targets the trigger message", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(
      memoryStore,
      undefined,
      undefined,
      { enabled: true, allowedExtensions: [] },
    );

    let reactedMessageId: string | undefined;
    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: {
        key: "discord/123",
        components: { platform: "discord" as const, userId: "123" },
        path: tempDir,
        tmpPath: tempDir + "/tmp",
        isDm: false,
      },
      platformAdapter: {
        sendFile: () =>
          Promise.resolve({
            success: true,
            messageId: "file_msg_1",
            messageIds: ["file_msg_1"],
          }),
        addReaction: (_channelId: string, messageId: string) => {
          reactedMessageId = messageId;
          return Promise.resolve({ success: true });
        },
        // deno-lint-ignore no-explicit-any
      } as any,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });
    await Deno.writeTextFile(`${tempDir}/a.txt`, "aaa");

    const port = 3206;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    const fileResponse = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { filePaths: ["a.txt"] } }),
    });
    assertEquals(fileResponse.status, 200);
    await fileResponse.json();

    const reactResponse = await fetch(`http://localhost:${port}/api/skill/react-message`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { emoji: "👍" } }),
    });
    assertEquals(reactResponse.status, 200);
    await reactResponse.json();

    // triggerMessageId in the skill context keeps reactions on the user's
    // message, never the bot's file message
    assertEquals(reactedMessageId, "msg_trigger");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - ordering: reply → file → edit keeps the edited reply on the trigger anchor", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(
      memoryStore,
      undefined,
      undefined,
      { enabled: true, allowedExtensions: [] },
    );

    let editAnchor: string | undefined;
    const sessionId = sessionRegistry.register({
      platform: "discord",
      channelId: "456",
      userId: "123",
      isDm: false,
      workspace: {
        key: "discord/123",
        components: { platform: "discord" as const, userId: "123" },
        path: tempDir,
        tmpPath: tempDir + "/tmp",
        isDm: false,
      },
      platformAdapter: {
        sendReply: () => Promise.resolve({ success: true, messageId: "reply_1" }),
        sendFile: () =>
          Promise.resolve({
            success: true,
            messageId: "file_msg_1",
            messageIds: ["file_msg_1"],
          }),
        fetchMessage: () => Promise.resolve(null),
        editMessage: (
          _channelId: string,
          _messageId: string,
          _newContent: string,
          replyToMessageId?: string,
        ) => {
          editAnchor = replyToMessageId;
          return Promise.resolve({ success: true, messageId: "reply_1_edited" });
        },
        // deno-lint-ignore no-explicit-any
      } as any,
      triggerEvent: {
        platform: "discord",
        channelId: "456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: false,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });
    await Deno.writeTextFile(`${tempDir}/a.txt`, "aaa");

    const port = 3207;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    // 1. Reply first (threads to the trigger)
    const replyResponse = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { message: "First" } }),
    });
    assertEquals(replyResponse.status, 200);
    await replyResponse.json();
    assertEquals(sessionRegistry.getLastReplyAnchorMessageId(sessionId), "msg_trigger");

    // 2. Send files afterwards (the current anchor becomes the file message)
    const fileResponse = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { filePaths: ["a.txt"] } }),
    });
    assertEquals(fileResponse.status, 200);
    await fileResponse.json();

    // 3. Edit the earlier reply — Misskey delete-and-recreate must keep the
    //    reply's ORIGINAL thread parent (the trigger), not the file message
    const editResponse = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { messageId: "reply_1", message: "Edited" } }),
    });
    assertEquals(editResponse.status, 200);
    await editResponse.json();

    assertEquals(editAnchor, "msg_trigger");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SkillAPIServer - Misskey chat partial delivery records the last delivered ID and threads to it", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const sessionRegistry = new SessionRegistry();
    const workspaceManager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const skillRegistry = new SkillRegistry(
      memoryStore,
      undefined,
      undefined,
      { enabled: true, allowedExtensions: [] },
    );

    let capturedReplyAnchor: string | undefined;
    const sessionId = sessionRegistry.register({
      platform: "misskey",
      channelId: "chat:456",
      userId: "123",
      isDm: true,
      workspace: {
        key: "misskey/123",
        components: { platform: "misskey" as const, userId: "123" },
        path: tempDir,
        tmpPath: tempDir + "/tmp",
        isDm: true,
      },
      platformAdapter: {
        sendFile: () =>
          Promise.resolve({
            success: false,
            messageIds: ["file-1", "file-2"],
            error: "Mid-batch failure (2 of 3 delivered)",
          }),
        sendReply: (
          _channelId: string,
          _content: string,
          options?: { replyToMessageId?: string },
        ) => {
          capturedReplyAnchor = options?.replyToMessageId;
          return Promise.resolve({ success: true, messageId: "reply_1" });
        },
        // deno-lint-ignore no-explicit-any
      } as any,
      triggerEvent: {
        platform: "misskey",
        channelId: "chat:456",
        userId: "123",
        messageId: "msg_trigger",
        isDm: true,
        guildId: "",
        content: "",
        timestamp: new Date(),
      },
    });
    await Deno.writeTextFile(`${tempDir}/a.txt`, "aaa");
    await Deno.writeTextFile(`${tempDir}/b.txt`, "bbb");
    await Deno.writeTextFile(`${tempDir}/c.txt`, "ccc");

    const port = 3208;
    const server = new SkillAPIServer(sessionRegistry, skillRegistry, {
      port,
      host: "127.0.0.1",
    });
    server.start();
    await waitForServer(port);

    // 1. Partial delivery (2 of 3 files)
    const fileResponse = await fetch(`http://localhost:${port}/api/skill/send-file`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({
        sessionId,
        parameters: { filePaths: ["a.txt", "b.txt", "c.txt"] },
      }),
    });
    assertEquals(fileResponse.status, 400);
    const fileBody = await fileResponse.json();
    assertEquals(fileBody.success, false);

    // Session responded; anchor = the last DELIVERED message
    assertEquals(sessionRegistry.hasFileSent(sessionId), true);
    assertEquals(sessionRegistry.getLastFileMessageId(sessionId), "file-2");

    // 2. A subsequent send-reply threads to the last delivered chat message
    const replyResponse = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: jsonHeaders(sessionRegistry.getCallerToken(sessionId)),
      body: JSON.stringify({ sessionId, parameters: { message: "Partial delivery" } }),
    });
    assertEquals(replyResponse.status, 200);
    await replyResponse.json();

    assertEquals(capturedReplyAnchor, "file-2");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
