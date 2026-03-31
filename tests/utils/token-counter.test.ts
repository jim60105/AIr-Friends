import { assertEquals } from "@std/assert";
import {
  combinedTokenCount,
  estimateTokens,
  truncateToTokenLimit,
} from "../../src/utils/token-counter.ts";

Deno.test("estimateTokens - returns 0 for empty string", () => {
  assertEquals(estimateTokens(""), 0);
});

Deno.test("estimateTokens - returns 0 for undefined-like input", () => {
  assertEquals(estimateTokens(""), 0);
});

Deno.test("estimateTokens - counts ASCII characters at ~0.25 per char", () => {
  const result = estimateTokens("hello");
  // 5 * 0.25 * 1.1 = 1.375 -> ceil = 2
  assertEquals(result, 2);
});

Deno.test("estimateTokens - counts CJK characters at 1 per char", () => {
  const result = estimateTokens("你好世界");
  // 4 * 1.0 * 1.1 = 4.4 -> ceil = 5
  assertEquals(result, 5);
});

Deno.test("estimateTokens - counts hiragana characters", () => {
  const result = estimateTokens("あいう");
  // 3 * 1.0 * 1.1 = 3.3 -> ceil = 4
  assertEquals(result, 4);
});

Deno.test("estimateTokens - counts katakana characters", () => {
  const result = estimateTokens("アイウ");
  // 3 * 1.0 * 1.1 = 3.3 -> ceil = 4
  assertEquals(result, 4);
});

Deno.test("estimateTokens - counts hangul characters", () => {
  const result = estimateTokens("가나다");
  // 3 * 1.0 * 1.1 = 3.3 -> ceil = 4
  assertEquals(result, 4);
});

Deno.test("estimateTokens - counts non-ASCII non-CJK at 0.5 per char", () => {
  const result = estimateTokens("éàü");
  // 3 * 0.5 * 1.1 = 1.65 -> ceil = 2
  assertEquals(result, 2);
});

Deno.test("estimateTokens - handles mixed content", () => {
  const result = estimateTokens("hi你好");
  // 2*0.25 + 2*1.0 = 2.5, * 1.1 = 2.75 -> ceil = 3
  assertEquals(result, 3);
});

Deno.test("truncateToTokenLimit - returns text when within limit", () => {
  assertEquals(truncateToTokenLimit("hello", 100), "hello");
});

Deno.test("truncateToTokenLimit - truncates text exceeding limit", () => {
  const longText = "a".repeat(1000);
  const result = truncateToTokenLimit(longText, 10);
  assertEquals(result.endsWith("..."), true);
  assertEquals(result.length < longText.length, true);
});

Deno.test("truncateToTokenLimit - adds ellipsis on truncation", () => {
  const text = "abcdefghijklmnopqrstuvwxyz".repeat(10);
  const result = truncateToTokenLimit(text, 5);
  assertEquals(result.endsWith("..."), true);
});

Deno.test("combinedTokenCount - sums token counts of multiple strings", () => {
  const result = combinedTokenCount("hello", "world");
  assertEquals(result, estimateTokens("hello") + estimateTokens("world"));
});

Deno.test("combinedTokenCount - handles empty array", () => {
  assertEquals(combinedTokenCount(), 0);
});
