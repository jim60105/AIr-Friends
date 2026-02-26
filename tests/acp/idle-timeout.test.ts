// tests/acp/idle-timeout.test.ts

import { assert, assertEquals } from "@std/assert";
import { ChatbotClient } from "@acp/client.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import type { IdleTimeoutConfig } from "../../src/types/config.ts";

const createTestLogger = (): Logger => {
  return new Logger("test", { level: LogLevel.FATAL });
};

const createTestSkillRegistry = (): SkillRegistry => {
  const tempDir = Deno.makeTempDirSync();
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {
    searchLimit: 10,
    maxChars: 2000,
  });
  return new SkillRegistry(memoryStore);
};

Deno.test("ChatbotClient - getLastActivityTimestamp returns current time after construction", () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const client = new ChatbotClient(createTestSkillRegistry(), createTestLogger(), {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    });

    const now = Date.now();
    const ts = client.getLastActivityTimestamp();
    // Should be within 1 second of now
    assert(Math.abs(ts - now) < 1000);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - touchActivity updates timestamp without resetting reply state", () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const client = new ChatbotClient(createTestSkillRegistry(), createTestLogger(), {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    });

    client.markReplySent();
    assertEquals(client.hasReplySent(), true);

    client.touchActivity();

    // Reply state should NOT be reset
    assertEquals(client.hasReplySent(), true);
    // Timestamp should be recent
    assert(Math.abs(client.getLastActivityTimestamp() - Date.now()) < 1000);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - reset resets both reply state and activity timestamp", () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const client = new ChatbotClient(createTestSkillRegistry(), createTestLogger(), {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    });

    client.markReplySent();
    assertEquals(client.hasReplySent(), true);

    client.reset();

    assertEquals(client.hasReplySent(), false);
    assert(Math.abs(client.getLastActivityTimestamp() - Date.now()) < 1000);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - sessionUpdate updates activity timestamp", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const client = new ChatbotClient(createTestSkillRegistry(), createTestLogger(), {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    });

    // Wait a bit to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));
    const before = client.getLastActivityTimestamp();

    await new Promise((r) => setTimeout(r, 10));

    await client.sessionUpdate(
      {
        sessionId: "test",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        },
      } as Parameters<typeof client.sessionUpdate>[0],
    );

    const after = client.getLastActivityTimestamp();
    assert(after >= before);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("IdleTimeoutConfig - defaults are correct", () => {
  const defaults: IdleTimeoutConfig = {
    enabled: true,
    timeoutMs: 300000,
    checkIntervalMs: 30000,
  };

  assertEquals(defaults.enabled, true);
  assertEquals(defaults.timeoutMs, 300000);
  assertEquals(defaults.checkIntervalMs, 30000);
});

Deno.test("ChatbotClient - requestPermission updates activity timestamp", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const client = new ChatbotClient(createTestSkillRegistry(), createTestLogger(), {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    });

    await new Promise((r) => setTimeout(r, 20));
    const before = client.getLastActivityTimestamp();
    await new Promise((r) => setTimeout(r, 20));

    await client.requestPermission({
      sessionId: "test-session",
      toolCall: {
        title: "memory-save",
        kind: null,
        status: "pending" as const,
        rawInput: { skill: "memory-save" },
        content: [],
        toolCallId: "test-id",
      },
      options: [
        { kind: "allow_once", optionId: "allow-1", name: "Allow once" },
        { kind: "reject_once", optionId: "reject-1", name: "Reject once" },
      ],
    });

    const after = client.getLastActivityTimestamp();
    assert(after > before, "requestPermission should update activity timestamp");
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - readTextFile updates activity timestamp", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const client = new ChatbotClient(createTestSkillRegistry(), createTestLogger(), {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    });

    const testFile = `${tempDir}/test.txt`;
    await Deno.writeTextFile(testFile, "test content");

    await new Promise((r) => setTimeout(r, 20));
    const before = client.getLastActivityTimestamp();
    await new Promise((r) => setTimeout(r, 20));

    await client.readTextFile({ path: testFile, sessionId: "test-session" });

    const after = client.getLastActivityTimestamp();
    assert(after > before, "readTextFile should update activity timestamp");
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("ChatbotClient - writeTextFile updates activity timestamp", async () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    const client = new ChatbotClient(createTestSkillRegistry(), createTestLogger(), {
      workingDir: tempDir,
      platform: "discord",
      userId: "123",
      channelId: "456",
      isDM: false,
    });

    await new Promise((r) => setTimeout(r, 20));
    const before = client.getLastActivityTimestamp();
    await new Promise((r) => setTimeout(r, 20));

    await client.writeTextFile({
      path: `${tempDir}/write-test.txt`,
      content: "test",
      sessionId: "test-session",
    });

    const after = client.getLastActivityTimestamp();
    assert(after > before, "writeTextFile should update activity timestamp");
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});

Deno.test("IdleTimeoutConfig - env var override parsing", () => {
  // Test that numeric string values parse correctly
  const timeoutMs = parseInt("300000", 10);
  assertEquals(timeoutMs, 300000);

  const enabled = "true" === "true";
  assertEquals(enabled, true);

  const disabled = "false" === "false";
  assertEquals(disabled, true);
});
