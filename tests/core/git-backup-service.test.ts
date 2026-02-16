import { assertEquals } from "@std/assert";
import { GitBackupService } from "@core/git-backup-service.ts";
import type { GitBackupConfig } from "../../src/types/config.ts";

function createConfig(overrides?: Partial<GitBackupConfig>): GitBackupConfig {
  return {
    enabled: true,
    remoteUrl: "https://github.com/test/repo.git",
    intervalMs: 3600000,
    authorName: "Test Author",
    authorEmail: "test@example.com",
    ...overrides,
  };
}

async function withTempGitEnv(
  fn: (dataDir: string, bareDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  const dataDir = `${tempDir}/data`;
  const bareDir = `${tempDir}/bare.git`;

  await Deno.mkdir(dataDir, { recursive: true });

  // Create a bare repo to act as remote
  const initBare = new Deno.Command("git", {
    args: ["init", "--bare", bareDir],
    stdout: "piped",
    stderr: "piped",
  });
  await initBare.output();

  // Create initial commit in bare repo via a temp clone
  const cloneDir = `${tempDir}/clone-init`;
  await Deno.mkdir(cloneDir, { recursive: true });
  const clone = new Deno.Command("git", {
    args: ["clone", bareDir, cloneDir],
    stdout: "piped",
    stderr: "piped",
  });
  await clone.output();

  // Create initial commit so main branch exists
  await Deno.writeTextFile(`${cloneDir}/.gitkeep`, "");
  for (
    const cmd of [
      ["git", "-C", cloneDir, "config", "user.name", "Init"],
      ["git", "-C", cloneDir, "config", "user.email", "init@test.com"],
      ["git", "-C", cloneDir, "add", "-A"],
      ["git", "-C", cloneDir, "commit", "-m", "init"],
      ["git", "-C", cloneDir, "branch", "-M", "main"],
      ["git", "-C", cloneDir, "push", "-u", "origin", "main"],
    ]
  ) {
    const proc = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdout: "piped",
      stderr: "piped",
    });
    await proc.output();
  }

  try {
    await fn(dataDir, bareDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("GitBackupService - initialize creates .git and .gitignore", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    const gitStat = await Deno.stat(`${dataDir}/.git`);
    assertEquals(gitStat.isDirectory, true);

    const gitignore = await Deno.readTextFile(`${dataDir}/.gitignore`);
    assertEquals(gitignore.includes("SESSION_ID"), true);
  });
});

Deno.test("GitBackupService - initialize sets remote origin", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    const proc = new Deno.Command("git", {
      args: ["remote", "get-url", "origin"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await proc.output();
    const url = new TextDecoder().decode(stdout).trim();
    assertEquals(url, bareDir);
  });
});

Deno.test("GitBackupService - initialize skips if already initialized", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();
    // Second call should not throw
    await service.initialize();

    const gitStat = await Deno.stat(`${dataDir}/.git`);
    assertEquals(gitStat.isDirectory, true);
  });
});

Deno.test("GitBackupService - performBackup commits and pushes when changes exist", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // Create a file to trigger a change
    await Deno.writeTextFile(`${dataDir}/test.txt`, "hello");

    const result = await service.performBackup();
    assertEquals(result, true);

    // Verify the commit exists in the bare repo
    const logProc = new Deno.Command("git", {
      args: ["log", "--oneline", "main"],
      cwd: bareDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await logProc.output();
    const log = new TextDecoder().decode(stdout);
    assertEquals(log.includes("backup:"), true);
  });
});

Deno.test("GitBackupService - performBackup skips when no changes", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // First backup with a change
    await Deno.writeTextFile(`${dataDir}/test.txt`, "hello");
    await service.performBackup();

    // Second backup with no changes
    const result = await service.performBackup();
    assertEquals(result, true);
  });
});

Deno.test("GitBackupService - performBackup returns false on push failure", async () => {
  await withTempGitEnv(async (dataDir, _bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: "/nonexistent/repo.git" }),
      dataDir,
    );
    // Initialize with the non-existent remote (will fail fetch but still init)
    await service.initialize();

    await Deno.writeTextFile(`${dataDir}/test.txt`, "hello");
    const result = await service.performBackup();
    assertEquals(result, false);
  });
});

Deno.test("GitBackupService - initialize updates remote URL if changed", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    // First init with original URL
    const service1 = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service1.initialize();

    // Create a new service with different URL (simulate config change)
    const newBareDir = `${dataDir}/../new-bare.git`;
    const initBare = new Deno.Command("git", {
      args: ["init", "--bare", newBareDir],
      stdout: "piped",
      stderr: "piped",
    });
    await initBare.output();

    // Need a fresh service instance (initialized = false)
    const service2 = new GitBackupService(
      createConfig({ remoteUrl: newBareDir }),
      dataDir,
    );
    await service2.initialize();

    const proc = new Deno.Command("git", {
      args: ["remote", "get-url", "origin"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await proc.output();
    const url = new TextDecoder().decode(stdout).trim();
    assertEquals(url, newBareDir);
  });
});

Deno.test("GitBackupService - cleans stale lock files on initialize", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    // First, initialize normally to create .git directory
    const service1 = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service1.initialize();

    // Create a stale lock file
    await Deno.writeTextFile(`${dataDir}/.git/index.lock`, "stale");

    // Re-initialize (fresh instance)
    const service2 = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service2.initialize();

    // Lock file should be removed
    let lockExists = false;
    try {
      await Deno.stat(`${dataDir}/.git/index.lock`);
      lockExists = true;
    } catch {
      lockExists = false;
    }
    assertEquals(lockExists, false);
  });
});

Deno.test("GitBackupService - initialize sets safe.directory config", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // Check if safe.directory is set globally
    const proc = new Deno.Command("git", {
      args: ["config", "--global", "--get-all", "safe.directory"],
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, success } = await proc.output();
    const safeDirs = new TextDecoder().decode(stdout).trim().split("\n");

    // Verify that our dataDir is in the safe.directory list
    assertEquals(success, true);
    assertEquals(safeDirs.includes(dataDir), true);
  });
});

Deno.test("GitBackupService - converts relative path to absolute for safe.directory", async () => {
  const tempDir = await Deno.makeTempDir();
  const relativeDataDir = "./data";
  const actualDataDir = `${tempDir}/data`;

  await Deno.mkdir(actualDataDir, { recursive: true });

  // Save current directory
  const originalCwd = Deno.cwd();

  try {
    // Change to temp directory
    Deno.chdir(tempDir);

    // Create bare repo
    const bareDir = `${tempDir}/bare.git`;
    await new Deno.Command("git", {
      args: ["init", "--bare", bareDir],
      stdout: "piped",
      stderr: "piped",
    }).output();

    // Create service with relative path
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      relativeDataDir,
    );
    await service.initialize();

    // Check if safe.directory is set with absolute path
    const proc = new Deno.Command("git", {
      args: ["config", "--global", "--get-all", "safe.directory"],
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, success } = await proc.output();
    const safeDirs = new TextDecoder().decode(stdout).trim().split("\n");

    // Verify that the absolute path (not relative) is in the safe.directory list
    assertEquals(success, true);
    assertEquals(
      safeDirs.some((dir) => dir === actualDataDir),
      true,
      `Expected ${actualDataDir} to be in safe.directory list`,
    );
    assertEquals(
      safeDirs.includes(relativeDataDir),
      false,
      "Relative path should not be in safe.directory list",
    );
  } finally {
    // Restore original directory
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});
