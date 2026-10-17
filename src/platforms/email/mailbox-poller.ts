// src/platforms/email/mailbox-poller.ts
//
// Serialized IMAP poll-cycle orchestrator owned by `email-poll-recovery`.
//
// Contract (design `Receiving pipeline / crash recovery`, row 10):
// - Transport reports, store decides: the poller never invents durable state; it drives the
//   mailbox journal (discovery/acceptance/terminal transitions) and honours its invariants.
// - `listAfter(cursor)` -> durable `discover()` before any effect -> fetch -> parse -> authenticate
//   -> on admit store source then `accept()` then hand off accepted work -> advance checkpoint
//   ONLY after the durable store and acceptance.
// - Per-message failures are isolated: a malformed or deterministically unavailable message
//   becomes terminal without blocking later UIDs; connection failures abort the round with the
//   checkpoint unchanged.
// - `recover()` is startup-only: accepted/unstarted work is resumed (and retried across rounds
//   after a transient failure); work whose agent outcome is uncertain is quarantined as
//   review-required by the mailbox journal.
// - A changed UIDVALIDITY reconciles against durable message AND processing evidence and NEVER
//   replays the mailbox; ambiguity stops automatic work and is reported for manual review.
// - Rounds never overlap; the interval excludes server/agent latency; the timer reconnect is
//   IMAP-only (never SMTP retry).
//
// This module is intentionally NOT registered in production bootstrap; email activation remains
// guarded until the final batch cutover. Tests exercise the real implementation with the local
// IMAP fixture and real predecessor stores.

import { createLogger } from "@utils/logger.ts";
import type { ChannelConfig, EmailConfig } from "../../types/config.ts";
import {
  MailboxDiagnosticCode,
  MailboxEntrySnapshot,
  MailboxKey,
  MailboxRecoveryResult,
  MailboxStore,
  MailboxStoreError,
} from "./mailbox-store.ts";
import { EmailMessageStore, EmailProvenance } from "./message-store.ts";
import {
  IncomingMimeError,
  ParsedEmail,
  parseIncomingMime,
  toMessageStoreParsedEmail,
} from "./incoming-mime.ts";
import {
  AdmissionReason,
  authenticateInbound,
  InboundAuthReceiverConfig,
  VerifiedSender,
} from "./incoming-auth.ts";
import {
  ImapDiagnosticCode,
  ImapMessage,
  ImapTransport,
  ImapTransportError,
} from "./imap-client.ts";

const logger = createLogger("EmailMailboxPoller");

/** Default poll interval (300 seconds) excluding server/agent latency. */
export const DEFAULT_POLL_INTERVAL_MS = 300_000;

/** Bounded sequential UID batch size (matches the transport contract). */
export const POLL_BATCH_LIMIT = 50;

/** Default bound for a single reconciliation thread-history scan. */
const RECONCILE_HISTORY_LIMIT = 500;

/**
 * Deterministic per-message transport failures that never warrant a retry: the message is
 * oversized on the wire or the server cannot return it. Connection-level failures are excluded so
 * they still abort the round and preserve the checkpoint.
 */
const DETERMINISTIC_TRANSPORT_CODES: Partial<Record<ImapDiagnosticCode, true>> = {
  [ImapDiagnosticCode.MESSAGE_TOO_LARGE]: true,
  [ImapDiagnosticCode.SIZE_PREFLIGHT_EXCEEDED]: true,
  [ImapDiagnosticCode.LITERAL_TOO_LARGE]: true,
};

/**
 * Accepted inbound work handed to downstream consumers (rows 14/15).
 * Carries only opaque identifiers and safe metadata, never message bodies.
 */
export interface IncomingWork {
  /** Unique id for this work item; row 14 records it as the journal `started` receipt. */
  workId: string;
  /** Durable mailbox identity of the source UID. */
  mailboxKey: MailboxKey;
  /** Owner userId (`e_<sha256>`), equal to `verifiedSender.userId`. */
  owner: string;
  /** Thread id resolved by the message store. */
  threadId: string;
  /** Durable message record id produced by `EmailMessageStore.putSource`. */
  recordId: string;
  /** Authenticated sender binding produced by `authenticateInbound`. */
  verifiedSender: VerifiedSender;
  /** Provenance breakdown of the parsed inbound message. */
  provenance: EmailProvenance;
}

/** Item reported to the operator when automatic work is stopped. */
export interface ReviewItem {
  mailboxKey: MailboxKey;
  /** Safe reason code (no message content, credentials, or header values). */
  reason: string;
  recordId?: string;
}

/** Aggregated outcome of a single poll round. */
export interface PollCycleResult {
  /** UIDVALIDITY observed this round (0 when never connected). */
  uidValidity: number;
  /** Durable scan cursor after the round. */
  cursor: number;
  discovered: number;
  accepted: number;
  ignored: number;
  failed: number;
  reviewRequired: number;
  /** True when a changed UIDVALIDITY was detected and automatic work was stopped. */
  replacementDetected: boolean;
  /** True when the round stopped early (transport error, replacement, first activation, stop). */
  halted: boolean;
  /** Safe diagnostic code when the round was aborted by an error. */
  error?: string;
}

/** Options for constructing an {@link EmailMailboxPoller}. */
export interface EmailMailboxPollerOptions {
  /** Email platform config: folder, interval, size/attachment limits and receiving-auth trust. */
  config: EmailConfig;
  /** IMAP transport (production: `EmailImapClient`; tests: the local fixture-backed client). */
  transport: ImapTransport;
  /** Durable mailbox journal; its fingerprint MUST match the configured mailbox identity. */
  mailboxStore: MailboxStore;
  /** Already replayed startup journal; never replay a live store twice. */
  mailboxRecovery?: MailboxRecoveryResult;
  /** Owner-scoped message history store. */
  messageStore: EmailMessageStore;
  /** Configured channels provide the sender allowlist. */
  channels: ChannelConfig[];
  /** Hand-off for accepted work. Downstream errors MUST NOT block durable progress. */
  emit: (work: IncomingWork) => void | Promise<void>;
  /** Reports entries requiring operator review (replacement ambiguity, resume failures). */
  onReviewRequired?: (item: ReviewItem) => void | Promise<void>;
  /** Reports an aborted round's safe diagnostic code. */
  onCycleError?: (code: string) => void | Promise<void>;
  /** Override the bounded UID batch size (defaults to {@link POLL_BATCH_LIMIT}). */
  batchLimit?: number;
  /** Override the bounded reconciliation history scan size. */
  historyLimit?: number;
  /** Injectable work-id factory (defaults to `crypto.randomUUID`). */
  workIdFactory?: () => string;
}

/** Terminal outcome of processing a single UID. */
type TerminalOutcome = "ignored" | "failed" | "review-required";
type MessageOutcome = TerminalOutcome | "accepted";

/**
 * Serialized IMAP poll-cycle orchestrator.
 *
 * Wire-up is deliberately manual: no production bootstrap registers this class until the
 * activation change removes the config guard.
 */
export class EmailMailboxPoller {
  private readonly config: EmailConfig;
  private readonly transport: ImapTransport;
  private readonly mailboxStore: MailboxStore;
  private readonly messageStore: EmailMessageStore;
  private readonly channels: ChannelConfig[];
  private readonly emit: (work: IncomingWork) => void | Promise<void>;
  private readonly onReviewRequired?: (item: ReviewItem) => void | Promise<void>;
  private readonly onCycleError?: (code: string) => void | Promise<void>;
  private readonly batchLimit: number;
  private readonly historyLimit: number;
  private readonly workIdFactory: () => string;
  private readonly initialRecovery?: MailboxRecoveryResult;

  private readonly folder: string;
  private readonly fingerprint: string;
  private readonly maxMessageBytes: number;
  private readonly maxIncomingAttachments: number;
  private readonly receiverConfig: InboundAuthReceiverConfig;

  private recovery: MailboxRecoveryResult | null = null;
  private recoveryInFlight: Promise<MailboxRecoveryResult> | null = null;
  private pendingAccepted: MailboxEntrySnapshot[] = [];
  private discoveredFromRecovery: MailboxKey[] = [];
  private boundSourceRecordIds = new Set<string>();

  private inFlight: Promise<PollCycleResult> | null = null;
  private lastLifecycle: Promise<unknown> = Promise.resolve();
  private lock: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: EmailMailboxPollerOptions) {
    this.config = options.config;
    this.transport = options.transport;
    this.mailboxStore = options.mailboxStore;
    this.initialRecovery = options.mailboxRecovery;
    this.messageStore = options.messageStore;
    this.channels = options.channels;
    this.emit = options.emit;
    this.onReviewRequired = options.onReviewRequired;
    this.onCycleError = options.onCycleError;
    this.batchLimit = options.batchLimit ?? POLL_BATCH_LIMIT;
    this.historyLimit = options.historyLimit ?? RECONCILE_HISTORY_LIMIT;
    this.workIdFactory = options.workIdFactory ?? (() => crypto.randomUUID().toLowerCase());
    this.folder = options.config.incomingFolder;
    this.maxMessageBytes = options.config.maxMessageBytes;
    this.maxIncomingAttachments = options.config.maxIncomingAttachments;
    this.receiverConfig = {
      authservId: options.config.receivingAuth.authservId,
      attestedStripping: options.config.receivingAuth.attestedStripping,
      ownAddress: options.config.address,
    };

    // The store already owns the configured fingerprint; keys built against a different
    // fingerprint would be rejected by the store's own key validation.
    this.fingerprint = options.mailboxStore.configuredFingerprint;
  }

  /**
   * Startup recovery: reads durable evidence once, reports quarantined entries, and resumes
   * accepted-but-unstarted work (re-emitting it). Safe to call repeatedly: the journal recovery
   * happens once and the resume attempt retries pending entries.
   */
  recover(): Promise<MailboxRecoveryResult> {
    return this.track((async () => {
      const release = await this.acquire();
      try {
        await this.transport.connect();
        try {
          const position = await this.transport.position(this.folder);
          const result = await this.ensureRecovered();
          await this.resumePending(position.uidValidity);
          return result;
        } finally {
          await this.disconnectQuietly();
        }
      } finally {
        release();
      }
    })());
  }

  /**
   * Runs one poll round. Rounds never overlap: concurrent callers share the in-flight round and a
   * round never interleaves with startup recovery. After `stop()` no new work is accepted.
   */
  poll(): Promise<PollCycleResult> {
    if (this.inFlight) return this.inFlight;
    if (this.stopped) {
      return Promise.resolve(this.haltedResult(this.mailboxStore.getSnapshot()?.cursor ?? 0));
    }
    const run = this.track((async () => {
      const release = await this.acquire();
      try {
        return await this.runCycle();
      } finally {
        release();
      }
    })()).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /**
   * Recovers, then polls on a self-scheduling timer. The next poll is scheduled only after the
   * current round settles, so the configured interval excludes server/agent latency.
   */
  async start(): Promise<void> {
    this.stopped = false;
    await this.recover();
    if (this.stopped) return;
    await this.scheduleNext();
  }

  /**
   * Stops accepting new work, waits for the in-flight round (and startup recovery) to settle, and
   * disconnects.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      await this.lastLifecycle;
    } catch {
      // Round errors are surfaced through the round result, never thrown to stop().
    }
    await this.disconnectQuietly();
  }

  private async scheduleNext(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.poll();
    } catch {
      // poll() always resolves; this is defensive only.
    }
    if (this.stopped) return;
    const interval = this.config.pollIntervalMs > 0
      ? this.config.pollIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;
    this.timer = setTimeout(() => {
      void this.scheduleNext();
    }, interval);
  }

  /** Runs `fn` under the lifecycle lock so recovery and polling never interleave. */
  private async acquire(): Promise<() => void> {
    let release!: () => void;
    const ticket = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.lock;
    this.lock = prev.then(() => ticket, () => ticket);
    await prev;
    return release;
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.lastLifecycle = promise.catch(() => undefined);
    return promise;
  }

  /** Reads durable evidence exactly once and records the entries it classifies. */
  private ensureRecovered(): Promise<MailboxRecoveryResult> {
    if (this.recovery) return Promise.resolve(this.recovery);
    if (this.recoveryInFlight) return this.recoveryInFlight;
    const run = (async () => {
      const result = this.initialRecovery ?? await this.mailboxStore.recover();
      this.recovery = result;
      this.pendingAccepted = result.unstarted.map((entry) => ({
        ...entry,
        key: { ...entry.key },
      }));
      this.discoveredFromRecovery = [...result.entries.values()]
        .filter((entry) => entry.state === "discovered")
        .map((entry) => ({ ...entry.key }));
      this.boundSourceRecordIds = new Set(
        [...result.entries.values()]
          .filter((entry) => entry.state !== "discovered" && entry.sourceRecordId !== undefined)
          .map((entry) => entry.sourceRecordId!),
      );
      for (const entry of result.reviewRequired) {
        await this.notifyReview({
          mailboxKey: entry.key,
          reason: entry.detail ?? "started-without-terminal-outcome",
        });
      }
      return result;
    })().finally(() => {
      this.recoveryInFlight = null;
    });
    this.recoveryInFlight = run;
    return run;
  }

  /**
   * Re-emits accepted-but-unstarted work, retrying transient failures on later rounds. Only
   * accepted/unstarted work is resumed; started or unknown work was already quarantined by the
   * mailbox journal during recovery.
   */
  private async resumePending(serverUidValidity?: number): Promise<void> {
    if (this.pendingAccepted.length === 0) return;
    const remaining: MailboxEntrySnapshot[] = [];

    for (const entry of this.pendingAccepted) {
      if (this.stopped) {
        remaining.push(entry);
        continue;
      }
      const current = this.mailboxStore.getEntry(entry.key);
      if (!current || current.state !== "accepted") continue; // settled elsewhere
      if (!entry.sourceRecordId) {
        await this.reviewAndTerminalize(entry.key, "resume-missing-source-record");
        continue;
      }
      if (serverUidValidity !== undefined && entry.key.uidValidity !== serverUidValidity) {
        // UIDs are only meaningful within one UIDVALIDITY; a replaced mailbox needs review.
        await this.reviewAndTerminalize(entry.key, "resume-mailbox-replaced", entry.sourceRecordId);
        continue;
      }
      try {
        const message = await this.transport.fetchSource(entry.key.uid, {
          folder: this.folder,
          maxBytes: this.maxMessageBytes,
        });
        const raw = await message.bytes();
        const parsed = await this.parse(raw, message.size, entry.key);
        const decision = authenticateInbound(
          parsed,
          extractHeaderBlock(raw),
          this.receiverConfig,
          this.channels,
        );
        if (!decision.admitted) {
          await this.reviewAndTerminalize(
            entry.key,
            `resume-not-admitted:${decision.reason}`,
            entry.sourceRecordId,
          );
          continue;
        }
        const owner = decision.verifiedSender.userId;
        const record = await this.messageStore.getByOwnerRecord(owner, entry.sourceRecordId);
        if (!record) {
          await this.reviewAndTerminalize(
            entry.key,
            "resume-source-record-missing",
            entry.sourceRecordId,
          );
          continue;
        }
        await this.handoff({
          workId: this.workIdFactory(),
          mailboxKey: entry.key,
          owner,
          threadId: record.threadId,
          recordId: entry.sourceRecordId,
          verifiedSender: decision.verifiedSender,
          provenance: parsed.provenance,
        });
      } catch (err) {
        if (await this.isTransientAcquisitionFailure(err, entry.key.uid)) {
          remaining.push(entry); // retry on a later round
        } else {
          await this.reviewAndTerminalize(
            entry.key,
            `resume-failed:${safeErrorCode(err)}`,
            entry.sourceRecordId,
          );
        }
      }
    }

    this.pendingAccepted = remaining;
  }

  /** One full round: connect, observe position, resume pending, scan or reconcile, disconnect. */
  private async runCycle(): Promise<PollCycleResult> {
    const result = this.haltedResult(0);
    result.halted = false;

    try {
      await this.transport.connect();
      const position = await this.transport.position(this.folder);
      result.uidValidity = position.uidValidity;
      await this.ensureRecovered();
      await this.resumePending(position.uidValidity);
      if (this.stopped) return this.haltedResult(this.mailboxStore.getSnapshot()?.cursor ?? 0);

      const snapshot = this.mailboxStore.getSnapshot();
      if (snapshot === null) {
        // First activation: persist the current boundary and exclude preexisting messages.
        const boundary = position.uidNext - 1;
        await this.mailboxStore.initialize(boundary, position.uidValidity);
        result.cursor = boundary;
        result.halted = true;
        return result;
      }

      if (snapshot.uidValidity !== position.uidValidity) {
        // Mailbox replacement: reconcile against durable evidence; never replay the mailbox.
        result.replacementDetected = true;
        await this.reconcileReplacement(position.uidValidity, result);
        result.cursor = snapshot.cursor;
        result.halted = true;
        return result;
      }

      result.cursor = snapshot.cursor;
      await this.scan(snapshot.uidValidity, result);
      return result;
    } catch (err) {
      result.halted = true;
      result.error = safeErrorCode(err);
      result.cursor = this.mailboxStore.getSnapshot()?.cursor ?? result.cursor;
      logger.warn("Email poll round aborted: {Code}", { Code: result.error });
      if (this.onCycleError) {
        try {
          await this.onCycleError(result.error);
        } catch {
          // Never let reporting failure mask the round outcome.
        }
      }
      return result;
    } finally {
      await this.disconnectQuietly();
    }
  }

  /**
   * Scans durable UIDs after the cursor in bounded batches. Each UID is durably discovered before
   * any effect, then processed with per-message isolation, then checkpointed. Entries already
   * covered by the journal (accepted/started/terminal) are never reprocessed.
   */
  private async scan(uidValidity: number, result: PollCycleResult): Promise<void> {
    let cursor = this.mailboxStore.getSnapshot()?.cursor ?? 0;

    while (true) {
      if (this.stopped) return;
      const uids = await this.transport.listAfter(cursor, {
        folder: this.folder,
        limit: this.batchLimit,
      });
      if (uids.length === 0) return;

      for (const uid of uids) {
        if (this.stopped) return;
        const key: MailboxKey = { fingerprint: this.fingerprint, uidValidity, uid };
        const existing = this.mailboxStore.getEntry(key);
        if (existing && existing.state !== "discovered") {
          // A crash before checkpointing, or work already resumed, is durably covered.
          cursor = uid;
          await this.checkpointOrResolve(uid, result);
          continue;
        }

        await this.mailboxStore.discover(key);
        result.discovered++;
        const outcome = await this.processOne(key);
        this.tally(result, outcome);
        cursor = uid;
        await this.checkpointOrResolve(uid, result);
      }
    }
  }

  /** Advances the checkpoint, first terminalizing durable discoveries no longer returned by SEARCH. */
  private async checkpointOrResolve(uid: number, result: PollCycleResult): Promise<void> {
    try {
      await this.mailboxStore.checkpoint(uid);
      result.cursor = uid;
      return;
    } catch (err) {
      if (
        !(err instanceof MailboxStoreError) ||
        err.diagnosticCode !== MailboxDiagnosticCode.CHECKPOINT_SKIPS_DISCOVERED
      ) {
        throw err;
      }
    }

    // A discovered entry below the target and absent from this round's SEARCH results has been
    // expunged; terminalize it durably so later progress is never blocked.
    const offenders = this.discoveredFromRecovery.filter((key) => key.uid <= uid);
    for (const key of offenders) {
      if (this.mailboxStore.getEntry(key)?.state === "discovered") {
        await this.mailboxStore.finish(key, "failed", { detail: "transport:expunged" });
        result.failed++;
      }
    }

    await this.mailboxStore.checkpoint(uid);
    result.cursor = uid;
  }

  private async processOne(key: MailboxKey): Promise<MessageOutcome> {
    try {
      return await this.processMessage(key);
    } catch (err) {
      if (err instanceof ImapTransportError) throw err; // connection-level: abort the round
      await this.mailboxStore.finish(key, "review-required", {
        detail: `unexpected:${safeErrorCode(err)}`,
      });
      await this.notifyReview({
        mailboxKey: key,
        reason: `unexpected:${safeErrorCode(err)}`,
      });
      return "review-required";
    }
  }

  /** Fetches, parses, authenticates and durably records a single UID. */
  private async processMessage(key: MailboxKey): Promise<MessageOutcome> {
    let raw: Uint8Array;
    let declaredSize: number;
    try {
      const message: ImapMessage = await this.transport.fetchSource(key.uid, {
        folder: this.folder,
        maxBytes: this.maxMessageBytes,
      });
      declaredSize = message.size;
      raw = await message.bytes();
    } catch (err) {
      const detail = await this.deterministicAcquisitionFailure(err, key.uid);
      if (detail !== null) {
        await this.mailboxStore.finish(key, "failed", { detail });
        return "failed";
      }
      throw err;
    }

    let parsed: ParsedEmail;
    try {
      parsed = await this.parse(raw, declaredSize, key);
    } catch (err) {
      // Malformed or over-limit messages are terminal and never block later UIDs.
      const code = err instanceof IncomingMimeError
        ? `parser:${err.diagnosticCode}`
        : `parser:${safeErrorCode(err)}`;
      await this.mailboxStore.finish(key, "failed", { detail: code });
      return "failed";
    }

    const decision = authenticateInbound(
      parsed,
      extractHeaderBlock(raw),
      this.receiverConfig,
      this.channels,
    );

    if (decision.status === "ignore") {
      await this.mailboxStore.finish(key, "ignored", { detail: decision.reason });
      return "ignored";
    }

    if (decision.status === "reject") {
      const state = classifyRejection(decision.reason);
      await this.mailboxStore.finish(key, state, { detail: decision.reason });
      if (state === "review-required") {
        await this.notifyReview({ mailboxKey: key, reason: decision.reason });
      }
      return state;
    }

    const owner = decision.verifiedSender.userId;
    const recordId = await this.messageStore.putSource(
      owner,
      raw,
      toMessageStoreParsedEmail(parsed),
    );
    const record = await this.messageStore.getByOwnerRecord(owner, recordId);
    if (!record) {
      // The store accepted the write but the record is unreadable; stop automatic work.
      await this.reviewAndTerminalize(key, "stored-record-missing", recordId);
      return "review-required";
    }

    if (record.reviewRequired) {
      // Parser/thread ambiguity (e.g. duplicate wire Message-ID): never auto-start a session.
      // Only a fixed safe code is emitted; the detailed explanation stays owner-scoped.
      await this.reviewAndTerminalize(key, "thread-ambiguity", recordId);
      return "review-required";
    }

    await this.mailboxStore.accept(key, recordId);
    await this.handoff({
      workId: this.workIdFactory(),
      mailboxKey: key,
      owner,
      threadId: record.threadId,
      recordId,
      verifiedSender: decision.verifiedSender,
      provenance: parsed.provenance,
    });
    return "accepted";
  }

  /**
   * Changed-UIDVALIDITY reconciliation. Classifies every message of the replacement mailbox
   * against durable message and processing evidence without admitting, emitting, or advancing the
   * checkpoint.
   */
  private async reconcileReplacement(
    uidValidity: number,
    result: PollCycleResult,
  ): Promise<void> {
    let uidSince = 0;
    while (true) {
      if (this.stopped) return;
      const uids = await this.transport.listAfter(uidSince, {
        folder: this.folder,
        limit: this.batchLimit,
      });
      if (uids.length === 0) return;

      for (const uid of uids) {
        if (this.stopped) return;
        const key: MailboxKey = { fingerprint: this.fingerprint, uidValidity, uid };
        let review: string | null;
        try {
          review = await this.classifyReplacementMessage(key);
        } catch (err) {
          if (err instanceof ImapTransportError) {
            const detail = await this.deterministicAcquisitionFailure(err, uid);
            if (detail === null) throw err; // connection-level: abort reconciliation
            review = "replacement-unreadable-message";
          } else {
            review = `reconcile-failed:${safeErrorCode(err)}`;
          }
        }
        if (review !== null) {
          result.reviewRequired++;
          await this.notifyReview({ mailboxKey: key, reason: review });
        }
      }

      uidSince = uids[uids.length - 1];
    }
  }

  /**
   * Returns `null` when the new-UID message is provably not new work (matching durable evidence
   * and processing binding, or non-admittable), otherwise a safe review reason.
   */
  private async classifyReplacementMessage(key: MailboxKey): Promise<string | null> {
    const message: ImapMessage = await this.transport.fetchSource(key.uid, {
      folder: this.folder,
      maxBytes: this.maxMessageBytes,
    });
    const raw = await message.bytes();

    let parsed: ParsedEmail;
    try {
      parsed = await this.parse(raw, message.size, key);
    } catch {
      return "replacement-unreadable-message";
    }

    const decision = authenticateInbound(
      parsed,
      extractHeaderBlock(raw),
      this.receiverConfig,
      this.channels,
    );
    if (!decision.admitted) {
      // Not admittable work regardless of mailbox identity: not a replay concern.
      return null;
    }

    const wireMessageId = parsed.wireIds.messageId;
    if (!wireMessageId) {
      return "replacement-unmatched";
    }

    const owner = decision.verifiedSender.userId;
    // The message store derives threads from In-Reply-To/References, so the owning thread of a
    // wire Message-ID is looked up read-only by presenting that id as a reference.
    const resolution = await this.messageStore.resolveThread(owner, {
      references: [wireMessageId],
    });
    if (resolution.matchedWireIds.length === 0) {
      return "replacement-unmatched";
    }
    if (resolution.reviewRequired) {
      return "replacement-ambiguous";
    }

    const priorRecords = (await this.messageStore.history(
      owner,
      resolution.threadId,
      this.historyLimit,
    )).filter((record) => record.wireMessageId === wireMessageId);
    if (priorRecords.length !== 1) {
      return "replacement-ambiguous";
    }

    const previous = priorRecords[0];
    // Source storage alone is not processing evidence: the record must be bound to a durable
    // acceptance/terminal receipt, otherwise the crash left the work unprocessed.
    if (!this.boundSourceRecordIds.has(previous.recordId)) {
      return "replacement-unaccepted-source";
    }

    const storedBytes = await this.messageStore.getSourceBytes(owner, previous.recordId);
    if (!storedBytes) {
      return "replacement-unaccepted-source";
    }

    // Identical durable source: provably not new work. Conflicting identifiers: review.
    const [newDigest, storedDigest] = await Promise.all([
      sha256Hex(raw),
      sha256Hex(storedBytes),
    ]);
    return newDigest === storedDigest ? null : "replacement-conflicting-identifiers";
  }

  private parse(raw: Uint8Array, declaredSize: number, key: MailboxKey): Promise<ParsedEmail> {
    return parseIncomingMime(raw, {
      maxMessageBytes: this.maxMessageBytes,
      maxIncomingAttachments: this.maxIncomingAttachments,
      declaredSize,
      sourceRef: `imap:${key.uidValidity}:${key.uid}`,
    });
  }

  /**
   * Returns a safe terminal detail when the acquisition failure is deterministic for this UID
   * (oversized on the wire, or positively confirmed absent), or `null` when it is transient or
   * connection-level and the round should be retried.
   */
  private async deterministicAcquisitionFailure(
    err: unknown,
    uid: number,
  ): Promise<string | null> {
    if (!(err instanceof ImapTransportError)) return null;
    if (DETERMINISTIC_TRANSPORT_CODES[err.diagnosticCode]) {
      return `transport:${err.diagnosticCode}`;
    }
    if (err.diagnosticCode === ImapDiagnosticCode.PROTOCOL_ERROR) {
      return await this.uidPresent(uid) ? null : "transport:expunged";
    }
    return null;
  }

  private async isTransientAcquisitionFailure(err: unknown, uid: number): Promise<boolean> {
    return (await this.deterministicAcquisitionFailure(err, uid)) === null;
  }

  /** Positively establishes whether a UID still exists in the selected folder. */
  private async uidPresent(uid: number): Promise<boolean> {
    const uids = await this.transport.listAfter(Math.max(0, uid - 1), {
      folder: this.folder,
      limit: 1,
    });
    return uids.includes(uid);
  }

  /** Durably records a review-required terminal state and reports it to the operator. */
  private async reviewAndTerminalize(
    key: MailboxKey,
    reason: string,
    recordId?: string,
  ): Promise<void> {
    const current = this.mailboxStore.getEntry(key);
    if (current && current.state !== "discovered" && current.state !== "accepted") {
      return; // already terminal; nothing to change
    }
    await this.mailboxStore.finish(key, "review-required", { detail: reason });
    await this.notifyReview({ mailboxKey: key, reason, recordId });
  }

  /** Emits accepted work without ever letting a downstream error roll back durable progress. */
  private async handoff(work: IncomingWork): Promise<void> {
    try {
      await this.emit(work);
    } catch (err) {
      logger.warn("Email work hand-off failed; durable acceptance preserved: {Code}", {
        Code: safeErrorCode(err),
      });
    }
  }

  private tally(result: PollCycleResult, outcome: MessageOutcome): void {
    switch (outcome) {
      case "accepted":
        result.accepted++;
        break;
      case "ignored":
        result.ignored++;
        break;
      case "failed":
        result.failed++;
        break;
      case "review-required":
        result.reviewRequired++;
        break;
    }
  }

  private async notifyReview(item: ReviewItem): Promise<void> {
    if (!this.onReviewRequired) return;
    try {
      await this.onReviewRequired(item);
    } catch (err) {
      logger.warn("Email review report failed: {Code}", { Code: safeErrorCode(err) });
    }
  }

  private async disconnectQuietly(): Promise<void> {
    try {
      await this.transport.disconnect();
    } catch {
      // Disconnect is best-effort; a stale socket is reclaimed by the transport on reconnect.
    }
  }

  private haltedResult(cursor: number): PollCycleResult {
    return {
      uidValidity: 0,
      cursor,
      discovered: 0,
      accepted: 0,
      ignored: 0,
      failed: 0,
      reviewRequired: 0,
      replacementDetected: false,
      halted: true,
    };
  }
}

/**
 * Maps an authoritative authentication rejection to a processing state.
 *
 * - Receiver-side trust/ambiguity problems (unattested stripping, missing/duplicate DMARC or
 *   authserv results) stop automatic work and require operator review.
 * - Unauthorized senders are silently ignored (no session, no reply).
 * - Spoof/malformed messages are terminal failures.
 */
function classifyRejection(reason: AdmissionReason): TerminalOutcome {
  switch (reason) {
    case AdmissionReason.REJECTED_SENDER_NOT_ALLOWED:
      return "ignored";
    case AdmissionReason.REJECTED_UNATTESTED_STRIPPING:
    case AdmissionReason.REJECTED_MISSING_AUTH_RESULTS:
    case AdmissionReason.REJECTED_MULTIPLE_AUTHSERV_RESULTS:
    case AdmissionReason.REJECTED_MISSING_DMARC:
    case AdmissionReason.REJECTED_MULTIPLE_DMARC_RESULTS:
      return "review-required";
    default:
      return "failed";
  }
}

/** Extracts the RFC 5322 header block (up to the first blank line) from raw message bytes. */
function extractHeaderBlock(raw: Uint8Array): string {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== 0x0a) continue;
    if (i + 1 < raw.length && raw[i + 1] === 0x0a) {
      return decoder.decode(raw.subarray(0, i + 1));
    }
    if (
      i + 3 < raw.length && raw[i + 1] === 0x0d && raw[i + 2] === 0x0a && raw[i + 3] === 0x0a
    ) {
      return decoder.decode(raw.subarray(0, i + 2));
    }
  }
  return decoder.decode(raw);
}

/** Hex-encoded SHA-256 digest used for durable source comparison. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Safe error code for logs/review reasons; never returns message content or credentials. */
function safeErrorCode(err: unknown): string {
  if (err instanceof ImapTransportError) return err.diagnosticCode;
  if (err instanceof IncomingMimeError) return err.diagnosticCode;
  if (err instanceof MailboxStoreError) return err.diagnosticCode;
  if (err && typeof err === "object") {
    const candidate = (err as Record<string, unknown>).diagnosticCode;
    if (typeof candidate === "string") return candidate;
    const code = (err as Record<string, unknown>).code;
    if (typeof code === "string") return code;
    if (err instanceof Error) return err.name || "Error";
  }
  return "UnknownError";
}
