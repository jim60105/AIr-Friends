// tests/core/memory-recall/retriever.test.ts

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  estimateMemorySectionTokens,
  RELEVANT_CHANNEL_MEMORY_HEADING,
} from "@core/memory-recall/fast-recall.ts";
import { DEFAULT_RECALL_CONFIG } from "@core/memory-recall/recall-config.ts";
import { MemoryRetriever } from "@core/memory-recall/retriever.ts";
import type { MemoryRecallRequest, RecallResponse } from "@core/memory-recall/retriever.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { estimateTokens } from "@utils/token-counter.ts";
import type { MemoryRecallConfig } from "../../../src/types/config.ts";
import type { Platform } from "../../../src/types/events.ts";
import type { MemoryEntry, MemoryLogEvent, MemoryPatch } from "../../../src/types/memory.ts";
import type { ChannelWorkspaceInfo, WorkspaceInfo } from "../../../src/types/workspace.ts";

const NOW = new Date("2026-09-25T00:00:00.000Z");
const TS = NOW.toISOString();

let sequence = 0;

function memoryEvent(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  sequence++;
  return {
    type: "memory",
    id: `mem-${sequence}`,
    ts: TS,
    enabled: true,
    visibility: "public",
    importance: "normal",
    content: "keyboard",
    tier: "archive",
    category: "fact",
    scope: "user",
    decay: 0,
    relatedTo: [],
    supersedes: [],
    ...overrides,
  };
}

function patchEvent(targetId: string, patch: Partial<MemoryPatch> = {}): MemoryPatch {
  return { type: "patch", id: `patch-${targetId}`, ts: TS, targetId, ...patch };
}

/** Writes JSONL memory events, replacing the file unless `append` is set. */
async function writeMemoryLog(
  path: string,
  events: MemoryLogEvent[],
  append = false,
): Promise<void> {
  const body = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await Deno.writeTextFile(path, body, { append });
}

function ids(response: RecallResponse): string[] {
  return response.memories.map((item) => item.memory.id);
}

function scoreOf(response: RecallResponse, id: string): number {
  const found = response.memories.find((item) => item.memory.id === id);
  assert(found !== undefined, `no recalled memory ${id}`);
  return found.score;
}

interface Fixture {
  store: MemoryStore;
  dmWorkspace: WorkspaceInfo;
  guildWorkspace: WorkspaceInfo;
  channelWorkspace: ChannelWorkspaceInfo;
  /** Absolute path of the user's public memory file. */
  publicPath: string;
  /** Absolute path of the user's private memory file. */
  privatePath: string;
  /** Absolute path of the channel's memory file. */
  channelPath: string;
}

async function withFixture(fn: (fixture: Fixture) => Promise<void>): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const store = new MemoryStore(manager, { searchLimit: 10, maxChars: 2000 });
    const event = (isDm: boolean) => ({
      platform: "discord" as Platform,
      channelId: "channel123",
      userId: "user456",
      messageId: "msg789",
      guildId: "guild001",
      isDm,
      content: "test message",
      timestamp: NOW,
    });
    const dmWorkspace = await manager.getOrCreateWorkspace(event(true));
    const guildWorkspace = await manager.getOrCreateWorkspace(event(false));
    const channelWorkspace = await manager.getOrCreateChannelWorkspace("discord", "channel123");

    await fn({
      store,
      dmWorkspace,
      guildWorkspace,
      channelWorkspace,
      publicPath: store.getMemoryFilePathFor(dmWorkspace, "public"),
      privatePath: store.getMemoryFilePathFor(dmWorkspace, "private"),
      channelPath: store.getChannelMemoryFilePathFor(channelWorkspace),
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

/**
 * A retriever whose score thresholds accept every eligible memory, so a test
 * asserts on filtering rather than on the provisional scores. Tests that
 * exercise the thresholds pass their own overrides or `DEFAULT_RECALL_CONFIG`.
 */
function permissiveRetriever(
  store: MemoryStore,
  overrides: Partial<MemoryRecallConfig> = {},
): MemoryRetriever {
  return new MemoryRetriever(
    store,
    { ...DEFAULT_RECALL_CONFIG, minRecallScore: 0, secondRecallScore: 0, ...overrides },
    { now: () => NOW },
  );
}

Deno.test("search - returns the complete resolved memory with score and matched terms", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({
        id: "keyboard",
        content: "我的鍵盤是 Air75 V3",
        tier: "working",
        category: "preference",
        scope: "user",
      }),
    ]);

    const result = await permissiveRetriever(fixture.store).search({
      mode: "fast",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    });

    assertEquals(result.memories.length, 1);
    const [item] = result.memories;
    assertEquals(item.kind, "memory");
    assertEquals(item.memory.id, "keyboard");
    assertEquals(item.memory.content, "我的鍵盤是 Air75 V3");
    assertEquals(item.memory.tier, "working");
    assertEquals(item.memory.category, "preference");
    assertEquals(item.memory.scope, "user");
    assertEquals(item.memory.createdAt, TS);
    assert(item.score > 0);
    assert(item.matchedTerms.includes("鍵盤"));
  });
});

Deno.test("search - a private memory is recalled only in a DM", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "public", content: "鍵盤" }),
      // A visibility patch appends to the file the memory already lives in, so
      // a public-file row can carry visibility: "private".
      memoryEvent({ id: "patched", content: "鍵盤", visibility: "private" }),
    ]);
    await writeMemoryLog(fixture.privatePath, [
      memoryEvent({ id: "private", content: "鍵盤", visibility: "private" }),
    ]);
    const retriever = permissiveRetriever(fixture.store);

    const guild = await retriever.search({
      mode: "fast",
      query: "鍵盤",
      workspace: fixture.guildWorkspace,
      channelWorkspace: fixture.channelWorkspace,
    });
    assertEquals(ids(guild), ["public"]);

    const dm = await retriever.search({
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    });
    assertEquals(ids(dm).sort(), ["patched", "private", "public"]);
  });
});

Deno.test("search - an excluded memory is not returned but still counts toward df", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "a", content: "keyboard" }),
      memoryEvent({ id: "b", content: "keyboard" }),
      memoryEvent({ id: "c", content: "monitor" }),
    ]);
    const retriever = permissiveRetriever(fixture.store);

    const withoutExclusion = await retriever.search({
      mode: "deep",
      query: "keyboard",
      workspace: fixture.dmWorkspace,
    });
    assertEquals(ids(withoutExclusion), ["a", "b"]);

    const withExclusion = await retriever.search({
      mode: "deep",
      query: "keyboard",
      workspace: fixture.dmWorkspace,
      excludeIds: new Set(["a"]),
    });
    assertEquals(ids(withExclusion), ["b"]);

    // The excluded memory stays in the population, so `df` and every score are
    // unchanged.
    assertAlmostEquals(scoreOf(withExclusion, "b"), scoreOf(withoutExclusion, "b"), 1e-12);
  });
});

Deno.test("search - a memory sharing only one bigram is not eligible", async () => {
  await withFixture(async (fixture) => {
    // jieba keeps 記憶系統 as one word, so the query 記憶 matches 記憶系統 only
    // through the bigram 記憶.
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "weak", content: "記憶系統" }),
      memoryEvent({ id: "strong", content: "記憶" }),
    ]);

    const result = await permissiveRetriever(fixture.store).search({
      mode: "deep",
      query: "記憶",
      workspace: fixture.dmWorkspace,
    });

    assertEquals(ids(result), ["strong"]);
  });
});

Deno.test("search - Fast Recall excludes a superseded memory", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "old", content: "我用 HHKB 鍵盤" }),
      memoryEvent({ id: "new", content: "我現在用 Air75 V3 鍵盤", supersedes: ["old"] }),
    ]);

    const result = await permissiveRetriever(fixture.store).search({
      mode: "fast",
      query: "我現在用什麼鍵盤",
      workspace: fixture.dmWorkspace,
    });

    assertEquals(ids(result), ["new"]);
  });
});

Deno.test("search - a historical query reaches the superseded memory", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "old", content: "我用 HHKB 鍵盤" }),
      memoryEvent({ id: "new", content: "我現在用 Air75 V3 鍵盤", supersedes: ["old"] }),
    ]);

    const result = await permissiveRetriever(fixture.store).search({
      mode: "fast",
      query: "我原本用什麼鍵盤",
      workspace: fixture.dmWorkspace,
    });

    assert(ids(result).includes("old"), `expected the superseded memory, got ${ids(result)}`);
  });
});

Deno.test("search - Deep Recall also reaches the superseded memory", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "old", content: "我用 HHKB 鍵盤" }),
      memoryEvent({ id: "new", content: "我現在用 Air75 V3 鍵盤", supersedes: ["old"] }),
    ]);

    const result = await permissiveRetriever(fixture.store).search({
      mode: "deep",
      query: "我用什麼鍵盤",
      workspace: fixture.dmWorkspace,
    });

    assertEquals(ids(result).sort(), ["new", "old"]);
  });
});

Deno.test("search - an omitted scope searches every allowed scope", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [memoryEvent({ id: "user-mem", content: "鍵盤" })]);
    await writeMemoryLog(fixture.channelPath, [
      memoryEvent({ id: "channel-mem", content: "鍵盤", scope: "channel", author: "user-9" }),
    ]);
    const retriever = permissiveRetriever(fixture.store);

    const guild = await retriever.search({
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.guildWorkspace,
      channelWorkspace: fixture.channelWorkspace,
    });
    assertEquals(ids(guild).sort(), ["channel-mem", "user-mem"]);

    // Without a channel workspace the channel memories are out of scope.
    const dm = await retriever.search({
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    });
    assertEquals(ids(dm), ["user-mem"]);
  });
});

Deno.test("search - the scope filter restricts eligibility", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [memoryEvent({ id: "user-mem", content: "鍵盤" })]);
    await writeMemoryLog(fixture.channelPath, [
      memoryEvent({ id: "channel-mem", content: "鍵盤", scope: "channel", author: "user-9" }),
    ]);
    const retriever = permissiveRetriever(fixture.store);
    const guildRequest: MemoryRecallRequest = {
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.guildWorkspace,
      channelWorkspace: fixture.channelWorkspace,
    };

    assertEquals(ids(await retriever.search({ ...guildRequest, scope: "channel" })), [
      "channel-mem",
    ]);
    assertEquals(ids(await retriever.search({ ...guildRequest, scope: "user" })), ["user-mem"]);
    assertEquals(
      ids(
        await retriever.search({
          ...guildRequest,
          workspace: fixture.dmWorkspace,
          scope: "channel",
        }),
      ),
      [],
    );
  });
});

Deno.test("search - the category filter restricts eligibility", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "fact", content: "鍵盤", category: "fact" }),
      memoryEvent({ id: "pref", content: "鍵盤", category: "preference" }),
    ]);
    const retriever = permissiveRetriever(fixture.store);
    const request: MemoryRecallRequest = {
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    };

    assertEquals(ids(await retriever.search(request)), ["fact", "pref"]);
    assertEquals(ids(await retriever.search({ ...request, category: "preference" })), ["pref"]);
  });
});

Deno.test("search - relatedTo adds a relation bonus to an overlapping related memory", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "parent", content: "keyboard mouse" }),
      memoryEvent({ id: "child", content: "keyboard" }),
    ]);
    const query = "keyboard mouse";
    const withoutRelation = await permissiveRetriever(fixture.store).search({
      mode: "deep",
      query,
      workspace: fixture.dmWorkspace,
    });

    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "parent", content: "keyboard mouse", relatedTo: ["child"] }),
      memoryEvent({ id: "child", content: "keyboard" }),
    ]);
    const withRelation = await permissiveRetriever(fixture.store).search({
      mode: "deep",
      query,
      workspace: fixture.dmWorkspace,
    });

    assertEquals(ids(withRelation), ["parent", "child"]);
    assertAlmostEquals(
      scoreOf(withRelation, "child"),
      scoreOf(withoutRelation, "child") + 0.2 * scoreOf(withoutRelation, "parent"),
      1e-9,
    );
  });
});

Deno.test("search - a related memory without overlap is dropped", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "parent", content: "keyboard", relatedTo: ["child"] }),
      memoryEvent({ id: "child", content: "monitor" }),
    ]);

    const result = await permissiveRetriever(fixture.store).search({
      mode: "deep",
      query: "keyboard",
      workspace: fixture.dmWorkspace,
    });

    assertEquals(ids(result), ["parent"]);
  });
});

Deno.test("search - relatedTo does not expand past one hop", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "a", content: "keyboard", relatedTo: ["c"] }),
      memoryEvent({ id: "c", content: "monitor", relatedTo: ["e"] }),
      memoryEvent({ id: "e", content: "speaker" }),
    ]);

    const result = await permissiveRetriever(fixture.store).search({
      mode: "deep",
      query: "keyboard",
      workspace: fixture.dmWorkspace,
    });

    assertEquals(ids(result), ["a"]);
  });
});

Deno.test("search - a relation bonus never propagates a second hop", async () => {
  await withFixture(async (fixture) => {
    // b boosts a, and a lists c. a must boost c with its own direct score, not
    // with the score it just received, so the bonus cannot chain.
    const request: MemoryRecallRequest = {
      mode: "deep",
      query: "keyboard mouse",
      workspace: fixture.dmWorkspace,
    };
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "b", content: "keyboard mouse" }),
      memoryEvent({ id: "a", content: "keyboard" }),
      memoryEvent({ id: "c", content: "keyboard" }),
    ]);
    const withoutRelation = await permissiveRetriever(fixture.store).search(request);

    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "b", content: "keyboard mouse", relatedTo: ["a"] }),
      memoryEvent({ id: "a", content: "keyboard", relatedTo: ["c"] }),
      memoryEvent({ id: "c", content: "keyboard" }),
    ]);
    const withRelation = await permissiveRetriever(fixture.store).search(request);

    const parentScore = scoreOf(withoutRelation, "b");
    assertAlmostEquals(
      scoreOf(withRelation, "a"),
      scoreOf(withoutRelation, "a") + 0.2 * parentScore,
      1e-9,
    );
    assertAlmostEquals(
      scoreOf(withRelation, "c"),
      scoreOf(withoutRelation, "c") + 0.2 * scoreOf(withoutRelation, "a"),
      1e-9,
    );
  });
});

Deno.test("search - one candidate adds at most two related memories", async () => {
  await withFixture(async (fixture) => {
    const request: MemoryRecallRequest = {
      mode: "deep",
      query: "keyboard mouse",
      workspace: fixture.dmWorkspace,
    };
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "parent", content: "keyboard mouse" }),
      memoryEvent({ id: "r1", content: "keyboard" }),
      memoryEvent({ id: "r2", content: "keyboard" }),
      memoryEvent({ id: "r3", content: "keyboard" }),
    ]);
    const withoutRelation = await permissiveRetriever(fixture.store).search(request);

    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "parent", content: "keyboard mouse", relatedTo: ["r1", "r2", "r3"] }),
      memoryEvent({ id: "r1", content: "keyboard" }),
      memoryEvent({ id: "r2", content: "keyboard" }),
      memoryEvent({ id: "r3", content: "keyboard" }),
    ]);
    const withRelation = await permissiveRetriever(fixture.store).search(request);

    const bonus = 0.2 * scoreOf(withoutRelation, "parent");
    for (const id of ["r1", "r2"]) {
      assertAlmostEquals(scoreOf(withRelation, id), scoreOf(withoutRelation, id) + bonus, 1e-9);
    }
    assertAlmostEquals(
      scoreOf(withRelation, "r3"),
      scoreOf(withoutRelation, "r3"),
      1e-9,
    );
  });
});

Deno.test("search - Fast Recall selects nothing below minRecallScore", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [memoryEvent({ id: "only", content: "鍵盤" })]);
    const request: MemoryRecallRequest = {
      mode: "fast",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    };

    const defaults = new MemoryRetriever(fixture.store, DEFAULT_RECALL_CONFIG, { now: () => NOW });
    assertEquals((await defaults.search(request)).memories, []);

    assertEquals(ids(await permissiveRetriever(fixture.store).search(request)), ["only"]);
  });
});

Deno.test("search - Fast Recall takes a second memory only when both conditions hold", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "top", content: "keyboard mouse" }),
      memoryEvent({ id: "second", content: "keyboard" }),
    ]);
    const request: MemoryRecallRequest = {
      mode: "fast",
      query: "keyboard mouse",
      workspace: fixture.dmWorkspace,
    };

    // The second memory scores far below secondResultRatio of the top score.
    assertEquals(ids(await permissiveRetriever(fixture.store).search(request)), ["top"]);
    // A lower ratio admits it.
    assertEquals(
      ids(await permissiveRetriever(fixture.store, { secondResultRatio: 0.1 }).search(request)),
      ["top", "second"],
    );
    // A higher secondRecallScore rejects it even when the ratio passes.
    assertEquals(
      ids(
        await permissiveRetriever(fixture.store, { secondResultRatio: 0, secondRecallScore: 1.5 })
          .search(request),
      ),
      ["top"],
    );
  });
});

Deno.test("search - Fast Recall skips a memory that does not fit the token budget", async () => {
  await withFixture(async (fixture) => {
    const short = memoryEvent({ id: "short", content: "鍵盤" });
    const long = memoryEvent({
      id: "long",
      content: "鍵盤".repeat(85),
      importance: "high",
      tier: "working",
      decay: 1,
    });
    const request: MemoryRecallRequest = {
      mode: "fast",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    };
    const config: Partial<MemoryRecallConfig> = { secondResultRatio: 0, secondRecallScore: 0 };

    // The long memory ranks first but cannot fit the default budget.
    await writeMemoryLog(fixture.publicPath, [long, short]);
    const longFirst = await permissiveRetriever(fixture.store, config).search(request);
    assertEquals(ids(longFirst), ["short"]);

    // The short memory ranks first and the long one is skipped.
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "short", content: "鍵盤", importance: "high", tier: "working", decay: 1 }),
      memoryEvent({ id: "long", content: "鍵盤".repeat(85) }),
    ]);
    const shortFirst = await permissiveRetriever(fixture.store, config).search(request);
    assertEquals(ids(shortFirst), ["short"]);

    assert(
      estimateMemorySectionTokens(shortFirst.memories.map((item) => item.memory)) <=
        DEFAULT_RECALL_CONFIG.fastRecallMaxTokens,
    );
  });
});

Deno.test("search - Fast Recall never exceeds its result and token limits", async () => {
  await withFixture(async (fixture) => {
    const request: MemoryRecallRequest = {
      mode: "fast",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    };
    const shortCorpus = Array.from(
      { length: 5 },
      (_, index) => memoryEvent({ id: `short-${index}`, content: "鍵盤" }),
    );
    await writeMemoryLog(fixture.publicPath, shortCorpus);
    const shortResults = await permissiveRetriever(fixture.store).search(request);
    assertEquals(ids(shortResults).length, 2);

    const longCorpus = Array.from(
      { length: 5 },
      (_, index) => memoryEvent({ id: `long-${index}`, content: "鍵盤".repeat(60) }),
    );
    await writeMemoryLog(fixture.publicPath, longCorpus);
    const longResults = await permissiveRetriever(fixture.store).search(request);
    assertEquals(ids(longResults).length, 1);

    for (const result of [shortResults, longResults]) {
      assert(result.memories.length <= DEFAULT_RECALL_CONFIG.fastRecallMaxResults);
      assert(
        estimateMemorySectionTokens(result.memories.map((item) => item.memory)) <=
          DEFAULT_RECALL_CONFIG.fastRecallMaxTokens,
      );
    }
  });
});

Deno.test("search - Deep Recall returns every eligible memory Fast Recall rejects", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "strong", content: "Air75 V3 鍵盤" }),
      ...Array.from(
        { length: 4 },
        (_, index) => memoryEvent({ id: `weak-${index}`, content: "鍵盤" }),
      ),
    ]);
    const retriever = new MemoryRetriever(fixture.store, DEFAULT_RECALL_CONFIG, { now: () => NOW });
    const request: MemoryRecallRequest = {
      mode: "fast",
      query: "Air75 V3 鍵盤",
      workspace: fixture.dmWorkspace,
    };

    assertEquals(ids(await retriever.search(request)), ["strong"]);

    const deep = await retriever.search({ ...request, mode: "deep", maxResults: 10 });
    assertEquals(ids(deep).length, 5);
    assertEquals(ids(deep)[0], "strong");
  });
});

Deno.test("search - Deep Recall caps the limit at 10", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(
      fixture.publicPath,
      Array.from(
        { length: 12 },
        (_, index) =>
          memoryEvent({ id: `mem-${String(index).padStart(2, "0")}`, content: "keyboard" }),
      ),
    );

    const result = await permissiveRetriever(fixture.store).search({
      mode: "deep",
      query: "keyboard",
      workspace: fixture.dmWorkspace,
      maxResults: 50,
    });

    assertEquals(result.memories.length, 10);
  });
});

Deno.test("search - Deep Recall skips an item that does not fit the budget", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({
        id: "long",
        content: "鍵盤".repeat(80),
        importance: "high",
        tier: "working",
        decay: 1,
      }),
      memoryEvent({ id: "short", content: "鍵盤" }),
    ]);

    const result = await permissiveRetriever(fixture.store).search({
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
      maxTokens: 60,
    });

    assertEquals(ids(result), ["short"]);
  });
});

Deno.test("search - Deep Recall drops memories below deepMinRecallScore", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "strong", content: "Air75 V3 鍵盤" }),
      memoryEvent({ id: "weak", content: "鍵盤" }),
    ]);
    const request: MemoryRecallRequest = {
      mode: "deep",
      query: "Air75 V3 鍵盤",
      workspace: fixture.dmWorkspace,
    };

    assertEquals(ids(await permissiveRetriever(fixture.store).search(request)), ["strong", "weak"]);
    assertEquals(
      ids(await permissiveRetriever(fixture.store, { deepMinRecallScore: 3 }).search(request)),
      ["strong"],
    );
  });
});

Deno.test("search - the Deep budget measures the attributed channel line", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.channelPath, [
      memoryEvent({ id: "channel-mem", content: "鍵盤", scope: "channel", author: "user-9" }),
    ]);
    const request: MemoryRecallRequest = {
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.guildWorkspace,
      channelWorkspace: fixture.channelWorkspace,
    };
    // Exactly the channel heading plus the attributed line.
    const exact = estimateTokens(RELEVANT_CHANNEL_MEMORY_HEADING) +
      estimateTokens("- [from user-9] 鍵盤");

    assertEquals(
      ids(
        await permissiveRetriever(fixture.store).search({
          ...request,
          maxTokens: exact,
        }),
      ),
      ["channel-mem"],
    );
    assertEquals(
      ids(
        await permissiveRetriever(fixture.store).search({
          ...request,
          maxTokens: exact - 1,
        }),
      ),
      [],
    );
  });
});

Deno.test("search - fastRecallMaxResults caps the Fast selection", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "a", content: "keyboard" }),
      memoryEvent({ id: "b", content: "keyboard" }),
    ]);
    const request: MemoryRecallRequest = {
      mode: "fast",
      query: "keyboard",
      workspace: fixture.dmWorkspace,
    };

    // Equal scores clear both second-result conditions.
    assertEquals(ids(await permissiveRetriever(fixture.store).search(request)), ["a", "b"]);
    assertEquals(
      ids(await permissiveRetriever(fixture.store, { fastRecallMaxResults: 1 }).search(request)),
      ["a"],
    );
    assertEquals(
      ids(await permissiveRetriever(fixture.store, { fastRecallMaxResults: 0 }).search(request)),
      [],
    );
  });
});

Deno.test("search - the same request twice returns deep-equal results", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [
      memoryEvent({ id: "a", content: "鍵盤 滑鼠", tier: "working" }),
      memoryEvent({ id: "b", content: "鍵盤", category: "preference" }),
      memoryEvent({ id: "c", content: "螢幕" }),
    ]);
    const request: MemoryRecallRequest = {
      mode: "deep",
      query: "鍵盤",
      previousUserMessage: "螢幕",
      workspace: fixture.dmWorkspace,
    };

    // A fresh retriever rebuilds the snapshot from the same files, so this also
    // covers cold-cache determinism, not just a warm in-memory hit.
    const cold = await permissiveRetriever(fixture.store).search(request);
    assertEquals(await permissiveRetriever(fixture.store).search(request), cold);
    assertEquals(await permissiveRetriever(fixture.store).search(request), cold);
  });
});

Deno.test("search - recall makes no network request", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [memoryEvent({ id: "a", content: "鍵盤" })]);
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = () => {
      called = true;
      throw new Error("network access during recall");
    };

    try {
      const result = await permissiveRetriever(fixture.store).search({
        mode: "deep",
        query: "鍵盤",
        workspace: fixture.dmWorkspace,
      });
      assertEquals(ids(result), ["a"]);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assertEquals(called, false);
  });
});

Deno.test("search - a memory appended after a search is visible to the next one", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [memoryEvent({ id: "first", content: "鍵盤" })]);
    const retriever = permissiveRetriever(fixture.store);
    const request: MemoryRecallRequest = {
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    };

    assertEquals(ids(await retriever.search(request)), ["first"]);

    await writeMemoryLog(
      fixture.publicPath,
      [memoryEvent({ id: "second", content: "鍵盤" })],
      true,
    );

    assertEquals(ids(await retriever.search(request)).sort(), ["first", "second"]);
  });
});

Deno.test("search - a patch that disables a memory takes effect on the next search", async () => {
  await withFixture(async (fixture) => {
    await writeMemoryLog(fixture.publicPath, [memoryEvent({ id: "first", content: "鍵盤" })]);
    const retriever = permissiveRetriever(fixture.store);
    const request: MemoryRecallRequest = {
      mode: "deep",
      query: "鍵盤",
      workspace: fixture.dmWorkspace,
    };

    assertEquals(ids(await retriever.search(request)), ["first"]);

    await writeMemoryLog(fixture.publicPath, [patchEvent("first", { enabled: false })], true);

    assertEquals(ids(await retriever.search(request)), []);
  });
});
