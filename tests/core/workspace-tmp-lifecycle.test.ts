// tests/core/workspace-tmp-lifecycle.test.ts
//
// Workspace temporary-file lifecycle (design D1–D4): the entry-level,
// state-preserving reclamation policy, its temporary-use ownership, the
// bounded/link-safe traversal, and the awaited startup pass over the
// recognized workspace layout.
//
// The filesystem is the real one under a per-test temp root; the only stubbed
// primitive is `Deno.removeSync`, used once to model a partial removal failure.

import { assert, assertEquals, assertFalse } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  TMP_CLEANUP_MAX_DEPTH,
  TMP_CLEANUP_MAX_NODES,
  WorkspaceManager,
} from "@core/workspace-manager.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import type { WorkspaceInfo } from "../../src/types/workspace.ts";

/** Create a fixture file (and its parents) with the given content. */
function writeFixture(path: string, content = "payload"): void {
  Deno.mkdirSync(dirname(path), { recursive: true });
  Deno.writeTextFileSync(path, content);
}

/** Absolute existence probe (a directory or a file; never a link target test). */
function exists(path: string): boolean {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Run one test body against a fresh workspace root. */
async function withWorkspaceRoot(
  body: (ctx: {
    repoPath: string;
    workspacesRoot: string;
    manager: WorkspaceManager;
  }) => void | Promise<void>,
): Promise<void> {
  const repoPath = await Deno.makeTempDir();
  try {
    await body({
      repoPath,
      workspacesRoot: join(repoPath, "workspaces"),
      manager: new WorkspaceManager({ repoPath, workspacesDir: "workspaces" }),
    });
  } finally {
    await Deno.remove(repoPath, { recursive: true });
  }
}

/** Seed one workspace we can safely treat as a user workspace. */
function seedUserWorkspace(
  repoPath: string,
  platform: string,
  userId: string,
): { workspacePath: string; tmpPath: string } {
  const workspacePath = join(repoPath, "workspaces", platform, userId);
  const tmpPath = join(workspacePath, "tmp");
  Deno.mkdirSync(tmpPath, { recursive: true });
  writeFixture(join(workspacePath, "memory.public.jsonl"), "memory");
  writeFixture(join(workspacePath, "memory.private.jsonl"), "memory");
  return { workspacePath, tmpPath };
}

const DEFAULT_LIMITS = { maxNodes: TMP_CLEANUP_MAX_NODES, maxDepth: TMP_CLEANUP_MAX_DEPTH };

Deno.test("cleanupTmpIfIdle - removes orphan staging/browser/conversion entries and preserves both engines' state", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { workspacePath, tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");

    // Disposable orphans: Skill API staging payload, a browser profile and an
    // attachment conversion — plus a nested directory that happens to be named
    // `tmp`, which is NOT a workspace root and therefore disposable too.
    writeFixture(join(tmpPath, "sess_abc", "payload.json"), "staged");
    writeFixture(join(tmpPath, "browser-profile", "Default", "Cookies"), "profile");
    writeFixture(join(tmpPath, "attachments", "converted.webp"), "converted");
    writeFixture(join(tmpPath, "sess_abc", "notes", "tmp", "nested.txt"), "nested");

    // Native engine state for both engines and both modes, including the
    // reserved `natives` link into the shared prepared runtime payload.
    const sharedPayload = join(repoPath, "shared-native-payload", "omp");
    writeFixture(join(sharedPayload, "libomp.so"), "runtime");
    writeFixture(join(tmpPath, "omp-agent", "restricted", "xdg-data", "omp", "sessions.db"), "db");
    writeFixture(join(tmpPath, "omp-agent", "native-yolo", "xdg-data", "omp", "sessions.db"), "db");
    Deno.symlinkSync(sharedPayload, join(tmpPath, "omp-agent", "restricted", "natives"));
    writeFixture(join(tmpPath, "opencode-data", "sess_abc", "tool-output", "out.txt"), "tools");

    // Identity is captured BEFORE the pass: a preserved subtree must keep its
    // inode, not merely a copy of its bytes at the same path.
    const identityBefore = ["omp-agent", "opencode-data"].map((name) => {
      const stat = Deno.lstatSync(join(tmpPath, name));
      return { name, dev: stat.dev, ino: stat.ino };
    });

    const outcome = manager.cleanupTmpIfIdle(tmpPath, { limits: DEFAULT_LIMITS });

    assertEquals(outcome.status, "cleaned");
    assertEquals(outcome.budgetExhausted, false);
    assertEquals(outcome.retained, 0);
    assert(outcome.removed > 0);

    // Disposable entries are gone; the tmp root stays.
    assertFalse(exists(join(tmpPath, "sess_abc")));
    assertFalse(exists(join(tmpPath, "browser-profile")));
    assertFalse(exists(join(tmpPath, "attachments")));
    assertEquals(Deno.lstatSync(tmpPath).isDirectory, true);

    // Reserved engine state keeps its paths, bytes and link identity.
    assertEquals(
      Deno.readTextFileSync(
        join(tmpPath, "omp-agent", "restricted", "xdg-data", "omp", "sessions.db"),
      ),
      "db",
    );
    assertEquals(
      Deno.readTextFileSync(
        join(tmpPath, "omp-agent", "native-yolo", "xdg-data", "omp", "sessions.db"),
      ),
      "db",
    );
    assertEquals(
      Deno.readTextFileSync(join(tmpPath, "opencode-data", "sess_abc", "tool-output", "out.txt")),
      "tools",
    );
    assertEquals(
      Deno.lstatSync(join(tmpPath, "omp-agent", "restricted", "natives")).isSymlink,
      true,
    );
    // The runtime payload the link points at is untouched.
    assertEquals(Deno.readTextFileSync(join(sharedPayload, "libomp.so")), "runtime");
    for (const before of identityBefore) {
      const after = Deno.lstatSync(join(tmpPath, before.name));
      assertEquals(after.dev, before.dev, `${before.name} changed device`);
      assertEquals(after.ino, before.ino, `${before.name} changed identity`);
    }

    // Persistent workspace data never moves.
    assertEquals(Deno.readTextFileSync(join(workspacePath, "memory.public.jsonl")), "memory");
  });
});

Deno.test("cleanupTmpIfIdle - reserved direct-child names are preserved whatever their type is", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    // A reserved name that is a symlink to outside data, and one that is a
    // plain file: both are preserved without being inspected or followed.
    const outside = join(repoPath, "outside-engine-state");
    writeFixture(join(outside, "state.db"), "outside");
    Deno.symlinkSync(outside, join(tmpPath, "omp-agent"));
    Deno.writeTextFileSync(join(tmpPath, "opencode-data"), "unexpected file");
    writeFixture(join(tmpPath, "disposable.txt"), "gone");

    const outcome = manager.cleanupTmpIfIdle(tmpPath);

    assertEquals(outcome.status, "cleaned");
    assertEquals(outcome.retained, 0);
    assertEquals(Deno.lstatSync(join(tmpPath, "omp-agent")).isSymlink, true);
    assertEquals(Deno.readTextFileSync(join(tmpPath, "opencode-data")), "unexpected file");
    assertEquals(Deno.readTextFileSync(join(outside, "state.db")), "outside");
    assertFalse(exists(join(tmpPath, "disposable.txt")));
  });
});

Deno.test("cleanupTmpIfIdle - live temporary-use ownership blocks reclamation until the final release", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    writeFixture(join(tmpPath, "peer-staged.json"), "in use");

    // Two owners use the same user's workspace at once (same-user concurrency).
    manager.acquireTmpUse(tmpPath);
    manager.acquireTmpUse(tmpPath);
    assertEquals(manager.getTmpUseCount(tmpPath), 2);

    const blocked = manager.cleanupTmpIfIdle(tmpPath);
    assertEquals(blocked.status, "skipped");
    assertEquals(blocked.reason, "live-temporary-use");
    assertEquals(Deno.readTextFileSync(join(tmpPath, "peer-staged.json")), "in use");

    // The first release is not the last one: nothing is reclaimed yet.
    assertEquals(manager.releaseTmpUse(tmpPath), null);
    assertEquals(manager.getTmpUseCount(tmpPath), 1);
    assertEquals(exists(join(tmpPath, "peer-staged.json")), true);

    // The final release performs the actual cleanup and reports it.
    const outcome = manager.releaseTmpUse(tmpPath);
    assertEquals(outcome?.status, "cleaned");
    assertEquals(manager.getTmpUseCount(tmpPath), 0);
    assertFalse(exists(join(tmpPath, "peer-staged.json")));
    assertEquals(Deno.lstatSync(tmpPath).isDirectory, true);

    // A stray release without an acquire never unlocks anything.
    assertEquals(manager.releaseTmpUse(tmpPath), null);
  });
});

Deno.test("cleanupTmpIfIdle - registry occupancy is a conservative extra check that expiry cannot weaken a live owner", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    writeFixture(join(tmpPath, "peer-staged.json"), "in use");
    const workspace: WorkspaceInfo = {
      key: "discord/u1",
      components: { platform: "discord", userId: "u1" },
      path: dirname(tmpPath),
      tmpPath,
      isDm: false,
    };
    // A registry whose entries are already idle-expired (timeout < 0 models an
    // entry the TTL has evicted, without any sleep-based race).
    const registry = new SessionRegistry(-1);
    const evictedId = registry.register({
      workspace,
      channelId: "c",
      platform: "discord",
      userId: "u1",
      isDm: false,
    });
    const probe = { isWorkspaceBusy: () => registry.hasActiveSessionsForWorkspace("discord/u1") };

    // Registry expiry is observable (the entry is gone from the lookup) …
    assertEquals(registry.get(evictedId), undefined);
    assertEquals(probe.isWorkspaceBusy(), false);

    // … and a live temporary-use owner still blocks the workspace.
    manager.acquireTmpUse(tmpPath);
    const blocked = manager.cleanupTmpIfIdle(tmpPath, probe);
    assertEquals(blocked.reason, "live-temporary-use");

    // A registered (still un-reaped) session blocks it too.
    manager.releaseTmpUse(tmpPath);
    writeFixture(join(tmpPath, "peer-staged.json"), "in use");
    registry.register({
      workspace,
      channelId: "c",
      platform: "discord",
      userId: "u1",
      isDm: false,
    });
    assertEquals(manager.cleanupTmpIfIdle(tmpPath, probe).reason, "registered-session");
    assertEquals(exists(join(tmpPath, "peer-staged.json")), true);
    registry.stop();
  });
});

Deno.test("cleanupTmpIfIdle - unconfirmed producer teardown keeps the workspace protected for the bot lifetime", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    writeFixture(join(tmpPath, "staged.json"), "maybe in use");

    manager.markTmpUseUncertain(tmpPath, "survivors-remain");
    assertEquals(manager.isTmpUseUncertain(tmpPath), true);
    assertEquals(manager.cleanupTmpIfIdle(tmpPath).reason, "uncertain-teardown");

    // Releasing ownership never clears the marker.
    manager.acquireTmpUse(tmpPath);
    const outcome = manager.releaseTmpUse(tmpPath);
    assertEquals(outcome?.reason, "uncertain-teardown");
    assertEquals(manager.isTmpUseUncertain(tmpPath), true);
    assertEquals(Deno.readTextFileSync(join(tmpPath, "staged.json")), "maybe in use");
  });
});

Deno.test("cleanupTmpIfIdle - disposable symlinks are unlinked without visiting their targets", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    const outside = join(repoPath, "outside-data");
    writeFixture(join(outside, "sentinel.txt"), "outside bytes");
    Deno.symlinkSync(outside, join(tmpPath, "linked-dir"));
    Deno.symlinkSync(join(outside, "sentinel.txt"), join(tmpPath, "linked-file"));

    const outcome = manager.cleanupTmpIfIdle(tmpPath);

    assertEquals(outcome.status, "cleaned");
    assertFalse(exists(join(tmpPath, "linked-dir")));
    assertFalse(exists(join(tmpPath, "linked-file")));
    // Traversal never followed either link.
    assertEquals(Deno.readTextFileSync(join(outside, "sentinel.txt")), "outside bytes");
  });
});

Deno.test("cleanupTmpIfIdle - unexpected special nodes are preserved with a diagnostic", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    const fifoPath = join(tmpPath, "special.fifo");
    const mkfifo = new Deno.Command("mkfifo", { args: [fifoPath] }).outputSync();
    if (!mkfifo.success) return; // No FIFO support on this host: nothing to assert.

    writeFixture(join(tmpPath, "disposable.txt"), "gone");
    const outcome = manager.cleanupTmpIfIdle(tmpPath);

    assertEquals(outcome.status, "cleaned");
    assertEquals(outcome.retained, 1);
    assert(exists(fifoPath));
    assertFalse(exists(join(tmpPath, "disposable.txt")));
  });
});

Deno.test("cleanupTmpIfIdle - a missing target is harmless and unsafe ancestry is never a cleanup target", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    // Missing workspace / tmp: nothing to do, no throw.
    Deno.mkdirSync(join(repoPath, "workspaces", "discord"), { recursive: true });
    assertEquals(
      manager.cleanupTmpIfIdle(join(repoPath, "workspaces", "discord", "ghost", "tmp")).status,
      "absent",
    );

    // A linked `tmp` child is skipped, and its target is untouched.
    const { workspacePath } = seedUserWorkspace(repoPath, "discord", "u2");
    const outsideTmp = join(repoPath, "outside-tmp");
    writeFixture(join(outsideTmp, "keep.txt"), "outside");
    Deno.removeSync(join(workspacePath, "tmp"), { recursive: true });
    Deno.symlinkSync(outsideTmp, join(workspacePath, "tmp"));
    const linked = manager.cleanupTmpIfIdle(join(workspacePath, "tmp"));
    assertEquals(linked.status, "skipped");
    assertEquals(linked.reason, "linked-or-replaced-component");
    assertEquals(Deno.readTextFileSync(join(outsideTmp, "keep.txt")), "outside");

    // A linked user component leads outside the root: never traversed.
    const outsideWorkspace = join(repoPath, "outside-workspace");
    writeFixture(join(outsideWorkspace, "tmp", "keep.txt"), "outside");
    Deno.symlinkSync(outsideWorkspace, join(repoPath, "workspaces", "discord", "u3"));
    const linkedUser = manager.cleanupTmpIfIdle(
      join(repoPath, "workspaces", "discord", "u3", "tmp"),
    );
    assertEquals(linkedUser.status, "skipped");
    assertEquals(wholeTree(outsideWorkspace), ["tmp", "tmp/keep.txt"]);

    // The channel container is never a workspace shape.
    const containerTmp = join(repoPath, "workspaces", "discord", "channels", "tmp");
    writeFixture(join(containerTmp, "keep.txt"), "container");
    const container = manager.cleanupTmpIfIdle(containerTmp);
    assertEquals(container.status, "skipped");
    assertEquals(container.reason, "unrecognized-workspace-layout");
  });
});

Deno.test("cleanupTmpIfIdle - a failed entry removal is retained while other candidates continue", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    writeFixture(join(tmpPath, "blocked.txt"), "blocked");
    writeFixture(join(tmpPath, "free.txt"), "free");

    const originalRemoveSync = Deno.removeSync;
    const blockedPath = join(tmpPath, "blocked.txt");
    Deno.removeSync = ((path: string | URL, options?: Deno.RemoveOptions) => {
      if (String(path) === blockedPath) throw new Deno.errors.PermissionDenied("mock eacces");
      return originalRemoveSync(path, options);
    }) as typeof Deno.removeSync;
    let outcome;
    try {
      outcome = manager.cleanupTmpIfIdle(tmpPath);
    } finally {
      Deno.removeSync = originalRemoveSync;
    }

    assertEquals(outcome.status, "cleaned");
    assertEquals(outcome.retained, 1);
    assert(exists(blockedPath), "the failed entry is retained");
    assertFalse(exists(join(tmpPath, "free.txt")), "other candidates still proceed");
    assertEquals(Deno.lstatSync(tmpPath).isDirectory, true);
  });
});

Deno.test("cleanupTmpIfIdle - traversal bounds retain the remainder and a later pass completes it", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    for (let i = 0; i < 12; i++) writeFixture(join(tmpPath, `entry-${i}.txt`), "x");

    const bounded = manager.cleanupTmpIfIdle(tmpPath, { limits: { maxNodes: 3 } });
    assertEquals(bounded.status, "cleaned");
    assertEquals(bounded.budgetExhausted, true);
    assertEquals(bounded.removed, 3);

    // A later normal pass reclaims the remaining eligible entries.
    const rest = manager.cleanupTmpIfIdle(tmpPath);
    assertEquals(rest.budgetExhausted, false);
    let remaining = 0;
    for (const entry of Deno.readDirSync(tmpPath)) {
      if (entry.name.endsWith(".txt")) remaining++;
    }
    assertEquals(remaining, 0);
  });
});

Deno.test("cleanupTmpIfIdle - the depth bound retains a deep tree instead of recursing without limit", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    const deep = join(tmpPath, "a", "b", "c", "leaf.txt");
    writeFixture(deep, "deep");

    const bounded = manager.cleanupTmpIfIdle(tmpPath, { limits: { maxDepth: 1 } });
    assertEquals(bounded.budgetExhausted, true);
    assert(exists(deep), "work beyond the depth bound is retained");

    const complete = manager.cleanupTmpIfIdle(tmpPath);
    assertEquals(complete.budgetExhausted, false);
    assertFalse(exists(join(tmpPath, "a")));
  });
});

Deno.test("reclaimOrphanTmpDirs - visits only recognized workspace shapes and never other runtime roots", async () => {
  await withWorkspaceRoot(async ({ repoPath, manager }) => {
    // User workspaces, an internal/synthetic platform, and channel workspaces.
    const user = seedUserWorkspace(repoPath, "discord", "u1");
    const internal = seedUserWorkspace(repoPath, "internal", "self-research");
    const channelWorkspace = join(repoPath, "workspaces", "misskey", "channels", "chan1");
    const channelTmp = join(channelWorkspace, "tmp");
    writeFixture(join(channelTmp, "session-staging.json"), "staged");
    writeFixture(join(channelTmp, "omp-agent", "restricted", "state.db"), "state");

    writeFixture(join(user.tmpPath, "orphan.json"), "orphan");
    writeFixture(join(internal.tmpPath, "orphan.json"), "orphan");
    writeFixture(join(user.workspacePath, "memory.private.jsonl"), "memory");

    // The `channels` container itself is never a workspace, even with a tmp.
    const containerTmp = join(repoPath, "workspaces", "discord", "channels", "tmp");
    writeFixture(join(containerTmp, "keep.txt"), "container");

    // Unrelated runtime roots outside the workspace layout.
    const poolRoot = join(repoPath, "omp-pools", "discord:123", "omp-agent", "restricted");
    writeFixture(join(poolRoot, "sessions.db"), "pooled");
    const channelProcessTmp = join(repoPath, "channel-tmp", "discord:123");
    writeFixture(join(channelProcessTmp, "scratch.txt"), "channel process state");
    const sharedAgentWorkspace = join(repoPath, "agent-workspace", "notes");
    writeFixture(join(sharedAgentWorkspace, "index.md"), "shared notes");
    writeFixture(join(repoPath, "tmp", "repo-root.txt"), "repo root");
    writeFixture(join(repoPath, "data", "backups", "tmp", "backup.txt"), "backup");

    const report = await manager.reclaimOrphanTmpDirs();

    assertEquals(report.workspaces, 3);
    assertEquals(report.skipped, 0);
    assert(report.removed > 0);

    assertFalse(exists(join(user.tmpPath, "orphan.json")));
    assertFalse(exists(join(internal.tmpPath, "orphan.json")));
    assertFalse(exists(join(channelTmp, "session-staging.json")));
    // Reserved channel engine state survives, and every outside root is untouched.
    assertEquals(
      Deno.readTextFileSync(join(channelTmp, "omp-agent", "restricted", "state.db")),
      "state",
    );
    assertEquals(Deno.readTextFileSync(join(containerTmp, "keep.txt")), "container");
    assertEquals(Deno.readTextFileSync(join(poolRoot, "sessions.db")), "pooled");
    assertEquals(
      Deno.readTextFileSync(join(channelProcessTmp, "scratch.txt")),
      "channel process state",
    );
    assertEquals(Deno.readTextFileSync(join(sharedAgentWorkspace, "index.md")), "shared notes");
    assertEquals(Deno.readTextFileSync(join(repoPath, "tmp", "repo-root.txt")), "repo root");
    assertEquals(
      Deno.readTextFileSync(join(repoPath, "data", "backups", "tmp", "backup.txt")),
      "backup",
    );
    assertEquals(Deno.readTextFileSync(join(user.workspacePath, "memory.private.jsonl")), "memory");
  });
});

Deno.test("reclaimOrphanTmpDirs - a missing or linked root is a bounded no-op", async () => {
  await withWorkspaceRoot(async ({ repoPath, manager }) => {
    // No workspace root yet: a no-op, never a failure.
    const empty = await manager.reclaimOrphanTmpDirs();
    assertEquals(empty, {
      workspaces: 0,
      removed: 0,
      retained: 0,
      skipped: 0,
      budgetExhausted: false,
    });

    // A linked platform component is skipped with a diagnostic, and its target
    // keeps every byte.
    const outside = join(repoPath, "outside-platform");
    writeFixture(join(outside, "u1", "tmp", "keep.txt"), "outside");
    Deno.mkdirSync(join(repoPath, "workspaces"), { recursive: true });
    Deno.symlinkSync(outside, join(repoPath, "workspaces", "linked-platform"));

    const report = await manager.reclaimOrphanTmpDirs();
    assertEquals(report.workspaces, 0);
    assertEquals(report.skipped, 1);
    assertEquals(Deno.readTextFileSync(join(outside, "u1", "tmp", "keep.txt")), "outside");
  });
});

Deno.test("reclaimOrphanTmpDirs - a small injected budget defers the remainder to a later pass", async () => {
  await withWorkspaceRoot(async ({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    for (let i = 0; i < 10; i++) writeFixture(join(tmpPath, `entry-${i}.txt`), "x");

    const bounded = await manager.reclaimOrphanTmpDirs({ limits: { maxNodes: 4 } });
    assertEquals(bounded.workspaces, 1);
    assertEquals(bounded.skipped, 1);
    assertEquals(bounded.budgetExhausted, true);
    assertEquals(bounded.removed, 4);

    const complete = await manager.reclaimOrphanTmpDirs();
    assertEquals(complete.budgetExhausted, false);
    assertEquals(countTxtEntries(tmpPath), 0);
  });
});

/** Sorted relative paths of a tree, for outside-data sentinel assertions. */
function wholeTree(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of Deno.readDirSync(dir)) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      found.push(rel);
      if (entry.isDirectory) walk(join(dir, entry.name), rel);
    }
  };
  walk(root, "");
  return found.sort();
}

/** Count leftover disposable fixture entries of one tmp directory. */
function countTxtEntries(tmpPath: string): number {
  let count = 0;
  for (const entry of Deno.readDirSync(tmpPath)) {
    if (entry.name.endsWith(".txt")) count++;
  }
  return count;
}

/** How many components sit below `root` (a direct child is depth 1). */
function depthBelow(root: string, path: string): number {
  return path.slice(root.length).split("/").filter((part) => part !== "").length;
}

Deno.test("cleanupTmpIfIdle - a wide directory is consumed lazily, never past the node budget", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    const total = 256;
    for (let i = 0; i < total; i++) {
      writeFixture(join(tmpPath, `wide-${String(i).padStart(3, "0")}.txt`), "x");
    }

    // Count how many directory entries the traversal actually pulls: the
    // iterator must be abandoned at the bound instead of materialising the
    // whole directory (design D4 "bounded work per workspace").
    const originalReadDirSync = Deno.readDirSync;
    let pulled = 0;
    Deno.readDirSync = ((path: string | URL) => {
      const inner = originalReadDirSync(path);
      if (!String(path).startsWith(tmpPath)) return inner;
      const iterator: IterableIterator<Deno.DirEntry> = {
        next: () => {
          pulled++;
          return inner.next();
        },
        [Symbol.iterator]: () => iterator,
      };
      return iterator;
    }) as typeof Deno.readDirSync;
    let outcome;
    try {
      outcome = manager.cleanupTmpIfIdle(tmpPath, { limits: { maxNodes: 4 } });
    } finally {
      Deno.readDirSync = originalReadDirSync;
    }

    assertEquals(outcome.status, "cleaned");
    assertEquals(outcome.budgetExhausted, true);
    assertEquals(outcome.removed, 4);
    // At most one entry beyond the budget may be pulled (the one that trips it).
    assert(pulled <= 5, `the traversal pulled ${pulled} entries for a budget of 4`);
    assert(pulled < total, "the traversal must not enumerate the whole directory");
  });
});

Deno.test("cleanupTmpIfIdle - failing inspections consume the node budget instead of running unbounded", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    for (let i = 0; i < 64; i++) writeFixture(join(tmpPath, `denied-${i}.txt`), "x");

    const originalLstatSync = Deno.lstatSync;
    let attempts = 0;
    Deno.lstatSync = ((path: string | URL) => {
      // Only entries BELOW the tmp root fail: the tmp root itself must still be
      // recognizable ancestry for this test to reach the traversal at all.
      if (String(path).startsWith(`${tmpPath}/`)) {
        attempts++;
        throw new Deno.errors.PermissionDenied("mock eacces");
      }
      return originalLstatSync(path);
    }) as typeof Deno.lstatSync;
    let outcome;
    try {
      outcome = manager.cleanupTmpIfIdle(tmpPath, { limits: { maxNodes: 6 } });
    } finally {
      Deno.lstatSync = originalLstatSync;
    }

    assertEquals(outcome.status, "cleaned");
    assertEquals(outcome.budgetExhausted, true);
    assertEquals(outcome.removed, 0);
    assertEquals(outcome.retained, 6);
    // The bound is charged per ATTEMPTED inspection, so a directory full of
    // failing entries costs exactly the budget — not the whole directory.
    assertEquals(attempts, 6, "attempted inspections must consume the budget");
  });
});

Deno.test("cleanupTmpIfIdle - a depth-bound hit stops the whole workspace pass", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    // Three independent deep chains: whichever one is visited first trips the
    // depth bound, and the pass must then STOP — one trip, never one per chain.
    for (const chain of ["d1", "d2", "d3"]) {
      writeFixture(join(tmpPath, chain, "x", "y", "leaf.txt"), "deep");
    }

    const originalLstatSync = Deno.lstatSync;
    const attempted: string[] = [];
    Deno.lstatSync = ((path: string | URL) => {
      if (String(path).startsWith(`${tmpPath}/`)) attempted.push(String(path));
      return originalLstatSync(path);
    }) as typeof Deno.lstatSync;
    let outcome;
    try {
      outcome = manager.cleanupTmpIfIdle(tmpPath, { limits: { maxDepth: 1 } });
    } finally {
      Deno.lstatSync = originalLstatSync;
    }

    assertEquals(outcome.budgetExhausted, true);
    assertEquals(outcome.removed, 0);
    // The depth bound is hit while inspecting a depth-2 component; nothing may be
    // examined afterwards, so exactly one such component is ever attempted.
    const atBound = attempted.filter((path) => depthBelow(tmpPath, path) === 2);
    assertEquals(atBound.length, 1, `examined past the depth bound: ${attempted.join(", ")}`);
    assertEquals(attempted[attempted.length - 1], atBound[0]);
    // Everything beyond the bound is retained for a later pass.
    for (const chain of ["d1", "d2", "d3"]) {
      assertEquals(Deno.readTextFileSync(join(tmpPath, chain, "x", "y", "leaf.txt")), "deep");
    }
  });
});

Deno.test("cleanupTmpIfIdle - inspection failures and vanished entries retain only the affected candidate", async () => {
  await withWorkspaceRoot(({ repoPath, manager }) => {
    const { tmpPath } = seedUserWorkspace(repoPath, "discord", "u1");
    const blocked = join(tmpPath, "blocked.txt");
    const vanished = join(tmpPath, "vanished.txt");
    writeFixture(blocked, "blocked");
    writeFixture(vanished, "vanished");
    writeFixture(join(tmpPath, "free.txt"), "free");

    const originalLstatSync = Deno.lstatSync;
    Deno.lstatSync = ((path: string | URL) => {
      const target = String(path);
      if (target === blocked) throw new Deno.errors.PermissionDenied("mock eacces");
      // A directory entry that disappeared between enumeration and inspection.
      if (target === vanished) throw new Deno.errors.NotFound("mock race");
      return originalLstatSync(path);
    }) as typeof Deno.lstatSync;
    let outcome;
    try {
      outcome = manager.cleanupTmpIfIdle(tmpPath);
    } finally {
      Deno.lstatSync = originalLstatSync;
    }

    assertEquals(outcome.status, "cleaned");
    // Exactly one candidate is retained (the unreadable one); the vanished entry
    // is harmless and the independent candidate is still reclaimed.
    assertEquals(outcome.retained, 1);
    assert(exists(blocked), "the unreadable entry is retained");
    assertFalse(exists(join(tmpPath, "free.txt")));
    assertEquals(Deno.lstatSync(tmpPath).isDirectory, true);
  });
});

Deno.test("cleanupTmpIfIdle - a linked channel container is never enumerated", async () => {
  await withWorkspaceRoot(async ({ repoPath, manager }) => {
    const channelsPath = join(repoPath, "workspaces", "discord", "channels");
    const outsideChannels = join(repoPath, "outside-channels");
    writeFixture(join(outsideChannels, "chan1", "tmp", "keep.txt"), "outside");
    Deno.mkdirSync(join(repoPath, "workspaces", "discord"), { recursive: true });
    Deno.symlinkSync(outsideChannels, channelsPath);

    const report = await manager.reclaimOrphanTmpDirs();

    // The container is not an ordinary directory, so nothing below it is a
    // candidate and every outside byte is untouched.
    assertEquals(report.workspaces, 0);
    assertEquals(report.skipped, 1);
    assertEquals(
      Deno.readTextFileSync(join(outsideChannels, "chan1", "tmp", "keep.txt")),
      "outside",
    );
  });
});

Deno.test("reclaimOrphanTmpDirs - an unreadable workspace root is reported instead of silently skipped", async () => {
  await withWorkspaceRoot(async ({ repoPath, manager }) => {
    Deno.mkdirSync(join(repoPath, "workspaces"), { recursive: true });

    const originalLstatSync = Deno.lstatSync;
    Deno.lstatSync = ((path: string | URL) => {
      if (String(path) === join(repoPath, "workspaces")) {
        throw new Deno.errors.PermissionDenied("mock eacces");
      }
      return originalLstatSync(path);
    }) as typeof Deno.lstatSync;
    let report;
    try {
      report = await manager.reclaimOrphanTmpDirs();
    } finally {
      Deno.lstatSync = originalLstatSync;
    }

    assertEquals(report.workspaces, 0);
    assertEquals(report.skipped, 1);
  });
});
