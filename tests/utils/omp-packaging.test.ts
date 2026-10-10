// tests/utils/omp-packaging.test.ts
//
// Test evidence for `package-pinned-omp-runtime` (OMP batch row 20 / P8).
// Design §14/§15: this change's certification is Containerfile-parse,
// bundle-replay, manifest-fixture, and unit/mock assertions ONLY — no docker
// build, no download, and NEVER any `omp --version` execution lives here.
// Live image build/arch/binary acceptance is user-owned (§7 of
// docs/OMP_PACKAGING.md) and ships explicitly unverified.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  OMP_IMAGE_CONFIG_ROOT,
  OMP_IMAGE_EXTENSION_ROOT,
  OMP_IMAGE_PROMPT_PATH,
  OMP_IMAGE_ROOT,
  OMP_SYSTEM_PROMPT_MOUNT_PATH,
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
    path === `${OMP_IMAGE_EXTENSION_ROOT}/index.ts` ||
    path === `${OMP_IMAGE_CONFIG_ROOT}/restricted.yml` ||
    path === OMP_IMAGE_PROMPT_PATH;
  assertEquals(resolveOmpTrustedExtensionPath({ exists }), "/opt/air/omp/extension/index.ts");
  assertEquals(
    resolveOmpConfigPath("agent-config/omp/restricted.yml", { exists }),
    "/opt/air/omp/config/restricted.yml",
  );
});

Deno.test("omp-paths resolvers - dev fallback byte-identical when absent", () => {
  const exists = (_path: string) => false;
  assertEquals(resolveOmpTrustedExtensionPath({ exists }), OMP_TRUSTED_EXTENSION_PATH);
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
    await Deno.writeTextFile(`${imageExt}/index.ts`, "// fixture entry");
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
      `${imageExt}/index.ts`,
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
      OMP_TRUSTED_EXTENSION_PATH,
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
    // Header facts: version, serial composition, reserved 6th slot, recut invariant.
    assertStringIncludes(manifest, `OMP_VERSION=${PIN}`);
    assertStringIncludes(manifest, "12 -> 13 -> 14b -> 17 -> 18");
    assertStringIncludes(manifest, "RESERVED-BUT-UNCONSUMED");
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
  assertStringIncludes(doc, "reserved-but-unconsumed");
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

// --- 4.2/5.x Extension bundle replay (no docker, no download, no omp) --------

const EXPECTED_MIRROR_FILES = [
  "src/acp/destructive-policy.ts",
  "src/acp/filesystem-policy.ts",
  "src/acp/filesystem-roots.ts",
  "src/acp/omp-settings.ts",
  "src/acp/omp/approval-records.ts",
  "src/acp/omp/code-search-routes.ts",
  "src/acp/omp/compatibility-contracts.ts",
  "src/acp/omp/destructive-decision.ts",
  "src/acp/omp/destructive-validator.ts",
  "src/acp/omp/discovery-guard.ts",
  "src/acp/omp/extension/_daemon/mod.ts",
  "src/acp/omp/extension/bootstrap.ts",
  "src/acp/omp/extension/enforcement-error.ts",
  "src/acp/omp/extension/enforcement.ts",
  "src/acp/omp/extension/index.ts",
  "src/acp/omp/extension/read-replacement.ts",
  "src/acp/omp/extension/search-replacement.ts",
  "src/acp/omp/fetch-routes.ts",
  "src/acp/omp/fetch-transport.ts",
  "src/acp/omp/inventory-validator.ts",
  "src/acp/omp/lsp-validator.ts",
  "src/acp/omp/record-evaluator.ts",
  "src/acp/omp/search-routes.ts",
  "src/acp/omp/search-transport.ts",
  "src/acp/omp/tool-inventory.ts",
  "src/acp/omp/tool-provenance.ts",
  "src/acp/omp/transport-validator.ts",
  "src/utils/omp-paths.ts",
  "src/utils/ssrf.ts",
].sort();

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...await listFiles(path));
    else out.push(path);
  }
  return out;
}

Deno.test("extension bundle - replay produces the exact derived file set", async () => {
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    const command = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
      args: [repoRoot, `${target}/extension`, `${repoRoot}/deno.lock`],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));

    const files = (await listFiles(`${target}/extension`)).map((f) =>
      f.slice(`${target}/extension/`.length)
    ).sort();
    assertEquals(
      files,
      ["deno.json", "index.ts", ...EXPECTED_MIRROR_FILES.map((f) => `mirror/${f}`)].sort(),
    );
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - mirror copies are byte-identical to committed sources", async () => {
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    const command = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
      args: [repoRoot, `${target}/extension`, `${repoRoot}/deno.lock`],
      stdout: "piped",
      stderr: "piped",
    });
    assertEquals((await command.output()).code, 0);

    for (const rel of EXPECTED_MIRROR_FILES) {
      const source = await Deno.readFile(`${repoRoot}/${rel}`);
      const bundled = await Deno.readFile(`${target}/extension/mirror/${rel}`);
      assertEquals(
        new Uint8Array(bundled).length,
        new Uint8Array(source).length,
        `${rel} length parity`,
      );
      for (let i = 0; i < source.length; i++) {
        if (source[i] !== bundled[i]) {
          throw new Error(`${rel} differs at byte ${i}: content-faithfulness violated`);
        }
      }
    }
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - generated entry adapter is a pure re-export", async () => {
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    const command = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
      args: [repoRoot, `${target}/extension`, `${repoRoot}/deno.lock`],
      stdout: "piped",
      stderr: "piped",
    });
    assertEquals((await command.output()).code, 0);

    const entry = await Deno.readTextFile(`${target}/extension/index.ts`);
    assertStringIncludes(entry, `export * from "./mirror/${OMP_TRUSTED_EXTENSION_PATH}"`);
    assertStringIncludes(entry, `export { default } from "./mirror/${OMP_TRUSTED_EXTENSION_PATH}"`);
    // No logic beyond the re-export: only comments and the two export lines.
    const code = entry.split("\n").filter((line) =>
      line.trim() !== "" && !line.trimStart().startsWith("//")
    );
    assertEquals(code.length, 2);
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - load parity: bundle and dev entry fail closed identically", async () => {
  // The pinned pre-import-exclusion verdicts are unresolved (row 12), so BOTH
  // the dev entry and the replayed bundle fail closed at load with the same
  // discovery-gate error. Identical failure = byte-identical behavior proof
  // (content-faithfulness), without ever executing `omp`.
  // REWRITE CONDITION (recut-culture note for successors): when row 12's
  // pre-import-exclusion blocker is ever resolved, this test's fail-closed
  // assertions become a hard failure ON PURPOSE — rewrite it in that same
  // change to assert SUCCESSFUL-load parity (both loads return "loaded") with
  // the @std closure resolved inside the tree, per docs/OMP_PACKAGING.md §5's
  // external-trust asymmetry note.
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    const command = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
      args: [repoRoot, `${target}/extension`, `${repoRoot}/deno.lock`],
      stdout: "piped",
      stderr: "piped",
    });
    assertEquals((await command.output()).code, 0);

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
        `const r = await import("${target}/extension/index.ts").then(() => "loaded").catch((e) => String(e)); console.log(r)`,
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

Deno.test("extension bundle - barrel resolves inside the installed tree", async () => {
  // The image-mode face of the re-export barrel (_daemon/mod.ts) must load
  // from within the bundle: its value closure + the generated @std/* import
  // map resolve with no walk-out to the repo.
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    const command = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
      args: [repoRoot, `${target}/extension`, `${repoRoot}/deno.lock`],
      stdout: "piped",
      stderr: "piped",
    });
    assertEquals((await command.output()).code, 0);

    const importMap = JSON.parse(await Deno.readTextFile(`${target}/extension/deno.json`));
    assertEquals(typeof importMap.imports?.["@std/path"], "string");
    assert(importMap.imports["@std/path"].includes("@std/path@"), "pinned version URL");

    const load = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `const m = await import("${target}/extension/mirror/src/acp/omp/extension/_daemon/mod.ts"); console.log(Object.keys(m).sort().join(","))`,
      ],
      stdout: "piped",
      stderr: "piped",
      cwd: repoRoot,
    });
    const result = await load.output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const exports = new TextDecoder().decode(result.stdout).trim().split(",");
    // Value exports spanning the serial siblings (rows 12/14a/14b/19/20/21
    // pure modules behind the barrel) resolve inside the installed tree.
    for (
      const expected of [
        "evaluateToolProvenance",
        "interpretApprovalRecords",
        "decideDestructiveIntent",
        "decideFetchHop",
        "buildGeminiSearchRequest",
        "CODE_SEARCH_ROUTE_TABLE",
      ]
    ) {
      assert(exports.includes(expected), `barrel exports ${expected}: ${exports.join(",")}`);
    }
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});

Deno.test("extension bundle - type-only daemon modules are NOT installed", async () => {
  // code-search-transport.ts is type-only-referenced (its closure note pins
  // it out of the installed set); the loader erases type-only imports and the
  // completeness gate passes without it. The /app daemon surface behind
  // client.ts TYPES (client.ts, types.ts, filesystem-access.ts) is likewise
  // never an installed input. Explicit non-installation claim asserted at each
  // module's real repo-relative path under mirror/.
  const target = await Deno.makeTempDir({ prefix: "omp-bundle-" });
  try {
    const command = new Deno.Command(`${repoRoot}/scripts/omp/bundle-omp-extension.sh`, {
      args: [repoRoot, `${target}/extension`, `${repoRoot}/deno.lock`],
      stdout: "piped",
      stderr: "piped",
    });
    assertEquals((await command.output()).code, 0);
    for (
      const excluded of [
        "src/acp/omp/code-search-transport.ts",
        "src/acp/client.ts",
        "src/acp/types.ts",
        "src/acp/filesystem-access.ts",
      ]
    ) {
      let exists = true;
      try {
        await Deno.stat(`${target}/extension/mirror/${excluded}`);
      } catch {
        exists = false;
      }
      assertEquals(exists, false, `${excluded} stays out of the owned tree`);
    }
  } finally {
    await Deno.remove(target, { recursive: true });
  }
});
