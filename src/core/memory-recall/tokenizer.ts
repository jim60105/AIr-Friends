// src/core/memory-recall/tokenizer.ts

import { Jieba } from "@node-rs/jieba";
import { createLogger } from "@utils/logger.ts";
import type { SearchToken, TokenKind } from "./types.ts";

const logger = createLogger("MemoryTokenizer");

/** Fixed per-kind weights (Memory Recall v2 design, §4). */
const WEIGHTS: Record<TokenKind, number> = {
  word: 1.0,
  entity: 1.5,
  bigram: 0.25,
};

/**
 * Single-character CJK stopwords (design D7). These appear in nearly every
 * memory; dropping them is the primary false-positive gate. The list is fixed.
 * A null prototype keeps prototype-chain keys (e.g. `constructor`) from being
 * mistaken for stopword entries.
 */
const STOPWORDS: Record<string, true> = Object.assign(Object.create(null), {
  "的": true,
  "了": true,
  "在": true,
  "是": true,
  "我": true,
  "你": true,
  "他": true,
  "也": true,
  "就": true,
  "都": true,
  "和": true,
  "與": true,
});

/**
 * Two standalone alphanumeric tokens are joined into one entity only when both
 * are this short (e.g. `a7c ii`, `air75 v3`). The bound excludes common longer
 * words (`configuration`, `opencode`, ...) that would otherwise glue onto a
 * digit-bearing neighbour and pollute retrieval with spurious 1.5-weight terms.
 */
const SHORT_TOKEN_MAX_LENGTH = 8;

/**
 * Vendored Traditional-capable dictionary (fxsjy/jieba `dict.txt.big`), resolved
 * relative to this module so it works from any working directory.
 */
const DICT_URL = new URL("../../../assets/jieba/dict.txt.big", import.meta.url);

/** CJK Unified Ideographs incl. Extension A. */
const CJK_CHAR_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

/** Maximal alphanumeric run (optionally joined by `-`, `.` or `_`) or CJK run. */
const SEGMENT_RE = /[A-Za-z0-9]+(?:[-._][A-Za-z0-9]+)*|[\u3400-\u4dbf\u4e00-\u9fff]+/g;

/** CamelCase/PascalCase split points: `OpenClaw` -> `Open` + `Claw`, `XMLHttpRequest` -> `XML` + `Http` + `Request`. */
const CAMEL_SPLIT_RE = /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;

type Segment =
  | { type: "cjk"; value: string }
  | { type: "run"; value: string }
  | { type: "camel"; value: string }
  | { type: "plain"; value: string };

/**
 * Loads the vendored dictionary once per process; returns null on any failure,
 * never throws. All instances share the cached result.
 */
let defaultSegmenter: Jieba | null | undefined;
function loadDefaultSegmenter(): Jieba | null {
  if (defaultSegmenter === undefined) {
    try {
      defaultSegmenter = Jieba.withDict(Deno.readFileSync(DICT_URL));
    } catch {
      defaultSegmenter = null;
    }
  }
  return defaultSegmenter;
}

/** Injects the word segmenter; tests use a failing loader to exercise degradation. */
export type SegmenterLoader = () => Jieba | null;

/** Guarantees the segmenter failure is logged exactly once per process. */
let segmenterFailureLogged = false;

function splitCamel(value: string): string[] {
  return value.split(CAMEL_SPLIT_RE).filter((part) => part.length > 0);
}

function classify(value: string): Segment {
  if (CJK_CHAR_RE.test(value)) return { type: "cjk", value };
  if (/[-._]/.test(value)) return { type: "run", value };
  if (splitCamel(value).length > 1) return { type: "camel", value };
  return { type: "plain", value };
}

/**
 * Deterministic, CPU-only tokenizer for long-term memories, agent workspace
 * notes and recall queries (Memory Recall v2 design, §4). It normalizes with
 * NFKC, extracts entity tokens, segments CJK runs with a Traditional-capable
 * dictionary, emits CJK bigrams with fixed weights and drops stopwords.
 *
 * The pipeline never modifies its input and never converts between Simplified
 * and Traditional forms. The same input always yields the same tokens in the
 * same order.
 */
export class MemoryTokenizer {
  /** undefined = not yet attempted, null = failed (degraded), otherwise loaded. */
  private segmenter: Jieba | null | undefined;

  constructor(private readonly loader: SegmenterLoader = loadDefaultSegmenter) {}

  tokenize(text: string): SearchToken[] {
    const normalized = text.normalize("NFKC");
    const tokens: SearchToken[] = [];
    const segments: Segment[] = [];

    for (const match of normalized.matchAll(SEGMENT_RE)) {
      segments.push(classify(match[0]));
    }

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.type === "cjk") {
        this.tokenizeCjkRun(segment.value, tokens);
      } else if (segment.type === "run") {
        this.emitEntity(segment.value, tokens);
        // Component parts of a joined run are word tokens too.
        for (const part of segment.value.split(/[-._]/)) {
          this.emitWord(part, tokens);
        }
      } else if (segment.type === "camel") {
        this.emitEntity(segment.value, tokens);
        // Component parts of a CamelCase word are word tokens too.
        for (const part of splitCamel(segment.value)) {
          this.emitWord(part, tokens);
        }
      } else {
        const next = segments[i + 1];
        if (
          next?.type === "plain" &&
          segment.value.length <= SHORT_TOKEN_MAX_LENGTH &&
          next.value.length <= SHORT_TOKEN_MAX_LENGTH &&
          (/[0-9]/.test(segment.value) || /[0-9]/.test(next.value))
        ) {
          // Two adjacent short alphanumeric tokens, at least one with a digit,
          // form one entity (e.g. `a7c ii`, `air75 v3`).
          this.emitEntity(`${segment.value} ${next.value}`, tokens);
          this.emitWord(segment.value, tokens);
          this.emitWord(next.value, tokens);
          i++;
        } else {
          this.emitWord(segment.value, tokens);
        }
      }
    }

    return tokens.filter((token) => token.kind !== "word" || !STOPWORDS[token.term]);
  }

  /**
   * Words come from precise-mode segmentation (HMM on) of each CJK run, then
   * every adjacent character pair of the run is emitted as a bigram. Both are
   * emitted even when the segmenter degraded; only the words are lost. The
   * segmenter is re-fetched per run so a mid-segmentation failure degrades the
   * remaining runs of the same call instead of retrying the broken instance.
   */
  private tokenizeCjkRun(run: string, tokens: SearchToken[]): void {
    const segmenter = this.getSegmenter();
    if (segmenter !== null) {
      try {
        for (const word of segmenter.cut(run, true)) {
          this.emitWord(word, tokens);
        }
      } catch {
        this.failSegmenter();
      }
    }
    for (let i = 0; i + 1 < run.length; i++) {
      tokens.push({
        term: run.slice(i, i + 2),
        kind: "bigram",
        weight: WEIGHTS.bigram,
      });
    }
  }

  /**
   * Lazily loads the segmenter once per instance. Any load failure (missing
   * binding, missing FFI permission, unreadable dictionary) degrades the
   * tokenizer to entities plus bigrams: it is logged once per process and
   * never re-attempted, and tokenize() never throws because of it.
   */
  private getSegmenter(): Jieba | null {
    if (this.segmenter === undefined) {
      try {
        this.segmenter = this.loader();
      } catch {
        this.segmenter = null;
      }
      if (this.segmenter === null && !segmenterFailureLogged) {
        segmenterFailureLogged = true;
        logger.error(
          "jieba segmenter failed to load; tokenizer degrades to entity and bigram tokens",
        );
      }
    }
    return this.segmenter;
  }

  private failSegmenter(): void {
    if (!segmenterFailureLogged) {
      segmenterFailureLogged = true;
      logger.error(
        "jieba segmenter failed during segmentation; tokenizer degrades to entity and bigram tokens",
      );
    }
    this.segmenter = null;
  }

  private emitEntity(value: string, tokens: SearchToken[]): void {
    tokens.push({ term: value.toLowerCase(), kind: "entity", weight: WEIGHTS.entity });
  }

  private emitWord(value: string, tokens: SearchToken[]): void {
    tokens.push({ term: value.toLowerCase(), kind: "word", weight: WEIGHTS.word });
  }
}
