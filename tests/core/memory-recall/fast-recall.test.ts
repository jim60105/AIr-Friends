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
  // Literals: the user heading is 5 estimated tokens and a short line is 3, so
  // a heading charged per entry instead of per kind cannot pass.
  assertEquals(estimateMemorySectionTokens([user]), 8);
  assertEquals(estimateMemorySectionTokens([user, user]), 11);
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
  // The measurement does not depend on the order the memories were selected in.
  assertEquals(
    estimateMemorySectionTokens([channel, user]),
    estimateMemorySectionTokens([user, channel]),
  );
});
