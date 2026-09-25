// tests/core/memory-recall/fast-recall.test.ts

import { assertEquals } from "@std/assert";
import {
  estimateMemorySectionTokens,
  RELEVANT_CHANNEL_MEMORY_HEADING,
  RELEVANT_MEMORY_HEADING,
  renderFastRecallSection,
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

Deno.test("renderFastRecallSection - an empty selection renders nothing", () => {
  assertEquals(renderFastRecallSection([]), "");
});

Deno.test("renderFastRecallSection - user memories render under the Relevant Memory heading", () => {
  assertEquals(
    renderFastRecallSection([
      makeMemory({ content: "喜歡無糖綠茶" }),
      makeMemory({ content: "用 Deno 開發" }),
    ]),
    `${RELEVANT_MEMORY_HEADING}\n\n- 喜歡無糖綠茶\n- 用 Deno 開發\n`,
  );
});

Deno.test("renderFastRecallSection - channel memories render attributed under the unverified heading", () => {
  assertEquals(
    renderFastRecallSection([
      makeMemory({ scope: "channel", author: "user-9", content: "週五打團" }),
      makeMemory({ scope: "channel", content: "頻道主題是後端" }),
    ]),
    `${RELEVANT_CHANNEL_MEMORY_HEADING}\n\n- [from user-9] 週五打團\n- [from unknown contributor] 頻道主題是後端\n`,
  );
});

Deno.test("renderFastRecallSection - both kinds keep their own heading, user memories first", () => {
  const section = renderFastRecallSection([
    makeMemory({ scope: "channel", author: "user-9", content: "週五打團" }),
    makeMemory({ content: "喜歡無糖綠茶" }),
  ]);

  assertEquals(
    section,
    `${RELEVANT_MEMORY_HEADING}\n\n- 喜歡無糖綠茶\n\n` +
      `${RELEVANT_CHANNEL_MEMORY_HEADING}\n\n- [from user-9] 週五打團\n`,
  );
  // A channel memory is never listed under the user heading.
  assertEquals(
    section.indexOf("- [from user-9]") > section.indexOf(RELEVANT_CHANNEL_MEMORY_HEADING),
    true,
  );
});

Deno.test("renderFastRecallSection - the prompt carries no ids, scores or metadata", () => {
  const section = renderFastRecallSection([
    makeMemory({ id: "mem-secret-id", content: "喜歡無糖綠茶" }),
  ]);

  assertEquals(section.includes("mem-secret-id"), false);
  assertEquals(section.includes("archive"), false);
  assertEquals(section.includes("fact"), false);
  assertEquals(section.includes("createdAt"), false);
});
