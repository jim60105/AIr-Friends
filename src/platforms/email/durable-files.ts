// src/platforms/email/durable-files.ts
//
// Crash-safe email file primitives owned by `email-durable-files`.
// Generic appendDurable, replaceSnapshot, and readJournal primitives with
// serialized per-state-root mutation, sibling-temp+rename atomic snapshots,
// strict directory/file fsync ordering, path confinement, private permissions,
// and safe diagnostic codes (never leaking private line contents).

import { isAbsolute, normalize, relative, resolve } from "@std/path";
import { BaseError, ErrorCode } from "../../types/errors.ts";
import { createLogger } from "@utils/logger.ts";

const logger = createLogger("EmailDurableFiles");

/** Envelope version for durable JSONL journals */
export const JOURNAL_ENVELOPE_VERSION = 1;

/** Default maximum record bytes (10 MiB) to prevent unbounded replay allocations */
export const DEFAULT_MAX_RECORD_BYTES = 10 * 1024 * 1024;

/** Default maximum journal bytes (100 MiB) to prevent unbounded replay allocations */
export const DEFAULT_MAX_JOURNAL_BYTES = 100 * 1024 * 1024;

/**
 * Diagnostic codes for journal integrity and durable file operations.
 * These codes are safe enums that convey failure categories without
 * disclosing any sensitive email contents or private lines.
 */
export enum DurableDiagnosticCode {
  CLEAN = "CLEAN",
  JOURNAL_NOT_FOUND = "JOURNAL_NOT_FOUND",
  TORN_TAIL_TRUNCATED_RECORD = "TORN_TAIL_TRUNCATED_RECORD",
  TORN_TAIL_MISSING_NEWLINE = "TORN_TAIL_MISSING_NEWLINE",
  TORN_TAIL_CHECKSUM_MISMATCH = "TORN_TAIL_CHECKSUM_MISMATCH",
  CORRUPT_INTERIOR_INVALID_JSON = "CORRUPT_INTERIOR_INVALID_JSON",
  CORRUPT_INTERIOR_CHECKSUM_MISMATCH = "CORRUPT_INTERIOR_CHECKSUM_MISMATCH",
  CORRUPT_INTERIOR_ENVELOPE_INVALID = "CORRUPT_INTERIOR_ENVELOPE_INVALID",
  CORRUPT_SEQUENCE_ORDER = "CORRUPT_SEQUENCE_ORDER",
  UNSUPPORTED_ENVELOPE_VERSION = "UNSUPPORTED_ENVELOPE_VERSION",
  JOURNAL_LIMIT_EXCEEDED = "JOURNAL_LIMIT_EXCEEDED",
  PATH_TRAVERSAL_DETECTED = "PATH_TRAVERSAL_DETECTED",
  SYMLINK_NOT_PERMITTED = "SYMLINK_NOT_PERMITTED",
  UNSAFE_PERMISSIONS = "UNSAFE_PERMISSIONS",
  DAMAGED_JOURNAL_APPEND_REFUSED = "DAMAGED_JOURNAL_APPEND_REFUSED",
  DURABILITY_SYNC_FAILED = "DURABILITY_SYNC_FAILED",
  WRITE_FAILED = "WRITE_FAILED",
  UNSUPPORTED_DURABILITY = "UNSUPPORTED_DURABILITY",
}

/**
 * Journal integrity status.
 * - "clean": file is complete and all records valid.
 * - "torn-tail": the final record was truncated or incomplete; can be safely handled.
 * - "corrupt": interior record corruption or sequence anomaly detected; automatic work MUST stop.
 */
export type JournalIntegrityStatus = "clean" | "torn-tail" | "corrupt";

/**
 * Integrity report returned by `readJournal`.
 */
export interface JournalIntegrityResult<T> {
  status: JournalIntegrityStatus;
  records: T[];
  diagnosticCode: DurableDiagnosticCode;
  byteOffset?: number;
  message: string;
}

/**
 * Journal record envelope persisted in each JSONL line.
 */
export interface JournalEnvelope<T> {
  v: number;
  seq: number;
  data: T;
  crc32: string;
}

/**
 * Options for durable file operations.
 */
export interface DurableFileOptions {
  /** Maximum single record size in bytes. */
  maxRecordBytes?: number;
  /** Maximum total journal size in bytes. */
  maxJournalBytes?: number;
  /** Allow missing file in readJournal (defaults to true; returns clean empty records). */
  allowMissing?: boolean;
}

/**
 * Error thrown by durable file operations.
 * Ensures diagnosticCode and byteOffset are accessible while message
 * contains only sanitized information (never raw line payloads).
 */
export class DurableFileError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: DurableDiagnosticCode;
  readonly byteOffset?: number;

  constructor(
    diagnosticCode: DurableDiagnosticCode,
    message: string,
    byteOffset?: number,
    context?: Record<string, unknown>,
  ) {
    super(`[${diagnosticCode}] ${message}`, {
      ...context,
      diagnosticCode,
      byteOffset,
    });
    this.diagnosticCode = diagnosticCode;
    this.byteOffset = byteOffset;
  }
}

/**
 * In-process mutex keyed by canonical state root to enforce serialized mutations
 * and prevent concurrent race conditions across append/replace/read.
 */
class StateRootLock {
  private queue: Promise<void> = Promise.resolve();

  async acquire<R>(fn: () => Promise<R>): Promise<R> {
    let release!: () => void;
    const ticket = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.queue;
    this.queue = previous.then(
      () => ticket,
      () => ticket,
    );

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const rootLocks = new Map<string, StateRootLock>();

function getRootLock(canonicalRoot: string): StateRootLock {
  let lock = rootLocks.get(canonicalRoot);
  if (!lock) {
    lock = new StateRootLock();
    rootLocks.set(canonicalRoot, lock);
  }
  return lock;
}

/**
 * Computes CRC32 checksum as 8-character lowercase hex.
 */
export function computeCrc32Hex(bytes: Uint8Array): string {
  // Standard CRC-32 (IEEE 802.3)
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    let c = (crc ^ byte) & 0xff;
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    crc = (crc >>> 8) ^ c;
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  return crc.toString(16).padStart(8, "0");
}

/**
 * Canonicalize and resolve state root.
 */
export async function canonicalizeRoot(rootPath: string): Promise<string> {
  const resolved = resolve(rootPath);
  // Walk up to find the closest existing ancestor to resolve real path and check for symlinks
  let curr = resolved;
  const uncreatedSuffix: string[] = [];
  while (true) {
    try {
      const stat = await Deno.lstat(curr);
      if (stat.isSymlink) {
        throw new DurableFileError(
          DurableDiagnosticCode.SYMLINK_NOT_PERMITTED,
          "State root or ancestor is an unauthorized symlink",
        );
      }
      const real = await Deno.realPath(curr);
      if (uncreatedSuffix.length === 0) {
        return real;
      }
      return resolve(real, ...uncreatedSuffix.reverse());
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        const parent = resolve(curr, "..");
        if (parent === curr) {
          // Reached filesystem root
          return normalize(resolved);
        }
        const idx = curr.lastIndexOf("/");
        const name = idx >= 0 ? curr.slice(idx + 1) : curr;
        uncreatedSuffix.push(name);
        curr = parent;
      } else {
        if (error instanceof DurableFileError) throw error;
        throw new DurableFileError(
          DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
          "Failed to inspect state root path hierarchy",
        );
      }
    }
  }
}

/**
 * Authorize one session staging directory against the host-trusted workspace
 * boundary BEFORE any canonicalization, directory creation, file write or
 * private archive read.
 *
 * The trusted root itself is the anchor: it must be an existing, real
 * directory. A symlink at that anchor is refused, because a redirected root
 * would otherwise authorize its own outside target. Every EXISTING component
 * from the root down to (and including) the staging directory is inspected
 * with `lstat` and any symlink is refused; a missing suffix is left to the
 * caller's authenticated creation path. When the staging directory exists, its
 * real path must still stay inside the root's real path.
 *
 * Ancestors ABOVE the trusted root are deliberately not inferred: the host
 * established that root (a workspace the deployment created), and
 * `canonicalizeRoot` still refuses any symlinked ancestor when it resolves the
 * destination.
 */
export async function assertStagingRootBoundary(
  trustedRoot: string,
  stagingDir: string,
): Promise<void> {
  const resolvedRoot = resolve(trustedRoot);
  const resolvedStaging = resolve(stagingDir);
  const stagingRel = relative(resolvedRoot, resolvedStaging);
  if (stagingRel.startsWith("..") || isAbsolute(stagingRel)) {
    throw new DurableFileError(
      DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
      "Staging directory is outside the trusted workspace boundary",
    );
  }

  let rootStat: Deno.FileInfo;
  try {
    rootStat = await Deno.lstat(resolvedRoot);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new DurableFileError(
        DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
        "Trusted workspace boundary does not exist",
      );
    }
    throw new DurableFileError(
      DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
      "Failed to inspect the trusted workspace boundary",
    );
  }
  if (rootStat.isSymlink) {
    throw new DurableFileError(
      DurableDiagnosticCode.SYMLINK_NOT_PERMITTED,
      "Trusted workspace boundary is an unauthorized symlink",
    );
  }
  if (!rootStat.isDirectory) {
    throw new DurableFileError(
      DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
      "Trusted workspace boundary is not a directory",
    );
  }

  let current = resolvedRoot;
  for (const part of stagingRel.split("/").filter(Boolean)) {
    current = resolve(current, part);
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.lstat(current);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) break;
      throw new DurableFileError(
        DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
        "Failed to inspect the staging path hierarchy",
      );
    }
    if (stat.isSymlink) {
      throw new DurableFileError(
        DurableDiagnosticCode.SYMLINK_NOT_PERMITTED,
        "Staging path component is an unauthorized symlink",
      );
    }
    if (!stat.isDirectory) {
      throw new DurableFileError(
        DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
        "Staging path component is not a directory",
      );
    }
  }

  try {
    const realStaging = await Deno.realPath(resolvedStaging);
    const realRoot = await Deno.realPath(resolvedRoot);
    const realRel = relative(realRoot, realStaging);
    if (realRel.startsWith("..") || isAbsolute(realRel)) {
      throw new DurableFileError(
        DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
        "Staging directory resolves outside the trusted workspace boundary",
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}

/**
 * Validates that `relativePath` stays strictly within `canonicalRoot`,
 * does not escape via parent references, and no intermediate component or
 * destination is an unauthorized symlink.
 * Returns the resolved destination path.
 */
export async function assertSafePath(
  canonicalRoot: string,
  relativePath: string,
): Promise<string> {
  if (isAbsolute(relativePath)) {
    throw new DurableFileError(
      DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
      "Target path must be relative to the state root",
    );
  }

  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized === "." || normalized === "") {
    throw new DurableFileError(
      DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
      "Path traversal out of state root is prohibited",
    );
  }

  const resolved = resolve(canonicalRoot, normalized);
  const rel = relative(canonicalRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new DurableFileError(
      DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
      "Resolved path escapes state root boundary",
    );
  }

  // Walk path components from canonicalRoot downwards checking for symlinks
  const parts = rel.split("/").filter(Boolean);
  let current = canonicalRoot;

  for (let i = 0; i < parts.length; i++) {
    current = resolve(current, parts[i]);
    try {
      const stat = await Deno.lstat(current);
      if (stat.isSymlink) {
        throw new DurableFileError(
          DurableDiagnosticCode.SYMLINK_NOT_PERMITTED,
          "Symlink encountered along path or at target; symlink escapes are prohibited",
        );
      }
      if (i < parts.length - 1 && !stat.isDirectory) {
        throw new DurableFileError(
          DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
          "Intermediate path component is not a directory",
        );
      }
      if (i === parts.length - 1 && !stat.isFile && !stat.isDirectory) {
        throw new DurableFileError(
          DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
          "Target path is not a regular file",
        );
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Path component does not exist yet; remaining path components also do not exist
        break;
      }
      throw error;
    }
  }

  return resolved;
}

/**
 * Ensures a directory and all created ancestors exist with mode 0o700,
 * and fsyncs parent directory entries to guarantee durability.
 */
export async function ensureDurableDir(
  canonicalRoot: string,
  dirPath: string,
): Promise<void> {
  const rel = relative(canonicalRoot, dirPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new DurableFileError(
      DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
      "Directory path escapes state root boundary",
    );
  }

  const parts = rel.split("/").filter(Boolean);
  let current = canonicalRoot;

  // Ensure canonicalRoot exists component-by-component and sync each created directory
  const rootParts = canonicalRoot.split("/").filter(Boolean);
  let rootCursor = canonicalRoot.startsWith("/") ? "/" : "";
  for (let i = 0; i < rootParts.length; i++) {
    const parentDir = rootCursor;
    rootCursor = resolve(rootCursor, rootParts[i]);
    try {
      const stat = await Deno.lstat(rootCursor);
      if (stat.isSymlink) {
        throw new DurableFileError(
          DurableDiagnosticCode.SYMLINK_NOT_PERMITTED,
          "Directory ancestor is a symlink",
        );
      }
      if (!stat.isDirectory) {
        throw new DurableFileError(
          DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
          "Path ancestor exists but is not a directory",
        );
      }
      if (rootCursor === canonicalRoot && Deno.build.os !== "windows") {
        await Deno.chmod(rootCursor, 0o700);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.mkdir(rootCursor, { mode: 0o700 });
        if (Deno.build.os !== "windows") {
          await Deno.chmod(rootCursor, 0o700);
        }
        if (parentDir) {
          await syncDirectory(parentDir);
        }
      } else {
        throw error;
      }
    }
  }

  for (const part of parts) {
    const parent = current;
    current = resolve(current, part);
    try {
      const stat = await Deno.lstat(current);
      if (stat.isSymlink) {
        throw new DurableFileError(
          DurableDiagnosticCode.SYMLINK_NOT_PERMITTED,
          "Directory component is a symlink",
        );
      }
      if (!stat.isDirectory) {
        throw new DurableFileError(
          DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
          "Path component is not a directory",
        );
      }
      if (Deno.build.os !== "windows") {
        await Deno.chmod(current, 0o700);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.mkdir(current, { mode: 0o700 });
        if (Deno.build.os !== "windows") {
          await Deno.chmod(current, 0o700);
        }
        await syncDirectory(parent);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Fsyncs a directory to persist directory entries.
 */
export async function syncDirectory(dirPath: string): Promise<void> {
  if (Deno.build.os === "windows") {
    throw new DurableFileError(
      DurableDiagnosticCode.UNSUPPORTED_DURABILITY,
      "Directory fsync durability is not supported on Windows",
    );
  }
  let dirFile: Deno.FsFile | null = null;
  try {
    dirFile = await Deno.open(dirPath, { read: true });
    await dirFile.sync();
  } catch (err) {
    logger.debug("Directory sync threw error", {
      path: dirPath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new DurableFileError(
      DurableDiagnosticCode.DURABILITY_SYNC_FAILED,
      "Failed to sync directory to persistent storage",
    );
  } finally {
    dirFile?.close();
  }
}

/**
 * Helper to write a buffer completely, looping until all bytes are accepted.
 */
async function writeAllBytes(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes.subarray(offset));
    if (written === 0) {
      throw new DurableFileError(
        DurableDiagnosticCode.WRITE_FAILED,
        "Zero bytes written during writeAll operation",
      );
    }
    offset += written;
  }
}

/**
 * Low-level journal reader that scans the file byte-by-byte.
 * Accurately determines clean vs torn-tail vs corrupt per the Decision Table.
 */
export async function readJournalInternal<T>(
  filePath: string,
  options?: DurableFileOptions,
): Promise<JournalIntegrityResult<T>> {
  const maxRecordBytes = options?.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
  const maxJournalBytes = options?.maxJournalBytes ?? DEFAULT_MAX_JOURNAL_BYTES;

  let fileBytes: Uint8Array;
  try {
    const stat = await Deno.lstat(filePath);
    if (stat.isSymlink) {
      throw new DurableFileError(
        DurableDiagnosticCode.SYMLINK_NOT_PERMITTED,
        "Target journal is a symlink",
      );
    }
    if (!stat.isFile) {
      throw new DurableFileError(
        DurableDiagnosticCode.PATH_TRAVERSAL_DETECTED,
        "Target journal is not a regular file",
      );
    }
    if (stat.size > maxJournalBytes) {
      throw new DurableFileError(
        DurableDiagnosticCode.JOURNAL_LIMIT_EXCEEDED,
        "Journal file size exceeds configured maximum limit",
      );
    }
    fileBytes = await Deno.readFile(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      if (options?.allowMissing === false) {
        throw new DurableFileError(
          DurableDiagnosticCode.JOURNAL_NOT_FOUND,
          "Journal file not found and allowMissing is false",
        );
      }
      return {
        status: "clean",
        records: [],
        diagnosticCode: DurableDiagnosticCode.JOURNAL_NOT_FOUND,
        message: "Journal file not found (clean initial state)",
      };
    }
    throw error;
  }

  // Empty file: clean, zero records
  if (fileBytes.length === 0) {
    return {
      status: "clean",
      records: [],
      diagnosticCode: DurableDiagnosticCode.CLEAN,
      message: "Journal is clean and empty",
    };
  }

  // Scan records by newlines '\n' (0x0A)
  // We collect segments: startOffset, endOffset, hasNewline
  interface RecordSegment {
    start: number;
    end: number; // excluding '\n'
    hasNewline: boolean;
  }

  const segments: RecordSegment[] = [];
  let lineStart = 0;
  for (let i = 0; i < fileBytes.length; i++) {
    if (fileBytes[i] === 0x0a) {
      // Newline found
      // If preceding character is '\r', strip it from end
      let lineEnd = i;
      if (lineEnd > lineStart && fileBytes[lineEnd - 1] === 0x0d) {
        lineEnd--;
      }
      segments.push({
        start: lineStart,
        end: lineEnd,
        hasNewline: true,
      });
      lineStart = i + 1;
    }
  }

  // If there are remaining bytes after the last '\n'
  if (lineStart < fileBytes.length) {
    segments.push({
      start: lineStart,
      end: fileBytes.length,
      hasNewline: false,
    });
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const records: T[] = [];
  let expectedSeq = 1;

  for (let idx = 0; idx < segments.length; idx++) {
    const segment = segments[idx];
    const isLastSegment = idx === segments.length - 1;
    const recordBytes = fileBytes.subarray(segment.start, segment.end);

    if (recordBytes.length > maxRecordBytes) {
      return {
        status: "corrupt",
        records,
        diagnosticCode: DurableDiagnosticCode.JOURNAL_LIMIT_EXCEEDED,
        byteOffset: segment.start,
        message: "Record size exceeds configured maximum limit",
      };
    }

    // Check for missing newline on final record
    if (isLastSegment && !segment.hasNewline) {
      // Final record lacks '\n'. Even if valid JSON/checksum, it is a torn tail.
      return {
        status: "torn-tail",
        records,
        diagnosticCode: DurableDiagnosticCode.TORN_TAIL_MISSING_NEWLINE,
        byteOffset: segment.start,
        message: "Final journal record missing terminating newline",
      };
    }

    // Decode UTF-8 string
    let jsonStr: string;
    try {
      jsonStr = decoder.decode(recordBytes);
    } catch {
      if (isLastSegment) {
        return {
          status: "torn-tail",
          records,
          diagnosticCode: DurableDiagnosticCode.TORN_TAIL_TRUNCATED_RECORD,
          byteOffset: segment.start,
          message: "Final record contains invalid UTF-8 bytes",
        };
      }
      return {
        status: "corrupt",
        records,
        diagnosticCode: DurableDiagnosticCode.CORRUPT_INTERIOR_INVALID_JSON,
        byteOffset: segment.start,
        message: "Interior record contains invalid UTF-8 bytes",
      };
    }

    // Parse JSON envelope
    let envelope: JournalEnvelope<T>;
    try {
      envelope = JSON.parse(jsonStr) as JournalEnvelope<T>;
    } catch {
      if (isLastSegment) {
        return {
          status: "torn-tail",
          records,
          diagnosticCode: DurableDiagnosticCode.TORN_TAIL_TRUNCATED_RECORD,
          byteOffset: segment.start,
          message: "Final record contains truncated or invalid JSON",
        };
      }
      return {
        status: "corrupt",
        records,
        diagnosticCode: DurableDiagnosticCode.CORRUPT_INTERIOR_INVALID_JSON,
        byteOffset: segment.start,
        message: "Interior record contains invalid JSON syntax",
      };
    }

    // Validate envelope structure
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      typeof envelope.v !== "number" ||
      typeof envelope.seq !== "number" ||
      typeof envelope.crc32 !== "string" ||
      !("data" in envelope)
    ) {
      if (isLastSegment) {
        return {
          status: "torn-tail",
          records,
          diagnosticCode: DurableDiagnosticCode.TORN_TAIL_TRUNCATED_RECORD,
          byteOffset: segment.start,
          message: "Final record envelope structure is incomplete",
        };
      }
      return {
        status: "corrupt",
        records,
        diagnosticCode: DurableDiagnosticCode.CORRUPT_INTERIOR_ENVELOPE_INVALID,
        byteOffset: segment.start,
        message: "Interior record envelope structure is invalid",
      };
    }

    // Check envelope version
    if (envelope.v !== JOURNAL_ENVELOPE_VERSION) {
      return {
        status: "corrupt",
        records,
        diagnosticCode: DurableDiagnosticCode.UNSUPPORTED_ENVELOPE_VERSION,
        byteOffset: segment.start,
        message: "Record envelope version is unsupported",
      };
    }

    // Sequence check: sequence MUST be integer and strictly sequential starting from 1
    if (
      !Number.isInteger(envelope.seq) ||
      envelope.seq !== expectedSeq
    ) {
      // Sequence error is always corrupt (even on final line, per decision table)
      return {
        status: "corrupt",
        records,
        diagnosticCode: DurableDiagnosticCode.CORRUPT_SEQUENCE_ORDER,
        byteOffset: segment.start,
        message: "Record sequence discontinuity detected",
      };
    }

    // Validate Checksum:
    // Checksum is calculated over the canonical serialized JSON representation of envelope.data
    const dataBytes = new TextEncoder().encode(JSON.stringify(envelope.data));
    const calculatedCrc = computeCrc32Hex(dataBytes);
    if (calculatedCrc.toLowerCase() !== envelope.crc32.toLowerCase()) {
      if (isLastSegment) {
        return {
          status: "torn-tail",
          records,
          diagnosticCode: DurableDiagnosticCode.TORN_TAIL_CHECKSUM_MISMATCH,
          byteOffset: segment.start,
          message: "Final record checksum mismatch",
        };
      }
      return {
        status: "corrupt",
        records,
        diagnosticCode: DurableDiagnosticCode.CORRUPT_INTERIOR_CHECKSUM_MISMATCH,
        byteOffset: segment.start,
        message: "Interior record checksum mismatch",
      };
    }

    // Record is valid
    records.push(envelope.data);
    expectedSeq++;
  }

  return {
    status: "clean",
    records,
    diagnosticCode: DurableDiagnosticCode.CLEAN,
    message: "Journal is clean and valid",
  };
}

/**
 * Read journal records with integrity report.
 * Serialized under the state root lock.
 */
export async function readJournal<T>(
  rootPath: string,
  relativePath: string,
  options?: DurableFileOptions,
): Promise<JournalIntegrityResult<T>> {
  const canonicalRoot = await canonicalizeRoot(rootPath);
  const lock = getRootLock(canonicalRoot);

  return await lock.acquire(async () => {
    const filePath = await assertSafePath(canonicalRoot, relativePath);
    return await readJournalInternal<T>(filePath, options);
  });
}

/**
 * Append a record to a durable JSONL journal file.
 *
 * Invariants:
 * 1. Serialized per canonical state root.
 * 2. Checks existing file integrity. If existing journal is damaged (torn-tail or corrupt),
 *    APPEND IS STRICTLY FORBIDDEN and throws DurableFileError.
 * 3. Envelopes record with version, sequence, data, and CRC32 checksum.
 * 4. Writes complete record + '\n' using a write-all loop.
 * 5. Fsyncs file handle and parent directory before returning success.
 * 6. File mode is 0o600, directory mode is 0o700.
 */
export async function appendDurable<T>(
  rootPath: string,
  relativePath: string,
  record: T,
  options?: DurableFileOptions,
): Promise<{ seq: number }> {
  // Validate serializability of record
  let dataJson: string;
  try {
    dataJson = JSON.stringify(record);
    if (dataJson === undefined || dataJson === "undefined") {
      throw new Error("Cannot serialize undefined record");
    }
  } catch (_err) {
    throw new DurableFileError(
      DurableDiagnosticCode.WRITE_FAILED,
      "Record is not JSON-serializable",
    );
  }

  const canonicalRoot = await canonicalizeRoot(rootPath);
  const lock = getRootLock(canonicalRoot);

  return await lock.acquire(async () => {
    const filePath = await assertSafePath(canonicalRoot, relativePath);
    const parentDir = resolve(filePath, "..");
    await ensureDurableDir(canonicalRoot, parentDir);

    // Validate existing journal integrity before appending
    const integrity = await readJournalInternal<T>(filePath, options);

    if (integrity.status === "torn-tail" || integrity.status === "corrupt") {
      logger.error("Append prohibited on damaged journal", {
        diagnosticCode: integrity.diagnosticCode,
        byteOffset: integrity.byteOffset,
        status: integrity.status,
      });
      throw new DurableFileError(
        DurableDiagnosticCode.DAMAGED_JOURNAL_APPEND_REFUSED,
        `Cannot append to damaged journal with status ${integrity.status} at offset ${integrity.byteOffset}`,
        integrity.byteOffset,
      );
    }

    const maxRecordBytes = options?.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    const maxJournalBytes = options?.maxJournalBytes ?? DEFAULT_MAX_JOURNAL_BYTES;

    // Parse back immutable payload representation to avoid any mutation or toJSON divergence
    const immutablePayload: T = JSON.parse(dataJson);
    const dataBytes = new TextEncoder().encode(dataJson);
    const crc32 = computeCrc32Hex(dataBytes);

    const nextSeq = integrity.records.length + 1;
    const envelope: JournalEnvelope<T> = {
      v: JOURNAL_ENVELOPE_VERSION,
      seq: nextSeq,
      data: immutablePayload,
      crc32,
    };

    const lineBytes = new TextEncoder().encode(JSON.stringify(envelope) + "\n");
    if (lineBytes.length > maxRecordBytes) {
      throw new DurableFileError(
        DurableDiagnosticCode.JOURNAL_LIMIT_EXCEEDED,
        "Record size exceeds configured maximum record bytes limit",
      );
    }

    // Check total resulting journal size
    let currentSize = 0;
    try {
      const stat = await Deno.lstat(filePath);
      currentSize = stat.size;
    } catch (_err) {
      // File does not exist yet
    }

    if (currentSize + lineBytes.length > maxJournalBytes) {
      throw new DurableFileError(
        DurableDiagnosticCode.JOURNAL_LIMIT_EXCEEDED,
        "Journal size would exceed configured maximum journal bytes limit",
      );
    }

    let file: Deno.FsFile | null = null;
    try {
      file = await Deno.open(filePath, {
        create: true,
        append: true,
        write: true,
        mode: 0o600,
      });

      if (Deno.build.os !== "windows") {
        await Deno.chmod(filePath, 0o600);
      }

      await writeAllBytes(file, lineBytes);
      await file.sync();
    } catch (err) {
      if (err instanceof DurableFileError) throw err;
      throw new DurableFileError(
        DurableDiagnosticCode.WRITE_FAILED,
        "Failed to write and sync durable journal record",
      );
    } finally {
      file?.close();
    }

    // Sync containing directory to ensure directory entry durability
    await syncDirectory(parentDir);

    return { seq: nextSeq };
  });
}

/**
 * Replace a JSON snapshot file atomically using sibling-temp + rename.
 *
 * Invariants:
 * 1. Serialized per canonical state root.
 * 2. Writes snapshot to unpredictable sibling temp file: `.${basename}.tmp-${crypto.randomUUID()}`
 *    with mode 0o600.
 * 3. Loops writeAll to ensure complete write.
 * 4. Fsyncs temp file before closing.
 * 5. Rejects replacing symlink target.
 * 6. Renames temp file over destination.
 * 7. Fsyncs parent directory to make rename durable.
 */
export async function replaceSnapshot<T>(
  rootPath: string,
  relativePath: string,
  data: T,
  _options?: DurableFileOptions,
): Promise<void> {
  let jsonString: string;
  try {
    const rawJson = JSON.stringify(data, null, 2);
    if (rawJson === undefined || rawJson === "undefined") {
      throw new Error("Cannot serialize undefined snapshot");
    }
    jsonString = rawJson + "\n";
  } catch (_err) {
    throw new DurableFileError(
      DurableDiagnosticCode.WRITE_FAILED,
      "Snapshot data is not JSON-serializable",
    );
  }

  const encodedBytes = new TextEncoder().encode(jsonString);
  const canonicalRoot = await canonicalizeRoot(rootPath);
  const lock = getRootLock(canonicalRoot);

  await lock.acquire(async () => {
    const filePath = await assertSafePath(canonicalRoot, relativePath);
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

      await writeAllBytes(tmpFile, encodedBytes);
      await tmpFile.sync();
    } catch (err) {
      if (tmpFile) {
        tmpFile.close();
        tmpFile = null;
      }
      await Deno.remove(tmpPath).catch(() => {});
      if (err instanceof DurableFileError) throw err;
      throw new DurableFileError(
        DurableDiagnosticCode.WRITE_FAILED,
        "Failed to write and sync snapshot temporary file",
      );
    } finally {
      tmpFile?.close();
    }

    // Verify destination target is not a symlink before renaming
    try {
      const targetStat = await Deno.lstat(filePath);
      if (targetStat.isSymlink) {
        await Deno.remove(tmpPath).catch(() => {});
        throw new DurableFileError(
          DurableDiagnosticCode.SYMLINK_NOT_PERMITTED,
          "Refusing to replace symlink target with snapshot",
        );
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        await Deno.remove(tmpPath).catch(() => {});
        throw error;
      }
    }

    // Atomic rename
    try {
      await Deno.rename(tmpPath, filePath);
    } catch (_err) {
      await Deno.remove(tmpPath).catch(() => {});
      throw new DurableFileError(
        DurableDiagnosticCode.WRITE_FAILED,
        "Failed to atomically rename snapshot temporary file",
      );
    }

    // Fsync parent directory to ensure rename is durable
    await syncDirectory(parentDir);
  });
}
