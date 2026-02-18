// tests/utils/hash.test.ts

import { assertEquals, assertMatch } from "@std/assert";
import { sanitizeSkillParams, sha256Hash } from "@utils/hash.ts";

Deno.test("sha256Hash - produces correct hex digest", async () => {
  const hash = await sha256Hash("hello");
  assertEquals(hash, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

Deno.test("sha256Hash - empty string", async () => {
  const hash = await sha256Hash("");
  assertEquals(hash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

Deno.test("sanitizeSkillParams - hashes content fields when hashContent is true", async () => {
  const params = {
    content: "secret data",
    visibility: "public",
    query: "search query",
  };

  const result = await sanitizeSkillParams(params, true);
  assertMatch(result.content as string, /^sha256:[a-f0-9]{64}$/);
  assertMatch(result.query as string, /^sha256:[a-f0-9]{64}$/);
  assertEquals(result.visibility, "public");
});

Deno.test("sanitizeSkillParams - passes through when hashContent is false", async () => {
  const params = {
    content: "secret data",
    visibility: "public",
  };

  const result = await sanitizeSkillParams(params, false);
  assertEquals(result.content, "secret data");
  assertEquals(result.visibility, "public");
});

Deno.test("sanitizeSkillParams - only hashes known content fields", async () => {
  const params = {
    content: "user text",
    message: "reply message",
    text: "some text",
    query: "search",
    replyContent: "reply",
    visibility: "public",
    importance: "high",
    id: "abc123",
  };

  const result = await sanitizeSkillParams(params, true);
  assertMatch(result.content as string, /^sha256:/);
  assertMatch(result.message as string, /^sha256:/);
  assertMatch(result.text as string, /^sha256:/);
  assertMatch(result.query as string, /^sha256:/);
  assertMatch(result.replyContent as string, /^sha256:/);
  assertEquals(result.visibility, "public");
  assertEquals(result.importance, "high");
  assertEquals(result.id, "abc123");
});

Deno.test("sanitizeSkillParams - does not hash non-string content fields", async () => {
  const params = {
    content: 42,
    query: true,
  };

  const result = await sanitizeSkillParams(params as Record<string, unknown>, true);
  assertEquals(result.content, 42);
  assertEquals(result.query, true);
});

Deno.test("sanitizeSkillParams - recursively hashes nested content fields", async () => {
  const params = {
    outer: "plain",
    nested: {
      content: "secret nested",
      visibility: "public",
    },
  };

  const result = await sanitizeSkillParams(params as Record<string, unknown>, true);
  assertEquals(result.outer, "plain");
  const nested = result.nested as Record<string, unknown>;
  assertMatch(nested.content as string, /^sha256:/);
  assertEquals(nested.visibility, "public");
});
