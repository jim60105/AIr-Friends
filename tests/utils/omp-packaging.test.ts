// tests/utils/omp-packaging.test.ts
//
// Test evidence for `package-pinned-omp-runtime` (OMP batch row 20 / P8).
// Design §14/§15: this change's certification is Containerfile-parse,
// bundle-replay, manifest-fixture, and unit/mock assertions ONLY — no docker
// build, no download, and NEVER any `omp --version` execution lives here.
// Live image build/arch/binary acceptance is user-owned (§7 of
// docs/OMP_PACKAGING.md) and ships explicitly unverified.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// The generated-bundle audit predicate is imported from its production
// module — tests exercise the EXACT function the bundler runs, never a
// re-typed copy.
import { auditEmittedBundle, emittedExternals } from "../../scripts/omp/bundle-audit.ts";
import {
  OMP_IMAGE_CONFIG_ROOT,
  OMP_IMAGE_EXTENSION_ROOT,
  OMP_IMAGE_PROMPT_PATH,
  OMP_IMAGE_ROOT,
  OMP_SYSTEM_PROMPT_MOUNT_PATH,
  OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
  OMP_TRUSTED_EXTENSION_PATH,
  resolveOmpConfigPath,
  resolveOmpSystemPromptPath,
  resolveOmpTrustedExtensionPath,
} from "@utils/omp-paths.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const containerfile = await Deno.readTextFile(`${repoRoot}/Containerfile`);

// The digest table transcribed verbatim from design §12 (strings, not
// hashes-of-hashes; task 1.1 byte-equality).
const PIN = "18.6.1";
const DIGESTS = {
  OMP_SHA256_X64: "c92a6846d02984e84f07c6362d18add3783f528f494ffcf1e0f26e594f327463",
  OMP_SHA256_ARM64: "cb7815330bb117877e4e133562ea82e3001ee470e47393552507b5a7f0407f4a",
  OMP_LICENSE_SHA256: "16c45f9d667442781f03fa198914cc39abcaa48ec5ed8f644643e554ca2fbf63",
  OMP_NOTICES_SHA256: "d0c2e7c05bb4d755044b13fa560be58d01ab7c980b87892400a979397e569a8b",
} as const;

// --- Containerfile section extraction -------------------------------------

function section(start: string, end: string): string {
  // Anchored on FROM lines (with a leading newline) so no future instruction
  // placed before the stage comment can silently enter a slice.
  const a = containerfile.indexOf(`\n${start}`);
  const b = containerfile.indexOf(`\n${end}`, a);
  assert(a >= 0, `section start not found: ${start}`);
  assert(b > a, `section end not found after start: ${end}`);
  return containerfile.slice(a, b);
}

// Stage slices are delimited by the NEXT stage's FROM line:
// opencode-unpacker -> cache; omp-unpacker -> final.
const ompStage = section("FROM base AS omp-unpacker", "FROM base AS final");
const finalStage = containerfile.slice(containerfile.indexOf("FROM base AS final"));
const opencodeStage = section("FROM base AS opencode-unpacker", "FROM base AS cache");

// --- 4.1 Containerfile-parse assertions ------------------------------------

Deno.test("omp packaging - omp-unpacker stage exists mirroring the opencode stage", () => {
  assert(/^FROM base AS omp-unpacker$/m.test(containerfile));
  // One stage per binary, same pattern as OpenCode.
  assert(/^FROM base AS opencode-unpacker$/m.test(containerfile));
});

Deno.test("omp packaging - ARG defaults byte-equal to the design table", () => {
  assertEquals(containerfile.includes(`ARG OMP_VERSION=${PIN}`), true);
  for (const [name, digest] of Object.entries(DIGESTS)) {
    assertEquals(
      containerfile.includes(`ARG ${name}=${digest}`),
      true,
      `${name} digest byte-equal to design §12`,
    );
  }
});

Deno.test("omp packaging - arch mapping branches with fail-fast default", () => {
  assert(ompStage.includes('amd64) OMP_ARCH="x64"; OMP_SHA256="${OMP_SHA256_X64}"'));
  assert(ompStage.includes('arm64) OMP_ARCH="arm64"; OMP_SHA256="${OMP_SHA256_ARM64}"'));
  assert(
    ompStage.includes('*) echo "unsupported architecture: ${TARGETARCH}" && exit 1'),
    "fail-fast branch on unknown TARGETARCH",
  );
});

Deno.test("omp packaging - asset allowlist rule: unique match within the exact tag", () => {
  // Selection scoped to the exact v${OMP_VERSION} release listing...
  assert(ompStage.includes("releases/tags/v${OMP_VERSION}"));
  // ...by the D2 allowlist regex...
  assert(ompStage.includes('grep -E "^omp-linux-${OMP_ARCH}[^/]*$"'));
  // ...with zero-or-many matches failing the build naming the count.
  assert(ompStage.includes(`if [ "\${count}" != "1" ]`));
  assert(ompStage.includes("expected exactly 1 asset match, found ${count}"));
  // Downloads bind to the SAME listing response that enforced uniqueness.
  assert(ompStage.includes("browser_download_url"));
  // The observed asset name is recorded (stage comment) for the docs table.
  assertStringIncludes(ompStage, "Observed asset name");
  assertStringIncludes(ompStage, "omp-linux-x64");
});

Deno.test("omp packaging - every checksum verifies BEFORE any consumption", () => {
  // The unpacker verifies all three artifacts before any mv/install.
  const checkBin = ompStage.indexOf('echo "${OMP_SHA256}  /tmp/omp.bin" | sha256sum -c -');
  const checkLic = ompStage.indexOf('echo "${OMP_LICENSE_SHA256}  /tmp/LICENSE" | sha256sum -c -');
  const checkNot = ompStage.indexOf(
    'echo "${OMP_NOTICES_SHA256}  /tmp/THIRD-PARTY-NOTICES.txt" | sha256sum -c -',
  );
  const consumeBin = ompStage.indexOf("mv /tmp/omp.bin");
  const consumeLic = ompStage.indexOf("mv /tmp/LICENSE");
  const consumeNot = ompStage.indexOf("mv /tmp/THIRD-PARTY-NOTICES.txt");
  assert(checkBin >= 0 && checkLic >= 0 && checkNot >= 0, "all three checks present");
  assert(checkBin < consumeBin && checkLic < consumeLic && checkNot < consumeNot);
  // Final-stage consumption is COPY-only (no stage-2 download/install).
  assert(finalStage.includes("COPY --link --chown=0:0 --chmod=0755 --from=omp-unpacker"));
});

Deno.test("omp packaging - final-stage destinations and ownership contract", () => {
  // Binary: root-owned 0755 (deliberate divergence from $UID:0 775).
  assert(finalStage.includes("--from=omp-unpacker /omp/out/omp /usr/local/bin/omp"));
  assert(finalStage.includes("--chown=0:0 --chmod=0755 --from=omp-unpacker"));
  // Notices: new /licenses/omp/ subdir; the project's own /licenses/LICENSE untouched.
  assert(finalStage.includes("--from=omp-unpacker /omp/licenses/LICENSE /licenses/omp/LICENSE"));
  assert(
    finalStage.includes(
      "--from=omp-unpacker /omp/licenses/THIRD-PARTY-NOTICES.txt /licenses/omp/THIRD-PARTY-NOTICES.txt",
    ),
  );
  assert(finalStage.includes("COPY --link --chown=$UID:0 --chmod=775 LICENSE /licenses/LICENSE"));
  // Owned tree: root-owned dirs 0755...
  for (
    const dir of [
      "/opt/air/omp",
      "/opt/air/omp/config",
      "/opt/air/omp/prompt",
      "/opt/air/omp/extension",
    ]
  ) {
    assert(finalStage.includes(`install -d -m 755 -o 0 -g 0 ${dir}`), `owned dir ${dir}`);
  }
  // ...files 0644 root-owned.
  assert(
    finalStage.includes(
      "--chown=0:0 --chmod=0644 agent-config/omp/restricted.yml /opt/air/omp/config/restricted.yml",
    ),
  );
  assert(
    finalStage.includes(
      "--chown=0:0 --chmod=0644 agent-config/omp/native-yolo.yml /opt/air/omp/config/native-yolo.yml",
    ),
  );
  assert(
    finalStage.includes(
      "--chown=0:0 --chmod=0644 agent-config/omp/models.yml /opt/air/omp/config/models.yml",
    ),
  );
  assert(
    finalStage.includes(
      "--chown=0:0 --chmod=0644 prompts/system_prompt_override.md /opt/air/omp/prompt/SYSTEM.md",
    ),
  );
  // The owned tree appears under NONE of the agent-writable roots.
  for (const writable of ["/app/data", "/app/prompts", "/home/deno"]) {
    const ownedInstalls = finalStage
      .split("\n")
      .filter((line) => line.includes("/opt/air/omp"))
      .map((line) => (line.includes(writable) ? line : null))
      .filter((line): line is string => line !== null);
    assertEquals(ownedInstalls, [], `no /opt/air/omp install under agent-writable ${writable}`);
  }
});

Deno.test("omp packaging - bundle + manifest run inside the owned-tree step", () => {
  // The extension tree is produced by the bundler, the manifest by the
  // generator, both over the root-owned cache-stage sources, before USER.
  assert(
    finalStage.includes(
      "bundle-omp-extension.sh /build-src /opt/air/omp/extension /build-src/deno.lock",
    ),
  );
  assert(
    finalStage.includes(
      'generate-omp-manifest.sh /opt/air/omp "$(cat /opt/air-build/OMP_VERSION)"',
    ),
  );
  // The build consumes the cache stage's root-owned source copy, not the
  // agent-writable /app/src tree.
  assert(finalStage.includes("type=bind,from=cache,src=/app,target=/build-src"));
  // Manifest lands root-owned non-writable by the runtime user.
  assert(finalStage.includes("chmod 0644 /opt/air/omp/PACKAGE-MANIFEST.sha256"));
  // The staging scripts do not survive the build.
  assert(finalStage.includes("rm -rf /opt/air-build"));
});

Deno.test("omp packaging - no-new-Bun rule in the OMP steps", () => {
  // No JS/Bun runtime installation anywhere in the OMP stage or the owned-tree
  // install step. (The pre-existing denoland/deno base is pre-existing, not
  // proven absent — design D8's honest scoping of this assertion.)
  const stageNoComments = ompStage
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assertEquals(/\bbun\b/i.test(stageNoComments), false);
  const stepNoComments = finalStage
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assertEquals(/install[^\n]*\bbun\b/i.test(stepNoComments), false);
  assertEquals(/npm install[^\n]*\bbun\b/i.test(stepNoComments), false);
});

Deno.test("omp packaging - OpenCode sections byte-unchanged (recorded fixture)", () => {
  // Row 20 is additive: the OpenCode pin block and install lines are recorded
  // verbatim here; any drift fails this fixture.
  assertEquals(
    opencodeStage.includes(`ARG OPENCODE_VERSION=1.18.21`),
    true,
  );
  assertEquals(
    opencodeStage.includes(
      "ARG OPENCODE_SHA256_X64=d910c3ed7613bb5791a328904615d41cc25b7d3a6b470e3199ab0426a995b38a",
    ),
    true,
  );
  assertEquals(
    opencodeStage.includes(
      "ARG OPENCODE_SHA256_ARM64=d30d2cba74617f4e7b96e25563c9572ffe453f9eae70fc0df16286813537ee72",
    ),
    true,
  );
  assertEquals(
    opencodeStage.includes(
      'amd64) OC_ARCH="x64"; OC_SHA256="${OPENCODE_SHA256_X64}"',
    ),
    true,
  );
  // Its install destinations and config copy stay put.
  assert(
    finalStage.includes(
      "COPY --link --chown=$UID:0 --chmod=775 --from=opencode-unpacker /opencode/opencode /usr/local/bin/opencode",
    ),
  );
  assert(
    finalStage.includes(
      "COPY --link --chown=$UID:0 --chmod=775 agent-config/opencode.json /home/deno/.config/opencode/opencode.json",
    ),
  );
});

Deno.test("omp packaging - bump-deliberately comment mirrors the OpenCode stage", () => {
  assertStringIncludes(ompStage, "Bump deliberately");
  assertStringIncludes(ompStage, "NO download");
});

// --- 4.3 dev→image resolver assertions on fixture filesystems ---------------

Deno.test("omp-paths resolvers - image-first when the installed tree exists", () => {
  const exists = (path: string) =>
    path === `${OMP_IMAGE_EXTENSION_ROOT}/index.js` ||
    path === `${OMP_IMAGE_CONFIG_ROOT}/restricted.yml` ||
    path === OMP_IMAGE_PROMPT_PATH;
  assertEquals(resolveOmpTrustedExtensionPath({ exists }), "/opt/air/omp/extension/index.js");
  assertEquals(
    resolveOmpConfigPath("agent-config/omp/restricted.yml", { exists }),
    "/opt/air/omp/config/restricted.yml",
  );
});

Deno.test("omp-paths resolvers - dev fallback selects the generated bundle when absent", () => {
  const exists = (_path: string) => false;
  // C3: the dev face is the deterministic GENERATED entry, never the raw
  // Deno-only source tree (OMP_TRUSTED_EXTENSION_PATH stays the canonical
  // source origin, asserted separately below).
  assertEquals(
    resolveOmpTrustedExtensionPath({ exists }),
    OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
  );
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

Deno.test("omp-paths resolvers - operator prompt mount honored over the owned artifact", () => {
  // Mount exists, owned artifact exists: the mount wins (row 8 semantics).
  const both = (_path: string) => true;
  assertEquals(resolveOmpSystemPromptPath({ exists: both }), OMP_SYSTEM_PROMPT_MOUNT_PATH);
  // Mount absent, owned artifact exists: the owned artifact serves.
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
    // With the fixture tree: image branch.
    assertEquals(
      resolveOmpTrustedExtensionPath({ exists: imageExistsExt, imageExtensionRoot: `${imageExt}` }),
      `${imageExt}/index.js`,
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
      resolveOmpTrustedExtensionPath({ exists: real, imageExtensionRoot: missing }),
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

Deno.test("omp-paths constants - image roots never overlap agent-writable roots", () => {
  for (
    const constant of [
      OMP_IMAGE_ROOT,
      OMP_IMAGE_EXTENSION_ROOT,
      OMP_IMAGE_CONFIG_ROOT,
      OMP_IMAGE_PROMPT_PATH,
    ]
  ) {
    assertEquals(constant.startsWith("/opt/air/omp"), true);
    for (const writable of ["/app/data", "/app/prompts", "/home/deno"]) {
      assertEquals(constant.startsWith(writable), false, `${constant} under ${writable}`);
    }
  }
});

// --- 3.2/4.3 Manifest fixture ------------------------------------------------

Deno.test("manifest generator - per-file lines, header facts, recut invariant", async () => {
  const root = await Deno.makeTempDir({ prefix: "omp-manifest-fixture-" });
  try {
    await Deno.mkdir(`${root}/config`, { recursive: true });
    await Deno.mkdir(`${root}/prompt`, { recursive: true });
    await Deno.writeTextFile(`${root}/config/restricted.yml`, "a: 1\n");
    await Deno.writeTextFile(`${root}/prompt/SYSTEM.md`, "# prompt\n");
    await Deno.writeTextFile(`${root}/extension.txt`, "extension\n");
    const command = new Deno.Command(`${repoRoot}/scripts/omp/generate-omp-manifest.sh`, {
      args: [root, PIN],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));

    const manifest = await Deno.readTextFile(`${root}/PACKAGE-MANIFEST.sha256`);
    // Digest lines are `sha256  <path>` (two literal spaces; \x20 escapes dodge
    // the no-regex-spaces lint rule while matching the sha256sum format verbatim).
    const digestLines = manifest.split("\n").filter((line) => /^[0-9a-f]{64}\x20\x20/.test(line));
    // One line per installed file, relative paths, sorted; manifest excluded.
    assertEquals(
      digestLines.map((line) => line.split("  ")[1]).sort(),
      ["config/restricted.yml", "extension.txt", "prompt/SYSTEM.md"],
    );
    assertEquals(manifest.includes("PACKAGE-MANIFEST.sha256"), true, "header names the file");
    // Header facts: version, serial composition, recut invariant (the former
    // reserved-slot fact is asserted ABSENT below post-removal).
    assertStringIncludes(manifest, `OMP_VERSION=${PIN}`);
    assertStringIncludes(manifest, "12 -> 13 -> 14b -> 17 -> 18");
    // `remove-omp-public-code-search` removed the reserved slot; the header
    // records the composition without any reserved-slot claim.
    assert(
      !manifest.includes("RESERVED-BUT-UNCONSUMED"),
      "manifest header carries no reserved-slot claim",
    );
    // The recut-invariant statement inside the manifest itself.
    assertStringIncludes(manifest, "RECUT INVARIANT");

    // Digests are real: verify the file set with an independent check.
    const verify = new Deno.Command("sha256sum", {
      args: ["-c", "--ignore-missing", "PACKAGE-MANIFEST.sha256"],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    });
    const verified = await verify.output();
    assertEquals(verified.code, 0, new TextDecoder().decode(verified.stderr));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("docs/OMP_PACKAGING.md - recut invariant and digest table present", async () => {
  const doc = await Deno.readTextFile(`${repoRoot}/docs/OMP_PACKAGING.md`);
  assertStringIncludes(doc, "task-failure condition");
  assertStringIncludes(doc, "12 → 13 → 14b → 17 → 18");
  assert(!doc.includes("reserved-but-unconsumed"), "no reserved-slot claim remains in the doc");
  // Digest table byte-identical to the design table values.
  for (const digest of Object.values(DIGESTS)) {
    assertStringIncludes(doc, digest);
  }
  // Observed asset name and the allowlist rule are recorded.
  assertStringIncludes(doc, "omp-linux-x64");
  assertStringIncludes(doc, "omp-linux-{arch}[^/]*");
  // The user-owned §15 checklist is present and marked unverified.
  assertStringIncludes(doc, "NOT verified by CI");
  assertStringIncludes(doc, "omp --version");
});

// --- 5.1 Config-trio sync ----------------------------------------------------

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

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...await listFiles(path));
    else out.push(path);
  }
  return out;
}

// --- 4.2/5.x Generated native-loadable bundle (no docker, no download, no omp)
//
// `package-bun-compatible-omp-extension` REPLACED the mirror-copy + generated
// deno.json import-map packaging with ONE generated ESM bundle: the single
// <target>/index.js cut from canonical source and frozen-lock dependencies.
// The packaging contract asserted here is the generated file set, its digest
// inventory, the emitted-dependency-edge audit, and fail-closed load parity —
// never the former mirror tree, sidecar import map, or re-export barrel.

async function buildBundle(target: string): Promise<void> {
  const command = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
    args: [repoRoot, target, `${repoRoot}/deno.lock`],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - digest inventory names recomputed input digests", async () => {
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    await buildBundle(`${target}/extension`);
    const bundle = await Deno.readTextFile(`${target}/extension/index.js`);
    const header = bundle.split("\n").slice(0, 20).join("\n");
    assertStringIncludes(header, "Generated by scripts/omp/bundle-extension.ts");
    assertStringIncludes(header, "DO NOT EDIT");
    // Deterministic source/input digest inventory: canonical entry + lock.
    const entryBytes = await Deno.readFile(`${repoRoot}/src/acp/omp/extension/index.ts`);
    const lockBytes = new TextEncoder().encode(await Deno.readTextFile(`${repoRoot}/deno.lock`));
    assertStringIncludes(bundle, `entry sha256 ${await sha256Hex(entryBytes)}  `);
    assertStringIncludes(bundle, `lock sha256 ${await sha256Hex(lockBytes)}  deno.lock`);
    // The header claims the host-facade external and the no-pin posture
    // (docs/OMP_PACKAGING.md §5: an image-side npm pin would bypass the host).
    assertStringIncludes(header, "@sinclair/typebox");
    assertStringIncludes(header, "no npm: pin");
    // Provenance completeness: the locked @std/* closure is INLINED (non-
    // minified deno bundle provenance comments survive the transformation).
    assert(/\/\/ deno:https:\/\/jsr\.io\/@std\//.test(bundle), "inlined @std closure provenance");
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - emitted edges are exactly the host facade and native builtins", async () => {
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    await buildBundle(`${target}/extension`);
    const bundle = await Deno.readTextFile(`${target}/extension/index.js`);
    // Exact external set: the bare TypeBox host-facade import plus the
    // documented node: builtin the runtime-compatible DNS face uses. No
    // jsr:/npm:/https edge, no import-map alias, no unapproved bare package,
    // no non-inlined path edge survives the production audit.
    const externals = emittedExternals(bundle);
    assertEquals(externals, ["@sinclair/typebox", "node:dns/promises"]);
    assertEquals(auditEmittedBundle(bundle), []);
    // The canonical host-resolved spelling is retained — never npm: form.
    assert(bundle.includes(`from "@sinclair/typebox"`), "bare facade specifier");
    assertEquals(bundle.includes(`from "npm:@sinclair/typebox"`), false, "no npm: pin emitted");
    // TypeBox SUBPATHS are not host-remapped and must not appear.
    assertEquals(
      externals.some((spec) => spec.startsWith("@sinclair/typebox/")),
      false,
      "no typebox subpath edge",
    );
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("bundle audit - production predicate fails every edge class outside the boundary", () => {
  // The audit is exercised deterministically on synthetic bundle text (zero
  // network): every class the container-packaging requirement names SHALL
  // fail packaging BEFORE installation, and only the documented externals
  // SHALL pass.
  const cases: [string, string][] = [
    ["jsr:@std/text@1.0.0", "runtime-download edge (JSR/remote URL)"],
    ["https://esm.sh/left-pad", "runtime-download edge (JSR/remote URL)"],
    ["npm:left-pad@1.0.0", "npm: package edge"],
    ["@std/path", "import-map alias edge"],
    ["@acp/omp/fetch-transport.ts", "import-map alias edge"],
    ["left-pad", "unapproved bare package"],
    ["@sinclair/typebox/value", "unapproved bare package"],
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
  // The documented externals pass clean.
  assertEquals(
    auditEmittedBundle(
      `import { Type } from "@sinclair/typebox";\nimport * as dns from "node:dns/promises";\nconst b = await import("bun:sqlite");\nconsole.log(Type, dns, b);\n`,
    ),
    [],
  );
  // Dynamic import() literal edges are audited too.
  const dyn = auditEmittedBundle(
    `const m = await import("jsr:@std/toml@1.0.0");\nconsole.log(m);\n`,
  );
  assertEquals(dyn.length, 1);
  assertStringIncludes(dyn[0]!, "runtime-download edge");
});

Deno.test("extension bundle - load parity: generated entry and dev source fail closed identically", async () => {
  // The pinned pre-import-exclusion verdicts are unresolved (row 12), so BOTH
  // the dev canonical source and the generated bundle fail closed at load
  // with the same discovery-gate error. Identical failure = behavior parity
  // of the deterministic transformation, without ever executing `omp`.
  // REWRITE CONDITION (recut-culture note for successors): when row 12's
  // pre-import-exclusion blocker is ever resolved, this test's fail-closed
  // assertions become a hard failure ON PURPOSE — rewrite it in that same
  // change to assert SUCCESSFUL-load parity (both loads return "loaded"),
  // per docs/OMP_PACKAGING.md §5's external-trust asymmetry note.
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    await buildBundle(`${target}/extension`);
    const loadDev = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `const r = await import("${repoRoot}/src/acp/omp/extension/index.ts").then(() => "loaded").catch((e) => String(e)); console.log(r)`,
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: repoRoot,
    });
    const loadBundle = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `const r = await import("${target}/extension/index.js").then(() => "loaded").catch((e) => String(e)); console.log(r)`,
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

    // Neither silently "loads" (the gate must stay fail-closed in the image too).
    assertEquals(devText === "loaded", false, "dev entry expected to fail closed");
    assertEquals(bundleText === "loaded", false, "bundle expected to fail closed identically");
    // Same discovery-gate failure class (the pre-import exclusion blocker).
    assert(devText.includes("pre-import exclusion not established"), `dev: ${devText}`);
    assert(bundleText.includes("pre-import exclusion not established"), `bundle: ${bundleText}`);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - loads under a facade-only host with NO Deno import map", async () => {
  // Task 3.1's permanent core: the generated bundle must import through the
  // pinned host-facade contract alone. The fixture is a minimal Node-style
  // package exposing the Type builder surface the bundle calls (Object/
  // String/Number/Literal/Optional/Union) — the host, not an import map,
  // owns that resolution. Node availability is environment-dependent; the
  // test SKIP-PASSES with a notice when no node binary exists (the image
  // build never runs the unit suite, and no runtime is installed by C3).
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
  const fixture = await Deno.makeTempDir({ prefix: "omp-facade-" });
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    // The generated bundle is COPIED into the fixture tree: Node (and every
    // native loader) resolves bare specifiers upward from the MODULE's own
    // directory, so the fixture's node_modules/@sinclair/typebox stands in
    // for the host-facade remap only for a bundle that lives under the
    // fixture root.
    await buildBundle(`${target}/extension`);
    await Deno.mkdir(`${fixture}/ext`, { recursive: true });
    await Deno.copyFile(`${target}/extension/index.js`, `${fixture}/ext/index.js`);
    await Deno.mkdir(`${fixture}/node_modules/@sinclair/typebox`, { recursive: true });
    await Deno.writeTextFile(
      `${fixture}/package.json`,
      JSON.stringify({ name: "omp-facade-fixture", type: "module", private: true }) + "\n",
    );
    await Deno.writeTextFile(
      `${fixture}/node_modules/@sinclair/typebox/package.json`,
      JSON.stringify({
        name: "@sinclair/typebox",
        version: "0.0.0-fixture",
        type: "module",
        main: "index.js",
        exports: { ".": "./index.js" },
      }) + "\n",
    );
    await Deno.writeTextFile(
      `${fixture}/node_modules/@sinclair/typebox/index.js`,
      "export const Type = {\n" +
        "  Object: (s) => ({ kind: 'object', s }),\n" +
        "  String: () => ({ kind: 'string' }),\n" +
        "  Number: () => ({ kind: 'number' }),\n" +
        "  Literal: (v) => ({ kind: 'literal', v }),\n" +
        "  Optional: (s) => ({ kind: 'optional', s }),\n" +
        "  Union: (vs) => ({ kind: 'union', vs }),\n" +
        "};\n" +
        "console.log('FACADE-CALLED');\n",
    );
    await Deno.writeTextFile(
      `${fixture}/load.mjs`,
      `
const r = await import("./ext/index.js")
  .then((m) => "loaded:" + Object.keys(m).sort().join(","))
  .catch((e) => "threw:" + String(e).slice(0, 200));
console.log(r);
`,
    );
    // Node resolves the bundle's bare @sinclair/typebox edge by walking up
    // from the module file into the fixture's node_modules — the host
    // facade stand-in. No import map, no repo config, no network, no Deno.
    const load = await new Deno.Command("node", {
      args: ["load.mjs"],
      cwd: fixture,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const out = new TextDecoder().decode(load.stdout);
    const err = new TextDecoder().decode(load.stderr);
    // The bare @sinclair/typebox edge resolved to the FIXTURE facade (host
    // remap stand-in), so module bodies — the schema definitions included —
    // evaluated with no Deno global, no repo import map, and no download:
    // the discovery-gate throw is the identical fail-closed class as the
    // Deno-face load above. A facade resolution failure would name the
    // import instead of the discovery gate.
    assert(
      out.includes("FACADE-CALLED") || err.includes("FACADE-CALLED"),
      `facade host-resolved (stdout=${out} stderr=${err})`,
    );
    assert(
      out.includes("pre-import exclusion not established") ||
        err.includes("pre-import exclusion not established"),
      `bundle reached the discovery gate without Deno (stdout=${out} stderr=${err})`,
    );
    assertEquals(err.includes("@sinclair/typebox"), false, "facade never left unresolved");
  } finally {
    await Deno.remove(fixture, { recursive: true });
    await Deno.remove(target, { recursive: true });
  }
});
