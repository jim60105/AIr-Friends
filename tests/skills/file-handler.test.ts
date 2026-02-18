// tests/skills/file-handler.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { FileHandler } from "@skills/file-handler.ts";
import { SkillError } from "../../src/types/errors.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";

const createMockPlatformAdapter = (
  sendFileResult: { success: boolean; messageId?: string; error?: string } = {
    success: true,
    messageId: "file_msg_123",
  },
): PlatformAdapter => {
  return {
    platform: "discord",
    capabilities: {
      canFetchHistory: true,
      canSearchMessages: true,
      supportsDm: true,
      supportsGuild: true,
      supportsReactions: true,
      maxMessageLength: 2000,
    },
    getConnectionStatus: () => ({
      state: "connected" as const,
      reconnectAttempts: 0,
    }),
    onEvent: () => {},
    offEvent: () => {},
    connect: async () => {},
    disconnect: async () => {},
    sendReply: () => Promise.resolve({ success: true }),
    editMessage: () => Promise.resolve({ success: true, messageId: "msg_123" }),
    sendFile: () => Promise.resolve(sendFileResult),
    fetchRecentMessages: () => Promise.resolve([]),
    getUsername: (userId: string) => Promise.resolve(`user_${userId}`),
    isSelf: () => false,
  } as unknown as PlatformAdapter;
};

const createWorkspace = (): WorkspaceInfo => ({
  key: "discord/123",
  components: { platform: "discord", userId: "123" },
  path: "/tmp/test-workspace",
  isDm: true,
});

const createContext = (
  adapter?: PlatformAdapter,
  agentWorkspacePath?: string,
): SkillContext => ({
  workspace: createWorkspace(),
  platformAdapter: adapter ?? createMockPlatformAdapter(),
  channelId: "456",
  userId: "123",
  replyToMessageId: "orig_msg_789",
  agentWorkspacePath,
});

Deno.test("FileHandler - returns error when skill is disabled", async () => {
  const handler = new FileHandler({ enabled: false });
  const result = await handler.handleSendFile({ filePath: "test.png" }, createContext());
  assertEquals(result.success, false);
  assertEquals(result.error, "send-file skill is disabled");
});

Deno.test("FileHandler - returns error when filePath is missing", async () => {
  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({}, createContext());
  assertEquals(result.success, false);
  assertEquals(result.error, "Missing or invalid parameter: filePath");
});

Deno.test("FileHandler - returns error when filePath is empty string", async () => {
  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePath: "  " }, createContext());
  assertEquals(result.success, false);
  assertEquals(result.error, "Missing or invalid parameter: filePath");
});

Deno.test("FileHandler - throws SkillError on path traversal", async () => {
  const handler = new FileHandler({ enabled: true });
  await assertRejects(
    () => handler.handleSendFile({ filePath: "../../../etc/passwd" }, createContext()),
    SkillError,
    "Path traversal not allowed",
  );
});

Deno.test("FileHandler - throws SkillError when path is outside workspace", async () => {
  const handler = new FileHandler({ enabled: true });
  await assertRejects(
    () => handler.handleSendFile({ filePath: "/etc/passwd" }, createContext()),
    SkillError,
    "File path must be within workspace or agent-workspace boundary",
  );
});

Deno.test("FileHandler - allows path within agent-workspace", async () => {
  // Create a temporary workspace and agent-workspace
  const tmpDir = await Deno.makeTempDir();
  const agentDir = `${tmpDir}/agent-workspace`;
  const notesDir = `${agentDir}/notes`;
  await Deno.mkdir(notesDir, { recursive: true });
  await Deno.writeTextFile(`${notesDir}/test.md`, "test content");

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: agentDir,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
    agentWorkspacePath: agentDir,
  };

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePath: "notes/test.md" }, context);
  assertEquals(result.success, true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FileHandler - returns error when file exceeds size limit", async () => {
  // Create a temp file larger than limit
  const tmpDir = await Deno.makeTempDir();
  const filePath = `${tmpDir}/big.bin`;
  // Write 2MB file, set limit to 1MB
  await Deno.writeFile(filePath, new Uint8Array(2 * 1024 * 1024));

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: tmpDir,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const handler = new FileHandler({ enabled: true, maxFileSizeMb: 1 });
  const result = await handler.handleSendFile({ filePath: "big.bin" }, context);
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("exceeds limit"), true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FileHandler - returns error when extension not in whitelist", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmpDir}/secret.jsonl`, "data");

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: tmpDir,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const handler = new FileHandler({
    enabled: true,
    allowedExtensions: [".png", ".jpg"],
  });
  const result = await handler.handleSendFile({ filePath: "secret.jsonl" }, context);
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("not allowed"), true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FileHandler - allows any extension when whitelist is empty", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmpDir}/report.pdf`, "pdf content");

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: tmpDir,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter(),
    channelId: "456",
    userId: "123",
  };

  const handler = new FileHandler({ enabled: true, allowedExtensions: [] });
  const result = await handler.handleSendFile({ filePath: "report.pdf" }, context);
  assertEquals(result.success, true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FileHandler - successful file send returns messageId", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmpDir}/hello.txt`, "hello world");

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: tmpDir,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: true, messageId: "file_msg_456" }),
    channelId: "456",
    userId: "123",
  };

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePath: "hello.txt" }, context);
  assertEquals(result.success, true);
  assertEquals((result.data as { messageId: string }).messageId, "file_msg_456");

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FileHandler - returns error when platform sendFile fails", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmpDir}/test.txt`, "content");

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: tmpDir,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: createMockPlatformAdapter({ success: false, error: "Upload failed" }),
    channelId: "456",
    userId: "123",
  };

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePath: "test.txt" }, context);
  assertEquals(result.success, false);
  assertEquals(result.error, "Upload failed");

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FileHandler - caption is passed to sendFile options", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${tmpDir}/img.png`, "fake image");

  let capturedOptions: Record<string, unknown> | undefined;
  const adapter = {
    ...createMockPlatformAdapter(),
    sendFile: (
      _channelId: string,
      _content: Uint8Array,
      _fileName: string,
      options?: Record<string, unknown>,
    ) => {
      capturedOptions = options;
      return Promise.resolve({ success: true, messageId: "msg_cap" });
    },
  } as unknown as PlatformAdapter;

  const workspace: WorkspaceInfo = {
    key: "discord/123",
    components: { platform: "discord", userId: "123" },
    path: tmpDir,
    isDm: true,
  };

  const context: SkillContext = {
    workspace,
    platformAdapter: adapter,
    channelId: "456",
    userId: "123",
    replyToMessageId: "orig_123",
  };

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile(
    { filePath: "img.png", caption: "Here's the image" },
    context,
  );
  assertEquals(result.success, true);
  assertEquals(capturedOptions?.comment, "Here's the image");
  assertEquals(capturedOptions?.replyToMessageId, "orig_123");

  await Deno.remove(tmpDir, { recursive: true });
});
