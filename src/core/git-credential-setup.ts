import { join } from "node:path";
import { createLogger } from "@utils/logger.ts";
import type { GitBackupConfig, GitCredentialConfig } from "../types/config.ts";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";

const logger = createLogger("GitCredentialSetup");

/** Output ceiling for one captured child; far above any git invocation this module runs. */
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;

interface CommandOutput {
  code: number;
  success: boolean;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/**
 * `Deno.Command(...).output()` semantics on top of `node:child_process.execFile`: an absent
 * binary (a string error code such as `ENOENT`) rejects like the original throw, and a
 * non-zero exit resolves with that numeric code. A signal-terminated child (no numeric
 * code) reports `-1`, never `0`, so a terminated command can never read as success.
 */
function runCommand(command: string, args: string[]): Promise<CommandOutput> {
  const pending = Promise.withResolvers<CommandOutput>();
  execFile(command, args, { encoding: "buffer", maxBuffer: MAX_COMMAND_OUTPUT_BYTES }, (
    error,
    stdout,
    stderr,
  ) => {
    if (error === null) {
      pending.resolve({
        code: 0,
        success: true,
        stdout: new Uint8Array(stdout),
        stderr: new Uint8Array(stderr),
      });
      return;
    }
    if (typeof error.code === "string") {
      pending.reject(error);
      return;
    }
    pending.resolve({
      code: typeof error.code === "number" ? error.code : -1,
      success: false,
      stdout: new Uint8Array(
        typeof error.stdout === "string" ? Buffer.from(error.stdout) : error.stdout ?? stdout,
      ),
      stderr: new Uint8Array(
        typeof error.stderr === "string" ? Buffer.from(error.stderr) : error.stderr ?? stderr,
      ),
    });
  });
  return pending.promise;
}

/**
 * Resolve the git host from config sources.
 * Priority: gitCredential.host → parsed from gitBackup.remoteUrl → "github.com"
 */
export function resolveHost(
  credentialConfig: GitCredentialConfig,
  backupConfig?: GitBackupConfig,
): string {
  if (credentialConfig.host) {
    return credentialConfig.host;
  }

  if (backupConfig?.remoteUrl) {
    try {
      const url = new URL(backupConfig.remoteUrl);
      return url.hostname;
    } catch {
      // Fall through to the default host.
    }
  }

  return "github.com";
}

/**
 * Resolve the credential username using the same fallback chain as GitBackupService.
 * Priority: gitBackup.authUser → gitBackup.authorEmail → "x-access-token"
 */
export function resolveUsername(backupConfig?: GitBackupConfig): string {
  return backupConfig?.authUser ??
    backupConfig?.authorEmail ??
    "x-access-token";
}

/**
 * Resolve the credential password using the same fallback chain as GitBackupService.
 * Priority: gitBackup.authPassword → GITHUB_TOKEN env → ""
 */
export function resolvePassword(backupConfig?: GitBackupConfig): string {
  return backupConfig?.authPassword ??
    process.env["GITHUB_TOKEN"] ??
    "";
}

/**
 * Format a credential line for .git-credentials file.
 * Username and password are URL-encoded to preserve special characters.
 */
export function formatCredentialLine(
  host: string,
  username: string,
  password: string,
): string {
  return `https://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}`;
}

/**
 * Setup git credential store at application startup for agent subprocesses.
 */
export async function setupGitCredentials(
  credentialConfig: GitCredentialConfig,
  backupConfig?: GitBackupConfig,
): Promise<void> {
  if (!credentialConfig.enabled) {
    return;
  }

  const password = resolvePassword(backupConfig);
  if (!password) {
    logger.warn(
      "Git credential store enabled but no password available. " +
        "Set gitBackup.authPassword, GIT_BACKUP_AUTH_PASSWORD, or GITHUB_TOKEN",
    );
    return;
  }

  const host = resolveHost(credentialConfig, backupConfig);
  const username = resolveUsername(backupConfig);
  const home = process.env["HOME"] ?? "/home/deno";
  const credentialFilePath = join(home, ".git-credentials");
  const credentialContent = `${formatCredentialLine(host, username, password)}\n`;

  try {
    await fsp.mkdir(home, { recursive: true });
    await fsp.writeFile(credentialFilePath, credentialContent);
  } catch (error) {
    logger.warn("Failed to write .git-credentials file, git credential store will not work", {
      error: (error as Error).message,
    });
    return;
  }

  try {
    await fsp.chmod(credentialFilePath, 0o600);
  } catch (error) {
    logger.warn("Failed to set .git-credentials file permissions", {
      error: (error as Error).message,
    });
  }

  try {
    const result = await runCommand("git", [
      "config",
      "--global",
      "credential.helper",
      "store",
    ]);

    if (result.code !== 0) {
      logger.warn("Failed to configure git credential helper", {
        stderr: new TextDecoder().decode(result.stderr).trim(),
      });
      return;
    }
  } catch (error) {
    logger.warn("Git not available, skipping credential helper setup", {
      error: (error as Error).message,
    });
    return;
  }

  logger.info("Git credential store configured for {host}", { host });
}
