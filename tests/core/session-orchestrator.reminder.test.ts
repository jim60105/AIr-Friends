import { assertEquals, assertExists } from "@std/assert";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import type { AgentConnector } from "../../src/acp/agent-connector.ts";
import type { Config } from "../../src/types/config.ts";
import type { ResolvedReminder } from "../../src/types/reminder.ts";
import type { ReminderStore } from "@core/reminder-store.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";

class MockAgentConnector {
  connected = false;
  sessionId = "mock-session-id";
  promptCallCount = 0;
  promptResponses: PromptResponse[] = [];
  modelSet = false;
  lastModelId = "";
  disconnected = false;
  onPrompt?: (callCount: number) => void;

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
  prompt(_sessionId: string, _text: string): Promise<PromptResponse> {
    const response = this.promptResponses[this.promptCallCount] ??
      { stopReason: "end_turn" } as PromptResponse;
    this.promptCallCount++;
    this.onPrompt?.(this.promptCallCount);
    return Promise.resolve(response);
  }
  disconnect(): Promise<void> {
    this.disconnected = true;
    return Promise.resolve();
  }
}

class TestableSessionOrchestrator extends SessionOrchestrator {
  mockConnector: MockAgentConnector | null = null;
  private connectorSetup?: (c: MockAgentConnector) => void;
  setConnectorSetup(s: (c: MockAgentConnector) => void) {
    this.connectorSetup = s;
  }
  protected override createConnector(options: AgentConnectorOptions): AgentConnector {
    this.mockConnector = new MockAgentConnector(options);
    this.connectorSetup?.(this.mockConnector);
    return this.mockConnector as unknown as AgentConnector;
  }
}

function createTestConfig(tempDir: string): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test", token: "t", enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: `${tempDir}/prompts/system_reply.md`,
      tokenLimit: 20000,
      defaultAgentType: "copilot",
      githubToken: "test-token",
    },
    memory: { searchLimit: 10, maxChars: 2000, recentMessageLimit: 20 },
    workspace: { repoPath: tempDir, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    accessControl: { replyTo: "whitelist", whitelist: [] },
    skillApi: {
      enabled: true,
      port: 3997,
      host: "127.0.0.1",
      sessionTimeoutMs: 60000,
    },
  } as unknown as Config;
}

function makeReminder(overrides: Partial<ResolvedReminder> = {}): ResolvedReminder {
  return {
    id: `rem_${Date.now()}`,
    createdAt: new Date().toISOString(),
    scheduledAt: new Date().toISOString(),
    message: "Test reminder",
    platform: "discord",
    userId: "testuser",
    enabled: true,
    ...overrides,
  };
}

function makeMockAdapter(
  dmChannelId: string | null = "dm-ch",
): PlatformAdapter {
  return {
    platform: "discord",
    getDmChannelId: () => Promise.resolve(dmChannelId),
    sendReply: () => Promise.resolve({ success: true }),
  } as unknown as PlatformAdapter;
}

function makeMockReminderStore(
  onCancel?: (id: string) => void,
): ReminderStore {
  return {
    cancelReminder: (_ws: unknown, id: string) => {
      onCancel?.(id);
      return Promise.resolve();
    },
  } as unknown as ReminderStore;
}

async function createReminderTestOrchestrator(tempDir: string) {
  const config = createTestConfig(tempDir);
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, { searchLimit: 10, maxChars: 2000 });
  const skillRegistry = new SkillRegistry(memoryStore);

  await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_reply.md`,
    "You are a helper.\n{{ if sessionId }}\nSession: {{ sessionId }}\n{{ /if }}",
  );
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_reminder.md`,
    "Reminder: {{ reminderMessage }}\nCreated: {{ reminderCreatedAt }}\nScheduled: {{ reminderScheduledAt }}\nPlatform: {{ platform }}\nUser: {{ userId }}\nChannel: {{ channelId }}",
  );

  const contextAssembler = new ContextAssembler(memoryStore, {
    systemPromptPath: `${tempDir}/prompts/system_reply.md`,
    recentMessageLimit: 20,
    tokenLimit: 20000,
    memoryMaxChars: 2000,
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

  return { orchestrator, skillRegistry, sessionRegistry, config };
}

Deno.test("processReminder - delivers reminder and disables it on success", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, sessionRegistry } = await createReminderTestOrchestrator(
      tempDir,
    );

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));
    const reminder = makeReminder({ id: "r1", userId: "user1", message: "Stand up" });

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = () => {
        // Simulate the agent calling send-reply by setting the reply state
        const replyHandler = skillRegistry.getReplyHandler();
        // Access private replySentMap to simulate reply
        const key = "discord/user1:dm-ch";
        (replyHandler as unknown as { replySentMap: Map<string, boolean> }).replySentMap.set(
          key,
          true,
        );
      };
    });

    const res = await orchestrator.processReminder(
      reminder,
      makeMockAdapter("dm-ch"),
      reminderStore,
    );
    assertEquals(res.success, true);
    assertEquals(res.replySent, true);
    assertEquals(cancelledIds.includes("r1"), true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - cancels reminder when DM channel cannot be resolved", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createReminderTestOrchestrator(tempDir);

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));
    const reminder = makeReminder({ id: "r2", userId: "user2" });

    const res = await orchestrator.processReminder(
      reminder,
      makeMockAdapter(null),
      reminderStore,
    );
    assertEquals(res.success, false);
    assertEquals(cancelledIds.includes("r2"), true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - renders template with reminder content", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, sessionRegistry } = await createReminderTestOrchestrator(
      tempDir,
    );

    let captured = "";
    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = () => {
        const replyHandler = skillRegistry.getReplyHandler();
        const key = "discord/user3:dm-ch";
        (replyHandler as unknown as { replySentMap: Map<string, boolean> }).replySentMap.set(
          key,
          true,
        );
      };
      const origPrompt = connector.prompt.bind(connector);
      connector.prompt = (sid: string, text: string) => {
        captured = text;
        return origPrompt(sid, text);
      };
    });

    const reminder = makeReminder({
      id: "r3",
      userId: "user3",
      message: "Pay rent",
      createdAt: "2025-01-01T00:00:00.000Z",
      scheduledAt: "2025-01-02T12:00:00.000Z",
    });

    await orchestrator.processReminder(
      reminder,
      makeMockAdapter("dm-ch"),
      makeMockReminderStore(),
    );
    assertEquals(captured.includes("Pay rent"), true);
    assertEquals(captured.includes("2025-01-01T00:00:00.000Z"), true);
    assertEquals(captured.includes("2025-01-02T12:00:00.000Z"), true);
    assertEquals(captured.includes("discord"), true);
    assertEquals(captured.includes("user3"), true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - disconnects and cleans up on error", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createReminderTestOrchestrator(tempDir);

    orchestrator.setConnectorSetup((connector) => {
      connector.prompt = () => Promise.reject(new Error("Boom"));
    });

    const reminder = makeReminder({ id: "r4", userId: "user4" });
    const res = await orchestrator.processReminder(
      reminder,
      makeMockAdapter("dm-ch"),
      makeMockReminderStore(),
    );
    assertEquals(res.success, false);
    assertExists(res.error);
    assertEquals(orchestrator.mockConnector?.disconnected, true);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - sets model from agent config", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, sessionRegistry, config } =
      await createReminderTestOrchestrator(tempDir);
    config.agent.model = "gpt-5-mini";

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = () => {
        const replyHandler = skillRegistry.getReplyHandler();
        const key = "discord/user5:dm-ch";
        (replyHandler as unknown as { replySentMap: Map<string, boolean> }).replySentMap.set(
          key,
          true,
        );
      };
    });

    const reminder = makeReminder({ id: "r5", userId: "user5" });
    await orchestrator.processReminder(
      reminder,
      makeMockAdapter("dm-ch"),
      makeMockReminderStore(),
    );
    assertEquals(orchestrator.mockConnector!.lastModelId, "gpt-5-mini");

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - returns failure when agent does not send reply", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry } = await createReminderTestOrchestrator(tempDir);

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));
    const reminder = makeReminder({ id: "r6", userId: "user6" });

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      // Don't simulate reply — agent finishes without calling send-reply
    });

    const res = await orchestrator.processReminder(
      reminder,
      makeMockAdapter("dm-ch"),
      reminderStore,
    );
    assertEquals(res.success, false);
    assertEquals(res.replySent, false);
    // Reminder should NOT be cancelled — delivery failed, will retry
    assertEquals(cancelledIds.length, 0);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
