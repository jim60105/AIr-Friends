// tests/core/session-orchestrator.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { Config } from "../../src/types/config.ts";
import type { NormalizedEvent, PlatformMessage } from "../../src/types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PlatformCapabilities, ReplyResult } from "../../src/types/platform.ts";

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

  sendReply(
    _channelId: string,
    _content: string,
  ): Promise<ReplyResult> {
    return Promise.resolve({
      success: true,
      messageId: "mock_msg_" + Date.now(),
    });
  }

  fetchRecentMessages(
    _channelId: string,
    _limit: number,
  ): Promise<PlatformMessage[]> {
    return Promise.resolve([]);
  }

  getUsername(userId: string): Promise<string> {
    return Promise.resolve(`user_${userId}`);
  }

  isSelf(userId: string): boolean {
    return userId === "bot_id";
  }

  onEvent() {}
  offEvent() {}
}

// Helper to create test config
function createTestConfig(tempDir: string): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test.com", token: "test", enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: "./prompts/system.md",
      tokenLimit: 4096,
      defaultAgentType: "copilot",
    },
    memory: {
      searchLimit: 10,
      maxChars: 2000,
      recentMessageLimit: 20,
    },
    workspace: {
      repoPath: tempDir,
      workspacesDir: "workspaces",
    },
    logging: {
      level: "FATAL",
    },
    accessControl: {
      replyTo: "whitelist",
      whitelist: [],
    },
  };
}

// Helper to create test event
function createTestEvent(): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "test_channel",
    userId: "test_user",
    messageId: "test_msg",
    isDm: false,
    guildId: "test_guild",
    content: "Hello bot!",
    timestamp: new Date(),
  };
}

Deno.test("SessionOrchestrator - constructs successfully", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig(tempDir);
    const workspaceManager = new WorkspaceManager({
      repoPath: config.workspace.repoPath,
      workspacesDir: config.workspace.workspacesDir,
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: config.memory.searchLimit,
      maxChars: config.memory.maxChars,
    });
    const skillRegistry = new SkillRegistry(memoryStore);
    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: config.agent.systemPromptPath,
      recentMessageLimit: config.memory.recentMessageLimit,
      tokenLimit: config.agent.tokenLimit,
      memoryMaxChars: config.memory.maxChars,
    });

    const sessionRegistry = new SessionRegistry();

    const orchestrator = new SessionOrchestrator(
      workspaceManager,
      contextAssembler,
      skillRegistry,
      config,
      sessionRegistry,
    );

    assertExists(orchestrator);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processMessage creates workspace", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig(tempDir);
    const workspaceManager = new WorkspaceManager({
      repoPath: config.workspace.repoPath,
      workspacesDir: config.workspace.workspacesDir,
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: config.memory.searchLimit,
      maxChars: config.memory.maxChars,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    // Create a system prompt file
    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system.md`,
      recentMessageLimit: config.memory.recentMessageLimit,
      tokenLimit: config.agent.tokenLimit,
      memoryMaxChars: config.memory.maxChars,
    });

    const sessionRegistry = new SessionRegistry();

    const orchestrator = new SessionOrchestrator(
      workspaceManager,
      contextAssembler,
      skillRegistry,
      config,
      sessionRegistry,
    );

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    // Note: This will fail because we don't have copilot CLI installed
    // But it should at least create the workspace
    const response = await orchestrator.processMessage(event, platformAdapter);

    // Verify response structure
    assertExists(response);
    assertEquals(typeof response.success, "boolean");
    assertEquals(typeof response.replySent, "boolean");

    // Verify workspace was created
    const workspaceKey = workspaceManager.getWorkspaceKeyFromEvent(event);
    const workspacePath = workspaceManager.getWorkspacePath(workspaceKey);
    const workspaceExists = await Deno.stat(workspacePath)
      .then(() => true)
      .catch(() => false);
    assertEquals(workspaceExists, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - skips agent execution for /clear command", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig(tempDir);
    const workspaceManager = new WorkspaceManager({
      repoPath: config.workspace.repoPath,
      workspacesDir: config.workspace.workspacesDir,
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: config.memory.searchLimit,
      maxChars: config.memory.maxChars,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    // Create a system prompt file
    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system.md`,
      recentMessageLimit: config.memory.recentMessageLimit,
      tokenLimit: config.agent.tokenLimit,
      memoryMaxChars: config.memory.maxChars,
    });

    const sessionRegistry = new SessionRegistry();

    const orchestrator = new SessionOrchestrator(
      workspaceManager,
      contextAssembler,
      skillRegistry,
      config,
      sessionRegistry,
    );

    const event = createTestEvent();
    event.content = "/clear"; // Set trigger message to /clear command
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    // Process the message - should return immediately without agent execution
    const response = await orchestrator.processMessage(event, platformAdapter);

    // Verify response indicates success but no reply sent
    assertEquals(response.success, true);
    assertEquals(response.replySent, false);

    // Verify workspace was NOT created (since we exit early)
    const workspaceKey = workspaceManager.getWorkspaceKeyFromEvent(event);
    const workspacePath = workspaceManager.getWorkspacePath(workspaceKey);
    const workspaceExists = await Deno.stat(workspacePath)
      .then(() => true)
      .catch(() => false);
    assertEquals(workspaceExists, false);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - handles /clear with leading whitespace", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig(tempDir);
    const workspaceManager = new WorkspaceManager({
      repoPath: config.workspace.repoPath,
      workspacesDir: config.workspace.workspacesDir,
    });
    const memoryStore = new MemoryStore(workspaceManager, {
      searchLimit: config.memory.searchLimit,
      maxChars: config.memory.maxChars,
    });
    const skillRegistry = new SkillRegistry(memoryStore);

    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system.md`,
      recentMessageLimit: config.memory.recentMessageLimit,
      tokenLimit: config.agent.tokenLimit,
      memoryMaxChars: config.memory.maxChars,
    });

    const sessionRegistry = new SessionRegistry();

    const orchestrator = new SessionOrchestrator(
      workspaceManager,
      contextAssembler,
      skillRegistry,
      config,
      sessionRegistry,
    );

    const event = createTestEvent();
    event.content = "  /clear"; // With leading whitespace
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.replySent, false);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
