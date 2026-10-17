// tests/platforms/email/submission-service-smoke.test.ts
//
// Controlled integration smoke test for `email-submission-service` with the real predecessor
// implementations in isolated temporary state: the real `OutgoingMimeBuilder`, the real
// `SubmissionStore` and `EmailMessageStore` (file-backed), the real `EmailSmtpClient` and
// `EmailImapClient` over real sockets and certificate-validated TLS, and both local protocol
// fixtures (`EmailSmtpTestService`, `EmailImapTestService`).
//
// Exercised layers: durable persistence, MIME construction, live SMTP submission and live IMAP
// APPEND. No ACP/model doubles are involved; no production credentials or mailbox are used.
//
// Scenarios mirror `openspec/changes/email-submission-service/specs/email-submission/spec.md`:
// repeated accepted request (zero additional SMTP after restart), sent-folder copy, and
// byte identity between the wire copy, the stored evidence, local history and the APPEND.

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { EmailConfig } from "../../../src/types/config.ts";
import { normalizeEmailMailbox } from "../../../src/platforms/email/email-identity.ts";
import {
  _resetSharedRegistryForTesting,
  computeOperationId,
  SubmissionStore,
} from "../../../src/platforms/email/submission-store.ts";
import { EmailMessageStore } from "../../../src/platforms/email/message-store.ts";
import { EmailImapClient } from "../../../src/platforms/email/imap-client.ts";
import { EmailSmtpClient } from "../../../src/platforms/email/smtp-client.ts";
import {
  EmailMailService,
  EmailSubmissionDiagnosticCode,
  outboundEvidenceMetaRef,
  outboundEvidenceRef,
} from "../../../src/platforms/email/mail-service.ts";
import { applyOutgoingSignature } from "../../../src/platforms/email/outgoing-mime.ts";
import { EmailImapTestService } from "../../helpers/email-imap-service.ts";
import { EmailSmtpTestService } from "../../helpers/email-smtp-service.ts";

const OWNER = "e_" + "12".repeat(32);
const BOT = "bot@smoke.example";
const RECIPIENT = "alice@allowed-domain.org";
const RECIPIENT_ID = normalizeEmailMailbox(RECIPIENT).userId;
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const SMTP_PASSWORD = "smoke-smtp-secret-9f21";
const IMAP_PASSWORD = "smoke-imap-secret-3c74";
const SENT_FOLDER = "Sent";

interface Env {
  emailRoot: string;
  config: EmailConfig;
  store: SubmissionStore;
  messageStore: EmailMessageStore;
  service: EmailMailService;
}

function buildEnv(
  base: string,
  smtp: EmailSmtpTestService,
  imap: EmailImapTestService,
  options: { emailRoot?: string } = {},
): Env {
  const emailRoot = options.emailRoot ?? join(base, "email");
  const config: EmailConfig = {
    enabled: false,
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
    sentFolder: SENT_FOLDER,
    pollIntervalMs: 300_000,
    receivingAuth: { authservId: "mx.smoke.example", attestedStripping: true },
    maxMessageBytes: 25 * 1024 * 1024,
    maxIncomingAttachments: 10,
    signature: SIGNATURE,
  };
  const store = new SubmissionStore(emailRoot);
  const messageStore = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
  const service = new EmailMailService({
    config,
    emailRoot,
    submissionStore: store,
    messageStore,
    smtp: new EmailSmtpClient({
      config: config.smtp,
      tlsCa: smtp.caCert,
      timeoutMs: 5_000,
    }),
    imap: new EmailImapClient({
      config: config.imap,
      tlsCa: imap.caCert,
      defaultSentFolder: SENT_FOLDER,
    }),
    channels: [{ id: `email/account/${RECIPIENT_ID}`, enabled: true }],
  });
  return { emailRoot, config, store, messageStore, service };
}

function smokeDraft(workId: string) {
  return {
    owner: OWNER,
    operationKey: { workId, actionSlot: "reply" as const },
    targetKind: "user" as const,
    to: RECIPIENT,
    subject: "Re: smoke",
    authoredBody: "Smoke body.\nDot line:\n.\n..double dot\nEnd.",
  };
}

async function withFixtures(
  fn: (smtp: EmailSmtpTestService, imap: EmailImapTestService) => Promise<void>,
  options: { rejectAppend?: boolean } = {},
): Promise<void> {
  const smtp = new EmailSmtpTestService({
    tlsMode: "tls",
    username: BOT,
    password: SMTP_PASSWORD,
  });
  const imap = new EmailImapTestService({
    tlsMode: "tls",
    username: BOT,
    password: IMAP_PASSWORD,
    uidValidity: 777,
    rejectAppend: options.rejectAppend,
  });
  await smtp.start();
  await imap.start();
  try {
    await fn(smtp, imap);
  } finally {
    await imap.stop();
    await smtp.stop();
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "submission-service-smoke-" });
  try {
    _resetSharedRegistryForTesting();
    await fn(dir);
  } finally {
    _resetSharedRegistryForTesting();
    try {
      await Deno.remove(dir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

Deno.test("Smoke: one send is byte-identical across SMTP, evidence, history and APPEND", async () => {
  await withTempDir(async (base) => {
    await withFixtures(async (smtp, imap) => {
      const env = buildEnv(base, smtp, imap);
      const outcome = await env.service.send(smokeDraft("smoke-happy"));

      assertEquals(outcome.phase, "submitted");
      assertEquals(outcome.sentCopy, "appended");
      assert(outcome.recordId);
      assert(outcome.messageId?.startsWith("<"));

      // Exactly one live SMTP DATA transaction and one live IMAP APPEND, to the sent folder.
      assertEquals(smtp.dataTransactionCount, 1);
      assertEquals(smtp.dataTransactions[0].recipients, [RECIPIENT]);
      assertEquals(smtp.dataTransactions[0].envelopeFrom, BOT);
      assertEquals(imap.appendedMessages.length, 1);
      assertEquals(imap.appendedMessages[0].folder, SENT_FOLDER);

      // Identical bytes everywhere.
      const wireBytes = smtp.dataTransactions[0].decoded;
      const evidenceBytes = await Deno.readFile(
        join(env.emailRoot, outboundEvidenceRef(outcome.operationId)),
      );
      const historyBytes = await env.messageStore.getSourceBytes(OWNER, outcome.recordId!);
      assertEquals(evidenceBytes, wireBytes);
      assertEquals(historyBytes, wireBytes);
      assertEquals(imap.appendedMessages[0].content, wireBytes);

      // The wire copy carries the signature exactly once and the generated Message-ID.
      const wire = new TextDecoder().decode(wireBytes);
      const wireSignature = SIGNATURE.replace(/\n/g, "\r\n");
      assertEquals(wire.split(wireSignature).length - 1, 1);
      assert(wire.includes(`Message-ID: ${outcome.messageId}`));
      assert(wire.includes("Auto-Submitted: auto-generated"));

      // Durable record: terminal submitted with the sent copy appended.
      const record = await env.messageStore.getByOwnerRecord(OWNER, outcome.recordId!);
      assert(record);
      assertEquals(record.wireMessageId, outcome.messageId);
      assertEquals(record.operationKey, smokeDraft("smoke-happy").operationKey);
      assertEquals(
        env.service.lookup(OWNER, smokeDraft("smoke-happy").operationKey)?.sentCopy,
        "appended",
      );
      assertEquals(
        outcome.operationId,
        computeOperationId(OWNER, { workId: "smoke-happy", actionSlot: "reply" }),
      );
    });
  });
});

Deno.test("Smoke: restart returns the recorded result with zero further SMTP transactions", async () => {
  await withTempDir(async (base) => {
    await withFixtures(async (smtp, imap) => {
      const first = buildEnv(base, smtp, imap);
      const sent = await first.service.send(smokeDraft("smoke-restart"));
      assertEquals(sent.phase, "submitted");
      assertEquals(smtp.dataTransactionCount, 1);

      // Process restart: in-memory state is gone, only file-backed state remains.
      _resetSharedRegistryForTesting();
      const restarted = buildEnv(base, smtp, imap, { emailRoot: first.emailRoot });
      const recovery = await restarted.service.recover();
      assertEquals(recovery.unknownRecovered, []);
      assertEquals(recovery.prepared, []);
      assertEquals(recovery.submitted, [sent.operationId]);
      assertEquals(recovery.pendingCopies, []);
      assertEquals(recovery.historyRepaired, []);

      const repeated = await restarted.service.send(smokeDraft("smoke-restart"));
      assertEquals(repeated.reused, true);
      assertEquals(repeated.phase, "submitted");
      assertEquals(repeated.sentCopy, "appended");
      assertEquals(repeated.operationId, sent.operationId);
      assertEquals(repeated.recordId, sent.recordId);

      // Zero additional live protocol exchanges.
      assertEquals(smtp.dataTransactionCount, 1);
      assertEquals(imap.appendedMessages.length, 1);
      assertEquals(smtp.authAttempts.length, 1);
    });
  });
});

Deno.test("Smoke: restart repairs lost local history from stored evidence without SMTP", async () => {
  await withTempDir(async (base) => {
    await withFixtures(async (smtp, imap) => {
      const first = buildEnv(base, smtp, imap);
      const sent = await first.service.send(smokeDraft("smoke-repair"));
      assertEquals(sent.phase, "submitted");
      const wireBytes = smtp.dataTransactions[0].decoded;

      // The owner's local history is lost while the accepted operation and its evidence remain.
      await Deno.remove(join(base, "workspaces"), { recursive: true });
      _resetSharedRegistryForTesting();
      const restarted = buildEnv(base, smtp, imap, { emailRoot: first.emailRoot });

      const recovery = await restarted.service.recover();
      assertEquals(recovery.historyRepaired, [sent.operationId]);
      assertEquals(recovery.historyFailures, []);
      assertEquals(recovery.unknownRecovered, []);

      const meta = JSON.parse(
        await Deno.readTextFile(
          join(restarted.emailRoot, outboundEvidenceMetaRef(sent.operationId)),
        ),
      ) as { history?: { recordId: string } };
      assert(meta.history?.recordId);
      const record = await restarted.messageStore.getByOwnerRecord(OWNER, meta.history.recordId);
      assert(record);
      assertEquals(record.wireMessageId, sent.messageId);
      assertEquals(
        await restarted.messageStore.getSourceBytes(OWNER, meta.history.recordId),
        wireBytes,
      );
      assertEquals(record.body.split("\n").includes("Second line"), true);
      assertEquals(record.body.split(SIGNATURE).length - 1, 1);

      // Repair never resubmits and never duplicates the remote copy.
      assertEquals(smtp.dataTransactionCount, 1);
      assertEquals(imap.appendedMessages.length, 1);
    });
  });
});

Deno.test("Smoke: a real IMAP APPEND rejection never downgrades an accepted submission", async () => {
  await withTempDir(async (base) => {
    await withFixtures(async (smtp, imap) => {
      const env = buildEnv(base, smtp, imap);
      imap.rejectAppend = true;
      const outcome = await env.service.send(smokeDraft("smoke-append-fail"));

      // The live SMTP fixture accepted exactly once; the refused APPEND stored nothing.
      assertEquals(outcome.phase, "submitted");
      assertEquals(outcome.sentCopy, "failed");
      assertEquals(outcome.safeCode, EmailSubmissionDiagnosticCode.SENT_COPY_FAILED);
      assert(outcome.recordId);
      assertEquals(smtp.dataTransactionCount, 1);
      assertEquals(imap.appendedMessages.length, 0);

      // Signed local history exists even though the remote copy failed.
      const record = await env.messageStore.getByOwnerRecord(OWNER, outcome.recordId!);
      assert(record);
      assertEquals(
        record.body,
        applyOutgoingSignature(smokeDraft("smoke-append-fail").authoredBody, SIGNATURE),
      );
      assertEquals(record.body.split(SIGNATURE).length - 1, 1);
      assertEquals(
        await env.messageStore.getSourceBytes(OWNER, outcome.recordId!),
        smtp.dataTransactions[0].decoded,
      );

      // Repeating the request neither resubmits nor rewrites anything.
      const repeated = await env.service.send(smokeDraft("smoke-append-fail"));
      assertEquals(repeated.phase, "submitted");
      assertEquals(repeated.sentCopy, "failed");
      assertEquals(repeated.recordId, outcome.recordId);
      assertEquals(smtp.dataTransactionCount, 1);
      assertEquals(imap.appendedMessages.length, 0);

      // Once the server accepts APPEND again, repair uploads the identical stored bytes.
      imap.rejectAppend = false;
      const repair = await env.service.appendPendingCopies();
      assertEquals(repair.failed, []);
      assertEquals(repair.appended, [outcome.operationId]);
      assertEquals(imap.appendedMessages.length, 1);
      assertEquals(imap.appendedMessages[0].folder, SENT_FOLDER);
      assertEquals(imap.appendedMessages[0].content, smtp.dataTransactions[0].decoded);
      assertEquals(smtp.dataTransactionCount, 1);
    });
  });
});
