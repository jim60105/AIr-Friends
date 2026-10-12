// tests/acp/opencode-lsp-permission.test.ts
//
// Consumer-visible wiring evidence for decision 5's OpenCode carriers
// (`disable-restricted-agent-lsp`, batch row 17): agent-config/opencode.json
// explicitly denies the `lsp` tool per agent in BOTH `build` and `yolo`,
// without any top-level/global LSP clamp, preserving the unrelated
// permissions exactly as they landed from numbered row 15
// (`harden-acp-command-path-gate`).
//
// These are permission-map wiring tests ONLY. An explicit per-agent tool
// denial stops the `lsp` tool's own permission ask; it does NOT establish
// suppression of OpenCode's automatic diagnostics/LSP server startup, whose
// per-agent scoping remains recorded `incompatible` at the pinned
// 1.18.21 tree (docs/OMP_COMPATIBILITY.md boundary 5b). No assertion here —
// and none permitted — certifies native implicit-startup suppression, and
// OpenCode stays pinned at 1.18.21 (no version bump).

import { assertEquals, assertNotEquals } from "@std/assert";
import { PINNED_OPENCODE_VERSION } from "../../src/acp/omp/compatibility-contracts.ts";

interface OpenCodeConfigShape {
  readonly [key: string]: unknown;
  readonly agent?: Record<string, { permission?: Record<string, unknown> }>;
}

async function loadConfig(): Promise<OpenCodeConfigShape> {
  const filePath = new URL("../../agent-config/opencode.json", import.meta.url).pathname;
  return JSON.parse(await Deno.readTextFile(filePath)) as OpenCodeConfigShape;
}

/**
 * The unrelated `build` permission posture exactly as landed from numbered
 * row 15 (`harden-acp-command-path-gate`), which precedes this row on the
 * shared file. Row 17 intentionally changes ONLY the `lsp` entry (allow →
 * deny) in this map; every other entry is pinned here so a later edit that
 * silently relaxes or tightens a predecessor grant fails this suite.
 *
 * `unify-omp-skill-root-resolution` D6 intentionally rewrites the `bash` map's
 * skill-script entries: the two `*skills/*/scripts/*.ts*`-style `allow` routes
 * (which let the native agent run skill scripts WITHOUT the ACP permission
 * layer) are removed, replaced by the routing-only `deno run *` / `*.ts*`
 * `ask` entries that carry every script invocation — including custom
 * deployment roots — into the ACP gate. That landed revision of the `bash`
 * map below is the new pinned posture.
 */
const ROW15_LANDED_BUILD_PERMISSIONS_EXCEPT_LSP: Record<string, unknown> = {
  "*": "deny",
  read: "allow",
  list: "allow",
  glob: "allow",
  grep: "allow",
  todoread: "allow",
  todowrite: "allow",
  skill: "allow",
  webfetch: "allow",
  websearch: "allow",
  task: "deny",
  doom_loop: "deny",
  question: "deny",
  edit: "ask",
  bash: {
    "*": "deny",
    "||": "deny",
    "&&": "deny",
    "agent-browser *": "ask",
    "rg *": "ask",
    "cat *": "ask",
    "head *": "ask",
    "tail *": "ask",
    "ls *": "ask",
    "find *": "ask",
    "wc *": "ask",
    "file *": "ask",
    "tree *": "ask",
    "jq *": "ask",
    "bc *": "deny",
    "pdftotext *": "ask",
    "pdfinfo *": "ask",
    "pdfimages *": "ask",
    "pdftoppm *": "ask",
    "pandoc *": "ask",
    "exiftool *": "ask",
    "ffmpeg *": "ask",
    "ffprobe *": "ask",
    "magick *": "ask",
    "convert *": "ask",
    "identify *": "ask",
    "mogrify *": "ask",
    "unzip *": "ask",
    "zip *": "ask",
    "7zz *": "ask",
    "zola *": "deny",
    "echo *": "deny",
    "git *": "deny",
    "python *": "deny",
    "python3 *": "deny",
    "pip *": "deny",
    "pip3 *": "deny",
    "gcc *": "deny",
    "g++ *": "deny",
    "make *": "deny",
    "strace *": "deny",
    "mkdir *": "deny",
    "deno run *": "ask",
    "*.ts*": "ask"
  },
  external_directory: {
    "*": "deny",
    "~/.agents/skills/**": "allow",
    "/home/deno/.agents/skills/**": "allow",
    "/app/data/agent-workspace/**": "allow",
    "/app/data/workspaces/*/tmp/**": "allow",
  },
};

Deno.test("opencode config: build and yolo both explicitly deny the lsp tool per agent", async () => {
  const config = await loadConfig();
  const build = config.agent?.["build"]?.permission;
  const yolo = config.agent?.["yolo"]?.permission;
  assertEquals(typeof build, "object", "build agent permission map must exist");
  assertEquals(typeof yolo, "object", "yolo agent permission map must exist");
  // Explicit denies, not reliance on any default: build's default is deny but
  // the lsp entry must still name deny explicitly, and yolo's wildcard
  // default is allow, so its explicit entry is load-bearing.
  assertEquals(build!["lsp"], "deny");
  assertEquals(yolo!["lsp"], "deny");
  assertEquals(yolo!["*"], "allow", "yolo keeps its permissive wildcard default");
});

Deno.test("opencode config: no top-level or equivalent global LSP clamp", async () => {
  const config = await loadConfig();
  // Decision 5 forbids a global `lsp: false`-class clamp at the config root;
  // denial is per agent only.
  assertNotEquals(config["lsp"], false);
  assertEquals("lsp" in config, false, "no global lsp key at the config root");
  for (const [agentName, agent] of Object.entries(config.agent ?? {})) {
    // Clamp must live inside `permission`, never as an agent-level lsp key.
    assertEquals("lsp" in (agent as Record<string, unknown>), false, `agent ${agentName}`);
  }
});

Deno.test("opencode config: unrelated build permissions equal the row-15 landed baseline", async () => {
  const config = await loadConfig();
  const build = config.agent?.["build"]?.permission ?? {};
  const withoutLsp: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(build)) {
    if (key !== "lsp") withoutLsp[key] = value;
  }
  assertEquals(
    Object.keys(withoutLsp).sort(),
    Object.keys(ROW15_LANDED_BUILD_PERMISSIONS_EXCEPT_LSP).sort(),
    "row 17 may change only the lsp entry",
  );
  for (const [key, expected] of Object.entries(ROW15_LANDED_BUILD_PERMISSIONS_EXCEPT_LSP)) {
    assertEquals(withoutLsp[key], expected, `build.permission.${key}`);
  }
});

Deno.test("opencode config: yolo changes for the lsp denial only, never a byte-equality invariant", async () => {
  const config = await loadConfig();
  const yolo = config.agent?.["yolo"]?.permission ?? {};
  // Pre-batch yolo was exactly { "*": "allow" }. This change intentionally
  // ends local yolo-byte equality for the single lsp denial; every later
  // regression baseline (rows 23/24) compares against this post-row-17 file.
  assertEquals(Object.keys(yolo).sort(), ["*", "lsp"]);
  assertEquals(yolo["*"], "allow");
  assertEquals(yolo["lsp"], "deny");
});

Deno.test("opencode config: pinned OpenCode version remains 1.18.21 (decision-5 no-bump)", async () => {
  await loadConfig();
  assertEquals(PINNED_OPENCODE_VERSION, "1.18.21");
});
