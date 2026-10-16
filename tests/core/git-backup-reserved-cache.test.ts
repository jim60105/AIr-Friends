// tests/core/git-backup-reserved-cache.test.ts
//
// The reserved OMP native-cache staging policy: the shared native payload's link points must
// never enter the data backup index, whatever their entry kind, while ordinary data, operator
// ignore rules and push behavior stay exactly as they were.
//
// These tests drive REAL git repositories and inspect the resulting index/commit trees — never
// mocked git argv — because the failure this policy prevents (a ~181 MiB blob reaching GitHub)
// depends on pathspec and index semantics that only real git can confirm.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { GitBackupService } from "@core/git-backup-service.ts";
import {
  isReservedOmpNativeCachePath,
  OMP_NATIVE_CACHE_MODES,
  ompNativeCacheExclusionPathspecs,
} from "@utils/omp-native-cache.ts";
import type { GitBackupConfig } from "../../src/types/config.ts";

const RESERVED_ADDON_DIR = "xdg-data/omp/natives/18.6.1";

/** One reserved entry per real shape, including a multi-component pool key and root-level tmp. */
const RESERVED_PATHS = [
  `omp-pools/discord:123/omp-agent/restricted/${RESERVED_ADDON_DIR}/pi_natives.linux-x64-modern.node`,
  `omp-pools/memory-maintenance:discord/77/omp-agent/native-yolo/${RESERVED_ADDON_DIR}/pi_natives.linux-x64-baseline.node`,
  `tmp/omp-agent/native-yolo/${RESERVED_ADDON_DIR}/pi_natives.linux-x64-modern.node`,
  `workspaces/discord/123/tmp/omp-agent/restricted/${RESERVED_ADDON_DIR}/pi_natives.linux-x64-baseline.node`,
] as const;

const ORDINARY_PATHS = [
  "omp-pools/discord:123/omp-agent/restricted/xdg-data/omp/agent.db",
  "workspaces/discord/123/tmp/notes.md",
  "user-artifact.node",
  "notes/x.md",
] as const;

function createConfig(remoteUrl: string): GitBackupConfig {
  return {
    enabled: true,
    remoteUrl,
    intervalMs: 3600000,
    authorName: "Test Author",
    authorEmail: "test@example.com",
  };
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function git(cwd: string, args: string[]): Promise<GitResult> {
  const command = new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: { GIT_TERMINAL_PROMPT: "0" },
  });
  const { code, stdout, stderr } = await command.output();
  const decoder = new TextDecoder();
  return { code, stdout: decoder.decode(stdout), stderr: decoder.decode(stderr) };
}

async function gitChecked(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.code}): ${result.stderr}`);
  }
  return result.stdout;
}

interface TempEnv {
  tempDir: string;
  dataDir: string;
  bareDir: string;
}

/** A bare remote (optionally with an existing `master`) plus an empty data directory. */
async function makeEnv(options: { remoteMaster?: boolean } = {}): Promise<TempEnv> {
  const tempDir = await Deno.makeTempDir();
  const dataDir = `${tempDir}/data`;
  const bareDir = `${tempDir}/bare.git`;
  await Deno.mkdir(dataDir, { recursive: true });
  await gitChecked(tempDir, ["init", "--bare", "-b", "master", bareDir]);

  if (options.remoteMaster !== false) {
    const seedDir = `${tempDir}/seed`;
    await Deno.mkdir(seedDir, { recursive: true });
    await gitChecked(tempDir, ["clone", bareDir, seedDir]);
    await Deno.writeTextFile(`${seedDir}/.gitkeep`, "");
    await gitChecked(seedDir, ["config", "user.name", "Init"]);
    await gitChecked(seedDir, ["config", "user.email", "init@test.com"]);
    await gitChecked(seedDir, ["add", "-A"]);
    await gitChecked(seedDir, ["commit", "-m", "init"]);
    await gitChecked(seedDir, ["push", "origin", "master"]);
  }
  return { tempDir, dataDir, bareDir };
}

async function writeFiles(dataDir: string, paths: readonly string[], content = "x"): Promise<void> {
  for (const path of paths) {
    const full = `${dataDir}/${path}`;
    await Deno.mkdir(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(full, content);
  }
}

/** Every path recorded in the committed tree of `HEAD`, excluding the root tree itself. */
async function committedPaths(dataDir: string): Promise<string[]> {
  const output = await gitChecked(dataDir, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
  return output.split("\0").filter((path) => path.length > 0);
}

Deno.test("isReservedOmpNativeCachePath - recognizes exactly the reserved shapes", () => {
  const reserved = [
    "omp-pools/discord:123/omp-agent/restricted/xdg-data/omp/natives",
    "omp-pools/discord:123/omp-agent/native-yolo/xdg-data/omp/natives/18.6.1/a.node",
    "omp-pools/memory-maintenance:discord/77/omp-agent/restricted/xdg-data/omp/natives/18.6.1/a.node",
    "tmp/omp-agent/native-yolo/xdg-data/omp/natives",
    "workspaces/discord/123/tmp/omp-agent/restricted/xdg-data/omp/natives/18.6.1/a.node",
    "./omp-pools/discord:123/omp-agent/restricted/xdg-data/omp/natives/a.node",
    "omp-pools/discord:1\n2/omp-agent/restricted/xdg-data/omp/natives/a.node",
  ];
  const ordinary = [
    "omp-pools/discord:123/omp-agent/restricted/xdg-data/omp",
    "omp-pools/discord:123/omp-agent/restricted/xdg-data/omp/agent.db",
    "omp-pools/discord:123/omp-agent/restricted/xdg-data/omp/natives-backup/a.node",
    "omp-pools/omp-agent/restricted/xdg-data/omp/natives",
    "omp-pools/discord:1/2/omp-agent/other-mode/xdg-data/omp/natives",
    "workspaces/discord/123/channel-tmp/omp-agent/restricted/xdg-data/omp/natives",
    "workspaces/discord/123/tmp/omp-agent/restricted/xdg-data/omp/other",
    "notes/x.md",
    "user-artifact.node",
  ];
  for (const path of reserved) {
    assertEquals(isReservedOmpNativeCachePath(path), true, `${path} is reserved`);
  }
  for (const path of ordinary) {
    assertEquals(isReservedOmpNativeCachePath(path), false, `${path} is ordinary`);
  }
});

Deno.test("ompNativeCacheExclusionPathspecs - top-anchored glob pathspecs for both shapes and modes", () => {
  const patterns = ompNativeCacheExclusionPathspecs();
  for (const pattern of patterns) {
    assertStringIncludes(pattern, ":(top,exclude,glob)");
  }
  for (const mode of OMP_NATIVE_CACHE_MODES) {
    const suffix = `omp-agent/${mode}/xdg-data/omp/natives`;
    assertEquals(patterns.includes(`:(top,exclude,glob)omp-pools/**/${suffix}`), true);
    assertEquals(patterns.includes(`:(top,exclude,glob)**/tmp/${suffix}`), true);
    assertEquals(patterns.includes(`:(top,exclude,glob)**/tmp/${suffix}/**`), true);
  }
});

Deno.test("performBackup - reserved native-cache payload never enters the index", async () => {
  const env = await makeEnv();
  try {
    const service = new GitBackupService(createConfig(env.bareDir), env.dataDir);
    await service.initialize();

    await writeFiles(env.dataDir, RESERVED_PATHS);
    await writeFiles(env.dataDir, ORDINARY_PATHS);
    // A reserved entry that is a dangling symlink answers the same way as a real file.
    await Deno.mkdir(`${env.dataDir}/omp-pools/discord:123/omp-agent/native-yolo/xdg-data/omp`, {
      recursive: true,
    });
    await Deno.symlink(
      "/nonexistent-payload",
      `${env.dataDir}/omp-pools/discord:123/omp-agent/native-yolo/xdg-data/omp/natives`,
    );

    assertEquals(await service.performBackup(), true);

    const committed = await committedPaths(env.dataDir);
    for (const path of RESERVED_PATHS) {
      assertEquals(committed.includes(path), false, `${path} is not committed`);
    }
    for (const path of committed) {
      assertEquals(isReservedOmpNativeCachePath(path), false, `${path} is not reserved`);
    }
    for (const path of ORDINARY_PATHS) {
      assertEquals(committed.includes(path), true, `${path} is committed`);
    }
    // The native bytes stay on disk; only the index is narrowed.
    assertEquals(
      await Deno.stat(
        `${env.dataDir}/omp-pools/discord:123/omp-agent/restricted/${RESERVED_ADDON_DIR}/pi_natives.linux-x64-modern.node`,
      ).then((info) => info.isFile),
      true,
    );
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("initialize - non-Git populated tree commits ordinary data without the reserved payload", async () => {
  const env = await makeEnv({ remoteMaster: false });
  try {
    await writeFiles(env.dataDir, RESERVED_PATHS);
    await writeFiles(env.dataDir, ORDINARY_PATHS);

    const service = new GitBackupService(createConfig(env.bareDir), env.dataDir);
    await service.initialize();

    const committed = await committedPaths(env.dataDir);
    for (const path of RESERVED_PATHS) {
      assertEquals(committed.includes(path), false, `${path} is not committed`);
    }
    assertEquals(committed.includes("notes/x.md"), true);
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("initialize - tracked reserved payload is untracked by a deletion commit, file kept", async () => {
  const env = await makeEnv();
  try {
    const service = new GitBackupService(createConfig(env.bareDir), env.dataDir);
    await service.initialize();

    await writeFiles(env.dataDir, RESERVED_PATHS);
    // Simulate a pre-existing repository that already tracked the payload.
    await gitChecked(env.dataDir, ["add", "-A", "--", ...RESERVED_PATHS]);
    await gitChecked(env.dataDir, ["commit", "-m", "tracked cache"]);

    assertEquals(await service.performBackup(), true);

    const committed = await committedPaths(env.dataDir);
    for (const path of RESERVED_PATHS) {
      assertEquals(committed.includes(path), false, `${path} was untracked`);
    }
    for (const path of RESERVED_PATHS) {
      assertEquals(
        await Deno.stat(`${env.dataDir}/${path}`).then((info) => info.isFile),
        true,
        `${path} still exists in the working tree`,
      );
    }
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("performBackup - adversarial reserved names with spaces and newlines stay excluded", async () => {
  const env = await makeEnv();
  try {
    const service = new GitBackupService(createConfig(env.bareDir), env.dataDir);
    await service.initialize();

    const spacedPoolKey =
      `omp-pools/discord:with space/omp-agent/restricted/${RESERVED_ADDON_DIR}/a.node`;
    const newlinePoolKey =
      `omp-pools/discord:line\nbreak/omp-agent/native-yolo/${RESERVED_ADDON_DIR}/b.node`;
    await writeFiles(env.dataDir, [spacedPoolKey, newlinePoolKey]);
    // Tracked beforehand, so the newline path also has to survive argv transport.
    await gitChecked(env.dataDir, ["add", "-A", "--", spacedPoolKey, newlinePoolKey]);
    await gitChecked(env.dataDir, ["commit", "-m", "adversarial cache"]);
    await writeFiles(env.dataDir, ["notes/line\nbreak.md"]);

    assertEquals(await service.performBackup(), true);

    const committed = await committedPaths(env.dataDir);
    assertEquals(committed.includes(spacedPoolKey), false);
    assertEquals(committed.includes(newlinePoolKey), false);
    assertEquals(committed.includes("notes/line\nbreak.md"), true);
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("performBackup - operator .gitignore bytes and unrelated .node files are preserved", async () => {
  const env = await makeEnv();
  try {
    const service = new GitBackupService(createConfig(env.bareDir), env.dataDir);
    await service.initialize();

    const ignoreContent = "# operator rules\n*.log\n!keep.log\n";
    await Deno.writeTextFile(`${env.dataDir}/.gitignore`, ignoreContent);
    await writeFiles(env.dataDir, [RESERVED_PATHS[0], "nested/payload.node"]);

    assertEquals(await service.performBackup(), true);
    assertEquals(await Deno.readTextFile(`${env.dataDir}/.gitignore`), ignoreContent);

    const committed = await committedPaths(env.dataDir);
    assertEquals(committed.includes(".gitignore"), true);
    // A blanket `*.node` filter would have dropped this; only the reserved shape is excluded.
    assertEquals(committed.includes("nested/payload.node"), true);
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("performBackup - a staged-but-uncommitted reserved entry never reaches the commit", async () => {
  const env = await makeEnv();
  try {
    const service = new GitBackupService(createConfig(env.bareDir), env.dataDir);
    await service.initialize();

    await writeFiles(env.dataDir, [RESERVED_PATHS[0], "notes/staged.md"]);
    // Stage the cache addition WITHOUT committing it, as a previous run could have left it.
    await gitChecked(env.dataDir, ["add", "-A", "--", "omp-pools", "notes"]);
    assertEquals(
      (await gitChecked(env.dataDir, ["ls-files", "-z"])).includes(RESERVED_PATHS[0]),
      true,
      "the reserved entry is staged before the backup runs",
    );

    assertEquals(await service.performBackup(), true);

    const committed = await committedPaths(env.dataDir);
    assertEquals(committed.includes(RESERVED_PATHS[0]), false, "the staged entry is not committed");
    assertEquals(committed.includes("notes/staged.md"), true);
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("performBackup - a failing staging step commits and pushes nothing", async () => {
  const env = await makeEnv();
  try {
    const service = new GitBackupService(createConfig(env.bareDir), env.dataDir);
    await service.initialize();
    await writeFiles(env.dataDir, [...RESERVED_PATHS, ...ORDINARY_PATHS]);

    const before = (await gitChecked(env.dataDir, ["rev-parse", "HEAD"])).trim();
    const remoteBefore = (await gitChecked(env.bareDir, ["rev-parse", "master"])).trim();

    // An index lock makes `git rm`/`git add` fail deterministically.
    await Deno.writeTextFile(`${env.dataDir}/.git/index.lock`, "");

    assertEquals(await service.performBackup(), false);

    assertEquals((await gitChecked(env.dataDir, ["rev-parse", "HEAD"])).trim(), before);
    assertEquals((await gitChecked(env.bareDir, ["rev-parse", "master"])).trim(), remoteBefore);
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});
