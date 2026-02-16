import { resolve } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import type { GitBackupConfig } from "../types/config.ts";

const logger = createLogger("GitBackupService");

/**
 * Encapsulates all Git operations for backing up the data/ directory.
 */
export class GitBackupService {
  private static readonly BRANCH_CANDIDATES = ["master", "main"] as const;
  private config: GitBackupConfig;
  private dataDir: string;
  private initialized = false;
  private isPerformingBackup = false;
  private defaultBranch = "master";

  constructor(config: GitBackupConfig, dataDir: string) {
    this.config = config;
    // Convert to absolute path to satisfy Git's safe.directory requirement
    this.dataDir = resolve(dataDir);
  }

  /** Initialize the Git repository (called once at startup). */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Clean up stale lock files
    await this.cleanStaleLockFiles();

    // Mark directory as safe before any git operations
    // This is required in containerized environments where directory ownership may differ
    const safeDir = await this.runGit([
      "config",
      "--global",
      "--add",
      "safe.directory",
      this.dataDir,
    ]);
    if (!safeDir.success) {
      logger.warn("Failed to set safe.directory config", { dataDir: this.dataDir });
    }

    // Determine directory state and execute corresponding initialization
    const hasGit = await this.dirExists(`${this.dataDir}/.git`);
    const isEmpty = await this.isDirEmpty(this.dataDir);

    if (isEmpty) {
      // Case A: Empty directory → clone remote repository
      await this.initFromClone();
    } else if (!hasGit) {
      // Case B: Non-empty + not a Git repo → init and commit existing files
      await this.initFromExisting();
    } else {
      // Case C: Existing Git repo → configure and sync
      await this.initFromGitRepo();
    }

    this.initialized = true;
    logger.info("Git backup service initialized");
  }

  /** Check if a directory is empty. */
  private async isDirEmpty(path: string): Promise<boolean> {
    try {
      for await (const _entry of Deno.readDir(path)) {
        return false;
      }
      return true;
    } catch {
      return true; // Directory doesn't exist = treat as empty
    }
  }

  /** Detect the remote's default branch, preferring master over main. */
  private async detectRemoteBranch(): Promise<void> {
    for (const candidate of GitBackupService.BRANCH_CANDIDATES) {
      const result = await this.runGit([
        "rev-parse",
        "--verify",
        `refs/remotes/origin/${candidate}`,
      ]);
      if (result.success) {
        this.defaultBranch = candidate;
        return;
      }
    }
    // No remote branch found, keep default ("master")
  }

  /** Case A: Empty directory — clone the remote repository. */
  private async initFromClone(): Promise<void> {
    logger.info("Data directory is empty, cloning from remote");
    const authUrl = this.getAuthenticatedUrl();

    // Clone into the data directory (use "." to clone into current dir)
    const clone = await this.runGit(["clone", authUrl, "."]);
    if (!clone.success) {
      // Clone failed (e.g., auth error, network issue)
      // Fall back to initializing a new repo
      logger.warn("Clone failed, initializing new repository");
      await this.initFromExisting();
      return;
    }

    // Set user config after clone
    await this.runGit(["config", "user.name", this.config.authorName]);
    await this.runGit(["config", "user.email", this.config.authorEmail]);
    await this.ensureGitignore();
    await this.configureRemote(); // Ensure remote uses plain URL (not auth URL)

    // Detect the remote's default branch (prefer master over main)
    await this.detectRemoteBranch();

    // Ensure we are on the default branch after clone.
    // When remote HEAD points to a non-existent branch,
    // clone succeeds but no local branch is created.
    const branch = await this.runGit(["branch", "--show-current"]);
    if (!branch.success || branch.output.trim() !== this.defaultBranch) {
      const hasRemoteBranch = await this.runGit([
        "rev-parse",
        "--verify",
        `refs/remotes/origin/${this.defaultBranch}`,
      ]);
      if (hasRemoteBranch.success) {
        await this.runGit(["checkout", "-B", this.defaultBranch, `origin/${this.defaultBranch}`]);
      } else {
        await this.runGit(["checkout", "-b", this.defaultBranch]);
      }
    }

    // Handle empty remote: clone succeeds but no commits exist (no HEAD)
    const hasHead = await this.runGit(["rev-parse", "--verify", "HEAD"]);
    if (!hasHead.success) {
      logger.info("Remote repository is empty, creating initial commit");
      await this.runGit(["add", "-A"]);
      const status = await this.runGit(["status", "--porcelain"]);
      if (status.success && status.output.trim() !== "") {
        const timestamp = new Date().toISOString();
        await this.runGit(["commit", "-m", `initial: ${timestamp}`]);
        await this.pushWithFallback();
      }
      return;
    }

    // Remote had commits: commit .gitignore changes if any, and push
    await this.runGit(["add", "-A"]);
    const status = await this.runGit(["status", "--porcelain"]);
    if (status.success && status.output.trim() !== "") {
      const timestamp = new Date().toISOString();
      await this.runGit(["commit", "-m", `backup: ${timestamp}`]);
      await this.pushWithFallback();
    }
  }

  /** Case B: Non-empty directory without Git — init, commit, and push. */
  private async initFromExisting(): Promise<void> {
    logger.info("Initializing Git repository from existing data");

    const init = await this.runGit(["init", "-b", this.defaultBranch]);
    if (!init.success) {
      logger.error("Failed to initialize Git repository");
      return;
    }

    await this.runGit(["config", "user.name", this.config.authorName]);
    await this.runGit(["config", "user.email", this.config.authorEmail]);
    await this.ensureGitignore();
    await this.configureRemote();

    // Commit all existing files
    await this.runGit(["add", "-A"]);
    const status = await this.runGit(["status", "--porcelain"]);
    if (status.success && status.output.trim() !== "") {
      const timestamp = new Date().toISOString();
      await this.runGit(["commit", "-m", `initial: ${timestamp}`]);
    }

    // Try to push (with conflict resolution)
    await this.pushWithFallback();
  }

  /** Case C: Existing Git repo — configure, commit uncommitted changes, and sync. */
  private async initFromGitRepo(): Promise<void> {
    logger.info("Existing Git repository found, syncing");

    await this.runGit(["config", "user.name", this.config.authorName]);
    await this.runGit(["config", "user.email", this.config.authorEmail]);
    await this.ensureGitignore();
    await this.configureRemote();

    // Ensure we are on default branch
    const branch = await this.runGit(["branch", "--show-current"]);
    if (branch.success && branch.output.trim() !== this.defaultBranch) {
      const hasCommits = await this.runGit(["rev-parse", "--verify", "HEAD"]);
      if (hasCommits.success) {
        await this.runGit(["branch", "-M", this.defaultBranch]);
      }
    }

    // Commit any uncommitted changes
    await this.runGit(["add", "-A"]);
    const status = await this.runGit(["status", "--porcelain"]);
    if (status.success && status.output.trim() !== "") {
      const timestamp = new Date().toISOString();
      await this.runGit(["commit", "-m", `backup: ${timestamp}`]);
      logger.info("Committed uncommitted changes during initialization");
    }

    // Try to push (with conflict resolution)
    await this.pushWithFallback();
  }

  /** Push to remote with fallback strategies for conflict resolution. */
  private async pushWithFallback(): Promise<void> {
    const authUrl = this.getAuthenticatedUrl();

    // Check if we have any commits to push
    const hasCommits = await this.runGit(["rev-parse", "--verify", "HEAD"]);
    if (!hasCommits.success) {
      logger.info("No commits to push");
      return;
    }

    // Attempt 1: Direct push
    let push = await this.runGit(["push", authUrl, this.defaultBranch]);
    if (push.success) return;

    // Attempt 2: Fetch + rebase + push
    logger.warn("Push rejected, attempting pull --rebase and retry");
    const fetch = await this.runGit(["fetch", authUrl, this.defaultBranch]);
    if (fetch.success) {
      await this.runGit([
        "update-ref",
        `refs/remotes/origin/${this.defaultBranch}`,
        "FETCH_HEAD",
      ]);
      const rebase = await this.runGit(["rebase", `origin/${this.defaultBranch}`]);
      if (rebase.success) {
        push = await this.runGit(["push", authUrl, this.defaultBranch]);
        if (push.success) return;
      } else {
        const abortResult = await this.runGit(["rebase", "--abort"]);
        if (!abortResult.success) {
          logger.warn("Rebase abort failed, forcing clean state");
          await this.runGit(["reset", "--hard", "HEAD"]);
        }
      }
    }

    // Attempt 3: Create a new branch with datetime and push
    const datetime = new Date().toISOString().replace(/[:.]/g, "-");
    const branchName = `backup-${datetime}`;
    logger.warn("Push to {defaultBranch} failed, creating fallback branch {branchName}", {
      defaultBranch: this.defaultBranch,
      branchName,
    });

    const checkout = await this.runGit(["checkout", "-b", branchName]);
    if (!checkout.success) {
      logger.error("Failed to create fallback branch {branchName}", { branchName });
      return;
    }

    push = await this.runGit(["push", authUrl, branchName]);
    if (push.success) {
      logger.info("Pushed to fallback branch {branchName}", { branchName });
    } else {
      logger.error("Failed to push to fallback branch {branchName}", { branchName });
    }

    // Switch back to default branch for future operations
    await this.runGit(["checkout", this.defaultBranch]);
  }

  /** Perform a single backup cycle (add → commit → push). */
  async performBackup(): Promise<boolean> {
    if (this.isPerformingBackup) {
      logger.warn("Backup already in progress, skipping");
      return true;
    }

    this.isPerformingBackup = true;
    try {
      return await this.performBackupInternal();
    } finally {
      this.isPerformingBackup = false;
    }
  }

  private async performBackupInternal(): Promise<boolean> {
    // Stage all changes
    const add = await this.runGit(["add", "-A"]);
    if (!add.success) {
      logger.error("Git add failed");
      return false;
    }

    // Check for changes
    const status = await this.runGit(["status", "--porcelain"]);
    if (status.success && status.output.trim() === "") {
      logger.info("No changes to backup");
      return true;
    }

    // Commit
    const timestamp = new Date().toISOString();
    const commit = await this.runGit(["commit", "-m", `backup: ${timestamp}`]);
    if (!commit.success) {
      logger.error("Git commit failed");
      return false;
    }

    logger.info("Created backup commit: backup: {timestamp}", { timestamp });

    // Push using authenticated URL
    const authUrl = this.getAuthenticatedUrl();
    let push = await this.runGit(["push", authUrl, this.defaultBranch]);
    if (!push.success) {
      // Try rebase and retry once
      logger.warn("Push failed, attempting pull --rebase and retry");
      const fetch = await this.runGit(["fetch", authUrl, this.defaultBranch]);
      if (fetch.success) {
        await this.runGit([
          "update-ref",
          `refs/remotes/origin/${this.defaultBranch}`,
          "FETCH_HEAD",
        ]);
        const rebase = await this.runGit(["rebase", `origin/${this.defaultBranch}`]);
        if (!rebase.success) {
          logger.error("Rebase failed, backup push aborted");
          await this.runGit(["rebase", "--abort"]);
          return false;
        }
      } else {
        logger.error("Fetch for rebase failed, backup push aborted");
        return false;
      }
      push = await this.runGit(["push", authUrl, this.defaultBranch]);
      if (!push.success) {
        logger.error("Push retry failed after rebase");
        return false;
      }
    }

    logger.info("Backup pushed successfully");
    return true;
  }

  /** Build the authenticated remote URL with GITHUB_TOKEN injected. */
  private getAuthenticatedUrl(): string {
    const token = Deno.env.get("GITHUB_TOKEN") || "";
    if (!token) return this.config.remoteUrl;

    try {
      const url = new URL(this.config.remoteUrl);
      url.username = "x-access-token";
      url.password = token;
      return url.toString();
    } catch {
      // Not a valid URL (e.g., local path) — return as-is
      return this.config.remoteUrl;
    }
  }

  /** Execute a git command in the data directory. */
  private async runGit(args: string[]): Promise<{ success: boolean; output: string }> {
    const command = new Deno.Command("git", {
      args,
      cwd: this.dataDir,
      env: {
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: this.config.authorName,
        GIT_AUTHOR_EMAIL: this.config.authorEmail,
        GIT_COMMITTER_NAME: this.config.authorName,
        GIT_COMMITTER_EMAIL: this.config.authorEmail,
      },
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();
    const { code, stdout, stderr } = await process.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    if (code !== 0) {
      logger.error("Git command failed", {
        args: args.map((a) => a.includes("@") ? "[REDACTED_URL]" : a),
        exitCode: code,
        stderr: errorOutput.replace(/x-access-token:[^@]+@/g, "x-access-token:***@"),
      });
    }

    return { success: code === 0, output };
  }

  /** Ensure .gitignore exists with required exclusions. */
  private async ensureGitignore(): Promise<void> {
    const gitignorePath = `${this.dataDir}/.gitignore`;
    const content = `# Temporary session files
SESSION_ID

# OS generated files
.DS_Store
Thumbs.db
`;
    try {
      await Deno.writeTextFile(gitignorePath, content);
    } catch (error) {
      logger.error("Failed to write .gitignore", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Configure the git remote origin. */
  private async configureRemote(): Promise<void> {
    const remoteResult = await this.runGit(["remote", "get-url", "origin"]);
    if (!remoteResult.success) {
      await this.runGit(["remote", "add", "origin", this.config.remoteUrl]);
    } else if (remoteResult.output.trim() !== this.config.remoteUrl) {
      await this.runGit(["remote", "set-url", "origin", this.config.remoteUrl]);
    }
  }

  /** Check if a directory exists. */
  private async dirExists(path: string): Promise<boolean> {
    try {
      const stat = await Deno.stat(path);
      return stat.isDirectory;
    } catch {
      return false;
    }
  }

  /** Clean up stale Git lock files that may have been left behind. */
  private async cleanStaleLockFiles(): Promise<void> {
    const lockPath = `${this.dataDir}/.git/index.lock`;
    try {
      await Deno.remove(lockPath);
      logger.warn("Removed stale Git lock file: {lockPath}", { lockPath });
    } catch {
      // Lock file doesn't exist — this is the normal case
    }
  }
}
