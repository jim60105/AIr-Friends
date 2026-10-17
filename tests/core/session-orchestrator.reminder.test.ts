import { assertEquals, assertExists } from "@std/assert";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import type { AgentConnector, AgentProcessEvidence } from "../../src/acp/agent-connector.ts";
import type { ChannelConfig, Config } from "../../src/types/config.ts";
import type { ResolvedReminder } from "../../src/types/reminder.ts";
import type { ReminderStore } from "@core/reminder-store.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";
import { resolve } from "@std/path";

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
  onPrompt?: (callCount: number) => void;

  constructor(_options: AgentConnectorOptions) {}
  /** Producer-teardown evidence; no wrapper is ever spawned by this stub. */
  processEvidence: AgentProcessEvidence = { generations: 0, pid: undefined };
  getProcessEvidence(): AgentProcessEvidence {
    return this.processEvidence;
  }
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
      defaultAgentType: "opencode",
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: tempDir, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    accessControl: { replyTo: "whitelist", whitelist: [] },
    skillApi: {
      enabled: true,
      port: 3997,
      host: "127.0.0.1",
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
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(memoryStore);

  await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_reply.md`,
    "You are a helper.\n{{ if sessionId }}\nSession: {{ sessionId }}\n{{ /if }}\n" +
      "Skill root: {{ skillsDir }}",
  );
  await Deno.writeTextFile(
    `${tempDir}/prompts/system_reminder.md`,
    "Reminder: {{ reminderMessage }}\nCreated: {{ reminderCreatedAt }}\nScheduled: {{ reminderScheduledAt }}\nPlatform: {{ platform }}\nUser: {{ userId }}\nChannel: {{ channelId }}\n" +
      "Skill root: {{ skillsDir }}",
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

// ---------------------------------------------------------------------------
// Row 23: restart-safe, thread-preserving scheduled EMAIL reminders
// ---------------------------------------------------------------------------

const EMAIL_OWNER = `e_${"ab".repeat(32)}`;
const EMAIL_THREAD = "11111111-1111-4111-8111-111111111111";
const EMAIL_CHANNEL = `mail:${EMAIL_OWNER}:${EMAIL_THREAD}`;
const EMAIL_ANCHOR = "22222222-2222-4222-8222-222222222222";
const REMINDER_SLOT = "reminder:re1";

/**
 * Email adapter double: allocation of a NEW thread is an immediate failure, and
 * the owner-thread recent history reports the anchor the reminder stored
 * (`recentIds`, empty for an unusable anchor).
 */
function makeEmailAdapter(options: { recentIds?: string[] } = {}): PlatformAdapter {
  const recentIds = options.recentIds ?? [EMAIL_ANCHOR];
  return {
    platform: "email",
    getDmChannelId: () =>
      Promise.reject(new Error("email reminder must not allocate a new thread")),
    fetchRecentMessages: () => Promise.resolve(recentIds.map((id) => ({ messageId: id }))),
    sendReply: () => Promise.resolve({ success: false, error: "not used" }),
  } as unknown as PlatformAdapter;
}

function makeEmailReminder(overrides: Partial<ResolvedReminder> = {}): ResolvedReminder {
  return makeReminder({
    id: "re1",
    platform: "email",
    userId: EMAIL_OWNER,
    origin: { channelId: EMAIL_CHANNEL, replyAnchorRecordId: EMAIL_ANCHOR },
    ...overrides,
  });
}

function enableEmailAccount(config: Config, enabled = true): void {
  config.channels = [{ id: `email/account/${EMAIL_OWNER}`, enabled }];
}

/** Test seam: the delivered-reply state the Skill API would set after a send. */
type ReplyStateAccess = { replySentMap: Map<string, boolean> };

Deno.test("processReminder - email reminder delivers into its persisted thread and operation", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createReminderTestOrchestrator(
      tempDir,
    );
    enableEmailAccount(config);

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));
    let boundSessionId: string | null = null;

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = () => {
        const session = sessionRegistry.getAll()[0];
        assertEquals(session.channelId, EMAIL_CHANNEL);
        assertEquals(session.emailWorkId, undefined);
        assertEquals(session.emailReminder?.reminderId, "re1");
        assertEquals(session.emailReminder?.origin.channelId, EMAIL_CHANNEL);
        assertEquals(session.emailReminder?.origin.replyAnchorRecordId, EMAIL_ANCHOR);
        // No destination grant is ever carried into a reminder session.
        assertEquals(session.emailDestinationGrants, undefined);
        boundSessionId = session.id;
        // The Skill API records the confirmed submission of the reminder's OWN
        // operation; the reminder is delivered from that evidence alone.
        sessionRegistry.recordEmailSubmission(session.id, {
          operationId: "op_reminder_1",
          phase: "submitted",
          targetKind: "user",
        }, REMINDER_SLOT);
      };
    });

    const res = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter(),
      reminderStore,
    );

    assertEquals(res.success, true);
    assertEquals(res.emailSubmitted, true);
    assertExists(boundSessionId);
    assertEquals(cancelledIds, ["re1"]);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - a foreign reply on the same thread never delivers the email reminder", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, sessionRegistry, config } =
      await createReminderTestOrchestrator(tempDir);
    enableEmailAccount(config);

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));
    // Another session already sent a reply into this same owner thread.
    skillRegistry.getReplyHandler().clearReplyState(`email/${EMAIL_OWNER}`, EMAIL_CHANNEL);
    // Test seam: ReplyHandler keeps its delivered state in a private map.
    const replyState = skillRegistry.getReplyHandler() as unknown as ReplyStateAccess;
    replyState.replySentMap.set(`email/${EMAIL_OWNER}:${EMAIL_CHANNEL}`, true);

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      // The reminder itself submits nothing.
    });

    const res = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter(),
      reminderStore,
    );

    assertEquals(res.success, false);
    assertEquals(res.replySent, false);
    assertEquals(cancelledIds.length, 0);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - missing email origin is review-required with no session", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createReminderTestOrchestrator(
      tempDir,
    );
    enableEmailAccount(config);

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));

    const res = await orchestrator.processReminder(
      makeEmailReminder({ origin: undefined }),
      makeEmailAdapter(),
      reminderStore,
    );

    assertEquals(res.success, false);
    assertEquals(cancelledIds, ["re1"]);
    assertEquals(orchestrator.mockConnector, null);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - a corrupt email origin never gets a guessed thread", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createReminderTestOrchestrator(
      tempDir,
    );
    enableEmailAccount(config);
    const reminderStore = makeMockReminderStore();

    // Another owner's thread, and a valid-shaped anchor the adapter can never
    // thread to (outside its owner-thread window): both are review-required,
    // and neither reaches a session.
    const foreign = makeEmailReminder({
      origin: {
        channelId: `mail:e_${"cd".repeat(32)}:${EMAIL_THREAD}`,
        replyAnchorRecordId: EMAIL_ANCHOR,
      },
    });
    let res = await orchestrator.processReminder(foreign, makeEmailAdapter(), reminderStore);
    assertEquals(res.success, false);
    assertEquals(orchestrator.mockConnector, null);

    res = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter({ recentIds: [] }),
      reminderStore,
    );
    assertEquals(res.success, false);
    assertEquals(orchestrator.mockConnector, null);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - a disabled or removed email account prevents reminder delivery", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createReminderTestOrchestrator(
      tempDir,
    );

    // Disabled entry, then the entry removed entirely: neither ever sends.
    const cases: ChannelConfig[][] = [
      [{ id: `email/account/${EMAIL_OWNER}`, enabled: false }],
      [],
    ];
    for (const channels of cases) {
      config.channels = channels;
      const cancelledIds: string[] = [];
      const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));

      const res = await orchestrator.processReminder(
        makeEmailReminder(),
        makeEmailAdapter(),
        reminderStore,
      );

      assertEquals(res.success, false);
      assertEquals(cancelledIds, ["re1"]);
      assertEquals(orchestrator.mockConnector, null);
    }

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - a submitted reminder operation is not resubmitted after a failed patch", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createReminderTestOrchestrator(
      tempDir,
    );
    enableEmailAccount(config);
    // The durable journal records the reminder's own operation as submitted —
    // exactly the state left behind when disabling the reminder record failed.
    orchestrator.setEmailSubmissionEvidence({
      lookup: (_owner, key) =>
        key.actionSlot === REMINDER_SLOT
          ? {
            operationId: "op_reminder_1",
            phase: "submitted",
            targetKind: "user",
            reused: false,
          }
          : undefined,
    });

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));

    const res = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter(),
      reminderStore,
    );

    assertEquals(res.success, true);
    assertEquals(res.emailSubmitted, true);
    assertEquals(cancelledIds, ["re1"]);
    // No session was started for the already-submitted operation.
    assertEquals(orchestrator.mockConnector, null);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - an unresolved reminder operation is review-required, never replayed", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createReminderTestOrchestrator(
      tempDir,
    );
    enableEmailAccount(config);
    orchestrator.setEmailSubmissionEvidence({
      lookup: (_owner, key) =>
        key.actionSlot === REMINDER_SLOT
          ? { operationId: "op_reminder_1", phase: "unknown", reused: false }
          : undefined,
    });

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));

    const res = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter(),
      reminderStore,
    );

    assertEquals(res.success, false);
    assertEquals(res.emailUnknown, true);
    assertEquals(cancelledIds, ["re1"]);
    assertEquals(orchestrator.mockConnector, null);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - Discord reminder behavior is unchanged by the email path", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, skillRegistry, sessionRegistry } = await createReminderTestOrchestrator(
      tempDir,
    );

    const cancelledIds: string[] = [];
    const reminderStore = makeMockReminderStore((id) => cancelledIds.push(id));
    const reminder = makeReminder({ id: "r_discord", userId: "userD" });

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = () => {
        // Test seam: ReplyHandler keeps its delivered state in a private map.
        const replyState = skillRegistry.getReplyHandler() as unknown as ReplyStateAccess;
        replyState.replySentMap.set("discord/userD:dm-ch", true);
      };
    });

    const res = await orchestrator.processReminder(
      reminder,
      makeMockAdapter("dm-ch"),
      reminderStore,
    );

    assertEquals(res.success, true);
    assertEquals(res.replySent, true);
    assertEquals(cancelledIds, ["r_discord"]);
    assertEquals(sessionRegistry.getAll().length, 0);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

/** A reminder store whose completion write always fails (data/reminders.jsonl). */
function makeFailingReminderStore(): ReminderStore {
  return {
    cancelReminder: () => {
      throw new Error("simulated reminder patch failure");
    },
  } as unknown as ReminderStore;
}

Deno.test("processReminder - a failed reminder patch never resends a submitted email reminder", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createReminderTestOrchestrator(
      tempDir,
    );
    enableEmailAccount(config);
    const patchFailure = makeFailingReminderStore();

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = () => {
        sessionRegistry.recordEmailSubmission(sessionRegistry.getAll()[0].id, {
          operationId: "op_reminder_1",
          phase: "submitted",
          targetKind: "user",
        }, REMINDER_SLOT);
      };
    });

    // SMTP acceptance followed by a failed completion write: the verdict is
    // preserved and the run is still reported as delivered.
    const first = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter(),
      patchFailure,
    );
    assertEquals(first.success, true);
    assertEquals(first.emailSubmitted, true);

    // The next scheduler tick consults the STABLE operation: no session starts,
    // nothing is sent again, and the reminder is disabled again (still failing,
    // still without rewriting the verdict).
    orchestrator.mockConnector = null;
    orchestrator.setEmailSubmissionEvidence({
      lookup: (_owner, key) =>
        key.actionSlot === REMINDER_SLOT
          ? {
            operationId: "op_reminder_1",
            phase: "submitted",
            targetKind: "user",
            reused: false,
          }
          : undefined,
    });
    const second = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter(),
      patchFailure,
    );
    assertEquals(second.success, true);
    assertEquals(second.emailSubmitted, true);
    assertEquals(orchestrator.mockConnector, null);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processReminder - a failed reminder patch never replays an unresolved email reminder", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const { orchestrator, sessionRegistry, config } = await createReminderTestOrchestrator(
      tempDir,
    );
    enableEmailAccount(config);
    const patchFailure = makeFailingReminderStore();
    const cancelledIds: string[] = [];

    orchestrator.setConnectorSetup((connector) => {
      connector.promptResponses = [{ stopReason: "end_turn" } as PromptResponse];
      connector.onPrompt = () => {
        sessionRegistry.recordEmailSubmission(sessionRegistry.getAll()[0].id, {
          operationId: "op_reminder_u",
          phase: "unknown",
        }, REMINDER_SLOT);
      };
    });

    const first = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter(),
      patchFailure,
    );
    assertEquals(first.success, false);
    assertEquals(first.emailUnknown, true);
    assertEquals(cancelledIds.length, 0);

    // With the durable unresolved record available, the next tick performs no
    // session and nothing is sent; the failed disable only logs.
    orchestrator.mockConnector = null;
    orchestrator.setEmailSubmissionEvidence({
      lookup: (_owner, key) =>
        key.actionSlot === REMINDER_SLOT
          ? { operationId: "op_reminder_u", phase: "unknown", reused: false }
          : undefined,
    });
    const second = await orchestrator.processReminder(
      makeEmailReminder(),
      makeEmailAdapter(),
      makeFailingReminderStore(),
    );
    assertEquals(second.emailUnknown, true);
    assertEquals(second.success, false);
    assertEquals(orchestrator.mockConnector, null);

    sessionRegistry.stop();
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
