import { createLogger } from "@utils/logger.ts";
import type { GitBackupConfig } from "../types/config.ts";

const logger = createLogger("GitBackupService");

/**
 * Encapsulates all Git operations for backing up the data/ directory.
 */
export class GitBackupService {
  private config: GitBackupConfig;
  private dataDir: string;
  private initialized = false;
  private isPerformingBackup = false;

  constructor(config: GitBackupConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
  }

  /** Initialize the Git repository (called once at startup). */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Clean up stale lock files
    await this.cleanStaleLockFiles();

    // Initialize git repo if needed
    const hasGit = await this.dirExists(`${this.dataDir}/.git`);
    if (!hasGit) {
      logger.info("Initializing Git repository in data directory");
      const init = await this.runGit(["init", "-b", "main"]);
      if (!init.success) {
        logger.error("Failed to initialize Git repository");
        return;
      }
    }

    // Set user config
    await this.runGit(["config", "user.name", this.config.authorName]);
    await this.runGit(["config", "user.email", this.config.authorEmail]);

    // Create .gitignore
    await this.ensureGitignore();

    // Configure remote (uses plain URL; auth is injected per-command)
    await this.configureRemote();

    // Fetch and sync using authenticated URL
    const authUrl = this.getAuthenticatedUrl();
    const fetchResult = await this.runGit(["fetch", authUrl, "main"]);
    if (fetchResult.success) {
      // Update the remote tracking ref manually after fetch-by-URL
      await this.runGit(["update-ref", "refs/remotes/origin/main", "FETCH_HEAD"]);

      // Check if we have local commits
      const localRef = await this.runGit(["rev-parse", "--verify", "HEAD"]);
      if (localRef.success) {
        await this.runGit(["rebase", "origin/main"]);
      } else {
        // No local history yet; reset to match remote
        await this.runGit(["checkout", "-B", "main", "origin/main"]);
      }
    } else {
      logger.warn("Failed to fetch from remote, will retry on next backup");
    }

    // Ensure we are on main branch
    const branch = await this.runGit(["branch", "--show-current"]);
    if (branch.success && branch.output.trim() !== "main") {
      const hasCommits = await this.runGit(["rev-parse", "--verify", "HEAD"]);
      if (hasCommits.success) {
        await this.runGit(["branch", "-M", "main"]);
      }
    }

    this.initialized = true;
    logger.info("Git backup service initialized");
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
    let push = await this.runGit(["push", authUrl, "main"]);
    if (!push.success) {
      // Try rebase and retry once
      logger.warn("Push failed, attempting pull --rebase and retry");
      const fetch = await this.runGit(["fetch", authUrl, "main"]);
      if (fetch.success) {
        await this.runGit(["update-ref", "refs/remotes/origin/main", "FETCH_HEAD"]);
        const rebase = await this.runGit(["rebase", "origin/main"]);
        if (!rebase.success) {
          logger.error("Rebase failed, backup push aborted");
          await this.runGit(["rebase", "--abort"]);
          return false;
        }
      } else {
        logger.error("Fetch for rebase failed, backup push aborted");
        return false;
      }
      push = await this.runGit(["push", authUrl, "main"]);
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
