// tests/skill-api/server.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";

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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assertEquals(response1.status, 400);
    const body1 = await response1.json();
    assertEquals(body1.success, false);
    assertEquals(body1.error, "Missing sessionId");

    // Test with invalid sessionId
    const response2 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Message 1" },
      }),
    });
    await response1.json();

    // 2nd reply should be rejected with 429
    const response4 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Message 1" },
      }),
    });
    await replyResponse.json();

    // edit-reply should still work
    const editResponse = await fetch(`http://localhost:${port}/api/skill/edit-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
        headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
        headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
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
      timeoutMs: 60000,
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Hello!" },
      }),
    });
    await sendResponse.json();

    // Now call get-message without messageId — should use lastSentMessageId
    const getResponse = await fetch(`http://localhost:${port}/api/skill/get-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
