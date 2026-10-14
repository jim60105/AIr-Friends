// tests/acp/agent-factory-omp.test.ts
//
// Consumer-visible tests for the native-OMP launch assembly: the assembled
// argument vector, environment, process cwd and confinement mounts of each
// approval mode, plus the fail-closed preflight for the generated trusted
// extension. The assertions observe the assembled launch output (args, env,
// cwd, mounts, filesystem state) — never source text.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  createAgentConfig,
  getSessionModeOverride,
  OMP_NATIVE_YOLO_SETTINGS_PATH,
  OMP_RESTRICTED_SETTINGS_PATH,
} from "../../src/acp/agent-factory.ts";
import {
  OMP_IMAGE_EXTENSION_ARTIFACT,
  OMP_TRUSTED_EXTENSION_BUNDLE_DIR,
  OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
  OMP_TRUSTED_EXTENSION_PATH,
  ompXdgDataHome,
  resolveOmpConfigPath,
  resolveOmpExtensionPath,
  resolveOmpSystemPromptPath,
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
    args: [root, `${root}/${OMP_TRUSTED_EXTENSION_BUNDLE_DIR}`, `${root}/deno.lock`],
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
 * Fail-closed fixture: temporarily moves the selected trusted-extension
 * artifact aside so the factory's missing-module check can fire, then restores
 * it. The artifact is generated (or image-installed) rather than tracked, so
 * save/restore keeps the invariant hermetic across parallel runs without
 * leaving the checkout dirty.
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

Deno.test("omp-paths - native data roots are mode-distinct for identical inputs", () => {
  const base = "/data/test";
  const restricted = ompXdgDataHome(base, "restricted");
  const yolo = ompXdgDataHome(base, "native-yolo");
  assertEquals(restricted, resolve(join(base, "omp-agent", "restricted", "xdg-data")));
  assertEquals(yolo, resolve(join(base, "omp-agent", "native-yolo", "xdg-data")));
  assertEquals(restricted !== yolo, true);
});

Deno.test("getSessionModeOverride - returns null for omp in both yolo states", () => {
  assertEquals(getSessionModeOverride("omp", false), null);
  assertEquals(getSessionModeOverride("omp", true), null);
  assertEquals(getSessionModeOverride("opencode", true), "yolo");
  assertEquals(getSessionModeOverride("opencode", false), null);
});

Deno.test("agent-factory omp - fails closed when the trusted extension artifact is missing", async () => {
  const root = await Deno.makeTempDir();
  try {
    const repoPath = join(root, "repo");
    const config = createTestConfig({
      workspace: { repoPath, workspacesDir: join(root, "workspaces") },
    });
    const workingDir = join(root, "ws");
    Deno.mkdirSync(workingDir, { recursive: true });
    // C3: absence of the generated entry fails the preflight with the build
    // remedy — never a silent fallback to the raw Deno-only source tree (the
    // error text must name the bundling command).
    const artifact = resolveOmpExtensionPath();
    withAssetAbsent(artifact, () => {
      let thrown: Error | undefined;
      try {
        createAgentConfig("omp", workingDir, config, false);
      } catch (error) {
        thrown = error as Error;
      }
      assert(thrown !== undefined, "missing generated entry must fail the preflight");
      assertStringIncludes(thrown!.message, "Missing trusted extension module");
      assertStringIncludes(thrown!.message, artifact);
      assertStringIncludes(thrown!.message, "deno task bundle:omp-extension");
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("agent-factory omp - assembles both modes in per-spawn and pooled shapes", async () => {
  const root = await Deno.makeTempDir();
  try {
    const workingDir = join(root, "ws");
    const repoPath = join(root, "repo");
    Deno.mkdirSync(workingDir, { recursive: true });
    Deno.mkdirSync(repoPath, { recursive: true });
    const config = createTestConfig({
      workspace: { repoPath, workspacesDir: join(root, "workspaces") },
    });

    const sessionId = "session-abc";
    const poolKey = "pool-abc";

    const settingsPathFor = (mode: "restricted" | "native-yolo"): string =>
      resolve(
        resolveOmpConfigPath(
          mode === "restricted" ? OMP_RESTRICTED_SETTINGS_PATH : OMP_NATIVE_YOLO_SETTINGS_PATH,
        ),
      );
    // Every selected launch path is ABSOLUTE (the child starts in workingDir).
    const promptPath = resolve(resolveOmpSystemPromptPath());
    const bundlePath = resolve(resolveOmpExtensionPath());
    // Deployment-face precondition: the resolver yields exactly one of the two
    // contracted artifacts (installed image copy, or generated development
    // entry) — the raw Deno-only source tree is never a launch face.
    const rawBundlePath = resolveOmpExtensionPath();
    assert(
      rawBundlePath === OMP_TRUSTED_EXTENSION_BUNDLE_PATH ||
        rawBundlePath === OMP_IMAGE_EXTENSION_ARTIFACT,
      `uncontracted extension artifact: ${rawBundlePath}`,
    );
    assert(bundlePath.startsWith("/"), `launch asset path must be absolute: ${bundlePath}`);
    assert(settingsPathFor("restricted").startsWith("/"), "settings path must be absolute");
    assert(promptPath.startsWith("/"), "prompt path must be absolute");
    const homeModelsPath = Deno.env.get("HOME") !== undefined
      ? resolve(join(Deno.env.get("HOME")!, ".omp", "agent", "models.yml"))
      : undefined;

    const countOf = (args: readonly string[], value: string): number =>
      args.filter((arg) => arg === value).length;

    for (const mode of ["restricted", "native-yolo"] as const) {
      const settingsPath = settingsPathFor(mode);
      const restricted = mode === "restricted";

      for (
        const [shape, poolArgument, expectedBaseRoot] of [
          ["per-spawn", undefined, resolve(join(workingDir, "tmp"))],
          ["pooled", poolKey, resolve(join(repoPath, "omp-pools", poolKey))],
        ] as const
      ) {
        const assembled = createAgentConfig(
          "omp",
          workingDir,
          config,
          mode === "native-yolo",
          undefined,
          sessionId,
          poolArgument,
        );
        const label = `${mode}/${shape}`;
        const args = assembled.args;

        assertEquals(assembled.command, "omp", label);
        assertEquals(args[0], "acp", label);
        // The whole launch vector is the contracted shape: acp + the selected
        // mode settings + the prompt, plus the restricted-only extension pair.
        assertEquals(args.length, restricted ? 7 : 5, label);
        assertEquals(countOf(args, "acp"), 1, `exactly one acp: ${args.join(" ")}`);
        assertEquals(countOf(args, "--config"), 1, `exactly one --config: ${args.join(" ")}`);
        assertEquals(
          countOf(args, "--system-prompt"),
          1,
          `exactly one --system-prompt: ${args.join(" ")}`,
        );
        assertEquals(args.indexOf("--config") + 1, args.indexOf(settingsPath), label);
        assertEquals(args[args.indexOf("--system-prompt") + 1], promptPath, label);
        assertEquals(args.includes("--no-extensions"), false, label);
        assertEquals(args.includes("--no-lsp"), false, label);

        // The restricted launch loads the generated capability bundle; the
        // YOLO launch carries no restricted carrier at all, and neither mode
        // is ever handed the raw Deno-only source tree.
        if (restricted) {
          assertEquals(countOf(args, "--trusted-extension"), 1, label);
          assertEquals(args[args.indexOf("--trusted-extension") + 1], bundlePath, label);
        } else {
          assertEquals(countOf(args, "--trusted-extension"), 0, label);
        }
        assertEquals(args.includes(OMP_TRUSTED_EXTENSION_PATH), false, label);

        assertEquals(assembled.cwd, workingDir, label);

        // Mode-distinct native data root, created before spawn because native
        // OMP only adopts `$XDG_DATA_HOME/omp` when the directory exists.
        const xdgDataHome = ompXdgDataHome(expectedBaseRoot, mode);
        assertEquals(assembled.env?.["XDG_DATA_HOME"], xdgDataHome, label);
        assertEquals(
          Deno.statSync(join(xdgDataHome, "omp")).isDirectory,
          true,
          `native data dir must exist: ${xdgDataHome}/omp`,
        );

        // HOME is inherited normally (native model configuration) and no
        // generated settings plan or daemon-owned home rides the launch.
        assertEquals(assembled.env?.["HOME"], Deno.env.get("HOME"), label);
        assertEquals(assembled.env?.["PI_CODING_AGENT_DIR"], undefined, label);
        assertEquals(assembled.env?.["settingsSourcePlan"], undefined, label);

        assertEquals(
          assembled.env?.["TMPDIR"],
          poolArgument !== undefined
            ? resolve(join(repoPath, "channel-tmp", poolKey))
            : `${workingDir}/tmp`,
          label,
        );

        const mounts = assembled.runtimeMounts;
        assert(mounts !== undefined, `${label}: runtime mounts must be declared`);
        assertEquals(mounts!.writableRuntimePaths, [resolve(join(xdgDataHome, "omp"))], label);
        // The per-spawn mode parent is shadowed so the sibling mode's native
        // data under the writable session TMPDIR is not exposed; a pooled pool
        // root is not bound at all, so no shadow is needed (or attempted).
        assertEquals(
          mounts!.shadowedPaths,
          poolArgument === undefined ? [resolve(join(expectedBaseRoot, "omp-agent"))] : [],
          label,
        );
        const readOnly = mounts!.readOnlyPaths ?? [];
        assert(readOnly.includes(settingsPath), `${label}: settings must be mounted read-only`);
        assert(readOnly.includes(promptPath), `${label}: prompt must be mounted read-only`);
        if (homeModelsPath !== undefined) {
          assert(
            readOnly.includes(homeModelsPath),
            `${label}: inherited models.yml must be mounted read-only`,
          );
        }
        if (restricted) {
          assert(readOnly.includes(bundlePath), `${label}: bundle must be mounted read-only`);
        } else {
          assertEquals(readOnly.includes(bundlePath), false, label);
        }

        // Pooled processes carry the shared-process marker and freeze no
        // single session id; per-spawn processes carry the session id.
        if (poolArgument !== undefined) {
          assertEquals(assembled.env?.["SKILL_SHARED_PROCESS"], "1", label);
          assertEquals(assembled.env?.["SESSION_ID"], undefined, label);
        } else {
          assertEquals(assembled.env?.["SKILL_SHARED_PROCESS"], undefined, label);
          assertEquals(assembled.env?.["SESSION_ID"], sessionId, label);
        }
      }
    }

    // The two modes never share a native data root for the same spawn shape.
    assertEquals(
      ompXdgDataHome(resolve(join(workingDir, "tmp")), "restricted") !==
        ompXdgDataHome(resolve(join(workingDir, "tmp")), "native-yolo"),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
