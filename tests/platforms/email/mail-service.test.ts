// tests/platforms/email/mail-service.test.ts
//
// Deterministic regression coverage for `email-submission-service`.
//
// Exercised layers: the real `EmailMailService`, the real `SubmissionStore` and
// `EmailMessageStore` (file-backed, in isolated temp roots), the real `durable-files`
// primitives, and the real `OutgoingMimeBuilder`. SMTP and IMAP are scripted doubles at the
// transport boundary, so every scenario asserts the exact external side-effect count instead
// of a live protocol exchange.
//
// Scenarios mirror `openspec/changes/email-submission-service/specs/email-submission/spec.md`:
// repeated accepted request, APPEND failure, and accept-then-persist-failure.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { EmailConfig } from "../../../src/types/config.ts";
import { normalizeEmailMailbox } from "../../../src/platforms/email/email-identity.ts";
import {
  _resetSharedRegistryForTesting,
  computeOperationId,
  computeSha256Hex,
  EmailOperationKey,
  SubmissionDiagnosticCode,
  SubmissionEntryRecord,
  SUBMISSIONS_JOURNAL_FILENAME,
  SubmissionStore,
  SubmissionStoreError,
} from "../../../src/platforms/email/submission-store.ts";
import { readJournal } from "../../../src/platforms/email/durable-files.ts";
import {
  EmailMessageStore,
  MessageStoreDiagnosticCode,
  MessageStoreError,
} from "../../../src/platforms/email/message-store.ts";
import {
  applyOutgoingSignature,
  EmailDraft,
  OutgoingMimeBuilder,
} from "../../../src/platforms/email/outgoing-mime.ts";
import type {
  ImapAppendOptions,
  ImapFetchHeadersOptions,
  ImapFetchSourceOptions,
  ImapListOptions,
  ImapMailboxPosition,
  ImapMessage,
  ImapTransport,
} from "../../../src/platforms/email/imap-client.ts";
import {
  SmtpDiagnosticCode,
  type SmtpSubmission,
  type SmtpSubmitResult,
  type SmtpTransport,
} from "../../../src/platforms/email/smtp-client.ts";
import {
  EmailMailService,
  EmailMailServiceError,
  EmailSubmissionDiagnosticCode,
  OutboundEvidenceMeta,
  outboundEvidenceMetaRef,
  outboundEvidenceRef,
} from "../../../src/platforms/email/mail-service.ts";

const OWNER = "e_" + "ab".repeat(32);
const OTHER_OWNER = "e_" + "cd".repeat(32);
const BOT = "bot@example.com";
const RECIPIENT = "alice@allowed-domain.org";
const RECIPIENT_ID = normalizeEmailMailbox(RECIPIENT).userId;
const SIGNATURE = "AIr-Friends Bot\nSecond line";
const CLOCK_A = "2026-10-17T00:00:00Z";
const CLOCK_B = "2026-10-18T09:30:00Z";

/** The persisted history body is the authored body with the signature applied once. */
function signedBody(authored: string): string {
  return applyOutgoingSignature(authored, SIGNATURE);
}

/** Scripted SMTP double: records the exact bytes and envelope it was handed. */
class RecordingSmtp implements SmtpTransport {
  submissions: SmtpSubmission[] = [];
  mode: "submitted" | "failed" | "unknown" | "throw" | "hang" = "submitted";
  /** Resolves once `submit` has been entered, i.e. after the durable `submitting` write. */
  readonly entered = Promise.withResolvers<void>();
  /** Gate held open by `mode: "hang"`, so a caller can model an in-flight submission. */
  private readonly hangGate = Promise.withResolvers<SmtpSubmitResult>();

  async submit(input: SmtpSubmission): Promise<SmtpSubmitResult> {
    this.submissions.push({
      emlBytes: input.emlBytes,
      envelope: { from: input.envelope.from, to: [...input.envelope.to] },
      sizeBytes: input.sizeBytes,
    });
    this.entered.resolve();
    switch (this.mode) {
      case "throw":
        throw new Error("simulated transport failure");
      case "hang":
        return await this.hangGate.promise;
      default:
        return {
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
        };
    }
  }

  /** Release a `hang` submission with an unresolved transport outcome. */
  releaseHang(): void {
    this.hangGate.resolve({
      phase: "unknown",
      safeCode: SmtpDiagnosticCode.CONNECTION_LOST,
      accepted: [],
      rejected: [],
      sizeBytes: 0,
      durationMs: 1,
    });
  }
}

/** Scripted IMAP double: only `connect`/`disconnect`/`appendSent` are meaningful here. */
class RecordingImap implements ImapTransport {
  connected = false;
  connectCalls = 0;
  appended: Uint8Array[] = [];
  appendFolders: string[] = [];
  failAppend = false;
  /** Highest number of APPEND calls observed in flight at once. */
  maxConcurrentAppends = 0;
  private inAppend = 0;

  connect(): Promise<void> {
    this.connectCalls++;
    this.connected = true;
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.connected = false;
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
    throw new Error("fetchSource is not used by the submission service");
  }
  async appendSent(rawMime: Uint8Array | string, options?: ImapAppendOptions): Promise<void> {
    const bytes = typeof rawMime === "string" ? new TextEncoder().encode(rawMime) : rawMime;
    this.inAppend++;
    this.maxConcurrentAppends = Math.max(this.maxConcurrentAppends, this.inAppend);
    try {
      // A microtask yield is enough to expose overlapping callers without real timers.
      await Promise.resolve();
      if (this.failAppend) {
        throw new Error("simulated APPEND refusal");
      }
      this.appended.push(bytes);
      this.appendFolders.push(options?.folder ?? "Sent");
    } finally {
      this.inAppend--;
    }
  }
}

/** Submission store that fails the first terminal outcome write, simulating a crash window. */
class OutcomeFailingStore extends SubmissionStore {
  failNextOutcome = true;

  override async recordOutcome(
    owner: string,
    key: EmailOperationKey,
    outcome: "submitted" | "failed" | "unknown",
    options?: {
      safeCode?: string;
      wireMessageId?: string;
      sentCopy?: "pending" | "appended" | "failed";
    },
  ) {
    if (this.failNextOutcome) {
      this.failNextOutcome = false;
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
        "simulated outcome persistence failure",
      );
    }
    return await super.recordOutcome(owner, key, outcome, options);
  }
}

/** Message store that fails the first outbound history write after acceptance. */
class HistoryFailingStore extends EmailMessageStore {
  failNextPutSent = true;

  override async putSent(
    owner: string,
    message: Parameters<EmailMessageStore["putSent"]>[1],
    operation: EmailOperationKey,
  ) {
    if (this.failNextPutSent) {
      this.failNextPutSent = false;
      throw new MessageStoreError(
        MessageStoreDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
        "simulated history write failure",
      );
    }
    return await super.putSent(owner, message, operation);
  }
}

interface HarnessOptions {
  base: string;
  emailRoot?: string;
  clock?: string;
  builderFrom?: string;
  channels?: Array<{ id: string; enabled: boolean }>;
  maxMessageBytes?: number;
  store?: SubmissionStore;
  messageStore?: EmailMessageStore;
  smtp?: RecordingSmtp;
  imap?: RecordingImap;
}

interface Harness {
  emailRoot: string;
  config: EmailConfig;
  store: SubmissionStore;
  messageStore: EmailMessageStore;
  smtp: RecordingSmtp;
  imap: RecordingImap;
  service: EmailMailService;
}

function buildHarness(options: HarnessOptions): Harness {
  const emailRoot = options.emailRoot ?? join(options.base, "email");
  const workspacesRoot = join(options.base, "workspaces");
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
    maxMessageBytes: options.maxMessageBytes ?? 25 * 1024 * 1024,
    maxIncomingAttachments: 10,
    signature: SIGNATURE,
  };
  const store = options.store ?? new SubmissionStore(emailRoot);
  const messageStore = options.messageStore ?? new EmailMessageStore({ workspacesRoot });
  const smtp = options.smtp ?? new RecordingSmtp();
  const imap = options.imap ?? new RecordingImap();
  const service = new EmailMailService({
    config,
    emailRoot,
    submissionStore: store,
    messageStore,
    smtp,
    imap,
    channels: options.channels ?? [{ id: `email/account/${RECIPIENT_ID}`, enabled: true }],
    builder: new OutgoingMimeBuilder({
      fromAddress: options.builderFrom ?? BOT,
      now: () => new Date(options.clock ?? CLOCK_A),
    }),
  });
  return { emailRoot, config, store, messageStore, smtp, imap, service };
}

function testBuilder(clock = CLOCK_A, from = BOT): OutgoingMimeBuilder {
  return new OutgoingMimeBuilder({ fromAddress: from, now: () => new Date(clock) });
}

function draft(workId: string, overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    owner: OWNER,
    operationKey: { workId, actionSlot: "reply" },
    targetKind: "user",
    to: RECIPIENT,
    subject: "Re: hello",
    authoredBody: "Authored body.",
    ...overrides,
  };
}

async function journalTransitions(emailRoot: string): Promise<string[]> {
  const result = await readJournal<SubmissionEntryRecord>(
    emailRoot,
    SUBMISSIONS_JOURNAL_FILENAME,
    { allowMissing: true },
  );
  return result.records.map((record) => record.transition);
}

async function readMeta(emailRoot: string, operationId: string): Promise<OutboundEvidenceMeta> {
  return JSON.parse(
    await Deno.readTextFile(join(emailRoot, outboundEvidenceMetaRef(operationId))),
  ) as OutboundEvidenceMeta;
}

/** Publish evidence the way a crashed pre-SMTP attempt would have left it on disk. */
async function writeEvidence(
  emailRoot: string,
  operationId: string,
  emlBytes: Uint8Array,
  meta: OutboundEvidenceMeta,
): Promise<void> {
  await Deno.mkdir(join(emailRoot, "outbound"), { recursive: true, mode: 0o700 });
  await Deno.writeFile(join(emailRoot, outboundEvidenceRef(operationId)), emlBytes, {
    create: true,
    mode: 0o600,
  });
  await Deno.writeFile(
    join(emailRoot, outboundEvidenceMetaRef(operationId)),
    new TextEncoder().encode(JSON.stringify(meta, null, 2) + "\n"),
    { create: true, mode: 0o600 },
  );
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "mail-service-test-" });
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

Deno.test("MailService - accepted message is submitted once with history and sent copy", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    const outcome = await h.service.send(draft("work-happy"));

    assertEquals(outcome.phase, "submitted");
    assertEquals(outcome.sentCopy, "appended");
    assertEquals(outcome.safeCode, SmtpDiagnosticCode.ACCEPTED);
    assertEquals(outcome.reused, false);
    assertEquals(outcome.targetKind, "user");
    assert(outcome.messageId?.startsWith("<"));
    assert(outcome.recordId);

    // Exactly one SMTP transaction, one APPEND, and byte identity across all copies.
    assertEquals(h.smtp.submissions.length, 1);
    assertEquals(h.imap.appended.length, 1);
    const wireBytes = h.smtp.submissions[0].emlBytes;
    const operationId = computeOperationId(OWNER, { workId: "work-happy", actionSlot: "reply" });
    const evidenceBytes = await Deno.readFile(join(h.emailRoot, outboundEvidenceRef(operationId)));
    assertEquals(evidenceBytes, wireBytes);
    assertEquals(h.imap.appended[0], wireBytes);
    assertEquals(h.smtp.submissions[0].envelope.from, BOT);
    assertEquals(h.smtp.submissions[0].envelope.to, [RECIPIENT]);
    assertEquals(h.imap.appendFolders, ["Sent"]);

    // History: one record, identical bytes, signature applied exactly once.
    const record = await h.messageStore.getByOwnerRecord(OWNER, outcome.recordId!);
    assert(record);
    assertEquals(record.direction, "outbound");
    assertEquals(record.wireMessageId, outcome.messageId);
    assertEquals(record.targetKind, "user");
    assertEquals(await h.messageStore.getSourceBytes(OWNER, outcome.recordId!), wireBytes);
    assertEquals(record.body, signedBody("Authored body."));
    assertEquals(countOf(record.body, SIGNATURE), 1);
    assertEquals(
      new TextDecoder().decode(wireBytes).includes("Auto-Submitted: auto-generated"),
      true,
    );

    // Effect order is the contract.
    assertEquals(await journalTransitions(h.emailRoot), [
      "prepare",
      "submitting",
      "outcome",
      "sent-copy",
    ]);

    // The metadata sidecar carries the digest and the local history reference.
    const meta = await readMeta(h.emailRoot, operationId);
    assertEquals(meta.history?.recordId, outcome.recordId);
    assertEquals(meta.digest, computeSha256Hex(evidenceBytes));
    assertEquals(meta.envelope, { from: BOT, to: [RECIPIENT] });
  });
});

Deno.test("MailService - definite failure records failed, leaves no history and no copy", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    h.smtp.mode = "failed";
    const outcome = await h.service.send(draft("work-failed"));

    assertEquals(outcome.phase, "failed");
    assertEquals(outcome.safeCode, SmtpDiagnosticCode.REJECTED);
    assertEquals(outcome.sentCopy, "pending");
    assertEquals(outcome.recordId, undefined);
    assertEquals(h.smtp.submissions.length, 1);
    assertEquals(h.imap.appended.length, 0);
    assertEquals(h.imap.connectCalls, 0);
    assertEquals(await journalTransitions(h.emailRoot), ["prepare", "submitting", "outcome"]);
    assertEquals(
      h.service.lookup(OWNER, { workId: "work-failed", actionSlot: "reply" })?.phase,
      "failed",
    );
  });
});

Deno.test("MailService - unknown outcome is persisted for manual review without history", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    h.smtp.mode = "unknown";
    const outcome = await h.service.send(draft("work-unknown"));

    assertEquals(outcome.phase, "unknown");
    assertEquals(outcome.safeCode, SmtpDiagnosticCode.CONNECTION_LOST);
    assertEquals(outcome.sentCopy, "pending");
    assertEquals(h.smtp.submissions.length, 1);
    assertEquals(h.imap.appended.length, 0);

    // Manual review has everything it needs: recorded operation id and evidence bytes.
    const operationId = computeOperationId(OWNER, { workId: "work-unknown", actionSlot: "reply" });
    assertEquals(outcome.operationId, operationId);
    assert(
      (await Deno.readFile(join(h.emailRoot, outboundEvidenceRef(operationId)))).byteLength > 0,
    );
    assertEquals(await h.service.send(draft("work-unknown")).then((o) => o.reused), true);
    assertEquals(h.smtp.submissions.length, 1);
  });
});

Deno.test("MailService - repeated accepted request returns the recorded result with zero SMTP", async () => {
  await withTempDir(async (base) => {
    const first = buildHarness({ base });
    const sent = await first.service.send(draft("work-repeat"));
    assertEquals(sent.phase, "submitted");

    // Same root, different clock and body: the operation key decides, not the payload.
    const second = buildHarness({
      base,
      clock: CLOCK_B,
      store: first.store,
      messageStore: first.messageStore,
      smtp: first.smtp,
      imap: first.imap,
    });
    const repeated = await second.service.send(
      draft("work-repeat", { authoredBody: "different body" }),
    );
    assertEquals(repeated.reused, true);
    assertEquals(repeated.phase, "submitted");
    assertEquals(repeated.operationId, sent.operationId);
    assertEquals(repeated.messageId, sent.messageId);
    assertEquals(repeated.recordId, sent.recordId);
    assertEquals(first.smtp.submissions.length, 1);
    assertEquals(first.imap.appended.length, 1);

    // Restart: fresh stores read the durable journal and still perform zero submissions.
    _resetSharedRegistryForTesting();
    const restartedSmtp = new RecordingSmtp();
    const restartedImap = new RecordingImap();
    const restarted = buildHarness({
      base,
      clock: CLOCK_B,
      smtp: restartedSmtp,
      imap: restartedImap,
    });
    const afterRestart = await restarted.service.send(draft("work-repeat"));
    assertEquals(afterRestart.reused, true);
    assertEquals(afterRestart.phase, "submitted");
    assertEquals(afterRestart.operationId, sent.operationId);
    assertEquals(afterRestart.recordId, sent.recordId);
    assertEquals(restartedSmtp.submissions.length, 0);
    assertEquals(restartedImap.appended.length, 0);
  });
});

Deno.test("MailService - accepted but unrecorded outcome is unknown and never replayed", async () => {
  await withTempDir(async (base) => {
    const store = new OutcomeFailingStore(join(base, "email"));
    const h = buildHarness({ base, store });
    const outcome = await h.service.send(draft("work-persist-fail"));

    // Accept then persist fails: the caller sees unknown with the operation id.
    assertEquals(outcome.phase, "unknown");
    assertEquals(outcome.safeCode, EmailSubmissionDiagnosticCode.OUTCOME_PERSIST_FAILED);
    assertEquals(outcome.reused, false);
    assertEquals(
      outcome.operationId,
      computeOperationId(OWNER, { workId: "work-persist-fail", actionSlot: "reply" }),
    );
    assertEquals(h.smtp.submissions.length, 1);
    assertEquals(h.imap.appended.length, 0);
    assertEquals(outcome.recordId, undefined);
    assertEquals(await journalTransitions(h.emailRoot), ["prepare", "submitting"]);

    // Immediate repetition: still unknown, still no second SMTP transaction.
    const repeated = await h.service.send(draft("work-persist-fail"));
    assertEquals(repeated.reused, true);
    assertEquals(repeated.phase, "unknown");
    assertEquals(repeated.safeCode, EmailSubmissionDiagnosticCode.SUBMISSION_IN_FLIGHT);
    assertEquals(h.smtp.submissions.length, 1);

    // Restart: recovery absorbs the unclosed submitting operation into unknown.
    _resetSharedRegistryForTesting();
    const restartedSmtp = new RecordingSmtp();
    const restarted = buildHarness({ base, smtp: restartedSmtp });
    const recovery = await restarted.service.recover();
    assertEquals(recovery.unknownRecovered, [outcome.operationId]);
    assertEquals(recovery.unknown, [outcome.operationId]);
    assertEquals(restartedSmtp.submissions.length, 0);

    const afterRestart = await restarted.service.send(draft("work-persist-fail"));
    assertEquals(afterRestart.reused, true);
    assertEquals(afterRestart.phase, "unknown");
    assertEquals(restartedSmtp.submissions.length, 0);
  });
});

Deno.test("MailService - crash during SMTP becomes unknown and is never automatically resubmitted", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    h.smtp.mode = "hang";

    const abandoned = h.service.send(draft("work-crash"));
    await h.smtp.entered.promise;
    assertEquals(await journalTransitions(h.emailRoot), ["prepare", "submitting"]);

    // Process death: in-memory state is gone, only the journal survives.
    _resetSharedRegistryForTesting();
    const restartedSmtp = new RecordingSmtp();
    const restarted = buildHarness({ base, smtp: restartedSmtp });
    const recovery = await restarted.service.recover();
    const operationId = computeOperationId(OWNER, { workId: "work-crash", actionSlot: "reply" });
    assertEquals(recovery.unknownRecovered, [operationId]);
    assertEquals(recovery.unknown, [operationId]);
    assertEquals(recovery.pendingCopies, []);

    // The abandoned call is still in flight; recovery already absorbed its operation as
    // `unknown` without touching SMTP. Drain it so it releases the operation lock, then prove
    // a repeated request returns the recorded state and never resubmits.
    h.smtp.releaseHang();
    await abandoned;
    assertEquals(restartedSmtp.submissions.length, 0);

    const outcome = await restarted.service.send(draft("work-crash"));
    assertEquals(outcome.phase, "unknown");
    assertEquals(outcome.reused, true);
    assertEquals(restartedSmtp.submissions.length, 0);
  });
});

Deno.test("MailService - prepared operation resumes with persisted bytes and envelope", async () => {
  await withTempDir(async (base) => {
    // Crash before SMTP: evidence was published and the journal reserved, then nothing.
    const first = buildHarness({ base });
    const key: EmailOperationKey = { workId: "work-resume", actionSlot: "reply" };
    const constructed = await testBuilder().construct(draft("work-resume"), SIGNATURE);
    const operationId = computeOperationId(OWNER, key);
    await writeEvidence(first.emailRoot, operationId, constructed.emlBytes, {
      v: 1,
      operationId,
      owner: OWNER,
      key,
      targetKind: "user",
      envelope: { from: BOT, to: [RECIPIENT] },
      to: constructed.to,
      subject: constructed.subject,
      messageId: constructed.messageId,
      historyBody: constructed.historyBody,
      wireIds: { ...constructed.wireIds },
      digest: constructed.digest,
      sizeBytes: constructed.sizeBytes,
    });
    await first.store.prepare(OWNER, key, constructed.digest, outboundEvidenceRef(operationId), {
      targetKind: "user",
      recipientRef: constructed.to,
    });
    assertEquals(
      first.service.lookup(OWNER, key)?.safeCode,
      EmailSubmissionDiagnosticCode.PENDING_SUBMISSION,
    );

    // A later process with a different clock and a different configured sender resumes it,
    // consuming the persisted bytes rather than re-constructing the message.
    const restarted = buildHarness({
      base: join(base, "restart"),
      emailRoot: first.emailRoot,
      clock: CLOCK_B,
      builderFrom: "other@example.com",
    });
    const outcome = await restarted.service.send(draft("work-resume"));

    assertEquals(outcome.phase, "submitted");
    assertEquals(outcome.messageId, constructed.messageId);
    assertEquals(restarted.smtp.submissions.length, 1);
    assertEquals(restarted.smtp.submissions[0].emlBytes, constructed.emlBytes);
    assertEquals(restarted.smtp.submissions[0].envelope.from, BOT);
    assertEquals(restarted.imap.appended[0], constructed.emlBytes);
    assertEquals(await journalTransitions(first.emailRoot), [
      "prepare",
      "submitting",
      "outcome",
      "sent-copy",
    ]);

    const record = await restarted.messageStore.getByOwnerRecord(OWNER, outcome.recordId!);
    assert(record);
    assertEquals(record.body, constructed.historyBody);
    assertEquals(countOf(record.body, SIGNATURE), 1);
  });
});

Deno.test("MailService - incomplete or tampered prepared evidence blocks submission", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    const key: EmailOperationKey = { workId: "work-evidence", actionSlot: "reply" };
    const operationId = computeOperationId(OWNER, key);
    const constructed = await testBuilder().construct(draft("work-evidence"), SIGNATURE);

    // Reserved with no evidence at all.
    await h.store.prepare(OWNER, key, constructed.digest, outboundEvidenceRef(operationId), {
      targetKind: "user",
      recipientRef: constructed.to,
    });
    await assertRejects(
      () => h.service.send(draft("work-evidence")),
      EmailMailServiceError,
      `[${EmailSubmissionDiagnosticCode.MISSING_LOCAL_EVIDENCE}]`,
    );
    assertEquals(h.smtp.submissions.length, 0);
    assertEquals(h.imap.appended.length, 0);

    // The bytes are published, but the metadata sidecar is missing.
    await Deno.mkdir(join(h.emailRoot, "outbound"), { recursive: true, mode: 0o700 });
    await Deno.writeFile(
      join(h.emailRoot, outboundEvidenceRef(operationId)),
      constructed.emlBytes,
      { create: true, mode: 0o600 },
    );
    await assertRejects(
      () => h.service.send(draft("work-evidence")),
      EmailMailServiceError,
      `[${EmailSubmissionDiagnosticCode.MISSING_LOCAL_EVIDENCE}]`,
    );
    assertEquals(h.smtp.submissions.length, 0);
  });
});

Deno.test("MailService - tampered evidence digest is rejected before SMTP", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    const key: EmailOperationKey = { workId: "work-digest", actionSlot: "reply" };
    const operationId = computeOperationId(OWNER, key);
    const constructed = await testBuilder().construct(draft("work-digest"), SIGNATURE);
    await writeEvidence(h.emailRoot, operationId, constructed.emlBytes, {
      v: 1,
      operationId,
      owner: OWNER,
      key,
      targetKind: "user",
      envelope: { from: BOT, to: [RECIPIENT] },
      to: constructed.to,
      subject: constructed.subject,
      messageId: constructed.messageId,
      historyBody: constructed.historyBody,
      wireIds: { ...constructed.wireIds },
      digest: constructed.digest,
      sizeBytes: constructed.sizeBytes,
    });
    await h.store.prepare(OWNER, key, constructed.digest, outboundEvidenceRef(operationId), {
      targetKind: "user",
      recipientRef: constructed.to,
    });

    // Tamper with the reserved evidence after publication.
    const tampered = new Uint8Array(constructed.emlBytes);
    tampered[tampered.length - 1] = 0x21;
    await Deno.writeFile(join(h.emailRoot, outboundEvidenceRef(operationId)), tampered);

    await assertRejects(
      () => h.service.send(draft("work-digest")),
      EmailMailServiceError,
      `[${EmailSubmissionDiagnosticCode.MISSING_LOCAL_EVIDENCE}]`,
    );
    assertEquals(h.smtp.submissions.length, 0);
    assertEquals(h.imap.appended.length, 0);

    // The journal itself still refuses the tampered bytes if a caller reaches the store gate.
    await assertRejects(
      () => h.store.markSubmitting(OWNER, key),
      SubmissionStoreError,
      `[${SubmissionDiagnosticCode.EVIDENCE_DIGEST_MISMATCH}]`,
    );
    assertEquals(h.smtp.submissions.length, 0);
  });
});

Deno.test("MailService - revoked allowlist is refused before SMTP and reserves nothing", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base, channels: [] });
    await assertRejects(
      () => h.service.send(draft("work-revoked")),
      EmailMailServiceError,
      `[${EmailSubmissionDiagnosticCode.RECIPIENT_NOT_ALLOWED}]`,
    );
    assertEquals(h.smtp.submissions.length, 0);
    assertEquals(
      h.service.lookup(OWNER, { workId: "work-revoked", actionSlot: "reply" }),
      undefined,
    );
    assertEquals(await journalTransitions(h.emailRoot), []);

    // Third-party destinations are authorized by the owning handler, not by this allowlist.
    const thirdParty = buildHarness({ base: join(base, "third-party"), channels: [] });
    const outcome = await thirdParty.service.send(
      draft("work-third-party", { targetKind: "third-party" }),
    );
    assertEquals(outcome.phase, "submitted");
  });
});

Deno.test("MailService - oversized message is refused before SMTP and reserves nothing", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base, maxMessageBytes: 64 });
    await assertRejects(
      () => h.service.send(draft("work-too-large")),
      EmailMailServiceError,
      `[${EmailSubmissionDiagnosticCode.MESSAGE_TOO_LARGE}]`,
    );
    assertEquals(h.smtp.submissions.length, 0);
    assertEquals(await journalTransitions(h.emailRoot), []);
  });
});

Deno.test("MailService - APPEND failure preserves acceptance, history and never resubmits", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    h.imap.failAppend = true;
    const outcome = await h.service.send(draft("work-append-fail"));

    assertEquals(outcome.phase, "submitted");
    assertEquals(outcome.sentCopy, "failed");
    assertEquals(outcome.safeCode, EmailSubmissionDiagnosticCode.SENT_COPY_FAILED);
    assert(outcome.recordId);
    assertEquals(h.smtp.submissions.length, 1);
    assertEquals(h.imap.appended.length, 0);
    const record = await h.messageStore.getByOwnerRecord(OWNER, outcome.recordId!);
    assert(record);
    assertEquals(record.body, signedBody("Authored body."));
    assertEquals(countOf(record.body, SIGNATURE), 1);

    // Repeating the request neither resubmits nor rewrites history.
    const repeated = await h.service.send(draft("work-append-fail"));
    assertEquals(repeated.phase, "submitted");
    assertEquals(repeated.sentCopy, "failed");
    assertEquals(repeated.safeCode, EmailSubmissionDiagnosticCode.SENT_COPY_FAILED);
    assertEquals(h.smtp.submissions.length, 1);

    // Explicit repair APPENDs the identical stored bytes and keeps SMTP untouched.
    h.imap.failAppend = false;
    const repair = await h.service.appendPendingCopies();
    assertEquals(repair.appended, [outcome.operationId]);
    assertEquals(repair.failed, []);
    assertEquals(h.imap.appended.length, 1);
    assertEquals(h.imap.appended[0], h.smtp.submissions[0].emlBytes);
    assertEquals(h.smtp.submissions.length, 1);
    assertEquals(
      h.service.lookup(OWNER, { workId: "work-append-fail", actionSlot: "reply" })?.sentCopy,
      "appended",
    );

    // Repair is idempotent once the copy is recorded.
    const second = await h.service.appendPendingCopies();
    assertEquals(second.appended, []);
    assertEquals(h.imap.appended.length, 1);
  });
});

Deno.test("MailService - history failure keeps acceptance and is repaired from stored evidence", async () => {
  await withTempDir(async (base) => {
    const messageStore = new HistoryFailingStore({ workspacesRoot: join(base, "workspaces") });
    const h = buildHarness({ base, messageStore });
    const outcome = await h.service.send(draft("work-history-fail"));

    assertEquals(outcome.phase, "submitted");
    assertEquals(outcome.sentCopy, "appended");
    assertEquals(outcome.historyError, EmailSubmissionDiagnosticCode.HISTORY_RECORD_FAILED);
    assertEquals(outcome.recordId, undefined);

    const recovery = await h.service.recover();
    assertEquals(recovery.historyRepaired, [outcome.operationId]);
    assertEquals(recovery.historyFailures, []);
    assertEquals(recovery.pendingCopies, []);

    const meta = await readMeta(h.emailRoot, outcome.operationId);
    assert(meta.history?.recordId);
    const record = await h.messageStore.getByOwnerRecord(OWNER, meta.history!.recordId);
    assert(record);
    assertEquals(record.body, signedBody("Authored body."));
    assertEquals(countOf(record.body, SIGNATURE), 1);

    // Repair is idempotent: a second pass finds the recorded history instead of rewriting it.
    const second = await h.service.recover();
    assertEquals(second.historyRepaired, []);
    assertEquals(second.historyFailures, []);

    // Local history and remote copy are separate phases.
    const submittedRecovery = await h.service.recover();
    assertEquals(submittedRecovery.submitted, [outcome.operationId]);
    assertEquals(submittedRecovery.unknown, []);
  });
});

Deno.test("MailService - concurrent duplicate requests make exactly one SMTP transaction", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    const [first, second] = await Promise.all([
      h.service.send(draft("work-concurrent")),
      h.service.send(draft("work-concurrent")),
    ]);

    assertEquals(h.smtp.submissions.length, 1);
    assertEquals(h.imap.appended.length, 1);
    assertEquals(first.operationId, second.operationId);
    assertEquals([first.reused, second.reused].sort(), [false, true]);
  });
});

Deno.test("MailService - sent copies serialize on the shared IMAP connection", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    h.imap.failAppend = true;
    const pending = await h.service.send(draft("work-copy-pending"));
    assertEquals(pending.sentCopy, "failed");

    h.imap.failAppend = false;
    const [repair, other] = await Promise.all([
      h.service.appendPendingCopies(),
      h.service.send(draft("work-copy-other")),
    ]);

    assertEquals(h.imap.maxConcurrentAppends, 1);
    assertEquals(repair.appended, [pending.operationId]);
    assertEquals(other.sentCopy, "appended");
    assertEquals(h.imap.appended.length, 2);
    assertEquals(h.smtp.submissions.length, 2);
    assertEquals(new Set(h.imap.appended.map((bytes) => new TextDecoder().decode(bytes))).size, 2);
  });
});

Deno.test("MailService - transport throw is unknown, invalid drafts are refused locally", async () => {
  await withTempDir(async (base) => {
    const throwing = buildHarness({ base: join(base, "throw") });
    throwing.smtp.mode = "throw";
    const outcome = await throwing.service.send(draft("work-throw"));
    assertEquals(outcome.phase, "unknown");
    assertEquals(outcome.safeCode, EmailSubmissionDiagnosticCode.SUBMISSION_TRANSPORT_ERROR);
    assertEquals(throwing.imap.appended.length, 0);
    assertEquals(outcome.recordId, undefined);

    const invalid = buildHarness({ base: join(base, "invalid") });
    await assertRejects(
      () => invalid.service.send(draft("work-invalid", { to: "" })),
      EmailMailServiceError,
      `[${EmailSubmissionDiagnosticCode.INVALID_DRAFT}]`,
    );
    assertEquals(invalid.smtp.submissions.length, 0);

    // An operation owned by another user is never visible through this lookup.
    assertEquals(
      invalid.service.lookup(OTHER_OWNER, { workId: "work-throw", actionSlot: "reply" }),
      undefined,
    );
  });
});

Deno.test("MailService - recovery fails closed when another instance already recovered", async () => {
  await withTempDir(async (base) => {
    const h = buildHarness({ base });
    const outcome = await h.service.send(draft("work-second-instance"));
    assertEquals(outcome.phase, "submitted");

    const second = buildHarness({ base, store: h.store });
    await assertRejects(
      () => second.service.recover(),
      EmailMailServiceError,
      `[${EmailSubmissionDiagnosticCode.RECOVERY_FAILED}]`,
    );
    await assertRejects(
      () => second.service.appendPendingCopies(),
      EmailMailServiceError,
      `[${EmailSubmissionDiagnosticCode.RECOVERY_FAILED}]`,
    );

    // Sends stay safe without an inventory: dedup is lookup-based.
    const repeated = await second.service.send(draft("work-second-instance"));
    assertEquals(repeated.reused, true);
    assertEquals(repeated.phase, "submitted");
    assertEquals(second.smtp.submissions.length, 0);
  });
});

Deno.test("MailService - evidence reference helpers describe the durable layout", () => {
  const operationId = computeOperationId(OWNER, { workId: "work-refs", actionSlot: "reply" });
  assertEquals(outboundEvidenceRef(operationId), `outbound/${operationId}.eml`);
  assertEquals(outboundEvidenceMetaRef(operationId), `outbound/${operationId}.meta.json`);
});

Deno.test("MailService - recovery and copy repair refuse accepted evidence that no longer matches", async () => {
  await withTempDir(async (base) => {
    const messageStore = new HistoryFailingStore({ workspacesRoot: join(base, "workspaces") });
    const h = buildHarness({ base, messageStore });
    h.imap.failAppend = true;
    const outcome = await h.service.send(draft("work-tamper-accepted"));
    assertEquals(outcome.phase, "submitted");
    assertEquals(outcome.sentCopy, "failed");
    assertEquals(outcome.historyError, EmailSubmissionDiagnosticCode.HISTORY_RECORD_FAILED);

    // The accepted bytes are replaced after acceptance.
    const evidencePath = join(h.emailRoot, outboundEvidenceRef(outcome.operationId));
    const tampered = await Deno.readFile(evidencePath);
    tampered[tampered.length - 1] = 0x21;
    await Deno.writeFile(evidencePath, tampered);

    // History reconstruction blocks on the mismatched digest and writes no record.
    const recovery = await h.service.recover();
    assertEquals(recovery.historyRepaired, []);
    assertEquals(recovery.historyFailures, [{
      operationId: outcome.operationId,
      code: EmailSubmissionDiagnosticCode.MISSING_LOCAL_EVIDENCE,
    }]);
    assertEquals((await readMeta(h.emailRoot, outcome.operationId)).history, undefined);

    // The sent-folder copy is likewise refused instead of APPENDing unverified bytes.
    h.imap.failAppend = false;
    const repair = await h.service.appendPendingCopies();
    assertEquals(repair.appended, []);
    assertEquals(repair.failed, [{
      operationId: outcome.operationId,
      code: EmailSubmissionDiagnosticCode.MISSING_LOCAL_EVIDENCE,
    }]);
    assertEquals(h.imap.appended.length, 0);

    // Neither repair path touches SMTP.
    assertEquals(h.smtp.submissions.length, 1);
    assertEquals(
      h.service.lookup(OWNER, { workId: "work-tamper-accepted", actionSlot: "reply" })?.phase,
      "submitted",
    );
  });
});

Deno.test("MailService - instances sharing a state root never replace accepted evidence", async () => {
  await withTempDir(async (base) => {
    const first = buildHarness({ base });
    // A second instance on the same state root, different clock and sender. Both race the same
    // logical key with different content. The process-wide operation lock must serialize them
    // instead of letting the loser overwrite the winner's published evidence.
    const second = buildHarness({
      base: join(base, "second-instance"),
      emailRoot: first.emailRoot,
      clock: CLOCK_B,
      builderFrom: "other@example.com",
      store: first.store,
      messageStore: first.messageStore,
      smtp: first.smtp,
      imap: first.imap,
    });
    const [a, b] = await Promise.all([
      first.service.send(draft("work-root-race", { authoredBody: "First body." })),
      second.service.send(draft("work-root-race", { authoredBody: "Second body." })),
    ]);

    const operationId = computeOperationId(OWNER, {
      workId: "work-root-race",
      actionSlot: "reply",
    });
    assertEquals(a.operationId, operationId);
    assertEquals(b.operationId, operationId);
    assertEquals(a.phase, "submitted");
    assertEquals(b.phase, "submitted");
    assertEquals([a.reused, b.reused].sort(), [false, true]);

    // Exactly one SMTP transaction, and the durable evidence is byte-identical to the bytes
    // that were actually accepted — never the losing draft's content.
    assertEquals(first.smtp.submissions.length, 1);
    assertEquals(
      await Deno.readFile(join(first.emailRoot, outboundEvidenceRef(operationId))),
      first.smtp.submissions[0].emlBytes,
    );
    assertEquals(first.imap.appended[0], first.smtp.submissions[0].emlBytes);
  });
});
