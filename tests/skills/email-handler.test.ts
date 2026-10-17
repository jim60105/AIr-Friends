// tests/skills/email-handler.test.ts
//
// Deterministic regression coverage for `email-compose-skill` (row 20).
//
// Exercised layers:
// - Group A drives the REAL `EmailComposeHandler` through its single service seam (a recording
//   mail-service double) to prove every identity, grant, request and attachment refusal happens
//   before anything reaches submission.
// - Group B composes through the REAL `EmailMailService`, `SubmissionStore`, `EmailMessageStore`
//   and `OutgoingMimeBuilder` with file-backed temp roots; SMTP and IMAP are scripted doubles at
//   the transport boundary, so each scenario asserts an exact external side-effect count.
// - Group C drives the REAL `SkillAPIServer` over HTTP with the real `SessionRegistry`, JWT
//   issuance/verification, recovery fence, audit writer and metrics registry.
// Honesty boundary: no provider, credential, mailbox or model judgment is involved, and the
// script-level payload contract is covered separately (tests/skills/scripts.test.ts). The one
// real-socket SMTP exchange lives in tests/skills/email-compose-smoke.test.ts.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { EMAIL_COMPOSE_ACTION_SLOT, EmailComposeHandler } from "../../src/skills/email-handler.ts";
import { emailComposeAuditParams } from "../../src/skills/email-handler.ts";
import type { EmailComposeMailService } from "../../src/skills/email-handler.ts";
import type { SkillContext } from "../../src/skills/types.ts";
import type { DestinationGrant } from "../../src/core/email-intent-preflight.ts";
import type { PlatformAdapter } from "../../src/platforms/platform-adapter.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { EmailConfig } from "../../src/types/config.ts";
import type { EmailDraft } from "../../src/platforms/email/outgoing-mime.ts";
import { OutgoingMimeBuilder } from "../../src/platforms/email/outgoing-mime.ts";
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
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { SkillAPIServer } from "../../src/skill-api/server.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { SessionAuditWriter } from "../../src/core/audit-logger.ts";
import { createSkillJwt } from "../../src/utils/skill-jwt.ts";
import { metricsRegistry } from "../../src/utils/metrics.ts";

const SELF_ADDRESS = "user@example.org";
const OWNER = normalizeEmailMailbox(SELF_ADDRESS).userId;
const OTHER_ADDRESS = "other@example.org";
const OTHER_OWNER = normalizeEmailMailbox(OTHER_ADDRESS).userId;
const RECIPIENT = "alice@allowed-domain.org";
const RECIPIENT_CANONICAL = normalizeEmailMailbox(RECIPIENT).canonicalAddress;
const RECIPIENT_ID = normalizeEmailMailbox(RECIPIENT).userId;
const BOT = "bot@example.com";
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const WORK_ID = "work-compose-1";
const SESSION_ID = "sess_compose_1";
const THREAD_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TEST_SKILL_SECRET = "0123456789abcdef0123456789abcdef01";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One immutable compose grant of this session, as the host records it before the agent runs. */
function composeGrant(overrides: Partial<DestinationGrant> = {}): DestinationGrant {
  return {
    grantId: "grant-1",
    sessionId: SESSION_ID,
    workId: WORK_ID,
    owner: OWNER,
    action: "compose",
    canonicalRecipient: RECIPIENT_CANONICAL,
    requestDigest: "a".repeat(64),
    ...overrides,
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
    // The compose handler never touches the platform adapter; email dispatch goes through the
    // mail service seam only.
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

/** Create the session staging directory and (optionally) staged attachment files. */
function stage(
  workspacePath: string,
  files: Record<string, string> = {},
): string {
  const stagingDir = join(workspacePath, "tmp", SESSION_ID);
  Deno.mkdirSync(stagingDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    Deno.writeTextFileSync(join(stagingDir, name), content);
  }
  return stagingDir;
}

async function withWorkspace(
  body: (workspacePath: string, stagingDir: string) => Promise<void> | void,
): Promise<void> {
  const workspacePath = await Deno.makeTempDir();
  try {
    await body(workspacePath, stage(workspacePath));
  } finally {
    await Deno.remove(workspacePath, { recursive: true });
  }
}

/** A well-formed compose request for the granted destination. */
function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    to: RECIPIENT,
    subject: "Project update",
    body: "Here is the update.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Group A: handler authorization, request shape and attachment containment
// ---------------------------------------------------------------------------

Deno.test("compose - a granted third-party destination is sent once through the service", async () => {
  await withWorkspace(async (workspacePath) => {
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService });
    const context = emailContext(workspacePath, {
      emailDestinationGrants: [composeGrant()],
    });

    const result = await handler.handleSendEmail(
      {
        grantId: "grant-1",
        request: request({ subject: "Pricing $0.435", body: "Line A\nLine B" }),
      },
      context,
    );

    assertEquals(result.success, true);
    assertEquals(result.emailSubmission?.phase, "submitted");
    assertEquals(result.emailSubmission?.reused, false);
    assertEquals(mailService.drafts.length, 1);
    const draft = mailService.drafts[0];
    assertEquals(draft.owner, OWNER);
    assertEquals(draft.operationKey, { workId: WORK_ID, actionSlot: "third-party:grant-1" });
    assertEquals(draft.targetKind, "third-party");
    assertEquals(draft.to, RECIPIENT_CANONICAL);
    assertEquals(draft.subject, "Pricing $0.435");
    assertEquals(draft.authoredBody, "Line A\nLine B");
    assertEquals(draft.thread, undefined);
    assertEquals(draft.forwardSource, undefined);
    assertEquals(draft.attachments, undefined);
  });
});

Deno.test("compose - the session's own sender is the reply target and needs no grant", async () => {
  await withWorkspace(async (workspacePath) => {
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService });
    // No grants at all: the session may still compose to its own verified sender.
    const context = emailContext(workspacePath);

    const result = await handler.handleSendEmail(
      { request: request({ to: SELF_ADDRESS, subject: "Anything" }) },
      context,
    );

    assertEquals(result.success, true);
    assertEquals(mailService.drafts.length, 1);
    assertEquals(mailService.drafts[0].targetKind, "user");
    assertEquals(mailService.drafts[0].operationKey.actionSlot, EMAIL_COMPOSE_ACTION_SLOT);
    assertEquals(mailService.drafts[0].to, SELF_ADDRESS);
  });
});

Deno.test("compose - a third-party destination without a grant is refused before any file read", async () => {
  await withWorkspace(async (workspacePath) => {
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService });
    const context = emailContext(workspacePath);

    const result = await handler.handleSendEmail(
      {
        request: request({
          to: RECIPIENT,
          // A path that does not exist: the refusal must be about authorization, not the file,
          // which proves no attachment was even stat'ed.
          attachments: [join(workspacePath, "tmp", SESSION_ID, "missing.pdf")],
        }),
      },
      context,
    );

    assertEquals(result.success, false);
    assertEquals(result.code, "SKILL_EMAIL_COMPOSE_GRANT");
    assertEquals(mailService.drafts.length, 0);
  });
});

Deno.test("compose - grant binding is enforced for action, session, owner, work item and destination", async () => {
  await withWorkspace(async (workspacePath) => {
    const cases: Array<
      { label: string; grant: DestinationGrant; request?: Record<string, unknown> }
    > = [
      { label: "forward action", grant: composeGrant({ action: "forward" }) },
      { label: "another session", grant: composeGrant({ sessionId: "sess_other" }) },
      { label: "another owner", grant: composeGrant({ owner: OTHER_OWNER }) },
      { label: "another work item", grant: composeGrant({ workId: "work-other" }) },
      { label: "another destination", grant: composeGrant({ canonicalRecipient: OTHER_ADDRESS }) },
      {
        label: "mutated request destination",
        grant: composeGrant(),
        request: request({ to: "someone-else@allowed-domain.org" }),
      },
    ];

    for (const testCase of cases) {
      const mailService = new RecordingMailService();
      const handler = new EmailComposeHandler({ mailService });
      const context = emailContext(workspacePath, {
        emailDestinationGrants: [testCase.grant],
      });

      const result = await handler.handleSendEmail(
        { grantId: "grant-1", request: testCase.request ?? request() },
        context,
      );

      assertEquals(result.success, false, testCase.label);
      assertEquals(result.code, "SKILL_EMAIL_COMPOSE_GRANT", testCase.label);
      assertEquals(mailService.drafts.length, 0, testCase.label);
    }
  });
});

Deno.test("compose - an unknown grant id never falls back to the reply-target path", async () => {
  await withWorkspace(async (workspacePath) => {
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService });
    const context = emailContext(workspacePath, {
      emailDestinationGrants: [composeGrant()],
    });

    // The destination IS this session's own sender, but the caller named a grant that does not
    // exist: the mismatch is refused rather than silently authorized by the self-address rule.
    const result = await handler.handleSendEmail(
      { grantId: "grant-does-not-exist", request: request({ to: SELF_ADDRESS }) },
      context,
    );

    assertEquals(result.success, false);
    assertEquals(result.code, "SKILL_EMAIL_COMPOSE_GRANT");
    assertEquals(mailService.drafts.length, 0);
  });
});

Deno.test("compose - unsupported request keys (Cc/Bcc/headers) and malformed fields are refused", async () => {
  await withWorkspace(async (workspacePath) => {
    const rejected: Array<{ label: string; request: unknown }> = [
      { label: "Cc", request: request({ cc: "cc@example.org" }) },
      { label: "Bcc", request: request({ bcc: "bcc@example.org" }) },
      { label: "arbitrary headers", request: request({ headers: { "X-Whatever": "1" } }) },
      { label: "multiline subject", request: request({ subject: "Injected\nBcc: evil@x.test" }) },
      { label: "blank subject", request: request({ subject: "   " }) },
      { label: "non-string body", request: request({ body: 42 }) },
      { label: "empty message", request: { to: RECIPIENT, subject: "S", body: "" } },
      {
        label: "multiple destinations",
        request: request({ to: `${RECIPIENT}, ${OTHER_ADDRESS}` }),
      },
      { label: "invalid destination", request: request({ to: "not-an-address" }) },
      { label: "attachment list of non-strings", request: request({ attachments: [7] }) },
      { label: "missing request", request: undefined },
    ];

    for (const testCase of rejected) {
      const mailService = new RecordingMailService();
      const handler = new EmailComposeHandler({ mailService });
      const context = emailContext(workspacePath, {
        emailDestinationGrants: [composeGrant()],
      });

      const result = await handler.handleSendEmail(
        testCase.request === undefined
          ? { grantId: "grant-1" }
          : { grantId: "grant-1", request: testCase.request },
        context,
      );

      assertEquals(result.success, false, testCase.label);
      assertEquals(result.code, "SKILL_EMAIL_COMPOSE_REQUEST", testCase.label);
      assertEquals(mailService.drafts.length, 0, testCase.label);
    }
  });
});

Deno.test("compose - a multiline body with $ and Unicode reaches the draft verbatim", async () => {
  await withWorkspace(async (workspacePath) => {
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService });
    const context = emailContext(workspacePath, {
      emailDestinationGrants: [composeGrant()],
    });
    const body = "Dear team,\n\nThe price is $0.435 and $HOME is not expanded here. 你好\n";

    const result = await handler.handleSendEmail(
      { grantId: "grant-1", request: request({ body }) },
      context,
    );

    assertEquals(result.success, true);
    assertEquals(mailService.drafts[0].authoredBody, body);
  });
});

Deno.test("compose - attachments must stay inside the session staging directory", async () => {
  const workspacePath = await Deno.makeTempDir();
  try {
    const stagingDir = stage(workspacePath, { "report.txt": "attachment-bytes" });
    // A workspace file OUTSIDE the staging directory (e.g. a memory file) plus a symlink that
    // escapes the staging directory.
    Deno.writeTextFileSync(join(workspacePath, "memory.private.jsonl"), "private memory");
    Deno.symlinkSync("/etc/hostname", join(stagingDir, "escape.txt"));

    const cases: Array<{ label: string; path: string }> = [
      { label: "workspace memory file", path: join(workspacePath, "memory.private.jsonl") },
      { label: "symlink escape", path: join(stagingDir, "escape.txt") },
      {
        label: "sibling staging dir",
        path: join(workspacePath, "tmp", `${SESSION_ID}-2`, "x.txt"),
      },
      { label: "missing file", path: join(stagingDir, "absent.txt") },
    ];

    const configured = [
      { label: "count limit", limits: { maxFilesPerInvocation: 0 } },
      { label: "extension whitelist", limits: { allowedExtensions: [".pdf"] } },
      { label: "per-file size limit", limits: { maxFileSizeMb: 0.000001 } },
      { label: "aggregate size limit", limits: { maxTotalSizeMb: 0.000001 } },
    ];

    for (const testCase of cases) {
      const mailService = new RecordingMailService();
      const handler = new EmailComposeHandler({ mailService });
      const result = await handler.handleSendEmail(
        { grantId: "grant-1", request: request({ attachments: [testCase.path] }) },
        emailContext(workspacePath, { emailDestinationGrants: [composeGrant()] }),
      );
      assertEquals(result.success, false, testCase.label);
      assertEquals(result.code, "SKILL_EMAIL_COMPOSE_ATTACHMENT", testCase.label);
      assertEquals(mailService.drafts.length, 0, testCase.label);
    }

    for (const testCase of configured) {
      const mailService = new RecordingMailService();
      const handler = new EmailComposeHandler({ mailService, limits: testCase.limits });
      const result = await handler.handleSendEmail(
        {
          grantId: "grant-1",
          request: request({ attachments: [join(stagingDir, "report.txt")] }),
        },
        emailContext(workspacePath, { emailDestinationGrants: [composeGrant()] }),
      );
      assertEquals(result.success, false, testCase.label);
      assertEquals(result.code, "SKILL_EMAIL_COMPOSE_ATTACHMENT", testCase.label);
      assertEquals(mailService.drafts.length, 0, testCase.label);
    }

    // The staged file itself is accepted and its bytes are handed to the service unchanged.
    const mailService = new RecordingMailService();
    const handler = new EmailComposeHandler({ mailService });
    const ok = await handler.handleSendEmail(
      { grantId: "grant-1", request: request({ attachments: [join(stagingDir, "report.txt")] }) },
      emailContext(workspacePath, { emailDestinationGrants: [composeGrant()] }),
    );
    assertEquals(ok.success, true);
    const attachment = mailService.drafts[0].attachments?.[0];
    assertEquals(attachment?.filename, "report.txt");
    assertEquals(attachment?.contentType, "text/plain");
    assertEquals(new TextDecoder().decode(attachment?.content), "attachment-bytes");
  } finally {
    await Deno.remove(workspacePath, { recursive: true });
  }
});

Deno.test("compose - only an authenticated user-triggered email session may compose", async () => {
  await withWorkspace(async (workspacePath) => {
    const cases: Array<{ label: string; context: Partial<SkillContext> }> = [
      {
        label: "non-email session",
        context: {
          workspace: {
            ...workspaceFor(workspacePath),
            components: { platform: "discord", userId: OWNER },
          },
        },
      },
      { label: "no session id", context: { sessionId: undefined } },
      { label: "no verified sender", context: { userId: "" } },
      { label: "no durable work id", context: { emailWorkId: undefined } },
      {
        label: "conflicting host operation context",
        context: { emailSend: { workId: WORK_ID, owner: OTHER_OWNER } },
      },
      {
        label: "conflicting host work id",
        context: { emailSend: { workId: "work-other", owner: OWNER } },
      },
    ];

    for (const testCase of cases) {
      const mailService = new RecordingMailService();
      const handler = new EmailComposeHandler({ mailService });
      const result = await handler.handleSendEmail(
        { request: request({ to: SELF_ADDRESS }) },
        emailContext(workspacePath, testCase.context),
      );
      assertEquals(result.success, false, testCase.label);
      assertEquals(result.code, "SKILL_EMAIL_COMPOSE_SESSION", testCase.label);
      assertEquals(mailService.drafts.length, 0, testCase.label);
    }
  });
});

Deno.test("compose - an unwired service and a non-submitted outcome fail closed", async () => {
  await withWorkspace(async (workspacePath) => {
    const context = emailContext(workspacePath, { emailDestinationGrants: [composeGrant()] });

    const unavailable = await new EmailComposeHandler({}).handleSendEmail(
      { grantId: "grant-1", request: request() },
      context,
    );
    assertEquals(unavailable.success, false);
    assertEquals(unavailable.code, "SKILL_EMAIL_COMPOSE_UNAVAILABLE");

    for (
      const phase of ["failed", "unknown", "prepared", "submitting"] as const
    ) {
      const mailService = new RecordingMailService();
      mailService.outcome = {
        operationId: `op_${"b".repeat(24)}`,
        phase,
        reused: false,
        safeCode: "TEST_SAFE_CODE",
      };
      const result = await new EmailComposeHandler({ mailService }).handleSendEmail(
        { grantId: "grant-1", request: request() },
        context,
      );
      assertEquals(result.success, false, phase);
      assertEquals(result.emailSubmission?.phase, phase);
      assertStringIncludes(result.error ?? "", "TEST_SAFE_CODE");
      if (phase === "unknown") {
        assertStringIncludes(result.error ?? "", "NOT confirmed delivered");
      }
    }
  });
});

Deno.test("compose - the audit projection never records recipient, subject or body", async () => {
  const subjectSentinel = "SENTINEL-SUBJECT-3f9a";
  const bodySentinel = "SENTINEL-BODY-3f9a";
  const projected = await emailComposeAuditParams({
    grantId: "grant-1",
    request: {
      to: "sentinel-recipient@example.org",
      subject: subjectSentinel,
      body: bodySentinel,
      attachments: ["/staging/secret-name.pdf"],
    },
  });

  const serialized = JSON.stringify(projected);
  assert(!serialized.includes(subjectSentinel));
  assert(!serialized.includes(bodySentinel));
  assert(!serialized.includes("sentinel-recipient@example.org"));
  assert(!serialized.includes("secret-name.pdf"));
  assertEquals(projected.grantId, "grant-1");
  assertEquals(projected.attachmentsCount, 1);
  assertStringIncludes(String(projected.destinationHash), "sha256:");
  assertStringIncludes(String(projected.subjectHash), "sha256:");
  assertEquals(projected.bodyLength, bodySentinel.length);
});

// ---------------------------------------------------------------------------
// Group B: real durable mail service with scripted transport doubles
// ---------------------------------------------------------------------------

/** Scripted SMTP double: records the exact envelope and bytes handed to the wire. */
class RecordingSmtp implements SmtpTransport {
  submissions: SmtpSubmission[] = [];
  mode: "submitted" | "failed" | "unknown" = "submitted";

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
        : this.mode === "failed"
        ? SmtpDiagnosticCode.REJECTED
        : SmtpDiagnosticCode.CONNECTION_LOST,
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
    throw new Error("fetchSource is not used by the compose path");
  }
  appendSent(rawMime: Uint8Array | string, _options?: ImapAppendOptions): Promise<void> {
    this.appended.push(typeof rawMime === "string" ? new TextEncoder().encode(rawMime) : rawMime);
    return Promise.resolve();
  }
}

interface MailHarness {
  service: EmailMailService;
  smtp: RecordingSmtp;
  imap: RecordingImap;
}

function buildMailHarness(base: string): MailHarness {
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
  const service = new EmailMailService({
    config,
    emailRoot,
    submissionStore: new SubmissionStore(emailRoot),
    messageStore: new EmailMessageStore({ workspacesRoot: join(base, "workspaces") }),
    smtp,
    imap,
    // Both the session's own sender and the granted third party are enabled accounts.
    channels: [
      { id: `email/account/${OWNER}`, enabled: true },
      { id: `email/account/${RECIPIENT_ID}`, enabled: true },
    ],
    builder: new OutgoingMimeBuilder({
      fromAddress: BOT,
      now: () => new Date("2026-10-17T00:00:00Z"),
    }),
  });
  return { service, smtp, imap };
}

Deno.test("compose - the durable service submits the granted message and reuses its operation", async () => {
  const base = await Deno.makeTempDir();
  try {
    const stagingDir = stage(base, { "report.txt": "attachment-bytes" });
    const { service, smtp, imap } = buildMailHarness(base);
    const handler = new EmailComposeHandler({ mailService: service });
    const context = emailContext(base, { emailDestinationGrants: [composeGrant()] });
    const params = {
      grantId: "grant-1",
      request: request({ attachments: [join(stagingDir, "report.txt")] }),
    };

    const first = await handler.handleSendEmail(params, context);
    assertEquals(first.success, true);
    assertEquals(first.emailSubmission?.reused, false);
    assertEquals(smtp.submissions.length, 1);
    assertEquals(smtp.submissions[0].envelope.to, [RECIPIENT_CANONICAL]);
    // The wire bytes are CRLF-terminated; compare against LF-normalized text.
    const raw = new TextDecoder().decode(smtp.submissions[0].emlBytes).replaceAll("\r\n", "\n");
    assertStringIncludes(raw, `To: ${RECIPIENT_CANONICAL}`);
    assertStringIncludes(raw, "Subject: Project update");
    assertStringIncludes(raw, "Here is the update.");
    assertStringIncludes(raw, SIGNATURE);
    assertEquals(raw.split(SIGNATURE).length - 1, 1, "the signature is applied exactly once");
    assert(!raw.includes("Cc:"), "a composed message never carries Cc");
    assertStringIncludes(raw, "Content-Disposition: attachment; filename=report.txt");
    // Attachment bytes are base64-encoded parts, so assert their encoded form.
    assertStringIncludes(raw, btoa("attachment-bytes"));
    assertEquals(imap.appended.length, 1);

    // The SAME logical operation is answered from the journal: no second SMTP transaction.
    const repeat = await handler.handleSendEmail(params, context);
    assertEquals(repeat.success, true);
    assertEquals(repeat.emailSubmission?.reused, true);
    assertEquals(smtp.submissions.length, 1);
    assertEquals(imap.appended.length, 1);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("compose - distinct grants are distinct operations while one self-compose is one operation", async () => {
  const base = await Deno.makeTempDir();
  try {
    const { service, smtp } = buildMailHarness(base);
    const handler = new EmailComposeHandler({ mailService: service });
    const otherRecipient = "bob@allowed-domain.org";
    const context = emailContext(base, {
      emailDestinationGrants: [
        composeGrant(),
        composeGrant({
          grantId: "grant-2",
          canonicalRecipient: normalizeEmailMailbox(otherRecipient).canonicalAddress,
        }),
      ],
    });

    await handler.handleSendEmail({ grantId: "grant-1", request: request() }, context);
    await handler.handleSendEmail(
      { grantId: "grant-2", request: request({ to: otherRecipient }) },
      context,
    );
    assertEquals(smtp.submissions.length, 2);
    assertEquals(smtp.submissions[1].envelope.to, [otherRecipient]);

    // Two self-composes share the ordinary slot, so the second is answered from the journal.
    const selfParams = { request: request({ to: SELF_ADDRESS, subject: "Second subject" }) };
    const selfFirst = await handler.handleSendEmail(selfParams, context);
    const selfSecond = await handler.handleSendEmail(selfParams, context);
    assertEquals(selfFirst.success, true);
    assertEquals(selfFirst.emailSubmission?.reused, false);
    assertEquals(selfSecond.emailSubmission?.reused, true);
    assertEquals(smtp.submissions.length, 3);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("compose - a rejected SMTP submission surfaces the failure and never claims delivery", async () => {
  const base = await Deno.makeTempDir();
  try {
    const { service, smtp } = buildMailHarness(base);
    smtp.mode = "failed";
    const handler = new EmailComposeHandler({ mailService: service });
    const context = emailContext(base, { emailDestinationGrants: [composeGrant()] });

    const result = await handler.handleSendEmail(
      { grantId: "grant-1", request: request() },
      context,
    );

    assertEquals(result.success, false);
    assertEquals(result.emailSubmission?.phase, "failed");
    assertStringIncludes(result.error ?? "", "nothing was delivered");
    assertEquals(smtp.submissions.length, 1);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Group C: the real Skill API endpoint (JWT, fence, lease, audit, metrics)
// ---------------------------------------------------------------------------

/** Recording service whose first send is deferred, so the endpoint's lease can be observed. */
class DeferredMailService implements EmailComposeMailService {
  readonly entered = Promise.withResolvers<void>();
  private readonly result = Promise.withResolvers<EmailSendOutcome>();
  calls = 0;

  async send(_draft: EmailDraft): Promise<EmailSendOutcome> {
    this.calls++;
    this.entered.resolve();
    return await this.result.promise;
  }

  settle(outcome: EmailSendOutcome): void {
    this.result.resolve(outcome);
  }
}

interface EndpointHarness {
  server: SkillAPIServer;
  registry: SessionRegistry;
  sessionId: string;
  auditPath: string;
}

async function withEndpoint(
  port: number,
  mailService: EmailComposeMailService,
  options: { grants?: readonly DestinationGrant[]; fenced?: boolean; audit?: boolean },
  body: (harness: EndpointHarness) => Promise<void>,
): Promise<void> {
  const base = await Deno.makeTempDir();
  const registry = new SessionRegistry();
  const workspaceManager = new WorkspaceManager({ repoPath: base, workspacesDir: "workspaces" });
  const memoryStore = new MemoryStore(workspaceManager, {});
  const skillRegistry = new SkillRegistry(
    memoryStore,
    undefined,
    undefined,
    undefined,
    undefined,
    { mailService },
  );
  const auditPath = join(base, "audit");
  const sessionId = registry.register({
    platform: "email",
    channelId: formatEmailChannelId(OWNER, THREAD_ID),
    userId: OWNER,
    isDm: true,
    workspace: workspaceFor(base),
    emailWorkId: WORK_ID,
    recoveryFenced: options.fenced === true,
    auditWriter: options.audit === false ? undefined : new SessionAuditWriter(
      auditPath,
      "email",
      OWNER,
      SESSION_ID,
      { enabled: true, retentionDays: 1, hashContent: true, includedPhases: [] },
    ),
  });
  // The registry assigns its own session id: rebind the fixture grant to it, exactly as the
  // host records grants for the session it just registered.
  registry.recordEmailDestinationGrants(
    sessionId,
    (options.grants ?? [composeGrant()]).map((grant) => ({ ...grant, sessionId })),
  );

  const server = new SkillAPIServer(
    registry,
    skillRegistry,
    { port, host: "127.0.0.1" },
    TEST_SKILL_SECRET,
  );
  server.start();
  try {
    await body({ server, registry, sessionId, auditPath });
  } finally {
    await server.stop();
    registry.stop();
    await Deno.remove(base, { recursive: true });
  }
}

async function postCompose(
  port: number,
  sessionRegistry: SessionRegistry,
  sessionId: string,
  parameters: Record<string, unknown>,
  nowSec?: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const session = sessionRegistry.get(sessionId)!;
  const jwt = await createSkillJwt(TEST_SKILL_SECRET, {
    sub: sessionId,
    channel: session.channelId,
    jti: sessionRegistry.getCallerToken(sessionId) ?? "",
  }, nowSec);
  const response = await fetch(`http://127.0.0.1:${port}/api/skill/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ sessionId, parameters }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** Current value of the `airfriends_skill_api_calls_total` child for one skill/status pair. */
async function skillApiMetricValue(skill: string, status: string): Promise<number> {
  const metric = metricsRegistry.getSingleMetric("airfriends_skill_api_calls_total") as
    | { get(): Promise<{ values: Array<{ labels: Record<string, string>; value: number }> }> }
    | undefined;
  const snapshot = await metric?.get();
  const match = snapshot?.values.find(
    (entry) => entry.labels.skill === skill && entry.labels.status === status,
  );
  return match?.value ?? 0;
}

Deno.test("endpoint - send-email requires the session JWT, honors the fence and reports the submission", async () => {
  const port = 34901;
  const mailService = new RecordingMailService();
  await withEndpoint(port, mailService, {}, async ({ registry, sessionId, auditPath }) => {
    const ok = await postCompose(port, registry, sessionId, {
      grantId: "grant-1",
      request: request(),
    });
    assertEquals(ok.status, 200);
    assertEquals(ok.body.success, true);
    assert(ok.body.emailSubmission, "the endpoint returns the submission metadata");
    assertEquals(mailService.drafts.length, 1);
    assertEquals(mailService.drafts[0].operationKey.actionSlot, "third-party:grant-1");

    // The recipient, subject and body must never reach the audit log.
    // The writer was constructed with the fixture's own session id (the registry assigns its own
    // id at registration, and the host names the audit file).
    const auditFile = join(auditPath, "email", OWNER, `${SESSION_ID}.jsonl`);
    const audit = Deno.readTextFileSync(auditFile);
    assertStringIncludes(audit, "send-email");
    assert(!audit.includes(RECIPIENT), "the audit log must not record the destination address");
    assert(!audit.includes("Project update"), "the audit log must not record the subject");
    assert(!audit.includes("Here is the update."), "the audit log must not record the body");
    assertStringIncludes(audit, "destinationHash");

    // An expired JWT is rejected before execution.
    const expired = await postCompose(
      port,
      registry,
      sessionId,
      { grantId: "grant-1", request: request() },
      1,
    );
    assertEquals(expired.status, 401);
    assertEquals(mailService.drafts.length, 1);

    // The generic Skill API metric carries this skill's outcome.
    assert(
      (await skillApiMetricValue("send-email", "success")) >= 1,
      "the send-email success is counted in the skill API metric",
    );
  });
});

Deno.test("endpoint - a recovery-fenced session cannot compose", async () => {
  const port = 34902;
  const mailService = new RecordingMailService();
  await withEndpoint(
    port,
    mailService,
    { fenced: true },
    async ({ registry, sessionId }) => {
      const response = await postCompose(port, registry, sessionId, {
        grantId: "grant-1",
        request: request(),
      });
      assertEquals(response.status, 409);
      assertEquals(mailService.drafts.length, 0);
    },
  );
});

Deno.test("endpoint - the in-flight lease is held for the whole durable submission", async () => {
  const port = 34903;
  const mailService = new DeferredMailService();
  await withEndpoint(port, mailService, {}, async ({ registry, sessionId }) => {
    const pending = postCompose(port, registry, sessionId, {
      grantId: "grant-1",
      request: request(),
    });
    await mailService.entered.promise;
    assertEquals(registry.get(sessionId)?.inflightSideEffects, 1);

    // Session expiry/removal after admission must not cancel the durable result.
    registry.remove(sessionId);
    mailService.settle(submittedOutcome());

    const response = await pending;
    assertEquals(response.status, 200);
    assertEquals(response.body.success, true);
    assertEquals(mailService.calls, 1);
  });
});

Deno.test("endpoint - an unknown outcome is reported once and is not cached for a blind retry", async () => {
  const port = 34904;
  const mailService = new RecordingMailService();
  mailService.outcome = {
    operationId: `op_${"c".repeat(24)}`,
    phase: "unknown",
    reused: false,
    safeCode: "CONNECTION_LOST",
  };
  await withEndpoint(port, mailService, {}, async ({ registry, sessionId }) => {
    const first = await postCompose(port, registry, sessionId, {
      grantId: "grant-1",
      request: request(),
    });
    assertEquals(first.status, 400);
    assertEquals(first.body.success, false);
    assertStringIncludes(String(first.body.error), "NOT confirmed delivered");

    // The second call is answered by the handler (not a cached success) and still reaches the
    // service layer, which is what makes the durable journal the single authority on replay.
    const second = await postCompose(port, registry, sessionId, {
      grantId: "grant-1",
      request: request(),
    });
    assertEquals(second.body.success, false);
    assertEquals(mailService.drafts.length, 2);
  });
});
