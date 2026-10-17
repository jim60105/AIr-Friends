// tests/core/email-reminder-threads.test.ts
//
// Row 23 (`email-reminder-threads`) controlled integration coverage.
//
// Exercised layers: the REAL `ReminderHandler`, the REAL file-backed `ReminderStore`
// (capture + restart replay), the REAL `EmailAdapter`, `EmailMailService`, `SubmissionStore`,
// `EmailMessageStore` and `OutgoingMimeBuilder` over isolated temporary roots. The transport is
// either a scripted double (exact side-effect counts) or the local `EmailSmtpTestService`
// protocol fixture (a live SMTP DATA exchange), so the external side-effect count is asserted
// instead of a live production exchange.
//
// What this proves beyond the unit tests: the reminder's own stable operation key
// (`reminder:<id>`) reaches the adapter, the delivered message stays in the ORIGIN owner thread
// (`In-Reply-To`/`References`), the fixed signature is applied exactly once, the recipient is the
// initiating owner (never an inherited third-party destination), and a repeated attempt for the
// same logical operation performs ZERO additional SMTP transactions.
//
// No model and no production credential is involved.

import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { reminderOperationKey, ReminderStore } from "@core/reminder-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { ContextAssembler } from "@core/context-assembler.ts";
import { SessionOrchestrator } from "@core/session-orchestrator.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { createSkillJwt } from "../../src/utils/skill-jwt.ts";
import { buildEmailReminderOrigin, ReminderHandler } from "../../src/skills/reminder-handler.ts";
import { EmailAdapter } from "../../src/platforms/email/email-adapter.ts";
import { EmailMailService, type EmailSendOutcome } from "../../src/platforms/email/mail-service.ts";
import { buildMailboxFingerprint, MailboxStore } from "../../src/platforms/email/mailbox-store.ts";
import {
  EmailMessageStore,
  formatEmailChannelId,
  parseEmailChannelId,
} from "../../src/platforms/email/message-store.ts";
import { OutgoingMimeBuilder } from "../../src/platforms/email/outgoing-mime.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import { SubmissionStore } from "../../src/platforms/email/submission-store.ts";
import { createEmailReplyEligibilityResolver } from "../../src/platforms/email/reply-eligibility.ts";
import type {
  ImapAppendOptions,
  ImapFetchHeadersOptions,
  ImapFetchSourceOptions,
  ImapListOptions,
  ImapMailboxPosition,
  ImapMessage,
  ImapTransport,
} from "../../src/platforms/email/imap-client.ts";
import {
  EmailSmtpClient,
  SmtpDiagnosticCode,
  type SmtpSubmission,
  type SmtpSubmitResult,
  type SmtpTransport,
} from "../../src/platforms/email/smtp-client.ts";
import { EmailSmtpTestService } from "../helpers/email-smtp-service.ts";
import type {
  ChannelConfig,
  Config,
  EmailConfig,
  RemindersConfig,
} from "../../src/types/config.ts";
import type { ReminderEntry, ResolvedReminder } from "../../src/types/reminder.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { AgentConnectorOptions } from "../../src/acp/types.ts";
import type { AgentConnector, AgentProcessEvidence } from "../../src/acp/agent-connector.ts";
import type { PromptResponse } from "npm:@agentclientprotocol/sdk@^0.14.1";

const BOT = "bot@example.com";
const SENDER = "alice@allowed-domain.org";
const OWNER = normalizeEmailMailbox(SENDER).userId;
const PASSWORD = "unused-secret";
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const ANCHOR_WIRE_ID = "<anchor-1@allowed-domain.org>";
const CLOCK = new Date("2026-10-17T00:00:00Z");
const REMINDER_MESSAGE = "Remind me to pay the rent";
const REMINDER_BODY = "Reminder: pay the rent.";

const CHANNELS: ChannelConfig[] = [{ id: `email/account/${OWNER}`, enabled: true }];
const REMINDERS_CONFIG: RemindersConfig = {
  enabled: true,
  maxRemindersPerUser: 3,
  minIntervalMs: 1000,
  persistPath: "reminders.jsonl",
  checkIntervalMs: 1000,
};

/** Scripted SMTP double: records the exact bytes it was handed. */
class ScriptedSmtp implements SmtpTransport {
  readonly submissions: SmtpSubmission[] = [];

  submit(input: SmtpSubmission): Promise<SmtpSubmitResult> {
    this.submissions.push(input);
    return Promise.resolve({
      phase: "submitted",
      safeCode: SmtpDiagnosticCode.ACCEPTED,
      accepted: [...input.envelope.to],
      rejected: [],
      sizeBytes: input.emlBytes.byteLength,
      durationMs: 1,
    });
  }
}

/** Scripted IMAP double covering the sent-copy lane and the (unused) poll lane. */
class ScriptedImap implements ImapTransport {
  readonly appended: Uint8Array[] = [];

  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  status(): Promise<ImapMailboxPosition> {
    return Promise.resolve({ uidValidity: 1, uidNext: 1 });
  }
  position(): Promise<ImapMailboxPosition> {
    return Promise.resolve({ uidValidity: 1, uidNext: 1 });
  }
  listAfter(_uid: number, _options?: ImapListOptions): Promise<number[]> {
    return Promise.resolve([]);
  }
  fetchHeaders(_uid: number, _options?: ImapFetchHeadersOptions): Promise<string> {
    return Promise.resolve("");
  }
  fetchSource(_uid: number, _options?: ImapFetchSourceOptions): Promise<ImapMessage> {
    throw new Error("fetchSource is not used by this double");
  }
  appendSent(rawMime: Uint8Array | string, _options?: ImapAppendOptions): Promise<void> {
    this.appended.push(typeof rawMime === "string" ? new TextEncoder().encode(rawMime) : rawMime);
    return Promise.resolve();
  }
}

function emailConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return {
    enabled: false,
    address: BOT,
    imap: {
      host: "127.0.0.1",
      port: 993,
      tlsMode: "tls",
      username: BOT,
      password: PASSWORD,
    },
    smtp: {
      host: "127.0.0.1",
      port: 465,
      tlsMode: "tls",
      username: BOT,
      password: PASSWORD,
    },
    incomingFolder: "INBOX",
    sentFolder: "Sent",
    pollIntervalMs: 300_000,
    receivingAuth: { authservId: "mx.example.com", attestedStripping: true },
    maxMessageBytes: 25 * 1024 * 1024,
    maxIncomingAttachments: 10,
    signature: SIGNATURE,
    ...overrides,
  };
}

function inboundMessage(): string {
  return [
    `From: ${SENDER}`,
    `To: ${BOT}`,
    "Subject: When do I pay rent?",
    `Message-ID: ${ANCHOR_WIRE_ID}`,
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "",
    "When do I pay rent?",
  ].join("\r\n");
}

/** One wired reminder environment over isolated temporary state. */
interface ReminderEnv {
  config: EmailConfig;
  messageStore: EmailMessageStore;
  adapter: EmailAdapter;
  workspace: WorkspaceInfo;
  /** The record id of the user message the reminder was created from. */
  anchorRecordId: string;
  /** The owner thread channel of that message. */
  channelId: string;
}

/**
 * One delivery stack (adapter + mail service + submission journal) over the given roots. A
 * restart is modelled by building a SECOND stack over the SAME durable files.
 */
function buildMailStack(
  base: string,
  messageStore: EmailMessageStore,
  smtp: SmtpTransport,
): { adapter: EmailAdapter; mailService: EmailMailService } {
  const emailRoot = join(base, "email");
  const config = emailConfig();
  const mailboxStore = new MailboxStore({
    emailRoot,
    fingerprint: buildMailboxFingerprint("127.0.0.1", BOT, "INBOX"),
  });
  const mailService = new EmailMailService({
    config,
    emailRoot,
    submissionStore: new SubmissionStore(emailRoot),
    messageStore,
    smtp,
    imap: new ScriptedImap(),
    channels: CHANNELS,
    builder: new OutgoingMimeBuilder({ fromAddress: BOT, now: () => CLOCK }),
  });
  const adapter = new EmailAdapter({
    config,
    transport: new ScriptedImap(),
    mailboxStore,
    messageStore,
    mailService,
    channels: CHANNELS,
  });
  return { adapter, mailService };
}

async function buildReminderEnv(base: string, smtp: SmtpTransport): Promise<ReminderEnv> {
  const workspacesRoot = join(base, "workspaces");
  const messageStore = new EmailMessageStore({ workspacesRoot });
  const { adapter } = buildMailStack(base, messageStore, smtp);
  const config = emailConfig();

  const anchorRecordId = await messageStore.putSource(OWNER, inboundMessage(), {
    from: SENDER,
    subject: "When do I pay rent?",
    plainBody: "When do I pay rent?",
    wireIds: { messageId: ANCHOR_WIRE_ID },
  });
  const anchorRecord = await messageStore.getByOwnerRecord(OWNER, anchorRecordId);
  assert(anchorRecord);

  const workspace: WorkspaceInfo = {
    key: `email/${OWNER}`,
    components: { platform: "email", userId: OWNER },
    path: join(workspacesRoot, "email", OWNER),
    tmpPath: join(workspacesRoot, "email", OWNER, "tmp"),
    isDm: true,
  };
  await Deno.mkdir(workspace.path, { recursive: true });

  return {
    config,
    messageStore,
    adapter,
    workspace,
    anchorRecordId,
    channelId: formatEmailChannelId(OWNER, anchorRecord.threadId),
  };
}

/**
 * Create the reminder through the REAL handler with the context the Skill API host builds,
 * then replay it through a FRESH store instance — exactly what a restart does.
 */
async function persistAndReplayReminder(env: ReminderEnv): Promise<ResolvedReminder> {
  const handler = new ReminderHandler(new ReminderStore(REMINDERS_CONFIG.persistPath), {
    ...REMINDERS_CONFIG,
  });
  const context: SkillContext = {
    workspace: env.workspace,
    platformAdapter: env.adapter,
    channelId: env.channelId,
    userId: OWNER,
    emailReminderOrigin: buildEmailReminderOrigin(env.channelId, env.anchorRecordId),
  };
  const set = await handler.handleSetReminder({
    scheduledAt: new Date(Date.now() + 60_000).toISOString(),
    message: REMINDER_MESSAGE,
  }, context);
  assertEquals(set.success, true);

  const replayed = await new ReminderStore(REMINDERS_CONFIG.persistPath)
    .loadReminders(env.workspace);
  assertEquals(replayed.length, 1);
  assert(replayed[0].origin);
  assertEquals(replayed[0].origin.channelId, env.channelId);
  assertEquals(replayed[0].origin.replyAnchorRecordId, env.anchorRecordId);
  return replayed[0];
}

// ---------------------------------------------------------------------------
// Complete reminder processing: preflight -> Skill API reply -> adapter -> SMTP
// ---------------------------------------------------------------------------

/** Deployment-resolved trusted skill-script root (same literal the prompts render). */
const RESOLVED_SKILLS_ROOT = Deno.realPathSync(
  resolve(import.meta.dirname ?? ".", "../../skills"),
);
const SKILL_SECRET = "0123456789abcdef0123456789abcdef01";
/** Distinct from the ports owned by `tests/skill-api/server.test.ts`. */
const SKILL_PORT = 3982;

type ReminderPromptHook = () => Promise<void>;

/** Scripted ACP connector: every prompt is answered by the test's host-side hook. */
class ScriptedConnector {
  processEvidence: AgentProcessEvidence = { generations: 0, pid: undefined };
  promptHook?: ReminderPromptHook;
  promptCallCount = 0;

  constructor(_options: AgentConnectorOptions) {}
  getProcessEvidence(): AgentProcessEvidence {
    return this.processEvidence;
  }
  connect(): Promise<void> {
    return Promise.resolve();
  }
  supportsImageContent(): boolean {
    return false;
  }
  createSession(): Promise<string> {
    return Promise.resolve("mock-session-id");
  }
  setSessionModel(_sessionId: string, _modelId: string): Promise<void> {
    return Promise.resolve();
  }
  setReasoningEffort(_sessionId: string, _value: string): Promise<string> {
    return Promise.resolve("applied");
  }
  async prompt(_sessionId: string, _text: string): Promise<PromptResponse> {
    this.promptCallCount++;
    await this.promptHook?.();
    return { stopReason: "end_turn" } as PromptResponse;
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

/** Orchestrator whose connector is the scripted double above. */
class ReminderScriptedOrchestrator extends SessionOrchestrator {
  promptHook?: ReminderPromptHook;
  lastConnector: ScriptedConnector | null = null;

  protected override createConnector(options: AgentConnectorOptions): AgentConnector {
    const connector = new ScriptedConnector(options);
    connector.promptHook = this.promptHook;
    this.lastConnector = connector;
    return connector as unknown as AgentConnector;
  }
}

function reminderTestConfig(base: string): Config {
  return {
    platforms: {
      discord: { token: "test", enabled: true },
      misskey: { host: "test", token: "t", enabled: false },
    },
    agent: {
      model: "gpt-4",
      systemPromptPath: `${base}/prompts/system_reply.md`,
      tokenLimit: 20000,
      defaultAgentType: "opencode",
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: base, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    accessControl: { replyTo: "whitelist", whitelist: [] },
    skillApi: { enabled: true, port: SKILL_PORT, host: "127.0.0.1" },
    channels: [...CHANNELS],
  } as unknown as Config;
}

/**
 * Build the REAL orchestrator over the same durable roots as the delivery stack.
 * Its eligibility resolver is the production one over `messageStore`, exactly as
 * the composed email platform installs it.
 */
async function buildReminderOrchestrator(
  base: string,
  messageStore: EmailMessageStore,
): Promise<{
  orchestrator: ReminderScriptedOrchestrator;
  sessionRegistry: SessionRegistry;
  skillRegistry: SkillRegistry;
  config: Config;
}> {
  await Deno.mkdir(`${base}/prompts`, { recursive: true });
  await Deno.writeTextFile(
    `${base}/prompts/system_reply.md`,
    "You are a helper.\nSkill root: {{ skillsDir }}",
  );
  await Deno.writeTextFile(
    `${base}/prompts/system_reminder.md`,
    "Reminder: {{ reminderMessage }}\nPlatform: {{ platform }}\nSkill root: {{ skillsDir }}",
  );

  const config = reminderTestConfig(base);
  const workspaceManager = new WorkspaceManager({
    repoPath: base,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(memoryStore);
  const contextAssembler = new ContextAssembler(memoryStore, {
    systemPromptPath: `${base}/prompts/system_reply.md`,
    skillsDir: RESOLVED_SKILLS_ROOT,
    recentMessageLimit: 20,
    tokenLimit: 20000,
  });
  const sessionRegistry = new SessionRegistry();
  const orchestrator = new ReminderScriptedOrchestrator(
    workspaceManager,
    contextAssembler,
    skillRegistry,
    config,
    sessionRegistry,
    memoryStore,
  );
  orchestrator.setEmailReplyEligibility(createEmailReplyEligibilityResolver(messageStore));
  return { orchestrator, sessionRegistry, skillRegistry, config };
}

/** Push a retained anchor outside the bounded recent window with newer outbound records. */
async function seedNewerOutboundRecords(
  messageStore: EmailMessageStore,
  threadId: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await messageStore.putSent(
      OWNER,
      {
        emlBytes: `Subject: Re: Newer ${i}\r\n\r\nNewer reply ${i}`,
        historyBody: `Newer reply ${i}`,
        to: SENDER,
        subject: `Newer ${i}`,
        targetKind: "user",
        threadId,
        wireIds: { messageId: `<newer-${i}@x>`, inReplyTo: ANCHOR_WIRE_ID },
      },
      { workId: `newer-${i}`, actionSlot: "reply" },
    );
  }
}

/**
 * Wait for the in-process Skill API listener to accept requests. `Deno.serve`
 * binds synchronously, so retrying on the first connection error needs only a
 * microtask yield — no wall-clock delay and no guessed duration.
 */
async function waitForSkillApi(port: number, maxAttempts = 100): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/skill/test`, {
        method: "POST",
        body: JSON.stringify({ sessionId: "probe" }),
      });
      await response.body?.cancel();
      return;
    } catch {
      await Promise.resolve();
    }
  }
  throw new Error("Skill API fixture did not start");
}

Deno.test("email reminder - restart-preserved thread, one signed submission, no replay", async () => {
  const base = await Deno.makeTempDir();
  try {
    const smtp = new ScriptedSmtp();
    const env = await buildReminderEnv(base, smtp);
    const reminder = await persistAndReplayReminder(env);
    const origin = reminder.origin!;

    // Delivery uses the origin thread/anchor and the reminder's own operation.
    const emailSend = { ...reminderOperationKey(reminder.id), owner: OWNER };
    const delivered = await env.adapter.sendReply(origin.channelId, REMINDER_BODY, {
      replyToMessageId: origin.replyAnchorRecordId,
      emailSend,
    });
    assert(delivered.success, delivered.error);
    assertEquals(smtp.submissions.length, 1);

    const eml = new TextDecoder().decode(smtp.submissions[0].emlBytes);
    assert(eml.includes(`In-Reply-To: ${ANCHOR_WIRE_ID}`), "reply stays in the origin thread");
    assert(eml.includes(`References: ${ANCHOR_WIRE_ID}`), "References carry the thread anchor");
    // The MIME body uses CRLF line endings, so the signature is asserted token-wise.
    assertEquals(eml.split("AIr-Friends Bot").length - 1, 1, "signature applied exactly once");
    // The recipient is the initiating owner — no third-party destination is inherited.
    assertEquals(smtp.submissions[0].envelope.to, [SENDER]);

    // A RESTART rebuilds the delivery stack over the SAME durable files: the
    // replayed reminder's own operation is answered from the submission
    // journal, so the fresh transport sees ZERO new transactions.
    const restartedSmtp = new ScriptedSmtp();
    const restarted = buildMailStack(base, env.messageStore, restartedSmtp);
    const replay = await restarted.adapter.sendReply(origin.channelId, REMINDER_BODY, {
      replyToMessageId: origin.replyAnchorRecordId,
      emailSend,
    });
    assert(replay.success, replay.error);
    assertEquals(restartedSmtp.submissions.length, 0);
    assertEquals(smtp.submissions.length, 1);
    assertEquals((replay.emailSubmission as EmailSendOutcome).phase, "submitted");

    // The delivery is durable history of the ORIGIN thread, and the anchor is
    // resolvable through the owner thread (the fire-time origin check).
    const anchor = await env.messageStore.getByOwnerRecord(OWNER, env.anchorRecordId);
    assert(anchor);
    const history = await env.messageStore.history(OWNER, anchor.threadId, 10);
    assertEquals(history.map((record) => record.direction), ["inbound", "outbound"]);
    assert(await env.adapter.fetchMessage(origin.channelId, origin.replyAnchorRecordId));
    assertEquals(await env.adapter.fetchMessage(origin.channelId, crypto.randomUUID()), null);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("email reminder - smoke: a live SMTP fixture carries the threaded reminder once", async () => {
  const smtpService = new EmailSmtpTestService({
    tlsMode: "tls",
    username: BOT,
    password: PASSWORD,
  });
  await smtpService.start();
  const base = await Deno.makeTempDir();
  try {
    // The SMTP transport is the real client over a live socket/TLS handshake against the local
    // fixture; only the model and ACP layers are absent from this boundary.
    const smtp = new EmailSmtpClient({
      config: { ...emailConfig().smtp, port: smtpService.port },
      tlsCa: smtpService.caCert,
      timeoutMs: 5_000,
    });
    const env = await buildReminderEnv(base, smtp);
    const reminder = await persistAndReplayReminder(env);
    const origin = reminder.origin!;
    const emailSend = { ...reminderOperationKey(reminder.id), owner: OWNER };

    const delivered = await env.adapter.sendReply(origin.channelId, REMINDER_BODY, {
      replyToMessageId: origin.replyAnchorRecordId,
      emailSend,
    });
    assert(delivered.success, delivered.error);
    assertEquals(smtpService.dataTransactionCount, 1);

    const wire = new TextDecoder().decode(smtpService.dataTransactions[0].decoded);
    assert(wire.includes(`In-Reply-To: ${ANCHOR_WIRE_ID}`));
    assert(wire.includes(`References: ${ANCHOR_WIRE_ID}`));
    assertEquals(wire.split("AIr-Friends Bot").length - 1, 1, "the signature is applied once");
    assertEquals(smtpService.dataTransactions[0].recipients, [SENDER]);

    // The restart replay of the same logical operation performs no second DATA exchange.
    const replay = await env.adapter.sendReply(origin.channelId, REMINDER_BODY, {
      replyToMessageId: origin.replyAnchorRecordId,
      emailSend,
    });
    assert(replay.success, replay.error);
    assertEquals(smtpService.dataTransactionCount, 1);
  } finally {
    await Deno.remove(base, { recursive: true });
    await smtpService.stop();
  }
});

// ---------------------------------------------------------------------------
// Durable retained anchors through COMPLETE reminder processing
// ---------------------------------------------------------------------------

/** A reminder store whose completion write always fails (simulated patch failure). */
function failingReminderStore(): ReminderStore {
  return {
    cancelReminder: () => Promise.reject(new Error("simulated reminder patch failure")),
  } as unknown as ReminderStore;
}

/** A due email reminder entry persisted directly, bypassing the future-time creation gate. */
function dueEmailReminder(
  id: string,
  origin: NonNullable<ResolvedReminder["origin"]>,
): ReminderEntry {
  const due = new Date(Date.now() - 60_000).toISOString();
  return {
    type: "reminder",
    id,
    createdAt: due,
    scheduledAt: due,
    message: REMINDER_MESSAGE,
    platform: "email",
    userId: OWNER,
    enabled: true,
    origin,
  };
}

/** Raw inbound mail whose source carries neither Message-ID nor References. */
function inboundWithoutWireIds(): string {
  return [
    `From: ${SENDER}`,
    `To: ${BOT}`,
    "Subject: No wire ids",
    "Authentication-Results: mx.example.com; dmarc=pass header.from=allowed-domain.org",
    "",
    "No wire ids",
  ].join("\r\n");
}

Deno.test("email reminder - a retained anchor outside 200 newer records delivers once through the host path and never replays", async () => {
  const base = await Deno.makeTempDir();
  const smtp = new ScriptedSmtp();
  try {
    const env = await buildReminderEnv(base, smtp);
    const reminder = await persistAndReplayReminder(env);
    const origin = reminder.origin!;
    const { threadId } = parseEmailChannelId(origin.channelId);
    await seedNewerOutboundRecords(env.messageStore, threadId, 200);

    // The retained anchor is outside every bounded window, and the recent suffix is
    // ALL outbound: no recent inbound record can stand in for the recipient.
    const recent = await env.messageStore.history(OWNER, threadId, 200);
    assertEquals(recent.length, 200);
    assertEquals(recent.every((record) => record.direction === "outbound"), true);
    assert(!recent.some((record) => record.recordId === env.anchorRecordId));
    assertEquals((await env.adapter.fetchRecentMessages(origin.channelId, 500)).length, 200);

    // RESTART: reopen the archive and rebuild the whole delivery stack over the
    // same durable files. The reminder's completion write fails on this tick.
    const reopened = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
    const firstSmtp = new ScriptedSmtp();
    const firstStack = buildMailStack(base, reopened, firstSmtp);
    const firstRun = await buildReminderOrchestrator(base, reopened);
    firstRun.orchestrator.setEmailSubmissionEvidence(firstStack.mailService);

    const server = new SkillAPIServer(
      firstRun.sessionRegistry,
      firstRun.skillRegistry,
      { port: SKILL_PORT, host: "127.0.0.1" },
      SKILL_SECRET,
    );
    server.start();
    await waitForSkillApi(SKILL_PORT);
    try {
      // The HOST path: the mocked connector calls the real Skill API `send-reply`,
      // which derives the reminder operation and the persisted anchor from the
      // session alone. Nothing here supplies a work id or an anchor.
      firstRun.orchestrator.promptHook = async () => {
        const session = firstRun.sessionRegistry.getAll()[0];
        assertEquals(session.channelId, origin.channelId);
        assertEquals(session.emailReminder?.reminderId, reminder.id);
        assertEquals(session.emailReminder?.origin.replyAnchorRecordId, env.anchorRecordId);
        const token = await createSkillJwt(SKILL_SECRET, {
          sub: session.id,
          channel: session.channelId,
          jti: firstRun.sessionRegistry.getCallerToken(session.id) ?? "",
        });
        const response = await fetch(`http://127.0.0.1:${SKILL_PORT}/api/skill/send-reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            sessionId: session.id,
            parameters: { message: REMINDER_BODY },
          }),
        });
        const body = await response.json() as { success: boolean; error?: string };
        assertEquals(response.status, 200);
        assert(body.success, body.error);
      };

      const first = await firstRun.orchestrator.processReminder(
        reminder,
        firstStack.adapter,
        failingReminderStore(),
      );
      assertEquals(first.success, true);
      assertEquals(first.emailSubmitted, true);

      // ONE submission, to the ORIGINAL verified sender, in the ORIGIN thread, under
      // the stable host-derived reminder operation.
      assertEquals(firstSmtp.submissions.length, 1);
      assertEquals(firstSmtp.submissions[0].envelope.to, [SENDER]);
      const wire = new TextDecoder().decode(firstSmtp.submissions[0].emlBytes);
      assert(wire.includes(`In-Reply-To: ${ANCHOR_WIRE_ID}`), "the retained anchor threads");
      assert(wire.includes(`References: ${ANCHOR_WIRE_ID}`));

      const operation = reminderOperationKey(reminder.id);
      assertEquals(operation, {
        workId: reminder.id,
        actionSlot: `reminder:${reminder.id}`,
      });
      const outcome = firstStack.mailService.lookup(OWNER, operation);
      assert(outcome, "the stable operation is recorded durably");
      assertEquals(outcome.phase, "submitted");
      const [delivered] = await reopened.history(OWNER, threadId, 1);
      assertEquals(delivered.operationKey, operation);
      assertEquals(delivered.to, SENDER);
      assertEquals(delivered.inReplyTo, ANCHOR_WIRE_ID);
    } finally {
      await server.stop();
      firstRun.sessionRegistry.stop();
    }

    // The completion write failed, so the reminder record is still enabled.
    const persisted = await new ReminderStore(REMINDERS_CONFIG.persistPath)
      .loadReminders(env.workspace);
    assertEquals(persisted[0].enabled, true);

    // NEXT TICK OVER A RESTARTED STACK: the durable operation is consulted before
    // any generation, so nothing is regenerated and no second SMTP transaction runs.
    const reopenedAgain = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
    const secondSmtp = new ScriptedSmtp();
    const secondStack = buildMailStack(base, reopenedAgain, secondSmtp);
    const secondRun = await buildReminderOrchestrator(base, reopenedAgain);
    secondRun.orchestrator.setEmailSubmissionEvidence(secondStack.mailService);

    const second = await secondRun.orchestrator.processReminder(
      reminder,
      secondStack.adapter,
      new ReminderStore(REMINDERS_CONFIG.persistPath),
    );
    assertEquals(second.emailSubmitted, true);
    assertEquals(secondSmtp.submissions.length, 0);
    assertEquals(secondRun.orchestrator.lastConnector, null);
    assertEquals(
      (await new ReminderStore(REMINDERS_CONFIG.persistPath).loadReminders(env.workspace))[0]
        .enabled,
      false,
    );
    secondRun.sessionRegistry.stop();
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("email reminder - a retained but unthreadable anchor is disabled before generation or SMTP", async () => {
  const base = await Deno.makeTempDir();
  const smtp = new ScriptedSmtp();
  try {
    const env = await buildReminderEnv(base, smtp);
    const recordId = await env.messageStore.putSource(OWNER, inboundWithoutWireIds(), {
      from: SENDER,
      subject: "No wire ids",
      plainBody: "No wire ids",
    });
    const record = await env.messageStore.getByOwnerRecord(OWNER, recordId);
    assert(record);
    const channelId = formatEmailChannelId(OWNER, record.threadId);
    const reminder = dueEmailReminder("rem_unthreadable", {
      channelId,
      replyAnchorRecordId: recordId,
    });
    await new ReminderStore(REMINDERS_CONFIG.persistPath).addReminder(env.workspace, reminder);

    // Normal scheduling selection sees the due reminder before the tick.
    const firstStore = new ReminderStore(REMINDERS_CONFIG.persistPath);
    const due = await firstStore.getDueReminders(env.workspace);
    assertEquals(due.map((entry) => entry.id), ["rem_unthreadable"]);

    const { orchestrator, sessionRegistry } = await buildReminderOrchestrator(
      base,
      env.messageStore,
    );
    const result = await orchestrator.processReminder(due[0], env.adapter, firstStore);
    assertEquals(result.success, false);
    assertEquals(result.error, "email_reminder_origin_review_required");
    assertEquals(orchestrator.lastConnector, null, "no generation");
    assertEquals(smtp.submissions.length, 0, "no SMTP");
    sessionRegistry.stop();

    // A reopened store proves the disabled state AND that later ticks cannot select it.
    const reopened = new ReminderStore(REMINDERS_CONFIG.persistPath);
    assertEquals(await reopened.getDueReminders(env.workspace), []);
    const [persisted] = await reopened.loadReminders(env.workspace);
    assertEquals(persisted.enabled, false);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("email reminder - completed or uncertain retained-anchor operations never replay across ticks", async () => {
  const phases = ["submitted", "unknown", "submitting"] as const;
  for (const phase of phases) {
    const base = await Deno.makeTempDir();
    const smtp = new ScriptedSmtp();
    try {
      const env = await buildReminderEnv(base, smtp);
      const reminder = await persistAndReplayReminder(env);
      const operation = reminderOperationKey(reminder.id);

      const { orchestrator, sessionRegistry } = await buildReminderOrchestrator(
        base,
        env.messageStore,
      );
      orchestrator.setEmailSubmissionEvidence({
        lookup: (owner, key) => {
          // Only the reminder's OWN stable operation is evidence, for the right owner.
          if (
            owner !== OWNER || key.workId !== operation.workId ||
            key.actionSlot !== operation.actionSlot
          ) {
            return undefined;
          }
          return phase === "submitted"
            ? {
              operationId: `op_${phase}`,
              phase,
              targetKind: "user",
              reused: false,
            }
            : { operationId: `op_${phase}`, phase, reused: false };
        },
      });

      const store = new ReminderStore(REMINDERS_CONFIG.persistPath);
      const first = await orchestrator.processReminder(reminder, env.adapter, store);
      assertEquals(orchestrator.lastConnector, null, `${phase}: no generation`);
      assertEquals(smtp.submissions.length, 0, `${phase}: no SMTP`);
      assertEquals(first.success, phase === "submitted", `${phase}: verdict`);
      if (phase === "submitted") {
        assertEquals(first.emailSubmitted, true, `${phase}: delivery verdict`);
      } else {
        assertEquals(first.emailUnknown, true, `${phase}: uncertainty`);
      }
      sessionRegistry.stop();

      // A later tick after a restart reaches the same durable verdict, with the
      // reminder record disabled and no session or submission.
      const reopened = new ReminderStore(REMINDERS_CONFIG.persistPath);
      assertEquals(await reopened.getDueReminders(env.workspace), []);
      const [persisted] = await reopened.loadReminders(env.workspace);
      assertEquals(persisted.enabled, false);

      const restartedStore = new EmailMessageStore({
        workspacesRoot: join(base, "workspaces"),
      });
      const restartedSmtp = new ScriptedSmtp();
      const restartedStack = buildMailStack(base, restartedStore, restartedSmtp);
      const restartedRun = await buildReminderOrchestrator(base, restartedStore);
      restartedRun.orchestrator.setEmailSubmissionEvidence({
        lookup: (owner, key) =>
          owner === OWNER && key.workId === operation.workId &&
            key.actionSlot === operation.actionSlot
            ? { operationId: `op_${phase}`, phase, reused: false }
            : undefined,
      });
      const restarted = await restartedRun.orchestrator.processReminder(
        reminder,
        restartedStack.adapter,
        new ReminderStore(REMINDERS_CONFIG.persistPath),
      );
      assertEquals(
        phase === "submitted" ? restarted.emailSubmitted : restarted.emailUnknown,
        true,
        `${phase}: durable verdict survives the restart`,
      );
      assertEquals(restartedRun.orchestrator.lastConnector, null);
      assertEquals(restartedSmtp.submissions.length, 0);
      restartedRun.sessionRegistry.stop();
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  }
});

Deno.test("email reminder - a revoked allowlist prevents submission with a retained anchor", async () => {
  const base = await Deno.makeTempDir();
  const smtp = new ScriptedSmtp();
  try {
    const env = await buildReminderEnv(base, smtp);
    const reminder = await persistAndReplayReminder(env);
    const { orchestrator, sessionRegistry, config } = await buildReminderOrchestrator(
      base,
      env.messageStore,
    );
    config.channels = [{ id: `email/account/${OWNER}`, enabled: false }];

    const store = new ReminderStore(REMINDERS_CONFIG.persistPath);
    const result = await orchestrator.processReminder(reminder, env.adapter, store);
    assertEquals(result.success, false);
    assertEquals(orchestrator.lastConnector, null);
    assertEquals(smtp.submissions.length, 0);
    assertEquals(
      (await new ReminderStore(REMINDERS_CONFIG.persistPath).loadReminders(env.workspace))[0]
        .enabled,
      false,
    );
    sessionRegistry.stop();
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
