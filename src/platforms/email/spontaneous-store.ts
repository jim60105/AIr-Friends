// src/platforms/email/spontaneous-store.ts
//
// Durable spontaneous schedule occurrence identity for the email platform.
// Owned by `email-spontaneous-occurrences`.
//
// The authoritative email spontaneous schedule state is the fsynced
// `<emailRoot>/spontaneous.json` snapshot written exclusively through the
// crash-safe primitives of `durable-files.ts` (row 02). Discord and Misskey keep
// their existing best-effort `scheduler-state.json` scheduling; this store is
// never used for them.
//
// Snapshot shape (single JSON document, one `replaceSnapshot` call per mutation):
//
//   {
//     "v": 1,
//     "occurrence": { "occurrenceId", "dueAt", "status", "target"? },
//     "previous":   { "occurrenceId", "dueAt", "status", "target"? } | null
//   }
//
// `occurrence` is the active occurrence of the lane: the only record that may be
// dispatched, and the only record whose status is `scheduled`/`selected`/
// `started`. `previous` retains the immediately preceding occurrence with its
// terminal status (`completed`/`review-required`) while its successor is
// planned. A terminal result and its successor successor are therefore visible
// in one atomically replaced document: the previous occurrence is kept until its
// terminal result and its successor occurrence are replaced together in the same
// snapshot. The append-only `submissions.jsonl` journal (row 04) remains the
// authoritative ledger of outbound operation evidence; this snapshot keeps only
// the immediately preceding terminal occurrence.
//
// Durability makes `replaceSnapshot` atomic in visibility (readers observe a
// complete old or complete new document), not transactional: the rename happens
// before the parent directory fsync, so a rejection after the rename leaves the
// new complete document on disk. Callers must therefore treat a rejected write
// as an uncertain commit, stop the lane for review, and inspect the snapshot
// again on the next startup instead of rolling back or allocating another
// identity.

import { BaseError, ErrorCode } from "../../types/errors.ts";
import { createLogger } from "@utils/logger.ts";
import type { EmailOperationKey, SubmissionEntrySnapshot } from "./submission-store.ts";
import {
  assertSafePath,
  canonicalizeRoot,
  DurableDiagnosticCode,
  DurableFileError,
  DurableFileOptions,
  replaceSnapshot,
} from "./durable-files.ts";

const logger = createLogger("EmailSpontaneousStore");

/** Snapshot filename relative to the email state root (e.g. `data/email/spontaneous.json`). */
export const SPONTANEOUS_SNAPSHOT_FILENAME = "spontaneous.json";

/** Snapshot envelope version accepted by this store. */
export const SPONTANEOUS_SNAPSHOT_VERSION = 1;

/**
 * Lifecycle status of a spontaneous occurrence.
 * - `scheduled`: durable identity and due time exist; no target bound yet.
 * - `selected`: an owner/thread target is durably bound, before any session or SMTP work.
 * - `started`: dispatch of the bound occurrence is durably claimed.
 * - `completed`: the dispatch attempt reached its end without unresolved delivery uncertainty.
 * - `review-required`: delivery is uncertain or the attempt could not be resolved; never re-fired.
 */
export type SpontaneousOccurrenceStatus =
  | "scheduled"
  | "selected"
  | "started"
  | "completed"
  | "review-required";

/** Terminal occurrence statuses. A terminal occurrence is never dispatched again. */
export type SpontaneousTerminalStatus = "completed" | "review-required";

/** Bound delivery target of one occurrence. */
export interface SpontaneousTarget {
  /** Owner of the thread receiving the message (`e_<sha256>` mailbox owner id). */
  owner: string;
  /** Internal thread identifier (`mail:<owner>:<threadId>` style thread component). */
  threadId: string;
}

/** One durable spontaneous occurrence. */
export interface SpontaneousOccurrence {
  occurrenceId: string;
  dueAt: Date;
  status: SpontaneousOccurrenceStatus;
  target?: SpontaneousTarget;
}

/** Complete durable schedule state of the email spontaneous lane. */
export interface SpontaneousScheduleState {
  /** Active occurrence of the lane, or null when the lane has no occurrence. */
  occurrence: SpontaneousOccurrence | null;
  /** Immediately preceding terminal occurrence, retained while its successor is planned. */
  previous: SpontaneousOccurrence | null;
}

/**
 * Classification of recorded outbound operation evidence for one occurrence.
 * - `none`: no operation was ever prepared for this occurrence.
 * - `prepared`: an operation exists but SMTP submission never began.
 * - `submitted`: SMTP accepted the message.
 * - `failed`: SMTP definitely rejected the message.
 * - `uncertain`: submission began and its outcome cannot be confirmed (`submitting`/`unknown`).
 */
export type SpontaneousEvidenceClass = "none" | "prepared" | "submitted" | "failed" | "uncertain";

/** Outcome reported by the dispatch attempt of an occurrence. */
export type SpontaneousDispatchOutcome = "completed" | "unavailable";

/**
 * Read-only view of the durable submission evidence owned by `email-submission-journal`.
 *
 * The provider MUST have completed its own startup recovery before it is attached;
 * a lookup performed before recovery cannot distinguish "no operation exists" from
 * "durable evidence was not loaded", so an unattached or unrecovered provider makes
 * a `started` occurrence fail closed as `uncertain`.
 */
export interface SpontaneousSubmissionEvidence {
  lookup(ownerId: string, key: EmailOperationKey): SubmissionEntrySnapshot | undefined;
}

/** Safe diagnostic codes for spontaneous occurrence state failures. */
export enum SpontaneousDiagnosticCode {
  CLEAN = "CLEAN",
  INVALID_OCCURRENCE = "INVALID_OCCURRENCE",
  INVALID_TARGET = "INVALID_TARGET",
  INVALID_TRANSITION = "INVALID_TRANSITION",
  INVALID_DUE_AT = "INVALID_DUE_AT",
  STORE_CORRUPT = "STORE_CORRUPT",
  STORE_BLOCKED = "STORE_BLOCKED",
  WRITE_FAILED = "WRITE_FAILED",
}

/** Error thrown by durable spontaneous occurrence operations, with safe diagnostics only. */
export class EmailSpontaneousStoreError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: SpontaneousDiagnosticCode;
  readonly durableCode?: DurableDiagnosticCode;
  readonly byteOffset?: number;

  constructor(
    diagnosticCode: SpontaneousDiagnosticCode,
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

/** Options accepted by {@link EmailSpontaneousStore}. */
export interface EmailSpontaneousStoreOptions {
  /** Email state root that holds the durable snapshot (e.g. `data/email`). */
  emailRoot: string;
  /** Recovered durable submission evidence used to forbid resubmission. */
  evidence?: SpontaneousSubmissionEvidence;
  /** Durable file limits forwarded to the snapshot writer. */
  durableOptions?: DurableFileOptions;
}

/**
 * The logical outbound operation key of one spontaneous occurrence.
 * `workId` and `actionSlot` both derive from the durable occurrence identity, so a
 * resumed, resumed-after-crash, or restarted occurrence can never authorize a second
 * SMTP transaction through a freshly generated work id. Downstream session and
 * submission callers MUST derive the key from this function.
 */
export function spontaneousOperationKey(occurrenceId: string): EmailOperationKey {
  return {
    workId: occurrenceId,
    actionSlot: `spontaneous:${occurrenceId}`,
  };
}

/** In-process per-root state: serialized mutations plus fail-closed damage fencing. */
interface SharedRootState {
  lock: Promise<void>;
  blocked: boolean;
}

const sharedRootRegistry = new Map<string, SharedRootState>();

function getOrCreateSharedRoot(canonicalRoot: string): SharedRootState {
  let shared = sharedRootRegistry.get(canonicalRoot);
  if (!shared) {
    shared = { lock: Promise.resolve(), blocked: false };
    sharedRootRegistry.set(canonicalRoot, shared);
  }
  return shared;
}

interface SpontaneousSnapshotRecord {
  occurrenceId: string;
  dueAt: string;
  status: SpontaneousOccurrenceStatus;
  target?: SpontaneousTarget;
}

interface SpontaneousSnapshot {
  v: number;
  occurrence: SpontaneousSnapshotRecord | null;
  previous: SpontaneousSnapshotRecord | null;
}

const EMPTY_STATE: SpontaneousScheduleState = { occurrence: null, previous: null };

/**
 * Durable owner of the email spontaneous schedule occurrence identity.
 *
 * All mutations are serialized per canonical state root and persist through the
 * crash-safe snapshot writer of `durable-files.ts` before any timer is armed,
 * before any target is used for a session, and before any SMTP submission.
 * A rejected write fences the whole state root as `STORE_BLOCKED`, so automatic
 * work stops for review instead of allocating a replacement identity.
 */
export class EmailSpontaneousStore {
  private readonly emailRoot: string;
  private readonly evidence?: SpontaneousSubmissionEvidence;
  private readonly durableOptions?: DurableFileOptions;

  constructor(options: EmailSpontaneousStoreOptions) {
    if (!options?.emailRoot || typeof options.emailRoot !== "string") {
      throw new EmailSpontaneousStoreError(
        SpontaneousDiagnosticCode.STORE_CORRUPT,
        "EmailSpontaneousStore requires a non-empty email state root",
      );
    }
    this.emailRoot = options.emailRoot;
    this.evidence = options.evidence;
    this.durableOptions = options.durableOptions;
  }

  /**
   * Read the durable schedule state.
   * Returns an empty state when no snapshot exists. Malformed, incomplete, or
   * semantically invalid content fails closed with `STORE_CORRUPT`; it is never
   * repaired or overwritten, so the email spontaneous lane stays blocked.
   */
  async restore(): Promise<SpontaneousScheduleState> {
    const canonicalRoot = await canonicalizeRoot(this.emailRoot);
    const shared = getOrCreateSharedRoot(canonicalRoot);
    return await this.withLock(shared, async () => {
      return await this.readState(canonicalRoot);
    });
  }

  /**
   * The occurrence a restored lane must work on.
   * Null means no occurrence may be dispatched: either the lane has no occurrence yet
   * (`state.occurrence === null`) or the retained occurrence is terminal and requires
   * operator review.
   */
  activeOccurrence(state: SpontaneousScheduleState): SpontaneousOccurrence | null {
    const occurrence = state.occurrence;
    if (
      !occurrence ||
      occurrence.status === "completed" ||
      occurrence.status === "review-required"
    ) {
      return null;
    }
    return occurrence;
  }

  /**
   * Persist a fresh scheduled occurrence before any timer is armed.
   * Only an empty lane may schedule; any existing occurrence must be resolved first.
   */
  async schedule(dueAt: Date): Promise<SpontaneousOccurrence> {
    assertValidDate(dueAt, "dueAt");
    const canonicalRoot = await canonicalizeRoot(this.emailRoot);
    const shared = getOrCreateSharedRoot(canonicalRoot);
    return await this.withLock(shared, async () => {
      const state = await this.readState(canonicalRoot);
      if (state.occurrence !== null) {
        throw new EmailSpontaneousStoreError(
          SpontaneousDiagnosticCode.INVALID_TRANSITION,
          "Cannot schedule a new occurrence while an occurrence is already persisted",
        );
      }
      const occurrence: SpontaneousOccurrence = {
        occurrenceId: crypto.randomUUID(),
        dueAt,
        status: "scheduled",
      };
      await this.writeState(canonicalRoot, { occurrence, previous: null });
      return occurrence;
    });
  }

  /**
   * Durably bind the owner/thread target of the active occurrence before any session or
   * SMTP work. Repeating the identical binding is a no-op; a different target is refused
   * so a restored occurrence can never be re-identified to another recipient.
   */
  async select(occurrenceId: string, target: SpontaneousTarget): Promise<SpontaneousOccurrence> {
    assertValidOccurrenceId(occurrenceId);
    assertValidTarget(target);
    const canonicalRoot = await canonicalizeRoot(this.emailRoot);
    const shared = getOrCreateSharedRoot(canonicalRoot);
    return await this.withLock(shared, async () => {
      const state = await this.readState(canonicalRoot);
      const active = this.requireActiveOccurrence(state, occurrenceId);
      if (active.status === "selected" && active.target) {
        if (active.target.owner === target.owner && active.target.threadId === target.threadId) {
          return active;
        }
        throw new EmailSpontaneousStoreError(
          SpontaneousDiagnosticCode.INVALID_TRANSITION,
          "Occurrence target is already bound and cannot be replaced",
        );
      }
      if (active.status !== "scheduled") {
        throw new EmailSpontaneousStoreError(
          SpontaneousDiagnosticCode.INVALID_TRANSITION,
          "Only a scheduled occurrence can bind a target",
        );
      }
      const selected: SpontaneousOccurrence = { ...active, status: "selected", target };
      await this.writeState(canonicalRoot, {
        occurrence: selected,
        previous: state.previous,
      });
      return selected;
    });
  }

  /**
   * Durably claim the bound occurrence before a session or SMTP submission starts.
   * Requires a previously persisted target so no dispatch can run unbound.
   */
  async begin(occurrenceId: string): Promise<SpontaneousOccurrence> {
    assertValidOccurrenceId(occurrenceId);
    const canonicalRoot = await canonicalizeRoot(this.emailRoot);
    const shared = getOrCreateSharedRoot(canonicalRoot);
    return await this.withLock(shared, async () => {
      const state = await this.readState(canonicalRoot);
      const active = this.requireActiveOccurrence(state, occurrenceId);
      if (active.status === "started") {
        return active;
      }
      if (active.status !== "selected" || !active.target) {
        throw new EmailSpontaneousStoreError(
          SpontaneousDiagnosticCode.INVALID_TRANSITION,
          "Occurrence must have a durably bound target before dispatch starts",
        );
      }
      const started: SpontaneousOccurrence = { ...active, status: "started" };
      await this.writeState(canonicalRoot, {
        occurrence: started,
        previous: state.previous,
      });
      return started;
    });
  }

  /**
   * Classify the recorded outbound operation evidence of one occurrence (read-only).
   * Fails closed as `uncertain` when a delivery may have happened but cannot be verified:
   * a bound occurrence with no attached (recovered) evidence provider is never assumed clean.
   */
  inspectEvidence(occurrence: SpontaneousOccurrence): SpontaneousEvidenceClass {
    if (!occurrence.target) {
      // No target was ever bound, so no submission intent can exist for this occurrence.
      return "none";
    }
    if (!this.evidence) {
      return "uncertain";
    }
    const entry = this.evidence.lookup(
      occurrence.target.owner,
      spontaneousOperationKey(occurrence.occurrenceId),
    );
    if (!entry) {
      return "none";
    }
    switch (entry.phase) {
      case "prepared":
        return "prepared";
      case "submitted":
        return "submitted";
      case "failed":
        return "failed";
      case "submitting":
      case "unknown":
        return "uncertain";
      default:
        return "uncertain";
    }
  }

  /**
   * True when the occurrence's delivery is already resolved and it must not be dispatched
   * again (SMTP accepted it, or its outcome is uncertain and requires review).
   */
  deliveryResolved(occurrence: SpontaneousOccurrence): boolean {
    const cls = this.inspectEvidence(occurrence);
    return cls === "submitted" || cls === "uncertain";
  }

  /**
   * Terminalize the active occurrence and install its distinct successor in ONE atomic
   * snapshot write. The terminal result of the current occurrence and the successor are
   * both visible in the same replaced document, and the successor identity is always new,
   * so a restarted lane can never retry the occurrence under a replacement identity.
   *
   * A rejected write fences the state root: nothing is rolled back and no other identity is
   * allocated, so the caller must stop automatic work for review.
   */
  async finishAndScheduleNext(
    occurrenceId: string,
    outcome: SpontaneousDispatchOutcome,
    nextDueAt: Date,
  ): Promise<SpontaneousOccurrence> {
    assertValidOccurrenceId(occurrenceId);
    assertValidDate(nextDueAt, "nextDueAt");
    const canonicalRoot = await canonicalizeRoot(this.emailRoot);
    const shared = getOrCreateSharedRoot(canonicalRoot);
    return await this.withLock(shared, async () => {
      const state = await this.readState(canonicalRoot);
      const active = this.requireActiveOccurrence(state, occurrenceId);
      const status = terminalStatusFor(this.inspectEvidence(active), outcome);
      const successor: SpontaneousOccurrence = {
        occurrenceId: crypto.randomUUID(),
        dueAt: nextDueAt,
        status: "scheduled",
      };
      await this.writeState(canonicalRoot, {
        occurrence: successor,
        previous: { ...active, status },
      });
      return successor;
    });
  }

  private requireActiveOccurrence(
    state: SpontaneousScheduleState,
    occurrenceId: string,
  ): SpontaneousOccurrence {
    const active = this.activeOccurrence(state);
    if (!active || active.occurrenceId !== occurrenceId) {
      throw new EmailSpontaneousStoreError(
        SpontaneousDiagnosticCode.INVALID_OCCURRENCE,
        "No active occurrence matches the requested identity",
      );
    }
    return active;
  }

  /**
   * Serialize one state-root mutation and fence the root when the durable state cannot be
   * trusted.
   *
   * A rejected write (`WRITE_FAILED`) is an uncertain commit, and an unreadable or invalid
   * snapshot (`STORE_CORRUPT`) means the lane cannot be inspected at all; both fence the root
   * (`STORE_BLOCKED`) so no later caller can allocate a replacement identity. Refusals that
   * merely reject an illegal transition leave the durable state trustworthy and do not fence.
   */
  private async withLock<R>(
    shared: SharedRootState,
    fn: () => Promise<R>,
  ): Promise<R> {
    let release!: () => void;
    const ticket = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = shared.lock;
    shared.lock = previous.then(
      () => ticket,
      () => ticket,
    );
    await previous;
    try {
      if (shared.blocked) {
        throw new EmailSpontaneousStoreError(
          SpontaneousDiagnosticCode.STORE_BLOCKED,
          "Spontaneous schedule state is fenced after a failed durable write",
        );
      }
      return await fn();
    } catch (error) {
      if (
        error instanceof EmailSpontaneousStoreError &&
        (error.diagnosticCode === SpontaneousDiagnosticCode.WRITE_FAILED ||
          error.diagnosticCode === SpontaneousDiagnosticCode.STORE_CORRUPT)
      ) {
        shared.blocked = true;
      }
      throw error;
    } finally {
      release();
    }
  }

  private async readState(canonicalRoot: string): Promise<SpontaneousScheduleState> {
    const filePath = await assertSafePath(canonicalRoot, SPONTANEOUS_SNAPSHOT_FILENAME);
    let text: string;
    try {
      text = await Deno.readTextFile(filePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return EMPTY_STATE;
      }
      throw new EmailSpontaneousStoreError(
        SpontaneousDiagnosticCode.STORE_CORRUPT,
        "Failed to read the durable spontaneous schedule snapshot",
      );
    }
    return parseSnapshot(text);
  }

  private async writeState(
    canonicalRoot: string,
    state: SpontaneousScheduleState,
  ): Promise<void> {
    try {
      const snapshot: SpontaneousSnapshot = {
        v: SPONTANEOUS_SNAPSHOT_VERSION,
        occurrence: state.occurrence ? toRecord(state.occurrence) : null,
        previous: state.previous ? toRecord(state.previous) : null,
      };
      await replaceSnapshot(
        canonicalRoot,
        SPONTANEOUS_SNAPSHOT_FILENAME,
        snapshot,
        this.durableOptions,
      );
    } catch (error) {
      const durableCode = error instanceof DurableFileError ? error.diagnosticCode : undefined;
      logger.error("Spontaneous schedule snapshot write failed; lane fenced", {
        durableCode: durableCode ?? DurableDiagnosticCode.WRITE_FAILED,
      });
      throw new EmailSpontaneousStoreError(
        SpontaneousDiagnosticCode.WRITE_FAILED,
        "Failed to durably replace the spontaneous schedule snapshot",
        { durableCode },
      );
    }
  }
}

function terminalStatusFor(
  cls: SpontaneousEvidenceClass,
  outcome: SpontaneousDispatchOutcome,
): SpontaneousTerminalStatus {
  if (cls === "uncertain") {
    return "review-required";
  }
  if (cls === "submitted" || cls === "failed") {
    // Accepted, or definitely rejected: the attempt is resolved and nothing is uncertain.
    return "completed";
  }
  return outcome === "completed" ? "completed" : "review-required";
}

function toRecord(occurrence: SpontaneousOccurrence): SpontaneousSnapshotRecord {
  const record: SpontaneousSnapshotRecord = {
    occurrenceId: occurrence.occurrenceId,
    dueAt: occurrence.dueAt.toISOString(),
    status: occurrence.status,
  };
  if (occurrence.target) {
    record.target = { owner: occurrence.target.owner, threadId: occurrence.target.threadId };
  }
  return record;
}

function parseSnapshot(text: string): SpontaneousScheduleState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      "Spontaneous schedule snapshot is not valid JSON",
    );
  }
  if (!isPlainObject(parsed) || parsed.v !== SPONTANEOUS_SNAPSHOT_VERSION) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      "Spontaneous schedule snapshot has an unsupported envelope",
    );
  }
  // Both slots must be present; `null` is the explicit empty slot. An envelope that simply
  // omits them is an incomplete document, not a pristine lane, and must never be overwritten.
  if (!("occurrence" in parsed) || !("previous" in parsed)) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      "Spontaneous schedule snapshot envelope is incomplete",
    );
  }
  const occurrence = parseRecord(parsed.occurrence, "occurrence");
  const previous = parseRecord(parsed.previous, "previous");

  if (previous && previous.status !== "completed" && previous.status !== "review-required") {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      "Retained previous occurrence must be terminal",
    );
  }
  if (previous && !occurrence) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      "Retained previous occurrence requires a planned successor occurrence",
    );
  }
  if (occurrence && previous && occurrence.occurrenceId === previous.occurrenceId) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      "Occurrence and retained previous occurrence must have distinct identities",
    );
  }

  return {
    occurrence: occurrence ? fromRecord(occurrence) : null,
    previous: previous ? fromRecord(previous) : null,
  };
}

function parseRecord(value: unknown, slot: string): SpontaneousSnapshotRecord | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isPlainObject(value)) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      `Spontaneous snapshot ${slot} record is malformed`,
    );
  }
  const occurrenceId = value.occurrenceId;
  const dueAt = value.dueAt;
  const status = value.status;
  if (typeof occurrenceId !== "string" || occurrenceId.trim() === "") {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      `Spontaneous snapshot ${slot} record has no occurrence identity`,
    );
  }
  if (typeof dueAt !== "string" || isNaN(new Date(dueAt).getTime())) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      `Spontaneous snapshot ${slot} record has an invalid due time`,
    );
  }
  if (!isOccurrenceStatus(status)) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      `Spontaneous snapshot ${slot} record has an unsupported status`,
    );
  }

  const record: SpontaneousSnapshotRecord = { occurrenceId, dueAt, status };

  const rawTarget = value.target;
  if (rawTarget !== undefined && rawTarget !== null) {
    if (
      !isPlainObject(rawTarget) ||
      typeof rawTarget.owner !== "string" || rawTarget.owner.trim() === "" ||
      typeof rawTarget.threadId !== "string" || rawTarget.threadId.trim() === ""
    ) {
      throw new EmailSpontaneousStoreError(
        SpontaneousDiagnosticCode.STORE_CORRUPT,
        `Spontaneous snapshot ${slot} record target is invalid`,
      );
    }
    record.target = { owner: rawTarget.owner, threadId: rawTarget.threadId };
  }

  // A dispatched occurrence must carry the target it was bound to; losing it would allow
  // an unbound dispatch or a new target selection for an occurrence that already ran.
  if ((status === "selected" || status === "started") && !record.target) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.STORE_CORRUPT,
      `Spontaneous snapshot ${slot} record lacks its bound target`,
    );
  }

  return record;
}

function fromRecord(record: SpontaneousSnapshotRecord): SpontaneousOccurrence {
  const occurrence: SpontaneousOccurrence = {
    occurrenceId: record.occurrenceId,
    dueAt: new Date(record.dueAt),
    status: record.status,
  };
  if (record.target) {
    occurrence.target = { owner: record.target.owner, threadId: record.target.threadId };
  }
  return occurrence;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOccurrenceStatus(value: unknown): value is SpontaneousOccurrenceStatus {
  return value === "scheduled" || value === "selected" || value === "started" ||
    value === "completed" || value === "review-required";
}

function assertValidOccurrenceId(occurrenceId: string): void {
  if (typeof occurrenceId !== "string" || occurrenceId.trim() === "") {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.INVALID_OCCURRENCE,
      "An occurrence identity is required",
    );
  }
}

function assertValidTarget(target: SpontaneousTarget): void {
  if (
    !target || typeof target.owner !== "string" || target.owner.trim() === "" ||
    typeof target.threadId !== "string" || target.threadId.trim() === ""
  ) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.INVALID_TARGET,
      "A non-empty owner and thread target is required",
    );
  }
}

function assertValidDate(value: Date, name: string): void {
  if (!(value instanceof Date) || isNaN(value.getTime())) {
    throw new EmailSpontaneousStoreError(
      SpontaneousDiagnosticCode.INVALID_DUE_AT,
      `A valid ${name} is required`,
    );
  }
}
