import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  formatCredentialLine,
  resolveHost,
  resolvePassword,
  resolveUsername,
  setupGitCredentials,
} from "@core/git-credential-setup.ts";
import type { GitBackupConfig } from "../../src/types/config.ts";

const decoder = new TextDecoder();
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

async function runDenoEval(
  code: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", code],
    cwd: repoRoot,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

async function runSetupInSubprocess(
  credentialConfig: { enabled: boolean; host?: string },
  backupConfig: GitBackupConfig,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const code = `import { setupGitCredentials } from ${JSON.stringify(moduleUrl)};\n` +
    `await setupGitCredentials(${JSON.stringify(credentialConfig)}, ${
      JSON.stringify(backupConfig)
    });`;

  return await runDenoEval(code, env);
}

Deno.test("git-credential-setup - resolveHost prefers explicit host override", () => {
  assertEquals(
    resolveHost({ enabled: true, host: "gitlab.com" }, createBackupConfig()),
    "gitlab.com",
  );
});

Deno.test("git-credential-setup - resolveHost extracts host from gitBackup remote URL", () => {
  assertEquals(
    resolveHost(
      { enabled: true },
      createBackupConfig({ remoteUrl: "https://example.com/org/repo.git" }),
    ),
    "example.com",
  );
});

Deno.test("git-credential-setup - resolveHost falls back to github.com on invalid URL", () => {
  assertEquals(
    resolveHost(
      { enabled: true },
      createBackupConfig({ remoteUrl: "not-a-valid-url" }),
    ),
    "github.com",
  );
});

Deno.test("git-credential-setup - resolveUsername uses authUser then authorEmail fallback", () => {
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

Deno.test("git-credential-setup - resolvePassword uses config password directly", () => {
  assertEquals(
    resolvePassword(createBackupConfig({ authPassword: "ghp_from_config" })),
    "ghp_from_config",
  );
});

Deno.test("git-credential-setup - resolvePassword falls back to GITHUB_TOKEN env", async () => {
  const result = await runDenoEval(
    `import { resolvePassword } from ${JSON.stringify(moduleUrl)};\n` +
      `console.log(resolvePassword(undefined));`,
    { GITHUB_TOKEN: "ghp_from_env" },
  );

  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "ghp_from_env");
});

Deno.test("git-credential-setup - resolvePassword returns empty when config and env are absent", async () => {
  const result = await runDenoEval(
    `import { resolvePassword } from ${JSON.stringify(moduleUrl)};\n` +
      `console.log(resolvePassword(undefined));`,
    { GITHUB_TOKEN: "" },
  );

  assertEquals(result.code, 0);
  assertEquals(result.stdout.trim(), "");
});

Deno.test("git-credential-setup - formatCredentialLine encodes special characters", () => {
  const result = formatCredentialLine("github.com", "user", "p@ss:w/rd");
  assertEquals(result, "https://user:p%40ss%3Aw%2Frd@github.com");
});

Deno.test("git-credential-setup - setupGitCredentials skips when disabled", async () => {
  const home = await Deno.makeTempDir();

  try {
    await setupGitCredentials({ enabled: false }, createBackupConfig({ authPassword: "ghp_test" }));

    let exists = true;
    try {
      await Deno.stat(`${home}/.git-credentials`);
    } catch {
      exists = false;
    }

    assertEquals(exists, false);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("git-credential-setup - setupGitCredentials warns and skips when no password exists", async () => {
  const result = await runSetupInSubprocess(
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

Deno.test("git-credential-setup - setupGitCredentials writes credential file, chmods it, and configures git", async () => {
  const home = await Deno.makeTempDir();

  try {
    const result = await runSetupInSubprocess(
      { enabled: true },
      createBackupConfig({
        authUser: "oauth2",
        authPassword: "pw1",
        remoteUrl: "https://github.com/example/repo.git",
      }),
      {
        HOME: home,
        PATH: Deno.env.get("PATH") ?? "",
      },
    );

    assertEquals(result.code, 0);

    const credentialPath = `${home}/.git-credentials`;
    const content = await Deno.readTextFile(credentialPath);
    assertEquals(content, "https://oauth2:pw1@github.com\n");

    const stat = await Deno.stat(credentialPath);
    assertEquals((stat.mode ?? 0) & 0o777, 0o600);

    const configResult = await new Deno.Command("git", {
      args: ["config", "--global", "--get", "credential.helper"],
      env: { HOME: home },
      stdout: "piped",
      stderr: "piped",
    }).output();

    assertEquals(configResult.code, 0);
    assertEquals(decoder.decode(configResult.stdout).trim(), "store");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("git-credential-setup - setupGitCredentials gracefully handles missing git", async () => {
  const home = await Deno.makeTempDir();
  const emptyPath = await Deno.makeTempDir();

  try {
    const result = await runSetupInSubprocess(
      { enabled: true },
      createBackupConfig({ authPassword: "pw1" }),
      {
        HOME: home,
        PATH: emptyPath,
      },
    );

    assertEquals(result.code, 0);
    assertMatch(result.stdout, /Git not available, skipping credential helper setup/);

    const content = await Deno.readTextFile(`${home}/.git-credentials`);
    assertEquals(
      content,
      "https://airfriends-backup%40noreply.github.com:pw1@github.com\n",
    );
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(emptyPath, { recursive: true });
  }
});
