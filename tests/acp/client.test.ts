// tests/acp/client.test.ts

import { assertEquals } from "@std/assert";
import { ChatbotClient } from "@acp/client.ts";
import * as acp from "@agentclientprotocol/sdk";
import { Logger, LogLevel } from "@utils/logger.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";

// Create a minimal logger for testing
const createTestLogger = (): Logger => {
  return new Logger("test", { level: LogLevel.FATAL }); // Suppress most logs
};

// Create a test skill registry
const createTestSkillRegistry = (): SkillRegistry => {
  const tempDir = Deno.makeTempDirSync();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  return new SkillRegistry(memoryStore);
};

Deno.test("ChatbotClient - constructs successfully", () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);
    assertEquals(client.hasReplySent(), false);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - reset clears reply state", () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);
    client.markReplySent();
    assertEquals(client.hasReplySent(), true);

    client.reset();
    assertEquals(client.hasReplySent(), false);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - requestPermission auto-approves registered skills", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);

    // Create a mock RequestPermissionRequest for a known skill
    const request: acp.RequestPermissionRequest = {
      sessionId: "test-session",
      toolCall: {
        title: "memory-save",
        kind: null,
        status: "pending" as const,
        rawInput: { skill: "memory-save" },
        content: [],
        toolCallId: "test-id",
      },
      options: [
        { kind: "allow_once", optionId: "allow-1", name: "Allow once" },
        { kind: "reject_once", optionId: "reject-1", name: "Reject once" },
      ],
    };

    const response = await client.requestPermission(request);
    assertEquals(response.outcome.outcome, "selected");
    if (response.outcome.outcome === "selected") {
      assertEquals(response.outcome.optionId, "allow-1");
    }
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - requestPermission rejects unknown skills", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);

    // Create a mock RequestPermissionRequest for unknown skill
    const request: acp.RequestPermissionRequest = {
      sessionId: "test-session",
      toolCall: {
        title: "unknown-skill",
        kind: null,
        status: "pending" as const,
        rawInput: { skill: "unknown-skill" },
        content: [],
        toolCallId: "test-id",
      },
      options: [
        { kind: "allow_once", optionId: "allow-1", name: "Allow once" },
        { kind: "reject_once", optionId: "reject-1", name: "Reject once" },
      ],
    };

    const response = await client.requestPermission(request);
    assertEquals(response.outcome.outcome, "selected");
    if (response.outcome.outcome === "selected") {
      assertEquals(response.outcome.optionId, "reject-1");
    }
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - requestPermission auto-approves skills directory read", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);

    // Create a mock RequestPermissionRequest for reading skills directory
    const request: acp.RequestPermissionRequest = {
      sessionId: "test-session",
      toolCall: {
        title: "Access paths outside trusted directories",
        kind: "read",
        status: "pending" as const,
        content: [],
        toolCallId: "test-id",
        locations: [
          { path: "/home/deno/.copilot/skills/send-reply" },
        ],
      },
      options: [
        { kind: "allow_once", optionId: "allow-1", name: "Allow once" },
        { kind: "reject_once", optionId: "reject-1", name: "Reject once" },
      ],
    };

    const response = await client.requestPermission(request);
    assertEquals(response.outcome.outcome, "selected");
    if (response.outcome.outcome === "selected") {
      assertEquals(response.outcome.optionId, "allow-1");
    }
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - readTextFile validates path within working directory", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);

    // Create a test file
    const testFilePath = `${tempDir}/test.txt`;
    await Deno.writeTextFile(testFilePath, "test content");

    // Should succeed - file is within working directory
    const response = await client.readTextFile({ path: testFilePath, sessionId: "test-session" });
    assertEquals(response.content, "test content");
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - readTextFile rejects path outside working directory", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);

    // Try to read file outside working directory
    let errorThrown = false;
    try {
      await client.readTextFile({ path: "/etc/passwd", sessionId: "test-session" });
    } catch (error) {
      errorThrown = true;
      assertEquals(error instanceof acp.RequestError, true);
    }
    assertEquals(errorThrown, true);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - writeTextFile validates path within working directory", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);

    // Should succeed - file is within working directory
    const testFilePath = `${tempDir}/test-write.txt`;
    await client.writeTextFile({
      path: testFilePath,
      content: "new content",
      sessionId: "test-session",
    });

    const content = await Deno.readTextFile(testFilePath);
    assertEquals(content, "new content");
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - writeTextFile rejects path outside working directory", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);

    // Try to write file outside working directory
    let errorThrown = false;
    try {
      await client.writeTextFile({
        path: "/tmp/outside.txt",
        content: "test",
        sessionId: "test-session",
      });
    } catch (error) {
      errorThrown = true;
      assertEquals(error instanceof acp.RequestError, true);
    }
    assertEquals(errorThrown, true);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - sessionUpdate handles various update types", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const skillRegistry = createTestSkillRegistry();
    const logger = createTestLogger();
    const config = {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    };

    const client = new ChatbotClient(skillRegistry, logger, config);

    // Test agent_message_chunk
    await client.sessionUpdate({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      },
    } as acp.SessionNotification);

    // Test tool_call
    await client.sessionUpdate({
      sessionId: "test-session",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "test-id",
        title: "test",
        kind: null,
        status: "pending" as const,
      },
    } as unknown as acp.SessionNotification);

    // Should not throw errors
    assertEquals(true, true);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});
