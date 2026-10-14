// tests/utils/omp-packaging.test.ts
//
// Behavior evidence for the OMP container installation
// (`simplify-omp-container-installation`).
//
// The evidence is exercised behavior, never a transcription of Containerfile
// text or of the digest table:
//   - the local-architecture image is really built, the build really fails
//     closed on a wrong executable checksum, and the built image really starts
//     the pinned native runtime against its authored mode settings (plus its
//     official notices, observed through the installed package).
//   - the generated trusted-extension bundle is really cut by the production
//     bundler and really loaded (standalone under node, and through the
//     delivered-artifact smoke suite).
//   - the dev→image path resolvers are exercised against fixture filesystems.
//
// The image scenarios SKIP with a notice when no `podman` binary exists, so a
// container-less checkout still runs the rest of the suite. A successful local
// build certifies the LOCAL architecture only; the other architecture stays
// user-owned (docs/OMP_PACKAGING.md §7).

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// The generated-bundle audit predicate is imported from its production
// module — tests exercise the EXACT function the bundler runs, never a
// re-typed copy.
import {
  auditEmittedBundle,
  emittedExternals,
  emittedRequireEdges,
} from "../../scripts/omp/bundle-audit.ts";
import {
  OMP_IMAGE_CONFIG_ROOT,
  OMP_IMAGE_EXTENSION_ARTIFACT,
  OMP_IMAGE_EXTENSION_ROOT,
  OMP_IMAGE_PROMPT_PATH,
  OMP_SYSTEM_PROMPT_MOUNT_PATH,
  OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
  OMP_TRUSTED_EXTENSION_PATH,
  resolveOmpConfigPath,
  resolveOmpExtensionPath,
  resolveOmpSystemPromptPath,
} from "@utils/omp-paths.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

// --- dev→image resolver behavior on fixture filesystems ---------------------

Deno.test("omp-paths resolvers - image-first when the installed tree exists", () => {
  const exists = (path: string) =>
    path === `${OMP_IMAGE_EXTENSION_ROOT}/index.js` ||
    path === `${OMP_IMAGE_CONFIG_ROOT}/restricted.yml` ||
    path === OMP_IMAGE_PROMPT_PATH;
  assertEquals(resolveOmpExtensionPath({ exists }), "/opt/air/omp/extension/index.js");
  // The image face is the FIXED contracted constant (no injectable root).
  assertEquals(resolveOmpExtensionPath({ exists }), OMP_IMAGE_EXTENSION_ARTIFACT);
  assertEquals(
    resolveOmpConfigPath("agent-config/omp/restricted.yml", { exists }),
    "/opt/air/omp/config/restricted.yml",
  );
});

Deno.test("omp-paths resolvers - dev fallback selects the generated bundle when absent", () => {
  const exists = (_path: string) => false;
  // The dev face is the deterministic GENERATED entry, never the raw
  // Deno-only source tree (OMP_TRUSTED_EXTENSION_PATH stays the canonical
  // source origin, asserted separately below).
  assertEquals(resolveOmpExtensionPath({ exists }), OMP_TRUSTED_EXTENSION_BUNDLE_PATH);
  assertEquals(OMP_TRUSTED_EXTENSION_BUNDLE_PATH, "build/omp-extension/index.js");
  assertEquals(OMP_TRUSTED_EXTENSION_PATH, "src/acp/omp/extension/index.ts");
  assertEquals(
    resolveOmpConfigPath("agent-config/omp/restricted.yml", { exists }),
    "agent-config/omp/restricted.yml",
  );
  assertEquals(
    resolveOmpConfigPath("agent-config/omp/models.yml", { exists }),
    "agent-config/omp/models.yml",
  );
  assertEquals(resolveOmpSystemPromptPath({ exists }), OMP_SYSTEM_PROMPT_MOUNT_PATH);
});

Deno.test("omp-paths resolvers - operator prompt mount honored over the installed artifact", () => {
  // Mount exists, installed artifact exists: the mount wins.
  const both = (_path: string) => true;
  assertEquals(resolveOmpSystemPromptPath({ exists: both }), OMP_SYSTEM_PROMPT_MOUNT_PATH);
  // Mount absent, installed artifact exists: the installed artifact serves.
  const onlyImage = (path: string) => path === OMP_IMAGE_PROMPT_PATH;
  assertEquals(resolveOmpSystemPromptPath({ exists: onlyImage }), OMP_IMAGE_PROMPT_PATH);
});

Deno.test("omp-paths resolvers - fixture roots exercise both branches end-to-end", async () => {
  const root = await Deno.makeTempDir({ prefix: "omp-paths-fixture-" });
  try {
    const imageExt = `${root}/opt/air/omp/extension`;
    const imageCfg = `${root}/opt/air/omp/config`;
    await Deno.mkdir(imageExt, { recursive: true });
    await Deno.mkdir(imageCfg, { recursive: true });
    await Deno.writeTextFile(`${imageExt}/index.js`, "// fixture generated entry");
    await Deno.writeTextFile(`${imageCfg}/restricted.yml`, "# fixture overlay");
    const real = (path: string) => {
      try {
        return Deno.statSync(path).isFile;
      } catch {
        return false;
      }
    };
    const imageExistsExt = (path: string) => real(path.startsWith(root) ? path : `${root}${path}`);
    // With the fixture tree carrying the fixed image artifact: image branch.
    assertEquals(
      resolveOmpExtensionPath({ exists: imageExistsExt }),
      OMP_IMAGE_EXTENSION_ARTIFACT,
    );
    assertEquals(
      resolveOmpConfigPath("agent-config/omp/restricted.yml", {
        exists: imageExistsExt,
        imageConfigRoot: imageCfg,
      }),
      `${imageCfg}/restricted.yml`,
    );
    // Against a nonexistent tree: dev fallback verbatim.
    const missing = `${root}/nope`;
    assertEquals(
      resolveOmpExtensionPath({ exists: real }),
      OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
    );
    assertEquals(
      resolveOmpConfigPath("agent-config/omp/native-yolo.yml", {
        exists: real,
        imageConfigRoot: `${missing}/config`,
      }),
      "agent-config/omp/native-yolo.yml",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// --- Container image installation behavior ----------------------------------
//
// The one scenario that observes the real installation: build the
// local-architecture image, then exercise the installed runtime and its
// authored assets inside it. A wrong pinned executable checksum must fail the
// build BEFORE any image is installed, so bad download bytes can never become
// a runnable image.
//
// This scenario is an explicit OPT-IN (`OMP_PACKAGING_BUILD=1`), not a CI
// step: it builds a whole container image. CI runners do ship podman, so a
// presence check alone would turn every push into two full image builds with a
// different builder than the release pipeline uses.

const PIN = "18.6.1";
const IMAGE_TAG = "air-friends-omp-packaging-test";
const REJECTED_IMAGE_TAG = "air-friends-omp-packaging-test-bad-checksum";
const WRONG_EXECUTABLE_SHA256 = "0".repeat(64);
// The unpacker selects the per-architecture digest, so the deliberately wrong
// value must be injected through the ARCH-SPECIFIC build argument; on arm64 the
// x64 argument is inert and the build would wrongly succeed.
const EXECUTABLE_SHA256_ARG = Deno.build.arch === "aarch64" ? "OMP_SHA256_ARM64" : "OMP_SHA256_X64";
const ACP_INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  },
});

interface CommandOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run `podman`, capture everything, and kill it if it overruns the budget. */
async function podman(
  args: string[],
  options: { stdin?: string; timeoutMs?: number } = {},
): Promise<CommandOutcome> {
  const child = new Deno.Command("podman", {
    args,
    cwd: repoRoot,
    stdin: options.stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  // A kill deadline, not a duration guess: `podman build`/`run` have no
  // deterministic time control and an unresponsive container must not hang the
  // suite forever. The awaited condition is still the child's own exit.
  const killer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already exited: nothing to kill.
    }
  }, options.timeoutMs ?? 30 * 60_000);
  try {
    if (options.stdin !== undefined) {
      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(options.stdin));
      await writer.close();
    }
    const output = await child.output();
    const decoder = new TextDecoder();
    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } finally {
    clearTimeout(killer);
  }
}

async function havePodman(): Promise<boolean> {
  try {
    const probe = await new Deno.Command("podman", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return probe.code === 0;
  } catch {
    return false;
  }
}

// Opt-in (`OMP_PACKAGING_BUILD=1`) AND a usable podman, both required.
const RUN_IMAGE_SCENARIO = Deno.env.get("OMP_PACKAGING_BUILD") === "1" && await havePodman();

/** The JSON-RPC `initialize` result the pinned ACP server returns, if any. */
function acpInitializeResult(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.split("\n")) {
    if (!line.includes('"jsonrpc"')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null || !("result" in parsed)) continue;
      // The wire shape is a JSON-RPC result object; the calls below narrow it
      // field by field, so this one assertion stays a boundary conversion.
      const result = parsed.result as unknown;
      if (typeof result === "object" && result !== null) {
        return result as Record<string, unknown>;
      }
    } catch {
      // Not the response line; keep looking.
    }
  }
  return null;
}

Deno.test({
  name:
    "omp image packaging - the built image installs a runnable native runtime with its authored assets",
  ignore: !RUN_IMAGE_SCENARIO,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const build = await podman(["build", "-f", "Containerfile", "-t", IMAGE_TAG, "."]);
    assertEquals(build.code, 0, `image build failed:\n${build.stderr}\n${build.stdout}`);

    // The pinned native runtime loads and reports its exact pin.
    const version = await podman([
      "run",
      "--rm",
      "--entrypoint",
      "omp",
      IMAGE_TAG,
      "--version",
    ]);
    assertEquals(version.code, 0, `omp --version failed:\n${version.stderr}`);
    assertStringIncludes(version.stdout, PIN);

    // The native settings catalog is readable by the installed runtime.
    const catalog = await podman([
      "run",
      "--rm",
      "--entrypoint",
      "omp",
      IMAGE_TAG,
      "config",
      "list",
    ]);
    assertEquals(catalog.code, 0, `omp config list failed:\n${catalog.stderr}`);
    assert(catalog.stdout.trim().length > 0, "the native settings catalog is not empty");

    // Native ACP starts against the AUTHORED mode settings and prompt that the
    // image installs, and answers a real ACP initialize request.
    const acp = await podman([
      "run",
      "--rm",
      "-i",
      "--entrypoint",
      "omp",
      IMAGE_TAG,
      "acp",
      "--config",
      "/opt/air/omp/config/restricted.yml",
      "--system-prompt",
      "/opt/air/omp/prompt/SYSTEM.md",
    ], { stdin: `${ACP_INITIALIZE_REQUEST}\n`, timeoutMs: 120_000 });
    assertEquals(acp.code, 0, `native ACP startup failed:\n${acp.stderr}`);
    const initialized = acpInitializeResult(acp.stdout);
    assert(initialized !== null, `no ACP initialize result in:\n${acp.stdout}\n${acp.stderr}`);
    assertEquals(initialized.protocolVersion, 1);
    const agentInfo = initialized.agentInfo;
    assert(
      typeof agentInfo === "object" && agentInfo !== null && "version" in agentInfo,
      `no agentInfo.version in the ACP initialize result:\n${acp.stdout}`,
    );
    assertEquals(agentInfo.version, PIN, "the ACP agent answers with the pinned version");

    // Every installed artifact (authored settings, prompt, generated bundle,
    // native model file) and both official notices are readable and non-empty
    // INSIDE the built image, and no JavaScript/Bun runtime was added for it.
    const installed = await podman([
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      IMAGE_TAG,
      "-c",
      [
        "set -e",
        "for f in /opt/air/omp/config/restricted.yml" +
        " /opt/air/omp/config/native-yolo.yml" +
        " /opt/air/omp/prompt/SYSTEM.md" +
        " /opt/air/omp/extension/index.js" +
        " /home/deno/.omp/agent/models.yml" +
        " /licenses/omp/LICENSE" +
        " /licenses/omp/THIRD-PARTY-NOTICES.txt; do",
        '  test -s "$f" || { echo "missing or empty: $f" >&2; exit 1; }',
        "done",
        "for b in bun bunx; do",
        '  if command -v "$b" >/dev/null 2>&1; then echo "added runtime: $b" >&2; exit 1; fi',
        "done",
        "echo installed-ok",
      ].join("\n"),
    ]);
    assertEquals(installed.code, 0, `installed assets unreadable:\n${installed.stderr}`);
    assertStringIncludes(installed.stdout, "installed-ok");

    // Installing the authored YAML is permitted; GENERATING or REWRITING it is
    // not. A native startup must leave every authored input byte-identical.
    const authored = await podman([
      "run",
      "--rm",
      "-i",
      "-e",
      `ACP_INIT=${ACP_INITIALIZE_REQUEST}`,
      "--entrypoint",
      "sh",
      IMAGE_TAG,
      "-c",
      [
        "set -e",
        "files='/opt/air/omp/config/restricted.yml /opt/air/omp/config/native-yolo.yml" +
        " /opt/air/omp/prompt/SYSTEM.md /home/deno/.omp/agent/models.yml'",
        'before="$(sha256sum $files)"',
        "omp config list >/dev/null",
        "printf '%s\\n' \"$ACP_INIT\" | omp acp" +
        " --config /opt/air/omp/config/restricted.yml" +
        " --system-prompt /opt/air/omp/prompt/SYSTEM.md >/dev/null",
        'after="$(sha256sum $files)"',
        '[ "$before" = "$after" ] || { echo \'authored inputs were rewritten\' >&2; exit 1; }',
        "echo authored-inputs-unchanged",
      ].join("\n"),
    ], { timeoutMs: 180_000 });
    assertEquals(authored.code, 0, `authored inputs changed:\n${authored.stderr}`);
    assertStringIncludes(authored.stdout, "authored-inputs-unchanged");
  },
});

Deno.test({
  name:
    "omp image packaging - a wrong executable checksum fails the build before installing an image",
  ignore: !RUN_IMAGE_SCENARIO,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const build = await podman([
      "build",
      "--build-arg",
      `${EXECUTABLE_SHA256_ARG}=${WRONG_EXECUTABLE_SHA256}`,
      "-f",
      "Containerfile",
      "-t",
      REJECTED_IMAGE_TAG,
      ".",
    ]);
    assert(
      build.code !== 0,
      "the build must fail when the pinned executable checksum does not match the download",
    );
    // Fail for the RIGHT reason: the checksum step, not a later error.
    assert(
      /sha256sum|FAILED|does NOT match/.test(build.stdout + build.stderr),
      `the build failed without a checksum diagnostic:\n${build.stderr}\n${build.stdout}`,
    );
    // "Before output image installation": no image is produced by a failed build.
    const exists = await podman(["image", "exists", REJECTED_IMAGE_TAG]);
    assert(
      exists.code !== 0,
      "no image may be installed from a build that failed checksum verification",
    );
  },
});

// --- Config-trio documentation (version-health observability) ---------------

Deno.test("config trio - AGENT_OMP_MIN_VERSION documented (commented) in all three", async () => {
  const configExample = await Deno.readTextFile(`${repoRoot}/config.example.yaml`);
  const envExample = await Deno.readTextFile(`${repoRoot}/.env.example`);
  const helmValues = await Deno.readTextFile(`${repoRoot}/helm/values.yaml`);

  // Commented in all three (documentation only — no loader key, no chart field).
  for (
    const [name, text] of [
      ["config.example.yaml", configExample],
      [".env.example", envExample],
      ["helm/values.yaml", helmValues],
    ] as const
  ) {
    const lines = text.split("\n");
    const ompLines = lines.filter((line) => line.includes("AGENT_OMP_MIN_VERSION"));
    assertEquals(ompLines.length >= 1, true, `${name} documents AGENT_OMP_MIN_VERSION`);
    for (const line of ompLines) {
      const trimmed = line.trim();
      const commented = trimmed.startsWith("#") ||
        (name === "helm/values.yaml" && trimmed.startsWith("# AGENT_OMP_MIN_VERSION"));
      assertEquals(commented, true, `${name}: ${line} must stay commented`);
    }
  }

  // Exactly like the OpenCode counterpart: no other new field appears — the
  // OMP block sits beside the OpenCode one in each file.
  assertStringIncludes(configExample, "AGENT_OPENCODE_MIN_VERSION");
  assertStringIncludes(envExample, "AGENT_OPENCODE_MIN_VERSION");
  assertStringIncludes(helmValues, "AGENT_OPENCODE_MIN_VERSION");
  const helmEnvBlock = helmValues.slice(
    helmValues.indexOf("AGENT_OPENCODE_MIN_VERSION"),
    helmValues.indexOf("AGENT_OMP_MIN_VERSION"),
  );
  assert(helmEnvBlock.length < 1200, "OMP block adjacent to the OpenCode block in the env map");
});

// --- Generated native-loadable bundle (no docker, no download, no omp) -------
//
// `package-bun-compatible-omp-extension` REPLACED the mirror-copy + generated
// deno.json import-map packaging with ONE generated ESM bundle: the single
// <target>/index.js cut from canonical source and frozen-lock dependencies.
// The packaging contract asserted here is the generated file set, the emitted-
// dependency-edge audit (the cutover closure is fully inlined — zero
// externals), and load parity — never the former mirror tree, sidecar import
// map, or re-export barrel, and never a build-owned declaration or digest
// inventory (the artifact is exactly the bundler's ESM output).

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...await listFiles(path));
    else out.push(path);
  }
  return out;
}

async function buildBundle(target: string): Promise<void> {
  const command = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
    args: [repoRoot, target, `${repoRoot}/deno.lock`],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
}

Deno.test("extension bundle - replay produces the single generated native-loadable entry", async () => {
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    await buildBundle(`${target}/extension`);
    const files = (await listFiles(`${target}/extension`)).map((f) =>
      f.slice(`${target}/extension/`.length)
    ).sort();
    // ONE generated artifact: no mirror tree, no sidecar deno.json import map,
    // no generated adapter — the scaffolding removal IS the file-set equality.
    assertEquals(files, ["index.js"]);
    // The artifact is exactly the bundler's ESM output: no build-owned
    // deployment declaration placeholder survives, and no synthetic
    // input-digest header is prepended.
    const bundle = await Deno.readTextFile(`${target}/extension/index.js`);
    assertEquals(
      bundle.includes("@@OMP_CANONICAL_SOURCE_ROOT@@"),
      false,
      "no canonical-source placeholder survives",
    );
    assertEquals(
      bundle.includes("Generated by scripts/omp/bundle-extension.ts"),
      false,
      "no digest-inventory header is prepended",
    );
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - the extension closure is fully inlined (zero externals)", async () => {
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    await buildBundle(`${target}/extension`);
    const bundle = await Deno.readTextFile(`${target}/extension/index.js`);
    // The capability-admission closure imports nothing external: no jsr:/npm:/
    // https edge, no import-map alias, no unapproved bare package, no
    // non-inlined path edge, and no runtime `require` edge survives bundling.
    const externals = emittedExternals(bundle);
    assertEquals(externals, []);
    assertEquals(emittedRequireEdges(bundle), []);
    assertEquals(auditEmittedBundle(bundle), []);
    // Cross-line static clauses must not dodge the audit either: the
    // newline-tolerant window sees no specifier beyond the strict set.
    const loose = [...bundle.matchAll(
      /(?:^|[\s;}])(?:import|export)\b[^"']{0,400}?\bfrom\s*["']([^"']+)["']/g,
    )].map((m) => m[1]!);
    // The loose scan is per-occurrence; compare unique specifiers.
    assertEquals(
      [...new Set(loose)].sort(),
      externals,
      "loose cross-line scan agrees with the strict set",
    );
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("bundle audit - production predicate fails every edge class outside the boundary", () => {
  // The audit is exercised deterministically on synthetic bundle text (zero
  // network): every class the container-packaging requirement names SHALL
  // fail packaging BEFORE installation, and only documented native builtins
  // SHALL pass.
  const cases: [string, string][] = [
    ["jsr:@std/text@1.0.0", "runtime-download edge (JSR/remote URL)"],
    ["https://esm.sh/left-pad", "runtime-download edge (JSR/remote URL)"],
    ["npm:left-pad@1.0.0", "npm: package edge"],
    ["@std/path", "import-map alias edge"],
    ["@acp/omp/fetch-transport.ts", "import-map alias edge"],
    ["left-pad", "unapproved bare package"],
    ["./sibling.js", "non-inlined path edge"],
    ["/opt/air/abs.js", "non-inlined path edge"],
    ["file:///tmp/leak.js", "non-inlined path edge"],
  ];
  for (const [spec, cls] of cases) {
    const text = `import { x } from "${spec}";\nconsole.log(x);\n`;
    const problems = auditEmittedBundle(text);
    // Path edges carry both their class problem and the boundary problem —
    // every class is named at least once, and every edge is a problem.
    assert(problems.length >= 1, `${spec}: at least one problem`);
    assertEquals(
      problems.some((p) => p.includes(`(${cls})`)),
      true,
      `${spec}: class ${cls} named`,
    );
    assertStringIncludes(problems[0]!, spec);
  }
  // The documented native builtins pass clean.
  assertEquals(
    auditEmittedBundle(
      `import * as dns from "node:dns/promises";\nconst b = await import("bun:sqlite");\nconsole.log(dns, b);\n`,
    ),
    [],
  );
  // Dynamic import() literal edges are audited too.
  const dyn = auditEmittedBundle(
    `const m = await import("jsr:@std/toml@1.0.0");\nconsole.log(m);\n`,
  );
  assertEquals(dyn.length, 1);
  assertStringIncludes(dyn[0]!, "runtime-download edge");
  // Cross-line static import/export-from clauses fail the audit.
  const crossLine = auditEmittedBundle(
    `import {\n  a,\n  b,\n} from "jsr:@std/encoding@1.0.0";\nexport {\n  c,\n} from "left-pad";\nconsole.log(a, b, c);\n`,
  );
  assertEquals(crossLine.length, 2);
  assert(crossLine.some((p) => p.includes("jsr:@std/encoding@1.0.0")), "cross-line import named");
  assert(crossLine.some((p) => p.includes("left-pad")), "cross-line re-export named");
  // export-star / re-export forms fail the audit.
  const reExport = auditEmittedBundle(`export * from "npm:evil@1.0.0";\n`);
  assertEquals(reExport.length, 1);
  assertStringIncludes(reExport[0]!, "npm: package edge");
  // Non-static (template-literal) dynamic import specifiers cannot be
  // audited and fail closed.
  const computed = auditEmittedBundle(
    `const m = await import(\`jsr:@std/${"fs"}@1.0.0\`);\nconsole.log(m);\n`,
  );
  assertEquals(computed.length, 1);
  assertStringIncludes(computed[0]!, "non-static specifier");
  // Runtime require edges: literal and bundler-aliased globalThis.require
  // forms; only node:/bun: builtins pass.
  const reqBad = auditEmittedBundle(
    `const require2 = globalThis.require;\nconst j = require2("json-nothing");\nconst r = require("npm:evil");\nconsole.log(j, r);\n`,
  );
  assertEquals(reqBad.length, 2);
  assert(reqBad.some((p) => p.includes("json-nothing")), "aliased require named");
  assert(reqBad.some((p) => p.includes("npm:evil")), "literal require named");
  assertEquals(
    auditEmittedBundle(
      `const req = globalThis.require;\nconst fs = req("node:fs");\nconsole.log(fs);\n`,
    ),
    [],
    "aliased node: require passes clean",
  );
});

Deno.test("extension bundle - load parity: generated entry and dev source load identically", async () => {
  // The cutover extension is the small capability-admission closure with no
  // module-load bootstrap, discovery guard or host-facade edge: the dev
  // canonical source and the generated bundle evaluate to the SAME default
  // registration callback, without ever executing `omp`.
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    await buildBundle(`${target}/extension`);
    const loadDev = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `const r = await import("${repoRoot}/src/acp/omp/extension/index.ts").then((m) => "loaded:" + typeof m.default).catch((e) => "threw:" + String(e)); console.log(r)`,
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: repoRoot,
    });
    const loadBundle = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `const r = await import("${target}/extension/index.js").then((m) => "loaded:" + typeof m.default).catch((e) => "threw:" + String(e)); console.log(r)`,
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: repoRoot,
    });
    const [dev, bundled] = await Promise.all([loadDev.output(), loadBundle.output()]);
    assertEquals(dev.code, 0, new TextDecoder().decode(dev.stderr));
    assertEquals(bundled.code, 0, new TextDecoder().decode(bundled.stderr));
    const devText = new TextDecoder().decode(dev.stdout).trim();
    const bundleText = new TextDecoder().decode(bundled.stdout).trim();

    // Identical successful-load parity: both expose the default registration
    // function, so the deterministic transformation is behavior-preserving.
    assertEquals(devText, "loaded:function");
    assertEquals(bundleText, "loaded:function");
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - loads standalone under node with NO Deno import map", async () => {
  // The bundle is fully self-contained: no bare host facade, no import-map
  // alias, no Deno global. Node loads the copied artifact from an isolated
  // tree with no node_modules and no repo config, proving native-loadability
  // without the pinned host's resolution rules. Node availability is
  // environment-dependent; the test SKIP-PASSES with a notice when no node
  // binary exists (the image build never runs the unit suite).
  let haveNode = true;
  try {
    await new Deno.Command("node", { args: ["--version"], stdout: "null", stderr: "null" })
      .output();
  } catch {
    haveNode = false;
  }
  if (!haveNode) {
    console.warn("SKIP: no node binary — native-loader smoke is user-owned");
    return;
  }
  const fixture = await Deno.makeTempDir({ prefix: "omp-standalone-" });
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    // The generated bundle is COPIED into the fixture tree and loaded there:
    // no node_modules, no import map, no Deno — resolution has nowhere to go
    // but the bundle's own inlined closure.
    await buildBundle(`${target}/extension`);
    await Deno.mkdir(`${fixture}/ext`, { recursive: true });
    await Deno.copyFile(`${target}/extension/index.js`, `${fixture}/ext/index.js`);
    await Deno.writeTextFile(
      `${fixture}/package.json`,
      JSON.stringify({ name: "omp-standalone-fixture", type: "module", private: true }) + "\n",
    );
    await Deno.writeTextFile(
      `${fixture}/load.mjs`,
      `
const r = await import("./ext/index.js")
  .then((m) => "loaded:" + typeof m.default)
  .catch((e) => "threw:" + String(e).slice(0, 200));
console.log(r);
`,
    );
    const load = await new Deno.Command("node", {
      args: ["load.mjs"],
      cwd: fixture,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const out = new TextDecoder().decode(load.stdout);
    const err = new TextDecoder().decode(load.stderr);
    // The bundle evaluated with no Deno global, no repo import map and no
    // download: its default registration callback is live under a plain host.
    assert(
      out.includes("loaded:function"),
      `bundle loaded standalone (stdout=${out} stderr=${err})`,
    );
    // A missing external edge has its own unmistakable shape; it must never
    // appear — the closure is fully inlined.
    assert(
      !/Cannot find (package|module)/.test(out + err),
      "no bare specifier was left unresolved",
    );
  } finally {
    await Deno.remove(fixture, { recursive: true });
    await Deno.remove(target, { recursive: true });
  }
});
