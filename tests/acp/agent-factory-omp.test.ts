// tests/acp/agent-factory-omp.test.ts
//
// Consumer-visible tests for OMP spawn-mode-scoped agent configurations.
// Tests verify assembled launch configurations, state partitioning, argument
// construction, and invariant enforcement, including the decision-5 both-mode
// `--no-lsp` LSP disable carriers (row 17). These mock/unit tests certify
// decision logic only; native runtime enforcement — including native
// language-server suppression in either mode — remains gated by P0, row 8,
// packaging, and user runtime observation.

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { createAgentConfig, getSessionModeOverride } from "../../src/acp/agent-factory.ts";
import {
  OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
  OMP_TRUSTED_EXTENSION_PATH,
  ompAgentDir,
  ompLaunchCwd,
  ompProcessTmpDir,
  ompXdgDataHome,
} from "../../src/utils/omp-paths.ts";
import type { Config } from "../../src/types/config.ts";

// The launch face of the trusted extension is the GENERATED bundle (C3):
// the factory preflight fails closed without it, so this suite builds the
// canonical development entry once through the same repository command CI
// and the image build use (frozen lock; locked deps come from the local
// cache the test process already holds — zero download). The bundle is
// gitignored generated output, never tracked.
{
  const root = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
  const built = await new Deno.Command(`${root}/scripts/omp/bundle-omp-extension.sh`, {
    args: [root, `${root}/build/omp-extension`, `${root}/deno.lock`],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (built.code !== 0) {
    throw new Error(
      `test prerequisite: bundle build failed: ${new TextDecoder().decode(built.stderr)}`,
    );
  }
}

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

/**
 * Fail-closed fixture: temporarily moves the tracked trusted-extension asset
 * aside so the factory's missing-module check can fire, then restores it. The
 * asset became a tracked repo file with the row-12 extension tree, so the
 * historical fixture's write/delete cycle both could not make the fail-closed
 * case fire (the tracked file exists again under parallel runs) and left the
 * worktree dirty; save/restore keeps the invariant hermetic and testable.
 */
function withAssetAbsent(assetPath: string, run: () => void): void {
  const backup = `${assetPath}.failclosed-backup`;
  let moved = false;
  try {
    Deno.renameSync(assetPath, backup);
    moved = true;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  try {
    run();
  } finally {
    if (moved) Deno.renameSync(backup, assetPath);
  }
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

Deno.test("agent-factory omp - fails closed when the generated extension entry is missing", () => {
  const config = createTestConfig();
  // C3: absence of the GENERATED development entry fails the preflight with
  // the build remedy — never a silent fallback to the raw Deno-only source
  // tree (the error text must name the bundling command).
  withAssetAbsent(OMP_TRUSTED_EXTENSION_BUNDLE_PATH, () => {
    let thrown: Error | undefined;
    try {
      createAgentConfig("omp", "/tmp/ws", config, false);
    } catch (error) {
      thrown = error as Error;
    }
    assert(thrown !== undefined, "missing generated entry must fail the preflight");
    assertStringIncludes(thrown!.message, "Missing trusted extension module");
    assertStringIncludes(thrown!.message, OMP_TRUSTED_EXTENSION_BUNDLE_PATH);
    assertStringIncludes(thrown!.message, "deno task bundle:omp-extension");
  });
});

Deno.test("agent-factory omp - fails closed when overlay files are missing", () => {
  const config = createTestConfig();
  withAssetAbsent("agent-config/omp/restricted.yml", () => {
    assertThrows(
      () => createAgentConfig("omp", "/tmp/ws", config, false),
      Error,
      "Missing owned overlay configuration file",
    );
  });
  withAssetAbsent("agent-config/omp/native-yolo.yml", () => {
    assertThrows(
      () => createAgentConfig("omp", "/tmp/ws", config, true),
      Error,
      "Missing owned overlay configuration file",
    );
  });
});

Deno.test("agent-factory omp - assembles both modes over tracked assets with disjoint overlays and exactly-once --no-lsp", () => {
  const config = createTestConfig();
  // The trusted extension and agent-config/omp overlays are tracked repo
  // assets, so positive assembly runs directly against them.
  const restrictedConfig = createAgentConfig("omp", "/tmp/ws", config, false);
  assertEquals(restrictedConfig.command, "omp");
  assertEquals(restrictedConfig.args.includes("acp"), true);
  assertEquals(restrictedConfig.args.includes("--no-extensions"), true);
  assertEquals(restrictedConfig.args.includes("--trusted-extension"), true);
  // The launch assembly consumes the resolver output verbatim: the GENERATED
  // development entry is presented to the host, never the raw source path.
  assertEquals(
    restrictedConfig.args[restrictedConfig.args.indexOf("--trusted-extension") + 1],
    OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
  );
  assertEquals(restrictedConfig.args.includes(OMP_TRUSTED_EXTENSION_PATH), false);
  assertEquals(restrictedConfig.args.includes("agent-config/omp/restricted.yml"), true);
  assertEquals(restrictedConfig.args.includes("agent-config/omp/native-yolo.yml"), false);

  const yoloConfig = createAgentConfig("omp", "/tmp/ws", config, true);
  assertEquals(yoloConfig.command, "omp");
  assertEquals(yoloConfig.args.includes("agent-config/omp/native-yolo.yml"), true);
  assertEquals(yoloConfig.args.includes("agent-config/omp/restricted.yml"), false);

  // Decision 5 (row 17): BOTH modes carry --no-lsp exactly once. This is
  // carrier wiring evidence only: native language-server suppression,
  // including implicit startup, stays user-observed and unverified.
  for (const assembled of [restrictedConfig, yoloConfig]) {
    assertEquals(
      assembled.args.filter((arg) => arg === "--no-lsp").length,
      1,
      `--no-lsp must appear exactly once: ${assembled.args.join(" ")}`,
    );
  }

  // Restricted keeps the row-8 owned overlay carrying its lsp.enabled:false
  // pin: the flag lands over the unchanged ordered overlay, not instead of it.
  assertEquals(
    restrictedConfig.args.indexOf("--config"),
    restrictedConfig.args.indexOf("agent-config/omp/restricted.yml") - 1,
  );

  // Mode-isolated state roots remain unchanged by the LSP carriers.
  assertEquals(
    restrictedConfig.env!.PI_CODING_AGENT_DIR !== yoloConfig.env!.PI_CODING_AGENT_DIR,
    true,
  );

  // Native YOLO keeps its native approval posture with no restricted carrier:
  // the yolo overlay bytes carry approvalMode yolo plus the decision-5 shared
  // lsp.enabled:false settings pin (row 25) and no restricted-only provider
  // clamp, and no restricted handler/approval-record asset joins the launch.
  const yoloOverlay = Deno.readTextFileSync("agent-config/omp/native-yolo.yml");
  assertEquals(yoloOverlay.includes("approvalMode: yolo"), true);
  assertEquals(yoloOverlay.includes("lsp:\n  enabled: false"), true);
  assertEquals(yoloOverlay.includes("disabledProviders"), false);
  assertEquals(
    yoloConfig.args.some((arg) => arg.includes("restricted")),
    false,
  );
});
