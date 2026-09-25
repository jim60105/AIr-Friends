// tests/core/memory-recall/fixed-selection.test.ts

import { assertEquals } from "@std/assert";
import { renderFixedMemoryLine, selectFixedMemories } from "@core/memory-recall/fixed-selection.ts";
import { estimateTokens } from "@utils/token-counter.ts";
import type { ResolvedMemory } from "../../../src/types/memory.ts";
import { makeMemory } from "./memory-fixture.ts";

/** Default budgets of `memory.recall` (design §10). */
const BUDGETS = { coreMaxTokens: 512, workingMaxItems: 4, workingMaxTokens: 384 };

const BASE_MS = Date.parse("2026-09-25T00:00:00.000Z");

/** A memory created `seconds` after the base instant, so `createdAt` orders by index. */
function mem(
  id: string,
  seconds: number,
  overrides: Partial<ResolvedMemory> = {},
): ResolvedMemory {
  return makeMemory({
    id,
    createdAt: new Date(BASE_MS + seconds * 1000).toISOString(),
    ...overrides,
  });
}

function ids(memories: readonly ResolvedMemory[]): string[] {
  return memories.map((memory) => memory.id);
}

/** Estimated tokens of the rendered lines of one section, numbered from 1. */
function sectionTokens(memories: readonly ResolvedMemory[], attributed = false): number {
  return memories.reduce(
    (sum, memory, i) => sum + estimateTokens(renderFixedMemoryLine(memory, i + 1, attributed)),
    0,
  );
}

// ASCII filler of `length` characters, so `estimateTokens` of a rendered line is
// ceil(0.275 * (prefix + length)): 60 chars cost 18 tokens, 178 chars 50 tokens,
// 32 chars 10 tokens, 8 chars 4 tokens and 4 chars 2 tokens at a 1-digit prefix.
const MEDIUM = "x".repeat(60);
const LONG = "x".repeat(2178); // 600 tokens at a 1-digit prefix
const SMALL = "x".repeat(32); // 10 tokens
const TINY = "x".repeat(8); // 4 tokens
const MICRO = "x".repeat(4); // 2 tokens at a 1-digit prefix, 3 at a 2-digit one

Deno.test("selectFixedMemories - core memories within budget are all kept, oldest first", () => {
  // 15 core memories of 18 tokens each: 270 of the 512 tokens.
  const userCore = Array.from(
    { length: 15 },
    (_, i) => mem(`c${i}`, i, { tier: "core", content: MEDIUM }),
  );

  const selection = selectFixedMemories(
    { userCore: [...userCore].reverse(), channelCore: [], userWorking: [], channelWorking: [] },
    BUDGETS,
  );

  assertEquals(ids(selection.userCore), userCore.map((memory) => memory.id));
  assertEquals(sectionTokens(selection.userCore) <= BUDGETS.coreMaxTokens, true);
});

Deno.test("selectFixedMemories - a long core memory is skipped whole and later ones are kept", () => {
  const userCore = [
    mem("first", 0, { tier: "core", content: MICRO }),
    mem("huge", 1, { tier: "core", content: LONG }),
    mem("after-1", 2, { tier: "core", content: MICRO }),
    mem("after-2", 3, { tier: "core", content: MICRO }),
  ];

  const selection = selectFixedMemories(
    { userCore, channelCore: [], userWorking: [], channelWorking: [] },
    { ...BUDGETS, coreMaxTokens: 20 },
  );

  assertEquals(ids(selection.userCore), ["first", "after-1", "after-2"]);
  assertEquals(sectionTokens(selection.userCore) <= 20, true);
  assertEquals(selection.injectedIds.includes("huge"), false);
});

Deno.test("selectFixedMemories - core is one shared budget, user entries before channel ones", () => {
  const userCore = Array.from(
    { length: 3 },
    (_, i) => mem(`u${i}`, i, { tier: "core", content: MEDIUM }),
  );
  const channelCore = Array.from(
    { length: 3 },
    (_, i) =>
      mem(`ch${i}`, i, { tier: "core", content: MEDIUM, scope: "channel", author: "user_987" }),
  );

  // 3 user entries cost 54 of the 100 tokens; an attributed channel line costs 22,
  // so 2 of the 3 channel entries fit and the third is skipped.
  const selection = selectFixedMemories(
    { userCore, channelCore, userWorking: [], channelWorking: [] },
    { ...BUDGETS, coreMaxTokens: 100 },
  );

  assertEquals(ids(selection.userCore), ["u0", "u1", "u2"]);
  assertEquals(ids(selection.channelCore), ["ch0", "ch1"]);
  assertEquals(
    sectionTokens(selection.userCore) + sectionTokens(selection.channelCore, true) <= 100,
    true,
  );
});

Deno.test("selectFixedMemories - the newest working memories are selected by default", () => {
  // 25 working memories of 50 tokens each; the newest 4 are w21..w24.
  const userWorking = Array.from(
    { length: 25 },
    (_, i) => mem(`w${i}`, i, { tier: "working", content: "x".repeat(178) }),
  );

  const selection = selectFixedMemories(
    { userCore: [], channelCore: [], userWorking, channelWorking: [] },
    BUDGETS,
  );

  // Selected newest first, presented chronologically.
  assertEquals(ids(selection.userWorking), ["w21", "w22", "w23", "w24"]);
  assertEquals(sectionTokens(selection.userWorking) <= BUDGETS.workingMaxTokens, true);
});

Deno.test("selectFixedMemories - workingMaxItems caps the selection", () => {
  const userWorking = Array.from(
    { length: 25 },
    (_, i) => mem(`w${i}`, i, { tier: "working", content: "x".repeat(178) }),
  );

  const selection = selectFixedMemories(
    { userCore: [], channelCore: [], userWorking, channelWorking: [] },
    { ...BUDGETS, workingMaxItems: 2 },
  );

  assertEquals(ids(selection.userWorking), ["w23", "w24"]);
});

Deno.test("selectFixedMemories - the working token budget is enforced", () => {
  // The 4 newest working memories total 600 tokens; only 2 fit in 384.
  const userWorking = Array.from(
    { length: 4 },
    (_, i) => mem(`w${i}`, i, { tier: "working", content: "x".repeat(542) }),
  );

  const selection = selectFixedMemories(
    { userCore: [], channelCore: [], userWorking, channelWorking: [] },
    BUDGETS,
  );

  assertEquals(ids(selection.userWorking), ["w2", "w3"]);
  assertEquals(sectionTokens(selection.userWorking) <= BUDGETS.workingMaxTokens, true);
});

Deno.test("selectFixedMemories - the working budget keeps the entries that fill it exactly", () => {
  // Five working memories of 96 tokens each: four fill the 384-token budget
  // exactly, and the fifth is skipped rather than replacing an earlier one.
  const userWorking = Array.from(
    { length: 5 },
    (_, i) => mem(`w${i}`, i, { tier: "working", content: "x".repeat(346) }),
  );

  const selection = selectFixedMemories(
    { userCore: [], channelCore: [], userWorking, channelWorking: [] },
    { ...BUDGETS, workingMaxItems: 5 },
  );

  assertEquals(ids(selection.userWorking), ["w1", "w2", "w3", "w4"]);
  assertEquals(sectionTokens(selection.userWorking), BUDGETS.workingMaxTokens);
  assertEquals(selection.injectedIds.includes("w0"), false);
});

Deno.test("selectFixedMemories - a working candidate skipped for size is not replaced", () => {
  const userWorking = [
    mem("w0", 0, { tier: "working", content: SMALL }),
    mem("w1", 1, { tier: "working", content: SMALL }),
    mem("w2", 2, { tier: "working", content: SMALL }),
    mem("w3", 3, { tier: "working", content: SMALL }),
    mem("huge", 4, { tier: "working", content: LONG }),
  ];

  const selection = selectFixedMemories(
    { userCore: [], channelCore: [], userWorking, channelWorking: [] },
    BUDGETS,
  );

  // `huge` is the newest candidate and does not fit, so it is skipped; the three
  // small candidates after it are kept and the older `w0` never takes its place.
  assertEquals(ids(selection.userWorking), ["w1", "w2", "w3"]);
  assertEquals(selection.injectedIds.includes("w0"), false);
});

Deno.test("selectFixedMemories - importance does not promote a memory into the fixed set", () => {
  const userWorking = Array.from({ length: 5 }, (_, i) =>
    mem(`w${i}`, i, {
      tier: "working",
      content: "x".repeat(178),
      importance: i === 0 ? "high" : "normal",
    }));

  const selection = selectFixedMemories(
    { userCore: [], channelCore: [], userWorking, channelWorking: [] },
    BUDGETS,
  );

  // Only recency decides: the high-importance oldest memory is not injected.
  assertEquals(ids(selection.userWorking), ["w1", "w2", "w3", "w4"]);
});

Deno.test("selectFixedMemories - channel and user working memories are merged", () => {
  const userWorking = [0, 2, 4, 6, 8].map((seconds, i) =>
    mem(`u${i}`, seconds, { tier: "working", content: "x".repeat(178) })
  );
  const channelWorking = [1, 3, 5, 7, 9].map((seconds, i) =>
    mem(`ch${i}`, seconds, {
      tier: "working",
      content: "x".repeat(178),
      scope: "channel",
      author: "user_987",
    })
  );

  const selection = selectFixedMemories(
    { userCore: [], channelCore: [], userWorking, channelWorking },
    BUDGETS,
  );

  // The 4 newest across both sources: ch4 (9s), u4 (8s), ch3 (7s), u3 (6s).
  assertEquals(ids(selection.userWorking), ["u3", "u4"]);
  assertEquals(ids(selection.channelWorking), ["ch3", "ch4"]);
});

Deno.test("selectFixedMemories - zero budgets select nothing", () => {
  const userCore = [mem("c0", 0, { tier: "core", content: MEDIUM })];
  const userWorking = [mem("w0", 0, { tier: "working", content: "x".repeat(178) })];

  const noCore = selectFixedMemories(
    { userCore, channelCore: [], userWorking, channelWorking: [] },
    { ...BUDGETS, coreMaxTokens: 0 },
  );
  assertEquals(ids(noCore.userCore), []);
  assertEquals(ids(noCore.userWorking), ["w0"]);

  const noWorking = selectFixedMemories(
    { userCore, channelCore: [], userWorking, channelWorking: [] },
    { ...BUDGETS, workingMaxItems: 0 },
  );
  assertEquals(ids(noWorking.userWorking), []);
  assertEquals(ids(noWorking.userCore), ["c0"]);
});

Deno.test("selectFixedMemories - equal createdAt is ordered by id, deterministically", () => {
  const userWorking = [
    mem("b", 0, { tier: "working", content: "x".repeat(178) }),
    mem("a", 0, { tier: "working", content: "x".repeat(178) }),
    mem("c", 0, { tier: "working", content: "x".repeat(178) }),
    mem("d", 0, { tier: "working", content: "x".repeat(178) }),
    mem("e", 0, { tier: "working", content: "x".repeat(178) }),
  ];
  const candidates = { userCore: [], channelCore: [], userWorking, channelWorking: [] };

  const first = selectFixedMemories(candidates, BUDGETS);
  const second = selectFixedMemories(candidates, BUDGETS);

  // Ties break by id ascending, so the newest four are a..d, presented oldest first.
  assertEquals(ids(first.userWorking), ["d", "c", "b", "a"]);
  assertEquals(ids(first.userWorking), ids(second.userWorking));
});

Deno.test("selectFixedMemories - injectedIds is exactly the injected set", () => {
  const selection = selectFixedMemories(
    {
      userCore: [mem("u-core", 0, { tier: "core", content: MEDIUM })],
      channelCore: [
        mem("ch-core", 0, { tier: "core", content: MEDIUM, scope: "channel", author: "user_987" }),
      ],
      userWorking: [mem("u-work", 0, { tier: "working", content: "x".repeat(178) })],
      channelWorking: [
        mem("ch-work", 0, {
          tier: "working",
          content: "x".repeat(178),
          scope: "channel",
          author: "user_987",
        }),
      ],
    },
    { ...BUDGETS, workingMaxItems: 1 },
  );

  const injected = [
    ...selection.userCore,
    ...selection.channelCore,
    ...selection.userWorking,
    ...selection.channelWorking,
  ];
  assertEquals(new Set(selection.injectedIds), new Set(ids(injected)));
  assertEquals(selection.injectedIds.length, injected.length);
});

Deno.test("selectFixedMemories - channel working entries follow the selected channel core", () => {
  // Ten channel core memories do not fit the core budget, so none is selected and
  // the channel working entry is numbered 1, not 11. Its line costs 5 tokens at a
  // 1-digit prefix and 6 at a 2-digit one, so a wrong offset drops it.
  const channelCore = Array.from(
    { length: 10 },
    (_, i) =>
      mem(`ch-core-${i}`, i, { tier: "core", content: MEDIUM, scope: "channel", author: "u987" }),
  );
  const channelWorking = [
    mem("ch-work", 0, {
      tier: "working",
      content: "abc",
      scope: "channel",
      author: "u987",
    }),
  ];

  const selection = selectFixedMemories(
    { userCore: [], channelCore, userWorking: [], channelWorking },
    { coreMaxTokens: 0, workingMaxItems: 4, workingMaxTokens: 5 },
  );

  assertEquals(ids(selection.channelCore), []);
  assertEquals(ids(selection.channelWorking), ["ch-work"]);
});

Deno.test("selectFixedMemories - the rendered working sections stay within the budget", () => {
  // Twelve working candidates whose walk numbering and rendered numbering differ
  // across the ten-entry digit boundary: the walk measures 42 tokens, but the
  // chronologically numbered lines cost 45, so the oldest entry is dropped.
  const contents = (i: number) => (i <= 2 ? MICRO : TINY);
  const userWorking = Array.from(
    { length: 12 },
    (_, i) => mem(`w${i}`, 11 - i, { tier: "working", content: contents(i) }),
  );

  const selection = selectFixedMemories(
    { userCore: [], channelCore: [], userWorking, channelWorking: [] },
    { ...BUDGETS, workingMaxItems: 12, workingMaxTokens: 42 },
  );

  assertEquals(selection.userWorking.length, 11);
  assertEquals(selection.injectedIds.includes("w11"), false);
  assertEquals(sectionTokens(selection.userWorking) <= 42, true);
});

Deno.test("renderFixedMemoryLine - renders the numbered line the sections emit", () => {
  const memory = mem("m", 0, { content: "likes tea" });
  assertEquals(renderFixedMemoryLine(memory, 1, false), "1. likes tea");

  const attributed = mem("m", 0, { content: "channel fact", scope: "channel", author: "user_987" });
  assertEquals(renderFixedMemoryLine(attributed, 2, true), "2. [from user_987] channel fact");

  const anonymous = mem("m", 0, { content: "channel fact", scope: "channel" });
  assertEquals(
    renderFixedMemoryLine(anonymous, 1, true),
    "1. [from unknown contributor] channel fact",
  );
  assertEquals(renderFixedMemoryLine(anonymous, 1, false), "1. channel fact");
});
