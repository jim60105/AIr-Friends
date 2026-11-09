// tests/acp/opencode-skill-permission-routing.test.ts
//
// `unify-omp-skill-root-resolution` D6/5.3+5.7: the restricted OpenCode profile
// carries NO native skill-script execution allow. Skill invocations — including
// custom deployment roots and relative spellings — reach the ACP permission
// layer only, where the root-exact inventory decides. The YOLO profile is
// intentionally untouched.

import { assertEquals, assertExists } from "@std/assert";
import fsp from "node:fs/promises";
import { test } from "bun:test";

interface OpenCodeConfigShape {
  readonly agent?: Record<string, { permission?: Record<string, unknown> }>;
}

async function loadConfig(): Promise<OpenCodeConfigShape> {
  const filePath = new URL("../../agent-config/opencode.json", import.meta.url).pathname;
  return JSON.parse(await fsp.readFile(filePath, "utf8")) as OpenCodeConfigShape;
}

test("opencode restricted profile: no native skill-script execution allow survives", async () => {
  const config = await loadConfig();
  const bash = config.agent?.["build"]?.permission?.["bash"] as Record<string, string>;
  assertExists(bash, "build agent bash permission map must exist");
  for (const [pattern, mode] of Object.entries(bash)) {
    // No allow entry may name a skill script route: any `allow` pattern
    // containing a `skills`/`scripts`/`.ts` path segment would let OpenCode
    // execute a skill script natively, bypassing the ACP gate.
    if (mode !== "allow") continue;
    const mentionsScriptPath = pattern.includes("skills") || pattern.includes("scripts") ||
      pattern.includes(".ts");
    assertEquals(
      mentionsScriptPath,
      false,
      `restricted profile must not natively allow a skill-script pattern: "${pattern}"`,
    );
  }
});

test("opencode restricted profile: script invocations route to the ACP gate via ask", async () => {
  const config = await loadConfig();
  const bash = config.agent?.["build"]?.permission?.["bash"] as Record<string, string>;
  // The routing entries carry every `bun` spelling (`bun *`) into the ACP
  // permission request regardless of the configured root, and deny the
  // package runner outright (`bunx *`). Direct-script invocations
  // (`/custom/root/…` or relative `skills/…`) match `*.ts*`.
  assertEquals(bash["bun *"], "ask", "bun-launched scripts must route to ask");
  assertEquals(bash["bunx *"], "deny", "the package runner must be denied without a gate request");
  assertEquals(bash["*.ts*"], "ask", "direct TypeScript invocations must route to ask");
  assertEquals(bash["*"], "deny", "the wildcard default stays deny");
});

test("opencode yolo profile remains untouched by the skill-routing rewrite", async () => {
  const config = await loadConfig();
  const yolo = config.agent?.["yolo"]?.permission;
  assertExists(yolo);
  assertEquals(yolo!["*"], "allow", "yolo keeps its permissive wildcard default");
  assertEquals(yolo!["lsp"], "deny", "yolo keeps the explicit lsp denial");
  assertEquals(Object.keys(yolo!).sort(), ["*", "lsp"], "yolo permission map stays two entries");
});
