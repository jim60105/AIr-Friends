// src/platforms/email/mailbox-store.ts
//
// Durable mailbox processing evidence owned by `email-mailbox-journal`.
// Manages mailbox identity, first-activation boundary, scan cursor snapshots,
// and append-only entry processing state transitions backed by crash-safe
// durable primitives in `durable-files.ts`.

import { BaseError, ErrorCode } from "../../types/errors.ts";
import { createLogger } from "@utils/logger.ts";
import {
  appendDurable,
  assertSafePath,
  canonicalizeRoot,
  DurableDiagnosticCode,
  DurableFileError,
  DurableFileOptions,
  readJournal,
  replaceSnapshot,
} from "./durable-files.ts";

const logger = createLogger("EmailMailboxStore");

/** Snapshot version for mailbox.json */
export const MAILBOX_SNAPSHOT_VERSION = 1;

/** Relative paths under the email state root */
export const MAILBOX_SNAPSHOT_FILENAME = "mailbox.json";
export const PROCESSING_JOURNAL_FILENAME = "processing.jsonl";

/**
 * Diagnostic codes for mailbox store operations and integrity checks.
 * Safe enums that describe errors without disclosing private mail content or credentials.
 */
export enum MailboxDiagnosticCode {
  CLEAN = "CLEAN",
  SNAPSHOT_NOT_FOUND = "SNAPSHOT_NOT_FOUND",
  SNAPSHOT_MALFORMED = "SNAPSHOT_MALFORMED",
  UNSUPPORTED_SNAPSHOT_VERSION = "UNSUPPORTED_SNAPSHOT_VERSION",
  FINGERPRINT_MISMATCH = "FINGERPRINT_MISMATCH",
  UIDVALIDITY_MISMATCH = "UIDVALIDITY_MISMATCH",
  MISSING_SNAPSHOT_WITH_JOURNAL = "MISSING_SNAPSHOT_WITH_JOURNAL",
  INVALID_KEY = "INVALID_KEY",
  INVALID_TRANSITION = "INVALID_TRANSITION",
  CHECKPOINT_SKIPS_DISCOVERED = "CHECKPOINT_SKIPS_DISCOVERED",
  CHECKPOINT_REGRESSION = "CHECKPOINT_REGRESSION",
  ALREADY_INITIALIZED = "ALREADY_INITIALIZED",
  NOT_INITIALIZED = "NOT_INITIALIZED",
  RECOVERY_FAILED = "RECOVERY_FAILED",
  STORE_CORRUPT = "STORE_CORRUPT",
  STORE_CLOSED = "STORE_CLOSED",
  STORE_DAMAGED_APPEND_REFUSED = "STORE_DAMAGED_APPEND_REFUSED",
  IMMUTABLE_ID_MISMATCH = "IMMUTABLE_ID_MISMATCH",
}

/**
 * Custom error type for mailbox store operations.
 * Extends BaseError with safe diagnostics.
 */
export class MailboxStoreError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: MailboxDiagnosticCode;
  readonly durableCode?: DurableDiagnosticCode;
  readonly byteOffset?: number;

  constructor(
    diagnosticCode: MailboxDiagnosticCode,
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
 * MailboxKey identifies a single email message within a specific mailbox instance.
 * - fingerprint: "host:account:folder" identifying the remote mailbox configuration
 * - uidValidity: IMAP mailbox UIDVALIDITY integer
 * - uid: IMAP message UID integer
 */
export interface MailboxKey {
  fingerprint: string;
  uidValidity: number;
  uid: number;
}

/**
 * ProcessingState lifecycle for an individual mailbox entry.
 *
 * State transition rules:
 * - Absent -> discovered
 * - discovered -> accepted | ignored | failed | review-required
 * - accepted -> started | ignored | failed | review-required
 * - started -> completed | ignored | failed | review-required
 * - Any terminal state (completed, ignored, failed, review-required) -> None (terminal)
 */
export type ProcessingState =
  | "discovered"
  | "accepted"
  | "started"
  | "completed"
  | "ignored"
  | "failed"
  | "review-required";

export const TERMINAL_PROCESSING_STATES: Record<ProcessingState, boolean> = {
  completed: true,
  ignored: true,
  failed: true,
  "review-required": true,
  discovered: false,
  accepted: false,
  started: false,
};

/**
 * An individual entry record persisted in `processing.jsonl`.
 */
export interface MailboxEntryRecord {
  key: MailboxKey;
  state: ProcessingState;
  sourceRecordId?: string;
  workId?: string;
  detail?: string;
  timestamp: string;
}

/**
 * In-memory entry tracking aggregate that retains cumulative immutable identifiers.
 */
export interface MailboxEntrySnapshot {
  key: MailboxKey;
  state: ProcessingState;
  sourceRecordId?: string;
  workId?: string;
  detail?: string;
  firstDiscoveredAt: string;
  updatedAt: string;
}

/**
 * Snapshot structure persisted in `mailbox.json`.
 */
export interface MailboxSnapshot {
  version: number;
  fingerprint: string;
  initializedBoundary: number;
  uidValidity: number;
  cursor: number;
  updatedAt: string;
}

/**
 * Result returned by `MailboxStore.recover()`.
 */
export interface MailboxRecoveryResult {
  fingerprint: string;
  uidValidity: number;
  initializedBoundary: number;
  cursor: number;
  /** Accepted entries that have not been started yet and can resume */
  unstarted: MailboxEntrySnapshot[];
  /** Entries requiring operator review (e.g. crashed after agent start) */
  reviewRequired: MailboxEntrySnapshot[];
  /** Snapshot of all tracked entries keyed by entry key string */
  entries: ReadonlyMap<string, MailboxEntrySnapshot>;
}

/**
 * Normalizes MailboxKey into a deterministic lookup string key:
 * `f:${fingerprint}:v:${uidValidity}:u:${uid}`
 */
export function formatMailboxKey(key: MailboxKey): string {
  return `f:${key.fingerprint}:v:${key.uidValidity}:u:${key.uid}`;
}

/**
 * Parses and validates MailboxKey components.
 */
export function validateMailboxKey(
  key: unknown,
  expectedFingerprint?: string,
  expectedUidValidity?: number,
): MailboxKey {
  if (!key || typeof key !== "object") {
    throw new MailboxStoreError(
      MailboxDiagnosticCode.INVALID_KEY,
      "Mailbox key must be a non-null object",
    );
  }
  const k = key as Partial<MailboxKey>;
  if (typeof k.fingerprint !== "string" || k.fingerprint.trim() === "") {
    throw new MailboxStoreError(
      MailboxDiagnosticCode.INVALID_KEY,
      "Mailbox key fingerprint must be a non-empty string",
    );
  }
  if (typeof k.uidValidity !== "number" || !Number.isInteger(k.uidValidity) || k.uidValidity <= 0) {
    throw new MailboxStoreError(
      MailboxDiagnosticCode.INVALID_KEY,
      "Mailbox key uidValidity must be a positive integer",
    );
  }
  if (typeof k.uid !== "number" || !Number.isInteger(k.uid) || k.uid <= 0) {
    throw new MailboxStoreError(
      MailboxDiagnosticCode.INVALID_KEY,
      "Mailbox key uid must be a positive integer",
    );
  }

  if (expectedFingerprint !== undefined && k.fingerprint !== expectedFingerprint) {
    throw new MailboxStoreError(
      MailboxDiagnosticCode.FINGERPRINT_MISMATCH,
      `Mailbox key fingerprint mismatch: expected ${expectedFingerprint}, got ${k.fingerprint}`,
    );
  }
  if (expectedUidValidity !== undefined && k.uidValidity !== expectedUidValidity) {
    throw new MailboxStoreError(
      MailboxDiagnosticCode.UIDVALIDITY_MISMATCH,
      `Mailbox key uidValidity mismatch: expected ${expectedUidValidity}, got ${k.uidValidity}`,
    );
  }

  return {
    fingerprint: k.fingerprint,
    uidValidity: k.uidValidity,
    uid: k.uid,
  };
}

/**
 * Builds a deterministic mailbox fingerprint string from host, account, and folder.
 * Escapes delimiters using URI encoding and preserves account case (per email-identity.ts).
 */
export function buildMailboxFingerprint(
  host: string,
  account: string,
  folder: string,
): string {
  if (typeof host !== "string" || typeof account !== "string" || typeof folder !== "string") {
    throw new MailboxStoreError(
      MailboxDiagnosticCode.INVALID_KEY,
      "Host, account, and folder must be non-empty strings to build fingerprint",
    );
  }
  const h = host.trim().toLowerCase();
  const a = account.trim();
  const f = folder.trim();
  if (!h || !a || !f) {
    throw new MailboxStoreError(
      MailboxDiagnosticCode.INVALID_KEY,
      "Host, account, and folder must be non-empty strings to build fingerprint",
    );
  }
  return `host=${encodeURIComponent(h)};account=${encodeURIComponent(a)};folder=${
    encodeURIComponent(f)
  }`;
}

/**
 * Options for configuring the MailboxStore instance.
 */
export interface MailboxStoreOptions {
  emailRoot: string;
  fingerprint: string;
  durableOptions?: DurableFileOptions;
}

/**
 * MailboxStore manages durable mailbox progress snapshots and processing transitions.
 * Enforces serialized mutations, strictly guarded state transitions, monotonic cursor
 * advancement without skipping unaccepted discoveries, and fail-closed crash recovery.
 */
export class MailboxStore {
  readonly emailRoot: string;
  readonly configuredFingerprint: string;
  private readonly durableOptions?: DurableFileOptions;

  private isClosed = false;
  private isRecovered = false;
  private isDamaged = false;

  private snapshot: MailboxSnapshot | null = null;
  private readonly entries = new Map<string, MailboxEntrySnapshot>();

  // Mutex queue to serialize all store mutations
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: MailboxStoreOptions) {
    if (!options.emailRoot || options.emailRoot.trim() === "") {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.INVALID_KEY,
        "emailRoot must be a non-empty string",
      );
    }
    if (!options.fingerprint || options.fingerprint.trim() === "") {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.INVALID_KEY,
        "fingerprint must be a non-empty string",
      );
    }
    this.emailRoot = options.emailRoot;
    this.configuredFingerprint = options.fingerprint;
    this.durableOptions = options.durableOptions;
  }

  /**
   * Acquires the store-level mutation lock.
   */
  private async withLock<R>(fn: () => Promise<R>): Promise<R> {
    if (this.isClosed) {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_CLOSED,
        "MailboxStore is closed",
      );
    }
    if (this.isDamaged) {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
        "MailboxStore is damaged and rejects further mutations",
      );
    }

    let release!: () => void;
    const ticket = new Promise<void>((res) => {
      release = res;
    });

    const prev = this.mutationQueue;
    this.mutationQueue = prev.then(
      () => ticket,
      () => ticket,
    );

    await prev;
    try {
      if (this.isClosed) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CLOSED,
          "MailboxStore is closed",
        );
      }
      if (this.isDamaged) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
          "MailboxStore is damaged and rejects further mutations",
        );
      }
      return await fn();
    } catch (err) {
      // If a durable persistence error occurred during write/sync, mark store unusable
      if (err instanceof DurableFileError) {
        this.isDamaged = true;
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Durable persistence failure: ${err.message}`,
          {
            durableCode: err.diagnosticCode,
            byteOffset: err.byteOffset,
            context: { error: err.message },
          },
        );
      }
      throw err;
    } finally {
      release();
    }
  }

  /**
   * Closes the store instance. Further mutations will be rejected.
   */
  close(): void {
    this.isClosed = true;
  }

  /**
   * Returns current snapshot copy, or null if uninitialized.
   */
  getSnapshot(): MailboxSnapshot | null {
    return this.snapshot ? { ...this.snapshot } : null;
  }

  /**
   * Returns entry snapshot copy by key, or undefined if unknown.
   */
  getEntry(key: MailboxKey): MailboxEntrySnapshot | undefined {
    const validKey = validateMailboxKey(
      key,
      this.configuredFingerprint,
      this.snapshot?.uidValidity,
    );
    const formatted = formatMailboxKey(validKey);
    const existing = this.entries.get(formatted);
    return existing ? { ...existing, key: { ...existing.key } } : undefined;
  }

  /**
   * Recovers mailbox state on startup.
   *
   * Invariants:
   * 1. Reads `mailbox.json` and verifies fingerprint and schema.
   *    - Missing snapshot + missing journal: fresh uninitialized mailbox. Returns clean empty recovery.
   *    - Missing snapshot + existing journal: FAIL CLOSED (`MISSING_SNAPSHOT_WITH_JOURNAL`).
   *    - Different fingerprint: FAIL CLOSED (`FINGERPRINT_MISMATCH`).
   * 2. Reads `processing.jsonl` using `readJournal`.
   *    - If journal is torn-tail or corrupt, FAILS CLOSED without modifying disk (`STORE_CORRUPT`).
   * 3. Validates and replays each record through transition rules.
   * 4. For any entry whose terminal state is missing and was left in `started`:
   *    - Durably appends a `review-required` transition to `processing.jsonl`.
   *    - Updates in-memory entry to `review-required`.
   * 5. Returns unstarted queue (entries in `accepted` state), reviewRequired queue,
   *    and comprehensive entry map.
   */
  async recover(): Promise<MailboxRecoveryResult> {
    return await this.withLock(async () => {
      // Guard: recover() is a startup-only operation.
      // Calling recover() when live un-quarantined entries are active is rejected to prevent
      // quarantining actively executing sessions.
      if (this.isRecovered) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_TRANSITION,
          "MailboxStore.recover() is startup-only and cannot be called once already recovered or initialized",
        );
      }

      const canonicalRoot = await canonicalizeRoot(this.emailRoot);

      // Check for mailbox.json existence
      let rawSnapshotContent: string | null = null;
      try {
        const snapshotPath = await assertSafePath(
          canonicalRoot,
          MAILBOX_SNAPSHOT_FILENAME,
        );
        rawSnapshotContent = await Deno.readTextFile(snapshotPath);
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          throw err;
        }
      }

      // Check for processing.jsonl existence
      const journalResult = await readJournal<MailboxEntryRecord>(
        canonicalRoot,
        PROCESSING_JOURNAL_FILENAME,
        {
          ...this.durableOptions,
          allowMissing: true,
        },
      );

      // Check journal integrity first, even before fresh-state branch
      if (journalResult.status !== "clean") {
        this.isDamaged = true;
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Processing journal is damaged (${journalResult.status}): ${journalResult.diagnosticCode}`,
          {
            durableCode: journalResult.diagnosticCode,
            byteOffset: journalResult.byteOffset,
          },
        );
      }

      // Rule: missing snapshot with non-empty journal is corrupt/ambiguous
      if (rawSnapshotContent === null) {
        if (journalResult.records.length > 0) {
          throw new MailboxStoreError(
            MailboxDiagnosticCode.MISSING_SNAPSHOT_WITH_JOURNAL,
            "Mailbox snapshot is missing but processing journal has existing records",
          );
        }
        // Fresh uninitialized mailbox
        this.snapshot = null;
        this.entries.clear();
        this.isRecovered = true;
        return {
          fingerprint: this.configuredFingerprint,
          uidValidity: 0,
          initializedBoundary: 0,
          cursor: 0,
          unstarted: [],
          reviewRequired: [],
          entries: new Map(),
        };
      }

      // Parse and validate snapshot
      let parsedSnapshot: unknown;
      try {
        parsedSnapshot = JSON.parse(rawSnapshotContent);
      } catch {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.SNAPSHOT_MALFORMED,
          "Mailbox snapshot contains invalid JSON syntax",
        );
      }

      const snap = parsedSnapshot as Partial<MailboxSnapshot>;
      if (
        typeof snap !== "object" ||
        snap === null ||
        typeof snap.version !== "number" ||
        typeof snap.fingerprint !== "string" ||
        typeof snap.initializedBoundary !== "number" ||
        typeof snap.uidValidity !== "number" ||
        typeof snap.cursor !== "number" ||
        typeof snap.updatedAt !== "string"
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.SNAPSHOT_MALFORMED,
          "Mailbox snapshot schema is invalid or missing required fields",
        );
      }

      if (
        !Number.isInteger(snap.uidValidity) ||
        !Number.isInteger(snap.initializedBoundary) ||
        !Number.isInteger(snap.cursor)
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.SNAPSHOT_MALFORMED,
          "Mailbox snapshot schema is invalid or missing required fields",
        );
      }

      if (snap.version !== MAILBOX_SNAPSHOT_VERSION) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.UNSUPPORTED_SNAPSHOT_VERSION,
          `Unsupported mailbox snapshot version: ${snap.version}`,
        );
      }

      // Fail closed on fingerprint mismatch
      if (snap.fingerprint !== this.configuredFingerprint) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.FINGERPRINT_MISMATCH,
          `Mailbox snapshot fingerprint mismatch: expected ${this.configuredFingerprint}, got ${snap.fingerprint}`,
        );
      }

      if (
        snap.uidValidity <= 0 || snap.initializedBoundary < 0 ||
        snap.cursor < snap.initializedBoundary
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.SNAPSHOT_MALFORMED,
          "Mailbox snapshot contains invalid numerical boundary or cursor values",
        );
      }

      // Replay journal records
      this.entries.clear();
      for (let i = 0; i < journalResult.records.length; i++) {
        const record = journalResult.records[i];
        this.replayRecord(record);
      }

      // Quarantine any entries left in "started" state
      const startedEntries: MailboxEntrySnapshot[] = [];
      for (const entry of this.entries.values()) {
        if (entry.state === "started") {
          startedEntries.push(entry);
        }
      }

      // Durably append "review-required" for started entries
      for (const started of startedEntries) {
        const transitionRecord: MailboxEntryRecord = {
          key: { ...started.key },
          state: "review-required",
          sourceRecordId: started.sourceRecordId,
          workId: started.workId,
          detail: "Quarantined on crash recovery: started work without terminal outcome",
          timestamp: new Date().toISOString(),
        };

        try {
          await appendDurable<MailboxEntryRecord>(
            canonicalRoot,
            PROCESSING_JOURNAL_FILENAME,
            transitionRecord,
            this.durableOptions,
          );
        } catch (appendErr) {
          this.isDamaged = true;
          throw new MailboxStoreError(
            MailboxDiagnosticCode.RECOVERY_FAILED,
            "Failed to append review-required quarantine transition during recovery",
            {
              durableCode: appendErr instanceof DurableFileError
                ? appendErr.diagnosticCode
                : undefined,
              context: {
                error: appendErr instanceof Error ? appendErr.message : String(appendErr),
              },
            },
          );
        }

        // Update in-memory entry after successful durable write
        started.state = "review-required";
        started.detail = transitionRecord.detail;
        started.updatedAt = transitionRecord.timestamp;
      }

      this.snapshot = {
        version: snap.version,
        fingerprint: snap.fingerprint,
        initializedBoundary: snap.initializedBoundary,
        uidValidity: snap.uidValidity,
        cursor: snap.cursor,
        updatedAt: snap.updatedAt,
      };

      this.isRecovered = true;

      // Segregate unstarted vs reviewRequired
      const unstarted: MailboxEntrySnapshot[] = [];
      const reviewRequired: MailboxEntrySnapshot[] = [];
      const entriesCopy = new Map<string, MailboxEntrySnapshot>();

      for (const [k, v] of this.entries.entries()) {
        const copy: MailboxEntrySnapshot = {
          ...v,
          key: { ...v.key },
        };
        entriesCopy.set(k, copy);
        if (v.state === "accepted") {
          unstarted.push(copy);
        } else if (v.state === "review-required") {
          reviewRequired.push(copy);
        }
      }

      logger.info(
        "MailboxStore recovered: cursor={Cursor}, unstarted={Unstarted}, reviewRequired={ReviewRequired}",
        {
          Cursor: this.snapshot.cursor,
          Unstarted: unstarted.length,
          ReviewRequired: reviewRequired.length,
        },
      );

      return {
        fingerprint: this.snapshot.fingerprint,
        uidValidity: this.snapshot.uidValidity,
        initializedBoundary: this.snapshot.initializedBoundary,
        cursor: this.snapshot.cursor,
        unstarted,
        reviewRequired,
        entries: entriesCopy,
      };
    });
  }

  /**
   * Initializes first-activation mailbox boundary.
   *
   * Invariants:
   * - Cannot re-initialize if already initialized with different parameters.
   * - If snapshot exists and matches boundary and uidValidity, this is idempotent.
   * - Persists boundary and sets initial cursor = boundary in mailbox.json.
   * - Future arrivals > boundary will be processed; existing <= boundary are excluded.
   */
  async initialize(boundary: number, uidValidity: number): Promise<void> {
    return await this.withLock(async () => {
      if (!Number.isInteger(boundary) || boundary < 0) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_KEY,
          "boundary must be a non-negative integer",
        );
      }
      if (!Number.isInteger(uidValidity) || uidValidity <= 0) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_KEY,
          "uidValidity must be a positive integer",
        );
      }

      if (this.snapshot !== null) {
        // Idempotent check
        if (
          this.snapshot.fingerprint === this.configuredFingerprint &&
          this.snapshot.initializedBoundary === boundary &&
          this.snapshot.uidValidity === uidValidity
        ) {
          return;
        }
        throw new MailboxStoreError(
          MailboxDiagnosticCode.ALREADY_INITIALIZED,
          "Mailbox is already initialized with different boundary or uidValidity",
        );
      }

      if (this.isRecovered && this.snapshot !== null) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.ALREADY_INITIALIZED,
          "MailboxStore is already active and recovered; cannot call initialize()",
        );
      }

      const canonicalRoot = await canonicalizeRoot(this.emailRoot);

      // Check journal integrity and existing journal records before allowing initialize()
      const journalResult = await readJournal<MailboxEntryRecord>(
        canonicalRoot,
        PROCESSING_JOURNAL_FILENAME,
        {
          ...this.durableOptions,
          allowMissing: true,
        },
      );

      if (journalResult.status !== "clean") {
        this.isDamaged = true;
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Processing journal is damaged (${journalResult.status}): ${journalResult.diagnosticCode}`,
          { durableCode: journalResult.diagnosticCode },
        );
      }

      if (journalResult.records.length > 0) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.MISSING_SNAPSHOT_WITH_JOURNAL,
          "Cannot initialize fresh mailbox: processing journal already has existing records",
        );
      }

      // Check if snapshot exists on disk
      try {
        const snapshotPath = await assertSafePath(
          canonicalRoot,
          MAILBOX_SNAPSHOT_FILENAME,
        );
        const existingRaw = await Deno.readTextFile(snapshotPath);
        const existing = JSON.parse(existingRaw) as MailboxSnapshot;
        if (existing.fingerprint !== this.configuredFingerprint) {
          throw new MailboxStoreError(
            MailboxDiagnosticCode.FINGERPRINT_MISMATCH,
            `Existing mailbox snapshot fingerprint mismatch: expected ${this.configuredFingerprint}, got ${existing.fingerprint}`,
          );
        }
        if (
          existing.initializedBoundary === boundary &&
          existing.uidValidity === uidValidity
        ) {
          this.snapshot = existing;
          return;
        }
        throw new MailboxStoreError(
          MailboxDiagnosticCode.ALREADY_INITIALIZED,
          "Mailbox snapshot already exists on disk with different boundary or uidValidity",
        );
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          if (err instanceof MailboxStoreError) throw err;
          throw new MailboxStoreError(
            MailboxDiagnosticCode.SNAPSHOT_MALFORMED,
            "Failed to inspect existing snapshot file",
          );
        }
      }

      const newSnapshot: MailboxSnapshot = {
        version: MAILBOX_SNAPSHOT_VERSION,
        fingerprint: this.configuredFingerprint,
        initializedBoundary: boundary,
        uidValidity,
        cursor: boundary,
        updatedAt: new Date().toISOString(),
      };

      await replaceSnapshot<MailboxSnapshot>(
        canonicalRoot,
        MAILBOX_SNAPSHOT_FILENAME,
        newSnapshot,
        this.durableOptions,
      );

      this.snapshot = newSnapshot;
      this.isRecovered = true;

      logger.info(
        "MailboxStore initialized: boundary={Boundary}, uidValidity={UidValidity}",
        {
          Boundary: boundary,
          UidValidity: uidValidity,
        },
      );
    });
  }

  /**
   * Advances discovery scan cursor to `newCursor`.
   *
   * Invariants:
   * 1. Store must be initialized.
   * 2. `newCursor` must be >= current `cursor` (monotonic advancement).
   * 3. Coverage invariant: cannot advance cursor past any entry in `discovered` state!
   *    Every discovered entry with `uid <= newCursor` MUST be transitioned to `accepted`,
   *    `ignored`, `failed`, or `review-required` before cursor can advance past it.
   * 4. Replaces `mailbox.json` snapshot atomically.
   */
  async checkpoint(newCursor: number): Promise<void> {
    return await this.withLock(async () => {
      this.ensureReady();

      if (!Number.isInteger(newCursor) || newCursor < 0) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_KEY,
          "newCursor must be a non-negative integer",
        );
      }

      if (newCursor < this.snapshot!.cursor) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.CHECKPOINT_REGRESSION,
          `Cannot regress cursor from ${this.snapshot!.cursor} to ${newCursor}`,
        );
      }

      if (newCursor === this.snapshot!.cursor) {
        // No-op
        return;
      }

      // Invariant: check for any entry <= newCursor still in "discovered" state
      for (const entry of this.entries.values()) {
        if (entry.key.uid <= newCursor && entry.state === "discovered") {
          throw new MailboxStoreError(
            MailboxDiagnosticCode.CHECKPOINT_SKIPS_DISCOVERED,
            `Cannot advance cursor to ${newCursor}: entry UID ${entry.key.uid} is still in discovered state`,
            { context: { uid: entry.key.uid } },
          );
        }
      }

      const canonicalRoot = await canonicalizeRoot(this.emailRoot);
      const updatedSnapshot: MailboxSnapshot = {
        ...this.snapshot!,
        cursor: newCursor,
        updatedAt: new Date().toISOString(),
      };

      await replaceSnapshot<MailboxSnapshot>(
        canonicalRoot,
        MAILBOX_SNAPSHOT_FILENAME,
        updatedSnapshot,
        this.durableOptions,
      );

      this.snapshot = updatedSnapshot;

      logger.debug("MailboxStore checkpoint advanced cursor to {Cursor}", {
        Cursor: newCursor,
      });
    });
  }

  /**
   * Records discovery of an email UID during mailbox scan.
   *
   * Invariants:
   * - If entry is absent: appends `discovered` record to journal.
   * - If entry already exists (rediscovery on restart/next poll): harmless no-op, preserves existing state.
   */
  async discover(key: MailboxKey): Promise<void> {
    return await this.withLock(async () => {
      this.ensureReady();
      const validKey = validateMailboxKey(
        key,
        this.configuredFingerprint,
        this.snapshot!.uidValidity,
      );
      const formatted = formatMailboxKey(validKey);
      const existing = this.entries.get(formatted);

      if (existing) {
        // Idempotent rediscovery preserves existing state
        return;
      }

      const record: MailboxEntryRecord = {
        key: validKey,
        state: "discovered",
        timestamp: new Date().toISOString(),
      };

      const canonicalRoot = await canonicalizeRoot(this.emailRoot);
      await appendDurable<MailboxEntryRecord>(
        canonicalRoot,
        PROCESSING_JOURNAL_FILENAME,
        record,
        this.durableOptions,
      );

      this.entries.set(formatted, {
        key: validKey,
        state: "discovered",
        firstDiscoveredAt: record.timestamp,
        updatedAt: record.timestamp,
      });
    });
  }

  /**
   * Accepts discovered email for processing with immutable sourceRecordId.
   *
   * Invariants:
   * - Entry must be in `discovered` state (or absent, which implicitly discovers and accepts).
   * - If already in `accepted` state with the same `sourceRecordId`: idempotent no-op.
   * - If already in `accepted` state with different `sourceRecordId`: rejects with IMMUTABLE_ID_MISMATCH.
   * - If in terminal or started state: rejects transition.
   * - Appends `accepted` record to journal before returning.
   */
  async accept(key: MailboxKey, sourceRecordId: string): Promise<void> {
    return await this.withLock(async () => {
      this.ensureReady();
      if (!sourceRecordId || sourceRecordId.trim() === "") {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_KEY,
          "sourceRecordId must be a non-empty string",
        );
      }
      const validKey = validateMailboxKey(
        key,
        this.configuredFingerprint,
        this.snapshot!.uidValidity,
      );
      const formatted = formatMailboxKey(validKey);
      const existing = this.entries.get(formatted);

      if (existing) {
        if (existing.state === "accepted") {
          if (existing.sourceRecordId === sourceRecordId) {
            return; // Idempotent
          }
          throw new MailboxStoreError(
            MailboxDiagnosticCode.IMMUTABLE_ID_MISMATCH,
            `Cannot change immutable sourceRecordId from ${existing.sourceRecordId} to ${sourceRecordId}`,
          );
        }
        if (existing.state !== "discovered") {
          throw new MailboxStoreError(
            MailboxDiagnosticCode.INVALID_TRANSITION,
            `Cannot accept entry in state ${existing.state}`,
          );
        }
      }

      const now = new Date().toISOString();
      const record: MailboxEntryRecord = {
        key: validKey,
        state: "accepted",
        sourceRecordId,
        timestamp: now,
      };

      const canonicalRoot = await canonicalizeRoot(this.emailRoot);
      await appendDurable<MailboxEntryRecord>(
        canonicalRoot,
        PROCESSING_JOURNAL_FILENAME,
        record,
        this.durableOptions,
      );

      if (existing) {
        existing.state = "accepted";
        existing.sourceRecordId = sourceRecordId;
        existing.updatedAt = now;
      } else {
        this.entries.set(formatted, {
          key: validKey,
          state: "accepted",
          sourceRecordId,
          firstDiscoveredAt: now,
          updatedAt: now,
        });
      }
    });
  }

  /**
   * Starts agent/session processing for an accepted entry with a unique workId.
   *
   * Invariants:
   * - Entry must be in `accepted` state.
   * - Absent, discovered, started, or terminal entries are strictly rejected.
   * - Appends `started` record with `workId` and preserved `sourceRecordId`.
   */
  async start(key: MailboxKey, workId: string): Promise<void> {
    return await this.withLock(async () => {
      this.ensureReady();
      if (!workId || workId.trim() === "") {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_KEY,
          "workId must be a non-empty string",
        );
      }
      const validKey = validateMailboxKey(
        key,
        this.configuredFingerprint,
        this.snapshot!.uidValidity,
      );
      const formatted = formatMailboxKey(validKey);
      const existing = this.entries.get(formatted);

      if (!existing) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_TRANSITION,
          "Cannot start entry that has not been accepted",
        );
      }
      if (existing.state !== "accepted") {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_TRANSITION,
          `Cannot start entry in state ${existing.state}`,
        );
      }

      const now = new Date().toISOString();
      const record: MailboxEntryRecord = {
        key: validKey,
        state: "started",
        sourceRecordId: existing.sourceRecordId,
        workId,
        timestamp: now,
      };

      const canonicalRoot = await canonicalizeRoot(this.emailRoot);
      await appendDurable<MailboxEntryRecord>(
        canonicalRoot,
        PROCESSING_JOURNAL_FILENAME,
        record,
        this.durableOptions,
      );

      existing.state = "started";
      existing.workId = workId;
      existing.updatedAt = now;
    });
  }

  /**
   * Finishes an entry with a terminal outcome: completed, ignored, failed, or review-required.
   *
   * Permitted source states per outcome:
   * - "completed": requires "started" (session completion receipt)
   * - "ignored": allowed from "discovered", "accepted", "started"
   * - "failed": allowed from "discovered", "accepted", "started"
   * - "review-required": allowed from "discovered", "accepted", "started"
   *
   * Once in terminal state:
   * - Re-calling with identical outcome and workId is an idempotent no-op.
   * - Any other transition from a terminal state is strictly rejected.
   */
  async finish(
    key: MailboxKey,
    outcome: "completed" | "ignored" | "failed" | "review-required",
    options?: { workId?: string; detail?: string },
  ): Promise<void> {
    return await this.withLock(async () => {
      this.ensureReady();
      const validKey = validateMailboxKey(
        key,
        this.configuredFingerprint,
        this.snapshot!.uidValidity,
      );
      const formatted = formatMailboxKey(validKey);
      const existing = this.entries.get(formatted);

      if (!existing) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_TRANSITION,
          `Cannot finish unknown entry with outcome ${outcome}`,
        );
      }

      // Check terminal idempotency
      if (TERMINAL_PROCESSING_STATES[existing.state]) {
        if (
          existing.state === outcome &&
          (!options?.workId || existing.workId === options.workId)
        ) {
          return; // Idempotent no-op
        }
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_TRANSITION,
          `Entry is already in terminal state ${existing.state}; cannot transition to ${outcome}`,
        );
      }

      // Validate permitted transition
      if (outcome === "completed" && existing.state !== "started") {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_TRANSITION,
          `Cannot complete entry in state ${existing.state}; completed requires started state`,
        );
      }

      // Receipt correlation checks
      if (
        options?.workId !== undefined &&
        (typeof options.workId !== "string" || options.workId.trim() === "")
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_KEY,
          "Provided workId must be a non-empty string",
        );
      }
      if (outcome === "completed" && !options?.workId && !existing.workId) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.INVALID_KEY,
          "Completing a started entry requires a workId",
        );
      }
      if (
        options?.workId &&
        existing.workId &&
        options.workId !== existing.workId
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.IMMUTABLE_ID_MISMATCH,
          `workId mismatch: entry has ${existing.workId}, receipt provided ${options.workId}`,
        );
      }

      const now = new Date().toISOString();
      const assignedWorkId = options?.workId ?? existing.workId;
      const record: MailboxEntryRecord = {
        key: validKey,
        state: outcome,
        sourceRecordId: existing.sourceRecordId,
        workId: assignedWorkId,
        detail: options?.detail,
        timestamp: now,
      };

      const canonicalRoot = await canonicalizeRoot(this.emailRoot);
      await appendDurable<MailboxEntryRecord>(
        canonicalRoot,
        PROCESSING_JOURNAL_FILENAME,
        record,
        this.durableOptions,
      );

      existing.state = outcome;
      existing.workId = assignedWorkId;
      existing.detail = options?.detail;
      existing.updatedAt = now;
    });
  }

  /**
   * Validates and replays a record into the in-memory entry map.
   */
  private replayRecord(record: unknown): void {
    if (!record || typeof record !== "object") {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_CORRUPT,
        "Journal entry record is not an object",
      );
    }

    const r = record as Partial<MailboxEntryRecord>;
    const validKey = validateMailboxKey(
      r.key,
      this.configuredFingerprint,
    );

    if (this.snapshot && validKey.uidValidity !== this.snapshot.uidValidity) {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_CORRUPT,
        `Journal record uidValidity ${validKey.uidValidity} does not match snapshot uidValidity ${this.snapshot.uidValidity}`,
      );
    }

    if (
      typeof r.state !== "string" ||
      !(
        r.state === "discovered" ||
        r.state === "accepted" ||
        r.state === "started" ||
        r.state === "completed" ||
        r.state === "ignored" ||
        r.state === "failed" ||
        r.state === "review-required"
      )
    ) {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_CORRUPT,
        "Journal entry record contains invalid state",
      );
    }

    // Validate state-specific required identifiers in replay
    if (r.state === "accepted") {
      if (typeof r.sourceRecordId !== "string" || r.sourceRecordId.trim() === "") {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Journal record in accepted state missing valid sourceRecordId for UID ${validKey.uid}`,
        );
      }
    } else if (r.state === "started") {
      if (typeof r.workId !== "string" || r.workId.trim() === "") {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Journal record in started state missing valid workId for UID ${validKey.uid}`,
        );
      }
    }

    if (r.detail !== undefined && typeof r.detail !== "string") {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_CORRUPT,
        `Journal record detail must be a string for UID ${validKey.uid}`,
      );
    }

    const formatted = formatMailboxKey(validKey);
    const existing = this.entries.get(formatted);

    if (!existing) {
      // First state for this entry
      if (
        r.state !== "discovered" &&
        r.state !== "accepted" &&
        r.state !== "ignored" &&
        r.state !== "failed" &&
        r.state !== "review-required"
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Invalid initial state ${r.state} in journal for UID ${validKey.uid}`,
        );
      }
      this.entries.set(formatted, {
        key: validKey,
        state: r.state,
        sourceRecordId: r.sourceRecordId,
        workId: r.workId,
        detail: r.detail,
        firstDiscoveredAt: r.timestamp ?? new Date().toISOString(),
        updatedAt: r.timestamp ?? new Date().toISOString(),
      });
      return;
    }

    // Existing entry transition check
    if (TERMINAL_PROCESSING_STATES[existing.state]) {
      if (existing.state === r.state) {
        if (r.workId && existing.workId && r.workId !== existing.workId) {
          throw new MailboxStoreError(
            MailboxDiagnosticCode.STORE_CORRUPT,
            `Conflicting workId in repeated terminal record for UID ${validKey.uid}`,
          );
        }
        return; // harmless repeat
      }
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_CORRUPT,
        `Illegal replay transition: entry UID ${validKey.uid} is in terminal state ${existing.state}, cannot transition to ${r.state}`,
      );
    }

    // Check valid transitions
    if (existing.state === "discovered") {
      if (
        r.state !== "accepted" &&
        r.state !== "ignored" &&
        r.state !== "failed" &&
        r.state !== "review-required"
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Illegal replay transition from discovered to ${r.state}`,
        );
      }
    } else if (existing.state === "accepted") {
      if (
        r.state !== "started" &&
        r.state !== "ignored" &&
        r.state !== "failed" &&
        r.state !== "review-required"
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Illegal replay transition from accepted to ${r.state}`,
        );
      }
    } else if (existing.state === "started") {
      if (
        r.state !== "completed" &&
        r.state !== "ignored" &&
        r.state !== "failed" &&
        r.state !== "review-required"
      ) {
        throw new MailboxStoreError(
          MailboxDiagnosticCode.STORE_CORRUPT,
          `Illegal replay transition from started to ${r.state}`,
        );
      }
    }

    // Immutable ID check
    if (
      r.sourceRecordId && existing.sourceRecordId && r.sourceRecordId !== existing.sourceRecordId
    ) {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_CORRUPT,
        `sourceRecordId mismatch in replay for UID ${validKey.uid}`,
      );
    }
    if (r.workId && existing.workId && r.workId !== existing.workId) {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.STORE_CORRUPT,
        `workId mismatch in replay for UID ${validKey.uid}`,
      );
    }

    existing.state = r.state;
    if (r.sourceRecordId) existing.sourceRecordId = r.sourceRecordId;
    if (r.workId) existing.workId = r.workId;
    if (r.detail) existing.detail = r.detail;
    if (r.timestamp) existing.updatedAt = r.timestamp;
  }

  private ensureReady(): void {
    if (!this.isRecovered || !this.snapshot) {
      throw new MailboxStoreError(
        MailboxDiagnosticCode.NOT_INITIALIZED,
        "MailboxStore is not initialized or recovered",
      );
    }
  }
}
