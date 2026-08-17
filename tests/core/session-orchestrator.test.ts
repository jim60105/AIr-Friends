// tests/core/session-orchestrator.test.ts

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import { selfResearchNoNoteTotal } from "@utils/metrics.ts";
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
import type { ClientConfig } from "../../src/acp/types.ts";
import type { PermissionRejection } from "../../src/acp/types.ts";
import type { AgentConnector } from "../../src/acp/agent-connector.ts";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";
import { dirname, join } from "@std/path";

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
  supportsTypingIndicator() {
    return false;
  }
  sendTyping(_channelId: string) {
    return Promise.resolve();
  }
}

class TypingEnabledMockPlatformAdapter extends MockPlatformAdapter {
  typingCalls: string[] = [];
  override supportsTypingIndicator() {
    return true;
  }
  override sendTyping(channelId: string) {
    this.typingCalls.push(channelId);
    return Promise.resolve();
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
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
      defaultAgentType: "opencode",
    },
    memory: {
      searchLimit: 10,
      maxChars: 2000,
      recentMessageLimit: 20,
      workingTierLimit: 20,
    },
    workspace: {
      repoPath: tempDir,
      workspacesDir: "workspaces",
    },
    logging: {
      level: "FATAL",
    },
    replyPolicy: "channels",
    channels: [],
    conversationSummary: { enabled: false },
  };
}

// Helper to create test event
function createTestEvent(): NormalizedEvent {
  return {
    platform: "discord",
    channelId: "99988877766655544",
    userId: "11122233344455566",
    messageId: "test_msg",
    isDm: false,
    guildId: "88877766655544433",
    content: "Hello bot!",
    timestamp: new Date(),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
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
      memoryStore,
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
      `${tempDir}/prompts/system_reply.md`,
      "You are a helpful assistant.",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
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
      memoryStore,
    );

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    // Note: This will fail because we don't have opencode CLI installed
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
      `${tempDir}/prompts/system_reply.md`,
      "You are a helpful assistant.",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
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
      memoryStore,
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
      `${tempDir}/prompts/system_reply.md`,
      "You are a helpful assistant.",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
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
      memoryStore,
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
      `${tempDir}/prompts/system_reply.md`,
      "You are a helpful assistant.",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
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
      memoryStore,
    );

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    // This will fail because opencode CLI is not installed,
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
  lastModelId = "";
  disconnected = false;
  lastMCPServers: unknown[] = [];
  onPrompt?: (callCount: number) => void;
  options: AgentConnectorOptions;

  constructor(options: AgentConnectorOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    this.connected = true;
    await Promise.resolve();
  }

  supportsImageContent(): boolean {
    return false;
  }

  async createSession(mcpServers?: unknown[]): Promise<string> {
    this.lastMCPServers = mcpServers ?? [];
    return await Promise.resolve(this.sessionId);
  }

  async setSessionModel(_sessionId: string, modelId: string): Promise<void> {
    this.modelSet = true;
    this.lastModelId = modelId;
    await Promise.resolve();
  }

  modeSet = false;
  lastModeId = "";
  async setSessionMode(_sessionId: string, modeId: string): Promise<void> {
    this.modeSet = true;
    this.lastModeId = modeId;
    await Promise.resolve();
  }

  reasoningEffortCalls: string[] = [];
  async setReasoningEffort(_sessionId: string, value: string): Promise<string> {
    this.reasoningEffortCalls.push(value);
    await Promise.resolve();
    return "applied";
  }

  async prompt(_sessionId: string, text: string): Promise<PromptResponse> {
    this.lastPromptText = text;
    const response = this.promptResponses[this.promptCallCount] ??
      { stopReason: "end_turn" } as PromptResponse;
    this.promptCallCount++;
    this.onPrompt?.(this.promptCallCount);
    return await Promise.resolve(response);
  }

  /** Text of the most recent prompt call (used to assert retry-prompt content) */
  lastPromptText = "";

  /**
   * Simulated client access for the retry-prompt rejection snapshot. Returns a
   * fake client whose rejection records are injected by the test, or null when
   * none were configured (mirroring a connector without a client). The fake also
   * provides the no-op listener/writer hooks the orchestrator calls on the real
   * client, so the session flow behaves identically.
   */
  fakeClient: { rejections: PermissionRejection[]; cleared: boolean } | null = null;

  getClient(): {
    getRecentPermissionRejections(): PermissionRejection[];
    setActivityListener(_listener: () => void): void;
    setAuditWriter(_writer: unknown): void;
    getLastActivityTimestamp(): number;
  } | null {
    return this.fakeClient
      ? {
        getRecentPermissionRejections: () => [...this.fakeClient!.rejections],
        setActivityListener: () => {},
        setAuditWriter: () => {},
        getLastActivityTimestamp: () => Date.now(),
      }
      : null;
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
  /**
   * When true, attachment image fetches bypass the SSRF guard and use plain fetch,
   * allowing tests to serve images from a loopback test server. The production SSRF
   * behavior (loopback rejection) is covered separately in tests/utils/ssrf.test.ts.
   */
  allowLoopbackImageFetch = false;

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

  protected override safeImageFetch(url: string, init?: RequestInit): Promise<Response> {
    if (this.allowLoopbackImageFetch) {
      return fetch(url, init);
    }
    return super.safeImageFetch(url, init);
  }
}

/**
 * Helper to create a testable orchestrator with all dependencies
 */
async function createTestableOrchestrator(tempDir: string, options?: { skillApi?: boolean }) {
  const config = createTestConfig(tempDir);
  config.agent.defaultAgentType = "opencode";
  if (options?.skillApi !== false) {
    config.skillApi = {
      enabled: true,
      port: 3999,
      host: "127.0.0.1",
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
    `${tempDir}/prompts/system_reply.md`,
    `You are a helpful assistant.

{{ if sessionId }}
# Session Information

Your session ID is: {{ sessionId }}
Use this session ID when calling skills that require --session-id parameter.
{{ /if }}

{{ if userContextMessage }}
# Context and Message

{{ userContextMessage }}

# Instructions

Please respond to the current message above.
Use the \`send-reply\` skill to deliver your final response.
You may also use \`react-message\` to add an emoji reaction to the trigger message.
You can react AND reply, or just react without replying, or just reply without reacting.
You may use other available skills as needed.
{{ /if }}`,
  );
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_spontaneous.md`,
    `Spontaneous Post Mode

{{ if recentMessagesFetched }}
You may reference recent conversation topics for inspiration, but do not reply to them or reuse the same theme directly
{{ else }}
Create something entirely original
{{ /if }}

{{ if importantMemories }}
## Important Memories

{{ importantMemories }}
{{ /if }}

{{ if recentMessages }}
## Recent Conversation

{{ recentMessages }}
{{ /if }}

{{ if availableEmojis }}
{{ availableEmojis }}
{{ /if }}

{{ if sessionId }}
## Session Information

Your session ID is: {{ sessionId }}
Use this session ID when calling skills that require --session-id parameter.
{{ /if }}`,
  );

  const contextAssembler = new ContextAssembler(memoryStore, {
    systemPromptPath: `${tempDir}/prompts/system_reply.md`,
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
    memoryStore,
  );

  return { orchestrator, skillRegistry, workspaceManager, sessionRegistry, config };
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

Deno.test("SessionOrchestrator - retry prompt includes recorded permission rejections (surviving the prompt() boundary)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
      await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    const replyHandler = skillRegistry.getReplyHandler();

    orchestrator.setConnectorSetup((connector) => {
      // The first turn ends without a reply -> retry fires. The client's rejection
      // records (injected here) must survive across prompt()'s reset() boundary.
      connector.fakeClient = {
        rejections: [{
          toolName: "write",
          kind: "edit",
          commandOrPath: "$TMPDIR/$SESSION_ID/reply.md",
          reason: "rejected_edit_write",
          ts: "2026-08-14T00:00:00.000Z",
        }],
        cleared: false,
      };
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        // On the retry prompt (2nd call), simulate reply was sent.
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
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);
    // The retry prompt (2nd call) carries the recorded rejection with the reason,
    // so the Agent can self-correct instead of guessing why the write was blocked.
    const retryPrompt = orchestrator.mockConnector!.lastPromptText;
    assertStringIncludes(retryPrompt, "Recent permission rejections in this session");
    assertStringIncludes(
      retryPrompt,
      "write $TMPDIR/$SESSION_ID/reply.md (kind: edit) rejected: rejected_edit_write",
    );

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
    // Initial prompt + maxRetries (1 for opencode) = 2
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// --- Send-file response accounting tests ---

/** Simulate the agent delivering a file: mark the active session's fileSent. */
function markFileSentForWorkspace(
  sessionRegistry: SessionRegistry,
  workspaceKey: string,
): void {
  const session = sessionRegistry.getAll().find((s) => s.workspace.key === workspaceKey);
  if (!session) throw new Error(`No active session for workspace ${workspaceKey}`);
  sessionRegistry.markFileSent(session.id);
}

Deno.test("SessionOrchestrator - no retry when send-file was called (fileSent true)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, workspaceManager, sessionRegistry } = await createTestableOrchestrator(
      tempDir,
    );

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        // Simulate the agent delivering a file on the first prompt
        if (callCount === 1) {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          markFileSentForWorkspace(sessionRegistry, workspace);
        }
      };
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.replySent, false);
    assertEquals(response.fileSent, true);
    // Prompt called only once — file send suppresses the retry
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - retry still fires when no reply/reaction/file occurred", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      // Both prompts end_turn with no response at all
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertEquals(response.fileSent, false);
    assertEquals(response.error, "Agent did not generate a reply");
    // Initial prompt + retry (maxRetries 1) = 2
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - file-send state is per-session (fresh each session)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, workspaceManager, sessionRegistry } = await createTestableOrchestrator(
      tempDir,
    );

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          markFileSentForWorkspace(sessionRegistry, workspace);
        }
      };
    });

    const response1 = await orchestrator.processMessage(event, platformAdapter);
    assertEquals(response1.success, true);
    assertEquals(response1.fileSent, true);

    // Second session on the same channel: fileSent state is per-session (a new
    // session starts fresh), so a turn with no response triggers the retry.
    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
    });

    const response2 = await orchestrator.processMessage(event, platformAdapter);
    assertEquals(response2.success, false);
    assertEquals(response2.fileSent, false);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - partial file delivery (fileSent marked) suppresses the retry", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, workspaceManager, sessionRegistry } = await createTestableOrchestrator(
      tempDir,
    );

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          // Partial delivery (1 of 2) still marks the session's fileSent state
          markFileSentForWorkspace(sessionRegistry, workspace);
        }
      };
    });

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.fileSent, true);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - spontaneous flow reports fileSent false", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "mock-channel",
      platformAdapter,
      {
        botId: "bot-123",
        fetchRecentMessages: false,
      },
    );

    // Spontaneous sessions do not track file sends — fileSent is explicitly false
    assertEquals(response.fileSent, false);
    assertEquals(response.replySent, false);

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
          const key = `discord/bot_id:99988877766655544`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "99988877766655544",
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
      "99988877766655544",
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
          const key = `discord/bot_id:99988877766655544`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "99988877766655544",
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
      "99988877766655544",
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
      "99988877766655544",
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
    config.agent.defaultAgentType = "opencode";
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
      `${tempDir}/prompts/system_reply.md`,
      "You are a helpful assistant.",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
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
      memoryStore,
    );

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          const replyHandler = skillRegistry.getReplyHandler();
          const key = `discord/bot_id:99988877766655544`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        }
      };
    });

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "99988877766655544",
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

Deno.test("SessionOrchestrator - buildSpontaneousPrompt uses Vento template", async () => {
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
        const key = `discord/bot_id:99988877766655544`;
        // deno-lint-ignore no-explicit-any
        (replyHandler as any).replySentMap.set(key, true);
      };
    });

    await orchestrator.processSpontaneousPost(
      "discord",
      "99988877766655544",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: false },
    );

    // Verify the prompt contains session-related info and spontaneous post instructions
    assertEquals(capturedPrompt.includes("Session Information"), true);
    assertEquals(capturedPrompt.includes("Spontaneous Post Mode"), true);
    assertEquals(capturedPrompt.includes("send-reply"), true);
    assertEquals(capturedPrompt.includes("Create original content"), true);

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

// --- processSelfResearch tests ---

Deno.test("SessionOrchestrator - processSelfResearch creates workspace and runs agent", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    // Create system_self_research.md prompt file
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    const rssItems = [
      {
        title: "Test Article",
        url: "https://example.com/article1",
        description: "A test article description",
        sourceName: "Test Feed",
      },
    ];

    const selfResearchConfig = {
      enabled: true,
      model: "gpt-5-mini",
      rssFeeds: [{ url: "https://example.com/feed.xml" }],
      minIntervalMs: 43200000,
      maxIntervalMs: 86400000,
      verifyCompletion: true,
    };

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          // The agent produces its research note during the turn, so completion
          // verification counts the session as successful.
          writeResearchNote(tempDir, "notes/topic.md", "# Note");
        }
      };
    });

    const response = await orchestrator.processSelfResearch(rssItems, selfResearchConfig);

    assertExists(response);
    assertEquals(response.success, true);
    assertEquals(response.replySent, false);
    assertEquals(orchestrator.mockConnector!.connected, true);
    assertEquals(orchestrator.mockConnector!.disconnected, true);
    assertEquals(orchestrator.mockConnector!.modelSet, true);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSelfResearch returns error on cancelled stop reason", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    const rssItems = [
      {
        title: "Test",
        url: "https://example.com",
        description: "Desc",
        sourceName: "Feed",
      },
    ];

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "cancelled" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processSelfResearch(rssItems, {
      enabled: true,
      model: "gpt-5-mini",
      rssFeeds: [],
      minIntervalMs: 43200000,
      maxIntervalMs: 86400000,
      verifyCompletion: true,
    });

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertExists(response.error);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSelfResearch handles agent connection failure", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig(tempDir);
    config.agent.defaultAgentType = "opencode";
    config.skillApi = {
      enabled: true,
      port: 3998,
      host: "127.0.0.1",
    };

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
      `${tempDir}/prompts/system_reply.md`,
      "You are a helpful assistant.",
    );
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research\n{{ rssItems }}",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
      recentMessageLimit: config.memory.recentMessageLimit,
      tokenLimit: config.agent.tokenLimit,
      memoryMaxChars: config.memory.maxChars,
    });

    const sessionRegistry = new SessionRegistry();

    // Use real orchestrator (not testable) - will fail to connect to opencode CLI
    const orchestrator = new SessionOrchestrator(
      workspaceManager,
      contextAssembler,
      skillRegistry,
      config,
      sessionRegistry,
      memoryStore,
    );

    const response = await orchestrator.processSelfResearch(
      [{ title: "Test", url: "https://example.com", description: "Desc", sourceName: "Feed" }],
      {
        enabled: true,
        model: "gpt-5-mini",
        rssFeeds: [],
        minIntervalMs: 43200000,
        maxIntervalMs: 86400000,
        verifyCompletion: true,
      },
    );

    // Should fail gracefully
    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertExists(response.error);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSelfResearch formats RSS items in prompt", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "# Research\n\n{{ rssItems }}\n\n## End",
    );

    const rssItems = [
      {
        title: "Article Alpha",
        url: "https://alpha.com/1",
        description: "Alpha description",
        sourceName: "Alpha Feed",
      },
      {
        title: "Article Beta",
        url: "https://beta.com/2",
        description: "Beta description",
        sourceName: "Beta Feed",
      },
    ];

    let capturedPrompt = "";
    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      const originalPrompt = connector.prompt.bind(connector);
      connector.prompt = (sid: string, text: string) => {
        capturedPrompt = text;
        return originalPrompt(sid, text);
      };
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          // Produce a note so completion verification succeeds and no retry prompt
          // overwrites the captured initial prompt.
          writeResearchNote(tempDir, "notes/prompt-test.md", "# Note");
        }
      };
    });

    await orchestrator.processSelfResearch(rssItems, {
      enabled: true,
      model: "gpt-5-mini",
      rssFeeds: [],
      minIntervalMs: 43200000,
      maxIntervalMs: 86400000,
      verifyCompletion: true,
    });

    // Verify prompt contains RSS items
    assertEquals(capturedPrompt.includes("Article Alpha"), true);
    assertEquals(capturedPrompt.includes("Article Beta"), true);
    assertEquals(capturedPrompt.includes("https://alpha.com/1"), true);
    assertEquals(capturedPrompt.includes("Alpha Feed"), true);
    assertEquals(capturedPrompt.includes("Alpha description"), true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processSelfResearch without skillApi", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir, {
      skillApi: false,
    });

    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research\n{{ rssItems }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          writeResearchNote(tempDir, "notes/no-skillapi.md", "# Note");
        }
      };
    });

    const response = await orchestrator.processSelfResearch(
      [{ title: "Test", url: "https://example.com", description: "Desc", sourceName: "Feed" }],
      {
        enabled: true,
        model: "gpt-5-mini",
        rssFeeds: [],
        minIntervalMs: 43200000,
        maxIntervalMs: 86400000,
        verifyCompletion: true,
      },
    );

    assertEquals(response.success, true);
    assertEquals(response.replySent, false);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// --- Self-research completion verification (F16) tests ---

// Agent workspace root for a testable orchestrator rooted at tempDir.
function agentWorkspacePathFor(tempDir: string): string {
  return join(tempDir, "agent-workspace");
}

// Write a research note (new file) into the agent workspace, as the simulated
// agent does with its edit/write tool during the prompt turn.
function writeResearchNote(tempDir: string, relPath: string, content: string): void {
  const path = join(agentWorkspacePathFor(tempDir), relPath);
  Deno.mkdirSync(dirname(path), { recursive: true });
  Deno.writeTextFileSync(path, content);
}

const SR_CONFIG = {
  enabled: true,
  model: "gpt-5-mini",
  rssFeeds: [{ url: "https://example.com/feed.xml" }],
  minIntervalMs: 43200000,
  maxIntervalMs: 86400000,
  verifyCompletion: true,
};

function srRssItems() {
  return [
    {
      title: "Test Article",
      url: "https://example.com/article1",
      description: "A test article description",
      sourceName: "Test Feed",
    },
  ];
}

Deno.test("Self-research verification - note written in normal flow reports success without retry", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          // The agent produces its note during the first turn.
          writeResearchNote(tempDir, "notes/operatiology.md", "# Notes");
          writeResearchNote(tempDir, "notes/_index.md", "- operatiology");
        }
      };
    });

    const response = await orchestrator.processSelfResearch(srRssItems(), SR_CONFIG);

    assertEquals(response.success, true);
    assertEquals(response.error, undefined);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Self-research verification - no note triggers one corrective retry that succeeds", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      // Simulate permission rejections recorded in the session (e.g. the observed
      // `|| echo` / `;` chain denials).
      connector.fakeClient = {
        rejections: [
          {
            toolName: "Execute shell command",
            kind: "execute",
            commandOrPath: 'cat x 2>/dev/null || echo "NO INDEX"',
            reason: "rejected_generic_command_shell_operator",
            ts: new Date().toISOString(),
          },
        ],
        cleared: false,
      };
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
      connector.onPrompt = (callCount) => {
        if (callCount === 2) {
          // The retry turn produces the note.
          writeResearchNote(tempDir, "notes/topic.md", "# Retry note");
        }
      };
    });

    const response = await orchestrator.processSelfResearch(srRssItems(), SR_CONFIG);

    assertEquals(response.success, true);
    assertEquals(response.error, undefined);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);
    // The retry prompt carries the note requirement, sandbox rules, and the
    // bounded rejection diagnostics.
    assertStringIncludes(orchestrator.mockConnector!.lastPromptText, "$AGENT_WORKSPACE/notes/");
    assertStringIncludes(
      orchestrator.mockConnector!.lastPromptText,
      "Recent permission rejections",
    );
    assertStringIncludes(orchestrator.mockConnector!.lastPromptText, "`echo`");
    assertStringIncludes(orchestrator.mockConnector!.lastPromptText, "2>/dev/null");

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Self-research verification - no note after retry records failure, counter, and audit lifecycle", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createTestableOrchestrator(tempDir);
    config.audit = {
      enabled: true,
      retentionDays: 7,
      hashContent: false,
      includedPhases: [],
    };
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
        { stopReason: "end_turn" } as PromptResponse,
      ];
    });

    selfResearchNoNoteTotal.reset();
    const response = await orchestrator.processSelfResearch(srRssItems(), SR_CONFIG);

    assertEquals(response.success, false);
    assertEquals(response.error, "no_research_note");
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2);
    assertEquals((await selfResearchNoNoteTotal.get()).values[0].value, 1);

    // Audit lifecycle: exactly ONE session_end, written after the final outcome;
    // first turn agent_response with isRetry:false, retry turn prompt_sent +
    // agent_response with isRetry:true, and retry_triggered with the no_note reason.
    const auditFiles: string[] = [];
    for await (const entry of Deno.readDir(join(tempDir, "audit", "discord", "self-research"))) {
      auditFiles.push(join(tempDir, "audit", "discord", "self-research", entry.name));
    }
    assertEquals(auditFiles.length, 1);
    const entries = (await Deno.readTextFile(auditFiles[0])).trim().split("\n")
      .map((line) => JSON.parse(line) as { phase: string; data: Record<string, unknown> });
    const sessionEnds = entries.filter((e) => e.phase === "session_end");
    assertEquals(sessionEnds.length, 1);
    assertEquals(sessionEnds[0].data.success, false);
    assertEquals(sessionEnds[0].data.error, "no_research_note");
    const retryTriggered = entries.filter((e) => e.phase === "retry_triggered");
    assertEquals(retryTriggered.length, 1);
    assertEquals(retryTriggered[0].data.reason, "no_research_note");
    assertEquals(retryTriggered[0].data.retryCount, 1);
    assertEquals(retryTriggered[0].data.maxRetries, 1);
    const agentResponses = entries.filter((e) => e.phase === "agent_response");
    assertEquals(agentResponses.length, 2);
    assertEquals(agentResponses[0].data.isRetry, false);
    assertEquals(agentResponses[1].data.isRetry, true);
    const promptSent = entries.filter((e) => e.phase === "prompt_sent");
    assertEquals(promptSent.length, 2); // initial prompt + retry prompt

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Self-research verification - same-size same-millisecond overwrite detected via content hash", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    // A pre-existing note with the SAME size as the overwrite the agent performs.
    writeResearchNote(tempDir, "notes/existing.md", "aaaa");

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          const path = join(agentWorkspacePathFor(tempDir), "notes", "existing.md");
          // Same byte length, different content; mtime pinned to "now" (>= session start).
          Deno.writeTextFileSync(path, "zzzz");
          Deno.utimeSync(path, new Date(), new Date());
        }
      };
    });

    const response = await orchestrator.processSelfResearch(srRssItems(), SR_CONFIG);
    assertEquals(response.success, true);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Self-research verification - pre-session file modification does not count (mtime bound)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    const beforeSession = Date.now() - 10_000;
    writeResearchNote(tempDir, "notes/pre.md", "original");

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = (callCount) => {
        if (callCount === 1) {
          // Content changed during the session, but the modification time is pinned
          // BEFORE the session start → not this session's output.
          const path = join(agentWorkspacePathFor(tempDir), "notes", "pre.md");
          Deno.writeTextFileSync(path, "changed!!!");
          Deno.utimeSync(path, new Date(beforeSession), new Date(beforeSession));
        }
      };
    });

    const response = await orchestrator.processSelfResearch(srRssItems(), SR_CONFIG);
    assertEquals(response.success, false);
    assertEquals(response.error, "no_research_note");
    assertEquals(orchestrator.mockConnector!.promptCallCount, 2); // retried once, still failed

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Self-research verification - I/O error during snapshot treats session as produced, no retry", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      // Replace the notes directory with a plain FILE so the recursive snapshot
      // hits a non-directory I/O error (verification uncertainty → fail-safe).
      const notesPath = join(agentWorkspacePathFor(tempDir), "notes");
      Deno.removeSync(notesPath, { recursive: true });
      Deno.writeTextFileSync(notesPath, "not a directory");
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
    });

    const response = await orchestrator.processSelfResearch(srRssItems(), SR_CONFIG);
    assertEquals(response.success, true);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1); // never retried

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Self-research verification - verifyCompletion false keeps legacy end_turn-equals-success behavior", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_self_research.md`,
      "Research instructions\n{{ rssItems }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
    });

    selfResearchNoNoteTotal.reset();
    const response = await orchestrator.processSelfResearch(srRssItems(), {
      ...SR_CONFIG,
      verifyCompletion: false,
    });

    assertEquals(response.success, true);
    assertEquals(orchestrator.mockConnector!.promptCallCount, 1);
    assertEquals((await selfResearchNoNoteTotal.get()).values[0].value, 0); // no metric without verification

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// --- processMemoryMaintenance tests ---

Deno.test("SessionOrchestrator - processMemoryMaintenance returns success on end_turn", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    await Deno.writeTextFile(
      `${tempDir}/prompts/system_memory_maintenance.md`,
      "Maintenance for {{ workspaceKey }}\nSession: {{ sessionId }}\nMemories:\n{{ memoriesDump }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processMemoryMaintenance(
      "discord/11122233344455566",
      {
        enabled: true,
        model: "gpt-5-mini",
        minMemoryCount: 50,
        intervalMs: 604800000,
      },
    );

    assertEquals(response.success, true);
    assertEquals(response.replySent, false);
    assertEquals(response.error, undefined);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processMemoryMaintenance returns failure on cancelled", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    await Deno.writeTextFile(
      `${tempDir}/prompts/system_memory_maintenance.md`,
      "Maintenance for {{ workspaceKey }}\n{{ sessionId }}\n{{ memoriesDump }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "cancelled" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processMemoryMaintenance(
      "discord/11122233344455566",
      {
        enabled: true,
        model: "gpt-5-mini",
        minMemoryCount: 50,
        intervalMs: 604800000,
      },
    );

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertExists(response.error);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processMemoryMaintenance rejects invalid workspace key", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const response = await orchestrator.processMemoryMaintenance(
      "invalid_key",
      {
        enabled: true,
        model: "gpt-5-mini",
        minMemoryCount: 50,
        intervalMs: 604800000,
      },
    );

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertEquals(response.error, "Invalid workspace key: invalid_key");

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processMemoryMaintenance rejects unsupported platform", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    const response = await orchestrator.processMemoryMaintenance(
      "telegram/user123",
      {
        enabled: true,
        model: "gpt-5-mini",
        minMemoryCount: 50,
        intervalMs: 604800000,
      },
    );

    assertEquals(response.success, false);
    assertEquals(response.error, "Invalid workspace key: telegram/user123");

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processMemoryMaintenance handles agent connection failure", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const config = createTestConfig(tempDir);
    config.agent.defaultAgentType = "opencode";
    config.skillApi = {
      enabled: true,
      port: 3997,
      host: "127.0.0.1",
    };

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
      `${tempDir}/prompts/system_reply.md`,
      "You are a helpful assistant.",
    );
    await Deno.writeTextFile(
      `${tempDir}/prompts/system_memory_maintenance.md`,
      "Maintenance\n{{ workspaceKey }}\n{{ sessionId }}\n{{ memoriesDump }}",
    );

    const contextAssembler = new ContextAssembler(memoryStore, {
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
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
      memoryStore,
    );

    const response = await orchestrator.processMemoryMaintenance(
      "discord/11122233344455566",
      {
        enabled: true,
        model: "gpt-5-mini",
        minMemoryCount: 50,
        intervalMs: 604800000,
      },
    );

    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertExists(response.error);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processMemoryMaintenance without skillApi", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir, {
      skillApi: false,
    });

    await Deno.writeTextFile(
      `${tempDir}/prompts/system_memory_maintenance.md`,
      "Maintenance\n{{ workspaceKey }}\n{{ sessionId }}\n{{ memoriesDump }}",
    );

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
    });

    const response = await orchestrator.processMemoryMaintenance(
      "misskey/user456",
      {
        enabled: true,
        model: "gpt-5-mini",
        minMemoryCount: 50,
        intervalMs: 604800000,
      },
    );

    assertEquals(response.success, true);
    assertEquals(response.replySent, false);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processMemoryMaintenance embeds memories in prompt", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, workspaceManager } = await createTestableOrchestrator(
      tempDir,
    );

    await Deno.writeTextFile(
      `${tempDir}/prompts/system_memory_maintenance.md`,
      "Maintenance for {{ workspaceKey }}\nThreshold: **{{ minMemoryCount }}**\nSession: {{ sessionId }}\nMemories:\n{{ memoriesDump }}",
    );

    // Create workspace and write memory file
    const event: NormalizedEvent = {
      platform: "discord",
      channelId: "internal",
      userId: "mem_user",
      messageId: "test",
      isDm: true,
      guildId: "",
      content: "",
      timestamp: new Date(),
    };
    const ws = await workspaceManager.getOrCreateWorkspace(event);
    const memoryLine = JSON.stringify({
      type: "memory",
      id: "mem1",
      ts: "2025-01-01T00:00:00.000Z",
      enabled: true,
      visibility: "public",
      importance: "high",
      content: "Test memory content",
    });
    await Deno.writeTextFile(`${ws.path}/memory.public.jsonl`, memoryLine + "\n");

    let capturedPrompt = "";
    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      const originalPrompt = connector.prompt.bind(connector);
      connector.prompt = (sid: string, text: string) => {
        capturedPrompt = text;
        return originalPrompt(sid, text);
      };
    });

    const response = await orchestrator.processMemoryMaintenance(
      "discord/mem_user",
      {
        enabled: true,
        model: "gpt-5-mini",
        minMemoryCount: 50,
        intervalMs: 604800000,
      },
    );

    assertEquals(response.success, true);
    assertEquals(capturedPrompt.includes("Test memory content"), true);
    assertEquals(capturedPrompt.includes("discord/mem_user"), true);
    // Verify minMemoryCount is rendered in the prompt (real template uses **50**)
    assertEquals(capturedPrompt.includes("**50**"), true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - processMemoryMaintenance shows no memories message when empty", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    await Deno.writeTextFile(
      `${tempDir}/prompts/system_memory_maintenance.md`,
      "Maintenance\n{{ workspaceKey }}\n{{ sessionId }}\n{{ memoriesDump }}",
    );

    let capturedPrompt = "";
    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [
        { stopReason: "end_turn" } as PromptResponse,
      ];
      const originalPrompt = connector.prompt.bind(connector);
      connector.prompt = (sid: string, text: string) => {
        capturedPrompt = text;
        return originalPrompt(sid, text);
      };
    });

    await orchestrator.processMemoryMaintenance(
      "discord/empty_user",
      {
        enabled: true,
        model: "gpt-5-mini",
        minMemoryCount: 50,
        intervalMs: 604800000,
      },
    );

    assertEquals(capturedPrompt.includes("(No enabled memories found)"), true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
Deno.test("SessionOrchestrator - prompt receives string when supportsImageContent is false", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(
      tempDir,
    );
    const event = createTestEvent();
    event.attachments = [{
      id: "a1",
      url: "https://example.com/img.png",
      mimeType: "image/png",
      filename: "img.png",
      size: 1000,
      isImage: true,
    }];
    orchestrator.setConnectorSetup((connector) => {
      // default supportsImageContent false
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
    });

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    await orchestrator.processMessage(event, platformAdapter);
    // Ensure prompt was called
    assertEquals(orchestrator.mockConnector!.promptCallCount > 0, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test({
  name: "SessionOrchestrator - prompt receives ContentBlock[] when supportsImageContent is true",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(
        tempDir,
      );
      const event = createTestEvent();
      event.attachments = [{
        id: "a1",
        url: "https://example.com/img.png",
        mimeType: "image/png",
        filename: "img.png",
        size: 1000,
        isImage: true,
      }];
      let receivedArg: string | unknown[] | null = null;
      orchestrator.setConnectorSetup((connector) => {
        connector.supportsImageContent = () => true;
        connector.prompt = (_sessionId: string, text: string | unknown[]) => {
          receivedArg = text;
          return Promise.resolve({ stopReason: "end_turn" } as PromptResponse);
        };
      });

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      await orchestrator.processMessage(event, platformAdapter);

      // Image download will fail (unreachable URL), so fallback to string prompt.
      // The important thing is that the method was called and didn't crash.
      assertEquals(receivedArg !== null, true);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test("SessionOrchestrator - non-image attachments do not trigger download", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(
      tempDir,
    );
    const event = createTestEvent();
    event.attachments = [{
      id: "a1",
      url: "https://example.com/doc.pdf",
      mimeType: "application/pdf",
      filename: "doc.pdf",
      size: 1000,
      isImage: false,
    }];
    let receivedArg: string | unknown[] | null = null;
    orchestrator.setConnectorSetup((connector) => {
      connector.supportsImageContent = () => true;
      connector.prompt = (_sessionId: string, text: string | unknown[]) => {
        receivedArg = text;
        return Promise.resolve({ stopReason: "end_turn" } as PromptResponse);
      };
    });

    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    await orchestrator.processMessage(event, platformAdapter);

    // Non-image attachments should not trigger image download; prompt should be string
    assertEquals(typeof receivedArg, "string");

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test({
  name: "SessionOrchestrator - successful image download produces ContentBlock array",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // Start a local HTTP server to serve a tiny test image
    const pngBytes = new Uint8Array([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      0,
      0,
      0,
      13,
      73,
      72,
      68,
      82,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      8,
      2,
      0,
      0,
      0,
      144,
      119,
      83,
      222,
      0,
      0,
      0,
      12,
      73,
      68,
      65,
      84,
      8,
      215,
      99,
      248,
      207,
      192,
      0,
      0,
      0,
      3,
      0,
      1,
      54,
      0,
      5,
      249,
      0,
      0,
      0,
      0,
      73,
      69,
      78,
      68,
      174,
      66,
      96,
      130,
    ]);

    const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
      return new Response(pngBytes, {
        headers: { "Content-Type": "image/png" },
      });
    });
    const imageUrl = `http://localhost:${server.addr.port}/test.png`;

    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);
      // Permit the loopback test server (SSRF loopback rejection is tested separately).
      orchestrator.allowLoopbackImageFetch = true;
      const event = createTestEvent();
      event.attachments = [{
        id: "a1",
        url: imageUrl,
        mimeType: "image/png",
        filename: "test.png",
        size: pngBytes.length,
        isImage: true,
      }];
      let firstPromptArg: string | unknown[] | null = null;
      let promptCount = 0;
      orchestrator.setConnectorSetup((connector) => {
        connector.supportsImageContent = () => true;
        connector.prompt = (_sessionId: string, text: string | unknown[]) => {
          promptCount++;
          if (promptCount === 1) firstPromptArg = text;
          return Promise.resolve({ stopReason: "end_turn" } as PromptResponse);
        };
      });

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      await orchestrator.processMessage(event, platformAdapter);

      // With a reachable image, the first prompt should get ContentBlock array
      assertEquals(Array.isArray(firstPromptArg), true);
      const blocks = firstPromptArg as unknown as unknown[];
      assertEquals(blocks.length, 2); // text + image
      assertEquals((blocks[0] as { type: string }).type, "text");
      assertEquals((blocks[1] as { type: string }).type, "image");

      sessionRegistry.stop();
    } finally {
      await server.shutdown();
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - oversized images are skipped",
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(
        tempDir,
      );
      const event = createTestEvent();
      event.attachments = [{
        id: "a1",
        url: "https://example.com/huge.png",
        mimeType: "image/png",
        filename: "huge.png",
        size: 30 * 1024 * 1024, // 30MB - over 20MB limit
        isImage: true,
      }];
      let receivedArg: string | unknown[] | null = null;
      orchestrator.setConnectorSetup((connector) => {
        connector.supportsImageContent = () => true;
        connector.prompt = (_sessionId: string, text: string | unknown[]) => {
          receivedArg = text;
          return Promise.resolve({ stopReason: "end_turn" } as PromptResponse);
        };
      });

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      await orchestrator.processMessage(event, platformAdapter);

      // Oversized image should be skipped, prompt should be string
      assertEquals(typeof receivedArg, "string");

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - GIF conversion failure falls back to string prompt",
  sanitizeResources: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      // Serve a minimal GIF
      const gifBytes = new Uint8Array([
        0x47,
        0x49,
        0x46,
        0x38,
        0x39,
        0x61, // GIF89a
        0x01,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x00, // 1x1 no GCT
        0x2C,
        0x00,
        0x00,
        0x00,
        0x00,
        0x01,
        0x00,
        0x01,
        0x00,
        0x00, // image descriptor
        0x02,
        0x02,
        0x44,
        0x01,
        0x00, // LZW min code size + data
        0x3B, // trailer
      ]);
      const server = Deno.serve({ port: 0, onListen: () => {} }, () => {
        return new Response(gifBytes, {
          headers: { "Content-Type": "image/gif" },
        });
      });
      const gifUrl = `http://localhost:${server.addr.port}/test.gif`;

      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(
        tempDir,
      );
      const event = createTestEvent();
      event.attachments = [{
        id: "a1",
        url: gifUrl,
        mimeType: "image/gif",
        filename: "anim.gif",
        size: gifBytes.length,
        isImage: true,
      }];
      let receivedArg: string | unknown[] | null = null;
      orchestrator.setConnectorSetup((connector) => {
        connector.supportsImageContent = () => true;
        connector.prompt = (_sessionId: string, text: string | unknown[]) => {
          receivedArg = text;
          return Promise.resolve({ stopReason: "end_turn" } as PromptResponse);
        };
      });

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      await orchestrator.processMessage(event, platformAdapter);

      // If ImageMagick is not available, GIF conversion fails gracefully
      // and falls back to string prompt (no ContentBlock[])
      // If ImageMagick IS available, it produces a ContentBlock[] with image/webp
      if (typeof receivedArg === "string") {
        // Fallback path: conversion failed, string prompt
        assertEquals(typeof receivedArg, "string");
      } else {
        // Success path: conversion worked, ContentBlock[] with webp
        const blocks = receivedArg as unknown as Array<{ type: string; mimeType?: string }>;
        assertEquals(blocks.length, 2); // text + image
        assertEquals(blocks[0].type, "text");
        assertEquals(blocks[1].type, "image");
        assertEquals(blocks[1].mimeType, "image/webp");
      }

      sessionRegistry.stop();
      await server.shutdown();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// --- Model Routing integration tests ---

Deno.test({
  name: "SessionOrchestrator - processMessage uses model from routing rule when whitelist matches",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      // Configure model routing
      config.agent.modelRouting = {
        enabled: true,
        rules: [
          { match: { channel: "discord/account/11122233344455566" }, model: "premium-model" },
        ],
      };

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const event = createTestEvent();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [
          { stopReason: "end_turn" } as PromptResponse,
        ];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const replyHandler = skillRegistry.getReplyHandler();
            const key = `discord/11122233344455566:99988877766655544`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      const connector = orchestrator.mockConnector!;
      assertEquals(connector.lastModelId, "premium-model");

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - processMessage uses default model when routing is disabled",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      // Routing disabled
      config.agent.modelRouting = {
        enabled: false,
        rules: [
          { match: { channel: "discord/account/11122233344455566" }, model: "premium-model" },
        ],
      };

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const event = createTestEvent();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [
          { stopReason: "end_turn" } as PromptResponse,
        ];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const replyHandler = skillRegistry.getReplyHandler();
            const key = `discord/11122233344455566:99988877766655544`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      const connector = orchestrator.mockConnector!;
      assertEquals(connector.lastModelId, "gpt-4");

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - processSpontaneousPost uses model from sessionType routing rule",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      config.agent.modelRouting = {
        enabled: true,
        rules: [
          { match: { sessionType: "spontaneous" }, model: "spontaneous-model" },
        ],
      };

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [
          { stopReason: "end_turn" } as PromptResponse,
        ];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const replyHandler = skillRegistry.getReplyHandler();
            const key = `discord/bot_id:99988877766655544`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processSpontaneousPost(
        "discord",
        "99988877766655544",
        platformAdapter,
        { botId: "bot_id", fetchRecentMessages: false },
      );

      const connector = orchestrator.mockConnector!;
      assertEquals(connector.lastModelId, "spontaneous-model");

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - passes mcpServers from config to createSession",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, workspaceManager } =
        await createTestableOrchestrator(tempDir);

      // Configure mcpServers
      const config = (orchestrator as unknown as { config: Config }).config;
      config.agent.mcpServers = [
        { name: "test-server", command: "echo", args: ["hello"] },
        { name: "http-server", transport: "http", url: "http://localhost:3002/mcp" },
      ];

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [
          { stopReason: "end_turn" } as PromptResponse,
        ];
        connector.onPrompt = () => {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          const key = `${workspace}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      const connector = orchestrator.mockConnector!;
      assertEquals(connector.lastMCPServers.length, 2);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - passes empty mcpServers when not configured",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, workspaceManager } =
        await createTestableOrchestrator(tempDir);

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [
          { stopReason: "end_turn" } as PromptResponse,
        ];
        connector.onPrompt = () => {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          const key = `${workspace}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      const connector = orchestrator.mockConnector!;
      assertEquals(connector.lastMCPServers.length, 0);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - sends typing indicator when platform supports it",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, workspaceManager } =
        await createTestableOrchestrator(tempDir);

      const event = createTestEvent();
      const platformAdapter = new TypingEnabledMockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [
          { stopReason: "end_turn" } as PromptResponse,
        ];
        connector.onPrompt = () => {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          const key = `${workspace}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        };
      });

      const response = await orchestrator.processMessage(event, platformAdapter);

      assertEquals(response.success, true);
      // Verify typing was called at least once (immediate call before interval)
      const typingAdapter = platformAdapter as unknown as TypingEnabledMockPlatformAdapter;
      assertEquals(typingAdapter.typingCalls.length >= 1, true);
      assertEquals(typingAdapter.typingCalls[0], event.channelId);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - does not send typing when platform does not support it",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, workspaceManager } =
        await createTestableOrchestrator(tempDir);

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [
          { stopReason: "end_turn" } as PromptResponse,
        ];
        connector.onPrompt = () => {
          const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
          const key = `${workspace}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        };
      });

      const response = await orchestrator.processMessage(event, platformAdapter);

      assertEquals(response.success, true);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - typing interval is cleared on session error",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

      const event = createTestEvent();
      const platformAdapter = new TypingEnabledMockPlatformAdapter() as unknown as PlatformAdapter;

      orchestrator.setConnectorSetup((connector) => {
        connector.connect = () => Promise.reject(new Error("Connection failed"));
      });

      const response = await orchestrator.processMessage(event, platformAdapter);

      // Session should fail but typing interval should be cleaned up
      assertEquals(response.success, false);
      // Typing was called at least once (immediate call before error)
      const typingAdapter = platformAdapter as unknown as TypingEnabledMockPlatformAdapter;
      assertEquals(typingAdapter.typingCalls.length >= 1, true);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// --- setSessionMode tests ---

Deno.test({
  name: "SessionOrchestrator - setSessionMode called with opencode + YOLO",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, workspaceManager, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      // Switch to opencode agent with YOLO enabled
      config.agent.defaultAgentType = "opencode";
      // deno-lint-ignore no-explicit-any
      (orchestrator as any).yolo = true;

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
            const key = `${workspace}:${event.channelId}`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      assertEquals(orchestrator.mockConnector!.modeSet, true);
      assertEquals(orchestrator.mockConnector!.lastModeId, "yolo");

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - setSessionMode NOT called with opencode + non-YOLO",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, workspaceManager, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      // Switch to opencode agent without YOLO
      config.agent.defaultAgentType = "opencode";

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
            const key = `${workspace}:${event.channelId}`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      assertEquals(orchestrator.mockConnector!.modeSet, false);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - sets terminate callback that disconnects connector",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
        await createTestableOrchestrator(tempDir);

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();

      // Track setTerminateCallback calls
      let terminateCallbackSessionId: string | null = null;
      let terminateCallback: (() => Promise<void>) | null = null;
      const originalSetTerminateCallback = sessionRegistry.setTerminateCallback.bind(
        sessionRegistry,
      );
      sessionRegistry.setTerminateCallback = (
        sessionId: string,
        callback: () => Promise<void>,
      ) => {
        terminateCallbackSessionId = sessionId;
        terminateCallback = callback;
        originalSetTerminateCallback(sessionId, callback);
      };

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const workspace = workspaceManager.getWorkspaceKeyFromEvent(event);
            const key = `${workspace}:${event.channelId}`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      // Verify setTerminateCallback was called with a valid session ID
      assertExists(terminateCallbackSessionId);
      assertEquals((terminateCallbackSessionId as string).startsWith("sess_"), true);
      assertExists(terminateCallback);

      // Verify the callback calls connector.disconnect()
      // Reset disconnected state (it was already set in the finally block)
      orchestrator.mockConnector!.disconnected = false;
      await (terminateCallback as () => Promise<void>)();
      assertEquals(orchestrator.mockConnector!.disconnected, true);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// --- processMessage tmp cleanup regression tests ---

Deno.test({
  name: "SessionOrchestrator - processMessage success cleans tmp without removing workspace",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
        await createTestableOrchestrator(tempDir);

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();
      const workspaceKey = workspaceManager.getWorkspaceKeyFromEvent(event);
      const workspacePath = workspaceManager.getWorkspacePath(workspaceKey);
      const tmpPath = `${workspacePath}/tmp`;
      const tmpSentinel = `${tmpPath}/success-sentinel.txt`;
      const observedSessionIds: string[] = [];

      orchestrator.setConnectorSetup((connector) => {
        connector.connect = () => {
          Deno.writeTextFileSync(tmpSentinel, "temporary data");
          return Promise.resolve();
        };
        connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
        connector.onPrompt = () => {
          observedSessionIds.push(connector.options.agentConfig.env?.["SESSION_ID"] ?? "");
          const key = `${workspaceKey}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        };
      });

      const response = await orchestrator.processMessage(event, platformAdapter);

      assertEquals(response.success, true);
      assertEquals(response.replySent, true);
      assertEquals(observedSessionIds.length, 1);
      assertEquals(observedSessionIds[0].startsWith("sess_"), true);
      assertEquals(Deno.env.get("SESSION_ID"), undefined);
      assertEquals(await pathExists(tmpPath), false);

      const workspaceStat = await Deno.stat(workspacePath);
      assertEquals(workspaceStat.isDirectory, true);
      // Memory files are created lazily, not at workspace creation
      assertEquals(await pathExists(`${workspacePath}/memory.public.jsonl`), false);
      assertEquals(await pathExists(`${workspacePath}/memory.private.jsonl`), false);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - processMessage dry run cleans tmp without creating connector",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, workspaceManager, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      config.agent.dryRun = {
        enabled: true,
        outputPath: `${tempDir}/dry-run`,
        mockReply: "Dry run reply",
      };

      const event = createTestEvent();
      const workspaceKey = workspaceManager.getWorkspaceKeyFromEvent(event);
      const workspacePath = workspaceManager.getWorkspacePath(workspaceKey);
      const tmpPath = `${workspacePath}/tmp`;
      const tmpSentinel = `${tmpPath}/dry-run-sentinel.txt`;

      class InspectingDryRunPlatformAdapter extends MockPlatformAdapter {
        override async sendReply(channelId: string, content: string): Promise<ReplyResult> {
          Deno.writeTextFileSync(tmpSentinel, "dry run data");
          return await super.sendReply(channelId, content);
        }
      }

      const platformAdapter = new InspectingDryRunPlatformAdapter() as unknown as PlatformAdapter;

      const response = await orchestrator.processMessage(event, platformAdapter);

      assertEquals(response.success, true);
      assertEquals(response.replySent, true);
      assertEquals(orchestrator.mockConnector, null);
      assertEquals(Deno.env.get("SESSION_ID"), undefined);
      assertEquals(await pathExists(tmpPath), false);

      const dryRunFiles: string[] = [];
      for await (const entry of Deno.readDir(config.agent.dryRun.outputPath)) {
        dryRunFiles.push(entry.name);
      }
      assertEquals(dryRunFiles.length, 1);
      assertEquals(dryRunFiles[0].startsWith("message_"), true);
      assertEquals(dryRunFiles[0].endsWith(".md"), true);

      const workspaceStat = await Deno.stat(workspacePath);
      assertEquals(workspaceStat.isDirectory, true);
      // Memory files are created lazily, not at workspace creation
      assertEquals(await pathExists(`${workspacePath}/memory.public.jsonl`), false);
      assertEquals(await pathExists(`${workspacePath}/memory.private.jsonl`), false);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "SessionOrchestrator - processMessage keeps tmp when another session is active for the workspace",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
        await createTestableOrchestrator(tempDir);

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const replyHandler = skillRegistry.getReplyHandler();
      const workspace = await workspaceManager.getOrCreateWorkspace(event);
      const tmpSentinel = `${workspace.tmpPath}/peer-protected.txt`;
      let observedSessionId: string | null = null;

      const peerSessionId = sessionRegistry.register({
        workspace,
        channelId: "peer-channel",
        platform: event.platform,
        userId: event.userId,
        guildId: event.guildId,
        isDm: event.isDm,
        platformAdapter,
        triggerEvent: event,
      });

      orchestrator.setConnectorSetup((connector) => {
        connector.connect = () => {
          Deno.writeTextFileSync(tmpSentinel, "keep me");
          return Promise.resolve();
        };
        connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
        connector.onPrompt = () => {
          observedSessionId = connector.options.agentConfig.env?.["SESSION_ID"] ?? "";
          const key = `${workspace.key}:${event.channelId}`;
          // deno-lint-ignore no-explicit-any
          (replyHandler as any).replySentMap.set(key, true);
        };
      });

      const response = await orchestrator.processMessage(event, platformAdapter);

      assertEquals(response.success, true);
      assertEquals(response.replySent, true);
      assertExists(observedSessionId);
      assertEquals(Deno.env.get("SESSION_ID"), undefined);
      assertEquals(await pathExists(workspace.tmpPath), true);
      assertEquals(await Deno.readTextFile(tmpSentinel), "keep me");
      assertEquals(sessionRegistry.hasActiveSessionsForWorkspace(workspace.key), true);

      const workspaceStat = await Deno.stat(workspace.path);
      assertEquals(workspaceStat.isDirectory, true);

      sessionRegistry.remove(peerSessionId);
      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - processMessage connection errors still clean tmp",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, workspaceManager, sessionRegistry } = await createTestableOrchestrator(
        tempDir,
      );

      const event = createTestEvent();
      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const workspaceKey = workspaceManager.getWorkspaceKeyFromEvent(event);
      const workspacePath = workspaceManager.getWorkspacePath(workspaceKey);
      const tmpPath = `${workspacePath}/tmp`;
      const tmpSentinel = `${tmpPath}/error-sentinel.txt`;

      orchestrator.setConnectorSetup((connector) => {
        connector.connect = () => {
          Deno.writeTextFileSync(tmpSentinel, "cleanup after error");
          return Promise.reject(new Error("Connection failed"));
        };
      });

      const response = await orchestrator.processMessage(event, platformAdapter);

      assertEquals(response.success, false);
      assertEquals(response.replySent, false);
      assertEquals(response.error, "Connection failed");
      assertEquals(Deno.env.get("SESSION_ID"), undefined);
      assertEquals(await pathExists(tmpPath), false);

      const workspaceStat = await Deno.stat(workspacePath);
      assertEquals(workspaceStat.isDirectory, true);
      // Memory files are created lazily, not at workspace creation
      assertEquals(await pathExists(`${workspacePath}/memory.public.jsonl`), false);
      assertEquals(await pathExists(`${workspacePath}/memory.private.jsonl`), false);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// === cleanupWorkspaceTmp tests ===

Deno.test({
  name: "cleanupWorkspaceTmp - removes tmp when no other sessions",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

      // Create a workspace-like structure with a tmp directory
      const workspacePath = `${tempDir}/workspaces/discord/testuser`;
      const tmpPath = `${workspacePath}/tmp`;
      await Deno.mkdir(tmpPath, { recursive: true });
      // Put a file in tmp to verify it gets cleaned up
      await Deno.writeTextFile(`${tmpPath}/test-file.txt`, "temporary data");

      const workspace = {
        key: "discord/testuser",
        components: { platform: "discord" as const, userId: "testuser" },
        path: workspacePath,
        tmpPath,
        isDm: false,
      };

      const { createLogger } = await import("@utils/logger.ts");
      const logger = createLogger("test");

      // No active sessions exist, so tmp should be removed
      // deno-lint-ignore no-explicit-any
      await (orchestrator as any).cleanupWorkspaceTmp(workspace, logger);

      // Verify tmp directory was removed
      let exists = true;
      try {
        await Deno.stat(tmpPath);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          exists = false;
        }
      }
      assertEquals(exists, false);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "cleanupWorkspaceTmp - skips cleanup when other sessions exist",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

      // Create a workspace-like structure with a tmp directory
      const workspacePath = `${tempDir}/workspaces/discord/testuser`;
      const tmpPath = `${workspacePath}/tmp`;
      await Deno.mkdir(tmpPath, { recursive: true });
      await Deno.writeTextFile(`${tmpPath}/test-file.txt`, "temporary data");

      const workspace = {
        key: "discord/testuser",
        components: { platform: "discord" as const, userId: "testuser" },
        path: workspacePath,
        tmpPath,
        isDm: false,
      };

      // Register an active session for the same workspace
      const activeSessionId = sessionRegistry.register({
        workspace,
        channelId: "some-channel",
        platform: "discord",
        userId: "testuser",
        isDm: false,
        platformAdapter: new MockPlatformAdapter() as unknown as PlatformAdapter,
      });

      const { createLogger } = await import("@utils/logger.ts");
      const logger = createLogger("test");

      // Should skip cleanup because another session exists
      // deno-lint-ignore no-explicit-any
      await (orchestrator as any).cleanupWorkspaceTmp(workspace, logger);

      // Verify tmp directory still exists
      const stat = await Deno.stat(tmpPath);
      assertEquals(stat.isDirectory, true);

      // Verify file still exists
      const content = await Deno.readTextFile(`${tmpPath}/test-file.txt`);
      assertEquals(content, "temporary data");

      sessionRegistry.remove(activeSessionId);
      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "cleanupWorkspaceTmp - handles NotFound gracefully",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

      const workspace = {
        key: "discord/nonexistent",
        components: { platform: "discord" as const, userId: "nonexistent" },
        path: `${tempDir}/workspaces/discord/nonexistent`,
        tmpPath: `${tempDir}/workspaces/discord/nonexistent/tmp`,
        isDm: false,
      };

      const { createLogger } = await import("@utils/logger.ts");
      const logger = createLogger("test");

      // Should not throw when tmp directory doesn't exist
      // deno-lint-ignore no-explicit-any
      await (orchestrator as any).cleanupWorkspaceTmp(workspace, logger);

      // If we get here without throwing, the test passes
      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "cleanupWorkspaceTmp - handles other errors gracefully",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

      const workspace = {
        key: "discord/erroruser",
        components: { platform: "discord" as const, userId: "erroruser" },
        path: `${tempDir}/workspaces/discord/erroruser`,
        tmpPath: `${tempDir}/workspaces/discord/erroruser/tmp`,
        isDm: false,
      };

      const { createLogger } = await import("@utils/logger.ts");
      const logger = createLogger("test");

      // Stub Deno.removeSync to throw a non-NotFound error
      const originalRemoveSync = Deno.removeSync;
      let removeCalled = false;
      // deno-lint-ignore no-explicit-any
      (Deno as any).removeSync = (_path: string, _options?: Deno.RemoveOptions) => {
        removeCalled = true;
        throw new Error("Permission denied (mock)");
      };

      try {
        // Should not throw — error is caught and logged
        // deno-lint-ignore no-explicit-any
        await (orchestrator as any).cleanupWorkspaceTmp(workspace, logger);
        assertEquals(removeCalled, true);
      } finally {
        // Restore original Deno.removeSync
        // deno-lint-ignore no-explicit-any
        (Deno as any).removeSync = originalRemoveSync;
      }

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// --- Reasoning Effort integration tests ---

Deno.test({
  name: "SessionOrchestrator - applies routing-rule reasoning effort after model setting",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      config.agent.reasoningEffort = "low";
      config.agent.modelRouting = {
        enabled: true,
        rules: [
          {
            match: { channel: "discord/account/11122233344455566" },
            model: "premium-model",
            reasoningEffort: "high",
          },
        ],
      };

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const event = createTestEvent();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const replyHandler = skillRegistry.getReplyHandler();
            const key = `discord/11122233344455566:99988877766655544`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      const connector = orchestrator.mockConnector!;
      // Rule effort "high" wins over global "low".
      assertEquals(connector.reasoningEffortCalls.includes("high"), true);

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - applies global reasoning effort when no rule matches",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      config.agent.reasoningEffort = "medium";
      config.agent.modelRouting = { enabled: false, rules: [] };

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const event = createTestEvent();

      orchestrator.setConnectorSetup((connector) => {
        connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const replyHandler = skillRegistry.getReplyHandler();
            const key = `discord/11122233344455566:99988877766655544`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      const connector = orchestrator.mockConnector!;
      assertEquals(connector.reasoningEffortCalls.length >= 1, true);
      // Every call uses the resolved global value (never undefined/empty).
      for (const v of connector.reasoningEffortCalls) {
        assertEquals(typeof v === "string" && v.length > 0, true);
      }
      assertEquals(connector.reasoningEffortCalls[0], "medium");

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "SessionOrchestrator - reapplies reasoning effort across conversation-summary swap",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const { orchestrator, skillRegistry, sessionRegistry, config } =
        await createTestableOrchestrator(tempDir);

      config.agent.reasoningEffort = "high";
      config.conversationSummary = {
        enabled: true,
        model: "summary-model", // different from agent.model -> triggers swap
        reasoningEffort: "low",
      };

      const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
      const event = createTestEvent();

      orchestrator.setConnectorSetup((connector) => {
        // 1st prompt = main turn (reply), 2nd prompt = summary generation
        connector.promptResponses = [
          { stopReason: "end_turn" } as PromptResponse,
          { stopReason: "end_turn" } as PromptResponse,
        ];
        connector.onPrompt = (callCount) => {
          if (callCount === 1) {
            const replyHandler = skillRegistry.getReplyHandler();
            const key = `discord/11122233344455566:99988877766655544`;
            // deno-lint-ignore no-explicit-any
            (replyHandler as any).replySentMap.set(key, true);
          }
        };
      });

      await orchestrator.processMessage(event, platformAdapter);

      const connector = orchestrator.mockConnector!;
      // Expect: initial "high", summary-model "low", restore "high".
      assertEquals(connector.reasoningEffortCalls[0], "high");
      assertEquals(connector.reasoningEffortCalls.includes("low"), true);
      // Last call restores the original session effort.
      assertEquals(
        connector.reasoningEffortCalls[connector.reasoningEffortCalls.length - 1],
        "high",
      );

      sessionRegistry.stop();
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// === Crash-signal cascade tests (handle-agent-process-crash) ===

Deno.test("SessionOrchestrator - processMessage cleans up when connector.connect() rejects instead of hanging", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createTestableOrchestrator(tempDir);

    orchestrator.setConnectorSetup((connector) => {
      // Simulates AgentConnector.connect() failing fast due to a crash-signal or
      // connect-timeout rejection (handle-agent-process-crash), instead of hanging.
      connector.connect = () => {
        return Promise.reject(
          new Error(
            "Agent process exited unexpectedly (code=1, signal=null) while awaiting a response",
          ),
        );
      };
    });

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    const response = await orchestrator.processMessage(event, platformAdapter);

    // Fails fast (this await itself would never resolve if the old hang bug reappeared)
    // instead of hanging, and the existing finally/catch cleanup still runs correctly.
    assertEquals(response.success, false);
    assertEquals(response.replySent, false);
    assertExists(response.error);
    assertEquals(orchestrator.mockConnector!.disconnected, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("SessionOrchestrator - setupSession pre-creates session payload staging dir; ACP writeTextFile lands in it", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, workspaceManager, sessionRegistry } =
      await createTestableOrchestrator(tempDir);

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;
    const replyHandler = skillRegistry.getReplyHandler();

    // Assert mid-session (the connector is created right after setupSession, and
    // the session-scoped staging dir is only removed at session end): the
    // client config carries the shell session id, and setupSession has
    // pre-created `{cwd}/tmp/{sessionId}` so the agent's `$TMPDIR/$SESSION_ID/...`
    // payload writes have an existing parent (a missing parent would later
    // surface as SKILL_PAYLOAD_NOT_FOUND). The dir is a real writable
    // directory, and the token-expansion write chain itself is covered by the
    // ChatbotClient tests (writeTextFile writes the EXPANDED path).
    orchestrator.setConnectorSetup((connector) => {
      const clientConfig = connector.options.clientConfig as ClientConfig;
      if (!clientConfig.sessionId) {
        throw new Error("captured client config missing sessionId");
      }
      const stagingDir = join(connector.options.agentConfig.cwd, "tmp", clientConfig.sessionId);
      assertEquals(Deno.statSync(stagingDir).isDirectory, true);
      const probe = join(stagingDir, "probe.md");
      Deno.writeTextFileSync(probe, "probe");
      assertEquals(Deno.readTextFileSync(probe), "probe");

      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = (callCount) => {
        // Simulate the reply being sent so the session completes successfully.
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

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
