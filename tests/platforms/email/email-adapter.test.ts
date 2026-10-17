// tests/platforms/email/email-adapter.test.ts
//
// Deterministic regression coverage for `email-adapter`.
//
// Exercised layers: the real `EmailAdapter`, the real `EmailMailboxPoller`, the real
// `MailboxStore`, `EmailMessageStore`, `SubmissionStore` and `EmailMailService` (file-backed, in
// isolated temp roots), the real `EmailImapClient` against the in-process deterministic IMAP
// fixture, and the real `FileHandler`/`ReplyHandler` skill handlers. SMTP is a scripted transport
// double, so every scenario asserts exact external side-effect counts instead of a live exchange.
//
// Scenarios mirror `openspec/changes/email-adapter/specs/platform-abstraction/spec.md`:
// threaded reply smoke, explicit unsupported actions, and complete file delivery results.

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { ChannelConfig, Config, EmailConfig } from "../../../src/types/config.ts";
import type { NormalizedEvent } from "../../../src/types/events.ts";
import type { WorkspaceInfo } from "../../../src/types/workspace.ts";
import type { SkillContext } from "@skills/types.ts";
import { FileHandler } from "@skills/file-handler.ts";
import { ReplyHandler } from "@skills/reply-handler.ts";
import { normalizeEmailMailbox } from "../../../src/platforms/email/email-identity.ts";
import {
  buildMailboxFingerprint,
  MailboxStore,
} from "../../../src/platforms/email/mailbox-store.ts";
import {
  EmailMessageStore,
  formatEmailChannelId,
  parseEmailChannelId,
} from "../../../src/platforms/email/message-store.ts";
import {
  _resetSharedRegistryForTesting,
  SubmissionStore,
} from "../../../src/platforms/email/submission-store.ts";
import { EmailMailService } from "../../../src/platforms/email/mail-service.ts";
import {
  EmailAdapter,
  type EmailAdapterOptions,
} from "../../../src/platforms/email/email-adapter.ts";
import { OutgoingMimeBuilder } from "../../../src/platforms/email/outgoing-mime.ts";
import {
  EmailImapClient,
  type ImapAppendOptions,
  type ImapFetchHeadersOptions,
  type ImapFetchSourceOptions,
  type ImapListOptions,
  type ImapMailboxPosition,
  type ImapMessage,
  type ImapTransport,
} from "../../../src/platforms/email/imap-client.ts";
import {
  EmailSmtpClient,
  SmtpDiagnosticCode,
  type SmtpSubmission,
  type SmtpSubmitResult,
  type SmtpTransport,
} from "../../../src/platforms/email/smtp-client.ts";
import { EmailImapTestService } from "../../helpers/email-imap-service.ts";
import { EmailSmtpTestService } from "../../helpers/email-smtp-service.ts";

const BOT = "bot@example.com";
const AUTHSERV = "mx.example.com";
const SENDER = "alice@allowed-domain.org";
const OWNER = normalizeEmailMailbox(SENDER).userId;
const PASSWORD = "secretpassword";
const CLOCK = new Date("2026-10-17T00:00:00Z");
const UID_VALIDITY = 500;

/** Enabled account channel for the only allowed sender/owner. */
const CHANNELS: ChannelConfig[] = [{ id: `email/account/${OWNER}`, enabled: true }];

/**
 * Scripted SMTP double: records the exact bytes and envelope it was handed and reports the
 * scripted outcome. Never reaches a real server.
 */
class ScriptedSmtp implements SmtpTransport {
  readonly submissions: SmtpSubmission[] = [];
  mode: "submitted" | "failed" | "unknown" = "submitted";

  submit(input: SmtpSubmission): Promise<SmtpSubmitResult> {
    this.submissions.push(input);
    const accepted = this.mode === "submitted" ? [...input.envelope.to] : [];
    const rejected = this.mode === "failed" ? [...input.envelope.to] : [];
    return Promise.resolve({
      phase: this.mode,
      safeCode: this.mode === "submitted"
        ? SmtpDiagnosticCode.ACCEPTED
        : this.mode === "failed"
        ? SmtpDiagnosticCode.REJECTED
        : SmtpDiagnosticCode.CONNECTION_LOST,
      accepted,
      rejected,
      sizeBytes: input.emlBytes.byteLength,
      durationMs: 1,
    });
  }
}

/** Scripted IMAP double for the mail service's sent-folder copy lane (no real socket). */
class SentCopyImap implements ImapTransport {
  readonly appended: Uint8Array[] = [];
  readonly folders: string[] = [];

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
  appendSent(rawMime: Uint8Array | string, options?: ImapAppendOptions): Promise<void> {
    this.appended.push(typeof rawMime === "string" ? new TextEncoder().encode(rawMime) : rawMime);
    this.folders.push(options?.folder ?? "Sent");
    return Promise.resolve();
  }
}

/** One wired adapter stack over isolated temporary state. */
interface Harness {
  base: string;
  config: EmailConfig;
  mailboxStore: MailboxStore;
  messageStore: EmailMessageStore;
  mailService: EmailMailService;
  smtp: ScriptedSmtp;
  sentCopy: SentCopyImap;
  adapter: EmailAdapter;
  events: NormalizedEvent[];
}

function fingerprint(): string {
  return buildMailboxFingerprint("127.0.0.1", BOT, "INBOX");
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
    receivingAuth: { authservId: AUTHSERV, attestedStripping: true },
    maxMessageBytes: 25 * 1024 * 1024,
    maxIncomingAttachments: 10,
    signature: "AIr-Friends Bot",
    ...overrides,
  };
}

/**
 * Wire the full adapter stack. `pollTransport` drives receiving (the real IMAP client against
 * the fixture when a test polls); the mail service always gets its own sent-copy double so the
 * two lanes never share one connection.
 */
function buildHarness(
  base: string,
  options: {
    pollTransport: ImapTransport;
    config?: Partial<EmailConfig>;
    channels?: ChannelConfig[];
    workIdFactory?: () => string;
    /** IMAP port the adapter's own configuration advertises (the fixture port in poll tests). */
    imapPort?: number;
    /** Real SMTP transport for the smoke leg (defaults to the scripted double). */
    smtpTransport?: SmtpTransport;
    /** Real IMAP transport for the sent-copy lane (defaults to the sent-copy double). */
    sentCopyTransport?: ImapTransport;
  },
): Harness {
  const emailRoot = join(base, "email");
  const workspacesRoot = join(base, "workspaces");
  const baseConfig = emailConfig(options.config);
  const config: EmailConfig = {
    ...baseConfig,
    imap: { ...baseConfig.imap, port: options.imapPort ?? baseConfig.imap.port },
  };
  const channels = options.channels ?? CHANNELS;
  const mailboxStore = new MailboxStore({ emailRoot, fingerprint: fingerprint() });
  const messageStore = new EmailMessageStore({ workspacesRoot });
  const smtp = new ScriptedSmtp();
  const sentCopy = new SentCopyImap();
  const mailService = new EmailMailService({
    config,
    emailRoot,
    submissionStore: new SubmissionStore(emailRoot),
    messageStore,
    smtp: options.smtpTransport ?? smtp,
    imap: options.sentCopyTransport ?? sentCopy,
    channels,
    builder: new OutgoingMimeBuilder({ fromAddress: BOT, now: () => CLOCK }),
  });

  const adapterOptions: EmailAdapterOptions = {
    config,
    transport: options.pollTransport,
    mailboxStore,
    messageStore,
    mailService,
    channels,
    workIdFactory: options.workIdFactory,
  };
  const adapter = new EmailAdapter(adapterOptions);
  const events: NormalizedEvent[] = [];
  adapter.onEvent((event) => {
    events.push(event);
    return Promise.resolve();
  });

  return { base, config, mailboxStore, messageStore, mailService, smtp, sentCopy, adapter, events };
}

/** An admitted inbound message: DMARC pass for the sender domain plus the allowlist channel. */
function rawMessage(options: {
  messageId?: string;
  from?: string;
  subject?: string;
  body?: string;
  attachments?: string[];
}): string {
  const from = options.from ?? SENDER;
  const domain = from.split("@")[1];
  const lines = [
    `From: ${from}`,
    `To: ${BOT}`,
    `Subject: ${options.subject ?? "Hello"}`,
    ...(options.messageId ? [`Message-ID: ${options.messageId}`] : []),
    `Authentication-Results: ${AUTHSERV}; dmarc=pass header.from=${domain}`,
  ];
  if (options.attachments && options.attachments.length > 0) {
    lines.push('Content-Type: multipart/mixed; boundary="mix-boundary"', "");
    for (const attachment of options.attachments) {
      lines.push(
        "--mix-boundary",
        `Content-Type: text/plain; name="${attachment}"`,
        `Content-Disposition: attachment; filename="${attachment}"`,
        "",
        `payload of ${attachment}`,
      );
    }
    lines.push("--mix-boundary--");
  } else {
    lines.push("", options.body ?? "Authored body text.");
  }
  return lines.join("\r\n");
}

/** Seed one inbound source record directly through the real store. */
async function seedInbound(
  messageStore: EmailMessageStore,
  raw: string,
  options: { messageId?: string; subject?: string; body?: string; from?: string } = {},
): Promise<{ recordId: string; threadId: string }> {
  const recordId = await messageStore.putSource(OWNER, raw, {
    from: options.from ?? SENDER,
    subject: options.subject ?? "Hello",
    plainBody: options.body ?? "Authored body text.",
    wireIds: options.messageId ? { messageId: options.messageId } : {},
  });
  const record = await messageStore.getByOwnerRecord(OWNER, recordId);
  assert(record);
  return { recordId, threadId: record.threadId };
}

/**
 * Seed one outbound record into an existing owner thread (or a NEW thread when
 * `threadId` is omitted). Used to push a retained anchor outside the bounded
 * recent-history window.
 */
async function seedOutbound(
  messageStore: EmailMessageStore,
  threadId: string | undefined,
  index: number,
  options: { subject?: string; inReplyTo?: string; label?: string } = {},
): Promise<{ recordId: string; threadId: string; wireMessageId: string }> {
  const wireMessageId = `<out-${index}@x>`;
  const subject = options.subject ?? `Reply ${index}`;
  const { recordId, threadId: storedThreadId } = await messageStore.putSent(
    OWNER,
    {
      emlBytes: `Subject: ${subject}\r\n\r\nReply ${index}`,
      historyBody: `Reply ${index}`,
      to: SENDER,
      subject,
      targetKind: "user",
      ...(threadId === undefined ? {} : { threadId }),
      wireIds: {
        messageId: wireMessageId,
        ...(options.inReplyTo === undefined ? {} : { inReplyTo: options.inReplyTo }),
      },
    },
    { workId: `${options.label ?? "seed"}-${index}`, actionSlot: "reply" },
  );
  return { recordId, threadId: storedThreadId, wireMessageId };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "email-adapter-test-" });
  try {
    await fn(dir);
  } finally {
    _resetSharedRegistryForTesting();
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** IMAP client configuration pointing at the in-process fixture. */
function fixtureImapConfig(service: EmailImapTestService): EmailConfig["imap"] {
  return { ...emailConfig().imap, port: service.port };
}

Deno.test("EmailAdapter - connect/recover/poll emits one private event with the durable receipt", async () => {
  await withTempDir(async (base) => {
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT,
      password: PASSWORD,
      uidValidity: UID_VALIDITY,
      uidNext: 101,
    });
    await service.start();
    try {
      const transport = new EmailImapClient({
        config: fixtureImapConfig(service),
        tlsCa: service.caCert,
      });
      let workCounter = 0;
      const harness = buildHarness(base, {
        pollTransport: transport,
        workIdFactory: () => `work-${++workCounter}`,
        imapPort: service.port,
      });

      // First activation persists the boundary and excludes preexisting mail.
      await harness.adapter.connect();
      assertEquals(harness.events.length, 0);
      assertEquals(
        harness.mailboxStore.getSnapshot()?.initializedBoundary,
        100,
      );

      service.addMessage({
        uid: 101,
        rawMime: rawMessage({
          messageId: "<inbound-101@x>",
          subject: "Hello there",
          attachments: ["note.txt"],
        }),
      });

      const round = await harness.adapter.poll();
      assertEquals(round.accepted, 1);
      assertEquals(harness.events.length, 1);

      const event = harness.events[0];
      assertEquals(event.platform, "email");
      assertEquals(event.isDm, true);
      assertEquals(event.guildId, "");
      assertEquals(event.userId, OWNER);
      assertEquals(event.username, SENDER);

      // The channel is the owner-bound thread, and both components are validated.
      const parsedChannel = parseEmailChannelId(event.channelId);
      assertEquals(parsedChannel.owner, OWNER);

      const record = await harness.messageStore.getByOwnerRecord(OWNER, event.messageId);
      assert(record);
      assertEquals(event.messageId, record.recordId);
      assertEquals(parsedChannel.threadId, record.threadId);
      assertEquals(event.timestamp, new Date(record.timestamp));

      // Attachments arrive as owner-scoped local references, never remote URLs.
      assertEquals(event.attachments?.length, 1);
      const attachment = event.attachments![0];
      assertEquals(attachment.kind, "email-local");
      if (attachment.kind === "email-local") {
        assertEquals(attachment.owner, OWNER);
        assertEquals(attachment.recordId, record.recordId);
        assertEquals(attachment.filename, "note.txt");
      }

      // The typed receipt matches the work id the poller accepted durably.
      assertEquals(event.emailWork?.kind, "email-work");
      assertEquals(event.emailWork?.workId, "work-1");
      assertEquals(event.emailWork?.recordId, record.recordId);
      assertEquals(event.emailWork?.mailboxKey, {
        fingerprint: fingerprint(),
        uidValidity: UID_VALIDITY,
        uid: 101,
      });

      const entry = harness.mailboxStore.getEntry({
        fingerprint: fingerprint(),
        uidValidity: UID_VALIDITY,
        uid: 101,
      });
      assertEquals(entry?.state, "accepted");
      assertEquals(entry?.sourceRecordId, record.recordId);

      // Exactly once: a further round finds nothing new.
      await harness.adapter.poll();
      assertEquals(harness.events.length, 1);

      // Stop drains: no new work is accepted and no further event is emitted.
      await harness.adapter.disconnect();
      const afterStop = await harness.adapter.poll();
      assertEquals(afterStop.halted, true);
      assertEquals(afterStop.accepted, 0);
      assertEquals(harness.events.length, 1);
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailAdapter - restart resumes downtime mail once and never replays it", async () => {
  await withTempDir(async (base) => {
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT,
      password: PASSWORD,
      uidValidity: UID_VALIDITY,
      uidNext: 101,
    });
    await service.start();
    try {
      const firstTransport = new EmailImapClient({
        config: fixtureImapConfig(service),
        tlsCa: service.caCert,
      });
      const first = buildHarness(base, {
        pollTransport: firstTransport,
        workIdFactory: () => "work-first",
        imapPort: service.port,
      });
      await first.adapter.connect();
      await first.adapter.disconnect();

      // Mail arrives while the bot is stopped, marked Seen by another client.
      service.addMessage({
        uid: 102,
        flags: ["\\Seen"],
        rawMime: rawMessage({ messageId: "<downtime-102@x>", subject: "While stopped" }),
      });

      const second = buildHarness(base, {
        pollTransport: new EmailImapClient({
          config: fixtureImapConfig(service),
          tlsCa: service.caCert,
        }),
        workIdFactory: () => "work-second",
        imapPort: service.port,
      });
      await second.adapter.connect();
      // `connect()` performs the startup round, so the downtime message is already emitted.
      assertEquals(second.events.length, 1);
      assertEquals(second.events[0].emailWork?.workId, "work-second");

      // The durable boundary makes the next round a no-op.
      const round = await second.adapter.poll();
      assertEquals(round.accepted, 0);
      assertEquals(second.events.length, 1);
      await second.adapter.disconnect();
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailAdapter - history and single-message fetch are owner+thread gated", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const first = await seedInbound(harness.messageStore, rawMessage({ messageId: "<a-1@x>" }), {
      messageId: "<a-1@x>",
      subject: "First",
      body: "First body.",
    });
    await harness.messageStore.putSource(OWNER, rawMessage({ messageId: "<a-2@x>" }), {
      from: SENDER,
      subject: "First",
      plainBody: "Second body.",
      wireIds: { messageId: "<a-2@x>", inReplyTo: "<a-1@x>", references: ["<a-1@x>"] },
    });

    const other = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<other-1@x>" }),
      { messageId: "<other-1@x>", subject: "Other thread" },
    );

    const channel = formatEmailChannelId(OWNER, first.threadId);
    const history = await harness.adapter.fetchRecentMessages(channel, 10);
    assertEquals(history.length, 2);
    // Chronological order, newest last, exactly like the other platform adapters.
    assertEquals(decode(new TextEncoder().encode(history[0].content)), "First body.");
    assertEquals(history[1].content, "Second body.");
    assertEquals(history[0].messageId, first.recordId);

    // A different thread of the same owner is a different channel and never leaks in.
    assertEquals(
      (await harness.adapter.fetchRecentMessages(formatEmailChannelId(OWNER, other.threadId), 10))
        .length,
      1,
    );

    // Single-message fetch must match both the owner and the thread.
    const fetched = await harness.adapter.fetchMessage(channel, first.recordId);
    assert(fetched);
    assertEquals(fetched.content, "First body.");
    assertEquals(
      await harness.adapter.fetchMessage(channel, other.recordId),
      null,
      "a record outside the channel's thread is not visible",
    );

    // Malformed and foreign channels never reach the store.
    assertEquals(await harness.adapter.fetchRecentMessages("discord/channel/1", 10), []);
    assertEquals(
      await harness.adapter.fetchRecentMessages(
        formatEmailChannelId(`e_${"b".repeat(64)}`, first.threadId),
        10,
      ),
      [],
      "another owner's thread is empty for this store scope",
    );
    assertEquals(await harness.adapter.fetchMessage("nonsense", first.recordId), null);
  });
});

Deno.test("EmailAdapter - threaded reply goes only to the verified sender", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<reply-anchor@x>", subject: "Hello" }),
      { messageId: "<reply-anchor@x>", subject: "Hello", body: "Please answer." },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);

    const result = await harness.adapter.sendReply(channel, "Answer body.", {
      replyToMessageId: seeded.recordId,
      emailSend: { workId: "work-reply", owner: OWNER },
      platformSpecific: { emailSend: { workId: "model-supplied", owner: OWNER } },
    });

    assertEquals(result.success, true);
    assertEquals(result.emailSubmission?.phase, "submitted");
    assertEquals(result.emailSubmission?.operationId !== undefined, true);

    // Exactly one SMTP transaction, to the verified sender only.
    assertEquals(harness.smtp.submissions.length, 1);
    assertEquals(harness.smtp.submissions[0].envelope.to, [SENDER]);
    assertEquals(harness.sentCopy.appended.length, 1);

    const wire = decode(harness.smtp.submissions[0].emlBytes);
    assert(wire.includes("In-Reply-To: <reply-anchor@x>"));
    assert(wire.includes("References: <reply-anchor@x>"));

    // The reply is recorded in the SAME owner thread as an outbound record.
    const history = await harness.messageStore.history(OWNER, seeded.threadId, 10);
    assertEquals(history.length, 2);
    assertEquals(history[1].direction, "outbound");
    assertEquals(history[1].inReplyTo, "<reply-anchor@x>");
    assertEquals(history[1].to, SENDER);
    assertEquals(history[1].operationKey, { workId: "work-reply", actionSlot: "reply" });
    assertEquals(result.messageId, history[1].recordId);
  });
});

Deno.test("EmailAdapter - a reply and a file delivery in one work use distinct operation slots", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<slots@x>" }),
      { messageId: "<slots@x>", subject: "Slots" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);
    const emailSend = { workId: "work-slots", owner: OWNER };

    const reply = await harness.adapter.sendReply(channel, "First the text.", {
      replyToMessageId: seeded.recordId,
      emailSend,
    });
    const files = await harness.adapter.sendFile(
      channel,
      [{ content: new TextEncoder().encode("file payload"), fileName: "note.txt" }],
      { replyToMessageId: seeded.recordId, comment: "And the file.", emailSend },
    );

    assertEquals(reply.success, true);
    assertEquals(files.success, true);
    // Two logical operations, two SMTP transactions: the file delivery is NOT deduplicated
    // into the earlier reply.
    assertEquals(harness.smtp.submissions.length, 2);
    assertEquals(harness.smtp.submissions[1].envelope.to, [SENDER]);
    assert(decode(harness.smtp.submissions[1].emlBytes).includes("note.txt"));

    const replyOutcome = harness.mailService.lookup(OWNER, {
      workId: "work-slots",
      actionSlot: "reply",
    });
    const filesOutcome = harness.mailService.lookup(OWNER, {
      workId: "work-slots",
      actionSlot: "files",
    });
    assert(replyOutcome, "the reply slot is recorded");
    assert(filesOutcome, "the files slot is recorded");
    assertEquals(replyOutcome.operationId !== filesOutcome.operationId, true);

    // A partitioned host slot is honoured verbatim for non-ordinary operations.
    const reminder = await harness.adapter.sendReply(channel, "Reminder body.", {
      replyToMessageId: seeded.recordId,
      emailSend: { workId: "work-slots", owner: OWNER, actionSlot: "reminder:r-1" },
    });
    assertEquals(reminder.success, true);
    assert(harness.mailService.lookup(OWNER, { workId: "work-slots", actionSlot: "reminder:r-1" }));
    assertEquals(harness.smtp.submissions.length, 3);
  });
});

Deno.test("EmailAdapter - sending without a host operation context is refused, never guessed", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<refuse@x>" }),
      { messageId: "<refuse@x>", subject: "Refusals" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);

    // No context at all.
    let result = await harness.adapter.sendReply(channel, "hello");
    assertEquals(result.success, false);
    assert(result.error?.includes("operation context"));

    // A context for a different owner.
    result = await harness.adapter.sendReply(channel, "hello", {
      emailSend: { workId: "w", owner: `e_${"c".repeat(64)}` },
    });
    assertEquals(result.success, false);

    // A context without a work id.
    result = await harness.adapter.sendReply(channel, "hello", {
      emailSend: { workId: "  ", owner: OWNER },
    });
    assertEquals(result.success, false);

    // An anchor that is not part of this thread.
    result = await harness.adapter.sendReply(channel, "hello", {
      replyToMessageId: crypto.randomUUID().toLowerCase(),
      emailSend: { workId: "w", owner: OWNER },
    });
    assertEquals(result.success, false);

    // Model-supplied data in `platformSpecific` must never stand in for the context.
    result = await harness.adapter.sendReply(channel, "hello", {
      platformSpecific: { emailSend: { workId: "model", owner: OWNER } },
    });
    assertEquals(result.success, false);

    // A malformed channel id.
    result = await harness.adapter.sendReply("mail:not-an-owner:not-a-thread", "hello", {
      emailSend: { workId: "w", owner: OWNER },
    });
    assertEquals(result.success, false);

    // A file delivery is refused the same way.
    const files = await harness.adapter.sendFile(
      channel,
      [{ content: new TextEncoder().encode("x"), fileName: "a.txt" }],
    );
    assertEquals(files.success, false);

    assertEquals(harness.smtp.submissions.length, 0, "no refusal may reach SMTP");
  });
});

Deno.test("EmailAdapter - a source without wire identifiers is refused instead of unthreaded", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    // An inbound record whose source carries neither Message-ID nor References.
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ subject: "No wire ids" }),
      { subject: "No wire ids" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);

    const result = await harness.adapter.sendReply(channel, "Answer.", {
      emailSend: { workId: "work-no-wire", owner: OWNER },
    });
    assertEquals(result.success, false);
    assert(result.error?.includes("wire identifiers"));
    assertEquals(harness.smtp.submissions.length, 0);
  });
});

Deno.test("EmailAdapter - stored sender that does not match the thread owner is not a recipient", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    // Seed a record whose stored `from` is NOT the owner's verified address.
    const recordId = await harness.messageStore.putSource(
      OWNER,
      rawMessage({ messageId: "<mismatch@x>" }),
      {
        from: "someone-else@another-domain.org",
        subject: "Mismatch",
        plainBody: "body",
        wireIds: { messageId: "<mismatch@x>" },
      },
    );
    const record = await harness.messageStore.getByOwnerRecord(OWNER, recordId);
    assert(record);
    const channel = formatEmailChannelId(OWNER, record.threadId);

    const result = await harness.adapter.sendReply(channel, "Answer.", {
      replyToMessageId: recordId,
      emailSend: { workId: "work-mismatch", owner: OWNER },
    });
    assertEquals(result.success, false);
    assert(result.error?.includes("verified recipient"));
    assertEquals(harness.smtp.submissions.length, 0);
  });
});

Deno.test("EmailAdapter - an explicit anchor older than 200 records resolves durably", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const anchor = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<original@x>", subject: "Original subject" }),
      { messageId: "<original@x>", subject: "Original subject", body: "Original body." },
    );
    const channel = formatEmailChannelId(OWNER, anchor.threadId);

    // 200 newer records push the retained anchor out of every bounded window and
    // leave an ALL-OUTBOUND recent suffix (no recent inbound source at all).
    for (let i = 0; i < 200; i++) {
      await seedOutbound(harness.messageStore, anchor.threadId, i, {
        subject: `Different subject ${i}`,
        inReplyTo: "<original@x>",
        label: "aged",
      });
    }
    const recent = await harness.messageStore.history(OWNER, anchor.threadId, 200);
    assertEquals(recent.length, 200);
    assertEquals(recent.every((record) => record.direction === "outbound"), true);
    assert(
      !recent.some((record) => record.recordId === anchor.recordId),
      "the retained anchor is outside the bounded recent window",
    );

    const result = await harness.adapter.sendReply(channel, "Answer body.", {
      replyToMessageId: anchor.recordId,
      emailSend: { workId: "work-aged", owner: OWNER },
    });

    assert(result.success, result.error);
    assertEquals(harness.smtp.submissions.length, 1);
    assertEquals(harness.smtp.submissions[0].envelope.to, [SENDER]);
    const wire = decode(harness.smtp.submissions[0].emlBytes);
    assert(wire.includes("In-Reply-To: <original@x>"), "threading uses the retained anchor");
    assert(wire.includes("References: <original@x>"));
    assert(wire.includes("Subject: Re: Original subject"), "the selected anchor's subject");
    assert(!wire.includes("Different subject"), "no newer record's subject is inherited");

    // The delivery is durably recorded in the ORIGIN thread.
    const [latest] = await harness.messageStore.history(OWNER, anchor.threadId, 1);
    assertEquals(latest.direction, "outbound");
    assertEquals(latest.inReplyTo, "<original@x>");
    assertEquals(latest.subject, "Re: Original subject");
  });
});

Deno.test("EmailAdapter - an explicit outbound anchor threads to it and uses the thread's inbound source", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const root = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<root@x>", subject: "Thread root" }),
      { messageId: "<root@x>", subject: "Thread root", body: "Root body." },
    );
    // The selected explicit anchor is an OUTBOUND record retained outside the
    // recent window; the recipient must still come from this thread's inbound root.
    const selected = await seedOutbound(harness.messageStore, root.threadId, 7, {
      subject: "Chosen outbound",
      inReplyTo: "<root@x>",
      label: "chosen",
    });
    for (let i = 0; i < 200; i++) {
      await seedOutbound(harness.messageStore, root.threadId, i, {
        subject: `Newer subject ${i}`,
        inReplyTo: "<root@x>",
        label: "newer",
      });
    }
    const channel = formatEmailChannelId(OWNER, root.threadId);

    const result = await harness.adapter.sendReply(channel, "Answer body.", {
      replyToMessageId: selected.recordId,
      emailSend: { workId: "work-outbound-anchor", owner: OWNER },
    });

    assert(result.success, result.error);
    assertEquals(harness.smtp.submissions.length, 1);
    assertEquals(harness.smtp.submissions[0].envelope.to, [SENDER]);
    const wire = decode(harness.smtp.submissions[0].emlBytes);
    assert(wire.includes(`In-Reply-To: ${selected.wireMessageId}`));
    assert(wire.includes(`References: ${selected.wireMessageId}`));
    assert(wire.includes("Subject: Re: Chosen outbound"));
    assert(!wire.includes("Newer subject"), "no substitute anchor is chosen");
  });
});

Deno.test("EmailAdapter - an outbound anchor with no same-thread inbound source is refused", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    // A verified inbound source exists for this owner, but in ANOTHER thread. It
    // must never stand in for the explicit anchor's own thread.
    await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<other-thread@x>" }),
      { messageId: "<other-thread@x>", subject: "Other thread" },
    );
    assert(await harness.messageStore.ownerVerifiedAddress(OWNER));

    // An outbound-only thread (no reply linkage) has no inbound source of its own.
    const lonely = await seedOutbound(harness.messageStore, undefined, 99, {
      subject: "Outbound only",
      label: "lonely",
    });
    assertEquals(
      await harness.messageStore.threadInboundRecipient(OWNER, lonely.threadId),
      undefined,
      "the lookup is thread-scoped, not owner-wide",
    );

    const result = await harness.adapter.sendReply(
      formatEmailChannelId(OWNER, lonely.threadId),
      "Answer body.",
      {
        replyToMessageId: lonely.recordId,
        emailSend: { workId: "work-no-inbound", owner: OWNER },
      },
    );

    assertEquals(result.success, false);
    assert(result.error?.includes("verified recipient"));
    assertEquals(harness.smtp.submissions.length, 0);
  });
});

Deno.test("EmailAdapter - the implicit latest anchor keeps its bounded behavior", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const anchor = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<implicit-root@x>", subject: "Implicit root" }),
      { messageId: "<implicit-root@x>", subject: "Implicit root" },
    );
    await seedOutbound(harness.messageStore, anchor.threadId, 1, {
      subject: "First reply",
      inReplyTo: "<implicit-root@x>",
      label: "implicit",
    });
    const latest = await seedOutbound(harness.messageStore, anchor.threadId, 2, {
      subject: "Latest reply",
      inReplyTo: "<implicit-root@x>",
      label: "implicit",
    });
    const channel = formatEmailChannelId(OWNER, anchor.threadId);

    const result = await harness.adapter.sendReply(channel, "Answer body.", {
      emailSend: { workId: "work-implicit", owner: OWNER },
    });
    assert(result.success, result.error);
    const wire = decode(harness.smtp.submissions[0].emlBytes);
    assert(wire.includes(`In-Reply-To: ${latest.wireMessageId}`));
    assert(wire.includes("Subject: Re: Latest reply"));
    assertEquals(harness.smtp.submissions[0].envelope.to, [SENDER]);

    // The implicit sender/anchor selection stays bounded: with the retained inbound
    // anchor outside the last 200 all-outbound records, an implicit send is refused
    // instead of widening the window.
    for (let i = 0; i < 200; i++) {
      await seedOutbound(harness.messageStore, anchor.threadId, i, {
        subject: `Suffix ${i}`,
        inReplyTo: "<implicit-root@x>",
        label: "implicit-suffix",
      });
    }
    const bounded = await harness.adapter.sendReply(channel, "Another answer.", {
      emailSend: { workId: "work-implicit-aged", owner: OWNER },
    });
    assertEquals(bounded.success, false);
    assert(bounded.error?.includes("no inbound source"));
    assertEquals(harness.smtp.submissions.length, 1);
  });
});

Deno.test("EmailAdapter - missing, malformed, cross-thread, cross-owner and unthreadable anchors are refused", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const first = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<first@x>" }),
      { messageId: "<first@x>", subject: "First thread" },
    );
    const second = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<second@x>" }),
      { messageId: "<second@x>", subject: "Second thread" },
    );
    const otherOwner = `e_${"cd".repeat(32)}`;
    const cases: Array<{ channel: string; anchor: string; owner: string }> = [
      // A retained-id-shaped record that does not exist.
      {
        channel: formatEmailChannelId(OWNER, first.threadId),
        anchor: crypto.randomUUID().toLowerCase(),
        owner: OWNER,
      },
      // A malformed record id never reaches a record.
      {
        channel: formatEmailChannelId(OWNER, first.threadId),
        anchor: "not-a-record-id",
        owner: OWNER,
      },
      // A record of ANOTHER owner thread.
      {
        channel: formatEmailChannelId(OWNER, first.threadId),
        anchor: second.recordId,
        owner: OWNER,
      },
      // A record of ANOTHER owner.
      {
        channel: formatEmailChannelId(otherOwner, first.threadId),
        anchor: first.recordId,
        owner: otherOwner,
      },
    ];

    for (const [index, anchorCase] of cases.entries()) {
      const result = await harness.adapter.sendReply(anchorCase.channel, "Answer.", {
        replyToMessageId: anchorCase.anchor,
        emailSend: { workId: `work-refusal-${index}`, owner: anchorCase.owner },
      });
      assertEquals(result.success, false, `case ${index} is refused`);
      assertEquals(harness.smtp.submissions.length, 0, `case ${index} never reaches SMTP`);
    }

    // A retained record without usable wire identifiers is refused on the EXPLICIT path.
    const unthreadable = await seedInbound(
      harness.messageStore,
      rawMessage({ subject: "No wire ids" }),
      { subject: "No wire ids" },
    );
    const refused = await harness.adapter.sendReply(
      formatEmailChannelId(OWNER, unthreadable.threadId),
      "Answer.",
      {
        replyToMessageId: unthreadable.recordId,
        emailSend: { workId: "work-unthreadable-explicit", owner: OWNER },
      },
    );
    assertEquals(refused.success, false);
    assert(refused.error?.includes("wire identifiers"));
    assertEquals(harness.smtp.submissions.length, 0);
  });
});

Deno.test("EmailAdapter - an unreadable archive refuses an explicit anchor instead of guessing", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const anchor = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<closed@x>" }),
      { messageId: "<closed@x>", subject: "Closed archive" },
    );
    harness.messageStore.close();

    const result = await harness.adapter.sendReply(
      formatEmailChannelId(OWNER, anchor.threadId),
      "Answer.",
      {
        replyToMessageId: anchor.recordId,
        emailSend: { workId: "work-closed-archive", owner: OWNER },
      },
    );
    assertEquals(result.success, false);
    assert(result.error?.includes("not a retained record"));
    assertEquals(harness.smtp.submissions.length, 0);
  });
});

Deno.test("EmailAdapter - unknown submission is reported as not delivered and never retried blindly", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<unknown@x>" }),
      { messageId: "<unknown@x>", subject: "Unknown" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);
    const emailSend = { workId: "work-unknown", owner: OWNER };
    harness.smtp.mode = "unknown";

    const result = await harness.adapter.sendReply(channel, "Body.", {
      replyToMessageId: seeded.recordId,
      emailSend,
    });
    assertEquals(result.success, false);
    assertEquals(result.emailSubmission?.phase, "unknown");
    assertEquals(result.messageId, undefined, "no message id is claimed while uncertain");
    assert(result.error?.includes("unknown"));
    assertEquals(harness.smtp.submissions.length, 1);

    // The same logical operation never submits a second copy.
    const repeat = await harness.adapter.sendReply(channel, "Body.", {
      replyToMessageId: seeded.recordId,
      emailSend,
    });
    assertEquals(repeat.success, false);
    assertEquals(harness.smtp.submissions.length, 1);
    assertEquals(repeat.emailSubmission?.operationId, result.emailSubmission?.operationId);
  });
});

Deno.test("EmailAdapter - unsupported edit, reaction and typing are explicit and silent", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<unsupported@x>" }),
      { messageId: "<unsupported@x>", subject: "Unsupported" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);

    assertEquals(harness.adapter.capabilities.supportsEditing, false);
    assertEquals(harness.adapter.capabilities.supportsReactions, false);
    assertEquals(harness.adapter.capabilities.canSearchMessages, false);
    assertEquals(harness.adapter.supportsTypingIndicator(), false);

    const edit = await harness.adapter.editMessage(channel, seeded.recordId, "new text");
    assertEquals(edit.success, false);
    assert(edit.error?.includes("cannot edit"));

    const reaction = await harness.adapter.addReaction(channel, seeded.recordId, "👍");
    assertEquals(reaction.success, false);
    assert(reaction.error?.includes("cannot add a reaction"));

    await harness.adapter.sendTyping(channel);
    assertEquals(await harness.adapter.fetchEmojis(), []);
    assertEquals(await harness.adapter.hasBotReaction(channel, seeded.recordId), false);
    assertEquals(await harness.adapter.hasBotMention(channel, seeded.recordId), false);

    // Not one of the unsupported operations may produce a message.
    assertEquals(harness.smtp.submissions.length, 0);
    assertEquals(harness.sentCopy.appended.length, 0);
  });
});

Deno.test("EmailAdapter - an oversized file batch fails entirely before construction", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, {
      pollTransport: new SentCopyImap(),
      config: { maxMessageBytes: 2048 },
    });
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<oversize@x>" }),
      { messageId: "<oversize@x>", subject: "Oversize" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);

    const files = await harness.adapter.sendFile(
      channel,
      [{ content: new Uint8Array(4096).fill(0x41), fileName: "big.bin" }],
      {
        replyToMessageId: seeded.recordId,
        emailSend: { workId: "work-oversize", owner: OWNER },
      },
    );

    assertEquals(files.success, false);
    assertEquals(files.messageIds, undefined, "a failed batch claims no delivered message");
    assertEquals(harness.smtp.submissions.length, 0, "nothing reaches SMTP");
    assertEquals(harness.sentCopy.appended.length, 0);
  });
});

Deno.test("EmailAdapter - file delivery reports one submitted message, never partial delivery", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<files@x>" }),
      { messageId: "<files@x>", subject: "Files" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);

    const files = await harness.adapter.sendFile(
      channel,
      [
        { content: new TextEncoder().encode("first"), fileName: "first.txt" },
        { content: new TextEncoder().encode("second"), fileName: "second.pdf" },
      ],
      {
        replyToMessageId: seeded.recordId,
        comment: "Two attachments.",
        emailSend: { workId: "work-files", owner: OWNER },
      },
    );

    assertEquals(files.success, true);
    assertEquals(files.messageIds?.length, 1);
    assertEquals(files.emailSubmission?.phase, "submitted");
    assertEquals(harness.smtp.submissions.length, 1, "one email carries the whole batch");

    const wire = decode(harness.smtp.submissions[0].emlBytes);
    assert(wire.includes("first.txt"));
    assert(wire.includes("second.pdf"));
    assert(wire.includes("application/pdf"), "the media type follows the filename");
    assert(wire.includes("In-Reply-To: <files@x>"));
  });
});

Deno.test("EmailAdapter - integration: a received message is answered in its own thread", async () => {
  await withTempDir(async (base) => {
    const service = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT,
      password: PASSWORD,
      uidValidity: UID_VALIDITY,
      uidNext: 101,
    });
    await service.start();
    try {
      const harness = buildHarness(base, {
        pollTransport: new EmailImapClient({
          config: fixtureImapConfig(service),
          tlsCa: service.caCert,
        }),
        workIdFactory: () => "work-inbound",
        imapPort: service.port,
      });

      await harness.adapter.connect();
      service.addMessage({
        uid: 101,
        rawMime: rawMessage({ messageId: "<smoke-101@x>", subject: "Smoke", body: "Question?" }),
      });
      await harness.adapter.poll();
      assertEquals(harness.events.length, 1);

      const event = harness.events[0];
      const result = await harness.adapter.sendReply(event.channelId, "Answer!", {
        replyToMessageId: event.messageId,
        emailSend: { workId: event.emailWork!.workId, owner: event.userId },
      });

      assertEquals(result.success, true);
      assertEquals(harness.smtp.submissions.length, 1);
      assertEquals(harness.smtp.submissions[0].envelope.to, [SENDER]);
      assertEquals(harness.sentCopy.folders, ["Sent"]);

      // The answer is in the thread the source established.
      const parsed = parseEmailChannelId(event.channelId);
      const history = await harness.messageStore.history(parsed.owner, parsed.threadId, 10);
      assertEquals(history.map((record) => record.direction), ["inbound", "outbound"]);

      await harness.adapter.disconnect();
    } finally {
      await service.stop();
    }
  });
});

Deno.test("EmailAdapter - FileHandler and ReplyHandler forward email submission metadata", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<skills@x>" }),
      { messageId: "<skills@x>", subject: "Skills" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);

    const workspacePath = join(base, "workspace");
    await Deno.mkdir(workspacePath, { recursive: true });
    await Deno.writeTextFile(join(workspacePath, "note.txt"), "workspace file");

    const workspace: WorkspaceInfo = {
      key: `email/${OWNER}`,
      components: { platform: "email", userId: OWNER },
      path: workspacePath,
      tmpPath: join(workspacePath, "tmp"),
      isDm: true,
    };
    const context: SkillContext = {
      workspace,
      platformAdapter: harness.adapter,
      channelId: channel,
      userId: OWNER,
      replyToMessageId: seeded.recordId,
      emailSend: { workId: "work-skills", owner: OWNER },
    };

    // send-reply: metadata is returned with the success result.
    const replyHandler = new ReplyHandler();
    const reply = await replyHandler.handleSendReply({ message: "Skill reply." }, context);
    assertEquals(reply.success, true);
    assertEquals(reply.emailSubmission?.phase, "submitted");
    const replyData = reply.data as { messageId?: string };
    assertEquals(replyData.messageId !== undefined, true);

    // send-file: the configured count limit fails the whole request before any send.
    const limiting = new FileHandler({ enabled: true, maxFilesPerInvocation: 1 });
    const tooMany = await limiting.handleSendFile(
      { filePaths: ["note.txt", "note.txt"] },
      context,
    );
    assertEquals(tooMany.success, false);
    assert(tooMany.error?.includes("Too many files"));
    assertEquals(harness.smtp.submissions.length, 1, "the preflight failure sends nothing");

    // send-file: the same host context delivers one file and reports the submission.
    const fileHandler = new FileHandler({ enabled: true, allowedExtensions: [".txt"] });
    const files = await fileHandler.handleSendFile({ filePaths: ["note.txt"] }, context);
    assertEquals(files.success, true);
    assertEquals(files.emailSubmission?.phase, "submitted");
    assertEquals(harness.smtp.submissions.length, 2);

    // edit-reply on an email session fails explicitly without any send.
    const edit = await replyHandler.handleEditReply(
      { messageId: replyData.messageId, message: "changed" },
      context,
    );
    assertEquals(edit.success, false);
    assertEquals(edit.code, "SKILL_EDIT_UNSUPPORTED");
    assertEquals(harness.smtp.submissions.length, 2);
  });
});

Deno.test("EmailAdapter - getDmChannelId and spontaneous targets stay inside enabled accounts", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });

    const channelId = await harness.adapter.getDmChannelId(OWNER);
    assert(channelId);
    const parsed = parseEmailChannelId(channelId);
    assertEquals(parsed.owner, OWNER);

    // Not an owner id, or an owner without an enabled account channel.
    assertEquals(await harness.adapter.getDmChannelId("alice@allowed-domain.org"), null);
    assertEquals(await harness.adapter.getDmChannelId(`e_${"d".repeat(64)}`), null);

    const config = { channels: CHANNELS } as unknown as Config;
    assertEquals(await harness.adapter.determineSpontaneousTarget(config), null);

    const spontaneousConfig = {
      channels: [{ id: `email/account/${OWNER}`, enabled: true, spontaneousPost: true }],
    } as unknown as Config;
    const target = await harness.adapter.determineSpontaneousTarget(spontaneousConfig);
    assert(target);
    assertEquals(parseEmailChannelId(target.channelId).owner, OWNER);

    // Identity helpers.
    assertEquals(harness.adapter.isSelf(normalizeEmailMailbox(BOT).userId), true);
    assertEquals(harness.adapter.isSelf(OWNER), false);
    assertEquals(harness.adapter.getBotId(), normalizeEmailMailbox(BOT).userId);
    assertEquals(await harness.adapter.getUsername(OWNER), OWNER);
  });
});

Deno.test("EmailAdapter - a disconnect during the first round stops the poller instead of orphaning it", async () => {
  await withTempDir(async (base) => {
    // The first round blocks inside the transport, so the disconnect provably lands while
    // `connect()` is still running.
    const gate = Promise.withResolvers<void>();
    let connectCalls = 0;

    class GatedImap extends SentCopyImap {
      override async connect(): Promise<void> {
        connectCalls++;
        await gate.promise;
      }
    }

    const harness = buildHarness(base, { pollTransport: new GatedImap() });
    const connecting = harness.adapter.connect();
    const disconnecting = harness.adapter.disconnect();
    gate.resolve();
    await connecting;
    await disconnecting;

    assertEquals(harness.adapter.getConnectionStatus().state, "disconnected");

    // The repeating timer was never armed: a later round is refused as stopped.
    const round = await harness.adapter.poll();
    assertEquals(round.halted, true);
    assertEquals(round.accepted, 0);
    assert(connectCalls >= 1);
  });
});

Deno.test("EmailAdapter - concurrent connects start the poller exactly once", async () => {
  await withTempDir(async (base) => {
    const gate = Promise.withResolvers<void>();
    let connectCalls = 0;

    class GatedImap extends SentCopyImap {
      override async connect(): Promise<void> {
        connectCalls++;
        await gate.promise;
      }
    }

    const harness = buildHarness(base, { pollTransport: new GatedImap() });
    const first = harness.adapter.connect();
    const second = harness.adapter.connect();
    gate.resolve();
    await Promise.all([first, second]);

    assertEquals(harness.adapter.getConnectionStatus().state, "connected");
    // One start: `recover()` plus the single immediate round, never two timer chains.
    assertEquals(connectCalls, 2);

    await harness.adapter.disconnect();
    assertEquals(harness.adapter.getConnectionStatus().state, "disconnected");
  });
});

Deno.test("EmailAdapter - a fresh thread has no reply source and a reused operation is visible", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });

    // A brand-new channel from `getDmChannelId` cannot serve an ordinary reply: there is no stored
    // source message, so neither a verified recipient nor a thread anchor exists yet. The
    // new-thread delivery for scheduled and spontaneous use is owned by
    // `email-spontaneous-targets`.
    const freshChannel = await harness.adapter.getDmChannelId(OWNER);
    assert(freshChannel);
    const fresh = await harness.adapter.sendReply(freshChannel, "hello", {
      emailSend: { workId: "work-fresh", owner: OWNER },
    });
    assertEquals(fresh.success, false);
    assert(fresh.error?.includes("no stored source message"));
    assertEquals(harness.smtp.submissions.length, 0);

    // A repeated request for one logical operation returns the recorded result and is marked as
    // reused, so a host can tell a replay apart from a fresh submission.
    const seeded = await seedInbound(
      harness.messageStore,
      rawMessage({ messageId: "<reuse@x>" }),
      { messageId: "<reuse@x>", subject: "Reuse" },
    );
    const channel = formatEmailChannelId(OWNER, seeded.threadId);
    const emailSend = { workId: "work-reuse", owner: OWNER };
    const sent = await harness.adapter.sendReply(channel, "Once.", {
      replyToMessageId: seeded.recordId,
      emailSend,
    });
    assertEquals(sent.success, true);
    assertEquals(sent.emailSubmission?.reused, false);

    const replay = await harness.adapter.sendReply(channel, "Once.", {
      replyToMessageId: seeded.recordId,
      emailSend,
    });
    assertEquals(replay.success, true);
    assertEquals(replay.emailSubmission?.reused, true);
    assertEquals(replay.emailSubmission?.operationId, sent.emailSubmission?.operationId);
    assertEquals(harness.smtp.submissions.length, 1, "a replay performs no SMTP transaction");
  });
});

Deno.test("EmailAdapter - edit-reply reports the platform limitation before the session state", async () => {
  await withTempDir(async (base) => {
    const harness = buildHarness(base, { pollTransport: new SentCopyImap() });
    const workspacePath = join(base, "workspace-edit");
    await Deno.mkdir(workspacePath, { recursive: true });

    const context: SkillContext = {
      workspace: {
        key: `email/${OWNER}`,
        components: { platform: "email", userId: OWNER },
        path: workspacePath,
        tmpPath: join(workspacePath, "tmp"),
        isDm: true,
      },
      platformAdapter: harness.adapter,
      channelId: `mail:${OWNER}:${crypto.randomUUID().toLowerCase()}`,
      userId: OWNER,
    };

    // No reply has been sent in this session, yet the real reason is reported.
    const edit = await new ReplyHandler().handleEditReply(
      { messageId: crypto.randomUUID().toLowerCase(), message: "changed" },
      context,
    );
    assertEquals(edit.success, false);
    assertEquals(edit.code, "SKILL_EDIT_UNSUPPORTED");
    assert(edit.error?.includes("not supported"));
    assertEquals(harness.smtp.submissions.length, 0);
  });
});

Deno.test("EmailAdapter - smoke: real IMAP and SMTP services carry a threaded answer end to end", async () => {
  await withTempDir(async (base) => {
    const imapService = new EmailImapTestService({
      tlsMode: "tls",
      username: BOT,
      password: PASSWORD,
      uidValidity: UID_VALIDITY,
      uidNext: 101,
    });
    const smtpService = new EmailSmtpTestService({
      tlsMode: "tls",
      username: BOT,
      password: PASSWORD,
    });
    await imapService.start();
    await smtpService.start();
    try {
      // Both protocol services are real (sockets, TLS handshakes, local CA); only the model and
      // ACP layers are absent from this boundary.
      const transport = new EmailImapClient({
        config: fixtureImapConfig(imapService),
        tlsCa: imapService.caCert,
      });
      const harness = buildHarness(base, {
        pollTransport: transport,
        sentCopyTransport: transport,
        smtpTransport: new EmailSmtpClient({
          config: { ...emailConfig().smtp, port: smtpService.port },
          tlsCa: smtpService.caCert,
          timeoutMs: 5_000,
        }),
        imapPort: imapService.port,
        workIdFactory: () => "work-smoke",
      });

      await harness.adapter.connect();
      imapService.addMessage({
        uid: 101,
        rawMime: rawMessage({
          messageId: "<smoke-e2e@x>",
          subject: "Smoke E2E",
          body: "Question?",
        }),
      });
      await harness.adapter.poll();
      assertEquals(harness.events.length, 1);
      const event = harness.events[0];

      const result = await harness.adapter.sendReply(event.channelId, "Answer over the wire.", {
        replyToMessageId: event.messageId,
        emailSend: { workId: event.emailWork!.workId, owner: event.userId },
      });

      assertEquals(result.success, true);
      assertEquals(result.emailSubmission?.phase, "submitted");
      assertEquals(result.emailSubmission?.safeCode, SmtpDiagnosticCode.ACCEPTED);
      // The sent copy is reported as appended only because the real IMAP APPEND succeeded.
      assertEquals(result.emailSubmission?.sentCopy, "appended");

      // Exactly one DATA transaction, one envelope recipient, byte-identical message reuse.
      assertEquals(smtpService.dataTransactionCount, 1);
      const transaction = smtpService.dataTransactions[0];
      assertEquals(transaction.recipients, [SENDER]);
      assertEquals(transaction.envelopeFrom, BOT);
      const wire = decode(transaction.decoded);
      assert(wire.includes("In-Reply-To: <smoke-e2e@x>"));
      assert(wire.includes("References: <smoke-e2e@x>"));
      assert(wire.includes("Auto-Submitted: auto-generated"));
      assertEquals(wire.split("AIr-Friends Bot").length - 1, 1, "the signature is applied once");

      // The durable history holds the answer in the thread the source established.
      const parsedChannel = parseEmailChannelId(event.channelId);
      const history = await harness.messageStore.history(
        parsedChannel.owner,
        parsedChannel.threadId,
        10,
      );
      assertEquals(history.map((record) => record.direction), ["inbound", "outbound"]);
      assertEquals(history[1].to, SENDER);

      await harness.adapter.disconnect();
    } finally {
      await imapService.stop();
      await smtpService.stop();
    }
  });
});
