// tests/core/context-assembler.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { ContextAssembler } from "../../src/core/context-assembler.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import type { MessageFetcher } from "../../src/types/context.ts";
import type { NormalizedEvent, Platform, PlatformMessage } from "../../src/types/events.ts";
import type { PlatformEmoji } from "../../src/types/platform.ts";

function createTestMessage(overrides: Partial<PlatformMessage> = {}): PlatformMessage {
  return {
    messageId: "msg1",
    userId: "user1",
    username: "User1",
    content: "Hello",
    timestamp: new Date(),
    isBot: false,
    ...overrides,
  };
}

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

function createMockMessageFetcher(
  messages: PlatformMessage[],
  emojis?: PlatformEmoji[],
): MessageFetcher {
  return {
    fetchRecentMessages: (_channelId: string, limit: number) => {
      return Promise.resolve(messages.slice(0, limit));
    },
    searchRelatedMessages: () => Promise.resolve([]),
    ...(emojis !== undefined ? { fetchEmojis: () => Promise.resolve(emojis) } : {}),
  };
}

async function withTestContextAssembler(
  fn: (
    assembler: ContextAssembler,
    store: MemoryStore,
    manager: WorkspaceManager,
    tempDir: string,
  ) => Promise<void> | void,
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
      tokenLimit: 20000,
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

// ============ /clear command tests ============

Deno.test("ContextAssembler - applyClearCommand should return all messages when no /clear present", async () => {
  await withTestContextAssembler((assembler) => {
    const messages = [
      createTestMessage({ messageId: "m1", content: "Hello" }),
      createTestMessage({ messageId: "m2", content: "How are you?" }),
      createTestMessage({ messageId: "m3", content: "Fine thanks" }),
    ];

    const result = assembler.applyClearCommand(messages);
    assertEquals(result.length, 3);
    assertEquals(result[0].content, "Hello");
    assertEquals(result[2].content, "Fine thanks");
  });
});

Deno.test("ContextAssembler - applyClearCommand should drop messages before and including /clear", async () => {
  await withTestContextAssembler((assembler) => {
    const messages = [
      createTestMessage({ messageId: "m1", content: "Old message 1" }),
      createTestMessage({ messageId: "m2", content: "Old message 2" }),
      createTestMessage({ messageId: "m3", content: "/clear" }),
      createTestMessage({ messageId: "m4", content: "New message 1" }),
      createTestMessage({ messageId: "m5", content: "New message 2" }),
    ];

    const result = assembler.applyClearCommand(messages);
    assertEquals(result.length, 2);
    assertEquals(result[0].content, "New message 1");
    assertEquals(result[1].content, "New message 2");
  });
});

Deno.test("ContextAssembler - applyClearCommand should use the last /clear when multiple exist", async () => {
  await withTestContextAssembler((assembler) => {
    const messages = [
      createTestMessage({ messageId: "m1", content: "Old 1" }),
      createTestMessage({ messageId: "m2", content: "/clear" }),
      createTestMessage({ messageId: "m3", content: "Mid message" }),
      createTestMessage({ messageId: "m4", content: "/clear" }),
      createTestMessage({ messageId: "m5", content: "New message" }),
    ];

    const result = assembler.applyClearCommand(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].content, "New message");
  });
});

Deno.test("ContextAssembler - applyClearCommand should return empty array when /clear is the last message", async () => {
  await withTestContextAssembler((assembler) => {
    const messages = [
      createTestMessage({ messageId: "m1", content: "Hello" }),
      createTestMessage({ messageId: "m2", content: "World" }),
      createTestMessage({ messageId: "m3", content: "/clear" }),
    ];

    const result = assembler.applyClearCommand(messages);
    assertEquals(result.length, 0);
  });
});

Deno.test("ContextAssembler - applyClearCommand should handle /clear with trailing text", async () => {
  await withTestContextAssembler((assembler) => {
    const messages = [
      createTestMessage({ messageId: "m1", content: "Old message" }),
      createTestMessage({ messageId: "m2", content: "/clear everything" }),
      createTestMessage({ messageId: "m3", content: "New message" }),
    ];

    const result = assembler.applyClearCommand(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].content, "New message");
  });
});

Deno.test("ContextAssembler - applyClearCommand should NOT trigger for /clear in the middle of text", async () => {
  await withTestContextAssembler((assembler) => {
    const messages = [
      createTestMessage({ messageId: "m1", content: "Hello" }),
      createTestMessage({ messageId: "m2", content: "Please /clear this" }),
      createTestMessage({ messageId: "m3", content: "Goodbye" }),
    ];

    const result = assembler.applyClearCommand(messages);
    assertEquals(result.length, 3);
  });
});

Deno.test("ContextAssembler - applyClearCommand should handle /clear with leading whitespace", async () => {
  await withTestContextAssembler((assembler) => {
    const messages = [
      createTestMessage({ messageId: "m1", content: "Old message" }),
      createTestMessage({ messageId: "m2", content: "  /clear" }),
      createTestMessage({ messageId: "m3", content: "New message" }),
    ];

    const result = assembler.applyClearCommand(messages);
    assertEquals(result.length, 1);
    assertEquals(result[0].content, "New message");
  });
});

Deno.test("ContextAssembler - applyClearCommand should handle empty messages array", async () => {
  await withTestContextAssembler((assembler) => {
    const result = assembler.applyClearCommand([]);
    assertEquals(result.length, 0);
  });
});

Deno.test("ContextAssembler - applyClearCommand should handle /clear as the only message", async () => {
  await withTestContextAssembler((assembler) => {
    const messages = [
      createTestMessage({ messageId: "m1", content: "/clear" }),
    ];

    const result = assembler.applyClearCommand(messages);
    assertEquals(result.length, 0);
  });
});

Deno.test("ContextAssembler - /clear should be applied during context assembly", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);
    const fetcher = createMockMessageFetcher([
      {
        messageId: "old1",
        userId: "user1",
        username: "Alice",
        content: "Old conversation",
        timestamp: new Date(),
        isBot: false,
      },
      {
        messageId: "clear1",
        userId: "user1",
        username: "Alice",
        content: "/clear",
        timestamp: new Date(),
        isBot: false,
      },
      {
        messageId: "new1",
        userId: "user1",
        username: "Alice",
        content: "New conversation start",
        timestamp: new Date(),
        isBot: false,
      },
    ]);

    const context = await assembler.assembleContext(event, workspace, fetcher);

    // Only the message after /clear should remain
    assertEquals(context.recentMessages.length, 1);
    assertEquals(context.recentMessages[0].content, "New conversation start");
  });
});

// ============ Emoji tests ============

Deno.test("ContextAssembler - assembleContext includes emojis when available", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    const testEmojis: PlatformEmoji[] = [
      {
        name: "smile",
        animated: false,
        useInText: ":smile:",
        useAsReaction: ":smile:",
        category: "General",
      },
    ];

    const fetcher = createMockMessageFetcher([], testEmojis);
    const context = await assembler.assembleContext(event, workspace, fetcher);

    assertEquals(context.availableEmojis?.length, 1);
    assertEquals(context.availableEmojis![0].name, "smile");
  });
});

Deno.test("ContextAssembler - assembleContext works without emojis", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    // No fetchEmojis method on fetcher
    const fetcher = createMockMessageFetcher([]);
    const context = await assembler.assembleContext(event, workspace, fetcher);

    assertEquals(context.availableEmojis, undefined);
  });
});

Deno.test("ContextAssembler - formatEmojiSection groups by category", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    const testEmojis: PlatformEmoji[] = [
      {
        name: "happy",
        animated: false,
        useInText: ":happy:",
        useAsReaction: ":happy:",
        category: "Emotions",
      },
      {
        name: "sad",
        animated: false,
        useInText: ":sad:",
        useAsReaction: ":sad:",
        category: "Emotions",
      },
      {
        name: "cat",
        animated: false,
        useInText: ":cat:",
        useAsReaction: ":cat:",
        category: "Animals",
      },
    ];

    const fetcher = createMockMessageFetcher([], testEmojis);
    const context = await assembler.assembleContext(event, workspace, fetcher);
    const formatted = assembler.formatContext(context);

    assertStringIncludes(formatted.userMessage, "Available Custom Emojis");
    assertStringIncludes(formatted.userMessage, "Emotions");
    assertStringIncludes(formatted.userMessage, "Animals");
    assertStringIncludes(formatted.userMessage, "happy");
    assertStringIncludes(formatted.userMessage, "cat");
  });
});

// ============ Spontaneous context tests ============

Deno.test("ContextAssembler - assembleSpontaneousContext without recent messages", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    const fetcher = createMockMessageFetcher([]);

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: false },
    );

    assertEquals(context.systemPrompt, "You are a helpful assistant.");
    assertEquals(context.recentMessages.length, 0);
    assertEquals(context.recentMessagesFetched, false);
    assertEquals(typeof context.estimatedTokens, "number");
  });
});

Deno.test("ContextAssembler - assembleSpontaneousContext with recent messages", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());

    const messages: PlatformMessage[] = [
      createTestMessage({ content: "Hey there", username: "Alice" }),
    ];
    const fetcher = createMockMessageFetcher(messages);

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: true },
    );

    assertEquals(context.recentMessages.length, 1);
    assertEquals(context.recentMessagesFetched, true);
  });
});

Deno.test("ContextAssembler - assembleSpontaneousContext includes important memories", async () => {
  await withTestContextAssembler(async (assembler, store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    await store.addMemory(workspace, "Important memory", { importance: "high" });

    const fetcher = createMockMessageFetcher([]);
    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: false },
    );

    assertEquals(context.importantMemories.length, 1);
    assertEquals(context.importantMemories[0].content, "Important memory");
  });
});

Deno.test("ContextAssembler - assembleSpontaneousContext handles fetch error gracefully", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    const fetcher: MessageFetcher = {
      fetchRecentMessages: () => Promise.reject(new Error("Network error")),
    };

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: true },
    );

    // Should not throw, just return empty messages
    assertEquals(context.recentMessages.length, 0);
  });
});

Deno.test("ContextAssembler - assembleSpontaneousContext includes emojis", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    const emojis: PlatformEmoji[] = [
      {
        name: "happy",
        animated: false,
        useInText: ":happy:",
        useAsReaction: ":happy:",
        category: "Emotions",
      },
    ];
    const fetcher = createMockMessageFetcher([], emojis);

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: false },
    );

    assertEquals(context.availableEmojis?.length, 1);
    assertEquals(context.availableEmojis![0].name, "happy");
  });
});

Deno.test("ContextAssembler - assembleSpontaneousContext handles emoji fetch error", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    const fetcher: MessageFetcher = {
      fetchRecentMessages: () => Promise.resolve([]),
      fetchEmojis: () => Promise.reject(new Error("Emoji fetch failed")),
    };

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: false },
    );

    assertEquals(context.availableEmojis, undefined);
  });
});

Deno.test("ContextAssembler - assembleSpontaneousContext with empty emojis", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    const fetcher = createMockMessageFetcher([], []);

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: false },
    );

    assertEquals(context.availableEmojis, undefined);
  });
});

Deno.test("ContextAssembler - formatSpontaneousContext with no memories or messages", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    const fetcher = createMockMessageFetcher([]);

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: false },
    );

    const formatted = assembler.formatSpontaneousContext(context);

    assertEquals(formatted.systemMessage, "You are a helpful assistant.");
    assertStringIncludes(formatted.userMessage, "Spontaneous Post Mode");
    assertStringIncludes(
      formatted.userMessage,
      "Create something entirely original",
    );
    assertEquals(formatted.estimatedTokens > 0, true);
  });
});

Deno.test("ContextAssembler - formatSpontaneousContext with recent messages fetched", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    const messages: PlatformMessage[] = [
      createTestMessage({ content: "Hello", username: "Bob" }),
    ];
    const fetcher = createMockMessageFetcher(messages);

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: true },
    );

    const formatted = assembler.formatSpontaneousContext(context);

    assertStringIncludes(formatted.userMessage, "Recent Conversation");
    assertStringIncludes(formatted.userMessage, "Bob: Hello");
    assertStringIncludes(
      formatted.userMessage,
      "reference recent conversation topics",
    );
  });
});

Deno.test("ContextAssembler - formatSpontaneousContext includes memories section", async () => {
  await withTestContextAssembler(async (assembler, store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    await store.addMemory(workspace, "My key fact", { importance: "high" });

    const fetcher = createMockMessageFetcher([]);
    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: false },
    );

    const formatted = assembler.formatSpontaneousContext(context);

    assertStringIncludes(formatted.userMessage, "Important Memories");
    assertStringIncludes(formatted.userMessage, "My key fact");
  });
});

Deno.test("ContextAssembler - formatSpontaneousContext includes emojis", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const workspace = await manager.getOrCreateWorkspace(createTestEvent());
    const emojis: PlatformEmoji[] = [
      {
        name: "wave",
        animated: false,
        useInText: ":wave:",
        useAsReaction: ":wave:",
        category: "Gestures",
      },
    ];
    const fetcher = createMockMessageFetcher([], emojis);

    const context = await assembler.assembleSpontaneousContext(
      "discord",
      "channel123",
      workspace,
      fetcher,
      { fetchRecentMessages: false },
    );

    const formatted = assembler.formatSpontaneousContext(context);

    assertStringIncludes(formatted.userMessage, "Available Custom Emojis");
    assertStringIncludes(formatted.userMessage, "wave");
  });
});

Deno.test("ContextAssembler - formatContext includes emoji section in token budget", async () => {
  await withTestContextAssembler(async (assembler, _store, manager) => {
    const event = createTestEvent();
    const workspace = await manager.getOrCreateWorkspace(event);

    const testEmojis: PlatformEmoji[] = [
      {
        name: "test_emoji",
        animated: false,
        useInText: ":test_emoji:",
        useAsReaction: ":test_emoji:",
        category: "Test",
      },
    ];

    const fetcher = createMockMessageFetcher([], testEmojis);
    const context = await assembler.assembleContext(event, workspace, fetcher);
    const formatted = assembler.formatContext(context);

    // Token count should include emoji section
    assertEquals(formatted.estimatedTokens > 0, true);
    assertStringIncludes(formatted.userMessage, "test_emoji");
  });
});
Deno.test('ContextAssembler - formatContext includes attachment descriptions', async () => {
  await withTestContextAssembler(async (assembler) => {
    const event = createTestEvent();
    const workspace = await assembler['manager'].getOrCreateWorkspace(event).catch(async ()=>{
      // fallback to creating new manager path
      const mgr = new (await import('../../src/core/workspace-manager.ts')).WorkspaceManager({repoPath: await Deno.makeTempDir(), workspacesDir: 'workspaces'});
      return mgr.getOrCreateWorkspace(event);
    });
    const fetcher = createMockMessageFetcher([
      createTestMessage({
        content: 'Check this image',
        attachments: [{ id: 'att1', url: 'https://example.com/photo.png', mimeType: 'image/png', filename: 'photo.png', size: 1048576, isImage: true }],
        username: 'Alice',
      }),
    ]);

    const context = await assembler.assembleContext(event, workspace as any, fetcher);
    const formatted = assembler.formatContext(context);

    assertStringIncludes(formatted.userMessage, 'Attachments:');
    assertStringIncludes(formatted.userMessage, '📎 photo.png (image/png) https://example.com/photo.png');
  });
});

Deno.test('ContextAssembler - formatContext without attachments omits section', async () => {
  await withTestContextAssembler(async (assembler) => {
    const event = createTestEvent();
    const workspace = await assembler['manager'].getOrCreateWorkspace(event).catch(async ()=>{
      const mgr = new (await import('../../src/core/workspace-manager.ts')).WorkspaceManager({repoPath: await Deno.makeTempDir(), workspacesDir: 'workspaces'});
      return mgr.getOrCreateWorkspace(event);
    });
    const fetcher = createMockMessageFetcher([
      createTestMessage({ content: 'No attachments here', username: 'Bob' }),
    ]);

    const context = await assembler.assembleContext(event, workspace as any, fetcher);
    const formatted = assembler.formatContext(context);

    // Should not include Attachments section
    if (formatted.userMessage.includes('Attachments:')) {
      throw new Error('Attachments section should not be present');
    }
  });
});
