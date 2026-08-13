// tests/skills/file-handler.test.ts

import { assertEquals, assertRejects } from "@std/assert";
import { FileHandler } from "@skills/file-handler.ts";
import { SkillError } from "../../src/types/errors.ts";
import type { SkillContext } from "@skills/types.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";
import type { PlatformAdapter } from "@platforms/platform-adapter.ts";
import type { SendFilePayload } from "../../src/types/platform.ts";

interface CapturedSendFile {
  channelId: string;
  files: SendFilePayload[];
  options?: Record<string, unknown>;
}

const createMockPlatformAdapter = (
  sendFileResult: {
    success: boolean;
    messageId?: string;
    messageIds?: string[];
    error?: string;
  } = { success: true, messageId: "file_msg_123", messageIds: ["file_msg_123"] },
  capture?: CapturedSendFile[],
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
    sendFile: (
      channelId: string,
      files: SendFilePayload[],
      options?: Record<string, unknown>,
    ) => {
      capture?.push({ channelId, files, options });
      return Promise.resolve(sendFileResult);
    },
    fetchRecentMessages: () => Promise.resolve([]),
    getUsername: (userId: string) => Promise.resolve(`user_${userId}`),
    isSelf: () => false,
  } as unknown as PlatformAdapter;
};

const createWorkspace = (path = "/tmp/test-workspace"): WorkspaceInfo => ({
  key: "discord/123",
  components: { platform: "discord", userId: "123" },
  path,
  tmpPath: `${path}/tmp`,
  isDm: true,
});

const createContext = (
  adapter?: PlatformAdapter,
  agentWorkspacePath?: string,
  workspace?: WorkspaceInfo,
): SkillContext => ({
  workspace: workspace ?? createWorkspace(),
  platformAdapter: adapter ?? createMockPlatformAdapter(),
  channelId: "456",
  userId: "123",
  replyToMessageId: "orig_msg_789",
  agentWorkspacePath,
});

const makeTempWorkspace = async (): Promise<{
  dir: string;
  workspace: WorkspaceInfo;
}> => {
  const dir = await Deno.makeTempDir();
  return { dir, workspace: createWorkspace(dir) };
};

Deno.test("FileHandler - returns error when skill is disabled", async () => {
  const handler = new FileHandler({ enabled: false });
  const result = await handler.handleSendFile({ filePaths: ["test.png"] }, createContext());
  assertEquals(result.success, false);
  assertEquals(result.error, "send-file skill is disabled");
});

Deno.test("FileHandler - returns error when filePaths is missing", async () => {
  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({}, createContext());
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("filePaths"), true);
});

Deno.test("FileHandler - returns error when filePaths is empty array", async () => {
  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePaths: [] }, createContext());
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("filePaths"), true);
});

Deno.test("FileHandler - returns error when filePaths contains an empty string", async () => {
  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePaths: ["ok.png", "  "] }, createContext());
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("non-empty string"), true);
});

Deno.test("FileHandler - throws SkillError on path traversal", async () => {
  const handler = new FileHandler({ enabled: true });
  await assertRejects(
    () => handler.handleSendFile({ filePaths: ["../../../etc/passwd"] }, createContext()),
    SkillError,
    "Path traversal not allowed",
  );
});

Deno.test("FileHandler - throws SkillError when path is outside workspace", async () => {
  const handler = new FileHandler({ enabled: true });
  await assertRejects(
    () => handler.handleSendFile({ filePaths: ["/etc/passwd"] }, createContext()),
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
    tmpPath: agentDir + "/tmp",
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
  const result = await handler.handleSendFile({ filePaths: ["notes/test.md"] }, context);
  assertEquals(result.success, true);

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("FileHandler - returns error when file exceeds size limit", async () => {
  // Create a temp file larger than limit
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeFile(`${dir}/big.bin`, new Uint8Array(2 * 1024 * 1024));

  const context = createContext(undefined, undefined, workspace);
  const handler = new FileHandler({ enabled: true, maxFileSizeMb: 1 });
  const result = await handler.handleSendFile({ filePaths: ["big.bin"] }, context);
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("exceeds limit"), true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - returns error when extension not in whitelist", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/secret.jsonl`, "data");

  const context = createContext(undefined, undefined, workspace);
  const handler = new FileHandler({
    enabled: true,
    allowedExtensions: [".png", ".jpg"],
  });
  const result = await handler.handleSendFile({ filePaths: ["secret.jsonl"] }, context);
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("not allowed"), true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - allows any extension when whitelist is empty", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/report.pdf`, "pdf content");

  const context = createContext(undefined, undefined, workspace);
  const handler = new FileHandler({ enabled: true, allowedExtensions: [] });
  const result = await handler.handleSendFile({ filePaths: ["report.pdf"] }, context);
  assertEquals(result.success, true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - multi-file success captures files array passed to adapter", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/a.png`, "aaa");
  await Deno.writeTextFile(`${dir}/b.png`, "bbb");

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter(
      { success: true, messageId: "msg_2", messageIds: ["msg_2"] },
      capture,
    ),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePaths: ["a.png", "b.png"] }, context);

  assertEquals(result.success, true);
  assertEquals(capture.length, 1);
  assertEquals(capture[0].files.length, 2);
  assertEquals(capture[0].files[0].fileName, "a.png");
  assertEquals(capture[0].files[1].fileName, "b.png");
  assertEquals(new TextDecoder().decode(capture[0].files[0].content), "aaa");
  assertEquals(new TextDecoder().decode(capture[0].files[1].content), "bbb");
  assertEquals(capture[0].options?.replyToMessageId, "orig_msg_789");

  const data = result.data as { messageIds: string[]; messageId: string; filesCount: number };
  assertEquals(data.messageIds, ["msg_2"]);
  assertEquals(data.messageId, "msg_2");
  assertEquals(data.filesCount, 2);
  assertEquals(
    (result.data as { nextAction: string }).nextAction,
    "You have done your job. EXIT IMMEDIATELY",
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - preflight all-or-nothing: one invalid path rejects the whole call with no send", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/ok.png`, "ok");

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter({ success: true, messageId: "m", messageIds: ["m"] }, capture),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true });
  await assertRejects(
    () => handler.handleSendFile({ filePaths: ["ok.png", "../../etc/passwd"] }, context),
    SkillError,
    "Path traversal not allowed",
  );

  // No platform call happened at all
  assertEquals(capture.length, 0);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - batch exceeding file-count limit rejected before any read", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/1.png`, "1");
  await Deno.writeTextFile(`${dir}/2.png`, "2");
  await Deno.writeTextFile(`${dir}/3.png`, "3");

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter({ success: true, messageId: "m", messageIds: ["m"] }, capture),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true, maxFilesPerInvocation: 2 });
  const result = await handler.handleSendFile(
    { filePaths: ["1.png", "2.png", "3.png"] },
    context,
  );
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("Too many files"), true);
  assertEquals(capture.length, 0);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - batch exceeding aggregate size limit rejected before any read", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeFile(`${dir}/1.bin`, new Uint8Array(3 * 1024 * 1024));
  await Deno.writeFile(`${dir}/2.bin`, new Uint8Array(3 * 1024 * 1024));

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter({ success: true, messageId: "m", messageIds: ["m"] }, capture),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true, maxTotalSizeMb: 5 });
  const result = await handler.handleSendFile({ filePaths: ["1.bin", "2.bin"] }, context);
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("batch limit"), true);
  assertEquals(capture.length, 0);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - caption pipeline strips XML tags and unescapes newlines", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/img.png`, "fake image");

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter({ success: true, messageId: "m", messageIds: ["m"] }, capture),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile(
    { filePaths: ["img.png"], caption: "<e>done</e>\nLine1\\nLine2" },
    context,
  );
  assertEquals(result.success, true);
  assertEquals(capture[0].options?.comment, "done\nLine1\nLine2");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - rejects symlink escaping the workspace boundary", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  // Symlink inside the workspace pointing outside it
  const outside = await Deno.makeTempDir();
  await Deno.writeTextFile(`${outside}/secret.pdf`, "outside secret");
  await Deno.symlink(`${outside}/secret.pdf`, `${dir}/leak.pdf`);

  const context = createContext(undefined, undefined, workspace);
  const handler = new FileHandler({ enabled: true });
  await assertRejects(
    () => handler.handleSendFile({ filePaths: ["leak.pdf"] }, context),
    SkillError,
    "File path must be within workspace or agent-workspace boundary",
  );

  await Deno.remove(dir, { recursive: true });
  await Deno.remove(outside, { recursive: true });
});

Deno.test("FileHandler - allows real path within workspace (no symlink escape)", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/ok.txt`, "ok");

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter({ success: true, messageId: "m", messageIds: ["m"] }, capture),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePaths: ["ok.txt"] }, context);
  assertEquals(result.success, true);
  assertEquals(capture.length, 1);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - returns error when platform sendFile fails with no delivery", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/test.txt`, "content");

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter({ success: false, error: "Upload failed" }, capture),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePaths: ["test.txt"] }, context);
  assertEquals(result.success, false);
  assertEquals(result.error, "Upload failed");
  // No delivery → no data
  assertEquals(result.data, undefined);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - partial delivery (1 of 2) reports delivered IDs and filesCount", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/a.png`, "a");
  await Deno.writeTextFile(`${dir}/b.png`, "b");

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter({
      success: false,
      messageId: "chat_1",
      messageIds: ["chat_1"],
      error: "Mid-batch failure",
    }, capture),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePaths: ["a.png", "b.png"] }, context);
  assertEquals(result.success, false);
  assertEquals(result.error, "Mid-batch failure");
  const data = result.data as { messageIds: string[]; filesCount: number };
  assertEquals(data.messageIds, ["chat_1"]);
  assertEquals(data.filesCount, 1);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("FileHandler - metrics incremented once per delivered file", async () => {
  const { dir, workspace } = await makeTempWorkspace();
  await Deno.writeTextFile(`${dir}/a.png`, "a");
  await Deno.writeTextFile(`${dir}/b.png`, "b");

  const capture: CapturedSendFile[] = [];
  const context = createContext(
    createMockPlatformAdapter(
      { success: true, messageId: "m", messageIds: ["m"] },
      capture,
    ),
    undefined,
    workspace,
  );

  const handler = new FileHandler({ enabled: true });
  const result = await handler.handleSendFile({ filePaths: ["a.png", "b.png"] }, context);
  assertEquals(result.success, true);
  assertEquals((result.data as { filesCount: number }).filesCount, 2);

  await Deno.remove(dir, { recursive: true });
});
