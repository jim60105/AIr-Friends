// tests/core/memory-recall/indexed-memory.test.ts

import { assert, assertEquals } from "@std/assert";
import { index } from "./memory-fixture.ts";

Deno.test("indexMemory - indexes a mixed-script memory", () => {
  const indexed = index({ content: "我在 AIr-Friends 用 Air75 V3 打字" });

  // Entities are the entity tokens; the tf keys carry the kind.
  assertEquals([...indexed.entities].sort(), ["air-friends", "air75 v3"]);
  assertEquals(indexed.tf.get("entity:air-friends"), 1);
  assertEquals(indexed.tf.get("word:air"), 1);
  assertEquals(indexed.tf.get("word:friends"), 1);
  assertEquals(indexed.tf.get("entity:air75 v3"), 1);
  assertEquals(indexed.tf.get("word:air75"), 1);
  assertEquals(indexed.tf.get("word:v3"), 1);
  assert(!indexed.tf.has("air"));
  assert(indexed.tf.has("bigram:打字"));

  assertEquals(indexed.normalizedText, "我在 air-friends 用 air75 v3 打字");

  let total = 0;
  for (const count of indexed.tf.values()) total += count;
  assertEquals(indexed.length, total);
  assert(indexed.length > 0);
});

Deno.test("indexMemory - counts repeated terms and keeps the token count", () => {
  const indexed = index({ content: "keyboard keyboard" });
  assertEquals(indexed.tf.size, 1);
  assertEquals(indexed.tf.get("word:keyboard"), 2);
  assertEquals(indexed.length, 2);
  assertEquals(indexed.entities.size, 0);
});

Deno.test("indexMemory - a word and a bigram with the same characters stay distinct", () => {
  const indexed = index({ content: "喜歡" });
  assertEquals(indexed.tf.get("word:喜歡"), 1);
  assertEquals(indexed.tf.get("bigram:喜歡"), 1);
  assertEquals(indexed.length, 2);
});
