import { join } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import type { GitBackupConfig, GitCredentialConfig } from "../types/config.ts";

const logger = createLogger("GitCredentialSetup");

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
    Deno.env.get("GITHUB_TOKEN") ??
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
  const home = Deno.env.get("HOME") ?? "/home/deno";
  const credentialFilePath = join(home, ".git-credentials");
  const credentialContent = `${formatCredentialLine(host, username, password)}\n`;

  try {
    await Deno.mkdir(home, { recursive: true });
    await Deno.writeTextFile(credentialFilePath, credentialContent);
  } catch (error) {
    logger.warn("Failed to write .git-credentials file, git credential store will not work", {
      error: (error as Error).message,
    });
    return;
  }

  try {
    await Deno.chmod(credentialFilePath, 0o600);
  } catch (error) {
    logger.warn("Failed to set .git-credentials file permissions", {
      error: (error as Error).message,
    });
  }

  try {
    const result = await new Deno.Command("git", {
      args: ["config", "--global", "credential.helper", "store"],
      stdout: "piped",
      stderr: "piped",
    }).output();

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
