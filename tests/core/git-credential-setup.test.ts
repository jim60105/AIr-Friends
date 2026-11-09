import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

import {
  formatCredentialLine,
  resolveHost,
  resolvePassword,
  resolveUsername,
  setupGitCredentials,
} from "@core/git-credential-setup.ts";
import type { GitBackupConfig } from "../../src/types/config.ts";
import fsp from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";
import { fileURLToPath as fromFileUrl } from "node:url";

const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
const moduleUrl = new URL("../../src/core/git-credential-setup.ts", import.meta.url).href;

function createBackupConfig(overrides: Partial<GitBackupConfig> = {}): GitBackupConfig {
  return {
    enabled: false,
    remoteUrl: "https://github.com/example/repo.git",
    intervalMs: 3600000,
    authorName: "AIr-Friends Backup",
    authorEmail: "airfriends-backup@noreply.github.com",
    ...overrides,
  };
}

function runEval(
  code: string,
  env: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["-e", code], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function runSetupInSubprocess(
  credentialConfig: { enabled: boolean; host?: string },
  backupConfig: GitBackupConfig,
  env: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  const code = `import { setupGitCredentials } from ${JSON.stringify(moduleUrl)};\n` +
    `await setupGitCredentials(${JSON.stringify(credentialConfig)}, ${
      JSON.stringify(backupConfig)
    });`;

  const result = runEval(code, env);
  // `git-credential-setup.ts` catches the absent `Deno` global around its
  // command site, so an unported `Deno.Command` surfaces only as a logged
  // warning in the child. Re-raise the same ReferenceError here so the parity
  // gate records the deferral instead of a downstream assertion mismatch.
  if (`${result.stdout}\n${result.stderr}`.includes("Deno is not defined")) {
    throw new ReferenceError("Deno is not defined");
  }
  return result;
}

test("git-credential-setup - resolveHost prefers explicit host override", () => {
  assertEquals(
    resolveHost({ enabled: true, host: "gitlab.com" }, createBackupConfig()),
    "gitlab.com",
  );
});

test("git-credential-setup - resolveHost extracts host from gitBackup remote URL", () => {
  assertEquals(
    resolveHost(
      { enabled: true },
      createBackupConfig({ remoteUrl: "https://example.com/org/repo.git" }),
    ),
    "example.com",
  );
});

test("git-credential-setup - resolveHost falls back to github.com on invalid URL", () => {
  assertEquals(
    resolveHost(
      { enabled: true },
      createBackupConfig({ remoteUrl: "not-a-valid-url" }),
    ),
    "github.com",
  );
});

test("git-credential-setup - resolveUsername uses authUser then authorEmail fallback", () => {
  assertEquals(
    resolveUsername(createBackupConfig({ authUser: "oauth2" })),
    "oauth2",
  );
  assertEquals(
    resolveUsername(createBackupConfig({ authUser: undefined, authorEmail: "bot@example.com" })),
    "bot@example.com",
  );
  assertEquals(resolveUsername(undefined), "x-access-token");
});

test("git-credential-setup - resolvePassword uses config password directly", () => {
  assertEquals(
    resolvePassword(createBackupConfig({ authPassword: "ghp_from_config" })),
    "ghp_from_config",
  );
});

test("git-credential-setup - resolvePassword falls back to GITHUB_TOKEN env", () => {
  const result = runEval(
    `import { resolvePassword } from ${JSON.stringify(moduleUrl)};\n` +
      `console.log(resolvePassword(undefined));`,
    { GITHUB_TOKEN: "ghp_from_env" },
  );

  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "ghp_from_env");
});

test("git-credential-setup - resolvePassword returns empty when config and env are absent", () => {
  const result = runEval(
    `import { resolvePassword } from ${JSON.stringify(moduleUrl)};\n` +
      `console.log(resolvePassword(undefined));`,
    { GITHUB_TOKEN: "" },
  );

  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "");
});

test("git-credential-setup - formatCredentialLine encodes special characters", () => {
  const result = formatCredentialLine("github.com", "user", "p@ss:w/rd");
  assertEquals(result, "https://user:p%40ss%3Aw%2Frd@github.com");
});

test("git-credential-setup - setupGitCredentials skips when disabled", async () => {
  const home = await makeTempDir();

  try {
    await setupGitCredentials({ enabled: false }, createBackupConfig({ authPassword: "ghp_test" }));

    let exists = true;
    try {
      await fsp.stat(`${home}/.git-credentials`);
    } catch {
      exists = false;
    }

    assertEquals(exists, false);
  } finally {
    await fsp.rm(home, { recursive: true });
  }
});

test("git-credential-setup - setupGitCredentials warns and skips when no password exists", () => {
  const result = runSetupInSubprocess(
    { enabled: true },
    createBackupConfig(),
    { GITHUB_TOKEN: "" },
  );

  assertEquals(result.code, 0);
  const lines = result.stdout.trim().split("\n").filter((line) => line !== "");
  assertEquals(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assertStringIncludes(entry.message, "Git credential store enabled but no password available");
});

test("git-credential-setup - setupGitCredentials writes credential file, chmods it, and configures git", async () => {
  const home = await makeTempDir();

  try {
    const result = runSetupInSubprocess(
      { enabled: true },
      createBackupConfig({
        authUser: "oauth2",
        authPassword: "pw1",
        remoteUrl: "https://github.com/example/repo.git",
      }),
      {
        HOME: home,
        PATH: process.env["PATH"] ?? "",
      },
    );

    assertEquals(result.code, 0);

    const credentialPath = `${home}/.git-credentials`;
    const content = await fsp.readFile(credentialPath, "utf8");
    assertEquals(content, "https://oauth2:pw1@github.com\n");

    const stat = await fsp.stat(credentialPath);
    assertEquals((stat.mode ?? 0) & 0o777, 0o600);

    const configResult = spawnSync("git", ["config", "--global", "--get", "credential.helper"], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });

    assertEquals(configResult.status, 0);
    assertEquals(configResult.stdout.trim(), "store");
  } finally {
    await fsp.rm(home, { recursive: true });
  }
});

test("git-credential-setup - setupGitCredentials gracefully handles missing git", async () => {
  const home = await makeTempDir();
  const emptyPath = await makeTempDir();

  try {
    const result = runSetupInSubprocess(
      { enabled: true },
      createBackupConfig({ authPassword: "pw1" }),
      {
        HOME: home,
        PATH: emptyPath,
      },
    );

    assertEquals(result.code, 0);
    assertMatch(result.stdout, /Git not available, skipping credential helper setup/);

    const content = await fsp.readFile(`${home}/.git-credentials`, "utf8");
    assertEquals(
      content,
      "https://airfriends-backup%40noreply.github.com:pw1@github.com\n",
    );
  } finally {
    await fsp.rm(home, { recursive: true });
    await fsp.rm(emptyPath, { recursive: true });
  }
});
