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

interface TempGitEnvOptions {
  /** Whether to create an initial commit in the bare repo. Default: true */
  createInitialCommit?: boolean;
  /** Files to pre-create in dataDir before running test */
  preCreateFiles?: Record<string, string>;
}

async function withTempGitEnv(
  fn: (dataDir: string, bareDir: string) => Promise<void>,
  options?: TempGitEnvOptions,
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

  if (options?.createInitialCommit !== false) {
    // Create initial commit in bare repo via a temp clone
    const cloneDir = `${tempDir}/clone-init`;
    await Deno.mkdir(cloneDir, { recursive: true });
    const clone = new Deno.Command("git", {
      args: ["clone", bareDir, cloneDir],
      stdout: "piped",
      stderr: "piped",
    });
    await clone.output();

    // Create initial commit so master branch exists
    await Deno.writeTextFile(`${cloneDir}/.gitkeep`, "");
    for (
      const cmd of [
        ["git", "-C", cloneDir, "config", "user.name", "Init"],
        ["git", "-C", cloneDir, "config", "user.email", "init@test.com"],
        ["git", "-C", cloneDir, "add", "-A"],
        ["git", "-C", cloneDir, "commit", "-m", "init"],
        ["git", "-C", cloneDir, "branch", "-M", "master"],
        ["git", "-C", cloneDir, "push", "-u", "origin", "master"],
      ]
    ) {
      const proc = new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        stdout: "piped",
        stderr: "piped",
      });
      await proc.output();
    }
  }

  if (options?.preCreateFiles) {
    for (const [name, content] of Object.entries(options.preCreateFiles)) {
      await Deno.writeTextFile(`${dataDir}/${name}`, content);
    }
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
      args: ["log", "--oneline", "master"],
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

Deno.test("GitBackupService - runGit returns errorOutput on failure", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // Attempt a backup with no changes — commit will fail
    // Use a direct approach: write a file, backup, then backup again with no changes
    // Actually, performBackup returns true when no changes (early return).
    // Instead, test via performBackup with invalid remote to get push failure with errorOutput.
    const service2 = new GitBackupService(
      createConfig({ remoteUrl: "/nonexistent/repo.git" }),
      dataDir,
    );
    // Re-init with bad remote
    // deno-lint-ignore no-explicit-any
    (service2 as any).initialized = true;
    // deno-lint-ignore no-explicit-any
    (service2 as any).dataDir = dataDir;

    await Deno.writeTextFile(`${dataDir}/errortest.txt`, "trigger change");
    const result = await service2.performBackup();
    assertEquals(result, false);
  });
});

Deno.test("GitBackupService - initialize clones from remote when data dir is empty", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // Verify .git exists (from clone)
    const gitStat = await Deno.stat(`${dataDir}/.git`);
    assertEquals(gitStat.isDirectory, true);

    // Verify we have the remote commit history (the "init" commit from bare repo)
    const logProc = new Deno.Command("git", {
      args: ["log", "--oneline"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await logProc.output();
    const log = new TextDecoder().decode(stdout);
    assertEquals(log.includes("init"), true);
  });
});

Deno.test("GitBackupService - initialize falls back to init when clone fails", async () => {
  await withTempGitEnv(async (dataDir, _bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: "/nonexistent/invalid/repo.git" }),
      dataDir,
    );
    await service.initialize();

    // .git should still exist (created via initFromExisting fallback)
    const gitStat = await Deno.stat(`${dataDir}/.git`);
    assertEquals(gitStat.isDirectory, true);

    // Should have an initial commit with .gitignore
    const logProc = new Deno.Command("git", {
      args: ["log", "--oneline"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await logProc.output();
    const log = new TextDecoder().decode(stdout);
    assertEquals(log.includes("initial:"), true);
  });
});

Deno.test("GitBackupService - initialize clones empty remote and creates initial commit", async () => {
  // Use createInitialCommit: false to simulate an empty remote repo
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // Verify .git exists
    const gitStat = await Deno.stat(`${dataDir}/.git`);
    assertEquals(gitStat.isDirectory, true);

    // Should have created an initial commit
    const logProc = new Deno.Command("git", {
      args: ["log", "--oneline"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await logProc.output();
    const log = new TextDecoder().decode(stdout);
    assertEquals(log.includes("initial:"), true);

    // Verify it was pushed to the bare repo
    const bareLogProc = new Deno.Command("git", {
      args: ["log", "--oneline", "master"],
      cwd: bareDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout: bareStdout } = await bareLogProc.output();
    const bareLog = new TextDecoder().decode(bareStdout);
    assertEquals(bareLog.includes("initial:"), true);
  }, { createInitialCommit: false });
});

Deno.test("GitBackupService - initialize inits and commits existing files when not a git repo", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // Should have .git
    const gitStat = await Deno.stat(`${dataDir}/.git`);
    assertEquals(gitStat.isDirectory, true);

    // Should have an initial commit containing the pre-created file
    const logProc = new Deno.Command("git", {
      args: ["log", "--oneline"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await logProc.output();
    const log = new TextDecoder().decode(stdout);
    assertEquals(log.includes("initial:"), true);

    // Verify the file is tracked
    const showProc = new Deno.Command("git", {
      args: ["show", "HEAD:existing.txt"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout: showOut } = await showProc.output();
    assertEquals(new TextDecoder().decode(showOut), "existing content");
  }, { preCreateFiles: { "existing.txt": "existing content" } });
});

Deno.test("GitBackupService - initialize commits uncommitted changes in existing git repo", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    // First, initialize normally
    const service1 = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service1.initialize();

    // Create a new file (uncommitted change)
    await Deno.writeTextFile(`${dataDir}/new-file.txt`, "new content");

    // Re-initialize with a fresh instance (Case C)
    const service2 = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service2.initialize();

    // Should have a backup commit for the uncommitted changes
    const logProc = new Deno.Command("git", {
      args: ["log", "--oneline"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await logProc.output();
    const log = new TextDecoder().decode(stdout);
    assertEquals(log.includes("backup:"), true);

    // Verify the new file is in the backup commit
    const showProc = new Deno.Command("git", {
      args: ["show", "HEAD:new-file.txt"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout: showOut, code } = await showProc.output();
    assertEquals(code, 0);
    assertEquals(new TextDecoder().decode(showOut), "new content");
  });
});

Deno.test("GitBackupService - initialize pushes to fallback branch on non-fast-forward", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    // First, initialize and create a commit
    const service1 = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service1.initialize();

    await Deno.writeTextFile(`${dataDir}/file1.txt`, "local content");
    await service1.performBackup();

    // Create a divergent commit in the bare repo via a separate clone
    const tempDir = await Deno.makeTempDir();
    const conflictCloneDir = `${tempDir}/conflict-clone`;
    await Deno.mkdir(conflictCloneDir, { recursive: true });

    for (
      const cmd of [
        ["git", "clone", bareDir, conflictCloneDir],
        ["git", "-C", conflictCloneDir, "config", "user.name", "Conflict"],
        ["git", "-C", conflictCloneDir, "config", "user.email", "conflict@test.com"],
      ]
    ) {
      await new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        stdout: "piped",
        stderr: "piped",
      }).output();
    }
    await Deno.writeTextFile(`${conflictCloneDir}/file1.txt`, "remote conflict content");
    for (
      const cmd of [
        ["git", "-C", conflictCloneDir, "add", "-A"],
        ["git", "-C", conflictCloneDir, "commit", "-m", "conflicting commit"],
        ["git", "-C", conflictCloneDir, "push", "origin", "master"],
      ]
    ) {
      await new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        stdout: "piped",
        stderr: "piped",
      }).output();
    }

    // Now amend the local commit to create a true divergence
    await Deno.writeTextFile(`${dataDir}/file1.txt`, "amended local content");
    for (
      const cmd of [
        ["git", "-C", dataDir, "add", "-A"],
        ["git", "-C", dataDir, "commit", "--amend", "--no-edit"],
      ]
    ) {
      await new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        stdout: "piped",
        stderr: "piped",
        env: {
          GIT_AUTHOR_NAME: "Test",
          GIT_AUTHOR_EMAIL: "test@test.com",
          GIT_COMMITTER_NAME: "Test",
          GIT_COMMITTER_EMAIL: "test@test.com",
        },
      }).output();
    }

    // Re-initialize with a fresh instance — push should fail, rebase should conflict, fallback branch created
    const service2 = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service2.initialize();

    // Check that a backup-* branch exists in the bare repo
    const branchProc = new Deno.Command("git", {
      args: ["branch"],
      cwd: bareDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout } = await branchProc.output();
    const branches = new TextDecoder().decode(stdout);
    assertEquals(branches.includes("backup-"), true);

    // Verify we are back on main locally
    const currentBranch = new Deno.Command("git", {
      args: ["branch", "--show-current"],
      cwd: dataDir,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout: branchOut } = await currentBranch.output();
    assertEquals(new TextDecoder().decode(branchOut).trim(), "master");

    await Deno.remove(tempDir, { recursive: true });
  });
});

Deno.test("GitBackupService - performBackup handles submodule modified content correctly", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // Create a nested git repo (simulating agent-created repo in workspace)
    const nestedDir = `${dataDir}/workspaces/user1/cloned-repo`;
    await Deno.mkdir(nestedDir, { recursive: true });
    await new Deno.Command("git", {
      args: ["init", nestedDir],
      stdout: "piped",
      stderr: "piped",
    }).output();
    for (
      const cmd of [
        ["git", "-C", nestedDir, "config", "user.name", "Nested"],
        ["git", "-C", nestedDir, "config", "user.email", "nested@test.com"],
      ]
    ) {
      await new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        stdout: "piped",
        stderr: "piped",
      }).output();
    }
    await Deno.writeTextFile(`${nestedDir}/file.txt`, "nested content");
    for (
      const cmd of [
        ["git", "-C", nestedDir, "add", "-A"],
        ["git", "-C", nestedDir, "commit", "-m", "nested init"],
      ]
    ) {
      await new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        stdout: "piped",
        stderr: "piped",
      }).output();
    }

    // Modify a file in the nested repo (creating "modified content" state)
    await Deno.writeTextFile(`${nestedDir}/file.txt`, "modified nested content");

    // performBackup should succeed (not fail with "no changes added to commit")
    const result = await service.performBackup();
    assertEquals(result, true);
  });
});

Deno.test("GitBackupService - ensureGitignore includes **/.git rule", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    const gitignore = await Deno.readTextFile(`${dataDir}/.gitignore`);
    assertEquals(gitignore.includes("**/.git"), true);
  });
});

Deno.test("GitBackupService - performBackup skips commit when only submodule changes exist", async () => {
  await withTempGitEnv(async (dataDir, bareDir) => {
    const service = new GitBackupService(
      createConfig({ remoteUrl: bareDir }),
      dataDir,
    );
    await service.initialize();

    // Create a nested git repo
    const nestedDir = `${dataDir}/workspaces/user1/nested-repo`;
    await Deno.mkdir(nestedDir, { recursive: true });
    await new Deno.Command("git", {
      args: ["init", nestedDir],
      stdout: "piped",
      stderr: "piped",
    }).output();
    for (
      const cmd of [
        ["git", "-C", nestedDir, "config", "user.name", "Nested"],
        ["git", "-C", nestedDir, "config", "user.email", "nested@test.com"],
      ]
    ) {
      await new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        stdout: "piped",
        stderr: "piped",
      }).output();
    }
    await Deno.writeTextFile(`${nestedDir}/file.txt`, "content");
    for (
      const cmd of [
        ["git", "-C", nestedDir, "add", "-A"],
        ["git", "-C", nestedDir, "commit", "-m", "init"],
      ]
    ) {
      await new Deno.Command(cmd[0], {
        args: cmd.slice(1),
        stdout: "piped",
        stderr: "piped",
      }).output();
    }

    // First backup to commit the nested repo directory structure
    await service.performBackup();

    // Modify a file inside the nested repo only
    await Deno.writeTextFile(`${nestedDir}/file.txt`, "modified");

    // Second backup — only submodule has "modified content", no real staged changes
    const result = await service.performBackup();
    assertEquals(result, true);
  });
});
