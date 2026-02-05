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
      key: "test/123/456",
      components: {
        platform: "discord" as const,
        userId: "123",
        channelId: "456",
      },
      path: tempDir,
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

Deno.test("SkillAPIServer - enforces single reply rule", async () => {
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
      key: "test/123/456",
      components: {
        platform: "discord" as const,
        userId: "123",
        channelId: "456",
      },
      path: tempDir,
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

    // First reply should succeed
    const response1 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Test message" },
      }),
    });

    assertEquals(response1.status, 200);
    const body1 = await response1.json();
    assertEquals(body1.success, true);

    // Second reply should fail
    const response2 = await fetch(`http://localhost:${port}/api/skill/send-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        parameters: { message: "Second message" },
      }),
    });

    assertEquals(response2.status, 409);
    const body2 = await response2.json();
    assertEquals(body2.success, false);
    assertEquals(body2.error, "Reply already sent for this session");

    await server.stop();
    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
