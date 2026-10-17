// src/core/audit-logger.ts

import { createLogger, type Logger } from "@utils/logger.ts";
import { sha256Hash } from "@utils/hash.ts";
import { join } from "@std/path";
import type { AuditConfig } from "../types/config.ts";
import type { AuditPhase, EmailOperationAuditData, SessionAuditEntry } from "../types/audit.ts";
import {
  EMAIL_AUDIT_PLATFORM,
  EMAIL_CONTENT_ARRAY_FIELD_NAMES,
  EMAIL_CONTENT_FIELD_NAMES,
  EMAIL_HASH_FIELD_PATTERN,
  EMAIL_HASH_VALUE_PATTERN,
  EMAIL_OPERATION_AUDIT_FIELDS,
  isSafeEmailAuditScalar,
} from "../types/audit.ts";
import { auditEntriesTotal } from "@utils/metrics.ts";

const logger = createLogger("AuditLogger");

/** Maximum nesting the email projection walks into (skill params / results). */
const EMAIL_PROJECTION_MAX_DEPTH = 2;

/** Failure code recorded when the audit write itself fails in a private context. */
const AUDIT_WRITE_FAILED_CODE = "AUDIT_WRITE_FAILED";

/**
 * Project one invocation's parameters/results into the private email audit
 * shape: identifiers, counts, lengths and digests only. Content-bearing fields
 * are replaced by their `sha256:` digest (and length/count), an already-canonical
 * digest is kept verbatim, and every other key is dropped.
 *
 * The projection is idempotent: projecting its own output again returns the same
 * object, and a canonical `<field>Hash` supplied by the caller always wins over
 * the digest derived from a sibling content field.
 */
export async function projectEmailAuditData(
  data: Record<string, unknown>,
  depth: number = 0,
): Promise<Record<string, unknown>> {
  const projected: Record<string, unknown> = {};

  const hashInto = async (hashKey: string, value: string | Uint8Array) => {
    if (projected[hashKey] !== undefined) return;
    projected[hashKey] = `sha256:${await sha256Hash(value)}`;
  };

  for (const [key, value] of Object.entries(data)) {
    const lower = key.toLowerCase();
    if (typeof value === "number" || typeof value === "boolean") {
      projected[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (EMAIL_HASH_VALUE_PATTERN.test(value)) {
        projected[key] = value;
        continue;
      }
      if (EMAIL_CONTENT_FIELD_NAMES[lower] || EMAIL_HASH_FIELD_PATTERN.test(key)) {
        // A digest-bearing field keeps its own key (a raw `messageContentHash`
        // becomes the canonical digest there, never a `…HashHash`).
        await hashInto(EMAIL_HASH_FIELD_PATTERN.test(key) ? key : `${key}Hash`, value);
        if (EMAIL_CONTENT_FIELD_NAMES[lower]) projected[`${key}Length`] = value.length;
        continue;
      }
      if (isSafeEmailAuditScalar(key, value)) projected[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (EMAIL_CONTENT_ARRAY_FIELD_NAMES[lower]) {
        await hashInto(`${key}Hash`, value.map((item) => JSON.stringify(item)).join("\n"));
        projected[`${key}Count`] = value.length;
      }
      continue;
    }
    if (value !== null && typeof value === "object" && depth < EMAIL_PROJECTION_MAX_DEPTH) {
      const nested = await projectEmailAuditData(
        value as Record<string, unknown>,
        depth + 1,
      );
      if (Object.keys(nested).length > 0) projected[key] = nested;
    }
  }

  return projected;
}

/**
 * The strict `email_operation` allowlist: the only fields this phase may carry
 * are `operationId`, `workId`, `phase`, `targetKind`, `sentCopy` and `safeCode`.
 * Values that do not match their own host-assigned format are omitted, so an
 * adversarial caller can neither smuggle content nor widen the record.
 */
export function projectEmailOperationData(
  input: EmailOperationAuditData,
): EmailOperationAuditData {
  const projected: Record<string, unknown> = {};
  for (const field of EMAIL_OPERATION_AUDIT_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && isSafeEmailAuditScalar(field, value)) projected[field] = value;
  }
  return projected as EmailOperationAuditData;
}

/**
 * Manages audit log writing for a single session.
 * Created per-session by SessionOrchestrator.
 */
export class SessionAuditWriter {
  private filePath: string;
  private config: AuditConfig;
  private sessionId: string;
  private privateEmail: boolean;
  private logger: Logger;

  // Session summary counters
  private _repliesCount = 0;
  private _skillCallsCount = 0;
  private _memoryOpsCount = 0;
  private _permissionDecisionsCount = 0;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    auditBasePath: string,
    platform: string,
    userId: string,
    sessionId: string,
    config: AuditConfig,
  ) {
    this.sessionId = sessionId;
    this.config = config;
    this.filePath = join(auditBasePath, platform, userId, `${sessionId}.jsonl`);
    // An email session carries private correspondence, so every entry is
    // serialized metadata-only whatever the configured content hashing says.
    this.privateEmail = platform === EMAIL_AUDIT_PLATFORM;
    this.logger = this.privateEmail ? logger.withPrivateEmail() : logger;
  }

  /** Expose config for external use (e.g. skill audit) */
  getConfig(): AuditConfig {
    return this.config;
  }

  /**
   * Whether this session's entries are projected to the private email shape.
   * Consumers that write email-context payloads use it instead of the general
   * `hashContent` setting, which never relaxes email privacy.
   */
  isPrivateEmail(): boolean {
    return this.privateEmail;
  }

  /**
   * Record one email submission outcome (`email_operation` phase) from the
   * session's own operation metadata: opaque operation/work identifiers plus the
   * durable phase, target class, sent-copy state and safe code. Message content,
   * addresses and file names have no representation here.
   */
  writeEmailOperation(
    data: EmailOperationAuditData,
    timestamp?: string,
  ): Promise<void> {
    return this.write(
      "email_operation",
      projectEmailOperationData(data) as SessionAuditEntry["data"],
      timestamp,
    );
  }

  /** Increment replies counter */
  incrementReplies(): void {
    this._repliesCount++;
  }

  /** Increment skill calls counter */
  incrementSkillCalls(): void {
    this._skillCallsCount++;
  }

  /** Increment memory operations counter */
  incrementMemoryOps(): void {
    this._memoryOpsCount++;
  }

  /** Increment permission decisions counter */
  incrementPermissionDecisions(): void {
    this._permissionDecisionsCount++;
  }

  /** Get summary counters for session_end */
  getSummaryCounters(): {
    repliesCount: number;
    skillCallsCount: number;
    memoryOpsCount: number;
    permissionDecisionsCount: number;
  } {
    return {
      repliesCount: this._repliesCount,
      skillCallsCount: this._skillCallsCount,
      memoryOpsCount: this._memoryOpsCount,
      permissionDecisionsCount: this._permissionDecisionsCount,
    };
  }

  /**
   * Write an audit entry if the phase is included in config.
   * Fire-and-forget — errors are logged but never thrown.
   */
  write(
    phase: AuditPhase,
    data: SessionAuditEntry["data"],
    timestamp?: string,
  ): Promise<void> {
    // Phase filter
    if (
      this.config.includedPhases.length > 0 &&
      !this.config.includedPhases.includes(phase)
    ) {
      return Promise.resolve();
    }

    const ts = timestamp ?? new Date().toISOString();

    this.writeQueue = this.writeQueue
      .then(async () => {
        // Update Prometheus counter
        auditEntriesTotal.inc({ phase });

        const entry: SessionAuditEntry = {
          ts,
          phase,
          // Email sessions are projected to the metadata-only shape HERE, so no
          // caller — present or future — can record private correspondence by
          // forgetting the email rule.
          data: this.privateEmail ? await projectEmailAuditData(data) : data,
        };

        const dir = this.filePath.substring(0, this.filePath.lastIndexOf("/"));
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(
          this.filePath,
          JSON.stringify(entry) + "\n",
          { append: true },
        );
      })
      .catch((error) => {
        // The audit path of an email session embeds the owner identity and the
        // exception text can name a private file, so a private writer reports a
        // constant safe code instead of the failure message.
        this.logger.warn("Failed to write audit entry for session {sessionId}", {
          sessionId: this.sessionId,
          phase,
          ...(this.privateEmail
            ? { code: AUDIT_WRITE_FAILED_CODE }
            : { error: error instanceof Error ? error.message : String(error) }),
        });
      });

    return this.writeQueue;
  }
}
