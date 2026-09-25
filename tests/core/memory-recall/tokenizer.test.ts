// tests/core/memory-recall/tokenizer.test.ts

import { assert, assertEquals } from "@std/assert";
import { MemoryTokenizer } from "@core/memory-recall/tokenizer.ts";
import type { SearchToken } from "@core/memory-recall/types.ts";

// Lazy: the shared instance loads the vendored dictionary at the first call.
const tokenizer = new MemoryTokenizer();

function terms(tokens: SearchToken[]): string[] {
  return tokens.map((token) => token.term);
}

function hasToken(tokens: SearchToken[], term: string, kind: SearchToken["kind"]): boolean {
  return tokens.some((token) => token.term === term && token.kind === kind);
}

Deno.test("MemoryTokenizer - Traditional Chinese words are segmented as words", () => {
  const tokens = tokenizer.tokenize("使用者喜歡喝無糖綠茶");
  // Pinned against the vendored dict.txt.big: jieba precise mode (HMM on).
  assertEquals(tokens, [
    { term: "使用者", kind: "word", weight: 1 },
    { term: "喜歡", kind: "word", weight: 1 },
    { term: "喝無糖", kind: "word", weight: 1 },
    { term: "綠茶", kind: "word", weight: 1 },
    { term: "使用", kind: "bigram", weight: 0.25 },
    { term: "用者", kind: "bigram", weight: 0.25 },
    { term: "者喜", kind: "bigram", weight: 0.25 },
    { term: "喜歡", kind: "bigram", weight: 0.25 },
    { term: "歡喝", kind: "bigram", weight: 0.25 },
    { term: "喝無", kind: "bigram", weight: 0.25 },
    { term: "無糖", kind: "bigram", weight: 0.25 },
    { term: "糖綠", kind: "bigram", weight: 0.25 },
    { term: "綠茶", kind: "bigram", weight: 0.25 },
  ]);
});

Deno.test("MemoryTokenizer - mixed-script entities are preserved", () => {
  const tokens = tokenizer.tokenize("我在 AIr-Friends 用 OpenClaw 搭配 Air75 V3");
  assertEquals(tokens, [
    { term: "我在", kind: "bigram", weight: 0.25 },
    { term: "air-friends", kind: "entity", weight: 1.5 },
    { term: "air", kind: "word", weight: 1 },
    { term: "friends", kind: "word", weight: 1 },
    { term: "用", kind: "word", weight: 1 },
    { term: "openclaw", kind: "entity", weight: 1.5 },
    { term: "open", kind: "word", weight: 1 },
    { term: "claw", kind: "word", weight: 1 },
    { term: "搭配", kind: "word", weight: 1 },
    { term: "搭配", kind: "bigram", weight: 0.25 },
    { term: "air75 v3", kind: "entity", weight: 1.5 },
    { term: "air75", kind: "word", weight: 1 },
    { term: "v3", kind: "word", weight: 1 },
  ]);
});

Deno.test("MemoryTokenizer - bigram fallback recovers partial matches", () => {
  const document = tokenizer.tokenize("記憶系統");
  const query = tokenizer.tokenize("記憶");
  assert(hasToken(document, "記憶系統", "word"));
  assert(hasToken(document, "記憶", "bigram"));
  assert(hasToken(query, "記憶", "bigram"));
});

Deno.test("MemoryTokenizer - stopwords are removed", () => {
  const tokens = tokenizer.tokenize("我的鍵盤");
  for (const token of tokens) {
    assert(token.term !== "的");
    assert(token.term !== "我");
  }
  assert(hasToken(tokens, "鍵盤", "word"));
});

Deno.test("MemoryTokenizer - a lone stopword yields no tokens", () => {
  assertEquals(tokenizer.tokenize("的"), []);
});

Deno.test("MemoryTokenizer - prototype-chain keys are not treated as stopwords", () => {
  // `constructor` shares a name with Object.prototype.constructor; a plain
  // object stopword table would drop it via prototype lookup. It must survive.
  const tokens = tokenizer.tokenize("a constructor b");
  assert(hasToken(tokens, "constructor", "word"));
  assert(hasToken(tokens, "a", "word"));
  assert(hasToken(tokens, "b", "word"));
});

Deno.test("MemoryTokenizer - run entities join with - . _ and emit parts as words", () => {
  const tokens = tokenizer.tokenize("v0.31.1");
  assertEquals(tokens, [
    { term: "v0.31.1", kind: "entity", weight: 1.5 },
    { term: "v0", kind: "word", weight: 1 },
    { term: "31", kind: "word", weight: 1 },
    { term: "1", kind: "word", weight: 1 },
  ]);
});

Deno.test("MemoryTokenizer - entity parts never join into spurious pair entities", () => {
  // The parts of `v0.31.1` (v0 / 31 / 1) must not pair with a following token:
  // `1 rc7` would be a spurious 1.5-weight entity polluting retrieval.
  const tokens = tokenizer.tokenize("v0.31.1 rc7");
  assertEquals(
    terms(tokens),
    ["v0.31.1", "v0", "31", "1", "rc7"],
  );
  assert(!hasToken(tokens, "1 rc7", "entity"));
});

Deno.test("MemoryTokenizer - adjacent short tokens with a digit form one entity", () => {
  const tokens = tokenizer.tokenize("a7c ii");
  assertEquals(tokens, [
    { term: "a7c ii", kind: "entity", weight: 1.5 },
    { term: "a7c", kind: "word", weight: 1 },
    { term: "ii", kind: "word", weight: 1 },
  ]);
});

Deno.test("MemoryTokenizer - CamelCase tokens are consumed as entities before pairing", () => {
  // `OpenClaw` is a CamelCase entity itself, so it never pairs with `Air75`;
  // the plain pair `Air75 V3` still forms an entity.
  const tokens = tokenizer.tokenize("OpenClaw Air75 V3");
  assert(hasToken(tokens, "openclaw", "entity"));
  assert(hasToken(tokens, "open", "word"));
  assert(hasToken(tokens, "claw", "word"));
  assert(hasToken(tokens, "air75 v3", "entity"));
  assert(!hasToken(tokens, "openclaw air75", "entity"));
});

Deno.test("MemoryTokenizer - long plain tokens do not pair", () => {
  const tokens = tokenizer.tokenize("configuration 2024");
  assert(!hasToken(tokens, "configuration 2024", "entity"));
  assert(hasToken(tokens, "configuration", "word"));
  assert(hasToken(tokens, "2024", "word"));
});

Deno.test("MemoryTokenizer - NFKC normalization and lowercasing", () => {
  // Full-width Latin and digits fold to ASCII before extraction.
  assertEquals(terms(tokenizer.tokenize("ＡＢＣ")), ["abc"]);
  assertEquals(terms(tokenizer.tokenize("air７５ ｖ３")), ["air75 v3", "air75", "v3"]);
  assertEquals(terms(tokenizer.tokenize("ＯｐｅｎＣｌａｗ")), ["openclaw", "open", "claw"]);
});

Deno.test("MemoryTokenizer - punctuation and whitespace yield no tokens", () => {
  assertEquals(tokenizer.tokenize(",-_ \t!?、。"), []);
});

Deno.test("MemoryTokenizer - fixed weights by kind", () => {
  const tokens = tokenizer.tokenize("OpenClaw 搭配");
  const entity = tokens.find((token) => token.kind === "entity")!;
  const word = tokens.find((token) => token.term === "搭配" && token.kind === "word")!;
  const bigram = tokens.find((token) => token.kind === "bigram")!;
  assertEquals(entity.weight, 1.5);
  assertEquals(word.weight, 1);
  assertEquals(bigram.weight, 0.25);
});

Deno.test("MemoryTokenizer - same input tokenized twice returns deep-equal arrays", () => {
  const input = "我在 AIr-Friends 用 OpenClaw 搭配 Air75 V3 我的鍵盤";
  assertEquals(tokenizer.tokenize(input), tokenizer.tokenize(input));
});

Deno.test("MemoryTokenizer - the input string is never modified", () => {
  const input = "我在 AIr-Friends 用 OpenClaw 搭配 Air75 V3";
  const before = input;
  tokenizer.tokenize(input);
  assertEquals(input, before);
});

Deno.test("MemoryTokenizer - degrades when the segmenter fails to load", () => {
  const failing = new MemoryTokenizer(() => {
    throw new Error("boom");
  });
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    failing.tokenize("我的鍵盤");
    const first = failing.tokenize("喜歡 Air75 V3");
    const second = failing.tokenize("喜歡 Air75 V3");
    // One error logged, not one per call.
    assertEquals(errors.length, 1);
    // Entities and bigrams survive; segmentation words do not.
    assert(hasToken(first, "air75 v3", "entity"));
    assert(hasToken(first, "喜歡", "bigram"));
    assert(!hasToken(first, "喜歡", "word"));
    assertEquals(first, second);
    // A different instance shares the same process-wide log-once guarantee.
    const other = new MemoryTokenizer(() => null);
    other.tokenize("測試");
    assertEquals(errors.length, 1);
  } finally {
    console.error = originalError;
  }
});
