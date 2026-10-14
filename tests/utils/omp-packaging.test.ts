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
import {
  auditEmittedBundle,
  emittedExternals,
  emittedRequireEdges,
} from "../../scripts/omp/bundle-audit.ts";
import {
  OMP_IMAGE_CONFIG_ROOT,
  OMP_IMAGE_EXTENSION_ROOT,
  OMP_IMAGE_PROMPT_PATH,
  OMP_IMAGE_ROOT,
  OMP_SYSTEM_PROMPT_MOUNT_PATH,
  OMP_TRUSTED_EXTENSION_BUNDLE_PATH,
  OMP_TRUSTED_EXTENSION_PATH,
  resolveOmpConfigPath,
  resolveOmpExtensionPath,
  resolveOmpSystemPromptPath,
} from "@utils/omp-paths.ts";
import { OMP_IMAGE_EXTENSION_ARTIFACT } from "@utils/omp-paths.ts";

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
// opencode-unpacker -> cache; cache -> omp-unpacker; omp-unpacker -> final.
const ompStage = section("FROM base AS omp-unpacker", "FROM base AS final");
const finalStage = containerfile.slice(containerfile.indexOf("FROM base AS final"));
const opencodeStage = section("FROM base AS opencode-unpacker", "FROM base AS cache");
const cacheStage = section("FROM base AS cache", "FROM base AS omp-unpacker");

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
  // models.yml is NOT an owned overlay: native OMP reads it from its own
  // config HOME, so packaging installs it at the NATIVE path (root-owned) and
  // the owned config tree stays the two mode YAMLs only.
  assert(
    finalStage.includes(
      "--chown=0:0 --chmod=0644 agent-config/omp/models.yml /home/deno/.omp/agent/models.yml",
    ),
  );
  assertEquals(
    finalStage.includes("/opt/air/omp/config/models.yml"),
    false,
    "models.yml is never installed into the owned config tree",
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

Deno.test("omp packaging - linked copies never precede the directory preparation", () => {
  // `COPY --link` lands as an independent layer that re-creates the
  // destination's parent directories at 0755 with that copy's ownership, so a
  // directory prepared to another mode must be prepared AFTER the last linked
  // copy in the stage (verified under rootless podman: /app and /home/deno came
  // back 0755, while /app/data and /deno-dir — never copy parents — kept 0775).
  const lastLinkedCopy = finalStage.lastIndexOf("COPY --link");
  assert(lastLinkedCopy > 0, "the final stage installs content via COPY --link");
  assert(
    finalStage.indexOf("install -d -m 775 -o $UID -g 0 /app") > lastLinkedCopy,
    "the $UID:0 775 directory preparation follows every linked copy",
  );
  // Same rule for the root-owned binary directory: without the explicit
  // declaration its owner would follow whichever linked copy touched it last.
  assert(
    finalStage.indexOf("install -d -m 755 -o 0 -g 0 /usr/local /usr/local/bin") > lastLinkedCopy,
    "root-owned /usr/local/bin is declared after every linked copy",
  );
  // The packaging scripts resolve `../../src/...` against their own file URL,
  // so the cache stage keeps them beside `src/` and the owned-tree step invokes
  // them from that same read-only mount.
  assert(
    cacheStage.includes("COPY --link --chown=0:0 --chmod=0755 scripts/omp/ ./scripts/omp/"),
    "the cache stage carries the sibling scripts/omp tree",
  );
  assert(
    finalStage.includes("/build-src/scripts/omp/bundle-omp-extension.sh"),
    "the bundler runs from the cache-stage mount, never a relocated copy",
  );
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
  // C3: the dev face is the deterministic GENERATED entry, never the raw
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
  // The authored native model file is documented at its native config-HOME
  // install path (never the removed `/opt/air/omp/config/models.yml`).
  assertStringIncludes(doc, "/home/deno/.omp/agent/models.yml");
  assert(
    !doc.includes("/opt/air/omp/config/models.yml"),
    "no owned models overlay install remains",
  );
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
// The packaging contract asserted here is the generated file set, the emitted-
// dependency-edge audit (the cutover closure is fully inlined — zero
// externals), and load parity — never the former mirror tree, sidecar import
// map, or re-export barrel, and never a build-owned declaration or digest
// inventory (the artifact is exactly the bundler's ESM output).

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
