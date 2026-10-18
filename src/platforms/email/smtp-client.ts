// src/platforms/email/smtp-client.ts
//
// SMTP submission transport implementing certificate-validated direct TLS or mandatory
// STARTTLS with an explicit submission-outcome taxonomy.
// Owned by change: email-smtp-transport.
//
// Invariants:
// - Direct TLS (port 465) or mandatory STARTTLS (port 587) with certificate verification
//   always enabled. Plaintext, opportunistic TLS downgrade, and disabled certificate
//   verification are strictly rejected.
// - Credentials are only sent after successful transport encryption (explicit `login()`
//   after the TLS session is established); nothing is transmitted when TLS fails or the
//   server refuses to upgrade.
// - Submission reports exactly one of `submitted | failed | unknown`:
//   * `submitted` requires a positive final DATA acknowledgement from the server.
//   * `failed` requires definite rejection evidence: an explicit 4xx/5xx server reply, a
//     local envelope/payload rejection, or a failure before message submission began
//     (connect, TLS, greeting, EHLO, STARTTLS, authentication).
//   * `unknown` covers any lost acknowledgement once the DATA transaction may have begun,
//     including truncated or unsupported final replies.
// - The transport NEVER retries, reconnects, or resubmits. Callers own retry policy and
//   durable bookkeeping (`submission-store.ts`); an `unknown` outcome must never be
//   automatically resubmitted.
// - Constructed MIME bytes are submitted verbatim with an explicit envelope; the transport
//   never re-serializes a message and never derives recipients from message headers.
// - Credentials, message bodies, and raw library error text are NEVER logged or returned.
// - 30-second connection, greeting, and socket timeouts plus a bounded overall submission
//   deadline.

import SMTPConnection from "nodemailer/lib/smtp-connection/index.js";
import { Buffer } from "node:buffer";
import { BaseError, ErrorCode } from "../../types/errors.ts";
import { createLogger } from "@utils/logger.ts";
import type { EmailSmtpConfig } from "../../types/config.ts";

const logger = createLogger("EmailSmtpClient");

/**
 * Diagnostic codes for SMTP submission.
 * Safe enums that describe outcomes without disclosing credentials or message content.
 */
export enum SmtpDiagnosticCode {
  /** Positive final DATA acknowledgement received. */
  ACCEPTED = "ACCEPTED",
  /** Local configuration is unusable (thrown at construction time). */
  INVALID_CONFIG = "INVALID_CONFIG",
  /** Plaintext or opportunistic TLS configuration was requested. */
  TLS_REQUIRED = "TLS_REQUIRED",
  /** TLS negotiation or certificate validation failed. */
  TLS_HANDSHAKE_FAILED = "TLS_HANDSHAKE_FAILED",
  /** Authentication was refused or could not be completed. */
  AUTH_FAILED = "AUTH_FAILED",
  /** Connection could not be established (DNS, refused, socket error). */
  CONNECTION_FAILED = "CONNECTION_FAILED",
  /** Connection, greeting, socket, or overall submission deadline elapsed. */
  CONNECTION_TIMEOUT = "CONNECTION_TIMEOUT",
  /** Envelope is not a single valid recipient with a valid sender. */
  INVALID_ENVELOPE = "INVALID_ENVELOPE",
  /** No message bytes were supplied. */
  EMPTY_MESSAGE = "EMPTY_MESSAGE",
  /** Message exceeds the configured maximum submission size (checked before submitting). */
  MESSAGE_TOO_LARGE = "MESSAGE_TOO_LARGE",
  /** Provider advertised SIZE limit refused the message before submission. */
  PROVIDER_SIZE_REJECTED = "PROVIDER_SIZE_REJECTED",
  /** Explicit 4xx/5xx server rejection. */
  REJECTED = "REJECTED",
  /** Protocol violation by the server before any acknowledgement was usable. */
  PROTOCOL_ERROR = "PROTOCOL_ERROR",
  /** Connection was lost once DATA submission may have begun (outcome unknown). */
  CONNECTION_LOST = "CONNECTION_LOST",
  /** Final reply was incomplete or unrecognizable (outcome unknown). */
  MALFORMED_RESPONSE = "MALFORMED_RESPONSE",
}

/**
 * Custom error for unusable SMTP transport configuration.
 * Thrown at construction time so a fail-closed misconfiguration never reaches the network.
 */
export class SmtpTransportError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: SmtpDiagnosticCode;

  constructor(diagnosticCode: SmtpDiagnosticCode, message: string) {
    super(`[${diagnosticCode}] ${message}`, { diagnosticCode });
    this.diagnosticCode = diagnosticCode;
  }
}

/** Submission outcome taxonomy owned by this change. */
export type SmtpOutcome = "submitted" | "failed" | "unknown";

/** Explicit SMTP envelope: one sender and exactly one recipient. */
export interface SmtpEnvelope {
  from: string;
  to: string[];
}

/**
 * Submission input.
 * `ConstructedOutgoingEmail` from `outgoing-mime.ts` satisfies this shape, so the caller
 * passes the constructed message directly; bytes are never re-serialized.
 */
export interface SmtpSubmission {
  /** Complete RFC 5322 wire bytes, submitted verbatim. */
  emlBytes: Uint8Array;
  /** Explicit envelope; the transport never derives recipients from headers. */
  envelope: SmtpEnvelope;
  /** Optional declared size from the constructor for cross-checking diagnostics only. */
  sizeBytes?: number;
}

/** Result of one submission attempt. Contains no credentials and no message content. */
export interface SmtpSubmitResult {
  /** `submitted` (final acknowledgement), `failed` (definite rejection), or `unknown`. */
  phase: SmtpOutcome;
  /** Safe diagnostic code; stable enum, never server text. */
  safeCode: SmtpDiagnosticCode;
  /** Final SMTP status code, present only when the server sent an explicit reply. */
  responseCode?: number;
  /** Envelope recipients the server accepted (empty unless accepted). */
  accepted: string[];
  /** Envelope recipients the server rejected. */
  rejected: string[];
  /** Exact number of submitted message bytes. */
  sizeBytes: number;
  /** Wall-clock duration of this submission attempt in milliseconds. */
  durationMs: number;
}

/** Public SMTP transport boundary consumed by the submission service. */
export interface SmtpTransport {
  submit(input: SmtpSubmission): Promise<SmtpSubmitResult>;
}

/** Construction options. */
export interface EmailSmtpClientOptions {
  config: EmailSmtpConfig;
  /** Hard pre-submit message size bound; defaults to 25 MiB. */
  maxMessageBytes?: number;
  /** Overall submission deadline; defaults to 30 seconds. */
  timeoutMs?: number;
  /** Custom CA certificate or bundle; replaces default roots without disabling verification. */
  tlsCa?: string | string[] | Buffer | Buffer[];
}

export const DEFAULT_SMTP_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_MESSAGE_BYTES = 26_214_400; // 25 MiB
export const SMTP_TLS_MIN_VERSION = "TLSv1.2";

/** Envelope characters that would be reinterpreted as protocol syntax. */
const UNSAFE_MAILBOX_PATTERN = /[\r\n\0<>]/;

/** Structural view of the nodemailer SMTP engine actually used (untyped JS subpath). */
interface SmtpConnectionLike {
  connect(callback: (err?: unknown) => void): void;
  login(
    auth: { user: string; pass: string },
    callback: (err?: unknown, success?: unknown) => void,
  ): void;
  send(
    envelope: { from: string; to: string[]; size: number },
    message: Buffer,
    callback: (err?: unknown, info?: SmtpSendInfo) => void,
  ): void;
  close(): void;
  on(event: "error" | "end", listener: (err?: unknown) => void): void;
  /**
   * Live socket, read the same way nodemailer's own `close()` resolves its teardown target
   * (`tlsSocket.socket ?? socket`); `undefined` while a connect is still resolving.
   */
  readonly _socket?: { destroy(): void; socket?: { destroy(): void } };
}

/** Fields nodemailer reports for a completed envelope transaction. */
interface SmtpSendInfo {
  response?: string;
  accepted?: string[];
  rejected?: string[];
}

/** Internal submission stage used to classify failures without guessing. */
type SubmissionStage = "connect" | "login" | "send";

function isSendOutcomeFailure(value: unknown): value is { failed: unknown } {
  return typeof value === "object" && value !== null && "failed" in value;
}

/** Narrow a raced value to a fully classified submission result. */
function isSubmitResult(value: unknown): value is SmtpSubmitResult {
  return typeof value === "object" && value !== null && "phase" in value;
}

/** Bridge a node-style stage callback into a raced outcome. */
function stageOutcome(
  run: (callback: (err?: unknown) => void) => void,
): Promise<{ err: unknown } | { done: true }> {
  const { promise, resolve } = Promise.withResolvers<{ err: unknown } | { done: true }>();
  run((err) => resolve(err ? { err } : { done: true }));
  return promise;
}

/** Read only the safe, non-textual fields of a nodemailer error. */
function readErrorFields(err: unknown): {
  code?: string;
  command?: string;
  responseCode?: number;
  hasResponse: boolean;
  systemFailure: boolean;
} {
  if (typeof err !== "object" || err === null) {
    return { hasResponse: false, systemFailure: false };
  }
  const record = err as Record<string, unknown>;
  const responseCode = record.responseCode;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    command: typeof record.command === "string" ? record.command : undefined,
    responseCode: typeof responseCode === "number" && Number.isInteger(responseCode)
      ? responseCode
      : undefined,
    hasResponse: typeof record.response === "string" && record.response.trim() !== "",
    // Operating-system level failures (refused, reset, unreachable) carry errno/syscall;
    // TLS validation failures do not.
    systemFailure: typeof record.errno === "number" || typeof record.syscall === "string",
  };
}

/**
 * Parse a syntactically valid positive (2xx) final reply.
 * A success callback whose reply is missing, non-numeric, or outside 2xx cannot confirm
 * acceptance and must not be reported as `submitted`.
 */
function parsePositiveResponseCode(response: unknown): number | undefined {
  if (typeof response !== "string") {
    return undefined;
  }
  const match = response.match(/^(\d{3})(?:[ -]|\r?\n|$)/);
  if (!match) {
    return undefined;
  }
  const code = Number(match[1]);
  return code >= 200 && code <= 299 ? code : undefined;
}

/**
 * EmailSmtpClient encapsulates nodemailer's SMTP engine with a TLS-only fail-closed policy,
 * explicit envelope binding, one-way outcome classification, and credential safety.
 */
export class EmailSmtpClient implements SmtpTransport {
  private readonly config: EmailSmtpConfig & { port: number; tlsMode: "tls" | "starttls" };
  private readonly maxMessageBytes: number;
  private readonly timeoutMs: number;
  private readonly tlsCa?: string | string[] | Buffer | Buffer[];

  constructor(options: EmailSmtpClientOptions) {
    if (!options || !options.config) {
      throw new SmtpTransportError(
        SmtpDiagnosticCode.INVALID_CONFIG,
        "EmailSmtpClient requires config",
      );
    }
    const cfg = options.config;
    if (!cfg.host || typeof cfg.host !== "string" || cfg.host.trim() === "") {
      throw new SmtpTransportError(
        SmtpDiagnosticCode.INVALID_CONFIG,
        "SMTP host must be a non-empty string",
      );
    }
    if (!cfg.username || typeof cfg.username !== "string" || cfg.username.trim() === "") {
      throw new SmtpTransportError(
        SmtpDiagnosticCode.INVALID_CONFIG,
        "SMTP username must be a non-empty string",
      );
    }
    if (!cfg.password || typeof cfg.password !== "string" || cfg.password.trim() === "") {
      throw new SmtpTransportError(
        SmtpDiagnosticCode.INVALID_CONFIG,
        "SMTP password must be a non-empty string",
      );
    }

    const tlsMode = cfg.tlsMode ?? "tls";
    if (tlsMode !== "tls" && tlsMode !== "starttls") {
      throw new SmtpTransportError(
        SmtpDiagnosticCode.TLS_REQUIRED,
        `Invalid SMTP tlsMode "${
          String(tlsMode)
        }": must be "tls" or "starttls" (plaintext and opportunistic TLS are prohibited)`,
      );
    }

    const port = cfg.port ?? (tlsMode === "tls" ? 465 : 587);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new SmtpTransportError(
        SmtpDiagnosticCode.INVALID_CONFIG,
        `Invalid SMTP port ${String(port)}: must be integer between 1 and 65535`,
      );
    }

    this.config = { ...cfg, host: cfg.host.trim(), port, tlsMode };
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS;
    this.tlsCa = options.tlsCa;
  }

  /** Bound message size enforced before any network activity. */
  get messageSizeLimit(): number {
    return this.maxMessageBytes;
  }

  /**
   * Submit one constructed message and classify the outcome.
   *
   * Never throws for a reachable-but-failing server: every path returns a classified result.
   * Never retries and never reconnects.
   */
  async submit(input: SmtpSubmission): Promise<SmtpSubmitResult> {
    const startedAt = Date.now();
    const preflight = this.preflight(input);
    if (!preflight.ok) {
      logger.warn("SMTP submission refused before connecting", {
        host: this.config.host,
        port: this.config.port,
        safeCode: preflight.result.safeCode,
      });
      return preflight.result;
    }

    const { payload, envelope, sizeBytes } = preflight;
    const connection = new SMTPConnection(
      this.connectionOptions(),
    ) as unknown as SmtpConnectionLike;

    let stage: SubmissionStage = "connect";
    let settled = false;
    const settlement = Promise.withResolvers<SmtpSubmitResult>();
    const record = (result: SmtpSubmitResult): void => {
      if (!settled) {
        settled = true;
        settlement.resolve(result);
      }
    };

    // Bridge nodemailer's event-based failures into the awaited submission: `onError`
    // emits `error` and closes the socket without invoking a pending stage callback.
    connection.on("error", (err) => {
      record(this.classifyFailure(err, stage, startedAt, sizeBytes, envelope.to));
    });
    connection.on("end", () => {
      record(
        stage === "send"
          ? this.failureResult(
            SmtpDiagnosticCode.CONNECTION_LOST,
            "unknown",
            startedAt,
            sizeBytes,
          )
          : this.failureResult(
            SmtpDiagnosticCode.CONNECTION_FAILED,
            "failed",
            startedAt,
            sizeBytes,
          ),
      );
    });

    // The overall deadline is armed only once the connection is established: nodemailer
    // bounds its own DNS, connect, and greeting phases (each settled through the bridged
    // error event), and cancelling a connect that is still resolving can leave a socket it
    // creates afterwards unmanaged.
    // Deno's own timer type is `number`, but node typings leaking in through npm
    // dependencies are the reason this is written as the platform's timer type.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = (): void => {
      watchdog = setTimeout(() => {
        record(
          stage === "send"
            ? this.failureResult(
              SmtpDiagnosticCode.CONNECTION_TIMEOUT,
              "unknown",
              startedAt,
              sizeBytes,
            )
            : this.failureResult(
              SmtpDiagnosticCode.CONNECTION_TIMEOUT,
              "failed",
              startedAt,
              sizeBytes,
            ),
        );
        this.teardownConnection(connection);
      }, this.timeoutMs);
    };

    try {
      const connectOutcome = await Promise.race([
        stageOutcome((callback) => connection.connect(callback)),
        settlement.promise,
      ]);
      if (isSubmitResult(connectOutcome)) {
        return connectOutcome;
      }
      if ("err" in connectOutcome) {
        return this.classifyFailure(
          connectOutcome.err,
          "connect",
          startedAt,
          sizeBytes,
          envelope.to,
        );
      }
      armWatchdog();

      stage = "login";
      const loginOutcome = await Promise.race([
        stageOutcome((callback) =>
          connection.login({ user: this.config.username, pass: this.config.password }, callback)
        ),
        settlement.promise,
      ]);
      if (isSubmitResult(loginOutcome)) {
        return loginOutcome;
      }
      if ("err" in loginOutcome) {
        return this.classifyFailure(
          loginOutcome.err,
          "login",
          startedAt,
          sizeBytes,
          envelope.to,
        );
      }

      // Constructed bytes are written verbatim into DATA; the envelope is transport-owned
      // so nodemailer cannot mutate the caller's constructed message.
      stage = "send";
      const sendStage = Promise.withResolvers<
        { failed: unknown } | { info: SmtpSendInfo | undefined }
      >();
      connection.send(
        { from: envelope.from, to: [...envelope.to], size: sizeBytes },
        payload,
        (err, info) => sendStage.resolve(err ? { failed: err } : { info }),
      );
      const sendOutcome = await Promise.race([sendStage.promise, settlement.promise]);
      if (isSubmitResult(sendOutcome)) {
        return sendOutcome;
      }
      if (isSendOutcomeFailure(sendOutcome)) {
        return this.classifyFailure(
          sendOutcome.failed,
          "send",
          startedAt,
          sizeBytes,
          envelope.to,
        );
      }

      // Acceptance is claimed only for a syntactically valid positive final reply; an
      // unusable reply means the acknowledgement cannot be confirmed.
      const responseCode = parsePositiveResponseCode(sendOutcome.info?.response);
      if (responseCode === undefined) {
        return this.failureResult(
          SmtpDiagnosticCode.MALFORMED_RESPONSE,
          "unknown",
          startedAt,
          sizeBytes,
        );
      }
      const accepted = [...(sendOutcome.info?.accepted ?? [])];
      const result: SmtpSubmitResult = {
        phase: "submitted",
        safeCode: SmtpDiagnosticCode.ACCEPTED,
        responseCode,
        accepted: accepted.length > 0 ? accepted : [...envelope.to],
        rejected: [...(sendOutcome.info?.rejected ?? [])],
        sizeBytes,
        durationMs: Date.now() - startedAt,
      };
      record(result);
      logger.info("SMTP submission accepted", {
        host: this.config.host,
        port: this.config.port,
        tlsMode: this.config.tlsMode,
        responseCode,
        sizeBytes,
        durationMs: result.durationMs,
      });
      return result;
    } catch (err) {
      // Defensive: an unexpected synchronous throw is classified, never rethrown as a
      // submission outcome and never retried.
      return this.classifyFailure(err, stage, startedAt, sizeBytes, envelope.to);
    } finally {
      if (watchdog !== undefined) {
        clearTimeout(watchdog);
      }
      this.teardownConnection(connection);
    }
  }

  /** Validate envelope and payload before any socket is opened. */
  private preflight(
    input: SmtpSubmission,
  ): { ok: true; payload: Buffer; envelope: SmtpEnvelope; sizeBytes: number } | {
    ok: false;
    result: SmtpSubmitResult;
  } {
    const startedAt = Date.now();
    const fail = (
      safeCode: SmtpDiagnosticCode,
      sizeBytes: number,
      phase: SmtpOutcome = "failed",
    ): { ok: false; result: SmtpSubmitResult } => ({
      ok: false,
      result: this.failureResult(safeCode, phase, startedAt, sizeBytes),
    });

    if (!input || typeof input !== "object") {
      return fail(SmtpDiagnosticCode.EMPTY_MESSAGE, 0);
    }
    const bytes = input.emlBytes;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      return fail(SmtpDiagnosticCode.EMPTY_MESSAGE, 0);
    }
    // The supplied bytes are authoritative for the size bound and for diagnostics.
    const sizeBytes = bytes.byteLength;

    const envelope = input.envelope;
    if (
      !envelope || typeof envelope !== "object" || typeof envelope.from !== "string" ||
      envelope.from.trim() === "" || UNSAFE_MAILBOX_PATTERN.test(envelope.from)
    ) {
      return fail(SmtpDiagnosticCode.INVALID_ENVELOPE, sizeBytes);
    }
    const recipients = envelope.to;
    if (
      !Array.isArray(recipients) || recipients.length !== 1 ||
      typeof recipients[0] !== "string" || recipients[0].trim() === "" ||
      UNSAFE_MAILBOX_PATTERN.test(recipients[0])
    ) {
      return fail(SmtpDiagnosticCode.INVALID_ENVELOPE, sizeBytes);
    }

    if (sizeBytes > this.maxMessageBytes) {
      return fail(SmtpDiagnosticCode.MESSAGE_TOO_LARGE, sizeBytes);
    }

    return {
      ok: true,
      payload: Buffer.from(bytes),
      envelope: { from: envelope.from.trim(), to: [recipients[0].trim()] },
      sizeBytes,
    };
  }

  /** Fail-closed connection options: certificate-validated direct TLS or required STARTTLS. */
  private connectionOptions(): Record<string, unknown> {
    const isDirectTls = this.config.tlsMode === "tls";
    const tlsOptions: Record<string, unknown> = {
      rejectUnauthorized: true,
      minVersion: SMTP_TLS_MIN_VERSION,
    };
    if (this.tlsCa) {
      tlsOptions.ca = this.tlsCa;
    }

    return {
      host: this.config.host,
      port: this.config.port,
      secure: isDirectTls,
      requireTLS: !isDirectTls,
      opportunisticTLS: false,
      ignoreTLS: false,
      tls: tlsOptions,
      name: "air-friends",
      connectionTimeout: this.timeoutMs,
      greetingTimeout: this.timeoutMs,
      socketTimeout: this.timeoutMs,
      logger: false,
      debug: false,
    };
  }

  /**
   * Terminate the submission connection and its socket.
   *
   * The connection is never reused or pooled, so teardown is final: a graceful end alone
   * would leave the handle open against a peer that stops reading.
   */
  private teardownConnection(connection: SmtpConnectionLike): void {
    try {
      connection.close();
    } catch {
      // Socket teardown failures cannot change an already classified outcome.
    }
    try {
      const liveSocket = connection._socket?.socket ?? connection._socket;
      liveSocket?.destroy();
    } catch {
      // Ignore: the socket may already be gone.
    }
  }

  /**
   * Classify a failure into the outcome taxonomy.
   *
   * `connect`/`login` failures are definite `failed`: no message bytes were submitted.
   * Inside the message transaction only explicit rejection evidence yields `failed`;
   * everything else is a lost acknowledgement (`unknown`) and must never be resubmitted.
   */
  private classifyFailure(
    err: unknown,
    stage: SubmissionStage,
    startedAt: number,
    sizeBytes: number,
    recipients: string[],
  ): SmtpSubmitResult {
    const { code, command, responseCode, hasResponse, systemFailure } = readErrorFields(err);
    const explicitRejection = responseCode !== undefined && responseCode >= 400 &&
      responseCode <= 599;

    let safeCode: SmtpDiagnosticCode;
    if (stage === "send") {
      if (explicitRejection) {
        safeCode = SmtpDiagnosticCode.REJECTED;
      } else if (command === "API") {
        // Local envelope validation inside the engine; nothing reached the wire.
        safeCode = SmtpDiagnosticCode.INVALID_ENVELOPE;
      } else if (code === "EMESSAGE" && command !== "DATA") {
        // Provider-advertised SIZE limit or empty payload refused before submission.
        safeCode = SmtpDiagnosticCode.PROVIDER_SIZE_REJECTED;
      } else if (code === "EENVELOPE") {
        // Envelope rejected without a parseable reply.
        safeCode = SmtpDiagnosticCode.REJECTED;
      } else if (responseCode !== undefined || hasResponse) {
        // Truncated, non-negative, or unparseable final reply: acceptance cannot be
        // confirmed, so the outcome stays unknown rather than claiming failure.
        return this.failureResult(
          SmtpDiagnosticCode.MALFORMED_RESPONSE,
          "unknown",
          startedAt,
          sizeBytes,
          responseCode,
        );
      } else {
        return this.failureResult(
          SmtpDiagnosticCode.CONNECTION_LOST,
          "unknown",
          startedAt,
          sizeBytes,
        );
      }
    } else if (code === "EAUTH") {
      safeCode = SmtpDiagnosticCode.AUTH_FAILED;
    } else if (code === "ETLS" || (code === "ESOCKET" && !systemFailure)) {
      safeCode = SmtpDiagnosticCode.TLS_HANDSHAKE_FAILED;
    } else if (code === "ETIMEDOUT") {
      safeCode = SmtpDiagnosticCode.CONNECTION_TIMEOUT;
    } else if (code === "EDNS" || code === "ECONNECTION" || code === "ESOCKET") {
      safeCode = SmtpDiagnosticCode.CONNECTION_FAILED;
    } else {
      safeCode = SmtpDiagnosticCode.PROTOCOL_ERROR;
    }

    return this.failureResult(
      safeCode,
      "failed",
      startedAt,
      sizeBytes,
      responseCode,
      // Only our own binding is reported; server-supplied recipient text is never echoed.
      command === "RCPT TO" ? [...recipients] : [],
    );
  }

  private failureResult(
    safeCode: SmtpDiagnosticCode,
    phase: SmtpOutcome,
    startedAt: number,
    sizeBytes: number,
    responseCode?: number,
    rejected: string[] = [],
  ): SmtpSubmitResult {
    return {
      phase,
      safeCode,
      ...(responseCode !== undefined ? { responseCode } : {}),
      accepted: [],
      rejected,
      sizeBytes,
      durationMs: Date.now() - startedAt,
    };
  }
}
