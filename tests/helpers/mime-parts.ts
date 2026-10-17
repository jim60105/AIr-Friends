// tests/helpers/mime-parts.ts
//
// Dependency-free MIME part walker for the row-21 forwarding tests.
//
// A forward claims byte preservation, so the verification must not hand the captured wire bytes
// to a lenient parser first: this walker splits a message on its declared boundaries and returns
// each LEAF part's raw body as a latin1 string (one character per byte, so slicing cannot change
// a byte). The caller decides how to interpret the body, using the reported transfer encoding:
// `decodePartBody` decodes base64 exactly and passes anything else through byte-for-byte.

/** One leaf part of a MIME message, with its raw (still encoded) body. */
export interface RawMimePart {
  /** Lower-cased media type without parameters. */
  contentType: string;
  /** Display filename from `Content-Type`/`Content-Disposition`, when the part carries one. */
  filename?: string;
  /** Lower-cased `Content-Transfer-Encoding`, or `""` when absent. */
  transferEncoding: string;
  /**
   * Raw body text after the part's header block. The CRLF that belongs to the following boundary
   * delimiter is already excluded, exactly as RFC 2046 attaches it to the delimiter.
   */
  body: string;
}

/** Byte-preserving latin1 view of one wire message (one character per byte). */
export function latin1Decode(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

/** Encode a latin1 view back to the exact bytes it came from. */
export function latin1Encode(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function readHeader(headers: string, name: string): string | undefined {
  const match = new RegExp(`^${name}:([^\\r\\n]*(?:\\r\\n[ \\t][^\\r\\n]*)*)`, "im")
    .exec(headers);
  return match?.[1]?.replace(/\r\n[ \t]+/g, " ").trim();
}

function firstParameter(value: string | undefined, parameter: string): string | undefined {
  if (value === undefined) return undefined;
  return new RegExp(`(?:^|;)\\s*${parameter}=(?:"([^"]*)"|([^;\\s]*))`, "i")
    .exec(value)
    ?.slice(1)
    .find((candidate) => candidate !== undefined);
}

/**
 * Every LEAF part of a captured message, in wire order.
 *
 * Multipart containers are descended into; a message/rfc822 or text part is returned as a leaf so
 * the caller can compare its bytes directly.
 */
export function parseMimeParts(text: string): RawMimePart[] {
  const headerEnd = text.indexOf("\r\n\r\n");
  if (headerEnd < 0) {
    return [];
  }
  const headers = text.slice(0, headerEnd);
  const rawBody = text.slice(headerEnd + 4);
  const contentTypeHeader = readHeader(headers, "Content-Type");
  const contentType = (contentTypeHeader ?? "").split(";")[0].trim().toLowerCase();
  const transferEncoding = (readHeader(headers, "Content-Transfer-Encoding") ?? "").toLowerCase();
  const filename = firstParameter(contentTypeHeader, "name") ??
    firstParameter(readHeader(headers, "Content-Disposition"), "filename");

  if (!contentType.startsWith("multipart/")) {
    return [{
      contentType,
      ...(filename === undefined ? {} : { filename }),
      transferEncoding,
      body: rawBody,
    }];
  }

  const boundary = firstParameter(contentTypeHeader, "boundary");
  if (boundary === undefined) {
    throw new Error("multipart part without a boundary parameter");
  }
  // The first delimiter may sit directly at the start of the body, so normalize it to the
  // CRLF-prefixed form every later delimiter has and drop the preamble.
  const normalized = rawBody.startsWith(`--${boundary}`) ? `\r\n${rawBody}` : rawBody;
  const segments = normalized.split(`\r\n--${boundary}`).slice(1);
  const parts: RawMimePart[] = [];
  for (const segment of segments) {
    if (segment.startsWith("--")) break; // closing delimiter
    parts.push(...parseMimeParts(segment.replace(/^\r\n/, "")));
  }
  return parts;
}

/**
 * Quoted-printable decoding of a text part body: soft line breaks are removed and `=XX` escapes
 * become their byte, leaving every other character exactly as written.
 */
function decodeQuotedPrintable(body: string): string {
  return body
    .replaceAll(/=\r?\n/g, "")
    .replaceAll(
      /=([0-9A-Fa-f]{2})/g,
      (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

/** The exact bytes of one part body, decoded per its transfer encoding. */
export function decodePartBody(part: RawMimePart): Uint8Array {
  if (part.transferEncoding === "base64") {
    const encoded = part.body.replaceAll(/[\r\n]/g, "");
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  }
  if (part.transferEncoding === "quoted-printable") {
    return latin1Encode(decodeQuotedPrintable(part.body));
  }
  return latin1Encode(part.body);
}
