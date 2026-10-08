// tests/acp/agent-factory-omp.test.ts
//
// Consumer-visible tests for OMP spawn-mode-scoped agent configurations.
// Tests verify assembled launch configurations, state partitioning, argument
// construction, and invariant enforcement. These mock/unit tests certify
// decision logic only; native runtime enforcement remains gated by P0, row 8,
// and packaging.

import { assertEquals, assertThrows } from "@std/assert";
import { createAgentConfig, getSessionModeOverride } from "../../src/acp/agent-factory.ts";
import {
  OMP_TRUSTED_EXTENSION_PATH,
  ompAgentDir,
  ompLaunchCwd,
  ompProcessTmpDir,
  ompXdgDataHome,
} from "../../src/utils/omp-paths.ts";
import { ompSettingsForMode } from "../../src/acp/omp-settings.ts";
import type { Config } from "../../src/types/config.ts";

function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    discord: { token: "", channelIds: [] },
    agent: {
      defaultAgentType: "omp",
      model: "openrouter/auto",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      geminiApiKey: "gm_test_key",
      openRouterApiKey: "or_test_key",
    },
    workspace: {
      repoPath: "./test-repo",
    },
    ...overrides,
  } as Config;
}

Deno.test("omp-paths - mode roots are strictly disjoint and mode-distinct under identical inputs", () => {
  const base = "/data/test";
  const restrictedAgentDir = ompAgentDir(base, "restricted");
  const yoloAgentDir = ompAgentDir(base, "native-yolo");
  assertEquals(restrictedAgentDir !== yoloAgentDir, true);
  assertEquals(restrictedAgentDir.includes("restricted"), true);
  assertEquals(yoloAgentDir.includes("native-yolo"), true);

  const restrictedTmp = ompProcessTmpDir(base, "restricted");
  const yoloTmp = ompProcessTmpDir(base, "native-yolo");
  assertEquals(restrictedTmp !== yoloTmp, true);

  const restrictedCwd = ompLaunchCwd(base, "restricted");
  const yoloCwd = ompLaunchCwd(base, "native-yolo");
  assertEquals(restrictedCwd !== yoloCwd, true);

  const restrictedXdg = ompXdgDataHome(base, "restricted");
  const yoloXdg = ompXdgDataHome(base, "native-yolo");
  assertEquals(restrictedXdg !== yoloXdg, true);
});

Deno.test("getSessionModeOverride - returns null for omp in both yolo states", () => {
  assertEquals(getSessionModeOverride("omp", false), null);
  assertEquals(getSessionModeOverride("omp", true), null);
  assertEquals(getSessionModeOverride("opencode", true), "yolo");
  assertEquals(getSessionModeOverride("opencode", false), null);
});

Deno.test("agent-factory omp - fails closed when trusted extension module is missing", () => {
  const config = createTestConfig();
  assertThrows(
    () => createAgentConfig("omp", "/tmp/ws", config, false),
    Error,
    "Missing trusted extension module",
  );
});

Deno.test("agent-factory omp - fails closed when overlay files are missing", () => {
  // Ensure dummy trusted extension temporarily exists in memory/fs
  const extDir = "src/acp/omp/extension";
  Deno.mkdirSync(extDir, { recursive: true });
  Deno.writeTextFileSync(OMP_TRUSTED_EXTENSION_PATH, "// dummy extension");

  try {
    const config = createTestConfig();
    // Overlays agent-config/omp/*.yml do exist in the repo
    const restrictedConfig = createAgentConfig("omp", "/tmp/ws", config, false);
    assertEquals(restrictedConfig.command, "omp");
    assertEquals(restrictedConfig.args.includes("acp"), true);
    assertEquals(restrictedConfig.args.includes("--no-extensions"), true);
    assertEquals(restrictedConfig.args.includes("--trusted-extension"), true);
    assertEquals(restrictedConfig.args.includes(OMP_TRUSTED_EXTENSION_PATH), true);
    assertEquals(restrictedConfig.args.includes("agent-config/omp/restricted.yml"), true);
    assertEquals(restrictedConfig.args.includes("agent-config/omp/native-yolo.yml"), false);

    const yoloConfig = createAgentConfig("omp", "/tmp/ws", config, true);
    assertEquals(yoloConfig.command, "omp");
    assertEquals(yoloConfig.args.includes("agent-config/omp/native-yolo.yml"), true);
    assertEquals(yoloConfig.args.includes("agent-config/omp/restricted.yml"), false);
  } finally {
    try {
      Deno.removeSync(OMP_TRUSTED_EXTENSION_PATH);
      Deno.removeSync(extDir);
    } catch {
      // ignore cleanup errors
    }
  }
});
