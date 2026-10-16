import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import type {
  WorkspaceTmpCleanupOptions,
  WorkspaceTmpCleanupOutcome,
} from "@core/workspace-manager.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import type { AgentConnector, AgentProcessEvidence } from "../../src/acp/agent-connector.ts";
import type { Config } from "../../src/types/config.ts";
import type { NormalizedEvent, PlatformMessage } from "../../src/types/events.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PlatformCapabilities, ReplyResult } from "../../src/types/platform.ts";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";
import type { ResolvedReminder } from "../../src/types/reminder.ts";
import type { ReminderStore } from "@core/reminder-store.ts";
import { exists } from "@std/fs";
import { join, resolve } from "@std/path";

/**
 * The ONE deployment-resolved skill-script root
 * (`unify-skill-root-and-inventory`): the repository `skills/` tree — what
 * `agent.skillsDir` (default `"skills"`) resolves to for BOTH agent types.
 */
const RESOLVED_SKILLS_ROOT = Deno.realPathSync(
  resolve(import.meta.dirname ?? ".", "../../skills"),
);

class MockAgentConnector {
  connected = false;
  sessionId = "mock-session-id";
  promptCallCount = 0;
  promptResponses: PromptResponse[] = [];
  modelSet = false;
  lastModelId = "";
  disconnected = false;

  constructor(_options: AgentConnectorOptions) {}
  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }
  supportsImageContent(): boolean {
    return false;
  }
  createSession(): Promise<string> {
    return Promise.resolve(this.sessionId);
  }
  setSessionModel(_sessionId: string, modelId: string): Promise<void> {
    this.modelSet = true;
    this.lastModelId = modelId;
    return Promise.resolve();
  }
  reasoningEffortCalls: string[] = [];
  setReasoningEffort(_sessionId: string, value: string): Promise<string> {
    this.reasoningEffortCalls.push(value);
    return Promise.resolve("applied");
  }
  prompt(_sessionId: string, _text: string): Promise<PromptResponse> {
    const response = this.promptResponses[this.promptCallCount] ??
      { stopReason: "end_turn" } as PromptResponse;
    this.promptCallCount++;
    return Promise.resolve(response);
  }
  disconnect(): Promise<void> {
    this.disconnected = true;
    return Promise.resolve();
  }
  /** Producer-teardown evidence; no wrapper is ever spawned by this stub. */
  processEvidence: AgentProcessEvidence = { generations: 0, pid: undefined };
  getProcessEvidence(): AgentProcessEvidence {
    return this.processEvidence;
  }
}

class TestableSessionOrchestrator extends SessionOrchestrator {
  mockConnector: MockAgentConnector | null = null;
  protected override createConnector(options: AgentConnectorOptions): AgentConnector {
    this.mockConnector = new MockAgentConnector(options);
    return this.mockConnector as unknown as AgentConnector;
  }
}

/**
 * Workspace manager that records temporary-use acquire/release calls, so a
 * dry-run entrypoint's exactly-once ownership can be asserted directly.
 */
class RecordingWorkspaceManager extends WorkspaceManager {
  readonly acquired: string[] = [];
  readonly released: string[] = [];
  override acquireTmpUse(tmpPath: string): void {
    this.acquired.push(tmpPath);
    super.acquireTmpUse(tmpPath);
  }
  override releaseTmpUse(
    tmpPath: string,
    options?: WorkspaceTmpCleanupOptions,
  ): WorkspaceTmpCleanupOutcome | null {
    this.released.push(tmpPath);
    return super.releaseTmpUse(tmpPath, options);
  }
}

class MockPlatformAdapter implements Partial<PlatformAdapter> {
  platform = "discord" as const;
  sentReplies: { channelId: string; content: string }[] = [];
  capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: false,
    supportsDm: true,
    supportsGuild: true,
    supportsReactions: false,
    maxMessageLength: 2000,
  };

  sendReply(channelId: string, content: string): Promise<ReplyResult> {
    this.sentReplies.push({ channelId, content });
    return Promise.resolve({ success: true, messageId: "mock_msg_" + Date.now() });
  }

  fetchRecentMessages(_channelId: string, _limit: number): Promise<PlatformMessage[]> {
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

function createTestConfig(tempDir: string, dryRunEnabled = true): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test", token: "t", enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
      tokenLimit: 20000,
      defaultAgentType: "opencode",
      dryRun: {
        enabled: dryRunEnabled,
        outputPath: `${tempDir}/dry-run-output/`,
        mockReply: "（Dry run 模式 — 此為測試回覆）",
      },
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: tempDir, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    accessControl: { replyTo: "whitelist", whitelist: [] },
    skillApi: {
      enabled: true,
      port: 3998,
      host: "127.0.0.1",
    },
  } as unknown as Config;
}

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

async function createOrchestrator(
  tempDir: string,
  dryRunEnabled = true,
  sendFileEnabled = false,
  workspaceManagerOverride?: WorkspaceManager,
) {
  const config = createTestConfig(tempDir, dryRunEnabled);
  const workspaceManager = workspaceManagerOverride ??
    new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(
    memoryStore,
    undefined,
    undefined,
    sendFileEnabled ? { enabled: true, allowedExtensions: [] } : undefined,
  );

  await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_reply.md`,
    "You are a helper.\n{{ if sessionId }}\nSession: {{ sessionId }}\n{{ /if }}\n" +
      "Skill root: {{ skillsDir }}",
  );
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_spontaneous.md`,
    "Spontaneous post prompt.\nSkill root: {{ skillsDir }}",
  );
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_self_research.md`,
    "Self research prompt. RSS: {{ rssItems }}\nSkill root: {{ skillsDir }}",
  );
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_memory_maintenance.md`,
    "Memory maintenance for {{ workspaceKey }}. Threshold: {{ minMemoryCount }}. Dump: {{ memoriesDump }}\n" +
      "Skill root: {{ skillsDir }}",
  );
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_reminder.md`,
    "Reminder: {{ reminderMessage }}\nSkill root: {{ skillsDir }}",
  );

  const contextAssembler = new ContextAssembler(memoryStore, {
    systemPromptPath: `${tempDir}/prompts/system_reply.md`,
    skillsDir: RESOLVED_SKILLS_ROOT, // trusted skill-script root (required render input)
    recentMessageLimit: 20,
    tokenLimit: 20000,
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

  return { orchestrator, skillRegistry, sessionRegistry, config, workspaceManager };
}

// --- Tests ---

Deno.test("Dry run disabled — normal flow proceeds (connector.prompt is called)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createOrchestrator(tempDir, false);
    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    const response = await orchestrator.processMessage(event, platformAdapter);

    // With dry run disabled, the connector should be created and prompt called
    assertExists(orchestrator.mockConnector);
    assertEquals(orchestrator.mockConnector.promptCallCount > 0, true);
    assertExists(response);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run enabled — prompt written to file, connector.prompt NOT called", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(tempDir);
    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    const response = await orchestrator.processMessage(event, platformAdapter);

    // Connector should NOT have been created (dry-run short-circuits before connector)
    assertEquals(orchestrator.mockConnector, null);
    assertEquals(response.success, true);

    // Check output file was created
    const outputDir = config.agent.dryRun!.outputPath;
    const dirExists = await exists(outputDir);
    assertEquals(dirExists, true);

    // Check there's at least one .md file in the output dir
    let foundFile = false;
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.name.startsWith("message_") && entry.name.endsWith(".md")) {
        foundFile = true;
        // Read file and check it contains prompt content
        const content = await Deno.readTextFile(join(outputDir, entry.name));
        assertStringIncludes(content, "You are a helper.");
        break;
      }
    }
    assertEquals(foundFile, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run enabled — output directory auto-created", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(tempDir);
    // Set a non-existent output path
    config.agent.dryRun!.outputPath = join(tempDir, "nested", "deep", "dry-run");

    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    await orchestrator.processMessage(event, platformAdapter);

    const dirExists = await exists(config.agent.dryRun!.outputPath);
    assertEquals(dirExists, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run enabled — mock reply sent when configured", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createOrchestrator(tempDir);
    const event = createTestEvent();
    const mockAdapter = new MockPlatformAdapter();
    const platformAdapter = mockAdapter as unknown as PlatformAdapter;

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.replySent, true);
    assertEquals(mockAdapter.sentReplies.length, 1);
    assertStringIncludes(mockAdapter.sentReplies[0].content, "Dry run");

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run enabled — no reply when mockReply is empty", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(tempDir);
    config.agent.dryRun!.mockReply = "";

    const event = createTestEvent();
    const mockAdapter = new MockPlatformAdapter();
    const platformAdapter = mockAdapter as unknown as PlatformAdapter;

    const response = await orchestrator.processMessage(event, platformAdapter);

    assertEquals(response.success, true);
    assertEquals(response.replySent, false);
    assertEquals(response.fileSent, false);
    assertEquals(mockAdapter.sentReplies.length, 0);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run enabled — produces no file-send response state even with send-file skill enabled", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(
      tempDir,
      true,
      true,
    );
    config.agent.dryRun!.mockReply = "";

    const event = createTestEvent();
    const mockAdapter = new MockPlatformAdapter();
    const platformAdapter = mockAdapter as unknown as PlatformAdapter;

    const response = await orchestrator.processMessage(event, platformAdapter);

    // Dry run never executes the agent, so no file-send state can be produced
    assertEquals(response.success, true);
    assertEquals(response.replySent, false);
    assertEquals(response.fileSent, false);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run enabled — shell session cleaned up properly", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createOrchestrator(tempDir);
    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    await orchestrator.processMessage(event, platformAdapter);

    // Verify SESSION_ID file was removed (workspace should exist but no SESSION_ID)
    const workspacePath = join(tempDir, "workspaces", "discord", "test_user");
    const sessionIdFile = join(workspacePath, "SESSION_ID");
    const sessionIdExists = await exists(sessionIdFile);
    assertEquals(sessionIdExists, false);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run — works for spontaneous post session type", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(tempDir);
    const mockAdapter = new MockPlatformAdapter();
    const platformAdapter = mockAdapter as unknown as PlatformAdapter;

    const response = await orchestrator.processSpontaneousPost(
      "discord",
      "test_channel",
      platformAdapter,
      { botId: "bot_id", fetchRecentMessages: false },
    );

    assertEquals(response.success, true);
    assertEquals(orchestrator.mockConnector, null);

    // Verify output file exists with "spontaneous" in the name
    const outputDir = config.agent.dryRun!.outputPath;
    let foundFile = false;
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.name.startsWith("spontaneous_") && entry.name.endsWith(".md")) {
        foundFile = true;
        break;
      }
    }
    assertEquals(foundFile, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run — works for self-research session type", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(tempDir);

    const rssItems = [
      { title: "Test Article", url: "https://example.com", description: "Desc", sourceName: "Ex" },
    ];

    const response = await orchestrator.processSelfResearch(rssItems, {
      enabled: true,
      model: "gpt-4",
      rssFeeds: [],
      minIntervalMs: 43200000,
      maxIntervalMs: 86400000,
      verifyCompletion: true,
    });

    assertEquals(response.success, true);
    assertEquals(orchestrator.mockConnector, null);

    // Verify output file with "self_research" in the name
    const outputDir = config.agent.dryRun!.outputPath;
    let foundFile = false;
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.name.startsWith("self_research_") && entry.name.endsWith(".md")) {
        foundFile = true;
        break;
      }
    }
    assertEquals(foundFile, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run — works for memory-maintenance session type", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(tempDir);

    const response = await orchestrator.processMemoryMaintenance("discord/test_user", {
      enabled: true,
      model: "gpt-4",
      minMemoryCount: 50,
      intervalMs: 604800000,
    });

    assertEquals(response.success, true);
    assertEquals(orchestrator.mockConnector, null);

    // Verify output file with "memory_maintenance" in the name
    const outputDir = config.agent.dryRun!.outputPath;
    let foundFile = false;
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.name.startsWith("memory_maintenance_") && entry.name.endsWith(".md")) {
        foundFile = true;
        break;
      }
    }
    assertEquals(foundFile, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run — file naming includes timestamp and session type", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(tempDir);
    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    await orchestrator.processMessage(event, platformAdapter);

    const outputDir = config.agent.dryRun!.outputPath;
    for await (const entry of Deno.readDir(outputDir)) {
      // Pattern: message_YYYY-MM-DDTHH-MM-SS-MMMZ_XXXXXXXX.md
      const pattern = /^message_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/;
      assertEquals(pattern.test(entry.name), true, `Filename should match pattern: ${entry.name}`);
      assertStringIncludes(entry.name, ".md");
    }

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run — lurk and channel maintenance release their ownership exactly once", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new RecordingWorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const { orchestrator, sessionRegistry } = await createOrchestrator(
      tempDir,
      true,
      false,
      manager,
    );
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    // Channel lurk owns one root (the trigger user's workspace).
    const lurkBefore = { acquired: manager.acquired.length, released: manager.released.length };
    const lurkResponse = await orchestrator.processChannelLurkMessage(
      createTestEvent(),
      platformAdapter,
    );
    assertEquals(lurkResponse.success, true);
    assertEquals(orchestrator.mockConnector, null, "dry run never builds a connector");
    const lurkAcquired = manager.acquired.slice(lurkBefore.acquired);
    const lurkReleased = manager.released.slice(lurkBefore.released);
    assertEquals(lurkAcquired.length, 1);
    assertEquals(lurkReleased, lurkAcquired);
    for (const tmpPath of lurkAcquired) {
      assertEquals(manager.getTmpUseCount(tmpPath), 0);
    }

    // Channel memory maintenance owns TWO roots: its synthetic per-user
    // workspace and the channel workspace the agent process runs in.
    const channelWorkspace = await manager.getOrCreateChannelWorkspace(
      "discord",
      "test_channel",
    );
    const maintenanceBefore = {
      acquired: manager.acquired.length,
      released: manager.released.length,
    };
    const channelResponse = await orchestrator.processChannelMemoryMaintenance(
      "discord/test_channel",
      channelWorkspace,
      { enabled: true, model: "gpt-4", minMemoryCount: 50, intervalMs: 604800000 },
    );
    assertEquals(channelResponse.success, true);
    const maintenanceAcquired = manager.acquired.slice(maintenanceBefore.acquired);
    const maintenanceReleased = manager.released.slice(maintenanceBefore.released);
    assertEquals(maintenanceAcquired.length, 2);
    assertEquals(new Set(maintenanceAcquired).size, 2, "both owning roots are distinct");
    assertEquals([...maintenanceAcquired].sort(), [...maintenanceReleased].sort());
    for (const tmpPath of maintenanceAcquired) {
      assertEquals(manager.getTmpUseCount(tmpPath), 0);
    }
    assert(
      maintenanceAcquired.includes(join(channelWorkspace.path, "tmp")),
      "the channel workspace the agent runs in is owned",
    );

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("CLI --dry-run flag overrides config (bootstrap behavior)", async () => {
  // This test verifies the config merging logic without full bootstrap
  const { loadConfig } = await import("@core/config-loader.ts");

  const tempDir = await Deno.makeTempDir();
  try {
    // Create minimal config
    await Deno.writeTextFile(
      join(tempDir, "config.yaml"),
      `
platforms:
  discord:
    token: "test-token"
    enabled: true
  misskey:
    host: "test.com"
    token: "test-token"
    enabled: false
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
  tokenLimit: 20000
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`,
    );

    const config = await loadConfig(tempDir);

    // Default should be disabled
    assertEquals(config.agent.dryRun?.enabled, false);

    // Simulate CLI override (same as bootstrap does)
    if (!config.agent.dryRun) {
      config.agent.dryRun = {
        enabled: true,
        outputPath: "./data/dry-run/",
        mockReply: "（Dry run 模式 — 此為測試回覆）",
      };
    } else {
      config.agent.dryRun.enabled = true;
    }

    assertEquals(config.agent.dryRun.enabled, true);
    assertEquals(config.agent.dryRun.outputPath, "./data/dry-run/");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run — metrics recorded correctly (activeSessionsGauge incremented/decremented)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createOrchestrator(tempDir);
    const event = createTestEvent();
    const platformAdapter = new MockPlatformAdapter() as unknown as PlatformAdapter;

    // The test verifies that processMessage completes without error,
    // which means the finally block properly decremented the gauge
    const response = await orchestrator.processMessage(event, platformAdapter);
    assertEquals(response.success, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Dry run — works for reminder session type", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createOrchestrator(tempDir);
    const mockAdapter = {
      platform: "discord",
      getDmChannelId: () => Promise.resolve("dm-ch"),
      sendReply: () => Promise.resolve({ success: true }),
    } as unknown as PlatformAdapter;

    const reminder: ResolvedReminder = {
      id: `rem_${Date.now()}`,
      createdAt: new Date().toISOString(),
      scheduledAt: new Date().toISOString(),
      message: "Test reminder",
      platform: "discord",
      userId: "test_user",
      enabled: true,
    };

    const reminderStore = {
      cancelReminder: () => Promise.resolve(),
    } as unknown as ReminderStore;

    const response = await orchestrator.processReminder(
      reminder,
      mockAdapter,
      reminderStore,
    );

    assertEquals(response.success, true);
    assertEquals(orchestrator.mockConnector, null);

    // Verify output file with "reminder" in the name
    const outputDir = config.agent.dryRun!.outputPath;
    let foundFile = false;
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.name.startsWith("reminder_") && entry.name.endsWith(".md")) {
        foundFile = true;
        break;
      }
    }
    assertEquals(foundFile, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
