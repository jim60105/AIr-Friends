// tests/core/identity-registry.test.ts

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { IdentityRegistry } from "@core/identity-registry.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { pathExists } from "@utils/path-validator.ts";
import type { IdentityGroupConfig } from "../../src/types/config.ts";
import type { Platform } from "../../src/types/events.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";

/** Build the WorkspaceInfo a session would hold for one account. */
function workspaceInfo(
  manager: WorkspaceManager,
  platform: Platform,
  userId: string,
  isDm: boolean,
): WorkspaceInfo {
  const key = manager.computeWorkspaceKey({ platform, userId });
  const path = manager.getWorkspacePath(key);
  return {
    key,
    components: { platform, userId },
    path,
    tmpPath: join(path, "tmp"),
    isDm,
  };
}

Deno.test("IdentityRegistry - linked workspaces follow configuration order", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const emailUserId = `e_${"a".repeat(64)}`;
    const groups: IdentityGroupConfig[] = [{
      id: "alice",
      accounts: ["discord/1", "misskey/2", `email/${emailUserId}`],
    }];
    const registry = new IdentityRegistry(groups, manager);

    const linked = registry.linkedWorkspaces(workspaceInfo(manager, "misskey", "2", true));

    assertEquals(linked.map((info) => info.key), ["discord/1", `email/${emailUserId}`]);
    for (const info of linked) {
      assertEquals(info.isDm, true);
      assertEquals(info.path, manager.getWorkspacePath(info.key));
      assertEquals(info.tmpPath, join(info.path, "tmp"));
      assertEquals(info.path.startsWith(join(tempDir, "workspaces")), true);
      assertEquals(`${info.components.platform}/${info.components.userId}`, info.key);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("IdentityRegistry - isDm is propagated for both values", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const registry = new IdentityRegistry(
      [{ id: "alice", accounts: ["discord/1", "misskey/2"] }],
      manager,
    );

    for (const isDm of [true, false]) {
      const linked = registry.linkedWorkspaces(workspaceInfo(manager, "discord", "1", isDm));
      assertEquals(linked.length, 1);
      assertEquals(linked[0].key, "misskey/2");
      assertEquals(linked[0].isDm, isDm);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("IdentityRegistry - unlinked account and single-account group return no workspaces", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const registry = new IdentityRegistry(
      [{ id: "solo", accounts: ["discord/9"] }],
      manager,
    );

    assertEquals(registry.linkedWorkspaces(workspaceInfo(manager, "misskey", "2", false)), []);
    assertEquals(registry.linkedWorkspaces(workspaceInfo(manager, "discord", "9", false)), []);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("IdentityRegistry - group label lookup and group count", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const registry = new IdentityRegistry([
      { id: "alice", accounts: ["discord/1", "misskey/2"] },
      { id: "bob", accounts: [`email/e_${"b".repeat(64)}`] },
    ], manager);

    assertEquals(registry.groupOf("discord/1"), "alice");
    assertEquals(registry.groupOf("misskey/2"), "alice");
    assertEquals(registry.groupOf("discord/99"), undefined);
    assertEquals(registry.groupCount, 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("IdentityRegistry - account listed in two groups throws", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const error = assertThrows(
      () =>
        new IdentityRegistry([
          { id: "alice", accounts: ["discord/1"] },
          { id: "bob", accounts: ["discord/1"] },
        ], manager),
      Error,
    );

    assertEquals(error.message, "Identity account listed in more than one group: bob");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("IdentityRegistry - lookup never creates the linked workspace", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const manager = new WorkspaceManager({ repoPath: tempDir, workspacesDir: "workspaces" });
    const registry = new IdentityRegistry(
      [{ id: "alice", accounts: ["discord/1", "misskey/2"] }],
      manager,
    );

    const linked = registry.linkedWorkspaces(workspaceInfo(manager, "discord", "1", true));

    assertEquals(linked.length, 1);
    assertEquals(await pathExists(linked[0].path), false);
    assertEquals(await pathExists(join(tempDir, "workspaces")), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
