// tests/core/context-assembler.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { ContextAssembler } from "../../src/core/context-assembler.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import type { MessageFetcher } from "../../src/types/context.ts";
import type { NormalizedEvent, Platform, PlatformMessage } from "../../src/types/events.ts";

function createTestEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    platform: "discord" as Platform,
    channelId: "channel123",
    userId: "user456",
    messageId: "msg789",
    isDm: false,
    guildId: "guild001",
    content: "Hello bot!",
    timestamp: new Date(),
    ...overrides,
  };
}

function createMockMessageFetcher(messages: PlatformMessage[]): MessageFetcher {
  return {
    fetchRecentMessages: (_channelId: string, limit: number) => {
      return Promise.resolve(messages.slice(0, limit));
    },
    searchRelatedMessages: () => Promise.resolve([]),
  };
}

async function withTestContextAssembler(
  fn: (
    assembler: ContextAssembler,
    store: MemoryStore,
    manager: WorkspaceManager,
    tempDir: string,
  ) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    // Create system prompt file
    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const manager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const store = new MemoryStore(manager, {
      searchLimit: 10,
      maxChars: 2000,
    });
    const assembler = new ContextAssembler(store, {
      recentMessageLimit: 20,
      memoryMaxChars: 2000,
      tokenLimit: 4096,
      systemPromptPath: `${tempDir}/prompts/system.md`,
    });

    await fn(assembler, store, manager, tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("ContextAssembler - should assemble basic context", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);
    const fetcher = createMockMessageFetcher([
      {
        messageId: "prev1",
        userId: "other",
        username: "OtherUser",
        content: "Previous message",
        timestamp: new Date(),
        isBot: false,
      },
    ]);

    const context = await assembler.assembleContext(event, workspace, fetcher);

    assertEquals(context.systemPrompt, "You are a helpful assistant.");
    assertEquals(context.recentMessages.length, 1);
    assertEquals(context.triggerMessage.content, "Hello bot!");
    assertEquals(typeof context.estimatedTokens, "number");
  });
});

Deno.test("ContextAssembler - should include important memories", async () => {
  await withTestContextAssembler(async (assembler, store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // Add an important memory
    await store.addMemory(workspace, "User prefers formal language", {
      importance: "high",
    });

    const fetcher = createMockMessageFetcher([]);
    const context = await assembler.assembleContext(event, workspace, fetcher);

    assertEquals(context.importantMemories.length, 1);
    assertEquals(
      context.importantMemories[0].content,
      "User prefers formal language",
    );
  });
});

Deno.test("ContextAssembler - should format context correctly", async () => {
  await withTestContextAssembler(async (assembler, store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // Add memory
    await store.addMemory(workspace, "Important fact", { importance: "high" });

    const fetcher = createMockMessageFetcher([
      {
        messageId: "prev1",
        userId: "other",
        username: "Alice",
        content: "Hi there",
        timestamp: new Date(),
        isBot: false,
      },
    ]);

    const context = await assembler.assembleContext(event, workspace, fetcher);
    const formatted = assembler.formatContext(context);

    // Check system message
    assertEquals(formatted.systemMessage, "You are a helpful assistant.");

    // Check user message contains memories
    assertStringIncludes(formatted.userMessage, "Important Memories");
    assertStringIncludes(formatted.userMessage, "Important fact");

    // Check user message contains conversation
    assertStringIncludes(formatted.userMessage, "Recent Conversation");
    assertStringIncludes(formatted.userMessage, "Alice: Hi there");

    // Check user message contains trigger
    assertStringIncludes(formatted.userMessage, "Current Message");
    assertStringIncludes(formatted.userMessage, "Hello bot!");
  });
});

Deno.test("ContextAssembler - should respect message limit", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // Create many messages
    const manyMessages: PlatformMessage[] = [];
    for (let i = 0; i < 50; i++) {
      manyMessages.push({
        messageId: `msg${i}`,
        userId: `user${i}`,
        username: `User${i}`,
        content: `Message ${i}`,
        timestamp: new Date(),
        isBot: false,
      });
    }

    const fetcher = createMockMessageFetcher(manyMessages);
    const context = await assembler.assembleContext(event, workspace, fetcher);

    // Should be limited to recentMessageLimit (20)
    assertEquals(context.recentMessages.length, 20);
  });
});

Deno.test("ContextAssembler - should estimate tokens", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent({ content: "A longer message for testing" });
    const workspace = await manager.getOrCreateWorkspace(event);
    const fetcher = createMockMessageFetcher([]);

    const context = await assembler.assembleContext(event, workspace, fetcher);
    const formatted = assembler.formatContext(context);

    // Token count should be positive
    assertEquals(formatted.estimatedTokens > 0, true);
    // Token count should be reasonable (not too large)
    assertEquals(formatted.estimatedTokens < 1000, true);
  });
});

Deno.test("ContextAssembler - should invalidate cache", async () => {
  await withTestContextAssembler(async (assembler, _store, manager, tempDir) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);
    const fetcher = createMockMessageFetcher([]);

    // First assembly
    const context1 = await assembler.assembleContext(event, workspace, fetcher);
    assertEquals(context1.systemPrompt, "You are a helpful assistant.");

    // Update prompt file
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a different assistant.",
    );

    // Still cached
    const context2 = await assembler.assembleContext(event, workspace, fetcher);
    assertEquals(context2.systemPrompt, "You are a helpful assistant.");

    // Invalidate cache
    assembler.invalidateSystemPromptCache();

    // Should reload
    const context3 = await assembler.assembleContext(event, workspace, fetcher);
    assertEquals(context3.systemPrompt, "You are a different assistant.");
  });
});

Deno.test("ContextAssembler - should not truncate messages mid-content", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // Create messages with full content
    const messages: PlatformMessage[] = [
      {
        messageId: "msg1",
        userId: "user1",
        username: "Alice",
        content: "This is the first message with some content",
        timestamp: new Date(),
        isBot: false,
      },
      {
        messageId: "msg2",
        userId: "user2",
        username: "Bob",
        content: "This is the second message with more content",
        timestamp: new Date(),
        isBot: false,
      },
      {
        messageId: "msg3",
        userId: "user3",
        username: "Charlie",
        content: "This is the third message with even more content",
        timestamp: new Date(),
        isBot: false,
      },
    ];

    const fetcher = createMockMessageFetcher(messages);
    const context = await assembler.assembleContext(event, workspace, fetcher);
    const formatted = assembler.formatContext(context);

    // Check that messages are either completely included or completely excluded
    // Messages should not be cut off mid-content (no "..." in the middle of message content)
    const hasFirstMessage = formatted.userMessage.includes(
      "This is the first message with some content",
    );
    const hasSecondMessage = formatted.userMessage.includes(
      "This is the second message with more content",
    );
    const hasThirdMessage = formatted.userMessage.includes(
      "This is the third message with even more content",
    );

    // If a message is partially included, it should not end with ...
    // (The ... should only appear if we truncated the entire context, which shouldn't happen with small test data)
    if (hasFirstMessage) {
      assertStringIncludes(
        formatted.userMessage,
        "Alice: This is the first message with some content",
      );
    }
    if (hasSecondMessage) {
      assertStringIncludes(
        formatted.userMessage,
        "Bob: This is the second message with more content",
      );
    }
    if (hasThirdMessage) {
      assertStringIncludes(
        formatted.userMessage,
        "Charlie: This is the third message with even more content",
      );
    }

    // All messages should be included in our test scenario (small context)
    assertEquals(hasFirstMessage, true);
    assertEquals(hasSecondMessage, true);
    assertEquals(hasThirdMessage, true);
  });
});

Deno.test("ContextAssembler - should remove oldest messages when exceeding token limit", async () => {
  // Create a test with very limited token budget
  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${tempDir}/prompts`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/prompts/system.md`,
      "You are a helpful assistant.",
    );

    const manager = new WorkspaceManager({
      repoPath: tempDir,
      workspacesDir: "workspaces",
    });
    const store = new MemoryStore(manager, {
      searchLimit: 10,
      maxChars: 2000,
    });

    // Create assembler with very small token limit
    const assembler = new ContextAssembler(store, {
      recentMessageLimit: 20,
      memoryMaxChars: 2000,
      tokenLimit: 500, // Very small limit to trigger truncation
      systemPromptPath: `${tempDir}/prompts/system.md`,
    });

    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // Create many long messages
    const messages: PlatformMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        messageId: `msg${i}`,
        userId: `user${i}`,
        username: `User${i}`,
        content:
          `This is message number ${i} with quite a bit of content to make it longer and consume more tokens`,
        timestamp: new Date(),
        isBot: false,
      });
    }

    const fetcher = createMockMessageFetcher(messages);
    const context = await assembler.assembleContext(event, workspace, fetcher);
    const formatted = assembler.formatContext(context);

    // The most recent messages should be included
    const hasLastMessage = formatted.userMessage.includes("message number 9");
    assertEquals(hasLastMessage, true);

    // With our very small token limit, we should have removed some old messages
    // but the newest message should still be there
    assertEquals(formatted.estimatedTokens <= 500, true);

    // Messages that are included should not be truncated mid-content
    // They should appear in full
    if (formatted.userMessage.includes("message number 9")) {
      assertStringIncludes(
        formatted.userMessage,
        "This is message number 9 with quite a bit of content to make it longer and consume more tokens",
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
