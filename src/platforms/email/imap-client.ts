// src/platforms/email/imap-client.ts
//
// IMAP client transport implementing certificate-validated direct TLS or mandatory STARTTLS.
// Owned by change: email-imap-transport.
//
// Invariants:
// - Direct TLS (port 993) or mandatory STARTTLS (port 143) with certificate verification always enabled.
// - Plaintext and opportunistic TLS downgrade are strictly rejected.
// - Credentials are only sent after successful transport encryption.
// - Credentials and secret values are NEVER logged.
// - 30-second socket / operation timeout.
// - Bounded UID batches (default limit 50).
// - Preflight RFC822.SIZE check and hard streaming byte budget (default 25 MiB).
// - Mailbox lock serialized across selected folder operations.
// - Ignores \Seen flag during incremental UID discovery.

import { ImapFlow } from "imapflow";
import { BaseError, ErrorCode } from "../../types/errors.ts";
import { createLogger } from "@utils/logger.ts";
import type { EmailImapConfig } from "../../types/config.ts";

const logger = createLogger("EmailImapClient");

/**
 * Diagnostic codes for IMAP transport operations.
 * Safe enums that describe failures without disclosing credentials or private email bodies.
 */
export enum ImapDiagnosticCode {
  CLEAN = "CLEAN",
  INVALID_CONFIG = "INVALID_CONFIG",
  TLS_REQUIRED = "TLS_REQUIRED",
  TLS_HANDSHAKE_FAILED = "TLS_HANDSHAKE_FAILED",
  AUTH_FAILED = "AUTH_FAILED",
  CONNECTION_CLOSED = "CONNECTION_CLOSED",
  TIMEOUT = "TIMEOUT",
  MAILBOX_LOCK_TIMEOUT = "MAILBOX_LOCK_TIMEOUT",
  MESSAGE_TOO_LARGE = "MESSAGE_TOO_LARGE",
  SIZE_PREFLIGHT_EXCEEDED = "SIZE_PREFLIGHT_EXCEEDED",
  LITERAL_TOO_LARGE = "LITERAL_TOO_LARGE",
  PROTOCOL_ERROR = "PROTOCOL_ERROR",
  CLIENT_CLOSED = "CLIENT_CLOSED",
}

/**
 * Custom error for IMAP transport operations.
 */
export class ImapTransportError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable: boolean;
  readonly diagnosticCode: ImapDiagnosticCode;

  constructor(
    diagnosticCode: ImapDiagnosticCode,
    message: string,
    options?: {
      isRetryable?: boolean;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super(`[${diagnosticCode}] ${message}`, {
      ...options?.context,
      diagnosticCode,
      cause: options?.cause,
    });
    this.diagnosticCode = diagnosticCode;
    this.isRetryable = options?.isRetryable ?? false;
  }
}

/**
 * Position of a remote IMAP mailbox.
 */
export interface ImapMailboxPosition {
  uidValidity: number;
  uidNext: number;
  messageCount?: number;
}

/**
 * Metadata descriptor for an email message returned by listAfter.
 */
export interface ImapMessageDescriptor {
  uid: number;
  size?: number;
  flags?: string[];
}

/**
 * Downloaded email message with bounded stream or in-memory byte buffer.
 */
export interface ImapMessage {
  uid: number;
  size: number;
  /**
   * Bounded readable stream of raw RFC822 MIME bytes.
   */
  source: ReadableStream<Uint8Array>;
  /**
   * Helper to consume the entire bounded source stream into a Uint8Array.
   */
  bytes(): Promise<Uint8Array>;
}

/**
 * Options for listAfter operations.
 */
export interface ImapListOptions {
  folder?: string;
  limit?: number;
}

/**
 * Options for fetchSource operations.
 */
export interface ImapFetchSourceOptions {
  folder?: string;
  maxBytes?: number;
}

/**
 * Options for fetchHeaders operations.
 */
export interface ImapFetchHeadersOptions {
  folder?: string;
  maxBytes?: number;
}

/**
 * Options for appendSent operations.
 */
export interface ImapAppendOptions {
  folder?: string;
  flags?: string[];
}

/**
 * Public IMAP client transport interface.
 */
export interface ImapTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(folder?: string): Promise<ImapMailboxPosition>;
  position(folder?: string): Promise<ImapMailboxPosition>;
  listAfter(uid: number, options?: ImapListOptions): Promise<number[]>;
  fetchHeaders(uid: number, options?: ImapFetchHeadersOptions): Promise<string>;
  fetchSource(uid: number, options?: ImapFetchSourceOptions): Promise<ImapMessage>;
  appendSent(rawMime: Uint8Array | string, options?: ImapAppendOptions): Promise<void>;
}

/**
 * Client construction options.
 */
export interface EmailImapClientOptions {
  config: EmailImapConfig;
  defaultFolder?: string;
  defaultSentFolder?: string;
  defaultMaxBytes?: number;
  /** Test-only: injected custom CA certificate or bundle for local fixture verification */
  tlsCa?: string | string[] | Buffer | Buffer[];
}

export const DEFAULT_IMAP_TIMEOUT_MS = 30_000;
export const DEFAULT_BATCH_LIMIT = 50;
export const DEFAULT_MAX_MESSAGE_BYTES = 26_214_400; // 25 MiB
export const DEFAULT_MAX_HEADER_BYTES = 1_048_576; // 1 MiB

/**
 * EmailImapClient encapsulates ImapFlow with TLS-only fail-closed policy,
 * credential safety, size bounds, and serialized mailbox lock management.
 */
export class EmailImapClient implements ImapTransport {
  private readonly config: EmailImapConfig;
  private readonly defaultFolder: string;
  private readonly defaultSentFolder: string;
  private readonly defaultMaxBytes: number;
  private readonly tlsCa?: string | string[] | Buffer | Buffer[];

  private client: ImapFlow | null = null;
  private connected = false;

  constructor(options: EmailImapClientOptions) {
    if (!options || !options.config) {
      throw new ImapTransportError(
        ImapDiagnosticCode.INVALID_CONFIG,
        "EmailImapClient requires config",
      );
    }
    const cfg = options.config;
    if (!cfg.host || typeof cfg.host !== "string" || cfg.host.trim() === "") {
      throw new ImapTransportError(
        ImapDiagnosticCode.INVALID_CONFIG,
        "IMAP host must be a non-empty string",
      );
    }
    if (!cfg.username || typeof cfg.username !== "string" || cfg.username.trim() === "") {
      throw new ImapTransportError(
        ImapDiagnosticCode.INVALID_CONFIG,
        "IMAP username must be a non-empty string",
      );
    }
    if (!cfg.password || typeof cfg.password !== "string" || cfg.password.trim() === "") {
      throw new ImapTransportError(
        ImapDiagnosticCode.INVALID_CONFIG,
        "IMAP password must be a non-empty string",
      );
    }

    const tlsMode = cfg.tlsMode ?? "tls";
    if (tlsMode !== "tls" && tlsMode !== "starttls") {
      throw new ImapTransportError(
        ImapDiagnosticCode.TLS_REQUIRED,
        `Invalid IMAP tlsMode "${tlsMode}": must be "tls" or "starttls" (plaintext and opportunistic TLS are prohibited)`,
      );
    }

    const defaultPort = tlsMode === "tls" ? 993 : 143;
    const port = cfg.port ?? defaultPort;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new ImapTransportError(
        ImapDiagnosticCode.INVALID_CONFIG,
        `Invalid IMAP port ${port}: must be integer between 1 and 65535`,
      );
    }

    this.config = {
      ...cfg,
      port,
      tlsMode,
    };
    this.defaultFolder = options.defaultFolder || "INBOX";
    this.defaultSentFolder = options.defaultSentFolder || "Sent";
    this.defaultMaxBytes = options.defaultMaxBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.tlsCa = options.tlsCa;
  }

  /**
   * Connect and authenticate to the IMAP server.
   * Fail-closed: ensures direct TLS or mandatory STARTTLS with certificate validation.
   */
  async connect(): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    const isDirectTls = this.config.tlsMode === "tls";
    const port = this.config.port ?? (isDirectTls ? 993 : 143);

    // TLS options: fail closed, certificate validation always enabled, NO skip-verify.
    const tlsOptions: Record<string, unknown> = {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    };
    if (this.tlsCa) {
      tlsOptions.ca = this.tlsCa;
    }

    // Configure imapflow
    // logger: false to strictly prevent raw protocol/credential logging.
    // maxLiteralSize set to message byte budget + framing overhead to prevent unbounded memory allocation.
    const maxLiteralBudget = this.defaultMaxBytes + 1_048_576;

    const flowOptions: Record<string, unknown> = {
      host: String(this.config.host),
      port,
      secure: isDirectTls,
      // For STARTTLS, doSTARTTLS: true ensures mandatory upgrade before authentication
      ...(isDirectTls ? {} : { doSTARTTLS: true }),
      auth: {
        user: this.config.username,
        pass: this.config.password,
      },
      tls: tlsOptions,
      logger: false,
      clientInfo: {
        name: "air-friends",
        version: "1.0.0",
      },
      // Protocol parser memory bounds
      maxLiteralSize: maxLiteralBudget,
      maxLineLength: 65_536,
    };

    const flow = new ImapFlow(flowOptions as unknown as ConstructorParameters<typeof ImapFlow>[0]);

    try {
      await this.withTimeout(flow.connect(), DEFAULT_IMAP_TIMEOUT_MS, "IMAP connect");
      this.client = flow;
      this.connected = true;
      logger.info("IMAP transport connected successfully", {
        host: this.config.host,
        port,
        tlsMode: this.config.tlsMode,
      });
    } catch (err) {
      flow.close();
      this.client = null;
      this.connected = false;

      const mappedErr = this.mapImapError(err, "connect");
      logger.warn("IMAP transport connection failed", {
        diagnosticCode: mappedErr.diagnosticCode,
        message: mappedErr.message,
      });
      throw mappedErr;
    }
  }

  /**
   * Disconnect and close the IMAP session.
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      this.connected = false;
      return;
    }
    const flow = this.client;
    this.client = null;
    this.connected = false;

    try {
      await this.withTimeout(flow.logout(), 5_000, "IMAP logout");
    } catch {
      flow.close();
    }
  }

  /**
   * Fetches mailbox position via STATUS command without selecting the mailbox.
   */
  async status(folder?: string): Promise<ImapMailboxPosition> {
    const targetFolder = folder || this.defaultFolder;
    const client = this.ensureConnected();

    try {
      const res = await this.withTimeout(
        client.status(targetFolder, { uidValidity: true, uidNext: true, messages: true }),
        DEFAULT_IMAP_TIMEOUT_MS,
        `IMAP status ${targetFolder}`,
      );

      const uidValidity = res?.uidValidity !== undefined ? Number(res.uidValidity) : undefined;
      const uidNext = res?.uidNext !== undefined ? Number(res.uidNext) : undefined;

      if (
        !res || uidValidity === undefined || isNaN(uidValidity) || uidNext === undefined ||
        isNaN(uidNext)
      ) {
        throw new ImapTransportError(
          ImapDiagnosticCode.PROTOCOL_ERROR,
          `Failed to obtain valid UIDVALIDITY / UIDNEXT for folder "${targetFolder}"`,
        );
      }

      return {
        uidValidity,
        uidNext,
        messageCount: res.messages,
      };
    } catch (err) {
      throw this.mapImapError(err, "status");
    }
  }

  /**
   * Opens mailbox with lock and inspects position (UIDVALIDITY, UIDNEXT, EXISTS).
   */
  async position(folder?: string): Promise<ImapMailboxPosition> {
    const targetFolder = folder || this.defaultFolder;
    const client = this.ensureConnected();

    const lock = await this.acquireMailboxLock(client, targetFolder);
    try {
      const mb = client.mailbox;
      const uidValidity = mb && mb.uidValidity !== undefined ? Number(mb.uidValidity) : undefined;
      const uidNext = mb && mb.uidNext !== undefined ? Number(mb.uidNext) : undefined;

      if (
        !mb || uidValidity === undefined || isNaN(uidValidity) || uidNext === undefined ||
        isNaN(uidNext)
      ) {
        throw new ImapTransportError(
          ImapDiagnosticCode.PROTOCOL_ERROR,
          `Mailbox "${targetFolder}" missing UIDVALIDITY or UIDNEXT after select`,
        );
      }
      return {
        uidValidity,
        uidNext,
        messageCount: mb.exists,
      };
    } catch (err) {
      throw this.mapImapError(err, "position");
    } finally {
      lock.release();
    }
  }

  /**
   * Discovers UIDs strictly greater than `uidSince`.
   * Ignores the \Seen flag (returns both read and unread messages).
   * Returns up to `limit` (default 50) sorted ascending.
   */
  async listAfter(uidSince: number, options?: ImapListOptions): Promise<number[]> {
    const targetFolder = options?.folder || this.defaultFolder;
    const limit = options?.limit ?? DEFAULT_BATCH_LIMIT;
    const client = this.ensureConnected();

    if (!Number.isInteger(uidSince) || uidSince < 0) {
      throw new ImapTransportError(
        ImapDiagnosticCode.INVALID_CONFIG,
        "uidSince must be a non-negative integer",
      );
    }

    const lock = await this.acquireMailboxLock(client, targetFolder);
    try {
      const mb = client.mailbox;
      const uidNext = mb && typeof mb.uidNext === "number" ? mb.uidNext : Infinity;

      // RFC 3501 §6.4.8 caveat: `uid:*` includes the last message even if its UID < uid
      // when uid exceeds the highest UID in the mailbox.
      // Therefore, if uidSince + 1 >= uidNext, there can be no messages strictly > uidSince.
      if (uidSince + 1 >= uidNext) {
        return [];
      }

      const searchRange = `${uidSince + 1}:*`;
      const searchRes = await this.withTimeout(
        client.search({ uid: searchRange }, { uid: true }),
        DEFAULT_IMAP_TIMEOUT_MS,
        `IMAP search ${searchRange}`,
      );

      if (!searchRes || !Array.isArray(searchRes)) {
        return [];
      }

      // Filter strictly > uidSince and sort ascending
      const filtered = searchRes
        .filter((u): u is number => typeof u === "number" && u > uidSince)
        .sort((a, b) => a - b);

      if (limit > 0 && filtered.length > limit) {
        return filtered.slice(0, limit);
      }
      return filtered;
    } catch (err) {
      throw this.mapImapError(err, "listAfter");
    } finally {
      lock.release();
    }
  }

  /**
   * Fetches message headers by UID under mailbox lock, bounded by maxBytes (default 1 MiB).
   */
  async fetchHeaders(uid: number, options?: ImapFetchHeadersOptions): Promise<string> {
    const targetFolder = options?.folder || this.defaultFolder;
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_HEADER_BYTES;
    const client = this.ensureConnected();

    if (!Number.isInteger(uid) || uid <= 0) {
      throw new ImapTransportError(
        ImapDiagnosticCode.INVALID_CONFIG,
        "uid must be a positive integer",
      );
    }

    const lock = await this.acquireMailboxLock(client, targetFolder);
    try {
      const res = await this.withTimeout(
        client.fetchOne(String(uid), { headers: true, size: true }, { uid: true }),
        DEFAULT_IMAP_TIMEOUT_MS,
        `IMAP fetchHeaders UID ${uid}`,
      );

      if (!res) {
        throw new ImapTransportError(
          ImapDiagnosticCode.PROTOCOL_ERROR,
          `Message UID ${uid} not found in folder "${targetFolder}"`,
        );
      }

      const headerBuf: Buffer | undefined = res.headers;
      if (!headerBuf) {
        throw new ImapTransportError(
          ImapDiagnosticCode.PROTOCOL_ERROR,
          `Message UID ${uid} headers not returned by server`,
        );
      }

      if (headerBuf.length > maxBytes) {
        throw new ImapTransportError(
          ImapDiagnosticCode.MESSAGE_TOO_LARGE,
          `Headers for message UID ${uid} exceed limit: ${headerBuf.length} > ${maxBytes}`,
        );
      }

      return headerBuf.toString("utf8");
    } catch (err) {
      throw this.mapImapError(err, "fetchHeaders");
    } finally {
      lock.release();
    }
  }

  /**
   * Fetches full message source by UID with:
   * 1. RFC822.SIZE preflight check against maxBytes (aborts BEFORE streaming bytes).
   * 2. Retains mailbox lock across the entire lifetime of the stream (released on close/error/cancel).
   * 3. Streams bytes with a hard counter; errors stream if server lied about size and exceeds maxBytes.
   */
  async fetchSource(uid: number, options?: ImapFetchSourceOptions): Promise<ImapMessage> {
    const targetFolder = options?.folder || this.defaultFolder;
    const maxBytes = options?.maxBytes ?? this.defaultMaxBytes;
    const client = this.ensureConnected();

    if (!Number.isInteger(uid) || uid <= 0) {
      throw new ImapTransportError(
        ImapDiagnosticCode.INVALID_CONFIG,
        "uid must be a positive integer",
      );
    }

    const lock = await this.acquireMailboxLock(client, targetFolder);
    let lockReleased = false;
    const releaseLockOnce = () => {
      if (!lockReleased) {
        lockReleased = true;
        lock.release();
      }
    };

    try {
      // 1. Preflight RFC822.SIZE check
      const preflight = await this.withTimeout(
        client.fetchOne(String(uid), { size: true }, { uid: true }),
        DEFAULT_IMAP_TIMEOUT_MS,
        `IMAP preflight size UID ${uid}`,
      );

      if (!preflight) {
        releaseLockOnce();
        throw new ImapTransportError(
          ImapDiagnosticCode.PROTOCOL_ERROR,
          `Message UID ${uid} not found in folder "${targetFolder}" during preflight`,
        );
      }

      const advertisedSize = preflight.size ?? 0;
      if (advertisedSize > maxBytes) {
        releaseLockOnce();
        throw new ImapTransportError(
          ImapDiagnosticCode.SIZE_PREFLIGHT_EXCEEDED,
          `Message UID ${uid} advertised size ${advertisedSize} exceeds limit ${maxBytes}`,
        );
      }

      // 2. Fetch source using download() or fetchOne()
      // Since imapflow's download() uses LimitedPassthrough which silently truncates when maxBytes is set,
      // we request maxBytes + 1 so our independent stream counter detects overflow.
      const dl = await this.withTimeout(
        client.download(String(uid), undefined, { uid: true, maxBytes: maxBytes + 1 }),
        DEFAULT_IMAP_TIMEOUT_MS,
        `IMAP download UID ${uid}`,
      );

      if (!dl || !dl.content) {
        releaseLockOnce();
        throw new ImapTransportError(
          ImapDiagnosticCode.PROTOCOL_ERROR,
          `Failed to obtain content stream for UID ${uid}`,
        );
      }

      const nodeStream = dl.content;
      let totalBytesRead = 0;

      // Transform Node readable stream into WHATWG ReadableStream<Uint8Array>
      // Enforces strict byte budget and releases lock on termination.
      const readableStream = new ReadableStream<Uint8Array>({
        start(controller) {
          nodeStream.on("data", (chunk: Buffer | Uint8Array) => {
            const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            totalBytesRead += u8.byteLength;

            if (totalBytesRead > maxBytes) {
              nodeStream.destroy();
              releaseLockOnce();
              controller.error(
                new ImapTransportError(
                  ImapDiagnosticCode.MESSAGE_TOO_LARGE,
                  `Message UID ${uid} exceeded byte limit ${maxBytes} during streaming (read ${totalBytesRead} bytes)`,
                ),
              );
              return;
            }

            controller.enqueue(u8);
          });

          nodeStream.on("end", () => {
            releaseLockOnce();
            controller.close();
          });

          nodeStream.on("error", (err: unknown) => {
            releaseLockOnce();
            controller.error(
              err instanceof ImapTransportError ? err : new ImapTransportError(
                ImapDiagnosticCode.PROTOCOL_ERROR,
                `Stream error while reading UID ${uid}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
                { cause: err },
              ),
            );
          });
        },
        cancel() {
          nodeStream.destroy();
          releaseLockOnce();
        },
      });

      const message: ImapMessage = {
        uid,
        size: advertisedSize,
        source: readableStream,
        async bytes(): Promise<Uint8Array> {
          const reader = readableStream.getReader();
          const chunks: Uint8Array[] = [];
          let total = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                total += value.byteLength;
              }
            }
          } finally {
            reader.releaseLock();
          }

          const result = new Uint8Array(total);
          let offset = 0;
          for (const c of chunks) {
            result.set(c, offset);
            offset += c.byteLength;
          }
          return result;
        },
      };

      return message;
    } catch (err) {
      releaseLockOnce();
      throw this.mapImapError(err, "fetchSource");
    }
  }

  /**
   * Appends sent MIME bytes to the sent folder (defaults to "Sent").
   * Flags default to ["\\Seen"].
   */
  async appendSent(rawMime: Uint8Array | string, options?: ImapAppendOptions): Promise<void> {
    const targetFolder = options?.folder || this.defaultSentFolder;
    const flags = options?.flags || ["\\Seen"];
    const client = this.ensureConnected();

    const payload = typeof rawMime === "string" ? Buffer.from(rawMime) : Buffer.from(rawMime);

    try {
      const res = await this.withTimeout(
        client.append(targetFolder, payload, flags),
        DEFAULT_IMAP_TIMEOUT_MS,
        `IMAP appendSent ${targetFolder}`,
      );

      if (!res) {
        throw new ImapTransportError(
          ImapDiagnosticCode.PROTOCOL_ERROR,
          `Failed to append message to folder "${targetFolder}"`,
        );
      }
    } catch (err) {
      throw this.mapImapError(err, "appendSent");
    }
  }

  private ensureConnected(): ImapFlow {
    if (!this.connected || !this.client) {
      throw new ImapTransportError(
        ImapDiagnosticCode.CLIENT_CLOSED,
        "IMAP client is not connected",
      );
    }
    return this.client;
  }

  private async acquireMailboxLock(
    client: ImapFlow,
    folder: string,
  ): Promise<{ release: () => void }> {
    try {
      const lock = await this.withTimeout(
        client.getMailboxLock(folder, { acquireTimeout: DEFAULT_IMAP_TIMEOUT_MS }),
        DEFAULT_IMAP_TIMEOUT_MS,
        `acquireMailboxLock ${folder}`,
      );
      return lock;
    } catch (err) {
      throw this.mapImapError(err, "acquireMailboxLock");
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new ImapTransportError(
            ImapDiagnosticCode.TIMEOUT,
            `IMAP operation "${operationName}" timed out after ${timeoutMs}ms`,
            { isRetryable: true },
          ),
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private mapImapError(err: unknown, op: string): ImapTransportError {
    if (err instanceof ImapTransportError) {
      return err;
    }

    const msg = err instanceof Error ? err.message : String(err);
    const errObj = (err ?? {}) as Record<string, unknown>;
    const code = String(errObj.code ?? "");

    // TLS failures (handshake, invalid cert, missing STARTTLS, etc.)
    if (
      errObj.tlsFailed ||
      code.includes("CERT") ||
      code.includes("TLS") ||
      msg.includes("STARTTLS") ||
      msg.includes("certificate") ||
      msg.includes("self signed") ||
      msg.includes("unable to verify")
    ) {
      return new ImapTransportError(
        ImapDiagnosticCode.TLS_HANDSHAKE_FAILED,
        `IMAP TLS failure during ${op}: ${msg}`,
        { cause: err, isRetryable: false },
      );
    }

    // Authentication failure
    if (
      errObj.authenticationFailed === true ||
      code === "AUTHENTICATIONFAILED" ||
      msg.toLowerCase().includes("authentication") ||
      msg.toLowerCase().includes("login failed") ||
      msg.toLowerCase().includes("invalid credentials")
    ) {
      return new ImapTransportError(
        ImapDiagnosticCode.AUTH_FAILED,
        `IMAP authentication failed during ${op}: invalid username or password`,
        { cause: err, isRetryable: false },
      );
    }

    // Timeout
    if (code === "LockTimeout" || code === "ETIMEDOUT" || msg.includes("Timed out")) {
      return new ImapTransportError(
        ImapDiagnosticCode.TIMEOUT,
        `IMAP timeout during ${op}: ${msg}`,
        { cause: err, isRetryable: true },
      );
    }

    // Connection closed
    if (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "EPIPE" ||
      code === "EConnectionClosed" ||
      msg.includes("Connection closed")
    ) {
      return new ImapTransportError(
        ImapDiagnosticCode.CONNECTION_CLOSED,
        `IMAP connection closed during ${op}: ${msg}`,
        { cause: err, isRetryable: true },
      );
    }

    // Literal too large from parser
    if (code === "LiteralTooLarge" || msg.includes("Literal size")) {
      return new ImapTransportError(
        ImapDiagnosticCode.LITERAL_TOO_LARGE,
        `IMAP literal size exceeded parser limits during ${op}: ${msg}`,
        { cause: err, isRetryable: false },
      );
    }

    return new ImapTransportError(
      ImapDiagnosticCode.PROTOCOL_ERROR,
      `IMAP protocol error during ${op}: ${msg}`,
      { cause: err, isRetryable: false },
    );
  }
}
