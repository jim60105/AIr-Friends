/**
 * src/platforms/email/message-store.ts
 *
 * Sender-scoped email message and thread history store owned by `email-message-history`.
 * Enforces owner-isolated message archiving, thread derivation solely from
 * RFC 5322 Message-ID / In-Reply-To / References (never subjects), immutable
 * source / attachment bytes indexed by internal UUIDs, channel validation
 * `mail:<userId>:<threadId>`, durable append-only thread journals, and
 * crash-safe recovery replaying in-memory indexes from disk.
 */

import { join, resolve } from "@std/path";
import { BaseError, ErrorCode } from "../../types/errors.ts";
import {
  appendDurable,
  assertSafePath,
  canonicalizeRoot,
  DEFAULT_MAX_JOURNAL_BYTES,
  DEFAULT_MAX_RECORD_BYTES,
  DurableDiagnosticCode,
  ensureDurableDir,
  readJournal,
  replaceSnapshot,
  syncDirectory,
} from "./durable-files.ts";
import type { EmailOperationKey } from "./submission-store.ts";
import { type NormalizedEmailMailbox, normalizeEmailMailbox } from "./email-identity.ts";
import type { Attachment, LocalEmailAttachment, PlatformMessage } from "../../types/events.ts";

/** Relative filename for owner thread association journal under `<ownerWorkspace>/email/` */
export const THREADS_JOURNAL_FILENAME = "threads.jsonl";

/** Subdirectories under `<ownerWorkspace>/email/` */
export const SOURCE_SUBDIR = "source";
export const PARSED_SUBDIR = "parsed";
export const ATTACHMENTS_SUBDIR = "attachments";

/** Pattern for validating owner userId (e.g., e_<64 hex lowercase chars>) */
export const OWNER_USER_ID_REGEX = /^e_[0-9a-f]{64}$/;

/** Pattern for validating UUIDv4 strings */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Pattern for validating channel IDs: mail:<ownerId>:<threadId> */
export const EMAIL_CHANNEL_ID_REGEX =
  /^mail:(e_[0-9a-f]{64}):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/** Diagnostic error codes for message store operations */
export enum MessageStoreDiagnosticCode {
  CLEAN = "CLEAN",
  INVALID_OWNER = "INVALID_OWNER",
  INVALID_THREAD_ID = "INVALID_THREAD_ID",
  INVALID_RECORD_ID = "INVALID_RECORD_ID",
  INVALID_CHANNEL_ID = "INVALID_CHANNEL_ID",
  INVALID_ATTACHMENT_ID = "INVALID_ATTACHMENT_ID",
  CROSS_OWNER_DENIED = "CROSS_OWNER_DENIED",
  MESSAGE_NOT_FOUND = "MESSAGE_NOT_FOUND",
  ATTACHMENT_NOT_FOUND = "ATTACHMENT_NOT_FOUND",
  SOURCE_NOT_FOUND = "SOURCE_NOT_FOUND",
  STORE_CORRUPT = "STORE_CORRUPT",
  STORE_CLOSED = "STORE_CLOSED",
  STORE_DAMAGED_APPEND_REFUSED = "STORE_DAMAGED_APPEND_REFUSED",
  CONFLICTING_OPERATION_PAYLOAD = "CONFLICTING_OPERATION_PAYLOAD",
  PATH_ESCAPE_DETECTED = "PATH_ESCAPE_DETECTED",
  WRITE_FAILED = "WRITE_FAILED",
}

/**
 * Custom error type for message store operations.
 * Extends BaseError with sanitized diagnostics that never disclose private message bodies.
 */
export class MessageStoreError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: MessageStoreDiagnosticCode;
  readonly durableCode?: DurableDiagnosticCode;

  constructor(
    diagnosticCode: MessageStoreDiagnosticCode,
    message: string,
    options?: {
      durableCode?: DurableDiagnosticCode;
      context?: Record<string, unknown>;
    },
  ) {
    super(`[${diagnosticCode}] ${message}`, {
      ...options?.context,
      diagnosticCode,
      durableCode: options?.durableCode,
    });
    this.diagnosticCode = diagnosticCode;
    this.durableCode = options?.durableCode;
  }
}

/** Header identifiers from RFC 5322 wire messages used for thread derivation */
export interface EmailMessageIdentifiers {
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}

/** Attachment payload info for storing decoded attachment bytes */
export interface StoreAttachmentPayload {
  id?: string;
  filename?: string;
  displayName?: string;
  mimeType: string;
  content: Uint8Array;
}

/** Metadata describing a stored attachment */
export interface StoredAttachmentMetadata {
  id: string;
  filename?: string;
  displayName?: string;
  mimeType: string;
  size: number;
}

/** Provenance breakdown matching Row 06 / Row 15 / Row 21 specs */
export interface EmailProvenance {
  authoredText: string;
  quotedText?: string;
  forwardedText?: string;
  status: "clean" | "ambiguous";
}

/** Parsed email data passed into putSource */
export interface ParsedEmailData {
  from: string;
  subject?: string;
  wireIds?: EmailMessageIdentifiers;
  plainBody: string;
  provenance?: EmailProvenance;
  attachments?: StoredAttachmentMetadata[];
  attachmentPayloads?: StoreAttachmentPayload[];
  sourceRef?: string;
  date?: string | Date;
}

/** Constructed outgoing message passed into putSent */
export interface ConstructedEmailData {
  messageId?: string;
  emlBytes: Uint8Array | string;
  digest?: string;
  historyBody: string;
  to: string;
  subject?: string;
  targetKind: "user" | "third-party";
  threadId?: string;
  wireIds?: EmailMessageIdentifiers;
  attachmentPayloads?: StoreAttachmentPayload[];
  attachments?: StoredAttachmentMetadata[];
  date?: string | Date;
}

/** Stored email record retrieved from the store */
export interface StoredEmailRecord {
  recordId: string;
  threadId: string;
  owner: string;
  direction: "inbound" | "outbound";
  from: string;
  to?: string;
  subject: string;
  wireMessageId?: string;
  inReplyTo?: string;
  references: string[];
  body: string;
  provenance?: EmailProvenance;
  attachments: StoredAttachmentMetadata[];
  timestamp: string;
  reviewRequired?: boolean;
  reviewReason?: string;
  targetKind?: "user" | "third-party";
  operationKey?: EmailOperationKey;
  rawSize: number;
}

/** Thread resolution result */
export interface ThreadResolutionResult {
  threadId: string;
  isNew: boolean;
  reviewRequired: boolean;
  reviewReason?: string;
  matchedWireIds: string[];
  unresolvedReferences: string[];
}

/** Journal record types for threads.jsonl */
export interface ThreadJournalEntryRecord {
  v: 1;
  seq: number;
  type: "inbound" | "outbound" | "review_flag";
  recordId: string;
  threadId: string;
  owner: string;
  wireMessageId?: string;
  inReplyTo?: string;
  references: string[];
  unresolvedReferences: string[];
  reviewRequired?: boolean;
  reviewReason?: string;
  direction: "inbound" | "outbound";
  targetKind?: "user" | "third-party";
  operationKey?: EmailOperationKey;
  operationDigest?: string;
  rawSize: number;
  timestamp: string;
}

/** Configuration options for EmailMessageStore */
export interface EmailMessageStoreOptions {
  /** Root directory where user workspaces reside (e.g. data/workspaces or data/workspaces/email) */
  workspacesRoot: string;
  /** Maximum journal bytes before compaction/rejection */
  maxJournalBytes?: number;
  /** Maximum record bytes */
  maxRecordBytes?: number;
}

/** Per-owner in-memory state */
interface OwnerState {
  isRecovered: boolean;
  isDamaged: boolean;
  nextSeq: number;
  /** threadId -> array of recordIds in chronological order */
  threads: Map<string, string[]>;
  /** wireMessageId -> set of threadIds that reference or define it */
  wireIdToThreads: Map<string, Set<string>>;
  /** wireMessageId -> set of recordIds claiming this messageId */
  wireIdToRecords: Map<string, Set<string>>;
  /** recordId -> StoredEmailRecord */
  records: Map<string, StoredEmailRecord>;
  /** operationKeyString -> recordId (for idempotent putSent) */
  operations: Map<string, { recordId: string; threadId: string; digest?: string }>;
  /** threadId -> boolean reviewRequired */
  threadReview: Map<string, { required: boolean; reason?: string }>;
}

/** Helper to validate email channel format `mail:<owner>:<threadId>` */
export function parseEmailChannelId(
  channelId: string,
): { owner: string; threadId: string } {
  const match = channelId.match(EMAIL_CHANNEL_ID_REGEX);
  if (!match) {
    throw new MessageStoreError(
      MessageStoreDiagnosticCode.INVALID_CHANNEL_ID,
      `Invalid email channel format: expected mail:<owner>:<threadId>, got "${channelId}"`,
      { context: { channelId } },
    );
  }
  return { owner: match[1].toLowerCase(), threadId: match[2].toLowerCase() };
}

/** Helper to format channel ID */
export function formatEmailChannelId(owner: string, threadId: string): string {
  validateOwnerId(owner);
  validateUuid(threadId, MessageStoreDiagnosticCode.INVALID_THREAD_ID);
  return `mail:${owner.toLowerCase()}:${threadId.toLowerCase()}`;
}

/** Helper to validate owner userId */
export function validateOwnerId(owner: string): string {
  if (typeof owner !== "string" || !OWNER_USER_ID_REGEX.test(owner.trim())) {
    throw new MessageStoreError(
      MessageStoreDiagnosticCode.INVALID_OWNER,
      `Invalid owner ID: must match e_<sha256 hex>, got "${owner}"`,
      { context: { owner } },
    );
  }
  return owner.trim().toLowerCase();
}

/** Helper to validate UUID string */
export function validateUuid(
  id: string,
  code: MessageStoreDiagnosticCode = MessageStoreDiagnosticCode.INVALID_RECORD_ID,
): string {
  if (typeof id !== "string" || !UUID_REGEX.test(id.trim())) {
    throw new MessageStoreError(
      code,
      `Invalid identifier: must be a valid UUID, got "${id}"`,
      { context: { id } },
    );
  }
  return id.trim().toLowerCase();
}

/**
 * Durable, sender-scoped message and thread history store for the email platform.
 */
export class EmailMessageStore {
  private readonly workspacesRoot: string;
  private readonly maxJournalBytes: number;
  private readonly maxRecordBytes: number;
  private readonly ownerStates = new Map<string, OwnerState>();
  private readonly ownerLocks = new Map<string, Promise<void>>();
  private isClosed = false;

  constructor(options: EmailMessageStoreOptions) {
    this.workspacesRoot = resolve(options.workspacesRoot);
    this.maxJournalBytes = options.maxJournalBytes ?? DEFAULT_MAX_JOURNAL_BYTES;
    this.maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  }

  /**
   * Get or resolve user's email directory root under `<workspacesRoot>/<owner>/email`
   * (or `<workspacesRoot>/email/<owner>/email` if workspacesRoot is data/workspaces).
   */
  async getOwnerEmailRoot(owner: string): Promise<string> {
    const validOwner = validateOwnerId(owner);
    const subPath = this.workspacesRoot.endsWith("/email") ||
        this.workspacesRoot.endsWith("\\email")
      ? join(this.workspacesRoot, validOwner, "email")
      : join(this.workspacesRoot, "email", validOwner, "email");

    const canonical = await canonicalizeRoot(subPath);
    return canonical;
  }

  /**
   * Thread derivation logic: resolves existing thread or creates new threadId based
   * strictly on RFC 5322 Message-ID, In-Reply-To, and References.
   * Subject lines NEVER join threads.
   */
  async resolveThread(
    owner: string,
    identifiers: EmailMessageIdentifiers,
  ): Promise<ThreadResolutionResult> {
    const validOwner = validateOwnerId(owner);
    return await this.withOwnerLock(validOwner, (state) => {
      return this.internalResolveThread(state, identifiers);
    });
  }

  /**
   * Stores raw incoming email source bytes, parses snapshot, attachment files,
   * and writes a durable thread journal entry.
   */
  async putSource(
    owner: string,
    boundedSource: Uint8Array | string,
    parsed: ParsedEmailData,
  ): Promise<string> {
    const validOwner = validateOwnerId(owner);
    const recordId = crypto.randomUUID().toLowerCase();

    const rawBytes = typeof boundedSource === "string"
      ? new TextEncoder().encode(boundedSource)
      : boundedSource;

    return await this.withOwnerLock(validOwner, async (state, emailRoot) => {
      // 1. Thread derivation
      const wireIds = parsed.wireIds ?? {};
      const resolution = this.internalResolveThread(state, wireIds);
      const threadId = resolution.threadId;

      // Check if duplicate wire Message-ID exists
      let reviewRequired = resolution.reviewRequired;
      let reviewReason = resolution.reviewReason;

      if (wireIds.messageId) {
        const existingRecordsForWireId = state.wireIdToRecords.get(wireIds.messageId);
        if (existingRecordsForWireId && existingRecordsForWireId.size > 0) {
          reviewRequired = true;
          reviewReason = reviewReason
            ? `${reviewReason}; duplicate wire Message-ID "${wireIds.messageId}"`
            : `Duplicate wire Message-ID "${wireIds.messageId}" claims existing message`;
        }
      }

      // 2. Ensure directories exist with mode 0700
      await ensureDurableDir(emailRoot, resolve(emailRoot, SOURCE_SUBDIR));
      await ensureDurableDir(emailRoot, resolve(emailRoot, PARSED_SUBDIR));
      await ensureDurableDir(emailRoot, resolve(emailRoot, ATTACHMENTS_SUBDIR));

      // 3. Write raw source bytes (.eml)
      const sourceRel = `${SOURCE_SUBDIR}/${recordId}.eml`;
      const sourcePath = await assertSafePath(emailRoot, sourceRel);
      await this.writeExclusiveFile(emailRoot, sourcePath, rawBytes);

      // 4. Write attachment payloads if provided; if metadata-only attachments exist without payloads or sourceRef,
      // reject or validate to avoid advertising unretrievable attachments
      if (
        parsed.attachments &&
        parsed.attachments.length > 0 &&
        (!parsed.attachmentPayloads || parsed.attachmentPayloads.length === 0) &&
        !parsed.sourceRef
      ) {
        throw new MessageStoreError(
          MessageStoreDiagnosticCode.ATTACHMENT_NOT_FOUND,
          "Cannot ingest attachment metadata without attachment payload bytes or sourceRef",
          {
            context: {
              attachmentCount: parsed.attachments.length,
            },
          },
        );
      }

      const storedAttachments: StoredAttachmentMetadata[] = [];
      if (parsed.attachmentPayloads && parsed.attachmentPayloads.length > 0) {
        const attDirRel = `${ATTACHMENTS_SUBDIR}/${recordId}`;
        const attDir = await assertSafePath(emailRoot, attDirRel);
        await ensureDurableDir(emailRoot, attDir);

        for (const payload of parsed.attachmentPayloads) {
          const attId = payload.id && UUID_REGEX.test(payload.id)
            ? payload.id.toLowerCase()
            : crypto.randomUUID().toLowerCase();

          const attRel = `${ATTACHMENTS_SUBDIR}/${recordId}/${attId}`;
          const attPath = await assertSafePath(emailRoot, attRel);
          await this.writeExclusiveFile(emailRoot, attPath, payload.content);

          storedAttachments.push({
            id: attId,
            filename: payload.filename ?? payload.displayName ?? "attachment",
            displayName: payload.displayName ?? payload.filename ?? "attachment",
            mimeType: payload.mimeType,
            size: payload.content.byteLength,
          });
        }
      } else if (parsed.attachments) {
        storedAttachments.push(...parsed.attachments);
      }

      // 5. Write parsed JSON snapshot
      const parsedRel = `${PARSED_SUBDIR}/${recordId}.json`;
      const storedRecord: StoredEmailRecord = {
        recordId,
        threadId,
        owner: validOwner,
        direction: "inbound",
        from: parsed.from,
        subject: parsed.subject ?? "(no subject)",
        wireMessageId: wireIds.messageId,
        inReplyTo: wireIds.inReplyTo,
        references: wireIds.references ?? [],
        body: parsed.plainBody,
        provenance: parsed.provenance,
        attachments: storedAttachments,
        timestamp: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
        reviewRequired,
        reviewReason,
        rawSize: rawBytes.byteLength,
      };

      await replaceSnapshot(emailRoot, parsedRel, storedRecord, {
        maxRecordBytes: this.maxRecordBytes,
      });

      // 6. Append durable thread journal record
      const journalRecord: ThreadJournalEntryRecord = {
        v: 1,
        seq: state.nextSeq++,
        type: "inbound",
        recordId,
        threadId,
        owner: validOwner,
        wireMessageId: wireIds.messageId,
        inReplyTo: wireIds.inReplyTo,
        references: wireIds.references ?? [],
        unresolvedReferences: resolution.unresolvedReferences,
        reviewRequired,
        reviewReason,
        direction: "inbound",
        rawSize: rawBytes.byteLength,
        timestamp: storedRecord.timestamp,
      };

      try {
        await appendDurable(
          emailRoot,
          THREADS_JOURNAL_FILENAME,
          journalRecord,
          {
            maxJournalBytes: this.maxJournalBytes,
            maxRecordBytes: this.maxRecordBytes,
          },
        );
      } catch (err) {
        state.isDamaged = true;
        throw new MessageStoreError(
          MessageStoreDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
          "Failed to append inbound thread journal entry",
          {
            context: { recordId, cause: String(err) },
          },
        );
      }

      // 7. Update in-memory state
      this.applyJournalRecordToState(state, journalRecord, storedRecord);

      return recordId;
    });
  }

  /**
   * Durably records an outbound message constructed by the service/skill.
   * Enforces that outbound third-party conversation data is NOT inserted into
   * the initiating-user reply thread. Idempotent across repeated calls with identical operationKey.
   */
  async putSent(
    owner: string,
    constructedMessage: ConstructedEmailData,
    operation: EmailOperationKey,
  ): Promise<{ recordId: string; threadId: string }> {
    const validOwner = validateOwnerId(owner);
    const opKeyStr = `${operation.workId}:${operation.actionSlot}`;

    const rawBytes = typeof constructedMessage.emlBytes === "string"
      ? new TextEncoder().encode(constructedMessage.emlBytes)
      : constructedMessage.emlBytes;

    return await this.withOwnerLock(validOwner, async (state, emailRoot) => {
      // Check existing operation reservation
      const existingOp = state.operations.get(opKeyStr);
      if (existingOp) {
        if (
          constructedMessage.digest &&
          existingOp.digest &&
          constructedMessage.digest !== existingOp.digest
        ) {
          throw new MessageStoreError(
            MessageStoreDiagnosticCode.CONFLICTING_OPERATION_PAYLOAD,
            "Operation key already exists with differing message digest",
            { context: { operation, existingRecordId: existingOp.recordId } },
          );
        }
        return { recordId: existingOp.recordId, threadId: existingOp.threadId };
      }

      // Determine thread association
      let threadId: string;
      let reviewRequired = false;
      let reviewReason: string | undefined;
      if (constructedMessage.targetKind === "third-party") {
        // Third-party sends always belong to a distinct third-party conversation thread
        threadId = crypto.randomUUID().toLowerCase();
      } else if (constructedMessage.threadId) {
        // Explicit reply thread
        threadId = validateUuid(
          constructedMessage.threadId,
          MessageStoreDiagnosticCode.INVALID_THREAD_ID,
        );
      } else {
        // Resolve via wireIds if present
        const res = this.internalResolveThread(
          state,
          constructedMessage.wireIds ?? {},
        );
        threadId = res.threadId;
        reviewRequired = res.reviewRequired;
        reviewReason = res.reviewReason;
      }

      const recordId = crypto.randomUUID().toLowerCase();

      // Ensure directories
      await ensureDurableDir(emailRoot, resolve(emailRoot, SOURCE_SUBDIR));
      await ensureDurableDir(emailRoot, resolve(emailRoot, PARSED_SUBDIR));

      // Write source .eml
      const sourceRel = `${SOURCE_SUBDIR}/${recordId}.eml`;
      const sourcePath = await assertSafePath(emailRoot, sourceRel);
      await this.writeExclusiveFile(emailRoot, sourcePath, rawBytes);

      // Write outgoing attachment payloads if provided
      const storedAttachments: StoredAttachmentMetadata[] = [];
      if (
        constructedMessage.attachmentPayloads && constructedMessage.attachmentPayloads.length > 0
      ) {
        const attDirRel = `${ATTACHMENTS_SUBDIR}/${recordId}`;
        const attDir = await assertSafePath(emailRoot, attDirRel);
        await ensureDurableDir(emailRoot, attDir);

        for (const payload of constructedMessage.attachmentPayloads) {
          const attId = payload.id && UUID_REGEX.test(payload.id)
            ? payload.id.toLowerCase()
            : crypto.randomUUID().toLowerCase();
          const attRel = `${ATTACHMENTS_SUBDIR}/${recordId}/${attId}`;
          const attPath = await assertSafePath(emailRoot, attRel);
          await this.writeExclusiveFile(emailRoot, attPath, payload.content);

          storedAttachments.push({
            id: attId,
            filename: payload.filename ?? payload.displayName ?? "attachment",
            displayName: payload.displayName ?? payload.filename ?? "attachment",
            mimeType: payload.mimeType,
            size: payload.content.byteLength,
          });
        }
      }

      // Write parsed snapshot
      const parsedRel = `${PARSED_SUBDIR}/${recordId}.json`;
      const wireIds = constructedMessage.wireIds ?? {};
      const storedRecord: StoredEmailRecord = {
        recordId,
        threadId,
        owner: validOwner,
        direction: "outbound",
        from: validOwner,
        to: constructedMessage.to,
        subject: constructedMessage.subject ?? "(sent message)",
        wireMessageId: constructedMessage.messageId ?? wireIds.messageId,
        inReplyTo: wireIds.inReplyTo,
        references: wireIds.references ?? [],
        body: constructedMessage.historyBody,
        attachments: storedAttachments,
        timestamp: constructedMessage.date
          ? new Date(constructedMessage.date).toISOString()
          : new Date().toISOString(),
        reviewRequired,
        reviewReason,
        targetKind: constructedMessage.targetKind,
        operationKey: operation,
        rawSize: rawBytes.byteLength,
      };

      await replaceSnapshot(emailRoot, parsedRel, storedRecord, {
        maxRecordBytes: this.maxRecordBytes,
      });

      // Append durable thread journal record
      const journalRecord: ThreadJournalEntryRecord = {
        v: 1,
        seq: state.nextSeq++,
        type: "outbound",
        recordId,
        threadId,
        owner: validOwner,
        wireMessageId: storedRecord.wireMessageId,
        inReplyTo: wireIds.inReplyTo,
        references: wireIds.references ?? [],
        unresolvedReferences: [],
        reviewRequired,
        reviewReason,
        direction: "outbound",
        targetKind: constructedMessage.targetKind,
        operationKey: operation,
        operationDigest: constructedMessage.digest,
        rawSize: rawBytes.byteLength,
        timestamp: storedRecord.timestamp,
      };

      try {
        await appendDurable(
          emailRoot,
          THREADS_JOURNAL_FILENAME,
          journalRecord,
          {
            maxJournalBytes: this.maxJournalBytes,
            maxRecordBytes: this.maxRecordBytes,
          },
        );
      } catch (err) {
        state.isDamaged = true;
        throw new MessageStoreError(
          MessageStoreDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
          "Failed to append outbound thread journal entry",
          {
            context: { recordId, cause: String(err) },
          },
        );
      }

      this.applyJournalRecordToState(state, journalRecord, storedRecord);

      return { recordId, threadId };
    });
  }

  /**
   * Get message record by owner, threadId, and recordId.
   * Enforces owner and thread boundaries strictly.
   */
  async get(
    owner: string,
    threadId: string,
    recordId: string,
  ): Promise<StoredEmailRecord | undefined> {
    const validOwner = validateOwnerId(owner);
    const validThread = validateUuid(
      threadId,
      MessageStoreDiagnosticCode.INVALID_THREAD_ID,
    );
    const validRecord = validateUuid(
      recordId,
      MessageStoreDiagnosticCode.INVALID_RECORD_ID,
    );

    return await this.withOwnerLock(validOwner, (state) => {
      const record = state.records.get(validRecord);
      if (!record) return undefined;
      if (record.owner !== validOwner || record.threadId !== validThread) {
        return undefined;
      }
      return this.cloneRecord(record);
    });
  }

  /**
   * Owner-scoped lookup of a stored record by recordId alone (used for forwarding preflight).
   */
  async getByOwnerRecord(
    owner: string,
    recordId: string,
  ): Promise<StoredEmailRecord | undefined> {
    const validOwner = validateOwnerId(owner);
    const validRecord = validateUuid(
      recordId,
      MessageStoreDiagnosticCode.INVALID_RECORD_ID,
    );

    return await this.withOwnerLock(validOwner, (state) => {
      const record = state.records.get(validRecord);
      if (!record || record.owner !== validOwner) return undefined;
      return this.cloneRecord(record);
    });
  }

  /**
   * Retrieve raw immutable RFC 5322 source bytes (.eml) for an owner record.
   */
  async getSourceBytes(
    owner: string,
    recordId: string,
  ): Promise<Uint8Array | undefined> {
    const validOwner = validateOwnerId(owner);
    const validRecord = validateUuid(
      recordId,
      MessageStoreDiagnosticCode.INVALID_RECORD_ID,
    );

    return await this.withOwnerLock(validOwner, async (state, emailRoot) => {
      const record = state.records.get(validRecord);
      if (!record || record.owner !== validOwner) return undefined;

      const sourceRel = `${SOURCE_SUBDIR}/${validRecord}.eml`;
      const sourcePath = await assertSafePath(emailRoot, sourceRel);
      try {
        return await Deno.readFile(sourcePath);
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) return undefined;
        throw err;
      }
    });
  }

  /**
   * Retrieve chronological message history for a specific owner and thread.
   */
  async history(
    owner: string,
    threadId: string,
    limit = 50,
  ): Promise<StoredEmailRecord[]> {
    const validOwner = validateOwnerId(owner);
    const validThread = validateUuid(
      threadId,
      MessageStoreDiagnosticCode.INVALID_THREAD_ID,
    );

    return await this.withOwnerLock(validOwner, (state) => {
      const recordIds = state.threads.get(validThread);
      if (!recordIds || recordIds.length === 0) return [];

      const records: StoredEmailRecord[] = [];
      for (const id of recordIds) {
        const r = state.records.get(id);
        if (r && r.owner === validOwner && r.threadId === validThread) {
          records.push(this.cloneRecord(r));
        }
      }

      if (limit > 0 && records.length > limit) {
        return records.slice(records.length - limit);
      }
      return records;
    });
  }

  /**
   * The verified recipient address of one mailbox owner (row 25).
   *
   * An autonomous send (a spontaneous message opening a NEW owner thread) has no
   * reply anchor to re-derive the recipient from, so the only address it may be
   * addressed to is one the mailbox itself admitted as this owner: the canonical
   * `From` address of the most recent stored INBOUND record whose normalized
   * userId equals `owner` (journal order is chronological, so the last match
   * wins). Returns `undefined` when the owner has no admitted inbound record —
   * the caller must then refuse the send instead of guessing a recipient.
   */
  async ownerVerifiedAddress(owner: string): Promise<string | undefined> {
    const validOwner = validateOwnerId(owner);

    return await this.withOwnerLock(validOwner, (state) => {
      let verified: string | undefined;
      for (const record of state.records.values()) {
        if (record.owner !== validOwner || record.direction !== "inbound") continue;
        let mailbox: NormalizedEmailMailbox;
        try {
          mailbox = normalizeEmailMailbox(record.from);
        } catch {
          continue;
        }
        if (mailbox.userId !== validOwner) continue;
        verified = mailbox.canonicalAddress;
      }
      return verified;
    });
  }

  /**
   * The verified inbound source of ONE owner thread (durable explicit reply anchors).
   *
   * An explicit reply anchor may itself be an outbound record; its recipient is then
   * still the thread's own initiating sender, never an owner-wide "latest sender"
   * fallback outside this thread. The existing thread index is walked newest-first
   * under the owner lock and only the matching address is returned: no whole-thread
   * record clone, no new index and no persistence change.
   *
   * Returns `undefined` when the thread has no stored INBOUND record whose normalized
   * `From` maps to `owner`; the caller must refuse instead of guessing a recipient.
   */
  async threadInboundRecipient(
    owner: string,
    threadId: string,
  ): Promise<string | undefined> {
    const validOwner = validateOwnerId(owner);
    const validThread = validateUuid(
      threadId,
      MessageStoreDiagnosticCode.INVALID_THREAD_ID,
    );

    return await this.withOwnerLock(validOwner, (state) => {
      const recordIds = state.threads.get(validThread);
      if (!recordIds || recordIds.length === 0) return undefined;

      for (let i = recordIds.length - 1; i >= 0; i--) {
        const record = state.records.get(recordIds[i]);
        if (
          !record || record.owner !== validOwner || record.threadId !== validThread ||
          record.direction !== "inbound"
        ) {
          continue;
        }
        try {
          const sender = normalizeEmailMailbox(record.from);
          if (sender.userId === validOwner) return sender.canonicalAddress;
        } catch {
          // An unparseable stored sender cannot verify this thread's recipient.
        }
      }
      return undefined;
    });
  }

  /**
   * Retrieve attachment binary payload bytes for a specific owner, record, and attachmentId.
   */
  async attachment(
    owner: string,
    recordId: string,
    attachmentId: string,
  ): Promise<Uint8Array | undefined> {
    const validOwner = validateOwnerId(owner);
    const validRecord = validateUuid(
      recordId,
      MessageStoreDiagnosticCode.INVALID_RECORD_ID,
    );
    const validAtt = validateUuid(
      attachmentId,
      MessageStoreDiagnosticCode.INVALID_ATTACHMENT_ID,
    );

    return await this.withOwnerLock(validOwner, async (state, emailRoot) => {
      const record = state.records.get(validRecord);
      if (!record || record.owner !== validOwner) return undefined;

      const attRel = `${ATTACHMENTS_SUBDIR}/${validRecord}/${validAtt}`;
      const attPath = await assertSafePath(emailRoot, attRel);
      try {
        return await Deno.readFile(attPath);
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) return undefined;
        throw err;
      }
    });
  }

  /**
   * Format stored email records into standard `PlatformMessage` instances for adapter history fetch.
   */
  toPlatformMessages(records: StoredEmailRecord[]): PlatformMessage[] {
    return records.map((r) => {
      const attachments: Attachment[] = r.attachments.map((att) => {
        const localAtt: LocalEmailAttachment = {
          kind: "email-local",
          id: att.id,
          owner: r.owner,
          recordId: r.recordId,
          attachmentId: att.id,
          mimeType: att.mimeType || "application/octet-stream",
          filename: att.filename ?? att.displayName ?? "attachment",
          size: att.size,
          isImage: att.mimeType.startsWith("image/"),
        };
        return localAtt;
      });

      return {
        messageId: r.recordId,
        userId: r.owner,
        username: r.from,
        content: r.body,
        timestamp: new Date(r.timestamp),
        isBot: r.direction === "outbound",
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    });
  }

  /**
   * Recovers/rebuilds the in-memory indexes for an owner by replaying `threads.jsonl`
   * and reading parsed snapshots.
   */
  async recover(owner: string): Promise<void> {
    const validOwner = validateOwnerId(owner);
    await this.withOwnerLock(validOwner, async () => {
      // withOwnerLock automatically calls ensureOwnerReady which performs the recovery
    });
  }

  /**
   * Closes the store.
   */
  close(): void {
    this.isClosed = true;
  }

  // =========================================================================
  // Internal Helpers
  // =========================================================================

  private async withOwnerLock<R>(
    owner: string,
    fn: (state: OwnerState, emailRoot: string) => Promise<R> | R,
  ): Promise<R> {
    if (this.isClosed) {
      throw new MessageStoreError(
        MessageStoreDiagnosticCode.STORE_CLOSED,
        "EmailMessageStore is closed",
      );
    }

    const prev = this.ownerLocks.get(owner) ?? Promise.resolve();
    let release!: () => void;
    const ticket = new Promise<void>((res) => {
      release = res;
    });
    this.ownerLocks.set(
      owner,
      prev.then(() => ticket, () => ticket),
    );

    await prev;
    try {
      const emailRoot = await this.getOwnerEmailRoot(owner);
      let state = this.ownerStates.get(owner);
      if (!state) {
        state = {
          isRecovered: false,
          isDamaged: false,
          nextSeq: 1,
          threads: new Map(),
          wireIdToThreads: new Map(),
          wireIdToRecords: new Map(),
          records: new Map(),
          operations: new Map(),
          threadReview: new Map(),
        };
        this.ownerStates.set(owner, state);
      }

      await this.ensureOwnerReady(owner, state, emailRoot);
      return await fn(state, emailRoot);
    } finally {
      release();
    }
  }

  private async ensureOwnerReady(
    owner: string,
    state: OwnerState,
    emailRoot: string,
  ): Promise<void> {
    if (state.isDamaged) {
      throw new MessageStoreError(
        MessageStoreDiagnosticCode.STORE_DAMAGED_APPEND_REFUSED,
        "Store journal is damaged; further mutations refused",
      );
    }

    if (state.isRecovered) return;

    // Replay threads.jsonl
    const journalResult = await readJournal<ThreadJournalEntryRecord>(
      emailRoot,
      THREADS_JOURNAL_FILENAME,
      {
        allowMissing: true,
        maxJournalBytes: this.maxJournalBytes,
        maxRecordBytes: this.maxRecordBytes,
      },
    );

    if (journalResult.status !== "clean") {
      state.isDamaged = true;
      throw new MessageStoreError(
        MessageStoreDiagnosticCode.STORE_CORRUPT,
        `Threads journal is damaged (${journalResult.status})`,
      );
    }

    let maxSeq = 0;
    for (const record of journalResult.records) {
      if (record.seq > maxSeq) maxSeq = record.seq;

      // Load parsed snapshot for message body/provenance
      const parsedRel = `${PARSED_SUBDIR}/${record.recordId}.json`;
      let snapshot: StoredEmailRecord | undefined;
      try {
        const parsedPath = await assertSafePath(emailRoot, parsedRel);
        const text = await Deno.readTextFile(parsedPath);
        snapshot = JSON.parse(text) as StoredEmailRecord;
        if (snapshot.recordId !== record.recordId || snapshot.owner !== owner) {
          throw new Error("Snapshot record ID or owner mismatch");
        }
      } catch {
        state.isDamaged = true;
        throw new MessageStoreError(
          MessageStoreDiagnosticCode.STORE_CORRUPT,
          `Snapshot missing or corrupt for journal record ${record.recordId}`,
        );
      }

      this.applyJournalRecordToState(state, record, snapshot);
    }

    state.nextSeq = maxSeq + 1;
    state.isRecovered = true;
  }

  private applyJournalRecordToState(
    state: OwnerState,
    journal: ThreadJournalEntryRecord,
    stored: StoredEmailRecord,
  ): void {
    // 1. Thread membership
    let threadRecs = state.threads.get(journal.threadId);
    if (!threadRecs) {
      threadRecs = [];
      state.threads.set(journal.threadId, threadRecs);
    }
    if (!threadRecs.includes(journal.recordId)) {
      threadRecs.push(journal.recordId);
    }

    // 2. Wire ID mappings
    if (journal.wireMessageId) {
      let set = state.wireIdToThreads.get(journal.wireMessageId);
      if (!set) {
        set = new Set();
        state.wireIdToThreads.set(journal.wireMessageId, set);
      }
      set.add(journal.threadId);

      let recSet = state.wireIdToRecords.get(journal.wireMessageId);
      if (!recSet) {
        recSet = new Set();
        state.wireIdToRecords.set(journal.wireMessageId, recSet);
      }
      recSet.add(journal.recordId);
    }

    if (journal.inReplyTo) {
      let set = state.wireIdToThreads.get(journal.inReplyTo);
      if (!set) {
        set = new Set();
        state.wireIdToThreads.set(journal.inReplyTo, set);
      }
      set.add(journal.threadId);
    }

    for (const ref of journal.references) {
      let set = state.wireIdToThreads.get(ref);
      if (!set) {
        set = new Set();
        state.wireIdToThreads.set(ref, set);
      }
      set.add(journal.threadId);
    }

    // 3. Stored records
    state.records.set(journal.recordId, stored);

    // 4. Operations map
    if (journal.operationKey) {
      const opStr = `${journal.operationKey.workId}:${journal.operationKey.actionSlot}`;
      state.operations.set(opStr, {
        recordId: journal.recordId,
        threadId: journal.threadId,
        digest: journal.operationDigest,
      });
    }

    // 5. Review required
    if (journal.reviewRequired) {
      state.threadReview.set(journal.threadId, {
        required: true,
        reason: journal.reviewReason,
      });
    }
  }

  private internalResolveThread(
    state: OwnerState,
    identifiers: EmailMessageIdentifiers,
  ): ThreadResolutionResult {
    const candidateRefs: string[] = [];
    if (identifiers.inReplyTo) candidateRefs.push(identifiers.inReplyTo);
    if (identifiers.references) {
      for (const r of identifiers.references) {
        if (!candidateRefs.includes(r)) candidateRefs.push(r);
      }
    }

    const matchedThreads = new Set<string>();
    const matchedWireIds: string[] = [];
    const unresolvedReferences: string[] = [];

    for (const ref of candidateRefs) {
      const threadSet = state.wireIdToThreads.get(ref);
      if (threadSet && threadSet.size > 0) {
        matchedWireIds.push(ref);
        for (const tid of threadSet) {
          matchedThreads.add(tid);
        }
      } else {
        unresolvedReferences.push(ref);
      }
    }

    if (matchedThreads.size === 0) {
      // New thread
      const newThreadId = crypto.randomUUID().toLowerCase();
      return {
        threadId: newThreadId,
        isNew: true,
        reviewRequired: false,
        matchedWireIds,
        unresolvedReferences,
      };
    }

    if (matchedThreads.size === 1) {
      // Exactly one matching thread
      const [singleThreadId] = matchedThreads;
      const existingReview = state.threadReview.get(singleThreadId);
      return {
        threadId: singleThreadId,
        isNew: false,
        reviewRequired: existingReview?.required ?? false,
        reviewReason: existingReview?.reason,
        matchedWireIds,
        unresolvedReferences,
      };
    }

    // Multiple conflicting matching threads!
    // Do NOT merge threads. Pick the first matched thread as container but flag review-required.
    const sortedThreads = Array.from(matchedThreads).sort();
    const primaryThreadId = sortedThreads[0];
    const reason =
      `Conflicting thread references: matched ${sortedThreads.length} distinct threads (${
        sortedThreads.join(", ")
      })`;

    return {
      threadId: primaryThreadId,
      isNew: false,
      reviewRequired: true,
      reviewReason: reason,
      matchedWireIds,
      unresolvedReferences,
    };
  }

  private async writeExclusiveFile(
    canonicalRoot: string,
    filePath: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const parentDir = resolve(filePath, "..");
    await ensureDurableDir(canonicalRoot, parentDir);

    const idx = filePath.lastIndexOf("/");
    const basename = idx >= 0 ? filePath.slice(idx + 1) : filePath;
    const tmpPath = resolve(parentDir, `.${basename}.tmp-${crypto.randomUUID()}`);

    let tmpFile: Deno.FsFile | null = null;
    try {
      tmpFile = await Deno.open(tmpPath, {
        createNew: true,
        write: true,
        mode: 0o600,
      });

      if (Deno.build.os !== "windows") {
        await Deno.chmod(tmpPath, 0o600);
      }

      let offset = 0;
      while (offset < bytes.length) {
        const written = await tmpFile.write(bytes.subarray(offset));
        if (written === 0) {
          throw new Error("Zero bytes written");
        }
        offset += written;
      }
      await tmpFile.sync();
    } finally {
      tmpFile?.close();
    }

    await Deno.rename(tmpPath, filePath);
    await syncDirectory(parentDir);
  }

  private cloneRecord(rec: StoredEmailRecord): StoredEmailRecord {
    return {
      ...rec,
      references: [...rec.references],
      attachments: rec.attachments.map((a) => ({ ...a })),
      provenance: rec.provenance ? { ...rec.provenance } : undefined,
      operationKey: rec.operationKey ? { ...rec.operationKey } : undefined,
    };
  }
}
