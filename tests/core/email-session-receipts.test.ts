// tests/core/email-session-receipts.test.ts
//
// Regression tests for `email-session-receipts` (row 14): durable email work
// receipts across the AgentCore/orchestrator session lifecycle.
//
// They exercise the real `MailboxStore` journal on disk and prove the two delta
// requirements:
//   * Durable agent-start fence — `started` is fsynced with the hand-off workId
//     BEFORE the agent acts, work waiting for the execution lease stays
//     unstarted/requeueable, and an uncertain started outcome becomes
//     review-required instead of being replayed.
//   * Explicit receive completion — completion depends on explicit lifecycle
//     evidence plus a side-effect settler, never on a swallowed handler error.
// Discord/Misskey lifecycles are covered by the no-regression case.
//
// Exercised layers (recorded separately from model/production evidence): the
// REAL `MailboxStore` journal on disk, the real `SessionOrchestrator` session
// lifecycle, the real `SessionRegistry` and the real shared ACP process pool
// with an injected connector stub. No real IMAP/SMTP transport, no model call
// and no production credential is involved in this boundary: the adapter that
// would supply one is successor row 15.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";
import { AgentCore } from "@core/agent-core.ts";
import { AgentProcessPool } from "@core/agent-process-pool.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { AgentConnector, AgentProcessEvidence } from "../../src/acp/agent-connector.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import { readJournal } from "../../src/platforms/email/durable-files.ts";
import {
  buildMailboxFingerprint,
  type MailboxEntryRecord,
  type MailboxKey,
  MailboxStore,
  MailboxStoreError,
  PROCESSING_JOURNAL_FILENAME,
} from "../../src/platforms/email/mailbox-store.ts";
import { EmailSessionReceipts } from "../../src/platforms/email/session-receipts.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { Config } from "../../src/types/config.ts";
import {
  type EmailWorkReceipt,
  emailWorkReceiptOf,
  isEmailWorkReceipt,
  type NormalizedEvent,
  type PlatformMessage,
} from "../../src/types/events.ts";
import type { PlatformCapabilities, ReplyResult } from "../../src/types/platform.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

/** The ONE deployment-resolved skill-script root (mirrors the sibling fixtures). */
const RESOLVED_SKILLS_ROOT = Deno.realPathSync(
  resolve(import.meta.dirname ?? ".", "../../skills"),
);

const FINGERPRINT = buildMailboxFingerprint("imap.example.com", "bot@example.com", "INBOX");
const UIDVALIDITY = 987654321;
const UID = 42;
const OWNER = "e_0123456789abcdef";
const RECORD_ID = "rec_0123456789abcdef";
const WORK_ID = "11111111-2222-3333-4444-555555555555";
const MAILBOX_KEY: MailboxKey = { fingerprint: FINGERPRINT, uidValidity: UIDVALIDITY, uid: UID };

function emailReceipt(workId = WORK_ID, key: MailboxKey = MAILBOX_KEY): EmailWorkReceipt {
  return {
    kind: "email-work",
    workId,
    mailboxKey: {
      fingerprint: key.fingerprint,
      uidValidity: key.uidValidity,
      uid: key.uid,
    },
    recordId: RECORD_ID,
  };
}

// --- Mailbox journal observation -------------------------------------------------

async function journalRecords(root: string): Promise<MailboxEntryRecord[]> {
  const result = await readJournal<MailboxEntryRecord>(root, PROCESSING_JOURNAL_FILENAME, {
    allowMissing: true,
  });
  assertEquals(result.status, "clean");
  return result.records;
}

/** Journal states recorded for one workId, in durable order. */
async function statesFor(root: string, workId: string): Promise<string[]> {
  const records = await journalRecords(root);
  return records.filter((record) => record.workId === workId).map((record) => record.state);
}

/**
 * Bounded condition wait. Every real-timer poll here is short (10 ms) and exits
 * as soon as the awaited durable/lifecycle state is observable, so no fixed
 * duration is assumed and no sleep is paid once the condition holds.
 */
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// --- Connector / adapter / orchestrator fixtures ---------------------------------

interface PromptCall {
  channelId: string;
  callIndex: number;
}

/** Prompt script: returns the response, or throws to model an agent failure. */
type PromptScript = (call: PromptCall) => Promise<PromptResponse>;
type ScriptHolder = { current: PromptScript };

class ScriptedConnector {
  connected = false;
  disconnected = false;
  promptCallCount = 0;
  readonly channelId: string;
  processEvidence: AgentProcessEvidence = { generations: 0, pid: undefined };
  private readonly script: ScriptHolder;

  constructor(options: AgentConnectorOptions, script: ScriptHolder) {
    this.channelId = options.clientConfig?.channelId ?? "";
    this.script = script;
  }

  get isConnected(): boolean {
    return this.connected && !this.disconnected;
  }
  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }
  /** No real subprocess: the pool skips the child-process drain. */
  getProcessPid(): number | undefined {
    return undefined;
  }
  supportsImageContent(): boolean {
    return false;
  }
  createSession(): Promise<string> {
    return Promise.resolve(`scripted-${this.channelId}`);
  }
  setSessionModel(): Promise<void> {
    return Promise.resolve();
  }
  setSessionMode(): Promise<void> {
    return Promise.resolve();
  }
  setReasoningEffort(): Promise<string> {
    return Promise.resolve("applied");
  }
  setSessionGateContext(): void {}
  /** No ACP client: the retry-prompt rejection snapshot reads an empty list. */
  getClient(): null {
    return null;
  }
  prompt(): Promise<PromptResponse> {
    const call: PromptCall = { channelId: this.channelId, callIndex: this.promptCallCount++ };
    return this.script.current(call);
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.disconnected = true;
    return Promise.resolve();
  }
  getProcessEvidence(): AgentProcessEvidence {
    return this.processEvidence;
  }
}

class TestableSessionOrchestrator extends SessionOrchestrator {
  script: ScriptHolder = {
    current: () => Promise.resolve({ stopReason: "end_turn" } as PromptResponse),
  };
  connectorInstances: ScriptedConnector[] = [];
  protected override createConnector(options: AgentConnectorOptions): AgentConnector {
    const connector = new ScriptedConnector(options, this.script);
    this.connectorInstances.push(connector);
    return connector as unknown as AgentConnector;
  }
}

class MockEmailPlatformAdapter {
  platform = "email" as const;
  sentReplies: { channelId: string; content: string }[] = [];
  /** When set, `sendReply` rejects to model an uncertain delivery outcome. */
  failReplies = false;
  capabilities: PlatformCapabilities = {
    canFetchHistory: true,
    canSearchMessages: false,
    supportsDm: true,
    supportsGuild: false,
    supportsReactions: false,
    maxMessageLength: 20000,
  };

  sendReply(channelId: string, content: string): Promise<ReplyResult> {
    if (this.failReplies) {
      return Promise.reject(new Error("mock delivery failed after invocation"));
    }
    this.sentReplies.push({ channelId, content });
    return Promise.resolve({ success: true, messageId: `mock_${this.sentReplies.length}` });
  }
  fetchRecentMessages(): Promise<PlatformMessage[]> {
    return Promise.resolve([]);
  }
  getUsername(userId: string): Promise<string> {
    return Promise.resolve(`user_${userId}`);
  }
  isSelf(userId: string): boolean {
    return userId === "bot";
  }
  onEvent(): void {}
  offEvent(): void {}
  supportsTypingIndicator(): boolean {
    return false;
  }
  sendTyping(): Promise<void> {
    return Promise.resolve();
  }
  hasBotMention(): Promise<boolean> {
    return Promise.resolve(false);
  }
  hasBotReaction(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

async function createPrompts(dir: string): Promise<void> {
  await Deno.mkdir(join(dir, "prompts"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "prompts", "system_reply.md"),
    "You are a helper.\nSkill root: {{ skillsDir }}\n" +
      "{{ if sessionId }}Session: {{ sessionId }}{{ /if }}",
  );
}

function createConfig(root: string, options: { pooled: boolean; dryRun: boolean }): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test", token: "t", enabled: false },
      email: { enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: join(root, "prompts", "system_reply.md"),
      tokenLimit: 20000,
      defaultAgentType: "opencode",
      opencodeApiKey: "test-opencode-key",
      dryRun: {
        enabled: options.dryRun,
        outputPath: join(root, "dry-run"),
        mockReply: "MOCK REPLY",
      },
      sharedProcess: {
        enabled: options.pooled,
        jwtDir: join(root, "jwt"),
        queueDeadlineMs: 60_000,
        reclaimIdleMs: 60_000,
      },
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: root, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: [],
    conversationSummary: { enabled: false },
  } as unknown as Config;
}

interface HarnessOptions {
  pooled?: boolean;
  dryRun?: boolean;
  script?: PromptScript;
}

interface Harness {
  root: string;
  store: MailboxStore;
  receipts: EmailSessionReceipts;
  orchestrator: TestableSessionOrchestrator;
  skillRegistry: SkillRegistry;
  sessionRegistry: SessionRegistry;
  workspaceManager: WorkspaceManager;
  adapter: MockEmailPlatformAdapter;
  pool: AgentProcessPool | null;
  /** Swaps the prompt script for connectors created after this call. */
  setScript(script: PromptScript): void;
  /** Discovers + accepts the key so it is a valid work target. */
  accept(key: MailboxKey, recordId: string): Promise<void>;
  dispose(): Promise<void>;
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await Deno.makeTempDir({ prefix: "email-session-receipts-test-" });
  await createPrompts(root);
  const pooled = options.pooled ?? false;
  const config = createConfig(root, { pooled, dryRun: options.dryRun ?? false });

  const store = new MailboxStore({ emailRoot: root, fingerprint: FINGERPRINT });
  await store.initialize(0, UIDVALIDITY);
  const receipts = new EmailSessionReceipts(store);

  const workspaceManager = new WorkspaceManager(config.workspace);
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(memoryStore);
  const sessionRegistry = new SessionRegistry();
  const contextAssembler = new ContextAssembler(memoryStore, {
    systemPromptPath: config.agent.systemPromptPath,
    skillsDir: RESOLVED_SKILLS_ROOT,
    recentMessageLimit: 20,
    tokenLimit: 20000,
  });

  // ONE shared script holder: `setScript` swaps it for both the pooled
  // connector factory and the per-spawn `createConnector` override.
  const script: ScriptHolder = options.script
    ? { current: options.script }
    : { current: () => Promise.resolve({ stopReason: "end_turn" } as PromptResponse) };
  const pool: AgentProcessPool | null = pooled
    ? new AgentProcessPool(
      config,
      sessionRegistry,
      "offline-secret-0123456789abcdef",
      (connectorOptions) =>
        new ScriptedConnector(connectorOptions, script) as unknown as AgentConnector,
    )
    : null;
  const orchestrator = new TestableSessionOrchestrator(
    workspaceManager,
    contextAssembler,
    skillRegistry,
    config,
    sessionRegistry,
    memoryStore,
    false,
    undefined,
    "",
    pool,
  );
  orchestrator.script = script;
  orchestrator.setEmailSessionReceipts(receipts);

  return {
    root,
    store,
    receipts,
    orchestrator,
    skillRegistry,
    sessionRegistry,
    workspaceManager,
    adapter: new MockEmailPlatformAdapter(),
    pool,
    setScript: (script) => {
      // Mutate the ONE shared holder: the pooled connector factory closed over
      // this object, so replacing it would leave pooled sessions unscripted.
      orchestrator.script.current = script;
    },
    accept: async (key, recordId) => {
      await store.discover(key);
      await store.accept(key, recordId);
    },
    dispose: async () => {
      if (pool) {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && !pool.isIdle()) {
          await new Promise((r) => setTimeout(r, 10));
        }
        pool.stop();
      }
      sessionRegistry.stop();
      await Deno.remove(root, { recursive: true }).catch(() => {});
    },
  };
}

function emailEvent(receipt?: EmailWorkReceipt, content = "Hello bot!"): NormalizedEvent {
  return {
    platform: "email",
    channelId: `email/account/${OWNER}`,
    userId: OWNER,
    messageId: "msg-1",
    isDm: true,
    guildId: "",
    content,
    timestamp: new Date(),
    ...(receipt ? { emailWork: receipt } : {}),
  };
}

function discordEvent(channelId = "discord-channel"): NormalizedEvent {
  return {
    platform: "discord",
    channelId,
    userId: "discord-user",
    messageId: "msg-d",
    isDm: false,
    guildId: "guild",
    content: "Hello bot!",
    timestamp: new Date(),
  };
}

// --- Tests -----------------------------------------------------------------------

Deno.test("Email work is fenced with a durable started receipt before the first prompt", async () => {
  const harness = await createHarness();
  const observed: string[][] = [];
  const propagatedWorkIds: (string | undefined)[] = [];
  harness.setScript(async ({ channelId }) => {
    // The agent must never see unfenced work: read the durable journal from
    // inside the prompt call itself, together with the session's propagated
    // work id (the registry entry is gone once the session ends).
    observed.push(await statesFor(harness.root, WORK_ID));
    propagatedWorkIds.push(
      harness.sessionRegistry.getAll().find((s) => s.channelId === channelId)?.emailWorkId,
    );
    return { stopReason: "end_turn" } as PromptResponse;
  });
  try {
    await harness.accept(MAILBOX_KEY, RECORD_ID);

    const response = await harness.orchestrator.processMessage(
      emailEvent(emailReceipt()),
      harness.adapter as unknown as PlatformAdapter,
    );

    assert(observed.length > 0, "the scripted connector prompt must have run");
    for (const statesAtPrompt of observed) {
      assertEquals(statesAtPrompt, ["started"], "started must precede the prompt");
    }
    // The turn ended with no delivery: a definitive no-side-effect failure.
    assertEquals(await statesFor(harness.root, WORK_ID), ["started", "failed"]);
    assertEquals(response.success, false);

    // Row 14 propagates the workId into the session registry for handlers.
    assert(propagatedWorkIds.length > 0);
    for (const workId of propagatedWorkIds) assertEquals(workId, WORK_ID);
  } finally {
    await harness.dispose();
  }
});

Deno.test("Completed is recorded only after the session's in-flight side effects settle", async () => {
  const harness = await createHarness();
  let finalizingSession: { recoveryFenced?: boolean; inflightSideEffects?: number } | null = null;
  harness.setScript(async ({ channelId }) => {
    const session = harness.sessionRegistry.getAll().find((s) => s.channelId === channelId);
    assert(session, "the session must be registered while its prompt runs");
    // A delivered reply plus an effect still in flight (as the Skill API server
    // counts side-effect calls).
    const reply = await harness.skillRegistry.getReplyHandler().handleSendReply(
      { message: "delivered reply" },
      {
        workspace: {
          key: harness.workspaceManager.getWorkspaceKeyFromEvent(emailEvent()),
          components: { platform: "email", userId: OWNER },
        },
        channelId,
        userId: OWNER,
        platformAdapter: harness.adapter,
      } as unknown as SkillContext,
    );
    assertEquals(reply.success, true);
    session.inflightSideEffects = 1;
    finalizingSession = session;
    return { stopReason: "end_turn" } as PromptResponse;
  });
  try {
    await harness.accept(MAILBOX_KEY, RECORD_ID);

    let resolved = false;
    const run = harness.orchestrator
      .processMessage(emailEvent(emailReceipt()), harness.adapter as unknown as PlatformAdapter)
      .then((response) => {
        resolved = true;
        return response;
      });

    // Wait until the receipt finalizer closed admission and is settling.
    await waitUntil(() => finalizingSession?.recoveryFenced === true, "the settle fence");
    assertEquals(
      await statesFor(harness.root, WORK_ID),
      ["started"],
      "no terminal receipt while an email side effect is in flight",
    );
    assertEquals(resolved, false, "the session may not resolve before settlement");

    // Settle the effect: only now may the durable completion be written.
    finalizingSession!.inflightSideEffects = 0;
    const response = await run;

    assertEquals(response.success, true);
    assertEquals(await statesFor(harness.root, WORK_ID), ["started", "completed"]);
  } finally {
    await harness.dispose();
  }
});

Deno.test("Queued email work stays unstarted until the execution lease is acquired", async () => {
  const releaseHolder = Promise.withResolvers<void>();
  const order: string[] = [];

  const harness = await createHarness({ pooled: true });
  harness.setScript(async ({ channelId, callIndex }) => {
    if (channelId === "discord-channel") {
      if (callIndex === 0) {
        order.push("holder-prompt-start");
        await releaseHolder.promise;
        order.push("holder-prompt-end");
      }
      return { stopReason: "end_turn" } as PromptResponse;
    }
    order.push("email-prompt");
    assertEquals(
      await statesFor(harness.root, WORK_ID),
      ["started"],
      "the email fence must be durable before its prompt",
    );
    return { stopReason: "end_turn" } as PromptResponse;
  });
  try {
    await harness.accept(MAILBOX_KEY, RECORD_ID);

    const adapter = harness.adapter as unknown as PlatformAdapter;
    const holder = harness.orchestrator.processMessage(discordEvent(), adapter);
    await waitUntil(() => order.includes("holder-prompt-start"), "the holder to hold the lease");

    // The email work is accepted and queued behind the held lease.
    const emailRun = harness.orchestrator.processMessage(emailEvent(emailReceipt()), adapter);
    assertEquals(
      await statesFor(harness.root, WORK_ID),
      [],
      "work waiting for the execution lease must stay unstarted",
    );
    assertEquals(order, ["holder-prompt-start"]);

    releaseHolder.resolve();
    await holder;
    const response = await emailRun;

    assertEquals(order.includes("email-prompt"), true);
    assertEquals(await statesFor(harness.root, WORK_ID), ["started", "failed"]);
    assertEquals(response.success, false);
  } finally {
    await harness.dispose();
  }
});

Deno.test("An agent failure after the fence records review-required, never completed", async () => {
  // Per-spawn: the agent prompt rejects out of the session lifecycle.
  const perSpawn = await createHarness({
    script: () => Promise.reject(new Error("agent transport failure")),
  });
  try {
    await perSpawn.accept(MAILBOX_KEY, RECORD_ID);
    const response = await perSpawn.orchestrator.processMessage(
      emailEvent(emailReceipt()),
      perSpawn.adapter as unknown as PlatformAdapter,
    );
    assertEquals(response.success, false);
    assertEquals(await statesFor(perSpawn.root, WORK_ID), ["started", "review-required"]);
  } finally {
    await perSpawn.dispose();
  }

  // Pooled: a runner failure surfaces to the orchestrator as a deadline
  // cancellation, which is equally uncertain once the fence was taken.
  const pooled = await createHarness({
    pooled: true,
    script: () => Promise.reject(new Error("pooled agent transport failure")),
  });
  try {
    await pooled.accept(MAILBOX_KEY, RECORD_ID);
    const response = await pooled.orchestrator.processMessage(
      emailEvent(emailReceipt()),
      pooled.adapter as unknown as PlatformAdapter,
    );
    assertEquals(response.success, false);
    const states = await statesFor(pooled.root, WORK_ID);
    assertEquals(states, ["started", "review-required"]);
    assertEquals(
      (await journalRecords(pooled.root)).some((record) => record.state === "completed"),
      false,
    );
  } finally {
    await pooled.dispose();
  }
});

Deno.test("Dry run fences started before the mock reply and completes afterwards", async () => {
  const harness = await createHarness({ dryRun: true });
  const statesBeforeMockReply: string[][] = [];
  const deliver = harness.adapter.sendReply.bind(harness.adapter);
  harness.adapter.sendReply = async (channelId: string, content: string) => {
    statesBeforeMockReply.push(await statesFor(harness.root, WORK_ID));
    return await deliver(channelId, content);
  };
  try {
    await harness.accept(MAILBOX_KEY, RECORD_ID);

    const response = await harness.orchestrator.processMessage(
      emailEvent(emailReceipt()),
      harness.adapter as unknown as PlatformAdapter,
    );

    assertEquals(statesBeforeMockReply, [["started"]], "started must precede the mock reply");
    assertEquals(await statesFor(harness.root, WORK_ID), ["started", "completed"]);
    assertEquals(response.success, true);
    assertEquals(response.replySent, true);
    assertEquals(
      harness.orchestrator.connectorInstances.length,
      0,
      "no agent is spawned in dry run",
    );
  } finally {
    await harness.dispose();
  }
});

Deno.test("A failed dry-run mock delivery is an uncertain outcome, not completed", async () => {
  const harness = await createHarness({ dryRun: true });
  try {
    harness.adapter.failReplies = true;
    await harness.accept(MAILBOX_KEY, RECORD_ID);

    const response = await harness.orchestrator.processMessage(
      emailEvent(emailReceipt()),
      harness.adapter as unknown as PlatformAdapter,
    );

    assertEquals(response.success, true, "existing dry-run response semantics are unchanged");
    assertEquals(await statesFor(harness.root, WORK_ID), ["started", "review-required"]);
  } finally {
    await harness.dispose();
  }
});

Deno.test("Control commands are recorded as terminally ignored admissions", async () => {
  const harness = await createHarness();
  try {
    await harness.accept(MAILBOX_KEY, RECORD_ID);

    const response = await harness.orchestrator.processMessage(
      emailEvent(emailReceipt(), "/clear"),
      harness.adapter as unknown as PlatformAdapter,
    );

    assertEquals(response.success, true);
    assertEquals(response.replySent, false);
    assertEquals(await statesFor(harness.root, WORK_ID), ["ignored"]);
    assertEquals(harness.orchestrator.connectorInstances.length, 0, "no agent runs for /clear");
  } finally {
    await harness.dispose();
  }
});

Deno.test("Receipt API honors the durable transition and settlement contract", async () => {
  const root = await Deno.makeTempDir({ prefix: "email-receipts-api-test-" });
  const store = new MailboxStore({ emailRoot: root, fingerprint: FINGERPRINT });
  const receipts = new EmailSessionReceipts(store);
  try {
    await store.initialize(0, UIDVALIDITY);
    await store.discover(MAILBOX_KEY);
    await store.accept(MAILBOX_KEY, RECORD_ID);

    // The fence is durable and single-shot: a duplicate hand-off cannot restart it.
    await receipts.beginEmailWork(emailReceipt());
    assertEquals(await statesFor(root, WORK_ID), ["started"]);
    await assertRejects(
      () => receipts.beginEmailWork(emailReceipt()),
      MailboxStoreError,
      "[INVALID_TRANSITION]",
    );

    // Completion awaits the settler before writing anything.
    const settlement = Promise.withResolvers<boolean>();
    const observedDuringSettle: string[][] = [];
    const completion = receipts.finishEmailWork(emailReceipt(), {
      outcome: "completed",
      detail: "session-completed",
      settle: async () => {
        observedDuringSettle.push(await statesFor(root, WORK_ID));
        return await settlement.promise;
      },
    });
    await waitUntil(() => observedDuringSettle.length > 0, "the settler");
    assertEquals(observedDuringSettle, [["started"]]);

    settlement.resolve(true);
    await completion;
    assertEquals(await statesFor(root, WORK_ID), ["started", "completed"]);

    // Idempotent duplicate completion stays a single durable record.
    await receipts.finishEmailWork(emailReceipt(), {
      outcome: "completed",
      settle: () => Promise.resolve(true),
    });
    assertEquals(await statesFor(root, WORK_ID), ["started", "completed"]);

    // A different workId cannot rewrite a terminal outcome: the duplicate
    // hand-off is refused and the durable records are unchanged.
    await assertRejects(
      () =>
        receipts.finishEmailWork(emailReceipt("99999999-0000-0000-0000-000000000000"), {
          outcome: "completed",
          settle: () => Promise.resolve(true),
        }),
      MailboxStoreError,
    );
    assertEquals(await statesFor(root, WORK_ID), ["started", "completed"]);

    // A terminal receipt carrying a different workId than the fenced one is an
    // immutable-identity mismatch.
    const mismatchKey: MailboxKey = { ...MAILBOX_KEY, uid: UID + 2 };
    const mismatchWorkId = "66666666-2222-3333-4444-555555555555";
    await store.discover(mismatchKey);
    await store.accept(mismatchKey, `${RECORD_ID}-mismatch`);
    await receipts.beginEmailWork(emailReceipt(mismatchWorkId, mismatchKey));
    await assertRejects(
      () =>
        receipts.requireReview(
          emailReceipt("77777777-2222-3333-4444-555555555555", mismatchKey),
          "session-outcome-uncertain",
        ),
      MailboxStoreError,
      "[IMMUTABLE_ID_MISMATCH]",
    );
    assertEquals(await statesFor(root, mismatchWorkId), ["started"]);

    // An unconfirmed settlement is never recorded as completed.
    const secondKey: MailboxKey = { ...MAILBOX_KEY, uid: UID + 1 };
    const secondWorkId = "22222222-2222-3333-4444-555555555555";
    await store.discover(secondKey);
    await store.accept(secondKey, `${RECORD_ID}-b`);
    const unconfirmed = emailReceipt(secondWorkId, secondKey);
    await receipts.beginEmailWork(unconfirmed);
    await receipts.finishEmailWork(unconfirmed, {
      outcome: "completed",
      settle: () => Promise.resolve(false),
    });
    assertEquals(await statesFor(root, secondWorkId), ["started", "review-required"]);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("A completion without settlement proof is refused and denials are ignored", async () => {
  const root = await Deno.makeTempDir({ prefix: "email-receipts-deny-test-" });
  const store = new MailboxStore({ emailRoot: root, fingerprint: FINGERPRINT });
  const receipts = new EmailSessionReceipts(store);
  try {
    await store.initialize(0, UIDVALIDITY);
    await store.discover(MAILBOX_KEY);
    await store.accept(MAILBOX_KEY, RECORD_ID);

    await receipts.beginEmailWork(emailReceipt());
    await assertRejects(
      () =>
        receipts.finishEmailWork(
          emailReceipt(),
          { outcome: "completed" } as unknown as Parameters<
            EmailSessionReceipts["finishEmailWork"]
          >[1],
        ),
      Error,
      "requires a side-effect settler",
    );
    assertEquals(await statesFor(root, WORK_ID), ["started"]);
    assertEquals(
      await receipts.requireReview(emailReceipt(), "session-outcome-uncertain"),
      undefined,
    );
    assertEquals(await statesFor(root, WORK_ID), ["started", "review-required"]);

    // A second, never-executed entry is terminally ignored by a denied admission.
    const deniedKey: MailboxKey = { ...MAILBOX_KEY, uid: UID + 1 };
    const deniedWorkId = "55555555-2222-3333-4444-555555555555";
    await store.discover(deniedKey);
    await store.accept(deniedKey, `${RECORD_ID}-denied`);
    await receipts.denyAdmission(emailReceipt(deniedWorkId, deniedKey), "access-policy-denied");
    assertEquals(await statesFor(root, deniedWorkId), ["ignored"]);
    assertEquals(store.getEntry(deniedKey)?.state, "ignored");
    assertEquals(store.getEntry(deniedKey)?.detail, "access-policy-denied");
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("Crash semantics: unstarted work resumes; started work without a terminal needs review", async () => {
  const root = await Deno.makeTempDir({ prefix: "email-receipts-crash-test-" });
  try {
    const resumableKey: MailboxKey = { ...MAILBOX_KEY, uid: UID + 1 };
    const startedKey: MailboxKey = { ...MAILBOX_KEY, uid: UID + 2 };
    const startedWorkId = "33333333-2222-3333-4444-555555555555";

    const before = new MailboxStore({ emailRoot: root, fingerprint: FINGERPRINT });
    const receipts = new EmailSessionReceipts(before);
    await before.initialize(0, UIDVALIDITY);
    await before.discover(resumableKey);
    await before.accept(resumableKey, `${RECORD_ID}-resumable`);
    await before.discover(startedKey);
    await before.accept(startedKey, `${RECORD_ID}-started`);
    // The started work is fenced, then the process dies before any terminal
    // receipt: exactly the queue-crash uncertainty the delta describes.
    await receipts.beginEmailWork(emailReceipt(startedWorkId, startedKey));

    // Restart: a fresh store recovers the durable evidence.
    const restarted = new MailboxStore({ emailRoot: root, fingerprint: FINGERPRINT });
    const recovery = await restarted.recover();

    assertEquals(
      recovery.unstarted.map((entry) => entry.key.uid),
      [resumableKey.uid],
      "accepted-but-unstarted work resumes after a crash",
    );
    assertEquals(restarted.getEntry(resumableKey)?.state, "accepted");

    assertEquals(
      recovery.reviewRequired.map((entry) => entry.key.uid),
      [startedKey.uid],
      "started work without terminal evidence requires review",
    );
    assertEquals(restarted.getEntry(startedKey)?.state, "review-required");
    assertEquals(restarted.getEntry(startedKey)?.workId, startedWorkId);
    assertStringIncludes(
      restarted.getEntry(startedKey)?.detail ?? "",
      "started work without terminal outcome",
    );

    // Mere emission is never completion: no completed record exists anywhere.
    const states = (await journalRecords(root)).map((record) => record.state);
    assertEquals(states.includes("completed"), false);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("Discord/Misskey events never write mailbox receipts", async () => {
  const harness = await createHarness();
  try {
    const response = await harness.orchestrator.processMessage(
      discordEvent(),
      harness.adapter as unknown as PlatformAdapter,
    );

    assertEquals(response.success, false, "non-email lifecycle is unchanged");
    assertEquals(await journalRecords(harness.root), [], "no receipt records for Discord");
    for (const session of harness.sessionRegistry.getAll()) {
      assertEquals(session.emailWorkId, undefined);
    }

    // The receipt predicate enforces BOTH discriminators: a non-email event
    // carrying valid-shaped metadata is not receipt-bearing work.
    const forged: NormalizedEvent = {
      ...discordEvent("discord-forged"),
      emailWork: emailReceipt(),
    };
    assertEquals(isEmailWorkReceipt(forged.emailWork), true);
    assertEquals(emailWorkReceiptOf(forged), undefined);
    assertEquals(emailWorkReceiptOf(emailEvent(emailReceipt()))?.workId, WORK_ID);

    await harness.orchestrator.processMessage(
      forged,
      harness.adapter as unknown as PlatformAdapter,
    );
    assertEquals(await journalRecords(harness.root), []);
  } finally {
    await harness.dispose();
  }
});

Deno.test("AgentCore records denied email admissions without disrupting other platforms", async () => {
  const root = await Deno.makeTempDir({ prefix: "email-receipts-agentcore-test-" });
  const store = new MailboxStore({ emailRoot: root, fingerprint: FINGERPRINT });
  const receipts = new EmailSessionReceipts(store);
  try {
    await createPrompts(root);
    await store.initialize(0, UIDVALIDITY);
    await store.discover(MAILBOX_KEY);
    await store.accept(MAILBOX_KEY, RECORD_ID);

    // No adapter registered for the email platform: nothing can execute the
    // accepted work, so it is terminally ignored instead of replayed forever.
    const noAdapterCore = new AgentCore(createConfig(root, { pooled: false, dryRun: false }));
    noAdapterCore.setEmailSessionReceipts(receipts);
    try {
      await noAdapterCore.handleEvent(emailEvent(emailReceipt()));
      assertEquals(await statesFor(root, WORK_ID), ["ignored"]);
    } finally {
      await noAdapterCore.shutdown();
    }

    // Second entry: an adapter exists but the access policy rejects the event.
    const policyKey: MailboxKey = { ...MAILBOX_KEY, uid: UID + 1 };
    const policyWorkId = "44444444-2222-3333-4444-555555555555";
    await store.discover(policyKey);
    await store.accept(policyKey, `${RECORD_ID}-policy`);

    const policyCore = new AgentCore(createConfig(root, { pooled: false, dryRun: false }));
    policyCore.setEmailSessionReceipts(receipts);
    try {
      policyCore.registerPlatform(
        new MockEmailPlatformAdapter() as unknown as PlatformAdapter,
      );
      await policyCore.handleEvent(emailEvent(emailReceipt(policyWorkId, policyKey)));
      assertEquals(await statesFor(root, policyWorkId), ["ignored"]);
      assertEquals(store.getEntry(policyKey)?.detail, "access-policy-denied");
    } finally {
      await policyCore.shutdown();
    }
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("A fence on work that was never accepted fails closed", async () => {
  const root = await Deno.makeTempDir({ prefix: "email-receipts-unaccepted-test-" });
  const store = new MailboxStore({ emailRoot: root, fingerprint: FINGERPRINT });
  const receipts = new EmailSessionReceipts(store);
  try {
    await store.initialize(0, UIDVALIDITY);
    // Discovered but not accepted: the fence must fail closed rather than
    // allowing the agent to act on unfenced work.
    await store.discover(MAILBOX_KEY);
    await assertRejects(
      () => receipts.beginEmailWork(emailReceipt()),
      MailboxStoreError,
      "[INVALID_TRANSITION]",
    );
    assertEquals(await statesFor(root, WORK_ID), []);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});
