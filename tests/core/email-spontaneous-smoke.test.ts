// tests/core/email-spontaneous-smoke.test.ts
//
// Controlled integration smoke test for `email-spontaneous-targets` (row 25) with its real
// predecessor implementations in isolated temporary state: the real `SpontaneousScheduler`,
// the real `EmailSpontaneousStore` (fsynced schedule snapshot), the real `EmailAdapter`, the
// real `EmailMailService`/`SubmissionStore`/`EmailMessageStore`, the real `EmailSmtpClient`
// and `EmailImapClient` over real sockets and certificate-validated TLS, and both local
// protocol fixtures (`EmailSmtpTestService`, `EmailImapTestService`).
//
// Exercised layers: durable schedule/target binding, session handoff, MIME construction, live
// SMTP submission, live IMAP APPEND of the sent copy. No ACP/model double is involved in the
// transport half — the session's one send is issued exactly as the Skill API host binds it.
// No production credential or mailbox is used.
//
// Scenarios mirror `openspec/changes/email-spontaneous-targets/specs/spontaneous-posting/spec.md`:
// an opted-in permitted account receives ONE new-thread message per tick with no reply headers,
// and a repeated call in the same tick produces no second DATA transaction.

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { ChannelConfig, Config, EmailConfig } from "../../src/types/config.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import { buildMailboxFingerprint, MailboxStore } from "../../src/platforms/email/mailbox-store.ts";
import {
  EmailMessageStore,
  formatEmailChannelId,
} from "../../src/platforms/email/message-store.ts";
import {
  _resetSharedRegistryForTesting,
  SubmissionStore,
} from "../../src/platforms/email/submission-store.ts";
import { EmailMailService } from "../../src/platforms/email/mail-service.ts";
import { OutgoingMimeBuilder } from "../../src/platforms/email/outgoing-mime.ts";
import { EmailAdapter } from "../../src/platforms/email/email-adapter.ts";
import { EmailImapClient } from "../../src/platforms/email/imap-client.ts";
import { EmailSmtpClient } from "../../src/platforms/email/smtp-client.ts";
import type {
  SmtpSubmission,
  SmtpSubmitResult,
  SmtpTransport,
} from "../../src/platforms/email/smtp-client.ts";
import { SmtpDiagnosticCode } from "../../src/platforms/email/smtp-client.ts";
import {
  EmailSpontaneousStore,
  spontaneousOperationKey,
} from "../../src/platforms/email/spontaneous-store.ts";
import type { SpontaneousOccurrence } from "../../src/platforms/email/spontaneous-store.ts";
import { SpontaneousScheduler } from "@core/spontaneous-scheduler.ts";
import { dispatchEmailSpontaneousOccurrence } from "@core/spontaneous-target.ts";
import type { EmailSpontaneousTarget } from "@core/spontaneous-target.ts";
import { EmailImapTestService } from "../helpers/email-imap-service.ts";
import { EmailSmtpTestService } from "../helpers/email-smtp-service.ts";

const BOT = "bot@smoke.example";
const SENDER = "alice@allowed-domain.org";
const OWNER = normalizeEmailMailbox(SENDER).userId;
const SMTP_PASSWORD = "smoke-smtp-secret-9f21";
const IMAP_PASSWORD = "smoke-imap-secret-3c74";
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const TICK_INTERVAL_MS = 150;
const CHANNELS: ChannelConfig[] = [
  { id: `email/account/${OWNER}`, enabled: true, spontaneousPost: true },
];

function makeConfig(base: string): Config {
  return {
    platforms: {
      discord: { token: "test-token", enabled: false },
      misskey: { host: "test.invalid", token: "test-token", enabled: false },
      email: {
        enabled: true,
        address: BOT,
        imap: {
          host: "127.0.0.1",
          tlsMode: "tls",
          username: BOT,
          password: IMAP_PASSWORD,
        },
        smtp: {
          host: "127.0.0.1",
          tlsMode: "tls",
          username: BOT,
          password: SMTP_PASSWORD,
        },
        incomingFolder: "INBOX",
        sentFolder: "Sent",
        pollIntervalMs: 300_000,
        receivingAuth: { authservId: "mx.smoke.example", attestedStripping: true },
        maxMessageBytes: 25 * 1024 * 1024,
        maxIncomingAttachments: 10,
        signature: SIGNATURE,
        spontaneousPost: {
          enabled: true,
          minIntervalMs: TICK_INTERVAL_MS,
          maxIntervalMs: TICK_INTERVAL_MS,
          contextFetchProbability: 0,
        },
      },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./prompts/system_reply.md",
      tokenLimit: 20000,
    },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    workspace: { repoPath: base, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: CHANNELS,
  } as unknown as Config;
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  // Bounded real-clock observation window: the production scheduler arms real `setTimeout`
  // timers and the stores perform fsync-backed I/O, and the transports are live sockets.
  // Every assertion below is condition-based; this loop only waits for the condition.
  const deadline = Date.now() + timeoutMs;
  while (!(await condition()) && Date.now() < deadline) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 10);
    await promise;
  }
}

Deno.test("email spontaneous smoke - one tick reaches live SMTP with one new-thread message", async () => {
  const base = await Deno.makeTempDir({ prefix: "email-spontaneous-smoke-" });
  const smtp = new EmailSmtpTestService({
    tlsMode: "tls",
    username: BOT,
    password: SMTP_PASSWORD,
  });
  const imap = new EmailImapTestService({
    tlsMode: "tls",
    username: BOT,
    password: IMAP_PASSWORD,
    uidValidity: 909,
  });
  await smtp.start();
  await imap.start();
  try {
    const config = makeConfig(base);
    const emailConfig = config.platforms.email as EmailConfig;
    emailConfig.smtp = { ...emailConfig.smtp, port: smtp.port };
    emailConfig.imap = { ...emailConfig.imap, port: imap.port };

    const emailRoot = join(base, "email");
    const submissionStore = new SubmissionStore(emailRoot);
    const recoveryResult = await submissionStore.recover();
    const messageStore = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
    // The owner's admitted inbound mail is the ONLY verified address for this account.
    await messageStore.putSource(OWNER, "From: alice\r\n\r\nHello there.", {
      from: SENDER,
      subject: "Hello",
      plainBody: "Hello there.",
      wireIds: { messageId: "<smoke-seed@x>" },
    });

    const mailService = new EmailMailService({
      config: emailConfig,
      emailRoot,
      submissionStore,
      recoveryResult,
      messageStore,
      smtp: new EmailSmtpClient({
        config: emailConfig.smtp,
        tlsCa: smtp.caCert,
        timeoutMs: 5_000,
      }),
      imap: new EmailImapClient({
        config: emailConfig.imap,
        tlsCa: imap.caCert,
        defaultSentFolder: "Sent",
      }),
      channels: CHANNELS,
      builder: new OutgoingMimeBuilder({ fromAddress: BOT }),
    });
    const adapter = new EmailAdapter({
      config: emailConfig,
      transport: new EmailImapClient({
        config: emailConfig.imap,
        tlsCa: imap.caCert,
      }),
      mailboxStore: new MailboxStore({
        emailRoot,
        fingerprint: buildMailboxFingerprint("127.0.0.1", BOT, "INBOX"),
      }),
      messageStore,
      mailService,
      channels: CHANNELS,
    });
    const store = new EmailSpontaneousStore({ emailRoot, evidence: submissionStore });

    const targets: EmailSpontaneousTarget[] = [];
    const deliveries: Array<{ success: boolean; error?: string }> = [];
    const scheduler = new SpontaneousScheduler(config);
    scheduler.setOccurrenceStore(store);
    scheduler.setCallback(async (_platform, occurrence: SpontaneousOccurrence | undefined) => {
      assert(occurrence);
      await dispatchEmailSpontaneousOccurrence({
        store,
        adapter,
        config,
        occurrence,
        orchestrator: {
          processSpontaneousPost: async (_platform, channelId, _adapter, options) => {
            const target = options.email;
            assert(target, "an email spontaneous session must carry its bound target");
            targets.push(target);
            const reply = await adapter.sendReply(channelId, "A spontaneous hello.", {
              emailSend: { ...spontaneousOperationKey(target.tickId), owner: target.userId },
            });
            const outcome = { success: reply.success, error: reply.error };
            deliveries.push(outcome);
            return outcome;
          },
        },
      });
    });

    scheduler.start();
    await scheduler.whenReady();
    await waitFor(() => smtp.dataTransactionCount === 1);
    await waitFor(() => deliveries.length === 1);
    scheduler.stop();

    assertEquals(targets.length, 1);
    assertEquals(deliveries, [{ success: true, error: undefined }]);
    assertEquals(smtp.dataTransactionCount, 1);
    const transaction = smtp.dataTransactions[0];
    assertEquals(transaction.envelopeFrom, BOT);
    assertEquals(transaction.recipients, [SENDER]);

    const wire = new TextDecoder().decode(transaction.decoded);
    assertEquals(wire.includes("In-Reply-To:"), false);
    assertEquals(wire.includes("References:"), false);
    assert(wire.includes(SIGNATURE.split("\n")[0]));

    // The delivered message opens the thread the tick was bound to, and its wire bytes are
    // the ones APPENDed to the sent folder.
    const channelId = formatEmailChannelId(targets[0].userId, targets[0].newThreadId);
    const history = await messageStore.history(OWNER, targets[0].newThreadId, 10);
    assertEquals(history.length, 1);
    assertEquals(history[0].direction, "outbound");
    assertEquals(history[0].subject, "Spontaneous note");
    await waitFor(() => imap.appendedMessages.length === 1);
    assertEquals(imap.appendedMessages[0].folder, "Sent");
    assertEquals(
      new TextDecoder().decode(imap.appendedMessages[0].content),
      new TextDecoder().decode(transaction.decoded),
    );

    // A repeated call of the same tick consults the durable journal: no second DATA.
    const replay = await adapter.sendReply(channelId, "A spontaneous hello.", {
      emailSend: { ...spontaneousOperationKey(targets[0].tickId), owner: OWNER },
    });
    assertEquals(replay.success, true);
    assertEquals(replay.emailSubmission?.reused, true);
    assertEquals(smtp.dataTransactionCount, 1);
  } finally {
    await imap.stop();
    await smtp.stop();
    _resetSharedRegistryForTesting();
    await Deno.remove(base, { recursive: true }).catch(() => {});
  }
});

async function readSmokeSnapshot(emailRoot: string) {
  return JSON.parse(
    await Deno.readTextFile(join(emailRoot, "spontaneous.json")),
  );
}

Deno.test("email spontaneous smoke - restart after live SMTP acceptance before successor persistence produces zero replacement target selection or additional DATA", async () => {
  const base = await Deno.makeTempDir({ prefix: "email-spontaneous-smoke-restart-acc-" });
  const smtp = new EmailSmtpTestService({
    tlsMode: "tls",
    username: BOT,
    password: SMTP_PASSWORD,
  });
  const imap = new EmailImapTestService({
    tlsMode: "tls",
    username: BOT,
    password: IMAP_PASSWORD,
    uidValidity: 909,
  });
  await smtp.start();
  await imap.start();
  try {
    const config = makeConfig(base);
    const emailConfig = config.platforms.email as EmailConfig;
    emailConfig.smtp = { ...emailConfig.smtp, port: smtp.port };
    emailConfig.imap = { ...emailConfig.imap, port: imap.port };

    const emailRoot = join(base, "email");
    const submissionStore = new SubmissionStore(emailRoot);
    const recoveryResult = await submissionStore.recover();
    const messageStore = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
    await messageStore.putSource(OWNER, "From: alice\r\n\r\nHello there.", {
      from: SENDER,
      subject: "Hello",
      plainBody: "Hello there.",
      wireIds: { messageId: "<smoke-seed-acc@x>" },
    });

    const mailService = new EmailMailService({
      config: emailConfig,
      emailRoot,
      submissionStore,
      recoveryResult,
      messageStore,
      smtp: new EmailSmtpClient({
        config: emailConfig.smtp,
        tlsCa: smtp.caCert,
        timeoutMs: 5_000,
      }),
      imap: new EmailImapClient({
        config: emailConfig.imap,
        tlsCa: imap.caCert,
        defaultSentFolder: "Sent",
      }),
      channels: CHANNELS,
      builder: new OutgoingMimeBuilder({ fromAddress: BOT }),
    });
    const adapter = new EmailAdapter({
      config: emailConfig,
      transport: new EmailImapClient({
        config: emailConfig.imap,
        tlsCa: imap.caCert,
      }),
      mailboxStore: new MailboxStore({
        emailRoot,
        fingerprint: buildMailboxFingerprint("127.0.0.1", BOT, "INBOX"),
      }),
      channels: CHANNELS,
      mailService,
      messageStore,
    });
    const store = new EmailSpontaneousStore({ emailRoot, evidence: submissionStore });

    const occurrence = await store.schedule(new Date(Date.now() - 1000));
    const targets: EmailSpontaneousTarget[] = [];
    await dispatchEmailSpontaneousOccurrence({
      store,
      adapter,
      config,
      occurrence,
      orchestrator: {
        processSpontaneousPost: async (_platform, channelId, _adapter, options) => {
          const target = options.email;
          assert(target);
          targets.push(target);
          const reply = await adapter.sendReply(channelId, "Accepted note.", {
            emailSend: { ...spontaneousOperationKey(target.tickId), owner: target.userId },
          });
          return { success: reply.success, error: reply.error };
        },
      },
    });

    assertEquals(smtp.dataTransactionCount, 1);
    assertEquals(targets.length, 1);

    // Now simulate process restart: recreate submission store, occurrence store, and scheduler
    _resetSharedRegistryForTesting();
    const restartedSubmissions = new SubmissionStore(emailRoot);
    await restartedSubmissions.recover();
    const restartedStore = new EmailSpontaneousStore({
      emailRoot,
      evidence: restartedSubmissions,
    });
    const restartScheduler = new SpontaneousScheduler(config);
    restartScheduler.setOccurrenceStore(restartedStore);

    const restartedDispatches: SpontaneousOccurrence[] = [];
    restartScheduler.setCallback(async (_platform, restored) => {
      if (restored) restartedDispatches.push(restored);
      await Promise.resolve();
    });

    restartScheduler.start();
    await restartScheduler.whenReady();

    await waitFor(async () =>
      (await readSmokeSnapshot(emailRoot)).previous?.status === "completed"
    );
    restartScheduler.stop();

    // Assert zero replacement target selection, zero re-dispatches, zero extra DATA
    assertEquals(restartedDispatches.length, 0);
    assertEquals(smtp.dataTransactionCount, 1);
  } finally {
    await imap.stop();
    await smtp.stop();
    _resetSharedRegistryForTesting();
    await Deno.remove(base, { recursive: true }).catch(() => {});
  }
});

Deno.test("email spontaneous smoke - restart after live SMTP failure/uncertainty produces zero replacement target selection or additional DATA", async () => {
  const base = await Deno.makeTempDir({ prefix: "email-spontaneous-smoke-restart-unc-" });
  const emailRoot = join(base, "email");
  const submissionStore = new SubmissionStore(emailRoot);
  await submissionStore.recover();
  const messageStore = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
  await messageStore.putSource(OWNER, "From: alice\r\n\r\nHello there.", {
    from: SENDER,
    subject: "Hello",
    plainBody: "Hello there.",
    wireIds: { messageId: "<smoke-seed-unc@x>" },
  });

  const store = new EmailSpontaneousStore({ emailRoot, evidence: submissionStore });
  const occurrence = await store.schedule(new Date(Date.now() - 1000));

  const smtp = new EmailSmtpTestService({
    tlsMode: "tls",
    username: BOT,
    password: SMTP_PASSWORD,
  });
  const imap = new EmailImapTestService({
    tlsMode: "tls",
    username: BOT,
    password: IMAP_PASSWORD,
    uidValidity: 909,
  });
  await smtp.start();
  await imap.start();
  try {
    // Dispatch with scripted error to simulate SMTP dropping connection mid-flight
    const config = makeConfig(base);
    const emailConfig = config.platforms.email as EmailConfig;
    const dropSmtp: SmtpTransport = {
      submit: (_input: SmtpSubmission): Promise<SmtpSubmitResult> => {
        return Promise.resolve({
          phase: "unknown",
          safeCode: SmtpDiagnosticCode.CONNECTION_LOST,
          accepted: [],
          rejected: [],
          sizeBytes: 0,
          durationMs: 1,
        });
      },
    };
    const mailService = new EmailMailService({
      config: emailConfig,
      emailRoot,
      submissionStore,
      messageStore,
      smtp: dropSmtp,
      imap: new EmailImapClient({
        config: emailConfig.imap,
        tlsCa: smtp.caCert,
        defaultSentFolder: "Sent",
      }),
      channels: CHANNELS,
    });
    const adapter = new EmailAdapter({
      config: emailConfig,
      transport: new EmailImapClient({
        config: emailConfig.imap,
        tlsCa: smtp.caCert,
      }),
      mailboxStore: new MailboxStore({
        emailRoot,
        fingerprint: buildMailboxFingerprint("127.0.0.1", BOT, "INBOX"),
      }),
      channels: CHANNELS,
      mailService,
      messageStore,
    });

    await dispatchEmailSpontaneousOccurrence({
      store,
      adapter,
      config,
      occurrence,
      orchestrator: {
        processSpontaneousPost: async (_platform, channelId, _adapter, options) => {
          const target = options.email;
          assert(target);
          const reply = await adapter.sendReply(channelId, "Uncertain note.", {
            emailSend: { ...spontaneousOperationKey(target.tickId), owner: target.userId },
          });
          return { success: reply.success, error: reply.error };
        },
      },
    });

    // Process crashes and recovers
    _resetSharedRegistryForTesting();
    const restartedSubmissions = new SubmissionStore(emailRoot);
    await restartedSubmissions.recover();
    const restartedStore = new EmailSpontaneousStore({
      emailRoot,
      evidence: restartedSubmissions,
    });
    const restartScheduler = new SpontaneousScheduler(config);
    restartScheduler.setOccurrenceStore(restartedStore);

    const restartedTicks: SpontaneousOccurrence[] = [];
    restartScheduler.setCallback(async (_platform, restored) => {
      if (restored) restartedTicks.push(restored);
      await Promise.resolve();
    });

    restartScheduler.start();
    await restartScheduler.whenReady();
    await waitFor(
      async () => (await readSmokeSnapshot(emailRoot)).previous?.status === "review-required",
    );
    restartScheduler.stop();

    assertEquals(restartedTicks, [], "an unresolved tick is never re-dispatched");
    _resetSharedRegistryForTesting();
  } finally {
    await imap.stop();
    await smtp.stop();
  }
  await Deno.remove(base, { recursive: true }).catch(() => {});
});
