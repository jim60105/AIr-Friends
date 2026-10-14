// src/utils/json-source.ts
//
// Minimal SOURCE-PRESERVING JSON/JSONC reader and text editor.
//
// `generate-opencode-skill-discovery-declaration` updates exactly two places in
// a deployed configuration an operator may have written by hand — the skill
// discovery path list and one external-directory allowance — while its delta
// spec requires every OTHER setting in that file, including the routing that
// sends script executions to the approval gate, to stay BYTE-IDENTICAL. A
// parse → mutate → `JSON.stringify` round trip cannot promise that: it re-wraps
// compact subobjects, normalizes escape/number spellings and line endings, and
// rejects outright the JSONC comments and trailing commas OpenCode itself
// accepts.
//
// So this module reads a document into a node tree that RETAINS each node's
// source span, and every mutation is a text splice at those spans. Untouched
// bytes are copied verbatim — comments included — which is also why the reader
// tolerates `//`, `/* */` and trailing commas.
//
// This module has no authority of its own: it never interprets a document, it
// only locates values and splices text. Interpretation (which key means what,
// and whether a value is acceptable) belongs to the caller.

/** A malformed document, with the offset the reader stopped at. */
export class JsonSourceError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} (offset ${offset})`);
    this.name = "JsonSourceError";
  }
}

/** One object member: the DECODED key plus its value node (source order kept). */
export interface JsonSourceMember {
  readonly key: string;
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly value: JsonSourceNode;
}

export interface JsonSourceObject {
  readonly kind: "object";
  /** Offset of the opening `{`. */
  readonly start: number;
  /** Offset one past the closing `}`. */
  readonly end: number;
  readonly members: readonly JsonSourceMember[];
}

export interface JsonSourceArray {
  readonly kind: "array";
  /** Offset of the opening `[`. */
  readonly start: number;
  /** Offset one past the closing `]`. */
  readonly end: number;
  readonly items: readonly JsonSourceNode[];
}

export interface JsonSourceScalar {
  readonly kind: "scalar";
  /** Offset of the first character of the literal. */
  readonly start: number;
  /** Offset one past the literal. */
  readonly end: number;
  /** The literal's verbatim source text (a JSON string, number, or keyword). */
  readonly raw: string;
}

export type JsonSourceNode = JsonSourceObject | JsonSourceArray | JsonSourceScalar;

/** Recursive-descent reader over the document text. */
class JsonSourceReader {
  private index = 0;

  constructor(private readonly source: string) {}

  readDocument(): JsonSourceNode {
    this.skipTrivia();
    const node = this.readValue();
    this.skipTrivia();
    if (this.index !== this.source.length) {
      throw new JsonSourceError("Trailing content after the document value", this.index);
    }
    return node;
  }

  private readValue(): JsonSourceNode {
    const char = this.source[this.index];
    if (char === "{") return this.readObject();
    if (char === "[") return this.readArray();
    if (char === '"') return this.readString();
    return this.readLiteral();
  }

  private readObject(): JsonSourceObject {
    const start = this.index;
    this.index += 1; // `{`
    const members: JsonSourceMember[] = [];
    for (;;) {
      this.skipTrivia();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return { kind: "object", start, end: this.index, members };
      }
      if (this.index >= this.source.length) {
        throw new JsonSourceError("Unterminated object", this.index);
      }
      const keyStart = this.index;
      const keyNode = this.readString();
      const key = JSON.parse(keyNode.raw) as string;
      this.skipTrivia();
      if (this.source[this.index] !== ":") {
        throw new JsonSourceError('Expected ":" after an object key', this.index);
      }
      this.index += 1;
      this.skipTrivia();
      const value = this.readValue();
      members.push({ key, keyStart, keyEnd: keyNode.end, value });
      this.skipTrivia();
      if (this.source[this.index] === ",") {
        this.index += 1;
        continue;
      }
      if (this.source[this.index] === "}") {
        this.index += 1;
        return { kind: "object", start, end: this.index, members };
      }
      throw new JsonSourceError('Expected "," or "}" in an object', this.index);
    }
  }

  private readArray(): JsonSourceArray {
    const start = this.index;
    this.index += 1; // `[`
    const items: JsonSourceNode[] = [];
    for (;;) {
      this.skipTrivia();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return { kind: "array", start, end: this.index, items };
      }
      if (this.index >= this.source.length) {
        throw new JsonSourceError("Unterminated array", this.index);
      }
      items.push(this.readValue());
      this.skipTrivia();
      if (this.source[this.index] === ",") {
        this.index += 1;
        continue;
      }
      if (this.source[this.index] === "]") {
        this.index += 1;
        return { kind: "array", start, end: this.index, items };
      }
      throw new JsonSourceError('Expected "," or "]" in an array', this.index);
    }
  }

  private readString(): JsonSourceScalar {
    const start = this.index;
    this.index += 1; // opening quote
    for (;;) {
      const char = this.source[this.index];
      if (char === undefined) throw new JsonSourceError("Unterminated string", this.index);
      if (char === "\\") {
        this.index += 2;
        continue;
      }
      this.index += 1;
      if (char === '"') {
        const raw = this.source.slice(start, this.index);
        // A JSON string token is exactly what the round trip must preserve, so
        // a decoding failure is reported here rather than at use time.
        try {
          JSON.parse(raw);
        } catch {
          throw new JsonSourceError("Malformed string literal", start);
        }
        return { kind: "scalar", start, end: this.index, raw };
      }
    }
  }

  /** A number, `true`, `false` or `null` — read as its verbatim span. */
  private readLiteral(): JsonSourceScalar {
    const start = this.index;
    // A literal ends at the next structural delimiter, at any trivia, or at a
    // comment opener: `jsonc-parser` accepts `false/* note */,` and the literal
    // must not swallow the adjacent comment into its own span.
    while (this.index < this.source.length) {
      const char = this.source[this.index]!;
      if (",}]\t\n\r ".includes(char)) break;
      if (
        char === "/" && (this.source[this.index + 1] === "/" || this.source[this.index + 1] === "*")
      ) {
        break;
      }
      this.index += 1;
    }
    if (this.index === start) {
      throw new JsonSourceError("Expected a value", start);
    }
    const raw = this.source.slice(start, this.index);
    try {
      JSON.parse(raw);
    } catch {
      throw new JsonSourceError("Malformed literal", start);
    }
    return { kind: "scalar", start, end: this.index, raw };
  }

  /** Whitespace plus the JSONC comments the pinned loader accepts. */
  private skipTrivia(): void {
    for (;;) {
      const char = this.source[this.index];
      if (char === undefined) return;
      if (char === " " || char === "\t" || char === "\n" || char === "\r") {
        this.index += 1;
        continue;
      }
      if (char === "/" && this.source[this.index + 1] === "/") {
        const newline = this.source.indexOf("\n", this.index);
        this.index = newline < 0 ? this.source.length : newline + 1;
        continue;
      }
      if (char === "/" && this.source[this.index + 1] === "*") {
        const close = this.source.indexOf("*/", this.index + 2);
        if (close < 0) throw new JsonSourceError("Unterminated comment", this.index);
        this.index = close + 2;
        continue;
      }
      return;
    }
  }
}

/** Parse one JSON/JSONC document; throws {@link JsonSourceError} when malformed. */
export function parseJsonSource(source: string): JsonSourceNode {
  return new JsonSourceReader(source).readDocument();
}

/** The named member of an object, or `undefined`. */
export function jsonMember(
  object: JsonSourceObject,
  key: string,
): JsonSourceMember | undefined {
  return object.members.find((member) => member.key === key);
}

/** The decoded value of a scalar node (`JSON.parse` of its verbatim span). */
export function jsonScalarValue(node: JsonSourceNode): unknown {
  if (node.kind !== "scalar") {
    throw new JsonSourceError("A scalar node was required", node.start);
  }
  return JSON.parse(node.raw);
}

/** Splice `text` over `[start, end)`; every other byte is copied verbatim. */
export function jsonReplaceSpan(
  source: string,
  start: number,
  end: number,
  text: string,
): string {
  return source.slice(0, start) + text + source.slice(end);
}

/**
 * Insert one member text as the LAST member of an object, matching the
 * surrounding indentation and reusing an existing trailing comma. Everything
 * already in the object keeps its bytes and its order.
 */
export function jsonInsertMember(
  source: string,
  object: JsonSourceObject,
  memberText: string,
): string {
  const last = object.members[object.members.length - 1];
  if (last === undefined) {
    const outer = lineIndent(source, object.start);
    // An empty object's interior is REPLACED only when it holds nothing but
    // whitespace. Authored trivia inside it (a `//` or `/* */` note) keeps its
    // bytes and the member is placed after it: "everything already in the
    // object keeps its bytes" holds for an object with no members too.
    const interior = source.slice(object.start + 1, object.end - 1);
    if (interior.trim() === "") {
      return jsonReplaceSpan(
        source,
        object.start + 1,
        object.end - 1,
        `\n${outer}  ${memberText}\n${outer}`,
      );
    }
    return jsonReplaceSpan(
      source,
      object.end - 1,
      object.end - 1,
      `${/\n[ \t]*$/.test(interior) ? "" : "\n"}${outer}  ${memberText}\n${outer}`,
    );
  }
  const indent = jsonMemberIndent(source, object);
  const after = skipTriviaForward(source, last.value.end);
  if (source[after] === ",") {
    const insertAt = after + 1;
    return jsonReplaceSpan(source, insertAt, insertAt, `\n${indent}${memberText}`);
  }
  return jsonReplaceSpan(source, last.value.end, last.value.end, `,\n${indent}${memberText}`);
}

/**
 * The indentation a NEW member of `object` is inserted with: the indentation of
 * its last existing member, or one level deeper than the object's own line.
 * Exported so a caller composing a MULTI-LINE member text can indent its inner
 * lines to the same level the inserted member lands on.
 */
export function jsonMemberIndent(source: string, object: JsonSourceObject): string {
  const last = object.members[object.members.length - 1];
  if (last === undefined) return `${lineIndent(source, object.start)}  `;
  return lineIndent(source, last.keyStart) || `${lineIndent(source, object.start)}  `;
}

/**
 * Remove one member by key, consuming one adjacent comma and its trailing
 * newline/indent so the removed line leaves no blank remainder. A missing key
 * is a no-op.
 */
export function jsonRemoveMember(
  source: string,
  object: JsonSourceObject,
  key: string,
): string {
  const member = jsonMember(object, key);
  if (member === undefined) return source;
  const after = skipTriviaForward(source, member.value.end);
  if (source[after] === ",") {
    let removalEnd = after + 1;
    const remainder = /^[ \t]*\r?\n[ \t]*/.exec(source.slice(removalEnd));
    if (remainder) removalEnd += remainder[0].length;
    return jsonReplaceSpan(source, member.keyStart, removalEnd, "");
  }
  const before = skipTriviaBackward(source, member.keyStart);
  const removalStart = source[before] === "," ? before : member.keyStart;
  return jsonReplaceSpan(source, removalStart, member.value.end, "");
}

/** The whitespace prefix of the line `offset` sits on, when it is pure indentation. */
function lineIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}

/** First offset at or after `index` holding neither trivia nor a comment. */
function skipTriviaForward(source: string, index: number): number {
  let cursor = index;
  for (;;) {
    const char = source[cursor];
    if (char === undefined) return cursor;
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      cursor += 1;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      const newline = source.indexOf("\n", cursor);
      cursor = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    return cursor;
  }
}

/** Last offset before `index` holding neither trivia nor a comment. */
function skipTriviaBackward(source: string, index: number): number {
  let cursor = index - 1;
  while (cursor >= 0) {
    const char = source[cursor]!;
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      cursor -= 1;
      continue;
    }
    if (char === "/" && source[cursor - 1] === "*") {
      const open = source.lastIndexOf("/*", cursor - 2);
      cursor = open < 0 ? -1 : open - 1;
      continue;
    }
    return cursor;
  }
  return cursor;
}
