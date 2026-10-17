// src/platforms/email/mail-service.ts
//
// Common durable outbound email send service owned by `email-submission-service`.
//
// Contract (design `Submission flow / uncertainty`, row 13):
// - Single choke point for every outbound path: callers (rows 15/20/21) hand an `EmailDraft`
//   plus its logical operation key to `send()`; no other module submits mail.
// - Effect order IS the contract: construct once -> publish fsynced `.eml` evidence and its
//   metadata sidecar -> reserve the operation in the submission journal -> durably mark
//   `submitting` (gated on the evidence digest) -> SMTP submit -> persist the terminal
//   outcome -> local sent history -> IMAP sent-folder copy.
// - A repeated request for one logical operation short-circuits to the recorded terminal
//   result with zero additional SMTP transactions; `failed`/`unknown` never move back to a
//   resubmit automatically.
// - A sent-folder copy failure after acceptance is a separate recorded phase: it never
//   downgrades `submitted`, never rewrites local history, and never resubmits.
// - Recovery consumes persisted evidence only and NEVER submits; unclosed `submitting`
//   operations surface as `unknown` for manual operator review.
//
// Durable evidence layout under the email state root (private, mode 0700/0600):
// - `outbound/<operationId>.eml`       exact wire bytes submitted verbatim to SMTP
// - `outbound/<operationId>.meta.json` construction metadata (signed history body, wire ids,
//   envelope, digest) plus the local history reference once history is recorded
//
// This module is intentionally NOT registered in production bootstrap; email activation
// remains guarded until the final batch cutover.

import { basename, join, resolve } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import { BaseError, ErrorCode } from "../../types/errors.ts";
import type { ChannelConfig, EmailConfig } from "../../types/config.ts";
import type { EmailSubmissionMetadata } from "../../types/platform.ts";
import {
  assertSafePath,
  canonicalizeRoot,
  DurableFileOptions,
  ensureDurableDir,
  replaceSnapshot,
  syncDirectory,
} from "./durable-files.ts";
import { normalizeEmailMailbox } from "./email-identity.ts";
import { isSenderAllowed } from "./incoming-auth.ts";
import {
  isSpontaneousTargetAllowed,
  SPONTANEOUS_ACTION_SLOT_PREFIX,
} from "@core/spontaneous-target.ts";
import { EmailDraft, OutgoingMimeBuilder } from "./outgoing-mime.ts";
import type { ImapTransport } from "./imap-client.ts";
import type { EmailMessageIdentifiers } from "./message-store.ts";
import type { EmailMessageStore } from "./message-store.ts";
import type { SmtpSubmission, SmtpSubmitResult, SmtpTransport } from "./smtp-client.ts";
import {
  computeOperationId,
  computeSha256Hex,
  EmailOperationKey,
  formatOwnerOperationKey,
  SubmissionDiagnosticCode,
  SubmissionEntrySnapshot,
  type SubmissionRecoveryResult,
  SubmissionStore,
  SubmissionStoreError,
  validateOperationKey,
} from "./submission-store.ts";

const logger = createLogger("EmailMailService");

/** Subdirectory of the email state root holding constructed submission evidence. */
export const OUTBOUND_EVIDENCE_SUBDIR = "outbound";

/** Supported evidence metadata version. */
export const OUTBOUND_EVIDENCE_VERSION = 1;

/** Shape of a persisted operation identifier (`op_` + 24 lowercase hex characters). */
const OPERATION_ID_REGEX = /^op_[0-9a-f]{24}$/;

/** Safe diagnostic codes for the submission service. Content-free and stable. */
export enum EmailSubmissionDiagnosticCode {
  INVALID_DRAFT = "INVALID_DRAFT",
  RECIPIENT_NOT_ALLOWED = "RECIPIENT_NOT_ALLOWED",
  MESSAGE_TOO_LARGE = "MESSAGE_TOO_LARGE",
  KEY_REUSE_CONFLICT = "KEY_REUSE_CONFLICT",
  MISSING_LOCAL_EVIDENCE = "MISSING_LOCAL_EVIDENCE",
  EVIDENCE_WRITE_FAILED = "EVIDENCE_WRITE_FAILED",
  SUBMISSION_STORE_FAILED = "SUBMISSION_STORE_FAILED",
  OUTCOME_PERSIST_FAILED = "OUTCOME_PERSIST_FAILED",
  SUBMISSION_TRANSPORT_ERROR = "SUBMISSION_TRANSPORT_ERROR",
  SUBMISSION_IN_FLIGHT = "SUBMISSION_IN_FLIGHT",
  PENDING_SUBMISSION = "PENDING_SUBMISSION",
  HISTORY_RECORD_FAILED = "HISTORY_RECORD_FAILED",
  SENT_COPY_FAILED = "SENT_COPY_FAILED",
  RECOVERY_FAILED = "RECOVERY_FAILED",
}

/** Terminal or resumable state reported to a caller. */
export type EmailSendPhase = "prepared" | "submitting" | "submitted" | "failed" | "unknown";

/** Default safe code reported for journal phases that carry no transport code. */
const NON_TERMINAL_SAFE_CODE: Record<EmailSendPhase, string | undefined> = {
  prepared: EmailSubmissionDiagnosticCode.PENDING_SUBMISSION,
  submitting: EmailSubmissionDiagnosticCode.SUBMISSION_IN_FLIGHT,
  submitted: undefined,
  failed: undefined,
  unknown: undefined,
};

/** Error raised for service-owned refusals and durability failures. */
export class EmailMailServiceError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: EmailSubmissionDiagnosticCode;

  constructor(
    diagnosticCode: EmailSubmissionDiagnosticCode,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(`[${diagnosticCode}] ${message}`, { ...context, diagnosticCode });
    this.diagnosticCode = diagnosticCode;
  }
}

/**
 * Persisted construction metadata for one logical operation.
 *
 * It is written before the journal reservation and is the only source recovery and sent-copy
 * repair read: it therefore must contain everything needed to record local history without
 * re-running construction (and without applying the signature a second time).
 */
export interface OutboundEvidenceMeta {
  v: number;
  operationId: string;
  owner: string;
  key: EmailOperationKey;
  targetKind: "user" | "third-party";
  envelope: { from: string; to: string[] };
  to: string;
  subject: string;
  messageId: string;
  /** Signed logical body (signature applied exactly once at construction time). */
  historyBody: string;
  wireIds: EmailMessageIdentifiers;
  /**
   * Internal owner-thread the host bound this operation to (row 25: the owner
   * thread durably selected for one spontaneous occurrence). Persisted so
   * history recording and its crash repair attribute the outbound record to the
   * SAME thread instead of allocating another one from the wire Message-ID.
   * Absent for operations that resolve their thread from the wire references.
   */
  internalThreadId?: string;
  digest: string;
  sizeBytes: number;
  /** Local history reference, recorded once `putSent` succeeded. */
  history?: { recordId: string; threadId: string };
}

/** Relative evidence path for an operation's wire bytes. */
export function outboundEvidenceRef(operationId: string): string {
  return `${OUTBOUND_EVIDENCE_SUBDIR}/${operationId}.eml`;
}

/** Relative evidence path for an operation's construction metadata. */
export function outboundEvidenceMetaRef(operationId: string): string {
  return `${OUTBOUND_EVIDENCE_SUBDIR}/${operationId}.meta.json`;
}

/** Result of one `send()` call. Structurally usable as `emailSubmission` metadata. */
export interface EmailSendOutcome extends EmailSubmissionMetadata {
  phase: EmailSendPhase;
  /** Wire Message-ID of the constructed message, when known. */
  messageId?: string;
  /** Local history record id, when local history was recorded. */
  recordId?: string;
  /** True when the recorded journal result was returned without an SMTP submission. */
  reused: boolean;
  /** Safe diagnostic when local history could not be recorded after acceptance. */
  historyError?: string;
}

/** Summary of one recovery pass. */
export interface EmailSubmissionRecovery {
  /** False when the submission journal could not be enumerated (see `recover()`). */
  storeRecovered: boolean;
  totalTracked: number;
  /** Operations durably converted from `submitting` to `unknown` by this recovery. */
  unknownRecovered: string[];
  prepared: string[];
  submitted: string[];
  failed: string[];
  unknown: string[];
  /** Operations whose missing local history was reconstructed from stored evidence. */
  historyRepaired: string[];
  historyFailures: Array<{ operationId: string; code: EmailSubmissionDiagnosticCode }>;
  /** Submitted operations whose sent-folder copy is still missing. */
  pendingCopies: string[];
}

/** Result of an explicit sent-folder copy repair pass. */
export interface EmailCopyRepairResult {
  appended: string[];
  failed: Array<{ operationId: string; code: EmailSubmissionDiagnosticCode }>;
}

/** Options for {@link EmailMailService}. */
export interface EmailMailServiceOptions {
  /** Email platform configuration: signature, sent folder, size bound and addresses. */
  config: EmailConfig;
  /** Email state root; holds the submission journal and the outbound evidence directory. */
  emailRoot: string;
  /** Durable submission journal. MUST resolve `emlRef` relative to `emailRoot`. */
  submissionStore: SubmissionStore;
  /** Owner-scoped local message and thread history store. */
  messageStore: EmailMessageStore;
  /** SMTP submission transport (production: `EmailSmtpClient`; tests: a scripted double). */
  smtp: SmtpTransport;
  /**
   * IMAP transport used only to APPEND the accepted bytes to the sent folder.
   *
   * One transport owns one mutable connection. Copies are serialized per transport identity
   * across every service instance in the process, so callers may share a transport, but no
   * other code may use it concurrently outside this service's sent-copy lane.
   */
  imap: ImapTransport;
  /** Configured channels; the allowlist for `targetKind: "user"` recipients. */
  channels: ChannelConfig[];
  /** Constructed-message builder; defaults to one built from `config.address`. */
  builder?: OutgoingMimeBuilder;
  /** Durable file options forwarded to evidence and journal writes. */
  durableOptions?: DurableFileOptions;
  /** Pre-recovered submission store result, so the service does not repeat recovery. */
  recoveryResult?: SubmissionRecoveryResult;
}

/** One tracked logical operation (inventory for history/copy repair). */
interface TrackedOperation {
  owner: string;
  key: EmailOperationKey;
}

/** Evidence bundle read back from disk. */
interface EvidenceBundle {
  emlBytes: Uint8Array;
  meta: OutboundEvidenceMeta;
}

/** Write every byte of a buffer to an open handle, refusing partial writes. */
async function writeAllBytes(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes.subarray(offset));
    if (written === 0) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.EVIDENCE_WRITE_FAILED,
        "Zero bytes written while publishing submission evidence",
      );
    }
    offset += written;
  }
}

/**
 * Process-wide per-operation mutation locks, keyed by state root + owner + operation key.
 *
 * The journal serializes durable transitions, but evidence publication happens *before* the
 * reservation, so two service instances sharing one state root must also share this lock.
 * Otherwise a concurrent sender could replace the `.eml` of an operation that is already
 * submitting or submitted, letting SMTP accept one message while recovery and sent-copy
 * repair later consume different bytes. Cross-process locking stays out of scope: the single
 * process owns mailbox/workspace state (`design.md`).
 */
const OPERATION_LOCKS = new Map<string, Promise<void>>();

/**
 * Process-wide sent-copy lanes, keyed by transport identity.
 *
 * The injected IMAP transport owns one mutable connection, so copies must not overlap even
 * when two service instances share that transport. Keying by the transport instance — rather
 * than by this service — keeps the lane exclusive for every user of the same connection.
 */
const COPY_LANES = new WeakMap<ImapTransport, Promise<void>>();

/**
 * Common durable send service.
 *
 * Wire-up is deliberately manual: no production bootstrap registers this class until the
 * activation change removes the config guard.
 */
export class EmailMailService {
  private readonly config: EmailConfig;
  private readonly emailRoot: string;
  private readonly submissionStore: SubmissionStore;
  private readonly messageStore: EmailMessageStore;
  private readonly smtp: SmtpTransport;
  private readonly imap: ImapTransport;
  private readonly channels: ChannelConfig[];
  private readonly builder: OutgoingMimeBuilder;
  private readonly durableOptions?: DurableFileOptions;

  private readonly signature: string;
  private readonly sentFolder: string;
  private readonly maxMessageBytes: number;

  /** In-memory operation inventory for repair enumeration. */
  private readonly tracked = new Map<string, TrackedOperation>();

  private recoveryPromise: Promise<void> | null = null;
  private recoveryUnavailable = false;
  private unknownRecovered: string[] = [];

  constructor(options: EmailMailServiceOptions) {
    if (!options?.config) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.INVALID_DRAFT,
        "EmailMailService requires an email platform config",
      );
    }
    if (!options.emailRoot || typeof options.emailRoot !== "string") {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.INVALID_DRAFT,
        "EmailMailService requires a non-empty email state root",
      );
    }
    if (!options.submissionStore || !options.messageStore || !options.smtp || !options.imap) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.INVALID_DRAFT,
        "EmailMailService requires submission, message, SMTP and IMAP dependencies",
      );
    }
    this.config = options.config;
    this.emailRoot = options.emailRoot;
    this.submissionStore = options.submissionStore;
    this.messageStore = options.messageStore;
    this.smtp = options.smtp;
    this.imap = options.imap;
    this.channels = options.channels ?? [];
    this.builder = options.builder ??
      new OutgoingMimeBuilder({ fromAddress: options.config.address });
    this.durableOptions = options.durableOptions;
    this.signature = options.config.signature;
    this.sentFolder = options.config.sentFolder;
    this.maxMessageBytes = options.config.maxMessageBytes;
    if (options.recoveryResult) {
      this.recoveryPromise = (() => {
        this.unknownRecovered = options.recoveryResult!.unknownRecovered.map((entry) =>
          entry.operationId
        );
        for (const entry of options.recoveryResult!.entries.values()) {
          this.track(entry.ownerId, entry.key);
        }
        return Promise.resolve();
      })();
    }
  }

  /**
   * Send one logical outgoing message.
   *
   * The effect order is fixed and durable at every step (see the module contract). Repeated
   * calls for the same logical operation return the recorded result and perform no SMTP
   * transaction.
   */
  async send(draft: EmailDraft): Promise<EmailSendOutcome> {
    const owner = this.assertDraftShape(draft);
    const key = validateOperationKey(draft.operationKey);
    await this.ensureRecovered();
    this.track(owner, key);
    const outcome = await this.withKeyLock(
      `${resolve(this.emailRoot)}\u0000${formatOwnerOperationKey(owner, key)}`,
      () => this.sendLocked(owner, key, draft),
    );
    logger.info("Email submission finished: {Phase} (sentCopy={SentCopy}, reused={Reused})", {
      Phase: outcome.phase,
      SentCopy: outcome.sentCopy ?? "pending",
      Reused: outcome.reused,
      OperationId: outcome.operationId,
      SafeCode: outcome.safeCode ?? "none",
    });
    return outcome;
  }

  /**
   * Look up the recorded state of one logical operation.
   *
   * Deviation from the design shorthand `lookup(operationKey)`: operation state is scoped by
   * owner in the durable journal, so the owner is required to answer unambiguously.
   */
  lookup(owner: string, operationKey: EmailOperationKey): EmailSendOutcome | undefined {
    if (!owner || typeof owner !== "string") {
      return undefined;
    }
    let key: EmailOperationKey;
    try {
      key = validateOperationKey(operationKey);
    } catch {
      return undefined;
    }
    const snapshot = this.submissionStore.lookup(owner, key);
    if (!snapshot) {
      return undefined;
    }
    const meta = this.readEvidenceMetaSync(snapshot.operationId);
    return this.snapshotOutcome(snapshot, { reused: true, meta });
  }

  /**
   * Startup recovery.
   *
   * Consumes the submission journal (unclosed `submitting` operations become absorbing
   * `unknown`), then reconstructs missing local history for accepted operations from stored
   * evidence. It NEVER submits and never appends.
   *
   * Rejects with `RECOVERY_FAILED` when the journal cannot be enumerated, because a partial
   * inventory would silently skip history/copy repair.
   */
  async recover(): Promise<EmailSubmissionRecovery> {
    await this.ensureRecovered();
    if (this.recoveryUnavailable) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.RECOVERY_FAILED,
        "Submission journal recovery was already performed by another instance; " +
          "operation inventory for history and copy repair is unavailable",
      );
    }

    const prepared: string[] = [];
    const submitted: string[] = [];
    const failed: string[] = [];
    const unknown: string[] = [];
    const historyRepaired: string[] = [];
    const historyFailures: EmailSubmissionRecovery["historyFailures"] = [];
    const pendingCopies: string[] = [];

    for (const operation of this.tracked.values()) {
      const snapshot = this.submissionStore.lookup(operation.owner, operation.key);
      if (!snapshot) {
        continue;
      }
      switch (snapshot.phase) {
        case "prepared":
          // Explicitly resumable by the caller; never submitted automatically.
          prepared.push(snapshot.operationId);
          break;
        case "failed":
          failed.push(snapshot.operationId);
          break;
        case "unknown":
          unknown.push(snapshot.operationId);
          break;
        case "submitted": {
          submitted.push(snapshot.operationId);
          const repair = await this.repairHistory(operation.owner, operation.key, snapshot);
          if (repair.ok) {
            if (repair.repaired) {
              historyRepaired.push(snapshot.operationId);
            }
          } else {
            historyFailures.push({ operationId: snapshot.operationId, code: repair.code });
          }
          if (snapshot.sentCopy !== "appended") {
            pendingCopies.push(snapshot.operationId);
          }
          break;
        }
      }
    }

    logger.info(
      "Submission recovery complete: {Total} tracked, {UnknownRecovered} absorbed into unknown, " +
        "{PendingCopies} sent copies pending",
      {
        Total: this.tracked.size,
        UnknownRecovered: this.unknownRecovered.length,
        PendingCopies: pendingCopies.length,
      },
    );

    return {
      storeRecovered: true,
      totalTracked: this.tracked.size,
      unknownRecovered: [...this.unknownRecovered],
      prepared,
      submitted,
      failed,
      unknown,
      historyRepaired,
      historyFailures,
      pendingCopies,
    };
  }

  /**
   * APPEND accepted bytes to the sent folder for every tracked operation whose copy is not
   * yet recorded as appended. Never touches SMTP and never downgrades `submitted`.
   */
  async appendPendingCopies(): Promise<EmailCopyRepairResult> {
    await this.ensureRecovered();
    if (this.recoveryUnavailable) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.RECOVERY_FAILED,
        "Submission journal recovery was already performed by another instance; " +
          "operation inventory for copy repair is unavailable",
      );
    }

    const appended: string[] = [];
    const failed: EmailCopyRepairResult["failed"] = [];

    for (const operation of this.tracked.values()) {
      const snapshot = this.submissionStore.lookup(operation.owner, operation.key);
      if (!snapshot || snapshot.phase !== "submitted" || snapshot.sentCopy === "appended") {
        continue;
      }
      const evidence = await this.readVerifiedEvidence(
        snapshot.operationId,
        snapshot.contentDigest,
      );
      if (!evidence) {
        failed.push({
          operationId: snapshot.operationId,
          code: EmailSubmissionDiagnosticCode.MISSING_LOCAL_EVIDENCE,
        });
        continue;
      }
      const status = await this.copyToSentFolder(
        operation.owner,
        operation.key,
        evidence.emlBytes,
      );
      if (status === "appended") {
        appended.push(snapshot.operationId);
      } else {
        failed.push({
          operationId: snapshot.operationId,
          code: EmailSubmissionDiagnosticCode.SENT_COPY_FAILED,
        });
      }
    }

    return { appended, failed };
  }

  // --- send internals -------------------------------------------------------------------

  private async sendLocked(
    owner: string,
    key: EmailOperationKey,
    draft: EmailDraft,
  ): Promise<EmailSendOutcome> {
    const existing = this.submissionStore.lookup(owner, key);
    if (existing) {
      if (
        existing.phase === "submitted" || existing.phase === "failed" ||
        existing.phase === "unknown"
      ) {
        // Recorded terminal state: returned as-is with zero additional SMTP transactions.
        return this.snapshotOutcome(existing, { reused: true });
      }
      if (existing.phase === "submitting") {
        // Mid-flight or already-reported-accepted-but-unrecorded: never submit again.
        return this.snapshotOutcome(existing, {
          reused: true,
          phaseOverride: "unknown",
          safeCodeOverride: EmailSubmissionDiagnosticCode.SUBMISSION_IN_FLIGHT,
        });
      }
      return await this.resumePrepared(owner, key, existing, draft);
    }
    return await this.prepareAndSubmit(owner, key, draft);
  }

  /** First attempt for a logical operation: construct, publish evidence, reserve, submit. */
  private async prepareAndSubmit(
    owner: string,
    key: EmailOperationKey,
    draft: EmailDraft,
  ): Promise<EmailSendOutcome> {
    // Fail closed before any evidence is written for a recipient the allowlist rejects.
    this.assertRecipientAuthorized(draft.targetKind, draft.to, draft.operationKey.actionSlot);

    const operationId = computeOperationId(owner, key);
    const constructed = await this.builder.construct(draft, this.signature);
    if (constructed.sizeBytes > this.maxMessageBytes) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.MESSAGE_TOO_LARGE,
        "Constructed message exceeds the configured maximum message size",
        { operationId, sizeBytes: constructed.sizeBytes, maxMessageBytes: this.maxMessageBytes },
      );
    }

    const meta: OutboundEvidenceMeta = {
      v: OUTBOUND_EVIDENCE_VERSION,
      operationId,
      owner,
      key: { ...key },
      targetKind: draft.targetKind,
      envelope: { from: constructed.envelope.from, to: [...constructed.envelope.to] },
      to: constructed.to,
      subject: constructed.subject,
      messageId: constructed.messageId,
      historyBody: constructed.historyBody,
      wireIds: { ...constructed.wireIds },
      ...(draft.internalThreadId ? { internalThreadId: draft.internalThreadId } : {}),
      digest: constructed.digest,
      sizeBytes: constructed.sizeBytes,
    };
    await this.publishEvidence(meta, constructed.emlBytes);

    const prepared = await this.submissionStore.prepare(
      owner,
      key,
      constructed.digest,
      outboundEvidenceRef(operationId),
      { targetKind: draft.targetKind, recipientRef: constructed.to },
    );
    if (prepared.phase !== "prepared") {
      // A concurrent reservation won the race: return the recorded state, never resubmit.
      return this.snapshotOutcome(prepared, { reused: true });
    }

    return await this.submitAccepted(
      owner,
      key,
      { emlBytes: constructed.emlBytes, meta },
    );
  }

  /**
   * Resume a reserved-but-unsubmitted operation using the persisted evidence only.
   *
   * The message is never reconstructed: the stored bytes, Message-ID and already-signed
   * history body are authoritative, so an operation that crashed before SMTP is delivered
   * exactly as originally constructed.
   */
  private async resumePrepared(
    owner: string,
    key: EmailOperationKey,
    snapshot: SubmissionEntrySnapshot,
    draft: EmailDraft,
  ): Promise<EmailSendOutcome> {
    if (
      snapshot.targetKind !== draft.targetKind ||
      !snapshot.recipientRef ||
      snapshot.recipientRef !== normalizeEmailMailbox(draft.to).canonicalAddress
    ) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.KEY_REUSE_CONFLICT,
        "Prepared operation was reserved for a different target than the supplied draft",
        { operationId: snapshot.operationId },
      );
    }

    const evidence = await this.readVerifiedEvidence(snapshot.operationId, snapshot.contentDigest);
    if (!evidence) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.MISSING_LOCAL_EVIDENCE,
        "Prepared operation evidence is missing, incomplete or does not match the reserved " +
          "digest; automatic submission is blocked",
        { operationId: snapshot.operationId },
      );
    }

    return await this.submitAccepted(owner, key, evidence);
  }

  /** Common submission tail: allowlist gate, exclusive marking, SMTP, outcome, history, copy. */
  private async submitAccepted(
    owner: string,
    key: EmailOperationKey,
    evidence: EvidenceBundle,
  ): Promise<EmailSendOutcome> {
    const { meta, emlBytes } = evidence;

    // Recheck the current allowlist immediately before SMTP.
    this.assertRecipientAuthorized(meta.targetKind, meta.envelope.to[0] ?? meta.to, key.actionSlot);

    // Exclusive durable gate, gated on the fsynced `.eml` evidence digest.
    await this.submissionStore.markSubmitting(owner, key);

    // Re-verify immediately before SMTP to ensure no revocation happened during the journal write
    try {
      this.assertRecipientAuthorized(
        meta.targetKind,
        meta.envelope.to[0] ?? meta.to,
        key.actionSlot,
      );
    } catch (err) {
      await this.submissionStore.recordOutcome(owner, key, "failed", {
        safeCode: err instanceof EmailMailServiceError
          ? err.diagnosticCode
          : EmailSubmissionDiagnosticCode.RECIPIENT_NOT_ALLOWED,
      });
      throw err;
    }

    const submission: SmtpSubmission = {
      emlBytes,
      envelope: { from: meta.envelope.from, to: [...meta.envelope.to] },
      sizeBytes: meta.sizeBytes,
    };

    let result: SmtpSubmitResult | undefined;
    try {
      result = await this.smtp.submit(submission);
    } catch (err) {
      // The transport reports definite rejections as results, never as throws, so a throw
      // cannot be treated as a resendable failure: record unknown for manual review.
      logger.error("SMTP submission threw; recording unknown: {Cause}", { Cause: String(err) });
    }
    const phase = result?.phase ?? "unknown";
    const safeCode = result
      ? String(result.safeCode)
      : EmailSubmissionDiagnosticCode.SUBMISSION_TRANSPORT_ERROR;

    let snapshot: SubmissionEntrySnapshot;
    try {
      snapshot = await this.submissionStore.recordOutcome(owner, key, phase, {
        safeCode,
        wireMessageId: meta.messageId,
      });
    } catch (err) {
      // Acceptance happened but cannot be made durable: report unknown so no caller can
      // treat this as a resendable failure, and write neither history nor sent copy.
      logger.error("Failed to persist submission outcome: {Cause}", { Cause: String(err) });
      return {
        operationId: meta.operationId,
        phase: "unknown",
        targetKind: meta.targetKind,
        sentCopy: "pending",
        safeCode: EmailSubmissionDiagnosticCode.OUTCOME_PERSIST_FAILED,
        messageId: meta.messageId,
        reused: false,
      };
    }

    if (phase !== "submitted") {
      return this.snapshotOutcome(snapshot, { reused: false, meta, safeCodeOverride: safeCode });
    }

    // Accepted: persist local history, then APPEND the identical bytes to the sent folder.
    let historyError: string | undefined;
    let recordId: string | undefined;
    try {
      const recorded = await this.recordHistory(owner, key, evidence);
      recordId = recorded.recordId;
    } catch (err) {
      historyError = EmailSubmissionDiagnosticCode.HISTORY_RECORD_FAILED;
      logger.error("Failed to record local sent history after acceptance: {Cause}", {
        Cause: String(err),
        OperationId: meta.operationId,
      });
    }

    const sentCopy = await this.copyToSentFolder(owner, key, emlBytes);

    return {
      operationId: meta.operationId,
      phase: "submitted",
      targetKind: meta.targetKind,
      sentCopy,
      safeCode: sentCopy === "appended" ? safeCode : EmailSubmissionDiagnosticCode.SENT_COPY_FAILED,
      messageId: meta.messageId,
      recordId,
      reused: false,
      historyError,
    };
  }

  // --- history and sent copy -------------------------------------------------------------

  /** Record local sent history exactly once, reusing the already-signed persisted body. */
  private async recordHistory(
    owner: string,
    key: EmailOperationKey,
    evidence: EvidenceBundle,
  ): Promise<{ recordId: string; threadId: string }> {
    const { meta, emlBytes } = evidence;
    if (meta.history?.recordId) {
      const existing = await this.messageStore.getByOwnerRecord(owner, meta.history.recordId);
      if (existing) {
        return { recordId: existing.recordId, threadId: existing.threadId };
      }
    }
    const recorded = await this.messageStore.putSent(owner, {
      messageId: meta.messageId,
      emlBytes,
      digest: meta.digest,
      historyBody: meta.historyBody,
      to: meta.to,
      subject: meta.subject,
      targetKind: meta.targetKind,
      ...(meta.internalThreadId ? { threadId: meta.internalThreadId } : {}),
      wireIds: { ...meta.wireIds },
    }, key);
    await this.writeHistoryRef(meta, recorded.recordId, recorded.threadId);
    return recorded;
  }

  /** Reconstruct missing local history for an accepted operation from stored evidence. */
  private async repairHistory(
    owner: string,
    key: EmailOperationKey,
    snapshot: SubmissionEntrySnapshot,
  ): Promise<
    { ok: true; repaired: boolean } | { ok: false; code: EmailSubmissionDiagnosticCode }
  > {
    const evidence = await this.readVerifiedEvidence(snapshot.operationId, snapshot.contentDigest);
    if (!evidence) {
      return { ok: false, code: EmailSubmissionDiagnosticCode.MISSING_LOCAL_EVIDENCE };
    }
    try {
      const alreadyRecorded = evidence.meta.history?.recordId
        ? await this.messageStore.getByOwnerRecord(owner, evidence.meta.history.recordId)
        : undefined;
      if (alreadyRecorded) {
        return { ok: true, repaired: false };
      }
      await this.recordHistory(owner, key, evidence);
      return { ok: true, repaired: true };
    } catch (err) {
      logger.error("History repair failed for {OperationId}: {Cause}", {
        OperationId: snapshot.operationId,
        Cause: String(err),
      });
      return { ok: false, code: EmailSubmissionDiagnosticCode.HISTORY_RECORD_FAILED };
    }
  }

  /**
   * APPEND the accepted bytes to the sent folder under the transport-wide copy lane.
   *
   * The lane serializes the whole connect/append/disconnect lifecycle because the injected
   * transport owns a single mutable connection, and it rechecks the recorded status so an
   * overlapping repair can never append the same operation twice.
   */
  private async copyToSentFolder(
    owner: string,
    key: EmailOperationKey,
    emlBytes: Uint8Array,
  ): Promise<"pending" | "appended" | "failed"> {
    return await this.withCopyLane(async () => {
      const current = this.submissionStore.lookup(owner, key);
      if (!current || current.phase !== "submitted") {
        return current?.sentCopy ?? "pending";
      }
      if (current.sentCopy === "appended") {
        return "appended";
      }
      try {
        await this.imap.connect();
        await this.imap.appendSent(emlBytes, { folder: this.sentFolder });
      } catch (err) {
        logger.error("Sent-folder APPEND failed for {OperationId}: {Cause}", {
          OperationId: current.operationId,
          Cause: String(err),
        });
        await this.disconnectQuietly();
        return await this.recordSentCopy(owner, key, "failed");
      }
      await this.disconnectQuietly();
      return await this.recordSentCopy(owner, key, "appended");
    });
  }

  /** Persist a sent-copy status without ever touching the accepted outcome. */
  private async recordSentCopy(
    owner: string,
    key: EmailOperationKey,
    status: "appended" | "failed",
  ): Promise<"appended" | "failed"> {
    try {
      await this.submissionStore.updateSentCopy(owner, key, status);
    } catch (err) {
      logger.error("Failed to persist sent-copy status {Status}: {Cause}", {
        Status: status,
        Cause: String(err),
      });
    }
    return status;
  }

  private async disconnectQuietly(): Promise<void> {
    try {
      await this.imap.disconnect();
    } catch {
      // A failed teardown must not mask the copy outcome.
    }
  }

  // --- evidence ---------------------------------------------------------------------------

  /**
   * Publish fsynced evidence for one operation.
   *
   * Evidence without a journal reservation cannot correspond to any submission, so replacing
   * it is always safe and a crash before or during publication is recoverable by the next
   * attempt. Once the journal reserves the operation the evidence is never rewritten.
   */
  private async publishEvidence(meta: OutboundEvidenceMeta, emlBytes: Uint8Array): Promise<void> {
    await this.publishEvidenceFile(outboundEvidenceRef(meta.operationId), emlBytes);
    await this.publishEvidenceMeta(meta);
  }

  private async publishEvidenceMeta(meta: OutboundEvidenceMeta): Promise<void> {
    const canonicalRoot = await canonicalizeRoot(this.emailRoot);
    await replaceSnapshot(
      canonicalRoot,
      outboundEvidenceMetaRef(meta.operationId),
      meta,
      this.durableOptions,
    );
  }

  private async writeHistoryRef(
    meta: OutboundEvidenceMeta,
    recordId: string,
    threadId: string,
  ): Promise<void> {
    try {
      await this.publishEvidenceMeta({ ...meta, history: { recordId, threadId } });
    } catch (err) {
      // History itself is durable; a missing evidence reference only means a later repair
      // re-reads the idempotent history store.
      logger.warn("Failed to record history reference in evidence: {Cause}", {
        Cause: String(err),
        OperationId: meta.operationId,
      });
    }
  }

  /** Atomically publish raw evidence bytes with a sibling temp file and directory fsync. */
  private async publishEvidenceFile(relativePath: string, bytes: Uint8Array): Promise<void> {
    const canonicalRoot = await canonicalizeRoot(this.emailRoot);
    const target = await assertSafePath(canonicalRoot, relativePath);
    const parentDir = resolve(target, "..");
    await ensureDurableDir(canonicalRoot, parentDir);

    try {
      const stat = await Deno.lstat(target);
      if (stat.isSymlink) {
        throw new EmailMailServiceError(
          EmailSubmissionDiagnosticCode.EVIDENCE_WRITE_FAILED,
          "Submission evidence path is a symlink",
        );
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw err;
      }
    }

    const tmpPath = join(parentDir, `.${basename(target)}.tmp-${crypto.randomUUID()}`);
    let file: Deno.FsFile | null = null;
    try {
      file = await Deno.open(tmpPath, { createNew: true, write: true, mode: 0o600 });
      if (Deno.build.os !== "windows") {
        await Deno.chmod(tmpPath, 0o600);
      }
      await writeAllBytes(file, bytes);
      await file.sync();
    } catch (err) {
      file?.close();
      file = null;
      await Deno.remove(tmpPath).catch(() => {});
      throw err instanceof EmailMailServiceError ? err : new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.EVIDENCE_WRITE_FAILED,
        "Failed to write durable submission evidence",
        { cause: String(err) },
      );
    } finally {
      file?.close();
    }

    try {
      await Deno.rename(tmpPath, target);
    } catch (err) {
      await Deno.remove(tmpPath).catch(() => {});
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.EVIDENCE_WRITE_FAILED,
        "Failed to publish durable submission evidence",
        { cause: String(err) },
      );
    }
    await syncDirectory(parentDir);
  }

  /** Read the persisted evidence bundle for an operation. */
  private async readEvidence(operationId: string): Promise<EvidenceBundle | undefined> {
    if (!OPERATION_ID_REGEX.test(operationId)) {
      return undefined;
    }
    const canonicalRoot = await canonicalizeRoot(this.emailRoot);

    let emlBytes: Uint8Array;
    try {
      const emlPath = await assertSafePath(canonicalRoot, outboundEvidenceRef(operationId));
      emlBytes = await Deno.readFile(emlPath);
    } catch {
      return undefined;
    }

    let meta: OutboundEvidenceMeta;
    try {
      const metaPath = await assertSafePath(canonicalRoot, outboundEvidenceMetaRef(operationId));
      const parsed = JSON.parse(await Deno.readTextFile(metaPath)) as OutboundEvidenceMeta;
      if (
        !parsed || parsed.v !== OUTBOUND_EVIDENCE_VERSION ||
        parsed.operationId !== operationId || typeof parsed.digest !== "string" ||
        typeof parsed.historyBody !== "string" || !parsed.envelope ||
        typeof parsed.envelope.from !== "string" || !Array.isArray(parsed.envelope.to)
      ) {
        return undefined;
      }
      meta = parsed;
    } catch {
      return undefined;
    }

    return { emlBytes, meta };
  }

  /**
   * Read evidence and require both the metadata digest and the actual bytes to match the
   * digest reserved in the journal for that operation.
   *
   * Recovery, history repair and sent-copy repair consume stored evidence without passing
   * through the journal's `markSubmitting` gate, so they must verify the bytes themselves:
   * otherwise a damaged or replaced `.eml` could be appended to the sent folder or rebuilt
   * into local history as though it were the accepted message.
   */
  private async readVerifiedEvidence(
    operationId: string,
    expectedDigest: string,
  ): Promise<EvidenceBundle | undefined> {
    const evidence = await this.readEvidence(operationId);
    if (!evidence) {
      return undefined;
    }
    if (evidence.meta.digest !== expectedDigest) {
      return undefined;
    }
    if (computeSha256Hex(evidence.emlBytes) !== expectedDigest) {
      return undefined;
    }
    return evidence;
  }

  /** Best-effort synchronous metadata read used by the synchronous `lookup`. */
  private readEvidenceMetaSync(operationId: string): OutboundEvidenceMeta | undefined {
    if (!OPERATION_ID_REGEX.test(operationId)) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(
        Deno.readTextFileSync(join(this.emailRoot, outboundEvidenceMetaRef(operationId))),
      ) as OutboundEvidenceMeta;
      return parsed?.operationId === operationId ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  // --- outcomes and recovery -------------------------------------------------------------

  private snapshotOutcome(
    snapshot: SubmissionEntrySnapshot,
    options: {
      reused: boolean;
      meta?: OutboundEvidenceMeta;
      phaseOverride?: EmailSendPhase;
      safeCodeOverride?: string;
    },
  ): EmailSendOutcome {
    const meta = options.meta ?? this.readEvidenceMetaSync(snapshot.operationId);
    let safeCode = options.safeCodeOverride ?? snapshot.safeCode ??
      NON_TERMINAL_SAFE_CODE[snapshot.phase];
    if (
      !options.safeCodeOverride && snapshot.phase === "submitted" && snapshot.sentCopy === "failed"
    ) {
      // A recorded sent-copy failure stays visible on every later repeated request.
      safeCode = EmailSubmissionDiagnosticCode.SENT_COPY_FAILED;
    }
    return {
      operationId: snapshot.operationId,
      phase: options.phaseOverride ?? snapshot.phase,
      targetKind: snapshot.targetKind,
      sentCopy: snapshot.sentCopy,
      safeCode,
      messageId: snapshot.wireMessageId ?? meta?.messageId,
      recordId: meta?.history?.recordId,
      reused: options.reused,
    };
  }

  /** Run the submission-store startup recovery exactly once per service instance. */
  private async ensureRecovered(): Promise<void> {
    if (!this.recoveryPromise) {
      this.recoveryPromise = this.runStoreRecovery();
    }
    await this.recoveryPromise;
  }

  private async runStoreRecovery(): Promise<void> {
    let result;
    try {
      result = await this.submissionStore.recover();
    } catch (err) {
      if (
        err instanceof SubmissionStoreError &&
        err.diagnosticCode === SubmissionDiagnosticCode.INVALID_TRANSITION
      ) {
        // Another instance in this process already replayed the journal. Sends stay safe
        // (lookup-based dedup and refusal of `submitting`), but repair enumeration is gone.
        logger.warn(
          "Submission journal was already recovered in this process; " +
            "history and sent-copy repair enumeration is unavailable",
        );
        this.recoveryUnavailable = true;
        return;
      }
      throw err;
    }

    this.unknownRecovered = result.unknownRecovered.map((entry) => entry.operationId);
    for (const entry of result.entries.values()) {
      this.track(entry.ownerId, entry.key);
    }
  }

  private track(owner: string, key: EmailOperationKey): void {
    this.tracked.set(formatOwnerOperationKey(owner, key), { owner, key: { ...key } });
  }

  // --- guards -----------------------------------------------------------------------------

  /** Validate the draft envelope fields the service itself depends on. */
  private assertDraftShape(draft: EmailDraft): string {
    if (
      !draft || typeof draft !== "object" || !draft.owner || typeof draft.owner !== "string" ||
      draft.owner.trim() === ""
    ) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.INVALID_DRAFT,
        "Email draft requires a non-empty owner",
      );
    }
    if (!draft.to || typeof draft.to !== "string" || draft.to.trim() === "") {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.INVALID_DRAFT,
        "Email draft requires a single explicit recipient",
      );
    }
    if (draft.targetKind !== "user" && draft.targetKind !== "third-party") {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.INVALID_DRAFT,
        "Email draft targetKind must be 'user' or 'third-party'",
      );
    }
    return draft.owner;
  }

  /**
   * Enforce the current allowlist for initiating-user recipients.
   *
   * Third-party destinations are authorized by the owning compose/forward handler (row 19),
   * which is not re-implemented here.
   *
   * A partitioned `spontaneous:<tickId>` operation additionally requires the account to be
   * CURRENTLY opted into spontaneous posting: an autonomous send must never reach an account
   * that was opted out, disabled or removed after its target was chosen. This runs both before
   * the operation is reserved and immediately before SMTP (including a resumed prepared
   * operation), so the requirement cannot be satisfied by a stale decision.
   */
  private assertRecipientAuthorized(
    targetKind: "user" | "third-party",
    to: string,
    actionSlot?: string,
  ): void {
    if (targetKind !== "user") {
      return;
    }
    const userId = normalizeEmailMailbox(to).userId;
    if (!isSenderAllowed(userId, this.channels)) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.RECIPIENT_NOT_ALLOWED,
        "Recipient is not present in the current email allowlist",
      );
    }
    if (
      typeof actionSlot === "string" && actionSlot.startsWith(SPONTANEOUS_ACTION_SLOT_PREFIX) &&
      !isSpontaneousTargetAllowed(userId, this.channels)
    ) {
      throw new EmailMailServiceError(
        EmailSubmissionDiagnosticCode.RECIPIENT_NOT_ALLOWED,
        "Recipient account is no longer opted into spontaneous posting",
      );
    }
  }

  /**
   * Serialize one logical operation across every service instance in this process.
   *
   * The lock entry is dropped once its queue drains so a long-lived process does not retain
   * one promise per operation ever attempted.
   */
  private async withKeyLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const previous = OPERATION_LOCKS.get(lockKey) ?? Promise.resolve();
    const { promise: current, resolve: release } = Promise.withResolvers<void>();
    const tail = previous.then(() => current);
    OPERATION_LOCKS.set(lockKey, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (OPERATION_LOCKS.get(lockKey) === tail) {
        OPERATION_LOCKS.delete(lockKey);
      }
    }
  }

  private async withCopyLane<T>(fn: () => Promise<T>): Promise<T> {
    const previous = COPY_LANES.get(this.imap) ?? Promise.resolve();
    const { promise, resolve: release } = Promise.withResolvers<void>();
    const tail = previous.then(() => promise);
    COPY_LANES.set(this.imap, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (COPY_LANES.get(this.imap) === tail) {
        COPY_LANES.delete(this.imap);
      }
    }
  }
}
