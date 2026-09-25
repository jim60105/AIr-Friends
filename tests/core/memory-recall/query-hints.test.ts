// tests/core/memory-recall/query-hints.test.ts

import { assert, assertEquals } from "@std/assert";
import { buildQuery, detectHints } from "@core/memory-recall/query-hints.ts";
import type { QueryHints } from "@core/memory-recall/types.ts";

/** Every hint term of the spec, with a message that contains it and nothing else. */
const HINT_CASES: ReadonlyArray<[hint: keyof QueryHints, term: string, message: string]> = [
  ["current", "現在", "我現在用什麼鍵盤"],
  ["current", "目前", "我目前用什麼鍵盤"],
  ["current", "最近", "我最近用什麼鍵盤"],
  ["current", "後來", "我後來用什麼鍵盤"],
  ["current", "最後", "我最後用什麼鍵盤"],
  ["current", "current", "I want the current one"],
  ["current", "latest", "I want the latest one"],
  ["current", "recent", "I want the recent one"],
  ["current", "eventually", "I want the eventually one"],
  ["historical", "以前", "我以前用什麼鍵盤"],
  ["historical", "之前", "我之前用什麼鍵盤"],
  ["historical", "當時", "我當時用什麼鍵盤"],
  ["historical", "最初", "我最初用什麼鍵盤"],
  ["historical", "原本", "我原本用什麼鍵盤"],
  ["historical", "previously", "I saw it previously"],
  ["historical", "before", "I saw it before"],
  ["historical", "originally", "I saw it originally"],
  ["preference", "喜歡", "我喜歡什麼鍵盤"],
  ["preference", "討厭", "我討厭什麼鍵盤"],
  ["preference", "偏好", "我偏好什麼鍵盤"],
  ["preference", "最愛", "我最愛什麼鍵盤"],
  ["preference", "prefer", "I prefer tea"],
  ["preference", "favorite", "my favorite tea"],
  ["preference", "like", "I like tea"],
  ["preference", "dislike", "I dislike tea"],
];

for (const [hint, term, message] of HINT_CASES) {
  Deno.test(`detectHints - detects ${hint} from ${JSON.stringify(term)}`, () => {
    const expected: QueryHints = { current: false, historical: false, preference: false };
    expected[hint] = true;
    assertEquals(detectHints(message), expected);
  });
}

Deno.test("detectHints - a Latin hint term needs a word boundary", () => {
  assertEquals(detectHints("unlikely to matter"), {
    current: false,
    historical: false,
    preference: false,
  });
});

Deno.test("detectHints - hints are read from the current message only", () => {
  // `detectHints` takes one message, so a previous message can never set a hint.
  assert(detectHints("我原本用什麼鍵盤").historical);
  assertEquals(detectHints("我的鍵盤是哪一個"), {
    current: false,
    historical: false,
    preference: false,
  });
});

Deno.test("buildQuery - the current message weighs 1.0 and the previous one 0.35", () => {
  const query = buildQuery("keyboard", "mouse");
  assertEquals(query.tokens.get("word:keyboard")?.weight, 1.0);
  assertEquals(query.tokens.get("word:mouse")?.weight, 0.35);
  assertEquals(query.tokens.size, 2);
});

Deno.test("buildQuery - a term in both messages keeps the larger weight", () => {
  const query = buildQuery("keyboard", "keyboard");
  assertEquals(query.tokens.size, 1);
  assertEquals(query.tokens.get("word:keyboard")?.weight, 1.0);
});

Deno.test("buildQuery - the effective weight is the kind weight times the source weight", () => {
  const query = buildQuery("keyboard", "Air75 V3");
  assertEquals(query.tokens.get("entity:air75 v3")?.weight, 1.5 * 0.35);
  assertEquals(query.tokens.get("word:air75")?.weight, 0.35);
  assertEquals(query.tokens.get("word:v3")?.weight, 0.35);
});

Deno.test("buildQuery - entities and the phrase source come from the current message only", () => {
  const query = buildQuery("無糖綠茶", "Air75 V3");
  // The previous message still contributes query tokens...
  assert(query.tokens.has("entity:air75 v3"));
  // ...but never an entity-bonus source or a phrase window.
  assertEquals(query.entities.size, 0);
  assert(query.phraseTokens.every((token) => token.term !== "air75"));
  // The phrase source is the current message's words and entities, in order.
  assert(query.phraseTokens.every((token) => token.kind !== "bigram"));
  assertEquals(query.phraseTokens.map((token) => token.term).join(""), "無糖綠茶");
});

Deno.test("buildQuery - the phrase source keeps the tokenizer order", () => {
  const query = buildQuery("用 Air75 V3");
  assertEquals(query.phraseTokens.map((token) => token.term), ["用", "air75 v3", "air75", "v3"]);
  assertEquals([...query.entities], ["air75 v3"]);
});
