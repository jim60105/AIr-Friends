// tests/core/memory-recall/fast-recall.test.ts

import { assertEquals } from "@std/assert";
import {
  estimateMemorySectionTokens,
  RELEVANT_CHANNEL_MEMORY_HEADING,
  RELEVANT_MEMORY_HEADING,
  renderMemoryLine,
} from "@core/memory-recall/fast-recall.ts";
import { estimateTokens } from "@utils/token-counter.ts";
import { makeMemory } from "./memory-fixture.ts";

Deno.test("renderMemoryLine - a user memory is a bare content line", () => {
  assertEquals(renderMemoryLine(makeMemory({ content: "喜歡無糖綠茶" })), "- 喜歡無糖綠茶");
});

Deno.test("renderMemoryLine - a channel memory keeps its author attribution", () => {
  assertEquals(
    renderMemoryLine(makeMemory({ scope: "channel", author: "user-9", content: "週五打團" })),
    "- [from user-9] 週五打團",
  );
});

Deno.test("renderMemoryLine - a channel memory without an author names an unknown contributor", () => {
  assertEquals(
    renderMemoryLine(makeMemory({ scope: "channel", content: "週五打團" })),
    "- [from unknown contributor] 週五打團",
  );
});

Deno.test("estimateMemorySectionTokens - counts each heading once plus one line per memory", () => {
  const user = makeMemory({ content: "keyboard" });
  const channel = makeMemory({ scope: "channel", author: "user-9", content: "keyboard" });
  const userLine = estimateTokens("- keyboard");
  const channelLine = estimateTokens("- [from user-9] keyboard");

  assertEquals(estimateMemorySectionTokens([]), 0);
  assertEquals(
    estimateMemorySectionTokens([user]),
    estimateTokens(RELEVANT_MEMORY_HEADING) + userLine,
  );
  assertEquals(
    estimateMemorySectionTokens([user, user]),
    estimateTokens(RELEVANT_MEMORY_HEADING) + 2 * userLine,
  );
  assertEquals(
    estimateMemorySectionTokens([channel]),
    estimateTokens(RELEVANT_CHANNEL_MEMORY_HEADING) + channelLine,
  );
  assertEquals(
    estimateMemorySectionTokens([user, channel]),
    estimateTokens(RELEVANT_MEMORY_HEADING) +
      estimateTokens(RELEVANT_CHANNEL_MEMORY_HEADING) +
      userLine +
      channelLine,
  );
});
