// src/core/memory-recall/note-chunker.ts

import { basename } from "@std/path";

/**
 * A chunk is split again at blank lines when its text is longer than this
 * (Memory Recall v2 design, §6). A single paragraph longer than the limit
 * stands alone, so a chunk is "about" this long rather than strictly shorter.
 */
const MAX_CHUNK_CHARS = 600;

/** ATX heading of level 1 to 3; the only levels the chunker reacts to. */
const HEADING_RE = /^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/;

/** Fenced code block delimiter; a `#` inside a fence is not a heading. */
const FENCE_RE = /^\s{0,3}(?:`{3,}|~{3,})/;

/** Sentence terminators the excerpt builder splits on (Memory Recall v2 design, §6). */
const SENTENCE_BOUNDARY_RE = /[。！？!?]/;

/** A note chunk before indexing. */
export interface NoteChunk {
  /** Heading path of the chunk, `[title]` for text before the first `##`. */
  headingPath: string[];

  /** 1-based inclusive line range of the chunk. */
  lineStart: number;
  lineEnd: number;

  /** Chunk text, the source of excerpts and of the lexical index. */
  text: string;
}

/** A parsed note: its document title and its chunks in line order. */
export interface ParsedNote {
  /** First level-1 heading, otherwise the file name without its extension. */
  title: string;
  chunks: NoteChunk[];
}

/** A chunk before the blank-line split, held as a line range of the note. */
interface RawChunk {
  headingPath: string[];
  /** 1-based inclusive line range. */
  startLine: number;
  endLine: number;
}

/**
 * Splits a note into heading-based chunks (Memory Recall v2 design, §6).
 *
 * A chunk starts at every level-2 or level-3 heading and runs to the line
 * before the next one; text before the first such heading forms a chunk whose
 * heading path is `[title]`. The heading path keeps the last `#`, `##` and
 * `###` heading seen, and a `#` inside a fenced code block is not a heading.
 * Chunks longer than about 600 characters are split again at blank lines.
 */
export function parseNote(content: string, filePath: string): ParsedNote {
  const lines = content.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
  const title = firstLevelOneHeading(lines) ?? basename(filePath).replace(/\.md$/i, "");

  const raw: RawChunk[] = [];
  let h1: string | null = null;
  let h2: string | null = null;
  let h3: string | null = null;
  let chunkStart = 1;
  let chunkHeadingPath: string[] = [title];
  let inFence = false;

  const flush = (endLine: number): void => {
    let end = endLine;
    while (end >= chunkStart && lines[end - 1].trim() === "") end--;
    if (end < chunkStart) return;
    raw.push({ headingPath: chunkHeadingPath, startLine: chunkStart, endLine: end });
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING_RE.exec(line);
    if (heading === null) continue;

    const level = heading[1].length;
    const text = heading[2].trim();
    if (level === 1) {
      h1 = text;
      h2 = null;
      h3 = null;
      continue;
    }

    // A level-2 or level-3 heading opens a chunk whose first line is the heading.
    flush(index);
    chunkStart = index + 1;
    if (level === 2) {
      h2 = text;
      h3 = null;
    } else {
      h3 = text;
    }
    chunkHeadingPath = [h1, h2, h3].filter((part): part is string => part !== null);
  }
  flush(lines.length);

  const chunks: NoteChunk[] = [];
  for (const chunk of raw) chunks.push(...splitLongChunk(chunk, lines));
  return { title, chunks };
}

/**
 * Excerpt of `text` around its best-matching sentences (Memory Recall v2
 * design, §6). Sentences are split on `。！？!?` and newlines; the sentence
 * containing the most distinct matched terms wins, ties going to the earliest,
 * and the following sentences are appended while the excerpt stays within
 * `maxChars`. A longer excerpt is cut around the first matched term and marked
 * with `…` at each end. Excerpts come from the original text.
 */
export function buildExcerpt(
  text: string,
  matchedTerms: readonly string[],
  maxChars: number,
): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return "";

  let best = 0;
  let bestCount = -1;
  for (let index = 0; index < sentences.length; index++) {
    const count = countMatchedTerms(sentences[index], matchedTerms);
    if (count > bestCount) {
      bestCount = count;
      best = index;
    }
  }

  let excerpt = sentences[best];
  for (let index = best + 1; index < sentences.length; index++) {
    const next = sentences[index];
    if (excerpt.length + 1 + next.length > maxChars) break;
    excerpt += ` ${next}`;
  }

  return excerpt.length <= maxChars ? excerpt : cutAroundTerm(excerpt, matchedTerms, maxChars);
}

/** Splits a chunk longer than the limit at blank lines, packing paragraphs greedily. */
function splitLongChunk(chunk: RawChunk, lines: readonly string[]): NoteChunk[] {
  const text = lines.slice(chunk.startLine - 1, chunk.endLine).join("\n");
  if (text.length <= MAX_CHUNK_CHARS) {
    return [{
      headingPath: chunk.headingPath,
      lineStart: chunk.startLine,
      lineEnd: chunk.endLine,
      text,
    }];
  }

  const parts: NoteChunk[] = [];
  let start = -1;
  let end = -1;
  const flushPart = (): void => {
    if (start < 0) return;
    parts.push({
      headingPath: chunk.headingPath,
      lineStart: chunk.startLine + start,
      lineEnd: chunk.startLine + end,
      text: lines.slice(chunk.startLine - 1 + start, chunk.startLine + end).join("\n"),
    });
    start = -1;
    end = -1;
  };

  const lineCount = chunk.endLine - chunk.startLine + 1;
  for (let offset = 0; offset < lineCount; offset++) {
    // Blank lines separate paragraphs; they stay inside a packed part's range.
    if (lines[chunk.startLine - 1 + offset].trim() === "") continue;
    if (start >= 0) {
      const projected = lines
        .slice(chunk.startLine - 1 + start, chunk.startLine + offset)
        .join("\n");
      if (projected.length > MAX_CHUNK_CHARS) flushPart();
    }
    if (start < 0) start = offset;
    end = offset;
  }
  flushPart();
  return parts;
}

/** Splits text into trimmed sentences at terminators and newlines. */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = "";
  for (const char of text) {
    if (char === "\n" || SENTENCE_BOUNDARY_RE.test(char)) {
      if (char !== "\n") current += char;
      pushSentence(sentences, current);
      current = "";
      continue;
    }
    current += char;
  }
  pushSentence(sentences, current);
  return sentences;
}

function pushSentence(sentences: string[], sentence: string): void {
  const trimmed = sentence.trim();
  if (trimmed.length > 0) sentences.push(trimmed);
}

/** Distinct matched terms contained in one sentence, matched as the tokenizer does. */
function countMatchedTerms(sentence: string, matchedTerms: readonly string[]): number {
  const haystack = sentence.normalize("NFKC").toLowerCase();
  let count = 0;
  for (const term of matchedTerms) {
    if (haystack.includes(term)) count++;
  }
  return count;
}

/** Cuts a window of `maxChars` around the first matched term, `…` on each cut end. */
function cutAroundTerm(
  text: string,
  matchedTerms: readonly string[],
  maxChars: number,
): string {
  const haystack = text.toLowerCase();
  let found: { index: number; length: number } | null = null;
  for (const term of matchedTerms) {
    const index = haystack.indexOf(term);
    if (index >= 0 && (found === null || index < found.index)) {
      found = { index, length: term.length };
    }
  }

  let start = 0;
  if (found !== null) {
    const half = Math.max(0, Math.floor((maxChars - found.length) / 2));
    start = Math.min(Math.max(found.index - half, 0), Math.max(0, text.length - maxChars));
  }
  const end = start + maxChars;
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return `${head}${text.slice(start, end).trim()}${tail}`;
}

/** First level-1 heading of the note, or `null` when it has none. */
function firstLevelOneHeading(lines: readonly string[]): string | null {
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = HEADING_RE.exec(line);
    if (heading !== null && heading[1].length === 1) return heading[2].trim();
  }
  return null;
}
