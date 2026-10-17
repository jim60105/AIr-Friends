// tests/integration/email-platform.integration.test.ts
//
// Whole-path controlled-service acceptance for `email-activation` (spec
// `email-platform-activation`):
// - preexisting mail is excluded by the first-activation boundary;
// - new authenticated mail is admitted once and its durable work receipt completes;
// - an authorized threaded reply is signed once and addressed only to the verified sender;
// - a granted third-party forward is signed once and carries the original message intact;
// - the reminder operation slot submits exactly once and never resends;
// - a duplicate call reuses the recorded result, and an UNKNOWN submission is never resent.
//
// Exercised layers: the REAL `composeEmailPlatform` production stack, the REAL `AgentCore`
// skill registry with `send-email`, the REAL `EmailComposeHandler`, `EmailMailService`,
// `EmailMessageStore`, `SubmissionStore`, `MailboxStore` and `EmailSessionReceipts`, the REAL
// `EmailImapClient`/`EmailSmtpClient` over certificate-validated TLS, and both in-process local
// protocol fixtures. No ACP/model decision, provider, production credential or mailbox is used.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AgentCore } from "@core/agent-core.ts";
import type { ChannelConfig, Config, EmailConfig } from "../../src/types/config.ts";
import type { NormalizedEvent } from "../../src/types/events.ts";
import type { SkillContext } from "@skills/types.ts";
import type { DestinationGrant } from "@core/email-intent-preflight.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import { _resetSharedRegistryForTesting } from "../../src/platforms/email/submission-store.ts";
import {
  composeEmailPlatform,
  type EmailPlatformRuntime,
} from "../../src/platforms/email/activation.ts";
import { EmailImapClient } from "../../src/platforms/email/imap-client.ts";
import { EmailSmtpClient } from "../../src/platforms/email/smtp-client.ts";
import { EmailImapTestService } from "../helpers/email-imap-service.ts";
import { EmailSmtpTestService } from "../helpers/email-smtp-service.ts";

const BOT = "bot@integration.example";
const AUTHSERV = "mx.integration.example";
const SENDER = "alice@allowed-domain.org";
const OWNER = normalizeEmailMailbox(SENDER).userId;
const THIRD_PARTY = "bob@partner.example";
const IMAP_PASSWORD = "integration-imap-secret";
const SMTP_PASSWORD = "integration-smtp-secret";
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const REMINDER_ID = "reminder-integration-1";

const CHANNELS: ChannelConfig[] = [{ id: `email/account/${OWNER}`, enabled: true }];

function deploymentConfig(root: string, email: EmailConfig): Config {
  return {
    platforms: {
      discord: { token: "", enabled: false },
      misskey: { host: "", token: "", enabled: false },
      email,
    },
    agent: {
      model: "openrouter/fixture/model",
      systemPromptPath: join(root, "prompts", "system_reply.md"),
      tokenLimit: 20000,
      defaultAgentType: "opencode",
    },
    workspace: { repoPath: root, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: CHANNELS,
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    skillApi: { enabled: false, port: 0, host: "127.0.0.1" },
  } as unknown as Config;
}

function emailConfig(imap: EmailImapTestService, smtp: EmailSmtpTestService): EmailConfig {
  return {
    enabled: true,
    address: BOT,
    imap: {
      host: "127.0.0.1",
      port: imap.port,
      tlsMode: "tls",
      username: BOT,
      password: IMAP_PASSWORD,
    },
    smtp: {
      host: "127.0.0.1",
      port: smtp.port,
      tlsMode: "tls",
      username: BOT,
      password: SMTP_PASSWORD,
    },
    incomingFolder: "INBOX",
    sentFolder: "Sent",
    pollIntervalMs: 300_000,
    receivingAuth: { authservId: AUTHSERV, attestedStripping: true },
    maxMessageBytes: 25 * 1024 * 1024,
    maxIncomingAttachments: 10,
    signature: SIGNATURE,
  };
}

/** One admitted inbound message: trusted DMARC pass plus the allowlist channel. */
function rawMessage(messageId: string, body: string): string {
  const domain = SENDER.split("@")[1];
  return [
    `From: ${SENDER}`,
    `To: ${BOT}`,
    "Subject: Integration request",
    `Message-ID: ${messageId}`,
    `Authentication-Results: ${AUTHSERV}; dmarc=pass header.from=${domain}`,
    "",
    body,
  ].join("\r\n");
}

async function composeRuntime(
  base: string,
  imap: EmailImapTestService,
  smtp: EmailSmtpTestService,
): Promise<{ runtime: EmailPlatformRuntime; config: Config }> {
  const config = deploymentConfig(base, emailConfig(imap, smtp));
  const email = config.platforms.email!;
  const runtime = await composeEmailPlatform({
    config,
    transports: {
      imap: new EmailImapClient({
        config: email.imap,
        defaultFolder: email.incomingFolder,
        defaultSentFolder: email.sentFolder,
        tlsCa: imap.caCert,
      }),
      smtp: new EmailSmtpClient({ config: email.smtp, tlsCa: smtp.caCert }),
      sentCopyImap: new EmailImapClient({
        config: email.imap,
        defaultFolder: email.incomingFolder,
        defaultSentFolder: email.sentFolder,
        tlsCa: imap.caCert,
      }),
    },
  });
  return { runtime, config };
}

function signatureCount(wire: string): number {
  return wire.split(SIGNATURE.replace(/\n/g, "\r\n")).length - 1;
}

async function withFixtures(
  smtpOptions: ConstructorParameters<typeof EmailSmtpTestService>[0],
  fn: (imap: EmailImapTestService, smtp: EmailSmtpTestService) => Promise<void>,
): Promise<void> {
  const imap = new EmailImapTestService({
    tlsMode: "tls",
    username: BOT,
    password: IMAP_PASSWORD,
    uidValidity: 9090,
    uidNext: 101,
    // Preexisting mail: the first-activation boundary excludes it.
    initialMessages: [{ uid: 100, rawMime: rawMessage("<preexisting-100@x>", "Old mail body.") }],
  });
  const smtp = new EmailSmtpTestService(smtpOptions);
  await imap.start();
  await smtp.start();
  try {
    await fn(imap, smtp);
  } finally {
    await imap.stop();
    await smtp.stop();
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "email-platform-integration-" });
  try {
    _resetSharedRegistryForTesting();
    await Deno.mkdir(join(dir, "prompts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "prompts", "system_reply.md"),
      "You are a helper.\nSkill root: {{ skillsDir }}\n{{ userContextMessage }}",
    );
    await fn(dir);
  } finally {
    _resetSharedRegistryForTesting();
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

function firstEvent(events: NormalizedEvent[]): NormalizedEvent {
  const event = events[0];
  assert(event !== undefined, "expected one admitted email event");
  return event;
}

function forwardGrant(workId: string, sessionId: string, sourceRecordId: string): DestinationGrant {
  return Object.freeze({
    grantId: "grant-integration-forward",
    sessionId,
    workId,
    owner: OWNER,
    action: "forward",
    canonicalRecipient: normalizeEmailMailbox(THIRD_PARTY).canonicalAddress,
    sourceRecordId,
    requestDigest: "c".repeat(64),
  });
}

Deno.test("integration - whole path submits each authorized mail exactly once", async () => {
  await withTempDir(async (base) => {
    await withFixtures(
      { tlsMode: "tls", username: BOT, password: SMTP_PASSWORD },
      async (imap, smtp) => {
        const { runtime, config } = await composeRuntime(base, imap, smtp);
        try {
          const agentCore = new AgentCore(config);
          agentCore.setEmailPlatform(runtime.services);

          const events: NormalizedEvent[] = [];
          runtime.adapter.onEvent((event) => {
            events.push(event);
            return Promise.resolve();
          });

          await runtime.adapter.connect();
          // Preexisting inbox mail produces no session and no side effect.
          assertEquals(events, []);
          assertEquals(smtp.dataTransactionCount, 0);

          // A new authenticated request is admitted once, with its durable receipt.
          imap.addMessage({
            uid: 101,
            rawMime: rawMessage("<new-101@x>", "Please handle the integration request."),
          });
          const round = await runtime.adapter.poll();
          assertEquals(round.accepted, 1);
          assertEquals(events.length, 1);
          const event = firstEvent(events);
          const receipt = event.emailWork;
          assert(receipt, "the admitted event carries its durable work receipt");
          await runtime.services.receipts.beginEmailWork(receipt);
          await runtime.services.receipts.finishEmailWork(receipt, {
            outcome: "completed",
            detail: "integration-request-handled",
            settle: () => Promise.resolve(true),
          });

          // 1. Authorized threaded reply: signed once, addressed to the verified sender.
          const reply = await runtime.adapter.sendReply(
            event.channelId,
            "Threaded reply body from the integration smoke.",
            {
              emailSend: {
                workId: receipt.workId,
                owner: OWNER,
                actionSlot: "reply",
              },
            },
          );
          assert(reply.success, "the threaded reply is submitted");
          assertEquals(smtp.dataTransactionCount, 1);
          assertEquals(smtp.dataTransactions[0].recipients, [SENDER]);
          assertEquals(smtp.dataTransactions[0].envelopeFrom, BOT);
          const replyWire = new TextDecoder().decode(smtp.dataTransactions[0].decoded);
          assertEquals(signatureCount(replyWire), 1);
          assertStringIncludes(replyWire, "Subject: Re: Integration request");
          assertStringIncludes(replyWire, "In-Reply-To: <new-101@x>");
          assertStringIncludes(replyWire, "References: <new-101@x>");

          // A repeated call is answered by the recorded operation: zero further SMTP.
          const duplicateReply = await runtime.adapter.sendReply(
            event.channelId,
            "Threaded reply body from the integration smoke.",
            {
              emailSend: {
                workId: receipt.workId,
                owner: OWNER,
                actionSlot: "reply",
              },
            },
          );
          assert(duplicateReply.success);
          assertEquals(smtp.dataTransactionCount, 1);

          // 2. Granted third-party forward through the production skill registry.
          const forwardWorkId = "work-integration-forward";
          const forwardSessionId = "sess-integration-forward";
          const grant = forwardGrant(forwardWorkId, forwardSessionId, event.messageId);
          const workspace = await agentCore.getWorkspaceManager().getOrCreateWorkspace({
            platform: "email",
            userId: OWNER,
            channelId: "internal",
            messageId: `integration_${Date.now()}`,
            isDm: true,
            guildId: "",
            content: "",
            timestamp: new Date(),
          });
          const skillContext: SkillContext = {
            workspace,
            platformAdapter: runtime.adapter,
            channelId: event.channelId,
            userId: OWNER,
            sessionId: forwardSessionId,
            emailWorkId: forwardWorkId,
            emailDestinationGrants: [grant],
          };
          const forwardParams = {
            grantId: grant.grantId,
            request: {
              action: "forward",
              sourceRecordId: event.messageId,
              to: THIRD_PARTY,
              subject: "Fwd: integration request",
              body: "Forwarding the original as requested.",
            },
          };
          const forwarded = await agentCore.getSkillRegistry().executeSkill(
            "send-email",
            forwardParams,
            skillContext,
          );
          assert(forwarded.success, `forward should succeed: ${forwarded.error ?? ""}`);
          assertEquals(smtp.dataTransactionCount, 2);
          assertEquals(smtp.dataTransactions[1].recipients, [THIRD_PARTY]);
          const forwardWire = new TextDecoder().decode(smtp.dataTransactions[1].decoded);
          assertEquals(signatureCount(forwardWire), 1);
          assertStringIncludes(forwardWire, "message/rfc822");
          assertStringIncludes(forwardWire, "Please handle the integration request.");

          // The same forward resolves to the recorded operation, not a second send.
          const forwardedAgain = await agentCore.getSkillRegistry().executeSkill(
            "send-email",
            forwardParams,
            skillContext,
          );
          assert(forwardedAgain.success);
          assertEquals(smtp.dataTransactionCount, 2);

          // 3. The reminder operation slot submits once and is never resent.
          const reminderWorkId = "work-integration-reminder";
          const reminder = await runtime.adapter.sendReply(
            event.channelId,
            "Reminder delivery body.",
            {
              emailSend: {
                workId: reminderWorkId,
                owner: OWNER,
                actionSlot: `reminder:${REMINDER_ID}`,
              },
            },
          );
          assert(reminder.success);
          assertEquals(smtp.dataTransactionCount, 3);
          const reminderWire = new TextDecoder().decode(smtp.dataTransactions[2].decoded);
          assertEquals(signatureCount(reminderWire), 1);

          const reminderAgain = await runtime.adapter.sendReply(
            event.channelId,
            "Reminder delivery body.",
            {
              emailSend: {
                workId: reminderWorkId,
                owner: OWNER,
                actionSlot: `reminder:${REMINDER_ID}`,
              },
            },
          );
          assert(reminderAgain.success);
          assertEquals(smtp.dataTransactionCount, 3);

          // Shutdown stops admission before the local protocol services close.
          await runtime.shutdown();
          assertEquals((await runtime.adapter.poll()).accepted, 0);
          await agentCore.shutdown();
        } finally {
          await runtime.shutdown();
        }
      },
    );
  });
});

Deno.test("integration - an UNKNOWN submission is preserved and never resent", async () => {
  await withTempDir(async (base) => {
    await withFixtures(
      // Consume the DATA payload, then close without a final acknowledgement: unknown outcome.
      { tlsMode: "tls", username: BOT, password: SMTP_PASSWORD, closeAfterPayload: true },
      async (imap, smtp) => {
        const { runtime } = await composeRuntime(base, imap, smtp);
        try {
          const events: NormalizedEvent[] = [];
          runtime.adapter.onEvent((event) => {
            events.push(event);
            return Promise.resolve();
          });
          await runtime.adapter.connect();
          imap.addMessage({
            uid: 101,
            rawMime: rawMessage("<unknown-101@x>", "Request with an uncertain outcome."),
          });
          await runtime.adapter.poll();
          const event = firstEvent(events);
          const receipt = event.emailWork;
          assert(receipt);

          const attempt = {
            emailSend: { workId: receipt.workId, owner: OWNER, actionSlot: "reply" },
          };
          const first = await runtime.adapter.sendReply(
            event.channelId,
            "Maybe delivered body.",
            attempt,
          );
          assertEquals(first.success, false);
          assertEquals(first.emailSubmission?.phase, "unknown");
          assertEquals(smtp.dataTransactionCount, 1);

          // A retry never produces a second SMTP transaction; the uncertainty is preserved.
          const second = await runtime.adapter.sendReply(
            event.channelId,
            "Maybe delivered body.",
            attempt,
          );
          assertEquals(second.success, false);
          assertEquals(second.emailSubmission?.phase, "unknown");
          assertEquals(smtp.dataTransactionCount, 1);
          await runtime.shutdown();
          _resetSharedRegistryForTesting();
          const restarted = await composeRuntime(base, imap, smtp);
          try {
            const recovered = await restarted.runtime.adapter.sendReply(
              event.channelId,
              "Maybe delivered body.",
              attempt,
            );
            assertEquals(recovered.emailSubmission?.phase, "unknown");
            assertEquals(smtp.dataTransactionCount, 1);
          } finally {
            await restarted.runtime.shutdown();
          }
        } finally {
          await runtime.shutdown();
        }
      },
    );
  });
});
