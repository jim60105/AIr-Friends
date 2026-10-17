// tests/skills/email-compose-smoke.test.ts
//
// Controlled integration smoke for `email-compose-skill` with its real predecessor
// implementations: the real `EmailComposeHandler` authorization boundary, the real
// `EmailMailService` durability order, the real `OutgoingMimeBuilder` (central signature) and the
// real `EmailSmtpClient` over a real TLS socket to the in-process SMTP protocol fixture.
//
// Exercised layers: handler -> durable mail service -> MIME construction -> nodemailer SMTP over
// TLS -> the local SMTP fixture. The sent-folder copy uses a scripted IMAP double, because the
// APPEND path is owned and pinned by `email-submission-service`, not by this row.
// No provider, credential, mailbox, ACP session or model judgment is involved, and no production
// address is contacted: this is the "one successful local SMTP compose" evidence of the change.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EmailComposeHandler } from "../../src/skills/email-handler.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { DestinationGrant } from "../../src/core/email-intent-preflight.ts";
import type { PlatformAdapter } from "../../src/platforms/platform-adapter.ts";
import type { EmailConfig } from "../../src/types/config.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import { OutgoingMimeBuilder } from "../../src/platforms/email/outgoing-mime.ts";
import { EmailMailService } from "../../src/platforms/email/mail-service.ts";
import { SubmissionStore } from "../../src/platforms/email/submission-store.ts";
import {
  EmailMessageStore,
  formatEmailChannelId,
} from "../../src/platforms/email/message-store.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import { EmailSmtpClient } from "../../src/platforms/email/smtp-client.ts";
import type {
  ImapAppendOptions,
  ImapFetchHeadersOptions,
  ImapFetchSourceOptions,
  ImapListOptions,
  ImapMailboxPosition,
  ImapMessage,
  ImapTransport,
} from "../../src/platforms/email/imap-client.ts";
import { EmailSmtpTestService } from "../helpers/email-smtp-service.ts";

const SELF_ADDRESS = "user@example.org";
const OWNER = normalizeEmailMailbox(SELF_ADDRESS).userId;
const RECIPIENT = "alice@allowed-domain.org";
const RECIPIENT_CANONICAL = normalizeEmailMailbox(RECIPIENT).canonicalAddress;
const RECIPIENT_ID = normalizeEmailMailbox(RECIPIENT).userId;
const BOT = "bot@example.com";
const PASSWORD = "smoke-fixture-secret-4c17";
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const WORK_ID = "work-compose-smoke";
const SESSION_ID = "sess_compose_smoke";
const THREAD_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ATTACHMENT_NAME = "report.txt";
const ATTACHMENT_BYTES = "attachment-bytes-from-compose-smoke";

/** Scripted IMAP double: only the sent-folder APPEND is exercised (owned by row 13). */
class RecordingImap implements ImapTransport {
  appended: Uint8Array[] = [];

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
    throw new Error("fetchSource is not used by the compose smoke path");
  }
  appendSent(rawMime: Uint8Array | string, _options?: ImapAppendOptions): Promise<void> {
    this.appended.push(typeof rawMime === "string" ? new TextEncoder().encode(rawMime) : rawMime);
    return Promise.resolve();
  }
}

function emailConfig(port: number): EmailConfig {
  return {
    enabled: false,
    address: BOT,
    imap: {
      host: "127.0.0.1",
      port: 993,
      tlsMode: "tls",
      username: BOT,
      password: "unused-imap-secret",
    },
    smtp: {
      host: "127.0.0.1",
      port,
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
  };
}

function composeContext(base: string, grant: DestinationGrant): SkillContext {
  const workspace: WorkspaceInfo = {
    key: `email/${OWNER}`,
    components: { platform: "email", userId: OWNER },
    path: base,
    tmpPath: join(base, "tmp"),
    isDm: true,
  };
  return {
    sessionId: SESSION_ID,
    workspace,
    channelId: formatEmailChannelId(OWNER, THREAD_ID),
    userId: OWNER,
    emailWorkId: WORK_ID,
    emailDestinationGrants: [grant],
    platformAdapter: {} as PlatformAdapter,
  };
}

function grantedCompose(): DestinationGrant {
  return {
    grantId: "grant-smoke-1",
    sessionId: SESSION_ID,
    workId: WORK_ID,
    owner: OWNER,
    action: "compose",
    canonicalRecipient: RECIPIENT_CANONICAL,
    requestDigest: "b".repeat(64),
  };
}

async function withSmtpService(
  options: { rejectFinal?: boolean },
  body: (service: EmailSmtpTestService) => Promise<void>,
): Promise<void> {
  const service = new EmailSmtpTestService({
    tlsMode: "tls",
    username: BOT,
    password: PASSWORD,
    ...(options.rejectFinal ? { finalResponseCode: 550 } : {}),
  });
  await service.start();
  try {
    await body(service);
  } finally {
    await service.stop();
  }
}

Deno.test("smoke - a granted compose reaches a real local SMTP peer with its exact envelope", async () => {
  await withSmtpService({}, async (smtpService) => {
    const base = await Deno.makeTempDir();
    try {
      const stagingDir = join(base, "tmp", SESSION_ID);
      Deno.mkdirSync(stagingDir, { recursive: true });
      Deno.writeTextFileSync(join(stagingDir, ATTACHMENT_NAME), ATTACHMENT_BYTES);

      const imap = new RecordingImap();
      const emailRoot = join(base, "email");
      const smtp = new EmailSmtpClient({
        config: {
          host: "127.0.0.1",
          port: smtpService.port,
          tlsMode: "tls",
          username: BOT,
          password: PASSWORD,
        },
        tlsCa: smtpService.caCert,
        timeoutMs: 5_000,
      });
      const service = new EmailMailService({
        config: emailConfig(smtpService.port),
        emailRoot,
        submissionStore: new SubmissionStore(emailRoot),
        messageStore: new EmailMessageStore({ workspacesRoot: join(base, "workspaces") }),
        smtp,
        imap,
        channels: [
          { id: `email/account/${OWNER}`, enabled: true },
          { id: `email/account/${RECIPIENT_ID}`, enabled: true },
        ],
        builder: new OutgoingMimeBuilder({
          fromAddress: BOT,
          now: () => new Date("2026-10-17T00:00:00Z"),
        }),
      });

      const handler = new EmailComposeHandler({ mailService: service });
      const bodyText = "Dear team,\n\nThe composed price is $0.435 — 你好\n";
      const result = await handler.handleSendEmail(
        {
          grantId: "grant-smoke-1",
          request: {
            to: RECIPIENT,
            subject: "Composed smoke subject",
            body: bodyText,
            attachments: [join(stagingDir, ATTACHMENT_NAME)],
          },
        },
        composeContext(base, grantedCompose()),
      );

      assertEquals(result.success, true, result.error);
      assertEquals(result.emailSubmission?.phase, "submitted");
      assertEquals(
        smtpService.dataTransactions.length,
        1,
        "exactly one SMTP DATA transaction for one composed message",
      );
      const transaction = smtpService.dataTransactions[0];
      assertEquals(transaction.envelopeFrom, BOT);
      assertEquals(transaction.recipients, [RECIPIENT_CANONICAL]);

      // The wire bytes are CRLF-terminated; compare against LF-normalized text.
      const raw = new TextDecoder().decode(transaction.decoded).replaceAll("\r\n", "\n");
      assertStringIncludes(raw, `To: ${RECIPIENT_CANONICAL}`);
      assertStringIncludes(raw, "Subject: Composed smoke subject");
      assertStringIncludes(raw, "Dear team,");
      assertStringIncludes(raw, "$0.435");
      // The signature is applied centrally, exactly once.
      assertEquals(raw.split(SIGNATURE).length - 1, 1);
      assertStringIncludes(
        raw,
        `Content-Disposition: attachment; filename=${ATTACHMENT_NAME}`,
      );
      // Attachment bytes travel base64-encoded, so assert their encoded form.
      assertStringIncludes(raw, btoa(ATTACHMENT_BYTES));
      assert(!raw.includes("Cc:"), "a composed message never carries Cc");
      // The accepted bytes are the ones copied to the sent folder.
      assertEquals(imap.appended.length, 1);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
});

Deno.test("smoke - a rejected SMTP peer yields an explicit failure with no second transaction", async () => {
  await withSmtpService({ rejectFinal: true }, async (smtpService) => {
    const base = await Deno.makeTempDir();
    try {
      const imap = new RecordingImap();
      const emailRoot = join(base, "email");
      const service = new EmailMailService({
        config: emailConfig(smtpService.port),
        emailRoot,
        submissionStore: new SubmissionStore(emailRoot),
        messageStore: new EmailMessageStore({ workspacesRoot: join(base, "workspaces") }),
        smtp: new EmailSmtpClient({
          config: {
            host: "127.0.0.1",
            port: smtpService.port,
            tlsMode: "tls",
            username: BOT,
            password: PASSWORD,
          },
          tlsCa: smtpService.caCert,
          timeoutMs: 5_000,
        }),
        imap,
        channels: [
          { id: `email/account/${OWNER}`, enabled: true },
          { id: `email/account/${RECIPIENT_ID}`, enabled: true },
        ],
        builder: new OutgoingMimeBuilder({ fromAddress: BOT }),
      });

      const handler = new EmailComposeHandler({ mailService: service });
      const result = await handler.handleSendEmail(
        {
          grantId: "grant-smoke-1",
          request: { to: RECIPIENT, subject: "Rejected", body: "Body." },
        },
        composeContext(base, grantedCompose()),
      );

      assertEquals(result.success, false);
      assertEquals(result.emailSubmission?.phase, "failed");
      assertStringIncludes(result.error ?? "", "nothing was delivered");
      assertEquals(smtpService.dataTransactions.length, 1);
      assertEquals(imap.appended.length, 0);
      assert(
        await Deno.stat(emailRoot).then(() => true, () => false),
        "the submission journal is still durable evidence",
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
});
