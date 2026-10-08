import { assertEquals, assertRejects } from "@std/assert";
import { ChatbotClient } from "../../src/acp/client.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { Logger, LogLevel } from "../../src/utils/logger.ts";
import { join } from "@std/path";
import * as acp from "@agentclientprotocol/sdk";
import type { TrustedSkillsRootConfig } from "../../src/acp/filesystem-roots.ts";
import type { LinuxNativeCalls } from "../../src/acp/filesystem-access-linux.ts";
import { decodeLinuxDev, X86_64_CONSTANTS } from "../../src/acp/filesystem-access-linux.ts";

const createTestLogger = (): Logger => new Logger("test", { level: LogLevel.FATAL });

const createTestSkillRegistry = (tempDir: string): SkillRegistry => {
  const workspaceManager = new WorkspaceManager({
    repoPath: tempDir,
    workspacesDir: "workspaces",
  });
  const memoryStore = new MemoryStore(workspaceManager, {});
  return new SkillRegistry(memoryStore);
};

function createMockLinuxCalls(fsMemory: Map<string, Uint8Array>): LinuxNativeCalls {
  const openFiles = new Map<number, { path: string; offset: number }>();
  let nextFd = 20;

  return {
    getArchitectureConstants: () => X86_64_CONSTANTS,
    open: (path) => {
      const fd = nextFd++;
      openFiles.set(fd, { path, offset: 0 });
      return { fd, errno: 0 };
    },
    openat2: (dirfd, pathname) => {
      const fd = nextFd++;
      const parent = openFiles.get(dirfd);
      const parentPath = parent ? parent.path : "";
      const resolved = parentPath ? join(parentPath, pathname) : (pathname.startsWith("/") ? pathname : `/${pathname}`);
      openFiles.set(fd, { path: resolved, offset: 0 });
      return { fd, errno: 0 };
    },
    statx: (fd) => {
      const file = openFiles.get(fd);
      const filePath = file?.path ?? "/";
      try {
        const stat = Deno.statSync(filePath);
        const devInfo = decodeLinuxDev(stat.dev ?? 0);
        return {
          statx: {
            mask: 0x07ff,
            mode: stat.isDirectory ? 0o040755 : 0o100644,
            ino: BigInt(stat.ino ?? fd + 100),
            devMajor: devInfo.major,
            devMinor: devInfo.minor,
          },
          errno: 0,
        };
      } catch {
        return {
          statx: {
            mask: 0x07ff,
            mode: 0o100644,
            ino: BigInt(fd + 100),
            devMajor: 8n,
            devMinor: 1n,
          },
          errno: 0,
        };
      }
    },
    read: (fd, buffer) => {
      const file = openFiles.get(fd);
      if (!file) return { bytesRead: 0, errno: 0 };
      const data = fsMemory.get(file.path) ?? new Uint8Array();
      if (file.offset >= data.byteLength) return { bytesRead: 0, errno: 0 };
      const toRead = Math.min(buffer.byteLength, data.byteLength - file.offset);
      buffer.set(data.subarray(file.offset, file.offset + toRead));
      file.offset += toRead;
      return { bytesRead: toRead, errno: 0 };
    },
    write: (fd, buffer) => {
      const file = openFiles.get(fd);
      if (!file) return { bytesWritten: 0, errno: 0 };
      const existing = fsMemory.get(file.path) ?? new Uint8Array();
      const combined = new Uint8Array(file.offset + buffer.byteLength);
      combined.set(existing.subarray(0, file.offset));
      combined.set(buffer, file.offset);
      fsMemory.set(file.path, combined);
      file.offset += buffer.byteLength;
      return { bytesWritten: buffer.byteLength, errno: 0 };
    },
    ftruncate: (fd) => {
      const file = openFiles.get(fd);
      if (file) {
        fsMemory.set(file.path, new Uint8Array());
        file.offset = 0;
      }
      return { result: 0, errno: 0 };
    },
    close: (fd) => {
      openFiles.delete(fd);
      return { result: 0, errno: 0 };
    },
  };
}

Deno.test("Filesystem Authorization Integration: Real callbacks on temp filesystem", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "fs_auth_test_" });
  try {
    const ws = join(tempDir, "workspace");
    const shared = join(tempDir, "shared");
    const skills = join(tempDir, "skills");
    const siblingWs = join(tempDir, "sibling_ws");

    await Deno.mkdir(ws, { recursive: true });
    await Deno.mkdir(shared, { recursive: true });
    await Deno.mkdir(skills, { recursive: true });
    await Deno.mkdir(siblingWs, { recursive: true });

    // Provision session staging directory
    const stagingDir = join(ws, "tmp", "sess-1");
    await Deno.mkdir(stagingDir, { recursive: true });

    const trustedSkillsConfig: TrustedSkillsRootConfig = {
      ownedRootPath: skills,
      source: "deployment_owned",
    };

    const fsMemory = new Map<string, Uint8Array>();
    const mockCalls = createMockLinuxCalls(fsMemory);

    const client = new ChatbotClient(
      createTestSkillRegistry(tempDir),
      createTestLogger(),
      {
        workingDir: ws,
        platform: "discord",
        userId: "u1",
        channelId: "c1",
        isDM: false,
        agentWorkspacePath: shared,
        sessionId: "sess-1",
        nativeCalls: mockCalls,
      },
    );

    client.setSessionContext("acp-1", {
      cwd: ws,
      shellSessionId: "sess-1",
      yolo: false,
      canWriteAgentWorkspace: false,
      allowedWriteExtensions: [".md", ".txt"],
      trustedSkills: trustedSkillsConfig,
    });

    // 1. Restricted staging write & read
    await Deno.writeTextFile(join(stagingDir, "reply.json"), '{"answer":"ok"}');
    await client.writeTextFile({
      sessionId: "acp-1",
      path: "$TMPDIR/$SESSION_ID/reply.json",
      content: '{"answer":"ok"}',
    });
    // Staging is under workspace, but has .json extension -> readTextFile denies non-allowlisted extension
    await assertRejects(
      () => client.readTextFile({ sessionId: "acp-1", path: "$TMPDIR/$SESSION_ID/reply.json" }),
      acp.RequestError,
    );
    const rejections = client.getRecentPermissionRejections();
    assertEquals(rejections.some((r) => r.reason === "rejected_read_extension"), true);

    // Staging with .md succeeds for both write and read
    await Deno.writeTextFile(join(stagingDir, "reply.md"), "# Heading");
    await client.writeTextFile({
      sessionId: "acp-1",
      path: "$TMPDIR/$SESSION_ID/reply.md",
      content: "# Heading",
    });
    const readMd = await client.readTextFile({
      sessionId: "acp-1",
      path: "$TMPDIR/$SESSION_ID/reply.md",
    });
    assertEquals(readMd.content, "# Heading");

    // 2. Ordinary workspace write denial in restricted mode
    const wsFile = join(ws, "notes.md");
    await assertRejects(
      () => client.writeTextFile({ sessionId: "acp-1", path: wsFile, content: "user text" }),
      acp.RequestError,
    );
    assertEquals(client.getRecentPermissionRejections().some((r) => r.reason === "rejected_workspace_write_restricted"), true);

    // 3. Shared workspace writes: unauthorized denial
    const sharedFile = join(shared, "doc.md");
    await assertRejects(
      () => client.writeTextFile({ sessionId: "acp-1", path: sharedFile, content: "shared note" }),
      acp.RequestError,
    );
    assertEquals(client.getRecentPermissionRejections().some((r) => r.reason === "rejected_agent_workspace_write_unauthorized"), true);

    // Now authorize shared workspace writes
    client.setSessionContext("acp-1", {
      cwd: ws,
      shellSessionId: "sess-1",
      yolo: false,
      canWriteAgentWorkspace: true,
      allowedWriteExtensions: [".md", ".txt"],
      trustedSkills: trustedSkillsConfig,
    });

    // Disallowed extension in shared workspace
    const sharedJs = join(shared, "script.js");
    await assertRejects(
      () => client.writeTextFile({ sessionId: "acp-1", path: sharedJs, content: "console.log(1)" }),
      acp.RequestError,
    );
    assertEquals(client.getRecentPermissionRejections().some((r) => r.reason === "rejected_write_extension"), true);

    // Allowed extension in shared workspace
    await Deno.writeTextFile(sharedFile, "shared note content");
    await client.writeTextFile({ sessionId: "acp-1", path: sharedFile, content: "shared note content" });
    const readShared = await client.readTextFile({ sessionId: "acp-1", path: sharedFile });
    assertEquals(readShared.content, "shared note content");

    // 4. Trusted skills read of non-allowlisted extension (.ts script) and write denial
    const skillScript = join(skills, "helper.ts");
    await Deno.writeTextFile(skillScript, "export const x = 1;");
    fsMemory.set(skillScript, new TextEncoder().encode("export const x = 1;"));

    const readSkill = await client.readTextFile({ sessionId: "acp-1", path: skillScript });
    assertEquals(readSkill.content, "export const x = 1;");

    await assertRejects(
      () => client.writeTextFile({ sessionId: "acp-1", path: skillScript, content: "mutated" }),
      acp.RequestError,
    );
    assertEquals(client.getRecentPermissionRejections().some((r) => r.reason === "rejected_trusted_skills_read_only"), true);

    // 5. Unregistered session context denial
    await assertRejects(
      () => client.writeTextFile({ sessionId: "unknown-sess", path: "$TMPDIR/$SESSION_ID/test.md", content: "x" }),
      acp.RequestError,
    );
    assertEquals(client.getRecentPermissionRejections().some((r) => r.reason === "rejected_filesystem_context"), true);

    // 6. Unprovisioned staging failure without mkdir
    client.setSessionContext("acp-2", {
      cwd: ws,
      shellSessionId: "unprovisioned-skill",
      yolo: false,
      canWriteAgentWorkspace: false,
      allowedWriteExtensions: [".md"],
      trustedSkills: trustedSkillsConfig,
    });
    // Target is under {ws}/tmp/unprovisioned-skill, which does not exist
    await assertRejects(
      () => client.writeTextFile({ sessionId: "acp-2", path: "$TMPDIR/$SESSION_ID/out.md", content: "x" }),
      acp.RequestError,
    );
    // Should NOT have created the unprovisioned directory
    try {
      await Deno.stat(join(ws, "tmp", "unprovisioned-skill"));
      throw new Error("Directory should not have been created!");
    } catch (e) {
      assertEquals((e as Deno.errors.NotFound) instanceof Deno.errors.NotFound, true);
    }

    // 7. YOLO mode broad containment
    client.setSessionContext("acp-yolo", {
      cwd: ws,
      shellSessionId: "sess-yolo",
      yolo: true,
      canWriteAgentWorkspace: false,
      allowedWriteExtensions: [".md"],
      trustedSkills: trustedSkillsConfig,
    });
    // Can write any extension in ordinary workspace
    const yoloPy = join(ws, "test.py");
    await Deno.writeTextFile(yoloPy, "print('yolo')");
    await client.writeTextFile({ sessionId: "acp-yolo", path: yoloPy, content: "print('yolo')" });
    assertEquals(await Deno.readTextFile(yoloPy), "print('yolo')");

    // But trusted skills write in YOLO is STILL rejected
    await assertRejects(
      () => client.writeTextFile({ sessionId: "acp-yolo", path: skillScript, content: "yolo write" }),
      acp.RequestError,
    );
    assertEquals(client.getRecentPermissionRejections().some((r) => r.reason === "rejected_trusted_skills_read_only"), true);

    // And escaping link or outside-root write is denied
    await assertRejects(
      () => client.writeTextFile({ sessionId: "acp-yolo", path: "/etc/passwd", content: "evil" }),
      acp.RequestError,
    );
    assertEquals(client.getRecentPermissionRejections().some((r) => r.reason === "rejected_write_path_outside_workspace"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
