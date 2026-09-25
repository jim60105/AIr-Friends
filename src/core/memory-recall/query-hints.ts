// src/core/memory-recall/query-hints.ts

import { MemoryTokenizer } from "./tokenizer.ts";
import type { QueryHints, QueryToken, RecallQuery, SearchToken } from "./types.ts";
import { tokenKey } from "./types.ts";

/** Fixed hint term lists (Memory Recall v2 design, §5.4). */
const HINT_TERMS: Record<keyof QueryHints, readonly string[]> = {
  current: ["現在", "目前", "最近", "後來", "最後", "current", "latest", "recent", "eventually"],
  historical: ["以前", "之前", "當時", "最初", "原本", "previously", "before", "originally"],
  preference: ["喜歡", "討厭", "偏好", "最愛", "prefer", "favorite", "like", "dislike"],
};

/** One hint term and how it is matched. */
interface HintMatcher {
  hint: keyof QueryHints;
  term: string;
  /** Word-boundary matcher for a Latin term; null for a CJK term (substring match). */
  latin: RegExp | null;
}

const HINT_MATCHERS: readonly HintMatcher[] = (["current", "historical", "preference"] as const)
  .flatMap((hint) =>
    HINT_TERMS[hint].map((term) => ({
      hint,
      term,
      latin: /^[a-z]+$/.test(term) ? new RegExp(`\\b${term}\\b`) : null,
    }))
  );

/**
 * Detects the hints of one message. Hints are read from the current user message
 * only; a previous message never sets them, so callers pass the current message.
 */
export function detectHints(message: string): QueryHints {
  const lower = message.toLowerCase();
  const hints: QueryHints = { current: false, historical: false, preference: false };
  for (const matcher of HINT_MATCHERS) {
    if (hints[matcher.hint]) continue;
    const matched = matcher.latin === null
      ? lower.includes(matcher.term)
      : matcher.latin.test(lower);
    if (matched) hints[matcher.hint] = true;
  }
  return hints;
}

/** Source weights (Memory Recall v2 design, §5.1). */
const CURRENT_SOURCE_WEIGHT = 1.0;
const PREVIOUS_SOURCE_WEIGHT = 0.35;

/** Shared instance; `tokenize` is stateless and loads the dictionary once per process. */
const tokenizer = new MemoryTokenizer();

/**
 * Builds the query of one recall request. A term keeps the largest effective
 * weight across both messages, so the current message always wins. Entities and
 * the phrase source come from the current message only: the previous message
 * contributes query tokens, never bonuses.
 */
export function buildQuery(current: string, previous?: string): RecallQuery {
  const currentTokens = tokenizer.tokenize(current);
  const tokens = new Map<string, QueryToken>();
  mergeTokens(tokens, currentTokens, CURRENT_SOURCE_WEIGHT);
  if (previous !== undefined) {
    mergeTokens(tokens, tokenizer.tokenize(previous), PREVIOUS_SOURCE_WEIGHT);
  }
  return {
    tokens,
    entities: new Set(
      currentTokens.filter((token) => token.kind === "entity").map((token) => token.term),
    ),
    phraseTokens: currentTokens.filter((token) => token.kind !== "bigram"),
  };
}

function mergeTokens(
  tokens: Map<string, QueryToken>,
  found: readonly SearchToken[],
  sourceWeight: number,
): void {
  for (const token of found) {
    const key = tokenKey(token.kind, token.term);
    const weight = token.weight * sourceWeight;
    const existing = tokens.get(key);
    if (existing === undefined || weight > existing.weight) {
      tokens.set(key, { key, term: token.term, kind: token.kind, weight });
    }
  }
}
