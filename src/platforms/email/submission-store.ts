// src/platforms/email/submission-store.ts
//
// Durable email submission operations journal and lifecycle state machine.
// Owned by `email-submission-journal`.
// Backed by crash-safe durable primitives in `durable-files.ts`.

import { BaseError, ErrorCode } from "../../types/errors.ts";
import { createLogger } from "@utils/logger.ts";
import type { EmailSubmissionPhase } from "../../types/platform.ts";
import {
  appendDurable,
  assertSafePath,
  canonicalizeRoot,
  DurableDiagnosticCode,
  DurableFileOptions,
  readJournal,
} from "./durable-files.ts";

const logger = createLogger("EmailSubmissionStore");

/**
 * Journal filename relative to the email state root (e.g. `data/email/submissions.jsonl`).
 */
export const SUBMISSIONS_JOURNAL_FILENAME = "submissions.jsonl";

/**
 * Standard action slot categories for outbound email operations.
 */
export type EmailActionSlot =
  | "reply"
  | "files"
  | `third-party:${string}`
  | `reminder:${string}`
  | `spontaneous:${string}`;

/**
 * Stable logical operation reservation key.
 * - workId: globally unique session/work execution identifier
 * - actionSlot: typed action category or partitioned slot
 */
export interface EmailOperationKey {
  workId: string;
  actionSlot: EmailActionSlot | string;
}

/**
 * Lifecycle phase of an outbound email operation.
 */
export type SubmissionPhase = EmailSubmissionPhase;

/**
 * Status of appending constructed MIME bytes to the remote IMAP Sent folder.
 */
export type SentCopyStatus = "pending" | "appended" | "failed";

/**
 * Recipient classification for authorized sending.
 */
export type TargetKind = "user" | "third-party";

/**
 * Diagnostic codes for submission store operations and integrity checks.
 * Safe enums that describe errors without disclosing private mail content or credentials.
 */
export enum SubmissionDiagnosticCode {
  CLEAN = "CLEAN",
  INVALID_KEY = "INVALID_KEY",
  INVALID_OWNER = "INVALID_OWNER",
  INVALID_DIGEST = "INVALID_DIGEST",
  INVALID_EML_REF = "INVALID_EML_REF",
  INVALID_TRANSITION = "INVALID_TRANSITION",
  KEY_PAYLOAD_CONFLICT = "KEY_PAYLOAD_CONFLICT",
  STORE_CORRUPT = "STORE_CORRUPT",
  STORE_CLOSED = "STORE_CLOSED",
  STORE_NOT_INITIALIZED = "STORE_NOT_INITIALIZED",
  STORE_DAMAGED_APPEND_REFUSED = "STORE_DAMAGED_APPEND_REFUSED",
  OPERATION_NOT_FOUND = "OPERATION_NOT_FOUND",
  OPERATION_ALREADY_SUBMITTING = "OPERATION_ALREADY_SUBMITTING",
  MISSING_SUBMISSION_EVIDENCE = "MISSING_SUBMISSION_EVIDENCE",
  EVIDENCE_DIGEST_MISMATCH = "EVIDENCE_DIGEST_MISMATCH",
  UNKNOWN_ABSORBING = "UNKNOWN_ABSORBING",
  SAFE_PATH_ESCAPE = "SAFE_PATH_ESCAPE",
}

/**
 * Custom error type for submission store operations.
 * Extends BaseError with safe diagnostics.
 */
export class SubmissionStoreError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: SubmissionDiagnosticCode;
  readonly durableCode?: DurableDiagnosticCode;
  readonly byteOffset?: number;

  constructor(
    diagnosticCode: SubmissionDiagnosticCode,
    message: string,
    options?: {
      durableCode?: DurableDiagnosticCode;
      byteOffset?: number;
      context?: Record<string, unknown>;
    },
  ) {
    super(`[${diagnosticCode}] ${message}`, {
      ...options?.context,
      diagnosticCode,
      durableCode: options?.durableCode,
      byteOffset: options?.byteOffset,
    });
    this.diagnosticCode = diagnosticCode;
    this.durableCode = options?.durableCode;
    this.byteOffset = options?.byteOffset;
  }
}

/**
 * Journal record transition types.
 */
export type SubmissionTransitionType =
  | "prepare"
  | "submitting"
  | "outcome"
  | "sent-copy";

/**
 * An individual entry persisted in `submissions.jsonl`.
 * Contains opaque identifiers, content digest, and lifecycle state.
 * Never duplicates raw email body or credentials.
 */
export interface SubmissionEntryRecord {
  operationId: string;
  key: EmailOperationKey;
  transition: SubmissionTransitionType;
  phase: SubmissionPhase;
  ownerId: string;
  contentDigest: string;
  emlRef: string;
  targetKind: TargetKind;
  recipientRef?: string;
  sentCopy: SentCopyStatus;
  wireMessageId?: string;
  safeCode?: string;
  timestamp: string;
}

/**
 * In-memory aggregate tracking the complete lifecycle of a single operation.
 */
export interface SubmissionEntrySnapshot {
  operationId: string;
  key: EmailOperationKey;
  phase: SubmissionPhase;
  ownerId: string;
  contentDigest: string;
  emlRef: string;
  targetKind: TargetKind;
  recipientRef?: string;
  sentCopy: SentCopyStatus;
  wireMessageId?: string;
  safeCode?: string;
  firstPreparedAt: string;
  updatedAt: string;
}

/**
 * Options when preparing a new submission operation.
 */
export interface PrepareSubmissionOptions {
  targetKind?: TargetKind;
  recipientRef?: string;
}

/**
 * Options when recording a terminal or intermediate outcome.
 */
export interface RecordOutcomeOptions {
  safeCode?: string;
  wireMessageId?: string;
  sentCopy?: SentCopyStatus;
}

/**
 * Result returned by `SubmissionStore.recover()`.
 */
export interface SubmissionRecoveryResult {
  /** Total number of tracked operations replayed. */
  totalTracked: number;
  /** Operations recovered in prepared phase (resumable before SMTP, subject to evidence check). */
  prepared: SubmissionEntrySnapshot[];
  /** Operations that were in submitting phase during crash/restart and were durably converted to unknown. */
  unknownRecovered: SubmissionEntrySnapshot[];
  /** Operations in terminal submitted phase. */
  submitted: SubmissionEntrySnapshot[];
  /** Operations in terminal failed phase. */
  failed: SubmissionEntrySnapshot[];
  /** Operations in unknown phase (including previously recorded unknown and newly converted). */
  unknown: SubmissionEntrySnapshot[];
  /** Complete map of all operations keyed by normalized operation key. */
  entries: ReadonlyMap<string, SubmissionEntrySnapshot>;
}

/**
 * Format an owner and operation key into an unambiguous deterministic lookup string.
 * Uses length-prefixed tuple encoding to eliminate delimiter collisions:
 * `o:${ownerId.length}:${ownerId}:w:${workId.length}:${workId}:s:${actionSlot.length}:${actionSlot}`
 */
export function formatOwnerOperationKey(ownerId: string, key: EmailOperationKey): string {
  return `o:${ownerId.length}:${ownerId}:w:${key.workId.length}:${key.workId}:s:${key.actionSlot.length}:${key.actionSlot}`;
}

/**
 * Format an operation key into a deterministic lookup string.
 */
export function formatOperationKey(key: EmailOperationKey): string {
  return `w:${key.workId.length}:${key.workId}:s:${key.actionSlot.length}:${key.actionSlot}`;
}

/**
 * Validate and sanitize an operation key.
 */
export function validateOperationKey(key: unknown): EmailOperationKey {
  if (!key || typeof key !== "object") {
    throw new SubmissionStoreError(
      SubmissionDiagnosticCode.INVALID_KEY,
      "Operation key must be a non-null object",
    );
  }
  const k = key as Partial<EmailOperationKey>;
  if (typeof k.workId !== "string" || k.workId.trim() === "") {
    throw new SubmissionStoreError(
      SubmissionDiagnosticCode.INVALID_KEY,
      "Operation key workId must be a non-empty string",
    );
  }
  if (typeof k.actionSlot !== "string" || k.actionSlot.trim() === "") {
    throw new SubmissionStoreError(
      SubmissionDiagnosticCode.INVALID_KEY,
      "Operation key actionSlot must be a non-empty string",
    );
  }
  return {
    workId: k.workId.trim(),
    actionSlot: k.actionSlot.trim() as EmailActionSlot,
  };
}

// Pure JS SHA-256 implementation to guarantee synchronous execution without async overhead
function sha256Sync(ascii: string): string {
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = "";
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = candidate * candidate; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      if (primeCounter < 8) {
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      }
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter++;
    }
  }

  for (let i = 0; i < ascii.length; i++) {
    const j = i >> 2;
    words[j] = (words[j] || 0) | ((ascii.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8));
  }
  words[asciiBitLength >> 5] = (words[asciiBitLength >> 5] || 0) |
    (0x80 << (24 - (asciiBitLength % 32)));
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

  for (let j = 0; j < words.length; j += 16) {
    const w = words.slice(j, j + 16);
    const oldHash = hash.slice(0);

    for (let i = 0; i < 64; i++) {
      if (i >= 16) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
          ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
          ((w[i - 15] | 0) >>> 3);
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
          ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
          ((w[i - 2] | 0) >>> 10);
        w[i] = ((w[i - 16] | 0) + s0 + (w[i - 7] | 0) + s1) | 0;
      }
      const ch = ((hash[4] & hash[5]) ^ (~hash[4] & hash[6])) | 0;
      const maj = ((hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^
        (hash[1] & hash[2])) | 0;
      const s0 = ((hash[0] >>> 2) | (hash[0] << 30)) ^
        ((hash[0] >>> 13) | (hash[0] << 19)) ^
        ((hash[0] >>> 22) | (hash[0] << 10));
      const s1 = ((hash[4] >>> 6) | (hash[4] << 26)) ^
        ((hash[4] >>> 11) | (hash[4] << 21)) ^
        ((hash[4] >>> 25) | (hash[4] << 7));
      const temp1 = (hash[7] + s1 + ch + k[i] + (w[i] | 0)) | 0;
      const temp2 = (s0 + maj) | 0;

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? "0" : "") + b.toString(16);
    }
  }
  return result;
}

/**
 * Computes standard SHA-256 hex digest for arbitrary bytes.
 */
export function computeSha256Hex(bytes: Uint8Array): string {
  let ascii = "";
  for (let i = 0; i < bytes.length; i++) {
    ascii += String.fromCharCode(bytes[i]);
  }
  return sha256Sync(ascii);
}

/**
 * Generates an opaque deterministic operation identifier from the operation key and owner.
 * Format: `op_<sha256(ownerId + ":" + workId + ":" + actionSlot)[0..24]>`
 */
export function computeOperationId(
  ownerId: string,
  key: EmailOperationKey,
): string {
  return `op_${sha256Sync(`${ownerId}:${key.workId}:${key.actionSlot}`).slice(0, 24)}`;
}

/**
 * Shared state record per canonical email root directory to prevent cross-instance divergence.
 */
interface SharedRootState {
  lock: Promise<void>;
  isDamaged: boolean;
  entries: Map<string, SubmissionEntrySnapshot>; // key: formatOwnerOperationKey
  byOperationId: Map<string, string>; // operationId -> formatOwnerOperationKey
  isRecovered: boolean;
}

const sharedRootRegistry = new Map<string, SharedRootState>();

function getOrCreateSharedRoot(canonicalRoot: string): SharedRootState {
  let state = sharedRootRegistry.get(canonicalRoot);
  if (!state) {
    state = {
      lock: Promise.resolve(),
      isDamaged: false,
      entries: new Map(),
      byOperationId: new Map(),
      isRecovered: false,
    };
    sharedRootRegistry.set(canonicalRoot, state);
  }
  return state;
}

/**
 * Reset shared in-memory registry. Used only in tests to simulate fresh process startup.
 */
export function _resetSharedRegistryForTesting(): void {
  sharedRootRegistry.clear();
}

/**
 * SubmissionStore provides crash-safe, durable tracking of outbound email operations.
 */
export class SubmissionStore {
  private readonly emailRoot: string;
  private readonly workspaceRoot?: string;
  private readonly durableOptions?: DurableFileOptions;
  private isClosed = false;

  constructor(
    emailRoot: string,
    options?: DurableFileOptions & { workspaceRoot?: string },
  ) {
    if (!emailRoot || typeof emailRoot !== "string") {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.INVALID_KEY,
        "emailRoot must be a non-empty string path",
      );
    }
    this.emailRoot = emailRoot;
    this.workspaceRoot = options?.workspaceRoot;
    this.durableOptions = options;
  }

  private async getCanonicalRoot(): Promise<string> {
    return await canonicalizeRoot(this.emailRoot);
  }

  private async withLock<T>(
    fn: (state: SharedRootState, canonicalRoot: string) => Promise<T>,
  ): Promise<T> {
    if (this.isClosed) {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.STORE_CLOSED,
        "SubmissionStore instance is closed",
      );
    }
    const canonicalRoot = await this.getCanonicalRoot();
    const shared = getOrCreateSharedRoot(canonicalRoot);

    let releaseLock!: () => void;
    const currentLock = shared.lock;
    shared.lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      await currentLock;
      if (this.isClosed) {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.STORE_CLOSED,
          "SubmissionStore instance is closed",
        );
      }
      return await fn(shared, canonicalRoot);
    } finally {
      releaseLock();
    }
  }

  /**
   * Startup recovery lifecycle.
   *
   * Invariants:
   * 1. Startup-only: rejected if the store has already been recovered.
   * 2. Reads `submissions.jsonl` using `readJournal`.
   * 3. On clean journal:
   *    - Replays all historical records in sequence to build current snapshots.
   *    - Validates record structure and transition legality during replay.
   *    - Any operation left in `submitting` phase (unclosed crash during SMTP):
   *      durably appends an `unknown` outcome transition to disk and updates in-memory snapshot.
   *      These are returned in `unknownRecovered` and MUST NEVER be automatically resubmitted.
   *    - Prepared operations remain `prepared`.
   * 4. On torn-tail or corrupt interior:
   *    - Strictly fails closed (`STORE_CORRUPT`).
   *    - Fences the entire mailbox submission lane as damaged (`isDamaged = true`).
   *    - Does NOT attempt to write or trim damaged files.
   *    - Subsequent appends will be refused with `STORE_DAMAGED_APPEND_REFUSED`.
   */
  async recover(): Promise<SubmissionRecoveryResult> {
    return await this.withLock(async (shared, canonicalRoot) => {
      if (shared.isRecovered) {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.INVALID_TRANSITION,
          "SubmissionStore.recover() is startup-only and cannot be called once already recovered",
        );
      }

      if (shared.isDamaged) {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
          "Submission store is damaged; recovery cannot proceed",
        );
      }

      const journalResult = await readJournal<SubmissionEntryRecord>(
        canonicalRoot,
        SUBMISSIONS_JOURNAL_FILENAME,
        {
          ...this.durableOptions,
          allowMissing: true,
        },
      );

      if (journalResult.status !== "clean") {
        shared.isDamaged = true;
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.STORE_CORRUPT,
          `Submission journal is damaged (${journalResult.status})`,
          {
            durableCode: journalResult.diagnosticCode,
            byteOffset: journalResult.byteOffset,
          },
        );
      }

      // Replay valid records sequentially with semantic validation
      shared.entries.clear();
      shared.byOperationId.clear();

      for (const record of journalResult.records) {
        try {
          this.applyRecordToMemory(shared, record);
        } catch {
          shared.isDamaged = true;
          throw new SubmissionStoreError(
            SubmissionDiagnosticCode.STORE_CORRUPT,
            "Journal contains invalid submission record transition order or structure",
            { context: { operationId: record.operationId } },
          );
        }
      }

      // Identify operations left unclosed in "submitting" phase
      const unresolvedSubmitting: SubmissionEntrySnapshot[] = [];
      for (const entry of shared.entries.values()) {
        if (entry.phase === "submitting") {
          unresolvedSubmitting.push(entry);
        }
      }

      const unknownRecovered: SubmissionEntrySnapshot[] = [];

      // Durably convert unclosed submitting operations to unknown
      for (const unclosed of unresolvedSubmitting) {
        const transitionRecord: SubmissionEntryRecord = {
          operationId: unclosed.operationId,
          key: { ...unclosed.key },
          transition: "outcome",
          phase: "unknown",
          ownerId: unclosed.ownerId,
          contentDigest: unclosed.contentDigest,
          emlRef: unclosed.emlRef,
          targetKind: unclosed.targetKind,
          recipientRef: unclosed.recipientRef,
          sentCopy: unclosed.sentCopy,
          safeCode: unclosed.safeCode ?? SubmissionDiagnosticCode.UNKNOWN_ABSORBING,
          timestamp: new Date().toISOString(),
        };

        try {
          await appendDurable(
            canonicalRoot,
            SUBMISSIONS_JOURNAL_FILENAME,
            transitionRecord,
            this.durableOptions,
          );
        } catch {
          shared.isDamaged = true;
          throw new SubmissionStoreError(
            SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
            "Failed to durably convert submitting operation to unknown during recovery",
            { context: { operationId: unclosed.operationId } },
          );
        }

        this.applyRecordToMemory(shared, transitionRecord);
        const mapKey = formatOwnerOperationKey(unclosed.ownerId, unclosed.key);
        const updated = shared.entries.get(mapKey)!;
        unknownRecovered.push(this.cloneSnapshot(updated));
      }

      shared.isRecovered = true;

      // Group categorized snapshots
      const prepared: SubmissionEntrySnapshot[] = [];
      const submitted: SubmissionEntrySnapshot[] = [];
      const failed: SubmissionEntrySnapshot[] = [];
      const unknown: SubmissionEntrySnapshot[] = [];

      for (const entry of shared.entries.values()) {
        const clone = this.cloneSnapshot(entry);
        switch (clone.phase) {
          case "prepared":
            prepared.push(clone);
            break;
          case "submitted":
            submitted.push(clone);
            break;
          case "failed":
            failed.push(clone);
            break;
          case "unknown":
            unknown.push(clone);
            break;
        }
      }

      const entriesMap = new Map<string, SubmissionEntrySnapshot>();
      for (const [k, v] of shared.entries.entries()) {
        entriesMap.set(k, this.cloneSnapshot(v));
      }

      logger.info(
        "Submission store recovered successfully: {Total} operations replayed, {Unknown} converted to unknown",
        { Total: shared.entries.size, Unknown: unknownRecovered.length },
      );

      return {
        totalTracked: shared.entries.size,
        prepared,
        unknownRecovered,
        submitted,
        failed,
        unknown,
        entries: entriesMap,
      };
    });
  }

  /**
   * Prepares and reserves a stable logical email operation.
   *
   * Invariants:
   * 1. If key is unseen: durably writes "prepared" record and indexes snapshot.
   * 2. If key exists with IDENTICAL contentDigest: returns existing snapshot (idempotent duplicate call).
   * 3. If key exists with DIFFERENT contentDigest: FAILS CLOSED with `KEY_PAYLOAD_CONFLICT`.
   *    Repeated calls cannot change payload under an already-reserved operation.
   * 4. If key exists in `submitting`, `submitted`, `failed`, or `unknown`:
   *    - If same digest: returns existing snapshot.
   *    - If different digest: throws `KEY_PAYLOAD_CONFLICT`.
   */
  async prepare(
    ownerId: string,
    key: EmailOperationKey,
    contentDigest: string,
    emlRef: string,
    options?: PrepareSubmissionOptions,
  ): Promise<SubmissionEntrySnapshot> {
    const validKey = validateOperationKey(key);
    if (!ownerId || typeof ownerId !== "string" || ownerId.trim() === "") {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.INVALID_OWNER,
        "ownerId must be a non-empty string",
      );
    }
    if (!contentDigest || typeof contentDigest !== "string" || contentDigest.trim() === "") {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.INVALID_DIGEST,
        "contentDigest must be a non-empty string",
      );
    }
    if (!emlRef || typeof emlRef !== "string" || emlRef.trim() === "") {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.INVALID_EML_REF,
        "emlRef must be a non-empty string path reference",
      );
    }

    return await this.withLock(async (shared, canonicalRoot) => {
      await this.ensureReady(shared, canonicalRoot);

      const mapKey = formatOwnerOperationKey(ownerId, validKey);
      const existing = shared.entries.get(mapKey);

      if (existing) {
        if (existing.contentDigest !== contentDigest) {
          throw new SubmissionStoreError(
            SubmissionDiagnosticCode.KEY_PAYLOAD_CONFLICT,
            "Operation key already reserved with different content digest",
            {
              context: {
                operationId: existing.operationId,
                existingPhase: existing.phase,
              },
            },
          );
        }
        return this.cloneSnapshot(existing);
      }

      const operationId = computeOperationId(ownerId, validKey);
      const record: SubmissionEntryRecord = {
        operationId,
        key: validKey,
        transition: "prepare",
        phase: "prepared",
        ownerId,
        contentDigest,
        emlRef,
        targetKind: options?.targetKind ?? "user",
        recipientRef: options?.recipientRef,
        sentCopy: "pending",
        timestamp: new Date().toISOString(),
      };

      try {
        await appendDurable(
          canonicalRoot,
          SUBMISSIONS_JOURNAL_FILENAME,
          record,
          this.durableOptions,
        );
      } catch (err) {
        shared.isDamaged = true;
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
          "Failed to persist prepared submission record",
          { context: { operationId, cause: String(err) } },
        );
      }

      this.applyRecordToMemory(shared, record);
      return this.cloneSnapshot(shared.entries.get(mapKey)!);
    });
  }

  /**
   * Exclusively transitions a prepared operation to `submitting` immediately before invoking SMTP.
   *
   * Invariants:
   * 1. State must be `prepared`. Transition from any other phase is strictly rejected.
   * 2. Exclusivity: If operation is already `submitting`, throws `OPERATION_ALREADY_SUBMITTING`
   *    to prevent concurrent callers from racing into SMTP.
   * 3. Evidence verification: Gated on referenced .eml message existence and digest verification.
   * 4. Durably appends `submitting` record before SMTP call is initiated.
   */
  async markSubmitting(
    ownerId: string,
    key: EmailOperationKey,
    options?: { verifyEvidence?: boolean },
  ): Promise<SubmissionEntrySnapshot> {
    const validKey = validateOperationKey(key);

    return await this.withLock(async (shared, canonicalRoot) => {
      await this.ensureReady(shared, canonicalRoot);

      const mapKey = formatOwnerOperationKey(ownerId, validKey);
      const existing = shared.entries.get(mapKey);

      if (!existing) {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.OPERATION_NOT_FOUND,
          "Cannot mark submitting: operation not found",
        );
      }

      if (existing.phase === "submitting") {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.OPERATION_ALREADY_SUBMITTING,
          "Operation is already actively submitting; concurrent send rejected",
          { context: { operationId: existing.operationId } },
        );
      }

      if (existing.phase !== "prepared") {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.INVALID_TRANSITION,
          `Cannot transition to submitting from phase '${existing.phase}'`,
          { context: { operationId: existing.operationId } },
        );
      }

      // Gate on evidence verification if requested or by default
      if (options?.verifyEvidence !== false) {
        await this.internalVerifyEvidence(canonicalRoot, existing);
      }

      const record: SubmissionEntryRecord = {
        operationId: existing.operationId,
        key: validKey,
        transition: "submitting",
        phase: "submitting",
        ownerId: existing.ownerId,
        contentDigest: existing.contentDigest,
        emlRef: existing.emlRef,
        targetKind: existing.targetKind,
        recipientRef: existing.recipientRef,
        sentCopy: existing.sentCopy,
        safeCode: existing.safeCode,
        timestamp: new Date().toISOString(),
      };

      try {
        await appendDurable(
          canonicalRoot,
          SUBMISSIONS_JOURNAL_FILENAME,
          record,
          this.durableOptions,
        );
      } catch (err) {
        shared.isDamaged = true;
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
          "Failed to persist submitting record",
          { context: { operationId: existing.operationId, cause: String(err) } },
        );
      }

      this.applyRecordToMemory(shared, record);
      return this.cloneSnapshot(shared.entries.get(mapKey)!);
    });
  }

  /**
   * Records the final or intermediate outcome (`submitted`, `failed`, or `unknown`).
   *
   * Invariants:
   * 1. Allowed transitions:
   *    - from `submitting` -> `submitted` | `failed` | `unknown`
   *    - repeating the SAME outcome is idempotent and succeeds without rewriting
   *    - mutating an existing terminal outcome (e.g. `submitted -> failed`, `submitted -> unknown`,
   *      `unknown -> submitted`) is strictly FORBIDDEN and rejected with `INVALID_TRANSITION`.
   * 2. Persists outcome durably before returning.
   */
  async recordOutcome(
    ownerId: string,
    key: EmailOperationKey,
    outcome: "submitted" | "failed" | "unknown",
    options?: RecordOutcomeOptions,
  ): Promise<SubmissionEntrySnapshot> {
    const validKey = validateOperationKey(key);

    return await this.withLock(async (shared, canonicalRoot) => {
      await this.ensureReady(shared, canonicalRoot);

      const mapKey = formatOwnerOperationKey(ownerId, validKey);
      const existing = shared.entries.get(mapKey);

      if (!existing) {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.OPERATION_NOT_FOUND,
          "Cannot record outcome: operation not found",
        );
      }

      if (
        existing.phase === "submitted" || existing.phase === "failed" ||
        existing.phase === "unknown"
      ) {
        if (existing.phase === outcome) {
          return this.cloneSnapshot(existing);
        }
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.INVALID_TRANSITION,
          `Cannot transition terminal outcome from '${existing.phase}' to '${outcome}'`,
          { context: { operationId: existing.operationId } },
        );
      }

      if (existing.phase !== "submitting") {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.INVALID_TRANSITION,
          `Cannot record outcome '${outcome}' from phase '${existing.phase}'`,
          { context: { operationId: existing.operationId } },
        );
      }

      const record: SubmissionEntryRecord = {
        operationId: existing.operationId,
        key: validKey,
        transition: "outcome",
        phase: outcome,
        ownerId: existing.ownerId,
        contentDigest: existing.contentDigest,
        emlRef: existing.emlRef,
        targetKind: existing.targetKind,
        recipientRef: existing.recipientRef,
        sentCopy: options?.sentCopy ?? existing.sentCopy,
        wireMessageId: options?.wireMessageId ?? existing.wireMessageId,
        safeCode: options?.safeCode ?? existing.safeCode,
        timestamp: new Date().toISOString(),
      };

      try {
        await appendDurable(
          canonicalRoot,
          SUBMISSIONS_JOURNAL_FILENAME,
          record,
          this.durableOptions,
        );
      } catch (err) {
        shared.isDamaged = true;
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
          "Failed to persist outcome record",
          { context: { operationId: existing.operationId, cause: String(err) } },
        );
      }

      this.applyRecordToMemory(shared, record);
      return this.cloneSnapshot(shared.entries.get(mapKey)!);
    });
  }

  /**
   * Updates the IMAP Sent folder copy status (`pending`, `appended`, or `failed`).
   *
   * Invariants:
   * 1. Can only be updated on operations that reached `submitted`. Sent copy failure
   *    NEVER downgrades or alters the accepted `submitted` outcome.
   * 2. Once `appended`, it cannot regress back to `failed` or `pending`.
   */
  async updateSentCopy(
    ownerId: string,
    key: EmailOperationKey,
    sentCopy: SentCopyStatus,
  ): Promise<SubmissionEntrySnapshot> {
    const validKey = validateOperationKey(key);

    return await this.withLock(async (shared, canonicalRoot) => {
      await this.ensureReady(shared, canonicalRoot);

      const mapKey = formatOwnerOperationKey(ownerId, validKey);
      const existing = shared.entries.get(mapKey);

      if (!existing) {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.OPERATION_NOT_FOUND,
          "Cannot update sent-copy: operation not found",
        );
      }

      if (existing.phase !== "submitted") {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.INVALID_TRANSITION,
          `Cannot update sent-copy on non-submitted operation`,
          { context: { operationId: existing.operationId } },
        );
      }

      if (existing.sentCopy === sentCopy) {
        return this.cloneSnapshot(existing);
      }

      if (existing.sentCopy === "appended" && sentCopy !== "appended") {
        return this.cloneSnapshot(existing);
      }

      const record: SubmissionEntryRecord = {
        operationId: existing.operationId,
        key: validKey,
        transition: "sent-copy",
        phase: existing.phase,
        ownerId: existing.ownerId,
        contentDigest: existing.contentDigest,
        emlRef: existing.emlRef,
        targetKind: existing.targetKind,
        recipientRef: existing.recipientRef,
        sentCopy,
        wireMessageId: existing.wireMessageId,
        safeCode: existing.safeCode,
        timestamp: new Date().toISOString(),
      };

      try {
        await appendDurable(
          canonicalRoot,
          SUBMISSIONS_JOURNAL_FILENAME,
          record,
          this.durableOptions,
        );
      } catch (err) {
        shared.isDamaged = true;
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
          "Failed to persist sent-copy update record",
          { context: { operationId: existing.operationId, cause: String(err) } },
        );
      }

      this.applyRecordToMemory(shared, record);
      return this.cloneSnapshot(shared.entries.get(mapKey)!);
    });
  }

  /**
   * Asserts that the referenced constructed `.eml` message file exists and its
   * contents match the recorded contentDigest.
   */
  async verifySubmissionEvidence(
    ownerId: string,
    key: EmailOperationKey,
    computeDigestFn?: (bytes: Uint8Array) => Promise<string> | string,
  ): Promise<void> {
    const validKey = validateOperationKey(key);
    const snapshot = this.lookup(ownerId, validKey);

    if (!snapshot) {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.OPERATION_NOT_FOUND,
        "Operation not found for evidence verification",
      );
    }

    const canonicalRoot = await this.getCanonicalRoot();
    await this.internalVerifyEvidence(canonicalRoot, snapshot, computeDigestFn);
  }

  private async internalVerifyEvidence(
    canonicalEmailRoot: string,
    snapshot: SubmissionEntrySnapshot,
    computeDigestFn?: (bytes: Uint8Array) => Promise<string> | string,
  ): Promise<void> {
    // If workspaceRoot is configured, evidence files reside under workspaceRoot.
    // Otherwise they reside under the email root.
    const evidenceBase = this.workspaceRoot
      ? await canonicalizeRoot(this.workspaceRoot)
      : canonicalEmailRoot;

    let safeEmlPath: string;
    try {
      safeEmlPath = await assertSafePath(evidenceBase, snapshot.emlRef);
    } catch {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.SAFE_PATH_ESCAPE,
        "Evidence reference attempts to escape safe directory boundary",
        { context: { operationId: snapshot.operationId } },
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = await Deno.readFile(safeEmlPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.MISSING_SUBMISSION_EVIDENCE,
          "Constructed message evidence file is missing",
          { context: { operationId: snapshot.operationId } },
        );
      }
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.MISSING_SUBMISSION_EVIDENCE,
        "Failed to read constructed message evidence file",
        { context: { operationId: snapshot.operationId } },
      );
    }

    const digest = computeDigestFn ? await computeDigestFn(bytes) : computeSha256Hex(bytes);

    if (digest !== snapshot.contentDigest) {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.EVIDENCE_DIGEST_MISMATCH,
        "Constructed message digest does not match recorded operation contentDigest",
        { context: { operationId: snapshot.operationId } },
      );
    }
  }

  /**
   * Look up an operation by owner and logical operation key within this store's canonical root.
   */
  lookup(ownerId: string, key: EmailOperationKey): SubmissionEntrySnapshot | undefined {
    if (this.isClosed || !ownerId) {
      return undefined;
    }
    const validKey = validateOperationKey(key);
    const mapKey = formatOwnerOperationKey(ownerId, validKey);
    // Find shared state for this specific store instance
    for (const [root, shared] of sharedRootRegistry.entries()) {
      if (this.emailRoot.includes(root) || root.includes(this.emailRoot)) {
        const entry = shared.entries.get(mapKey);
        if (entry) {
          return this.cloneSnapshot(entry);
        }
      }
    }
    return undefined;
  }

  /**
   * Look up an operation by opaque operation ID (`op_...`) within this store's canonical root.
   */
  lookupById(operationId: string): SubmissionEntrySnapshot | undefined {
    if (this.isClosed || !operationId) {
      return undefined;
    }
    for (const [root, shared] of sharedRootRegistry.entries()) {
      if (this.emailRoot.includes(root) || root.includes(this.emailRoot)) {
        const mapKey = shared.byOperationId.get(operationId);
        if (mapKey) {
          const entry = shared.entries.get(mapKey);
          if (entry) {
            return this.cloneSnapshot(entry);
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Closes this store instance.
   */
  close(): void {
    this.isClosed = true;
  }

  private async ensureReady(shared: SharedRootState, canonicalRoot: string): Promise<void> {
    if (shared.isDamaged) {
      throw new SubmissionStoreError(
        SubmissionDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
        "Submission store is damaged; subsequent appends are strictly refused",
      );
    }
    // Auto-recover if unrecovered to guarantee replay of any existing journal before writes
    if (!shared.isRecovered) {
      const journalResult = await readJournal<SubmissionEntryRecord>(
        canonicalRoot,
        SUBMISSIONS_JOURNAL_FILENAME,
        {
          ...this.durableOptions,
          allowMissing: true,
        },
      );
      if (journalResult.status !== "clean") {
        shared.isDamaged = true;
        throw new SubmissionStoreError(
          SubmissionDiagnosticCode.STORE_CORRUPT,
          `Submission journal is damaged (${journalResult.status})`,
        );
      }
      for (const record of journalResult.records) {
        this.applyRecordToMemory(shared, record);
      }
      shared.isRecovered = true;
    }
  }

  private applyRecordToMemory(
    shared: SharedRootState,
    record: SubmissionEntryRecord,
  ): void {
    if (
      !record || typeof record !== "object" || !record.operationId || !record.key || !record.ownerId
    ) {
      throw new Error("Invalid record structure");
    }
    const mapKey = formatOwnerOperationKey(record.ownerId, record.key);
    const existing = shared.entries.get(mapKey);

    if (!existing) {
      if (record.phase !== "prepared") {
        throw new Error("Initial record must be prepared");
      }
      const snapshot: SubmissionEntrySnapshot = {
        operationId: record.operationId,
        key: { ...record.key },
        phase: record.phase,
        ownerId: record.ownerId,
        contentDigest: record.contentDigest,
        emlRef: record.emlRef,
        targetKind: record.targetKind,
        recipientRef: record.recipientRef,
        sentCopy: record.sentCopy,
        wireMessageId: record.wireMessageId,
        safeCode: record.safeCode,
        firstPreparedAt: record.timestamp,
        updatedAt: record.timestamp,
      };
      shared.entries.set(mapKey, snapshot);
      shared.byOperationId.set(record.operationId, mapKey);
    } else {
      // Validate transition legality during replay
      if (
        existing.phase === "submitted" || existing.phase === "failed" ||
        existing.phase === "unknown"
      ) {
        if (record.phase !== existing.phase && record.transition !== "sent-copy") {
          throw new Error("Illegal transition from terminal state during replay");
        }
      }
      existing.phase = record.phase;
      existing.sentCopy = record.sentCopy;
      if (record.wireMessageId !== undefined) {
        existing.wireMessageId = record.wireMessageId;
      }
      if (record.safeCode !== undefined) {
        existing.safeCode = record.safeCode;
      }
      existing.updatedAt = record.timestamp;
    }
  }

  private cloneSnapshot(snap: SubmissionEntrySnapshot): SubmissionEntrySnapshot {
    return {
      ...snap,
      key: { ...snap.key },
    };
  }
}
