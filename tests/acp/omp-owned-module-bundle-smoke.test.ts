/**
 * Generated-bundle / default-extension smoke (delivered-artifact dispatch).
 *
 * Every other suite imports the extension module source directly. This suite
 * instead builds the REAL bundle at its declared development path
 * (`<checkout>/build/omp-extension/index.js` — the artifact development launch
 * and image installation both consume), loads it in a CHILD PROCESS and drives
 * its DEFAULT exported extension with an API-shaped `tool_call` registration.
 * That is the only way to exercise the delivered artifact's own wiring: module
 * load without an import map, official-API registration, and the pre-dispatch
 * capability decision for mapped versus unmatched native tool names.
 *
 * Assertions are about the DELIVERED ARTIFACT'S OWN wiring. Nothing here claims
 * the official host binary evaluates or honors the extension — that stays
 * user-owned runtime verification (docs/agent/security-and-sandbox.md).
 */

import { assertEquals } from "@std/assert";
import { OMP_TRUSTED_EXTENSION_BUNDLE_PATH } from "@utils/omp-paths.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const driverPath = `${repoRoot}/tests/mocks/omp-bundle-smoke-driver.ts`;

/** The declared DEVELOPMENT artifact path of THIS checkout. */
const declaredArtifactPath = `${await Deno.realPath(
  repoRoot,
)}/${OMP_TRUSTED_EXTENSION_BUNDLE_PATH}`;

/** One dispatched call: the callback verdict plus the fixture operations it ran. */
interface SmokeCall {
  readonly outcome: string;
  readonly executed: number;
}

interface SmokeResult {
  readonly handlerCount: number;
  readonly read: SmokeCall;
  readonly grep: SmokeCall;
  readonly glob: SmokeCall;
  readonly find: SmokeCall;
  readonly todo: SmokeCall;
  readonly web_search: SmokeCall;
  readonly bash: SmokeCall;
  readonly edit: SmokeCall;
  readonly write: SmokeCall;
  readonly delete: SmokeCall;
  readonly move: SmokeCall;
  readonly unknownTool: SmokeCall;
  readonly protoName: SmokeCall;
  readonly toStringName: SmokeCall;
}

/** Build the generated bundle and run the driver against the delivered file. */
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

  const runner = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      driverPath,
      `file://${declaredArtifactPath}`,
    ],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await runner.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0, `driver failed:\n${stderr}\n${stdout}`);
  return JSON.parse(stdout) as SmokeResult;
}

Deno.test({
  name: "bundle smoke: the delivered extension dispatches mapped tools and blocks unmatched ones",
  fn: async () => {
    const result = await runBundleSmoke();

    // The default export registered exactly one pre-dispatch tool_call handler.
    assertEquals(result.handlerCount, 1);

    // Every mapped capability continues to its native path, and the fixture
    // dispatcher executes exactly one operation for each of them.
    for (
      const [name, call] of [
        ["read", result.read],
        ["grep", result.grep],
        ["glob", result.glob],
        ["find", result.find],
        ["todo", result.todo],
        ["web_search", result.web_search],
        ["bash", result.bash],
        ["edit", result.edit],
        ["write", result.write],
        ["delete", result.delete],
        ["move", result.move],
      ] as const
    ) {
      assertEquals(call.outcome, "dispatch", name);
      assertEquals(call.executed, 1, `${name} must execute exactly one operation`);
    }

    // Unmatched names never execute — including prototype-shaped names, which
    // the own-property membership check must treat as unknown.
    for (
      const [name, call] of [
        ["unknownTool", result.unknownTool],
        ["protoName", result.protoName],
        ["toStringName", result.toStringName],
      ] as const
    ) {
      assertEquals(call.outcome, "block", name);
      assertEquals(call.executed, 0, `${name} must execute no operation`);
    }
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
