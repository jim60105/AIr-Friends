/**
 * Generated-bundle / default-factory smoke
 * (`bind-omp-owned-module-evidence` task 3.2, duck finding 6).
 *
 * Every other suite binds `createNativeExtensionFactory` to injected deps. This
 * suite instead builds the REAL bundle at its DECLARED development path
 * (`<checkout>/build/omp-extension/index.js` — the artifact the embedded
 * declaration names), loads it in a CHILD PROCESS under the restricted launch
 * identity and drives its DEFAULT exported factory with an API-shaped roster.
 * That is the only way to exercise, together: the placeholder substitution, the
 * embedded declaration, `import.meta.url`, the production node:fs metadata
 * reader, the registration-time acceptance and the live re-observation.
 *
 * Assertions are about the DELIVERED ARTIFACT'S OWN wiring. Nothing here claims
 * the official host binary evaluates or honors the extension — that stays
 * user-owned runtime verification (docs/OMP_ENFORCEMENT.md §Checklist).
 */

import { assert, assertEquals } from "@std/assert";
import { OMP_TRUSTED_EXTENSION_BUNDLE_PATH } from "@utils/omp-paths.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const driverPath = `${repoRoot}/tests/mocks/omp-bundle-smoke-driver.ts`;

/** The declared DEVELOPMENT artifact path of THIS checkout. */
const declaredArtifactPath = `${await Deno.realPath(
  repoRoot,
)}/${OMP_TRUSTED_EXTENSION_BUNDLE_PATH}`;

interface SmokeResult {
  readonly registered: boolean;
  readonly mode: string;
  readonly registeredTools: readonly string[];
  readonly loadBlockers: number;
  readonly trustedRoots: readonly string[];
  readonly localRead: string;
  readonly urlRead: string;
  readonly webSearchNoBackend: string;
  readonly authenticBuiltin: string;
  readonly foreignSameName: string;
}

/**
 * Build the generated bundle at its declared path (the real packaging entry
 * point) and run the driver in a child process whose launch identity is a
 * restricted mode cwd with owned HOME / agent dir and NO API keys.
 */
async function runBundleSmoke(): Promise<SmokeResult> {
  const buildTarget = `${repoRoot}/${OMP_TRUSTED_EXTENSION_BUNDLE_PATH.replace(/\/[^/]+$/, "")}`;
  const build = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
    args: [repoRoot, buildTarget, `${repoRoot}/deno.lock`],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  });
  const buildOutput = await build.output();
  assertEquals(buildOutput.code, 0, new TextDecoder().decode(buildOutput.stderr));

  const stateBase = await Deno.makeTempDir({ prefix: "omp-bundle-smoke-state-" });
  try {
    const ownedHome = `${stateBase}/omp-agent/restricted/home`;
    const agentDir = `${stateBase}/omp-agent/restricted`;
    const launchCwd = `${stateBase}/omp-agent/restricted/cwd`;
    for (const dir of [ownedHome, launchCwd]) await Deno.mkdir(dir, { recursive: true });
    const runner = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        driverPath,
        `file://${declaredArtifactPath}`,
        declaredArtifactPath,
      ],
      cwd: launchCwd,
      // A CONTROLLED environment: the owned launch env the bootstrap validates
      // and deliberately NO search-provider credentials.
      env: { HOME: ownedHome, PI_CODING_AGENT_DIR: agentDir, PATH: "/usr/bin:/bin" },
      stdout: "piped",
      stderr: "piped",
    });
    const output = await runner.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, `driver failed:\n${stderr}\n${stdout}`);
    return JSON.parse(stdout) as SmokeResult;
  } finally {
    await Deno.remove(stateBase, { recursive: true });
  }
}

Deno.test({
  name:
    "bundle smoke: the delivered default factory admits owned replacements on REAL module evidence",
  fn: async () => {
    const result = await runBundleSmoke();

    // The restricted branch registered through the pinned native API.
    assertEquals(result.registered, true);
    assertEquals(result.mode, "restricted");
    assertEquals([...result.registeredTools].sort(), ["read", "web_search"]);
    // The load-time decision saw no blockers and reported the DECLARED
    // development artifact as its module trust root.
    assertEquals(result.loadBlockers, 0);
    assertEquals(result.trustedRoots, [declaredArtifactPath]);

    // Owned replacement admission on the real evidence: ordinary local read and
    // the controlled HTTP(S) URL branch both reach their completing boundary,
    // and an authentic builtin still proceeds — with NO session context, NO
    // injected module evidence and NO fixture declaration anywhere.
    assertEquals(result.localRead, "dispatch");
    assertEquals(result.urlRead, "dispatch");

    // web_search reaches the EXISTING backend/credential admission: with no
    // provider credentials present it keeps the bounded pending-adapter block
    // (never a native-provider fallback, never a provenance denial).
    assert(
      result.webSearchNoBackend.startsWith("block:"),
      `web_search must reach backend admission: ${result.webSearchNoBackend}`,
    );
    assert(
      result.webSearchNoBackend.includes("rejected_pending_adapter"),
      `expected the pending-adapter clamp, got: ${result.webSearchNoBackend}`,
    );
    assertEquals(result.authenticBuiltin, "dispatch");

    // A foreign same-name extension registration NEVER completes: the fresh
    // provenance read denies it before any transport.
    assert(result.foreignSameName.startsWith("block:"), result.foreignSameName);
    assert(
      result.foreignSameName.includes("rejected_tool_provenance"),
      result.foreignSameName,
    );
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
