// tests/core/agent-core.test.ts

import { assertEquals, assertExists } from "@std/assert";
import { AgentCore } from "@core/agent-core.ts";
import type { Config } from "../../src/types/config.ts";
import type { NormalizedEvent, PlatformMessage } from "../../src/types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type {
  ConnectionState,
  PlatformCapabilities,
  ReplyResult,
} from "../../src/types/platform.ts";

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

  private eventHandlers: Array<(event: NormalizedEvent) => Promise<void>> = [];
  sentReplies: Array<{ channelId: string; content: string }> = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  sendReply(channelId: string, content: string): Promise<ReplyResult> {
    this.sentReplies.push({ channelId, content });
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

  onEvent(handler: (event: NormalizedEvent) => Promise<void>): void {
    this.eventHandlers.push(handler);
  }

  offEvent() {}

  getConnectionStatus() {
    return {
      state: "connected" as ConnectionState,
      reconnectAttempts: 0,
    };
  }

  // Helper to trigger event
  async triggerEvent(event: NormalizedEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      await handler(event);
    }
  }
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
      systemPromptPath: `${tempDir}/prompts/system.md`,
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
  };
}

// Helper to create test event
function createTestEvent(): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "test_channel",
    userId: "test_user",
    messageId: "test_msg_" + Date.now(),
    isDm: false,
    guildId: "test_guild",
    content: "Hello bot!",
    timestamp: new Date(),
  };
}

Deno.test("AgentCore - constructs successfully", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Create system prompt
    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const config = createTestConfig(tempDir);
    const agentCore = new AgentCore(config);

    assertExists(agentCore);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("AgentCore - registers platform adapters", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const config = createTestConfig(tempDir);
    const agentCore = new AgentCore(config);
    const adapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    agentCore.registerPlatform(adapter);

    const registered = agentCore.getRegisteredPlatforms();
    assertEquals(registered.includes("discord"), true);

    const retrievedAdapter = agentCore.getPlatformAdapter("discord");
    assertEquals(retrievedAdapter, adapter);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("AgentCore - handles events from registered platforms", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const config = createTestConfig(tempDir);
    const agentCore = new AgentCore(config);
    const mockAdapter = new MockPlatformAdapter();
    const adapter = mockAdapter as unknown as PlatformAdapter;

    agentCore.registerPlatform(adapter);

    const event = createTestEvent();

    // Trigger event through adapter (simulating platform event)
    await mockAdapter.triggerEvent(event);

    // Wait a bit for async processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Note: The event will fail because we don't have copilot CLI,
    // but it should send an error message
    const sentReplies = mockAdapter.sentReplies;
    assertEquals(sentReplies.length > 0, true, "Should send error message");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("AgentCore - returns config", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const config = createTestConfig(tempDir);
    const agentCore = new AgentCore(config);

    const retrievedConfig = agentCore.getConfig();
    assertEquals(retrievedConfig, config);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
