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
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import type { AgentConnector } from "../../src/acp/agent-connector.ts";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";

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

Deno.test("SessionOrchestrator - processMessage handles agent failure gracefully with retry logic", async () => {
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

    // This will fail because copilot CLI is not installed,
    // but should not crash and should return error response
    const response = await orchestrator.processMessage(event, platformAdapter);

    assertExists(response);
    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertExists(response.error);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - reply state is accessible via skill registry", async () => {
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

    // Verify reply handler is accessible and supports clear/check operations
    const replyHandler = skillRegistry.getReplyHandler();
    assertExists(replyHandler);

    // Verify initial state
    assertEquals(replyHandler.hasReplySent("test/user", "channel1"), false);

    // Verify clearReplyState doesn't throw on non-existent key
    replyHandler.clearReplyState("test/user", "channel1");
    assertEquals(replyHandler.hasReplySent("test/user", "channel1"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// --- Mock AgentConnector and Testable SessionOrchestrator for retry logic tests ---

/**
 * Mock AgentConnector that simulates agent behavior without real CLI tools
 */
class MockAgentConnector {
  connected = false;
  sessionId = "mock-session-id";
  promptCallCount = 0;
  promptResponses: PromptResponse[] = [];
  modelSet = false;
  disconnected = false;
  onPrompt?: (callCount: number) => void;

  constructor(_options: AgentConnectorOptions) {}

  async connect(): Promise<void> {
    this.connected = true;
    await Promise.resolve();
  }

  async createSession(): Promise<string> {
    return await Promise.resolve(this.sessionId);
  }

  async setSessionModel(_sessionId: string, _modelId: string): Promise<void> {
    this.modelSet = true;
    await Promise.resolve();
  }

  async prompt(_sessionId: string, _text: string): Promise<PromptResponse> {
    const response = this.promptResponses[this.promptCallCount] ??
      { stopReason: "end_turn" } as PromptResponse;
    this.promptCallCount++;
    this.onPrompt?.(this.promptCallCount);
    return await Promise.resolve(response);
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
    await Promise.resolve();
  }
}

/**
 * Testable subclass that injects a mock connector
 */
class TestableSessionOrchestrator extends SessionOrchestrator {
  mockConnector: MockAgentConnector | null = null;
  private connectorSetup?: (connector: MockAgentConnector) => void;

  setConnectorSetup(setup: (connector: MockAgentConnector) => void): void {
    this.connectorSetup = setup;
  }

  protected override createConnector(
    options: AgentConnectorOptions,
  ): AgentConnector {
    this.mockConnector = new MockAgentConnector(options);
    this.connectorSetup?.(this.mockConnector);
    return this.mockConnector as unknown as AgentConnector;
  }
}

/**
 * Helper to create a testable orchestrator with all dependencies
 */
async function createTestableOrchestrator(tempDir: string, options?: { skillApi?: boolean }) {
  const config = createTestConfig(tempDir);
  config.agent.defaultAgentType = "copilot";
  // Set GitHub token to avoid config error in createAgentConfig
  config.agent.githubToken = "test-token";
  if (options?.skillApi !== false) {
    config.skillApi = {
      enabled: true,
      port: 3999,
      host: "127.0.0.1",
      sessionTimeoutMs: 60000,
    };
  }
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

  const orchestrator = new TestableSessionOrchestrator(
    workspaceManager,
    contextAssembler,
    skillRegistry,
    config,
    sessionRegistry,
  );

  return { orchestrator, skillRegistry, workspaceManager, sessionRegistry };
}

Deno.test("SessionOrchestrator - retry sends reply on first retry attempt", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
      await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    const replyHandler = skillRegistry.getReplyHandler();

    orchestrator.setConnectorSetup((connector) => {
      // First prompt: end_turn without reply -> triggers retry
      // Second prompt (retry): end_turn, and we simulate reply sent
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        // On the retry prompt (2nd call), simulate reply was sent
        if (callCount === 2) {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          const key = `${workspace}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.replySent, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - does not retry when reaction was sent", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
      await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    const reactionHandler = skillRegistry.getReactionHandler();

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        // Simulate reaction sent on the first prompt
        if (callCount === 1) {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          const key = `${workspace}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (reactionHandler as any).reactionSentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.replySent, false);
    assertEquals(response.reactionSent, true);
    // Should have called prompt only once (no retry needed)
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - does not retry when both reaction and reply were sent", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
      await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    const replyHandler = skillRegistry.getReplyHandler();
    const reactionHandler = skillRegistry.getReactionHandler();

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          const key = `${workspace}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
          // deno-lint-ignore no-explicit-any
          (reactionHandler as any).reactionSentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.replySent, true);
    assertEquals(response.reactionSent, true);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - retry stops on non-end_turn stop reason", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      // First prompt: end_turn without reply -> triggers retry
      // Retry prompt: cancelled stop reason -> should break out of retry loop
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "cancelled" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    // Should have called prompt twice (initial + 1 retry that returned cancelled)
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - no retry when initial prompt has reply sent", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
      await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    const replyHandler = skillRegistry.getReplyHandler();

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        // Simulate reply sent on the first prompt
        if (callCount === 1) {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          const key = `${workspace}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.replySent, true);
    // Should have called prompt only once (no retry needed)
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - no retry when initial stop reason is cancelled", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      // Initial prompt returns cancelled -> no retry should happen
      connector.promptResponses = [
        { stopReason: "cancelled" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertEquals(response.error, "Session was cancelled");
    // Should have called prompt only once
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - retry exhausts max retries without reply", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      // All prompts return end_turn without reply -> exhaust retries
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertEquals(response.error, "Agent did not generate a reply");
    // Initial prompt + maxRetries (1 for copilot) = 2
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// --- Spontaneous post tests ---

Deno.test("SessionOrchestrator - processSpontaneousPost sends reply successfully", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, sessionRegistry } = await createTestableOrchestrator(
      tempDir,
    );

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          const replyHandler = skillRegistry.getReplyHandler();
          const key = `discord/bot_id:test_channel`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "test_channel",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: false },
    );

    assertEquals(response.success, true);
    assertEquals(response.replySent, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSpontaneousPost returns error when no reply sent", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "test_channel",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: false },
    );

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertEquals(response.error, "Agent did not send a reply");

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSpontaneousPost retries on no reply", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, sessionRegistry } = await createTestableOrchestrator(
      tempDir,
    );

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        // Simulate reply on retry (2nd prompt)
        if (callCount === 2) {
          const replyHandler = skillRegistry.getReplyHandler();
          const key = `discord/bot_id:test_channel`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "test_channel",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: true },
    );

    assertEquals(response.success, true);
    assertEquals(response.replySent, true);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSpontaneousPost retry stops on non-end_turn", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "cancelled" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "test_channel",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: false },
    );

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSpontaneousPost handles connector error", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.connect = () => Promise.reject(new Error("Connection failed"));
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "test_channel",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: false },
    );

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertEquals(response.error, "Connection failed");

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSpontaneousPost with skillApi disabled", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig(tempDir);
    config.agent.defaultAgentType = "copilot";
    config.agent.githubToken = "test-token";
    // Ensure skillApi is not configured (disabled)
    // deno-lint-ignore no-explicit-any
    delete (config as any).skillApi;

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

    const orchestrator = new TestableSessionOrchestrator(
      workspaceManager,
      contextAssembler,
      skillRegistry,
      config,
      sessionRegistry,
    );

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          const replyHandler = skillRegistry.getReplyHandler();
          const key = `discord/bot_id:test_channel`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "test_channel",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: false },
    );

    assertEquals(response.success, true);
    assertEquals(response.replySent, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - buildSpontaneousPrompt includes session ID", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, sessionRegistry } = await createTestableOrchestrator(
      tempDir,
    );

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    let capturedPrompt = "";

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      const originalPrompt = connector.prompt.bind(connector);
      connector.prompt = (sessionId: string, text: string) => {
        capturedPrompt = text;
        return originalPrompt(sessionId, text);
      };
      connector.onPrompt = () => {
        const replyHandler = skillRegistry.getReplyHandler();
        const key = `discord/bot_id:test_channel`;
        // deno-lint-ignore no-explicit-any
        (replyHandler as any).replySentMap.set(key, true);
      };
    });

    await orchestrator.processSpontaneousPost(
      "discord",
      "test_channel",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: false },
    );

    // Verify the prompt contains session-related info and spontaneous post instructions
    assertEquals(capturedPrompt.includes("Session Information"), true);
    assertEquals(capturedPrompt.includes("Spontaneous Post Mode"), true);
    assertEquals(capturedPrompt.includes("send-reply"), true);
    assertEquals(capturedPrompt.includes("NOT responding to any user message"), true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - unexpected stop reason returns error", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      // Return an unexpected stop reason (not end_turn, not cancelled)
      connector.promptResponses = [
        { stopReason: "unknown_reason" } as unknown as PromptResponse,
      ];
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertEquals(response.error, "Unexpected stop reason: unknown_reason");
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
