/**
 * src/platforms/email/incoming-mime.ts
 *
 * Bounded RFC 2822/5322 MIME parser and provenance separation for email ingress,
 * owned by `email-incoming-mime`.
 *
 * Enforces:
 * 1. Byte limit (default 25 MiB / 26,214,400 bytes) checked before and during streaming.
 * 2. Attachment count limit (default 10) checked on stream arrival before buffering content.
 * 3. Header validation: single From mailbox normalized via `normalizeEmailMailbox`;
 *    bracketed RFC 5322 wireIds (Message-ID, In-Reply-To, References).
 * 4. Plain text preferred; inert HTML-to-text fallback with all remote resources / scripts disabled.
 * 5. Conservative provenance: separates authored, quoted, and forwarded content.
 *    Marks status "ambiguous" whenever HTML-only conversion, mixed markers, or uncertain
 *    delimiters occur, preventing unauthorized third-party destinations.
 * 6. Display-only attachment metadata: UUIDv4 assigned, filenames sanitized and stripped of paths.
 * 7. Privacy: no private message bodies, credentials, or header contents in diagnostic codes or logs.
 */

import { MailParser } from "mailparser";
import { convert } from "html-to-text";
import { BaseError, ErrorCode } from "../../types/errors.ts";
import { normalizeEmailMailbox } from "./email-identity.ts";
import type {
  EmailMessageIdentifiers,
  EmailProvenance,
  StoreAttachmentPayload,
  StoredAttachmentMetadata,
} from "./message-store.ts";

/** Default limits per RFC / design specs */
export const DEFAULT_MAX_MESSAGE_BYTES = 25 * 1024 * 1024; // 25 MiB = 26,214,400 bytes
export const DEFAULT_MAX_INCOMING_ATTACHMENTS = 10;

/** Diagnostic error codes for incoming MIME operations */
export enum IncomingMimeDiagnosticCode {
  CLEAN = "CLEAN",
  MESSAGE_EXCEEDS_SIZE_LIMIT = "MESSAGE_EXCEEDS_SIZE_LIMIT",
  ATTACHMENT_LIMIT_EXCEEDED = "ATTACHMENT_LIMIT_EXCEEDED",
  INVALID_FROM_HEADER = "INVALID_FROM_HEADER",
  INVALID_ROUTING_HEADER = "INVALID_ROUTING_HEADER",
  PARSE_ERROR = "PARSE_ERROR",
  STREAM_ABORTED = "STREAM_ABORTED",
}

/** Custom error for incoming MIME processing with privacy-safe diagnostics */
export class IncomingMimeError extends BaseError {
  readonly code = ErrorCode.PLATFORM_API_ERROR;
  readonly isRetryable = false;
  readonly diagnosticCode: IncomingMimeDiagnosticCode;

  constructor(
    diagnosticCode: IncomingMimeDiagnosticCode,
    message: string,
    options?: { context?: Record<string, unknown> },
  ) {
    super(`[${diagnosticCode}] ${message}`, {
      ...options?.context,
      diagnosticCode,
    });
    this.diagnosticCode = diagnosticCode;
  }
}

/** Parsed email attachment returned by parser */
export interface ParsedEmailAttachment {
  id: string;
  displayName?: string;
  mimeType: string;
  size: number;
  content: Uint8Array;
}

/** Complete parsed email result */
export interface ParsedEmail {
  from: string;
  subject?: string;
  wireIds: EmailMessageIdentifiers;
  plainBody: string;
  provenance: EmailProvenance;
  attachments: ParsedEmailAttachment[];
  sourceRef?: string;
  date?: Date;
}

/** Options for parsing incoming MIME content */
export interface ParseIncomingMimeOptions {
  maxMessageBytes?: number;
  maxIncomingAttachments?: number;
  declaredSize?: number;
  sourceRef?: string;
}

/** Type guard for header lines collected by mailparser */
interface MailParserHeaderLine {
  key: string;
  line: string;
}

function isHeaderLineArray(val: unknown): val is MailParserHeaderLine[] {
  return Array.isArray(val) && val.every(
    (item) => item !== null && typeof item === "object" && "key" in item && "line" in item,
  );
}

/**
 * Sanitize an attachment filename for safe display metadata.
 * Strips directory paths, parent traversals, control characters, and leading dots/slashes.
 */
export function sanitizeAttachmentDisplayName(
  rawFilename: string | undefined,
  index: number,
): string {
  if (!rawFilename || typeof rawFilename !== "string") {
    return `attachment-${index + 1}.dat`;
  }

  // Strip control chars (0x00-0x1F, 0x7F) and null bytes
  // deno-lint-ignore no-control-regex
  let cleaned = rawFilename.replace(/[\x00-\x1F\x7F]/g, "").trim();

  // Handle Windows and POSIX separators
  cleaned = cleaned.replace(/\\/g, "/");
  const lastSlash = cleaned.lastIndexOf("/");
  if (lastSlash >= 0) {
    cleaned = cleaned.slice(lastSlash + 1);
  }

  // Strip leading dots and spaces to avoid hidden files or relative paths
  cleaned = cleaned.replace(/^[.\s]+/, "");

  if (!cleaned || cleaned === "." || cleaned === "..") {
    return `attachment-${index + 1}.dat`;
  }

  return cleaned;
}

/**
 * Validate and extract RFC 5322 bracketed message identifiers.
 * Rejects malformed values that do not strictly match bracketed msg-id format.
 */
function extractStrictBracketedIds(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed) return [];

  // Match bracketed tokens
  const tokens = trimmed.match(/<[^<>\s]+>/g);
  if (!tokens || tokens.length === 0) {
    return null; // Malformed: missing bracketed format
  }

  // Verify there are no unbracketed non-whitespace tokens (other than optional CFWS)
  const stripped = trimmed.replace(/<[^<>\s]+>/g, " ").trim();
  if (stripped.length > 0) {
    return null; // Leftover unbracketed garbage
  }

  return tokens;
}

/**
 * Convert HTML to plain text inertly without executing scripts or loading images/styles.
 */
export function convertHtmlToInertText(html: string): string {
  if (!html || typeof html !== "string") {
    return "";
  }

  try {
    const text = convert(html, {
      wordwrap: false,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "noscript", format: "skip" },
        { selector: "iframe", format: "skip" },
        { selector: "object", format: "skip" },
        { selector: "embed", format: "skip" },
      ],
    });
    return text.trim();
  } catch {
    // If conversion fails, strip HTML tags via basic regex as safe fallback
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}

/**
 * Extract provenance from body text.
 * Separates authored text from quoted text (e.g. `> ...`, `On ... wrote:`, `-----Original Message-----`)
 * and forwarded text (e.g. `---------- Forwarded message ---------`).
 *
 * If `isHtmlOnly` is true or if markers are mixed/uncertain, sets status to "ambiguous".
 */
export function extractProvenance(
  body: string,
  options?: { isHtmlOnly?: boolean },
): EmailProvenance {
  const isHtmlOnly = options?.isHtmlOnly ?? false;
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    return {
      authoredText: "",
      status: "clean",
    };
  }

  // HTML-only conversion is inherently ambiguous per conservative authorization contract
  if (isHtmlOnly) {
    return {
      authoredText: trimmedBody,
      status: "ambiguous",
    };
  }

  const lines = trimmedBody.split(/\r?\n/);
  const authoredLines: string[] = [];
  const quotedLines: string[] = [];
  const forwardedLines: string[] = [];

  enum Section {
    AUTHORED,
    QUOTED_PREFIX,
    QUOTED_BLOCK,
    FORWARDED,
  }

  let currentSection = Section.AUTHORED;
  let hasAmbiguity = false;

  const FORWARD_MARKER_REGEX =
    /^(?:-{3,}\s*(?:Forwarded [Mm]essage|FORWARDED MESSAGE)\s*-{3,}|Begin forwarded message:?)/i;
  const ORIGINAL_MSG_MARKER_REGEX =
    /^(?:-{3,}\s*Original Message\s*-{3,}|_{5,}|-{5,}\s*Message d'origine\s*-{5,})/i;
  const QUOTE_ATTRIBUTION_REGEX =
    /^(?:On .+ (?:wrote|writes|scrive|schrieb|a écrit):?|At .+, .+ wrote:?)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Once inside a forwarded block, everything following belongs to forwardedLines
    if (currentSection === Section.FORWARDED) {
      forwardedLines.push(line);
      continue;
    }

    // Once inside an original message block, everything following belongs to quotedLines
    if (currentSection === Section.QUOTED_BLOCK) {
      quotedLines.push(line);
      continue;
    }

    // Check forward marker
    if (FORWARD_MARKER_REGEX.test(trimmedLine)) {
      currentSection = Section.FORWARDED;
      forwardedLines.push(line);
      continue;
    }

    // Check original message divider
    if (ORIGINAL_MSG_MARKER_REGEX.test(trimmedLine)) {
      currentSection = Section.QUOTED_BLOCK;
      quotedLines.push(line);
      continue;
    }

    // Check attribution line (e.g., On 2026-10-17, Alice wrote:)
    if (QUOTE_ATTRIBUTION_REGEX.test(trimmedLine)) {
      currentSection = Section.QUOTED_PREFIX;
      quotedLines.push(line);
      continue;
    }

    // Check line-anchored quote prefix '>'
    if (/^\s*>/.test(line)) {
      if (currentSection === Section.AUTHORED) {
        currentSection = Section.QUOTED_PREFIX;
      }
      quotedLines.push(line);
      continue;
    }

    // If we were in quoted section and encounter regular text again
    if (currentSection !== Section.AUTHORED) {
      if (trimmedLine === "") {
        quotedLines.push(line);
        continue;
      }

      // Inline reply or text following quoted block: creates mixed/interleaved authorship
      hasAmbiguity = true;
      authoredLines.push(line);
      currentSection = Section.AUTHORED;
      continue;
    }

    authoredLines.push(line);
  }

  const authoredText = authoredLines.join("\n").trim();
  const quotedText = quotedLines.length > 0 ? quotedLines.join("\n").trim() : undefined;
  const forwardedText = forwardedLines.length > 0 ? forwardedLines.join("\n").trim() : undefined;

  let status: "clean" | "ambiguous" = "clean";
  if (hasAmbiguity) {
    status = "ambiguous";
  }

  return {
    authoredText,
    ...(quotedText ? { quotedText } : {}),
    ...(forwardedText ? { forwardedText } : {}),
    status,
  };
}

/**
 * Validate raw header lines for duplicate or malformed From/Message-ID headers.
 */
function validateRawHeaderLines(headerLines: MailParserHeaderLine[]): {
  fromLines: string[];
  msgIdLines: string[];
  inReplyToLines: string[];
  referencesLines: string[];
} {
  const fromLines: string[] = [];
  const msgIdLines: string[] = [];
  const inReplyToLines: string[] = [];
  const referencesLines: string[] = [];

  for (const { key, line } of headerLines) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "from") {
      fromLines.push(line);
    } else if (lowerKey === "message-id") {
      msgIdLines.push(line);
    } else if (lowerKey === "in-reply-to") {
      inReplyToLines.push(line);
    } else if (lowerKey === "references") {
      referencesLines.push(line);
    }
  }

  return {
    fromLines,
    msgIdLines,
    inReplyToLines,
    referencesLines,
  };
}

/**
 * Parse an incoming MIME email from raw bytes, string, or Uint8Array stream.
 *
 * Enforces pre-byte size limit, attachment count limit, single From header,
 * bracketed wireIds, inert HTML fallback, and provenance separation.
 */
export async function parseIncomingMime(
  source: Uint8Array | string | ReadableStream<Uint8Array>,
  options?: ParseIncomingMimeOptions,
): Promise<ParsedEmail> {
  const maxBytes = options?.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const maxAttachments = options?.maxIncomingAttachments ?? DEFAULT_MAX_INCOMING_ATTACHMENTS;
  const declaredSize = options?.declaredSize;

  // 1. Check declared size before reading bytes
  if (typeof declaredSize === "number" && declaredSize > maxBytes) {
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.MESSAGE_EXCEEDS_SIZE_LIMIT,
      `Declared message size exceeds limit (${maxBytes} bytes)`,
    );
  }

  // 2. If source is already in memory, verify byte length before creating parser
  let stream: ReadableStream<Uint8Array>;
  if (typeof source === "string") {
    const encoded = new TextEncoder().encode(source);
    if (encoded.byteLength > maxBytes) {
      throw new IncomingMimeError(
        IncomingMimeDiagnosticCode.MESSAGE_EXCEEDS_SIZE_LIMIT,
        `Raw message size exceeds limit (${maxBytes} bytes)`,
      );
    }
    stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });
  } else if (source instanceof Uint8Array) {
    if (source.byteLength > maxBytes) {
      throw new IncomingMimeError(
        IncomingMimeDiagnosticCode.MESSAGE_EXCEEDS_SIZE_LIMIT,
        `Raw message size exceeds limit (${maxBytes} bytes)`,
      );
    }
    stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(source);
        controller.close();
      },
    });
  } else {
    stream = source;
  }

  return await parseFromStream(stream, maxBytes, maxAttachments, options?.sourceRef);
}

/**
 * Stream-based MIME parsing using mailparser's streaming events and backpressure.
 */
async function parseFromStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  maxAttachments: number,
  sourceRef?: string,
): Promise<ParsedEmail> {
  let totalBytes = 0;
  let attachmentCount = 0;
  let aborted = false;
  let abortError: IncomingMimeError | null = null;

  const parser = new MailParser({
    skipHtmlToText: true,
    skipImageLinks: true,
    skipTextToHtml: true,
  });

  const attachments: ParsedEmailAttachment[] = [];
  const attachmentPromises: Promise<void>[] = [];

  const reader = stream.getReader();

  // Coordinated abort helper: cancels stream reader, destroys parser, releases attachments
  const abortOperation = async (err: IncomingMimeError) => {
    if (aborted) return;
    aborted = true;
    abortError = err;

    try {
      await reader.cancel("Parsing aborted");
    } catch {
      // ignore
    }

    try {
      parser.destroy(err);
    } catch {
      // ignore
    }
  };

  const parsePromise = new Promise<void>((resolve, reject) => {
    parser.on("error", () => {
      const wrapped = abortError ?? new IncomingMimeError(
        IncomingMimeDiagnosticCode.PARSE_ERROR,
        "MIME parser encountered a syntax or stream error",
      );
      abortOperation(wrapped).finally(() => reject(wrapped));
    });
    parser.on("close", () => resolve());
    parser.on("end", () => resolve());
  });

  // Prevent unhandled rejection on parsePromise if early abort occurs
  parsePromise.catch(() => {});

  // Handle attachment events
  parser.on("data", (data: unknown) => {
    if (aborted) {
      if (data && typeof data === "object" && "release" in data) {
        const releaseFn = data.release;
        if (typeof releaseFn === "function") {
          try {
            releaseFn();
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    if (!data || typeof data !== "object" || !("type" in data) || data.type !== "attachment") {
      return;
    }

    const releaseFn = "release" in data && typeof data.release === "function" ? data.release : null;
    const filenameVal = "filename" in data && typeof data.filename === "string"
      ? data.filename
      : undefined;
    const contentTypeVal = "contentType" in data && typeof data.contentType === "string"
      ? data.contentType
      : "application/octet-stream";
    const contentStream = "content" in data && data.content && typeof data.content === "object"
      ? data.content
      : null;

    attachmentCount++;

    // Count exceeds limit: reject immediately on the 11th attachment before consuming
    if (attachmentCount > maxAttachments) {
      if (releaseFn) {
        try {
          releaseFn();
        } catch {
          // ignore
        }
      }
      const err = new IncomingMimeError(
        IncomingMimeDiagnosticCode.ATTACHMENT_LIMIT_EXCEEDED,
        `Incoming attachment count exceeded limit of ${maxAttachments}`,
      );
      abortOperation(err);
      return;
    }

    // Safe consumption of allowed attachment
    const attIndex = attachmentCount - 1;
    const attId = crypto.randomUUID().toLowerCase();
    const displayName = sanitizeAttachmentDisplayName(filenameVal, attIndex);
    const mimeType = contentTypeVal.toLowerCase();

    const chunks: Uint8Array[] = [];
    let attSize = 0;

    const attPromise = new Promise<void>((attResolve, attReject) => {
      if (!contentStream || !("on" in contentStream) || typeof contentStream.on !== "function") {
        if (releaseFn) releaseFn();
        attResolve();
        return;
      }

      contentStream.on("data", (chunk?: Uint8Array) => {
        if (aborted) return;
        if (chunk) {
          chunks.push(chunk);
          attSize += chunk.byteLength;
        }
      });

      contentStream.on("end", () => {
        try {
          if (releaseFn) releaseFn();
        } catch {
          // ignore
        }

        if (!aborted) {
          const merged = new Uint8Array(attSize);
          let offset = 0;
          for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
          }
          attachments.push({
            id: attId,
            displayName,
            mimeType,
            size: attSize,
            content: merged,
          });
        }
        attResolve();
      });

      contentStream.on("error", () => {
        try {
          if (releaseFn) releaseFn();
        } catch {
          // ignore
        }
        const wrapped = new IncomingMimeError(
          IncomingMimeDiagnosticCode.PARSE_ERROR,
          "Failed reading attachment payload stream",
        );
        abortOperation(wrapped).finally(() => attReject(wrapped));
      });
    });

    attPromise.catch(() => {});
    attachmentPromises.push(attPromise);
  });

  try {
    while (true) {
      if (aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await abortOperation(
          new IncomingMimeError(
            IncomingMimeDiagnosticCode.MESSAGE_EXCEEDS_SIZE_LIMIT,
            `Raw message size exceeded limit of ${maxBytes} bytes`,
          ),
        );
        break;
      }

      // Write chunk to parser
      const canContinue = parser.write(value);
      if (!canContinue && !aborted) {
        // Wait for drain or error/abort
        await new Promise<void>((drainResolve) => {
          const onDrain = () => {
            cleanup();
            drainResolve();
          };
          const onError = () => {
            cleanup();
            drainResolve();
          };
          const cleanup = () => {
            parser.removeListener("drain", onDrain);
            parser.removeListener("error", onError);
            parser.removeListener("close", onError);
          };
          parser.once("drain", onDrain);
          parser.once("error", onError);
          parser.once("close", onError);
        });
      }
    }
  } catch {
    await abortOperation(
      new IncomingMimeError(
        IncomingMimeDiagnosticCode.STREAM_ABORTED,
        "Source stream reading was aborted or failed",
      ),
    );
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (aborted) {
    throw abortError ||
      new IncomingMimeError(IncomingMimeDiagnosticCode.PARSE_ERROR, "Parsing aborted");
  }

  // Finalize parser
  try {
    parser.end();
  } catch {
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.PARSE_ERROR,
      "Failed to finalize parser stream",
    );
  }

  // Await parser end and all attachment consumers
  try {
    await Promise.all([parsePromise, ...attachmentPromises]);
  } catch (err) {
    if (aborted && abortError) {
      throw abortError;
    }
    if (abortError) {
      throw abortError;
    }
    if (err instanceof IncomingMimeError) {
      throw err;
    }
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.PARSE_ERROR,
      "MIME parsing or attachment decoding failed",
    );
  }

  if (aborted && abortError) {
    throw abortError;
  }

  // --- Validate Headers ---
  let rawHeaders: MailParserHeaderLine[] = [];
  if ("headerLines" in parser && isHeaderLineArray(parser.headerLines)) {
    rawHeaders = parser.headerLines;
  }

  const { fromLines, msgIdLines, inReplyToLines, referencesLines } = validateRawHeaderLines(
    rawHeaders,
  );

  // Require exactly one From header line
  if (fromLines.length === 0) {
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.INVALID_FROM_HEADER,
      "Missing required From header",
    );
  }
  if (fromLines.length > 1) {
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.INVALID_FROM_HEADER,
      "Multiple From headers detected",
    );
  }

  // Parse From address via mailparser parsed headers or raw line
  const parsedFromHeader = parser.headers.get("from");
  let rawFromAddress = "";

  if (
    parsedFromHeader &&
    typeof parsedFromHeader === "object" &&
    "value" in parsedFromHeader &&
    Array.isArray(parsedFromHeader.value)
  ) {
    const addrs = parsedFromHeader.value;
    if (addrs.length === 0) {
      throw new IncomingMimeError(
        IncomingMimeDiagnosticCode.INVALID_FROM_HEADER,
        "From header has no valid mailbox",
      );
    }
    if (addrs.length > 1) {
      throw new IncomingMimeError(
        IncomingMimeDiagnosticCode.INVALID_FROM_HEADER,
        "Multiple From addresses in single header",
      );
    }
    const firstAddr = addrs[0];
    if (firstAddr && typeof firstAddr === "object" && "address" in firstAddr) {
      rawFromAddress = typeof firstAddr.address === "string" ? firstAddr.address : "";
    }
  } else {
    const colonIdx = fromLines[0].indexOf(":");
    rawFromAddress = colonIdx >= 0 ? fromLines[0].slice(colonIdx + 1).trim() : fromLines[0];
  }

  if (!rawFromAddress) {
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.INVALID_FROM_HEADER,
      "Unable to extract From address",
    );
  }

  // Normalize via normalizeEmailMailbox (ensures canonical address and rejects group/multi syntax)
  let canonicalFrom = "";
  try {
    const normalized = normalizeEmailMailbox(rawFromAddress);
    canonicalFrom = normalized.canonicalAddress;
  } catch {
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.INVALID_FROM_HEADER,
      "Invalid From mailbox address",
    );
  }

  // Routing headers validation: Message-ID at most one
  if (msgIdLines.length > 1) {
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.INVALID_ROUTING_HEADER,
      "Multiple Message-ID headers detected",
    );
  }

  let wireMessageId: string | undefined;
  if (msgIdLines.length === 1) {
    const colonIdx = msgIdLines[0].indexOf(":");
    const headerVal = colonIdx >= 0 ? msgIdLines[0].slice(colonIdx + 1).trim() : msgIdLines[0];
    const ids = extractStrictBracketedIds(headerVal);
    if (!ids || ids.length !== 1) {
      throw new IncomingMimeError(
        IncomingMimeDiagnosticCode.INVALID_ROUTING_HEADER,
        "Malformed or multi-valued Message-ID header",
      );
    }
    wireMessageId = ids[0];
  }

  // In-Reply-To: at most one header
  if (inReplyToLines.length > 1) {
    throw new IncomingMimeError(
      IncomingMimeDiagnosticCode.INVALID_ROUTING_HEADER,
      "Multiple In-Reply-To headers detected",
    );
  }

  let wireInReplyTo: string | undefined;
  if (inReplyToLines.length === 1) {
    const colonIdx = inReplyToLines[0].indexOf(":");
    const headerVal = colonIdx >= 0
      ? inReplyToLines[0].slice(colonIdx + 1).trim()
      : inReplyToLines[0];
    const ids = extractStrictBracketedIds(headerVal);
    if (!ids || ids.length === 0) {
      throw new IncomingMimeError(
        IncomingMimeDiagnosticCode.INVALID_ROUTING_HEADER,
        "Malformed In-Reply-To header",
      );
    }
    wireInReplyTo = ids[0];
  }

  // References: accumulate in order, validate bracketed syntax strictly
  const wireReferences: string[] = [];
  for (const refLine of referencesLines) {
    const colonIdx = refLine.indexOf(":");
    const headerVal = colonIdx >= 0 ? refLine.slice(colonIdx + 1).trim() : refLine;
    const ids = extractStrictBracketedIds(headerVal);
    if (!ids) {
      throw new IncomingMimeError(
        IncomingMimeDiagnosticCode.INVALID_ROUTING_HEADER,
        "Malformed References header",
      );
    }
    wireReferences.push(...ids);
  }

  const wireIds: EmailMessageIdentifiers = {
    ...(wireMessageId ? { messageId: wireMessageId } : {}),
    ...(wireInReplyTo ? { inReplyTo: wireInReplyTo } : {}),
    references: wireReferences,
  };

  // Subject
  const subjectHeader = parser.headers.get("subject");
  const subject = typeof subjectHeader === "string" ? subjectHeader.trim() : undefined;

  // Date
  const dateHeader = parser.headers.get("date");
  const date = dateHeader instanceof Date
    ? dateHeader
    : (typeof dateHeader === "string" ? new Date(dateHeader) : undefined);

  // Body content: prefer text/plain
  const hasTextProp = "hasText" in parser && Boolean(parser.hasText);
  const hasHtmlProp = "hasHtml" in parser && Boolean(parser.hasHtml);
  const textProp = "text" in parser && typeof parser.text === "string" ? parser.text : "";
  const htmlProp = "html" in parser && typeof parser.html === "string" ? parser.html : "";

  let plainBody = "";
  let isHtmlOnly = false;

  if (hasTextProp && textProp.trim()) {
    plainBody = textProp.trim();
  } else if (hasHtmlProp && htmlProp.trim()) {
    isHtmlOnly = true;
    plainBody = convertHtmlToInertText(htmlProp);
  } else if (textProp) {
    plainBody = textProp.trim();
  }

  // Provenance extraction
  const provenance = extractProvenance(plainBody, { isHtmlOnly });

  return {
    from: canonicalFrom,
    ...(subject ? { subject } : {}),
    wireIds,
    plainBody,
    provenance,
    attachments,
    ...(sourceRef ? { sourceRef } : {}),
    ...(date && !isNaN(date.getTime()) ? { date } : {}),
  };
}

/**
 * Adapter helper to transform ParsedEmail into EmailMessageStore-compatible ParsedEmailData.
 */
export function toMessageStoreParsedEmail(parsed: ParsedEmail): {
  from: string;
  subject?: string;
  wireIds?: EmailMessageIdentifiers;
  plainBody: string;
  provenance: EmailProvenance;
  attachments: StoredAttachmentMetadata[];
  attachmentPayloads: StoreAttachmentPayload[];
  sourceRef?: string;
  date?: Date;
} {
  const attachments: StoredAttachmentMetadata[] = parsed.attachments.map((att) => ({
    id: att.id,
    displayName: att.displayName,
    filename: att.displayName,
    mimeType: att.mimeType,
    size: att.size,
  }));

  const attachmentPayloads: StoreAttachmentPayload[] = parsed.attachments.map((att) => ({
    id: att.id,
    displayName: att.displayName,
    filename: att.displayName,
    mimeType: att.mimeType,
    content: att.content,
  }));

  return {
    from: parsed.from,
    subject: parsed.subject,
    wireIds: parsed.wireIds,
    plainBody: parsed.plainBody,
    provenance: parsed.provenance,
    attachments,
    attachmentPayloads,
    sourceRef: parsed.sourceRef,
    date: parsed.date,
  };
}
