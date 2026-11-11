// tests/acp/agent-connector-env-isolation.test.ts
//
// F1 regression tests: the agent subprocess spawn boundary MUST pass exactly
// the explicitly-built allowlisted environment and inherit NO secrets from the
// parent bot process.
//
// These tests exercise the REAL spawn boundary used by `AgentConnector.connect()`
// (`src/acp/agent-process.ts`) and read the child's actual environment: a tiny
// fixture script prints `process.env`, and the production env builders of
// `agent-factory.ts` build the environment for both agent types.

import { assert, assertEquals } from "@std/assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { createAgentProcess } from "../../src/acp/agent-process.ts";
import { createAgentConfig } from "../../src/acp/agent-factory.ts";
import type { Config } from "../../src/types/config.ts";
import {
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_VERSION,
  type OmpNativeCache,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  ompNativeCachePlatform,
  serializeOmpNativeCacheManifest,
} from "../../src/utils/omp-native-cache.ts";

/** Scratch dir holding the inline environment-printing fixture. */
const scratch = mkdtempSync(join(tmpdir(), "agent-env-isolation-"));

/** The fixture the boundary runs: it serializes its REAL process environment. */
const PRINT_ENV = join(scratch, "print-env.js");
writeFileSync(PRINT_ENV, "console.log(JSON.stringify(process.env));\n");

/**
 * Spawn the fixture through the production spawn boundary with `env` as the
 * COMPLETE child environment, and return the environment the child really saw.
 */
async function spawnAndReadChildEnv(env: Record<string, string>): Promise<Record<string, string>> {
  const handle = createAgentProcess({
    command: process.execPath,
    args: ["run", "--no-env-file", PRINT_ENV],
    cwd: scratch,
    env,
  });
  const stdout = await new Response(handle.stdout).text();
  const stderr = await new Response(handle.stderr).text();
  const exit = await handle.exited;
  if (!exit.success) {
    throw new Error(`child failed (code=${exit.code}, signal=${exit.signal}): ${stderr}`);
  }
  return JSON.parse(stdout.trim()) as Record<string, string>;
}

/** A minimal deployment config whose env builders are the real production ones. */
function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: {
      model: "test-model",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      opencodeApiKey: "oc-configured",
      openRouterApiKey: "or-configured",
      geminiApiKey: "gm-configured",
      ...overrides.agent,
    },
    memory: {
      recentMessageLimit: 20,
      workingTierLimit: 20,
    },
    workspace: {
      repoPath: "/tmp/test-repo",
      workspacesDir: "workspaces",
    },
    logging: {
      level: "INFO",
    },
    replyPolicy: "channels",
    channels: [],
    ...overrides,
  } as Config;
}

/** Writes a COMPLETE synthetic native payload so the OMP factory preflight passes. */
function provisionNativeCache(base: string): OmpNativeCache {
  const platform = ompNativeCachePlatform();
  const cache = ompNativeCacheDescriptor(base, platform, "development");
  const expected = ompNativeCacheExpectedAddons(platform);
  // The arm64 requirement is a pattern; the container-packaging name satisfies it.
  const names = expected.exact.length > 0 ? [...expected.exact] : ["pi_natives.linux-arm64.node"];

  mkdirSync(cache.versionDir, { recursive: true });
  const files = names.map((name) => {
    const bytes = `fixture addon ${name}`;
    writeFileSync(join(cache.versionDir, name), bytes);
    return { name, size: new TextEncoder().encode(bytes).length };
  });
  writeFileSync(
    cache.manifestPath,
    serializeOmpNativeCacheManifest({
      version: OMP_NATIVE_CACHE_VERSION,
      platform,
      executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256[platform],
      files,
    }),
  );
  return cache;
}

test("F1 - clearEnv:true excludes parent secrets from child environment", async () => {
  // Simulate a secret held by the parent bot process that is NOT part of the
  // built agent env (e.g. DISCORD_TOKEN).
  const fakeSecret = "AIRFRIENDS_TEST_FAKE_SECRET";
  process.env[fakeSecret] = "super-secret-value";
  try {
    // Build the agent env the way agent-factory does: an explicit allowlist that
    // deliberately does NOT include the fake parent secret.
    const builtEnv: Record<string, string> = {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "/tmp",
      SESSION_ID: "sess_test",
      AGENT_WORKSPACE: "/tmp/agent-workspace",
      TMPDIR: "/tmp",
    };

    const childEnv = await spawnAndReadChildEnv(builtEnv);

    // The fake parent secret MUST be absent from the child's real environment.
    assertEquals(
      childEnv[fakeSecret],
      undefined,
      "Parent secret leaked into agent subprocess despite the cleared environment",
    );
  } finally {
    delete process.env[fakeSecret];
  }
});

test("F1 - clearEnv:true still provides all built allowlisted variables", async () => {
  const builtEnv: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "/tmp",
    SESSION_ID: "sess_test",
    AGENT_WORKSPACE: "/tmp/agent-workspace",
    TMPDIR: "/tmp",
    OPENROUTER_API_KEY: "or1",
    GEMINI_API_KEY: "gm1",
  };

  const childEnv = await spawnAndReadChildEnv(builtEnv);

  // Required operational vars and OpenCode provider keys ARE present.
  assert(childEnv["PATH"] !== undefined, "PATH missing from child env");
  assertEquals(childEnv["SESSION_ID"], "sess_test");
  assertEquals(childEnv["AGENT_WORKSPACE"], "/tmp/agent-workspace");
  assertEquals(childEnv["TMPDIR"], "/tmp");
  assertEquals(childEnv["OPENROUTER_API_KEY"], "or1");
  assertEquals(childEnv["GEMINI_API_KEY"], "gm1");
});

test("F1 - control: WITHOUT clearEnv, parent secret leaks (documents the bug)", async () => {
  // This negative-control test documents why the boundary must receive the
  // COMPLETE environment: merging the parent environment lets the secret leak.
  const fakeSecret = "leak";
  process.env[fakeSecret] = "leaked-value";
  try {
    const builtEnv: Record<string, string> = {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "/tmp",
    };
    // Deliberately reproduce the merge the boundary must prevent.
    const merged = { ...process.env, ...builtEnv };
    const childInput: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined) childInput[key] = value;
    }
    const observedEnv = await spawnAndReadChildEnv(childInput);
    assertEquals(observedEnv[fakeSecret], "leaked-value");
  } finally {
    delete process.env[fakeSecret];
  }
});

test("F1 - OpenCode production env reaches the child exactly", async () => {
  const workingDir = join(scratch, "opencode-workspace");
  mkdirSync(workingDir, { recursive: true });
  // Parent-side secrets and provider values that must NOT reach the child.
  const parentOverrides: Record<string, string> = {
    DISCORD_TOKEN: "discord-parent-secret",
    SKILL_API_SECRET: "skill-api-parent-secret",
    OPENCODE_API_KEY: "parent-opencode-key",
    OPENROUTER_API_KEY: "parent-openrouter-key",
    GEMINI_API_KEY: "parent-gemini-key",
    LANG: process.env["LANG"] ?? "C.UTF-8",
  };
  const restore = { ...process.env };
  Object.assign(process.env, parentOverrides);
  try {
    const built = createAgentConfig("opencode", workingDir, createTestConfig()).env ?? {};
    const childEnv = await spawnAndReadChildEnv(built);

    assertEquals(
      Object.keys(childEnv).sort(),
      Object.keys(built).sort(),
      "the child environment must be exactly the built environment",
    );
    assert(childEnv["PATH"] !== undefined, "PATH missing from child env");
    assert(childEnv["HOME"] !== undefined, "HOME missing from child env");
    assertEquals(childEnv["LANG"], parentOverrides["LANG"]);
    assertEquals(childEnv["SKILL_JWT_DIR"], built["SKILL_JWT_DIR"]);
    assertEquals(childEnv["OPENCODE_API_KEY"], "oc-configured");
    assertEquals(childEnv["OPENROUTER_API_KEY"], "or-configured");
    assertEquals(childEnv["GEMINI_API_KEY"], "gm-configured");
    assertEquals(childEnv["GOOGLE_GENERATIVE_AI_API_KEY"], "gm-configured");
    assertEquals(childEnv["DISCORD_TOKEN"], undefined);
    assertEquals(childEnv["SKILL_API_SECRET"], undefined);
  } finally {
    for (const key of Object.keys(parentOverrides)) {
      if (restore[key] === undefined) delete process.env[key];
      else process.env[key] = restore[key];
    }
  }
});

test("F1 - OMP production env reaches the child exactly", async () => {
  const root = join(scratch, "omp-root");
  const workingDir = join(root, "workspace");
  mkdirSync(workingDir, { recursive: true });
  const payload = provisionNativeCache(join(root, "native-cache"));
  const parentOverrides: Record<string, string> = {
    DISCORD_TOKEN: "discord-parent-secret",
    SKILL_API_SECRET: "skill-api-parent-secret",
    GEMINI_API_KEY: "parent-gemini-key",
    OPENROUTER_API_KEY: "parent-openrouter-key",
    LANG: process.env["LANG"] ?? "C.UTF-8",
  };
  const restore = { ...process.env };
  Object.assign(process.env, parentOverrides);
  try {
    const config = createTestConfig({
      agent: {
        ...createTestConfig().agent,
        ompNativeCache: {
          installRoot: payload.installRoot,
          launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
        },
      },
    });
    const built = createAgentConfig("omp", workingDir, config, true).env ?? {};
    const childEnv = await spawnAndReadChildEnv(built);

    assertEquals(
      Object.keys(childEnv).sort(),
      Object.keys(built).sort(),
      "the child environment must be exactly the built environment",
    );
    assert(childEnv["PATH"] !== undefined, "PATH missing from child env");
    assert(childEnv["HOME"] !== undefined, "HOME missing from child env");
    assertEquals(childEnv["LANG"], parentOverrides["LANG"]);
    assertEquals(childEnv["SKILL_JWT_DIR"], built["SKILL_JWT_DIR"]);
    assertEquals(childEnv["GEMINI_API_KEY"], "gm-configured");
    assertEquals(childEnv["OPENROUTER_API_KEY"], "or-configured");
    assertEquals(childEnv["DISCORD_TOKEN"], undefined);
    assertEquals(childEnv["SKILL_API_SECRET"], undefined);
  } finally {
    for (const key of Object.keys(parentOverrides)) {
      if (restore[key] === undefined) delete process.env[key];
      else process.env[key] = restore[key];
    }
  }
});

process.on("exit", () => {
  rmSync(scratch, { recursive: true, force: true });
});
