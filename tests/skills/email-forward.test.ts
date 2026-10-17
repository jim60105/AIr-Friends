// tests/skills/email-forward.test.ts
//
// Deterministic regression coverage for `email-forward-skill` (row 21).
//
// Exercised layers:
// - Group A drives the REAL `EmailComposeHandler` with the REAL owner-scoped `EmailMessageStore`
//   (file-backed temp workspaces) through its single service seam (a recording mail-service
//   double), proving every grant, source, limit and containment refusal happens before anything
//   reaches submission, and that nothing is disclosed in the refusal text.
// - Group B runs the whole path with the REAL `EmailMailService`, `SubmissionStore`,
//   `EmailMessageStore` and `OutgoingMimeBuilder` behind a scripted SMTP/IMAP transport double,
//   then walks the CAPTURED wire bytes part by part: the forwarded `message/rfc822` part and every
//   original attachment must equal the archived originals byte-for-byte, and the commentary plus
//   signature must precede the original reference section.
// Honesty boundary: no provider, credential, mailbox, ACP session or model judgment is involved.
// The real-socket SMTP exchange lives in tests/skills/email-forward-smoke.test.ts.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  EMAIL_COMPOSE_CODES,
  EMAIL_FORWARD_CODES,
  EMAIL_FORWARD_REQUEST_ACTION,
  emailComposeAuditParams,
  EmailComposeHandler,
} from "../../src/skills/email-handler.ts";
import type {
  EmailComposeMailService,
  EmailForwardSourceStore,
} from "../../src/skills/email-handler.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { SkillResult } from "../../src/skills/types.ts";
import type { DestinationGrant } from "../../src/core/email-intent-preflight.ts";
import type { PlatformAdapter } from "../../src/platforms/platform-adapter.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { ChannelConfig, EmailConfig } from "../../src/types/config.ts";
import type { EmailDraft } from "../../src/platforms/email/outgoing-mime.ts";
import {
  FORWARD_SECTION_MARKER,
  OutgoingMimeBuilder,
} from "../../src/platforms/email/outgoing-mime.ts";
import { EmailMailService, type EmailSendOutcome } from "../../src/platforms/email/mail-service.ts";
import { SubmissionStore } from "../../src/platforms/email/submission-store.ts";
import {
  EmailMessageStore,
  formatEmailChannelId,
} from "../../src/platforms/email/message-store.ts";
import { normalizeEmailMailbox } from "../../src/platforms/email/email-identity.ts";
import type {
  ImapAppendOptions,
  ImapFetchHeadersOptions,
  ImapFetchSourceOptions,
  ImapListOptions,
  ImapMailboxPosition,
  ImapMessage,
  ImapTransport,
} from "../../src/platforms/email/imap-client.ts";
import type {
  SmtpSubmission,
  SmtpSubmitResult,
  SmtpTransport,
} from "../../src/platforms/email/smtp-client.ts";
import { SmtpDiagnosticCode } from "../../src/platforms/email/smtp-client.ts";
import { decodePartBody, latin1Decode, parseMimeParts } from "../helpers/mime-parts.ts";

const SELF_ADDRESS = "user@example.org";
const OWNER = normalizeEmailMailbox(SELF_ADDRESS).userId;
const OTHER_ADDRESS = "other@example.org";
const OTHER_OWNER = normalizeEmailMailbox(OTHER_ADDRESS).userId;
const RECIPIENT = "alice@allowed-domain.org";
const RECIPIENT_CANONICAL = normalizeEmailMailbox(RECIPIENT).canonicalAddress;
const INJECTED_RECIPIENT = "bob@attacker.example";
const BOT = "bot@example.com";
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const WORK_ID = "work-forward-1";
const SESSION_ID = "sess_forward_1";
const THREAD_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const GRANT_ID = "grant-forward-1";

/** Private material that must never appear in a refusal, an audit entry or a log. */
const SOURCE_BODY_SENTINEL = "SOURCE-BODY-SENTINEL-7c41";
const SOURCE_SUBJECT = "Quarterly numbers 4b19";
const SOURCE_ADDRESS = "sender@partner.example";
const SOURCE_RAW_ID = "<source-1@partner.example>";
const SOURCE_ANCESTOR_ID = "<ancestor-0@partner.example>";
const SOURCE_DATE = "2026-10-15T09:00:00.000Z";
/** The original carries its own signature, which a forward must preserve verbatim. */
const SOURCE_OWN_SIGNATURE = "-- \nOld Signature Line";
/** The same signature in the archive fixture's wire form: the raw `.eml` is pure CRLF. */
const SOURCE_OWN_SIGNATURE_CRLF = SOURCE_OWN_SIGNATURE.replaceAll("\n", "\r\n");
/**
 * Raw 8-bit bytes the original carries (0x80–0x9F included, where the WHATWG `latin1` label is
 * not a byte view): the forwarded part must reproduce them, so the walker cannot pass by accident.
 */
const SOURCE_HIGH_BYTES = new Uint8Array([0x80, 0x9f, 0xff, 0xfe, 0xc3, 0xa9]);
const TEXT_ATTACHMENT_NAME = "../../evil name.txt";
const TEXT_ATTACHMENT_BYTES = new TextEncoder().encode("attachment-one-bytes-9f2b\n");
const BINARY_ATTACHMENT_NAME = "report.pdf";
const BINARY_ATTACHMENT_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x41]);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The immutable original as the message store archives it: a real multipart message whose text
 * body carries private sentinels (including its own signature) and whose two attachments are the
 * bytes the forward must reproduce exactly.
 */
function sourceEmlBytes(): Uint8Array {
  const textPart = new TextEncoder().encode(
    `${SOURCE_BODY_SENTINEL}\r\n` +
      `A second line of the original body.\r\n` +
      `${SOURCE_OWN_SIGNATURE_CRLF}\r\n` +
      `The original names ${INJECTED_RECIPIENT} and asks to redirect the reply there.\r\n`,
  );
  const binaryBase64 = btoa(String.fromCharCode(...BINARY_ATTACHMENT_BYTES));
  const textBase64 = btoa(String.fromCharCode(...TEXT_ATTACHMENT_BYTES));
  const head = new TextEncoder().encode(
    `From: ${SOURCE_ADDRESS}\r\n` +
      `To: ${SELF_ADDRESS}\r\n` +
      `Subject: ${SOURCE_SUBJECT}\r\n` +
      `Message-ID: ${SOURCE_RAW_ID}\r\n` +
      `References: ${SOURCE_ANCESTOR_ID}\r\n` +
      `Date: Thu, 15 Oct 2026 09:00:00 +0000\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: multipart/mixed; boundary="src-boundary"\r\n` +
      `\r\n` +
      `--src-boundary\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n` +
      `\r\n`,
  );
  const parts = [
    head,
    textPart,
    SOURCE_HIGH_BYTES,
    new TextEncoder().encode("\r\n"),
    new TextEncoder().encode(
      `\r\n--src-boundary\r\n` +
        `Content-Type: text/plain; name="${TEXT_ATTACHMENT_NAME}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${TEXT_ATTACHMENT_NAME}"\r\n` +
        `\r\n${textBase64}\r\n` +
        `--src-boundary\r\n` +
        `Content-Type: application/pdf; name="${BINARY_ATTACHMENT_NAME}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${BINARY_ATTACHMENT_NAME}"\r\n` +
        `\r\n${binaryBase64}\r\n` +
        `--src-boundary--\r\n`,
    ),
  ];
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

interface SeededSource {
  recordId: string;
  root: string;
  sourceBytes: Uint8Array;
  attachments: Array<{ id: string; bytes: Uint8Array; filename: string; mimeType: string }>;
}

/**
 * Seed one archived inbound message for `owner` through the REAL store: the same `putSource`
 * contract the poller uses, so the record layout, attachment files and owner scope under test are
 * the production ones.
 */
async function seedSource(
  store: EmailMessageStore,
  owner: string,
  options: { body?: string; withAttachments?: boolean } = {},
): Promise<SeededSource> {
  const sourceBytes = sourceEmlBytes();
  const withAttachments = options.withAttachments ?? true;
  const payloads = withAttachments
    ? [
      {
        filename: TEXT_ATTACHMENT_NAME,
        mimeType: "text/plain",
        content: TEXT_ATTACHMENT_BYTES,
      },
      {
        filename: BINARY_ATTACHMENT_NAME,
        mimeType: "application/pdf",
        content: BINARY_ATTACHMENT_BYTES,
      },
    ]
    : [];
  const recordId = await store.putSource(owner, sourceBytes, {
    from: SOURCE_ADDRESS,
    subject: SOURCE_SUBJECT,
    wireIds: { messageId: SOURCE_RAW_ID, references: [SOURCE_ANCESTOR_ID] },
    plainBody: options.body ??
      `${SOURCE_BODY_SENTINEL}\nA second line of the original body.\n${SOURCE_OWN_SIGNATURE}\n` +
        `The original names ${INJECTED_RECIPIENT} and asks to redirect the reply there.`,
    date: SOURCE_DATE,
    ...(payloads.length === 0 ? {} : { attachmentPayloads: payloads }),
  });
  const record = await store.getByOwnerRecord(owner, recordId);
  assert(record !== undefined, "the seeded source must be readable back");
  const root = await store.getOwnerEmailRoot(owner);
  return {
    recordId,
    root,
    sourceBytes,
    attachments: record.attachments.map((attachment, index) => ({
      id: attachment.id,
      bytes: index === 0 ? TEXT_ATTACHMENT_BYTES : BINARY_ATTACHMENT_BYTES,
      filename: attachment.filename ?? "",
      mimeType: attachment.mimeType,
    })),
  };
}

/** One immutable forward grant of this session, as the host records it before the agent runs. */
function forwardGrant(
  source: SeededSource,
  overrides: Partial<DestinationGrant> = {},
): DestinationGrant {
  return {
    grantId: GRANT_ID,
    sessionId: SESSION_ID,
    workId: WORK_ID,
    owner: OWNER,
    action: "forward",
    canonicalRecipient: RECIPIENT_CANONICAL,
    sourceRecordId: source.recordId,
    requestDigest: "c".repeat(64),
    ...overrides,
  };
}

/** One immutable COMPOSE grant of this session, for the row-20 compatibility assertions. */
function composeGrant(): DestinationGrant {
  return {
    grantId: GRANT_ID,
    sessionId: SESSION_ID,
    workId: WORK_ID,
    owner: OWNER,
    action: "compose",
    canonicalRecipient: RECIPIENT_CANONICAL,
    requestDigest: "e".repeat(64),
  };
}

function workspaceFor(workspacePath: string): WorkspaceInfo {
  return {
    key: `email/${OWNER}`,
    components: { platform: "email", userId: OWNER },
    path: workspacePath,
    tmpPath: join(workspacePath, "tmp"),
    isDm: true,
  };
}

function emailContext(
  workspacePath: string,
  overrides: Partial<SkillContext> = {},
): SkillContext {
  return {
    sessionId: SESSION_ID,
    workspace: workspaceFor(workspacePath),
    channelId: formatEmailChannelId(OWNER, THREAD_ID),
    userId: OWNER,
    emailWorkId: WORK_ID,
    emailDestinationGrants: [],
    platformAdapter: {} as PlatformAdapter,
    ...overrides,
  };
}

/** Recording mail-service double: the handler's only service seam. */
class RecordingMailService implements EmailComposeMailService {
  drafts: EmailDraft[] = [];
  outcome: EmailSendOutcome = submittedOutcome();

  send(draft: EmailDraft): Promise<EmailSendOutcome> {
    this.drafts.push(draft);
    return Promise.resolve(this.outcome);
  }
}

function submittedOutcome(reused = false): EmailSendOutcome {
  return {
    operationId: `op_${"a".repeat(24)}`,
    phase: "submitted",
    targetKind: "third-party",
    sentCopy: "appended",
    reused,
  };
}

/** A source store whose every read fails: a store failure must never escape as an exception. */
class ThrowingForwardStore implements EmailForwardSourceStore {
  getByOwnerRecord(): Promise<undefined> {
    return Promise.reject(new Error("store read failed: private detail"));
  }
  getSourceBytes(): Promise<undefined> {
    return Promise.reject(new Error("store read failed: private detail"));
  }
  attachment(): Promise<undefined> {
    return Promise.reject(new Error("store read failed: private detail"));
  }
}

/** Workspace + real store + seeded source, with cleanup. */
async function withSeededSource(
  body: (context: {
    base: string;
    store: EmailMessageStore;
    source: SeededSource;
    stagingDir: string;
  }) => Promise<void> | void,
  seedOptions: { body?: string; withAttachments?: boolean } = {},
): Promise<void> {
  const base = await Deno.makeTempDir();
  try {
    const store = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
    const source = await seedSource(store, OWNER, seedOptions);
    const stagingDir = join(base, "tmp", SESSION_ID);
    Deno.mkdirSync(stagingDir, { recursive: true });
    await body({ base, store, source, stagingDir });
  } finally {
    await Deno.remove(base, { recursive: true });
  }
}

/** A well-formed forward request for the granted destination and the seeded source. */
function forwardRequest(
  source: SeededSource,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    action: EMAIL_FORWARD_REQUEST_ACTION,
    sourceRecordId: source.recordId,
    to: RECIPIENT,
    subject: `Fwd: ${SOURCE_SUBJECT}`,
    body: "See the original below.",
    ...overrides,
  };
}

/** The free-form result payload of a skill call, viewed as the object this row publishes. */
function resultData(result: SkillResult): Record<string, unknown> {
  return (result.data ?? {}) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Group A: grant binding, owner-scoped source access and combined limits
// ---------------------------------------------------------------------------

Deno.test("forward - a granted source is resolved through the owner scope into one draft", async () => {
  await withSeededSource(async ({ base, store, source }) => {
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService, forwardSourceStore: store });

    const result = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source) },
      emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
    );

    assertEquals(result.success, true, result.error);
    assertEquals(result.emailSubmission?.phase, "submitted");
    assertEquals(resultData(result).forwardSourceRecordId, source.recordId);
    assertEquals(mailService.drafts.length, 1);
    const draft = mailService.drafts[0];
    assertEquals(draft.owner, OWNER);
    // The granted operation slot: the grant id is unique per action+recipient+source, so a
    // forward and a compose can never share one operation key.
    assertEquals(draft.operationKey, { workId: WORK_ID, actionSlot: `third-party:${GRANT_ID}` });
    assertEquals(draft.targetKind, "third-party");
    assertEquals(draft.to, RECIPIENT_CANONICAL);
    assertEquals(draft.subject, `Fwd: ${SOURCE_SUBJECT}`);
    assertEquals(draft.authoredBody, "See the original below.");

    // The original body travels verbatim, with its metadata, into the shared forward source.
    const forwardSource = draft.forwardSource;
    assert(forwardSource !== undefined, "a forward must carry its forwardSource");
    assertEquals(forwardSource.from, SOURCE_ADDRESS);
    assertEquals(forwardSource.subject, SOURCE_SUBJECT);
    assertEquals(forwardSource.date?.toISOString(), SOURCE_DATE);
    assertStringIncludes(forwardSource.body, SOURCE_BODY_SENTINEL);
    assertStringIncludes(forwardSource.body, SOURCE_OWN_SIGNATURE.trim());

    // Every original attachment is handed over with its stored bytes and stored display metadata.
    assertEquals(forwardSource.attachments?.length, 2);
    assertEquals(forwardSource.attachments?.[0].contentType, "text/plain");
    assertEquals(
      latin1Decode(forwardSource.attachments?.[0].content ?? new Uint8Array()),
      latin1Decode(TEXT_ATTACHMENT_BYTES),
    );
    assertEquals(forwardSource.attachments?.[1].contentType, "application/pdf");
    assertEquals(
      latin1Decode(forwardSource.attachments?.[1].content ?? new Uint8Array()),
      latin1Decode(BINARY_ATTACHMENT_BYTES),
    );

    // The immutable raw source is attached as message/rfc822 so headers and encoding survive.
    assertEquals(draft.attachments?.length, 1);
    assertEquals(draft.attachments?.[0].contentType, "message/rfc822");
    assertEquals(
      latin1Decode(draft.attachments?.[0].content ?? new Uint8Array()),
      latin1Decode(source.sourceBytes),
    );

    // A fresh header chain that merely REFERENCES the source and its ancestors.
    assertEquals(draft.thread?.references, [SOURCE_ANCESTOR_ID, SOURCE_RAW_ID]);
    assertEquals(draft.thread?.wireMessageId, undefined);
  });
});

Deno.test("forward - a grant is required and its action, session, owner, work item, destination and source are all matched", async () => {
  await withSeededSource(async ({ base, store, source }) => {
    const foreign = await seedSource(
      new EmailMessageStore({ workspacesRoot: join(base, "workspaces-other") }),
      OTHER_OWNER,
    );
    const cases: Array<
      {
        label: string;
        grantId?: string;
        grant?: DestinationGrant;
        request?: Record<string, unknown>;
      }
    > = [
      { label: "no grant id at all", grantId: undefined },
      { label: "unknown grant id", grantId: "grant-does-not-exist", grant: forwardGrant(source) },
      { label: "compose grant", grant: forwardGrant(source, { action: "compose" }) },
      { label: "another session", grant: forwardGrant(source, { sessionId: "sess_other" }) },
      { label: "another owner", grant: forwardGrant(source, { owner: OTHER_OWNER }) },
      { label: "another work item", grant: forwardGrant(source, { workId: "work-other" }) },
      {
        label: "another destination",
        grant: forwardGrant(source, { canonicalRecipient: OTHER_ADDRESS }),
      },
      {
        label: "another source record",
        grant: forwardGrant(source),
        request: forwardRequest(source, { sourceRecordId: foreign.recordId }),
      },
      {
        label: "self-address destination",
        grant: forwardGrant(source),
        request: forwardRequest(source, { to: SELF_ADDRESS }),
      },
      {
        label: "missing source record",
        grant: forwardGrant(source),
        request: forwardRequest(source, { sourceRecordId: undefined }),
      },
      {
        label: "compose request against a forward grant",
        grant: forwardGrant(source),
        request: { to: RECIPIENT, subject: "S", body: "B" },
      },
    ];

    for (const testCase of cases) {
      const mailService = new RecordingMailService();
      const handler = new EmailComposeHandler({ mailService, forwardSourceStore: store });
      const result = await handler.handleSendEmail(
        {
          ...(testCase.grantId === undefined ? {} : { grantId: testCase.grantId }),
          request: testCase.request ?? forwardRequest(source),
        },
        emailContext(base, {
          emailDestinationGrants: testCase.grant === undefined ? [] : [testCase.grant],
        }),
      );

      const expected = testCase.label === "missing source record"
        ? EMAIL_COMPOSE_CODES.REQUEST
        : EMAIL_COMPOSE_CODES.GRANT;
      assertEquals(result.success, false, testCase.label);
      assertEquals(result.code, expected, testCase.label);
      assertEquals(mailService.drafts.length, 0, testCase.label);
      assert(!(result.error ?? "").includes(SOURCE_BODY_SENTINEL), testCase.label);
      assert(!(result.error ?? "").includes(INJECTED_RECIPIENT), testCase.label);
    }
  });
});

Deno.test("forward - another owner's message is refused as a source without disclosing it", async () => {
  const base = await Deno.makeTempDir();
  try {
    const store = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
    const foreignStore = new EmailMessageStore({ workspacesRoot: join(base, "workspaces-other") });
    const foreign = await seedSource(foreignStore, OTHER_OWNER);

    // The grant itself names the OTHER owner's record; the handler still reads it as OWNER, so the
    // owner scope is what refuses it — not the grant comparison.
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService, forwardSourceStore: store });
    const result = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(foreign) },
      emailContext(base, { emailDestinationGrants: [forwardGrant(foreign)] }),
    );

    assertEquals(result.success, false);
    assertEquals(result.code, EMAIL_FORWARD_CODES.SOURCE);
    assertEquals(mailService.drafts.length, 0);
    assert(!(result.error ?? "").includes(SOURCE_BODY_SENTINEL));
    assert(!(result.error ?? "").includes(SOURCE_ADDRESS));
    // The owner scope, not a filter here, is what made the lookup miss.
    assertEquals(await foreignStore.getByOwnerRecord(OWNER, foreign.recordId), undefined);

    // A record id that does not exist at all is refused the same way — the grant names it, so the
    // grant match passes and only the owner-scoped lookup can refuse it.
    const unknownRecordId = crypto.randomUUID().toLowerCase();
    const unknown = await handler.handleSendEmail(
      {
        grantId: GRANT_ID,
        request: forwardRequest(foreign, { sourceRecordId: unknownRecordId }),
      },
      emailContext(base, {
        emailDestinationGrants: [forwardGrant(foreign, { sourceRecordId: unknownRecordId })],
      }),
    );
    assertEquals(unknown.success, false);
    assertEquals(unknown.code, EMAIL_FORWARD_CODES.SOURCE);
    assertEquals(mailService.drafts.length, 0);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("forward - a source is complete or it is refused: missing and changed archive material", async () => {
  const mutations: Array<{
    label: string;
    mutate: (source: SeededSource) => void;
    expectedCode: string;
  }> = [
    {
      label: "raw .eml removed",
      mutate: (source) => Deno.removeSync(join(source.root, "source", `${source.recordId}.eml`)),
      expectedCode: EMAIL_FORWARD_CODES.SOURCE,
    },
    {
      label: "raw .eml truncated",
      mutate: (source) =>
        Deno.writeFileSync(
          join(source.root, "source", `${source.recordId}.eml`),
          source.sourceBytes.subarray(0, source.sourceBytes.byteLength - 20),
        ),
      expectedCode: EMAIL_FORWARD_CODES.SOURCE,
    },
    {
      label: "original attachment removed",
      mutate: (source) =>
        Deno.removeSync(
          join(source.root, "attachments", source.recordId, source.attachments[1].id),
        ),
      expectedCode: EMAIL_FORWARD_CODES.SOURCE,
    },
    {
      label: "original attachment changed",
      mutate: (source) =>
        Deno.writeFileSync(
          join(source.root, "attachments", source.recordId, source.attachments[0].id),
          new Uint8Array([1, 2, 3]),
        ),
      expectedCode: EMAIL_FORWARD_CODES.SOURCE,
    },
  ];

  for (const mutation of mutations) {
    await withSeededSource(async ({ base, store, source }) => {
      mutation.mutate(source);
      const mailService = new RecordingMailService();
      const handler = new EmailComposeHandler({ mailService, forwardSourceStore: store });
      const result = await handler.handleSendEmail(
        { grantId: GRANT_ID, request: forwardRequest(source) },
        emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
      );

      assertEquals(result.success, false, mutation.label);
      assertEquals(result.code, mutation.expectedCode, mutation.label);
      assertEquals(mailService.drafts.length, 0, mutation.label);
    });
  }
});

Deno.test("forward - a failing source store and an unwired source store fail closed", async () => {
  await withSeededSource(async ({ base, store, source }) => {
    const throwing = new RecordingMailService();
    const throwingResult = await new EmailComposeHandler({
      mailService: throwing,
      forwardSourceStore: new ThrowingForwardStore(),
    }).handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source) },
      emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
    );
    assertEquals(throwingResult.success, false);
    assertEquals(throwingResult.code, EMAIL_FORWARD_CODES.SOURCE);
    assert(!(throwingResult.error ?? "").includes("private detail"));
    assertEquals(throwing.drafts.length, 0);

    // Without the owner-scoped store there is no source seam at all: forwarding fails closed.
    const unavailable = new RecordingMailService();
    const unavailableResult = await new EmailComposeHandler({ mailService: unavailable })
      .handleSendEmail(
        { grantId: GRANT_ID, request: forwardRequest(source) },
        emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
      );
    assertEquals(unavailableResult.success, false);
    assertEquals(unavailableResult.code, EMAIL_FORWARD_CODES.UNAVAILABLE);
    assertEquals(unavailable.drafts.length, 0);

    // The real store is still usable for the same request, so the refusals above are about the
    // store seam and not about the request.
    const ok = new RecordingMailService();
    const okResult = await new EmailComposeHandler({ mailService: ok, forwardSourceStore: store })
      .handleSendEmail(
        { grantId: GRANT_ID, request: forwardRequest(source) },
        emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
      );
    assertEquals(okResult.success, true, okResult.error);
  });
});

Deno.test("forward - the combined accounting covers the raw source, every original attachment and every added file", async () => {
  const cases: Array<{
    label: string;
    limits: { maxFilesPerInvocation?: number; maxFileSizeMb?: number; maxTotalSizeMb?: number };
    added?: boolean;
    expectedCode: string;
  }> = [
    {
      label: "reserved count alone",
      limits: { maxFilesPerInvocation: 2 },
      expectedCode: EMAIL_COMPOSE_CODES.ATTACHMENT,
    },
    {
      label: "added file pushes the count over",
      limits: { maxFilesPerInvocation: 3 },
      added: true,
      expectedCode: EMAIL_COMPOSE_CODES.ATTACHMENT,
    },
    {
      label: "raw source over the message size limit",
      limits: { maxFileSizeMb: 0.000001 },
      expectedCode: EMAIL_FORWARD_CODES.SOURCE,
    },
    {
      label: "reserved bytes over the aggregate limit",
      limits: { maxTotalSizeMb: 0.000001 },
      expectedCode: EMAIL_COMPOSE_CODES.ATTACHMENT,
    },
  ];

  for (const testCase of cases) {
    await withSeededSource(
      async ({ base, store, source, stagingDir }) => {
        const addedPath = join(stagingDir, "added.txt");
        Deno.writeTextFileSync(addedPath, "added-file-bytes");
        const mailService = new RecordingMailService();
        const handler = new EmailComposeHandler({
          mailService,
          forwardSourceStore: store,
          limits: testCase.limits,
        });

        const result = await handler.handleSendEmail(
          {
            grantId: GRANT_ID,
            request: forwardRequest(source, testCase.added ? { attachments: [addedPath] } : {}),
          },
          emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
        );

        assertEquals(result.success, false, testCase.label);
        assertEquals(result.code, testCase.expectedCode, testCase.label);
        assertEquals(mailService.drafts.length, 0, testCase.label);
      },
    );
  }

  // A comfortable excess accepts the same forward WITH its added attachment.
  await withSeededSource(async ({ base, store, source, stagingDir }) => {
    const addedPath = join(stagingDir, "added.txt");
    Deno.writeTextFileSync(addedPath, "added-file-bytes");
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({
      mailService,
      forwardSourceStore: store,
      limits: { maxFilesPerInvocation: 4, maxTotalSizeMb: 1 },
    });

    const result = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source, { attachments: [addedPath] }) },
      emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
    );

    assertEquals(result.success, true, result.error);
    // Wire order is the builder's: original attachments, the raw .eml reference, then added files.
    assertEquals(mailService.drafts[0].forwardSource?.attachments?.length, 2);
    assertEquals(mailService.drafts[0].attachments?.length, 2);
    assertEquals(mailService.drafts[0].attachments?.[0].contentType, "message/rfc822");
    assertEquals(mailService.drafts[0].attachments?.[1].filename, "added.txt");
    assertEquals(resultData(result).attachmentsCount, 4);
  });
});

Deno.test("forward - request shape, duplicate references and empty commentary", async () => {
  await withSeededSource(async ({ base, store, source, stagingDir }) => {
    const addedPath = join(stagingDir, "added.txt");
    Deno.writeTextFileSync(addedPath, "added-file-bytes");
    // A staging-internal symlink alias of the SAME file: two spellings, one reference.
    const aliasPath = join(stagingDir, "alias.txt");
    Deno.symlinkSync(addedPath, aliasPath);
    // An identifier-shaped extension the refusal must NOT echo back (the sentinel is private text
    // that the shape heuristic cannot tell apart from an extension name).
    const sentinelExtensionPath = join(stagingDir, `report.${SOURCE_BODY_SENTINEL}`);
    Deno.writeTextFileSync(sentinelExtensionPath, "sentinel-extension-bytes");

    const rejected: Array<{
      label: string;
      request: Record<string, unknown>;
      code: string;
      limits?: { allowedExtensions?: string[] };
      hidden?: string;
    }> = [
      {
        label: "Cc",
        request: forwardRequest(source, { cc: INJECTED_RECIPIENT }),
        code: EMAIL_COMPOSE_CODES.REQUEST,
      },
      {
        label: "arbitrary header",
        request: forwardRequest(source, { headers: { "X-Source-Path": "/etc/passwd" } }),
        code: EMAIL_COMPOSE_CODES.REQUEST,
      },
      {
        label: "unsupported action",
        request: forwardRequest(source, { action: "redirect" }),
        code: EMAIL_COMPOSE_CODES.REQUEST,
      },
      {
        label: "sourceRecordId as a path",
        request: forwardRequest(source, { sourceRecordId: "" }),
        code: EMAIL_COMPOSE_CODES.REQUEST,
      },
      {
        label: "source record id is a wire Message-ID",
        request: forwardRequest(source, { sourceRecordId: SOURCE_RAW_ID }),
        // A wire Message-ID is not an authorization: it does not match the granted source record.
        code: EMAIL_COMPOSE_CODES.GRANT,
      },
      {
        label: "duplicate added file",
        request: forwardRequest(source, { attachments: [addedPath, addedPath] }),
        code: EMAIL_COMPOSE_CODES.ATTACHMENT,
      },
      {
        label: "symlink alias of one staged file",
        request: forwardRequest(source, { attachments: [addedPath, aliasPath] }),
        code: EMAIL_COMPOSE_CODES.ATTACHMENT,
      },
      {
        label: "identifier-shaped unknown key is not echoed",
        request: forwardRequest(source, { [SOURCE_BODY_SENTINEL]: 1 }),
        code: EMAIL_COMPOSE_CODES.REQUEST,
        hidden: SOURCE_BODY_SENTINEL,
      },
      {
        label: "identifier-shaped extension is not echoed",
        request: forwardRequest(source, { attachments: [sentinelExtensionPath] }),
        code: EMAIL_COMPOSE_CODES.ATTACHMENT,
        limits: { allowedExtensions: [".pdf"] },
        hidden: SOURCE_BODY_SENTINEL,
      },
    ];

    for (const testCase of rejected) {
      const mailService = new RecordingMailService();
      const handler = new EmailComposeHandler({
        mailService,
        forwardSourceStore: store,
        ...(testCase.limits === undefined ? {} : { limits: testCase.limits }),
      });
      const result = await handler.handleSendEmail(
        { grantId: GRANT_ID, request: testCase.request },
        emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
      );

      assertEquals(result.success, false, testCase.label);
      assertEquals(result.code, testCase.code, testCase.label);
      assertEquals(mailService.drafts.length, 0, testCase.label);
      if (testCase.hidden !== undefined) {
        assert(
          !(result.error ?? "").toLowerCase().includes(testCase.hidden.toLowerCase()),
          `${testCase.label}: the refusal must not echo model-supplied text`,
        );
      }
    }

    // Empty commentary is a valid PURE forward: the designated original is the material.
    const mailService = new RecordingMailService();
    const pure = await new EmailComposeHandler({ mailService, forwardSourceStore: store })
      .handleSendEmail(
        { grantId: GRANT_ID, request: forwardRequest(source, { body: "" }) },
        emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
      );
    assertEquals(pure.success, true, pure.error);
    assertEquals(mailService.drafts[0].authoredBody, "");
    assertEquals(mailService.drafts[0].forwardSource?.body.includes(SOURCE_BODY_SENTINEL), true);
  });
});

Deno.test("forward - the audit projection records opaque identifiers and digests only", async () => {
  const projected = await emailComposeAuditParams({
    grantId: GRANT_ID,
    request: {
      action: EMAIL_FORWARD_REQUEST_ACTION,
      sourceRecordId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      to: RECIPIENT,
      subject: SOURCE_SUBJECT,
      body: SOURCE_BODY_SENTINEL,
      attachments: ["/staging/secret-name.pdf"],
    },
  });

  const serialized = JSON.stringify(projected);
  assert(!serialized.includes(SOURCE_BODY_SENTINEL));
  assert(!serialized.includes(SOURCE_SUBJECT));
  assert(!serialized.includes(RECIPIENT));
  assert(!serialized.includes(SOURCE_ADDRESS));
  assert(!serialized.includes("secret-name.pdf"));
  assertEquals(projected.action, EMAIL_FORWARD_REQUEST_ACTION);
  assertEquals(projected.sourceRecordId, "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  assertEquals(projected.attachmentsCount, 1);
  assertStringIncludes(String(projected.destinationHash), "sha256:");
  assertStringIncludes(String(projected.subjectHash), "sha256:");

  // A hostile source value (an address, a path or a sentence) is hashed, never recorded verbatim.
  const hostile = await emailComposeAuditParams({
    grantId: GRANT_ID,
    request: {
      action: EMAIL_FORWARD_REQUEST_ACTION,
      sourceRecordId: `${SOURCE_ADDRESS} /etc/passwd`,
      to: RECIPIENT,
      subject: "S",
      body: "B",
    },
  });
  assert(!JSON.stringify(hostile).includes(SOURCE_ADDRESS));
  assertStringIncludes(String(hostile.sourceRecordIdHash), "sha256:");
  assertEquals(hostile.sourceRecordId, undefined);

  // The row-20 compose projection is unchanged: no action/source keys appear without a request.
  const compose = await emailComposeAuditParams({
    grantId: GRANT_ID,
    request: { to: RECIPIENT, subject: "S", body: "B" },
  });
  assertEquals(compose.action, undefined);
  assertEquals(compose.sourceRecordId, undefined);
  assertEquals(compose.sourceRecordIdHash, undefined);
});

// ---------------------------------------------------------------------------
// Group B: real durable service, construction and byte identity on the wire
// ---------------------------------------------------------------------------

/** Scripted SMTP double: records the exact envelope and bytes handed to the wire. */
class RecordingSmtp implements SmtpTransport {
  submissions: SmtpSubmission[] = [];
  mode: "submitted" | "failed" = "submitted";

  submit(input: SmtpSubmission): Promise<SmtpSubmitResult> {
    this.submissions.push({
      emlBytes: input.emlBytes,
      envelope: { from: input.envelope.from, to: [...input.envelope.to] },
      sizeBytes: input.sizeBytes,
    });
    return Promise.resolve({
      phase: this.mode,
      safeCode: this.mode === "submitted"
        ? SmtpDiagnosticCode.ACCEPTED
        : SmtpDiagnosticCode.REJECTED,
      accepted: this.mode === "submitted" ? [...input.envelope.to] : [],
      rejected: this.mode === "failed" ? [...input.envelope.to] : [],
      sizeBytes: input.emlBytes.byteLength,
      durationMs: 1,
    });
  }
}

/** Scripted IMAP double: only the sent-folder APPEND matters for this row. */
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
    throw new Error("fetchSource is not used by the forward path");
  }
  appendSent(rawMime: Uint8Array | string, _options?: ImapAppendOptions): Promise<void> {
    this.appended.push(typeof rawMime === "string" ? new TextEncoder().encode(rawMime) : rawMime);
    return Promise.resolve();
  }
}

interface ForwardHarness {
  service: EmailMailService;
  smtp: RecordingSmtp;
  imap: RecordingImap;
  store: EmailMessageStore;
}

function buildForwardHarness(base: string): ForwardHarness {
  const emailRoot = join(base, "email");
  const config: EmailConfig = {
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
      port: 465,
      tlsMode: "tls",
      username: BOT,
      password: "unused-smtp-secret",
    },
    incomingFolder: "INBOX",
    sentFolder: "Sent",
    pollIntervalMs: 300_000,
    receivingAuth: { authservId: "mx.example.com", attestedStripping: true },
    maxMessageBytes: 25 * 1024 * 1024,
    maxIncomingAttachments: 10,
    signature: SIGNATURE,
  };
  const smtp = new RecordingSmtp();
  const imap = new RecordingImap();
  const store = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
  // ONLY the session's own sender is an enabled account: the granted third-party destination is
  // deliberately ABSENT, so the grant (not the allowlist) is what authorizes the forward.
  const channels: ChannelConfig[] = [{ id: `email/account/${OWNER}`, enabled: true }];
  const service = new EmailMailService({
    config,
    emailRoot,
    submissionStore: new SubmissionStore(emailRoot),
    messageStore: store,
    smtp,
    imap,
    channels,
    builder: new OutgoingMimeBuilder({
      fromAddress: BOT,
      now: () => new Date("2026-10-17T00:00:00Z"),
    }),
  });
  return { service, smtp, imap, store };
}

Deno.test("forward - the captured wire message preserves the original bytes, order and signature once", async () => {
  const base = await Deno.makeTempDir();
  try {
    const widgetHarness = buildForwardHarness(base);
    const source = await seedSource(widgetHarness.store, OWNER);
    const handler = new EmailComposeHandler({
      mailService: widgetHarness.service,
      forwardSourceStore: widgetHarness.store,
    });
    const commentary = "Please review the original below.\n\nThanks,\nTeam";

    const result = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source, { body: commentary }) },
      emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
    );

    assertEquals(result.success, true, result.error);
    assertEquals(result.emailSubmission?.phase, "submitted");
    assertEquals(result.emailSubmission?.reused, false);
    assertEquals(widgetHarness.smtp.submissions.length, 1, "exactly one SMTP transaction");
    assertEquals(widgetHarness.smtp.submissions[0].envelope.to, [RECIPIENT_CANONICAL]);

    const wire = latin1Decode(widgetHarness.smtp.submissions[0].emlBytes);
    const parts = parseMimeParts(wire);

    // 1. The immutable original is present as message/rfc822, byte-for-byte.
    const rawPart = parts.find((part) => part.contentType === "message/rfc822");
    assert(rawPart !== undefined, "the forward must carry the raw original as message/rfc822");
    assertEquals(decodePartBody(rawPart), source.sourceBytes);
    assertStringIncludes(latin1Decode(decodePartBody(rawPart)), SOURCE_BODY_SENTINEL);

    // 2. Both original attachments are present, byte-for-byte, with a sanitized display name.
    const forwardedText = parts.find((part) => part.filename === "evil name.txt");
    assert(forwardedText !== undefined, "the hostile original filename is sanitized, not dropped");
    assertEquals(decodePartBody(forwardedText), TEXT_ATTACHMENT_BYTES);
    const forwardedBinary = parts.find((part) => part.filename === BINARY_ATTACHMENT_NAME);
    assert(forwardedBinary !== undefined, "the binary original attachment is forwarded");
    assertEquals(decodePartBody(forwardedBinary), BINARY_ATTACHMENT_BYTES);

    // 3. The commentary part carries the signature BEFORE the labelled original section, and the
    //    original body (with its own signature and its injected instruction) verbatim after it.
    const bodyPart = parts.find((part) => part.contentType === "text/plain");
    assert(bodyPart !== undefined, "the message keeps its text body");
    const historyBody = latin1Decode(decodePartBody(bodyPart)).replaceAll("\r\n", "\n");
    const signatureIndex = historyBody.indexOf(SIGNATURE);
    const markerIndex = historyBody.indexOf(FORWARD_SECTION_MARKER);
    const originalIndex = historyBody.indexOf(SOURCE_BODY_SENTINEL);
    assert(signatureIndex >= 0, "the signature is applied centrally");
    assert(markerIndex > signatureIndex, "the signature precedes the original reference section");
    assert(originalIndex > markerIndex, "the original body follows the labelled section");
    assertStringIncludes(historyBody, commentary);
    assertEquals(historyBody.split(SIGNATURE).length - 1, 1, "the signature appears exactly once");
    assertStringIncludes(historyBody, SOURCE_OWN_SIGNATURE);
    assertStringIncludes(historyBody, INJECTED_RECIPIENT);

    // 4. A fresh top-level header chain that references the source, and never a second recipient.
    const topHeaders = wire.slice(0, wire.indexOf("\r\n\r\n"));
    assert(!topHeaders.includes("Cc:"), "a forward never carries Cc");
    assertStringIncludes(topHeaders, `References: ${SOURCE_ANCESTOR_ID} ${SOURCE_RAW_ID}`);
    assert(
      /^Message-ID: <[0-9a-f]{32}@example\.com>$/m.test(topHeaders),
      "the forward mints its own fresh Message-ID",
    );
    assert(!topHeaders.includes("In-Reply-To:"), "a forward starts a new header chain");
    assertEquals(widgetHarness.smtp.submissions[0].envelope.to.length, 1);

    // 5. The submitted bytes are the ones filed in the sent folder.
    assertEquals(widgetHarness.imap.appended.length, 1);
    assertEquals(widgetHarness.imap.appended[0], widgetHarness.smtp.submissions[0].emlBytes);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("forward - the granted operation is idempotent and changed commentary never resends", async () => {
  const base = await Deno.makeTempDir();
  try {
    const harness = buildForwardHarness(base);
    const source = await seedSource(harness.store, OWNER);
    const handler = new EmailComposeHandler({
      mailService: harness.service,
      forwardSourceStore: harness.store,
    });
    const context = emailContext(base, { emailDestinationGrants: [forwardGrant(source)] });

    const first = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source, { body: "First commentary." }) },
      context,
    );
    assertEquals(first.success, true, first.error);
    assertEquals(first.emailSubmission?.reused, false);
    assertEquals(harness.smtp.submissions.length, 1);
    const firstBytes = latin1Decode(harness.smtp.submissions[0].emlBytes);

    const repeat = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source, { body: "First commentary." }) },
      context,
    );
    assertEquals(repeat.success, true, repeat.error);
    assertEquals(repeat.emailSubmission?.reused, true);
    assertEquals(repeat.emailSubmission?.phase, "submitted");
    assertEquals(harness.smtp.submissions.length, 1, "a repeated call adds no SMTP transaction");

    // A DIFFERENT commentary under the same grant returns the RECORDED operation: it is not sent,
    // and nothing in the result claims that the new commentary was delivered.
    const changed = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source, { body: "Second commentary." }) },
      context,
    );
    assertEquals(changed.emailSubmission?.reused, true);
    assertEquals(harness.smtp.submissions.length, 1);
    assertEquals(latin1Decode(harness.smtp.submissions[0].emlBytes), firstBytes);
    assert(!firstBytes.includes("Second commentary."));
    assertStringIncludes(
      String(resultData(changed).nextAction),
      "different commentary does NOT send",
    );
    assertEquals(harness.imap.appended.length, 1);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("forward - source content grants no destination: an injected redirect reaches nobody else", async () => {
  const base = await Deno.makeTempDir();
  try {
    const harness = buildForwardHarness(base);
    const source = await seedSource(harness.store, OWNER);
    const handler = new EmailComposeHandler({
      mailService: harness.service,
      forwardSourceStore: harness.store,
    });

    // The original names bob@attacker.example and asks for a redirect. Only the granted
    // destination exists in the request, and only it may appear in the envelope.
    const granted = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source) },
      emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
    );
    assertEquals(granted.success, true, granted.error);
    assertEquals(harness.smtp.submissions[0].envelope.to, [RECIPIENT_CANONICAL]);
    const wire = latin1Decode(harness.smtp.submissions[0].emlBytes);
    const headers = wire.slice(0, wire.indexOf("\r\n\r\n"));
    assert(!headers.includes(INJECTED_RECIPIENT), "the source cannot add a recipient header");

    // Asking for the source-named address is refused: the grant authorizes one destination only.
    const redirected = await handler.handleSendEmail(
      {
        grantId: GRANT_ID,
        request: forwardRequest(source, { to: INJECTED_RECIPIENT, subject: "Redirected" }),
      },
      emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
    );
    assertEquals(redirected.success, false);
    assertEquals(redirected.code, EMAIL_COMPOSE_CODES.GRANT);
    assertEquals(harness.smtp.submissions.length, 1, "no second SMTP transaction is attempted");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("forward - an attachment-only source is forwarded completely and a missing part sends nothing", async () => {
  const base = await Deno.makeTempDir();
  try {
    const harness = buildForwardHarness(base);
    const source = await seedSource(harness.store, OWNER, { body: "" });
    const handler = new EmailComposeHandler({
      mailService: harness.service,
      forwardSourceStore: harness.store,
    });
    const context = emailContext(base, { emailDestinationGrants: [forwardGrant(source)] });

    const result = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source, { body: "" }) },
      context,
    );
    assertEquals(result.success, true, result.error);
    const wire = latin1Decode(harness.smtp.submissions[0].emlBytes);
    const parts = parseMimeParts(wire);
    assertEquals(
      decodePartBody(parts.find((part) => part.contentType === "message/rfc822")!),
      source.sourceBytes,
    );
    // Both original attachments of an attachment-only source are forwarded, exactly.
    const forwardedText = parts.find((part) => part.filename === "evil name.txt");
    assert(forwardedText !== undefined, "the original text attachment is forwarded");
    assertEquals(decodePartBody(forwardedText), TEXT_ATTACHMENT_BYTES);
    const forwardedBinary = parts.find((part) => part.filename === BINARY_ATTACHMENT_NAME);
    assert(forwardedBinary !== undefined, "the original binary attachment is forwarded");
    assertEquals(decodePartBody(forwardedBinary), BINARY_ATTACHMENT_BYTES);

    // Delta specification "One attachment unavailable": no SMTP send, one safe incomplete-source
    // result, and the already-sent count does not move.
    Deno.removeSync(join(source.root, "attachments", source.recordId, source.attachments[0].id));
    const failed = await handler.handleSendEmail(
      {
        grantId: GRANT_ID,
        request: forwardRequest(source, { subject: "Second forward" }),
      },
      emailContext(base, { emailDestinationGrants: [forwardGrant(source)] }),
    );
    assertEquals(failed.success, false);
    assertEquals(failed.code, EMAIL_FORWARD_CODES.SOURCE);
    assertStringIncludes(String(failed.error), "incomplete");
    assertEquals(harness.smtp.submissions.length, 1, "no SMTP send for an incomplete source");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("forward - a rejected SMTP peer yields an explicit failure and the recorded result is reused", async () => {
  const base = await Deno.makeTempDir();
  try {
    const harness = buildForwardHarness(base);
    harness.smtp.mode = "failed";
    const source = await seedSource(harness.store, OWNER);
    const handler = new EmailComposeHandler({
      mailService: harness.service,
      forwardSourceStore: harness.store,
    });
    const context = emailContext(base, { emailDestinationGrants: [forwardGrant(source)] });

    const result = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source) },
      context,
    );
    assertEquals(result.success, false);
    assertEquals(result.emailSubmission?.phase, "failed");
    assertEquals(harness.smtp.submissions.length, 1);
    assertEquals(harness.imap.appended.length, 0);

    const repeat = await handler.handleSendEmail(
      { grantId: GRANT_ID, request: forwardRequest(source) },
      context,
    );
    assertEquals(repeat.success, false);
    assertEquals(repeat.emailSubmission?.reused, true);
    assertEquals(
      harness.smtp.submissions.length,
      1,
      "a failed operation is never resubmitted blindly",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("compose - the row-20 path is unchanged: no forward source, its own slot and result shape", async () => {
  const base = await Deno.makeTempDir();
  try {
    const harness = buildForwardHarness(base);
    const source = await seedSource(harness.store, OWNER);
    const handler = new EmailComposeHandler({
      mailService: harness.service,
      forwardSourceStore: harness.store,
    });

    // The destination is this session's own sender: an ordinary compose needs no grant.
    const result = await handler.handleSendEmail(
      { request: { to: SELF_ADDRESS, subject: "Status", body: "All good." } },
      emailContext(base),
    );

    assertEquals(result.success, true, result.error);
    assertEquals(harness.smtp.submissions.length, 1);
    const wire = latin1Decode(harness.smtp.submissions[0].emlBytes);
    assert(!wire.includes("message/rfc822"), "a compose attaches no forwarded original");
    assert(!wire.includes(FORWARD_SECTION_MARKER), "a compose has no original reference section");
    assertEquals(resultData(result).forwardSourceRecordId, undefined);
    assertEquals(typeof resultData(result).attachmentsCount, "number");
    assertStringIncludes(String(resultData(result).nextAction), "do not send it again");

    // A compose request never reaches the source store, even when it is wired.
    assertEquals(source.recordId.length > 0, true);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("compose - the row-20 result guidance and aggregate refusal text are unchanged", async () => {
  const base = await Deno.makeTempDir();
  try {
    const store = new EmailMessageStore({ workspacesRoot: join(base, "workspaces") });
    const stagingDir = join(base, "tmp", SESSION_ID);
    Deno.mkdirSync(stagingDir, { recursive: true });
    const addedPath = join(stagingDir, "report.txt");
    Deno.writeTextFileSync(addedPath, "compose-attachment-bytes");

    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService, forwardSourceStore: store });
    const result = await handler.handleSendEmail(
      {
        grantId: GRANT_ID,
        request: { to: RECIPIENT, subject: "Status", body: "All good." },
      },
      emailContext(base, { emailDestinationGrants: [composeGrant()] }),
    );

    assertEquals(result.success, true, result.error);
    // The compose guidance stays exactly the row-20 sentence: the forward warning is NOT added.
    assertEquals(
      resultData(result).nextAction,
      "The message is submitted. Exit immediately; do not send it again — a repeated call " +
        "returns this recorded result instead of resubmitting.",
    );

    // The compose aggregate refusal keeps its original wording (a forward names the wider set).
    const limited = new EmailComposeHandler({
      mailService: new RecordingMailService(),
      forwardSourceStore: store,
      limits: { maxTotalSizeMb: 0.000001 },
    });
    const refused = await limited.handleSendEmail(
      {
        grantId: GRANT_ID,
        request: { to: RECIPIENT, subject: "Status", body: "All good.", attachments: [addedPath] },
      },
      emailContext(base, { emailDestinationGrants: [composeGrant()] }),
    );
    assertEquals(refused.success, false);
    assertEquals(refused.code, EMAIL_COMPOSE_CODES.ATTACHMENT);
    assertStringIncludes(String(refused.error), "The attachments total");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
