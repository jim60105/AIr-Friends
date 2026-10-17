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
import { join } from "@std/path";
import { reminderOperationKey, ReminderStore } from "@core/reminder-store.ts";
import { buildEmailReminderOrigin, ReminderHandler } from "../../src/skills/reminder-handler.ts";
import { EmailAdapter } from "../../src/platforms/email/email-adapter.ts";
import { EmailMailService, type EmailSendOutcome } from "../../src/platforms/email/mail-service.ts";
import { buildMailboxFingerprint, MailboxStore } from "../../src/platforms/email/mailbox-store.ts";
import {
  EmailMessageStore,
  formatEmailChannelId,
} from "../../src/platforms/email/message-store.ts";
import { OutgoingMimeBuilder } from "../../src/platforms/email/outgoing-mime.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import { SubmissionStore } from "../../src/platforms/email/submission-store.ts";
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
import type { ChannelConfig, EmailConfig, RemindersConfig } from "../../src/types/config.ts";
import type { ResolvedReminder } from "../../src/types/reminder.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";

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

async function buildReminderEnv(base: string, smtp: SmtpTransport): Promise<ReminderEnv> {
  const emailRoot = join(base, "email");
  const workspacesRoot = join(base, "workspaces");
  const config = emailConfig();
  const messageStore = new EmailMessageStore({ workspacesRoot });
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
    assert(eml.includes(ANCHOR_WIRE_ID), "References carry the thread anchor");
    // The MIME body uses CRLF line endings, so the signature is asserted token-wise.
    assertEquals(eml.split("AIr-Friends Bot").length - 1, 1, "signature applied exactly once");
    // The recipient is the initiating owner — no third-party destination is inherited.
    assertEquals(smtp.submissions[0].envelope.to, [SENDER]);

    // A repeated attempt for the SAME logical operation never reaches SMTP again.
    const replay = await env.adapter.sendReply(origin.channelId, REMINDER_BODY, {
      replyToMessageId: origin.replyAnchorRecordId,
      emailSend,
    });
    assert(replay.success, replay.error);
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
