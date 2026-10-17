// tests/skills/email-forward-smoke.test.ts
//
// Controlled integration smoke for `email-forward-skill` (row 21) with its real predecessor
// implementations: the real `EmailComposeHandler` authorization boundary, the real owner-scoped
// `EmailMessageStore` (a real archived source written by `putSource`), the real `EmailMailService`
// durability order, the real `OutgoingMimeBuilder` (central signature plus forward section) and the
// real `EmailSmtpClient` over a real TLS socket to the in-process SMTP protocol fixture.
//
// Exercised layers: handler -> durable mail service -> MIME construction -> nodemailer SMTP over
// TLS -> the local SMTP fixture. The sent-folder copy uses a scripted IMAP double, because the
// APPEND path is owned and pinned by `email-submission-service`, not by this row.
// No provider, credential, mailbox, ACP session or model judgment is involved, and no production
// address is contacted: this is the "complete local SMTP forwarding" evidence of the change.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EmailComposeHandler } from "../../src/skills/email-handler.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { DestinationGrant } from "../../src/core/email-intent-preflight.ts";
import type { PlatformAdapter } from "../../src/platforms/platform-adapter.ts";
import type { EmailConfig } from "../../src/types/config.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import {
  FORWARD_SECTION_MARKER,
  OutgoingMimeBuilder,
} from "../../src/platforms/email/outgoing-mime.ts";
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
import { decodePartBody, latin1Decode, parseMimeParts } from "../helpers/mime-parts.ts";
import { EmailSmtpTestService } from "../helpers/email-smtp-service.ts";

const SELF_ADDRESS = "user@example.org";
const OWNER = normalizeEmailMailbox(SELF_ADDRESS).userId;
const RECIPIENT = "alice@allowed-domain.org";
const RECIPIENT_CANONICAL = normalizeEmailMailbox(RECIPIENT).canonicalAddress;
const BOT = "bot@example.com";
const PASSWORD = "smoke-fixture-secret-4c17";
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const WORK_ID = "work-forward-smoke";
const SESSION_ID = "sess_forward_smoke";
const THREAD_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GRANT_ID = "grant-forward-smoke-1";
const SOURCE_RAW_ID = "<smoke-source@partner.example>";
const SOURCE_SUBJECT = "Smoke original";
const SOURCE_BODY = "SMOKE-SOURCE-BODY-1a2b";
const ATTACHMENT_NAME = "smoke-report.txt";
const ATTACHMENT_BYTES = new TextEncoder().encode("attachment-bytes-from-forward-smoke\n");

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
    throw new Error("fetchSource is not used by the forward smoke path");
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

function forwardContext(base: string): SkillContext {
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
    emailDestinationGrants: [],
    platformAdapter: {} as PlatformAdapter,
  };
}

/** The archived original this smoke forwards: pure CRLF wire bytes plus one attachment. */
function smokeSourceBytes(): Uint8Array {
  return new TextEncoder().encode(
    `From: sender@partner.example\r\n` +
      `To: ${SELF_ADDRESS}\r\n` +
      `Subject: ${SOURCE_SUBJECT}\r\n` +
      `Message-ID: ${SOURCE_RAW_ID}\r\n` +
      `Date: Thu, 15 Oct 2026 09:00:00 +0000\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: multipart/mixed; boundary="smoke-src"\r\n` +
      `\r\n` +
      `--smoke-src\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      `${SOURCE_BODY}\r\n` +
      `--smoke-src\r\n` +
      `Content-Type: text/plain; name="${ATTACHMENT_NAME}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `Content-Disposition: attachment; filename="${ATTACHMENT_NAME}"\r\n` +
      `\r\n` +
      `${btoa(String.fromCharCode(...ATTACHMENT_BYTES))}\r\n` +
      `--smoke-src--\r\n`,
  );
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

interface SmokeHarness {
  handler: EmailComposeHandler;
  store: EmailMessageStore;
  imap: RecordingImap;
  emailRoot: string;
  sourceBytes: Uint8Array;
  grant: DestinationGrant;
}

/**
 * Build the real boundary for one smoke case: real store with a real archived source, real mail
 * service over the local SMTP fixture, real handler.
 */
async function buildSmokeHarness(
  base: string,
  smtpService: EmailSmtpTestService,
): Promise<SmokeHarness> {
  const imap = new RecordingImap();
  const emailRoot = join(base, "email");
  const store = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
  const sourceBytes = smokeSourceBytes();
  const recordId = await store.putSource(OWNER, sourceBytes, {
    from: "sender@partner.example",
    subject: SOURCE_SUBJECT,
    wireIds: { messageId: SOURCE_RAW_ID },
    plainBody: SOURCE_BODY,
    date: "2026-10-15T09:00:00.000Z",
    attachmentPayloads: [
      { filename: ATTACHMENT_NAME, mimeType: "text/plain", content: ATTACHMENT_BYTES },
    ],
  });
  const service = new EmailMailService({
    config: emailConfig(smtpService.port),
    emailRoot,
    submissionStore: new SubmissionStore(emailRoot),
    messageStore: store,
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
    channels: [{ id: `email/account/${OWNER}`, enabled: true }],
    builder: new OutgoingMimeBuilder({
      fromAddress: BOT,
      now: () => new Date("2026-10-17T00:00:00Z"),
    }),
  });
  return {
    handler: new EmailComposeHandler({ mailService: service, forwardSourceStore: store }),
    store,
    imap,
    emailRoot,
    sourceBytes,
    grant: {
      grantId: GRANT_ID,
      sessionId: SESSION_ID,
      workId: WORK_ID,
      owner: OWNER,
      action: "forward",
      canonicalRecipient: RECIPIENT_CANONICAL,
      sourceRecordId: recordId,
      requestDigest: "d".repeat(64),
    },
  };
}

Deno.test("smoke - a granted forward reaches a real local SMTP peer with the original bytes intact", async () => {
  await withSmtpService({}, async (smtpService) => {
    const base = await Deno.makeTempDir();
    try {
      const harness = await buildSmokeHarness(base, smtpService);
      const result = await harness.handler.handleSendEmail(
        {
          grantId: GRANT_ID,
          request: {
            action: "forward",
            sourceRecordId: harness.grant.sourceRecordId,
            to: RECIPIENT,
            subject: `Fwd: ${SOURCE_SUBJECT}`,
            body: "Forwarding the original for you.",
          },
        },
        {
          ...forwardContext(base),
          emailDestinationGrants: [harness.grant],
        },
      );

      assertEquals(result.success, true, result.error);
      assertEquals(result.emailSubmission?.phase, "submitted");
      assertEquals(
        smtpService.dataTransactions.length,
        1,
        "exactly one SMTP DATA transaction for one forwarded message",
      );
      const transaction = smtpService.dataTransactions[0];
      assertEquals(transaction.envelopeFrom, BOT);
      assertEquals(transaction.recipients, [RECIPIENT_CANONICAL]);

      const wire = latin1Decode(transaction.decoded);
      const parts = parseMimeParts(wire);
      const rawPart = parts.find((part) => part.contentType === "message/rfc822");
      assert(rawPart !== undefined, "the peer received the original as message/rfc822");
      assertEquals(
        decodePartBody(rawPart),
        harness.sourceBytes,
        "the original message bytes reach the peer byte-for-byte",
      );
      const attachment = parts.find((part) => part.filename === ATTACHMENT_NAME);
      assert(attachment !== undefined, "the original attachment reaches the peer");
      assertEquals(decodePartBody(attachment), ATTACHMENT_BYTES);
      assertStringIncludes(latin1Decode(transaction.decoded), FORWARD_SECTION_MARKER);
      // The accepted bytes are the ones copied to the sent folder.
      assertEquals(harness.imap.appended.length, 1);
      assertEquals(harness.imap.appended[0], transaction.decoded);
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
});

Deno.test("smoke - a rejected SMTP peer yields an explicit failure with no second transaction", async () => {
  await withSmtpService({ rejectFinal: true }, async (smtpService) => {
    const base = await Deno.makeTempDir();
    try {
      const harness = await buildSmokeHarness(base, smtpService);
      const result = await harness.handler.handleSendEmail(
        {
          grantId: GRANT_ID,
          request: {
            action: "forward",
            sourceRecordId: harness.grant.sourceRecordId,
            to: RECIPIENT,
            subject: `Fwd: ${SOURCE_SUBJECT}`,
            body: "Forwarding the original for you.",
          },
        },
        {
          ...forwardContext(base),
          emailDestinationGrants: [harness.grant],
        },
      );

      assertEquals(result.success, false);
      assertEquals(result.emailSubmission?.phase, "failed");
      assertStringIncludes(result.error ?? "", "nothing was delivered");
      assertEquals(smtpService.dataTransactions.length, 1);
      assertEquals(harness.imap.appended.length, 0);
      assert(
        await Deno.stat(harness.emailRoot).then(() => true, () => false),
        "the submission journal is still durable evidence",
      );
    } finally {
      await Deno.remove(base, { recursive: true });
    }
  });
});
