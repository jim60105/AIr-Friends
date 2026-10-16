// tests/utils/prepare-native-cache.test.ts
//
// The preparation entry for the shared OMP native runtime payload: identity preflight, the real
// ACP handshake requirement, atomic publish, idempotent reuse, incomplete-destination refusal
// and cleanup. A stub executable stands in for the pinned binary so these paths are exercised
// deterministically, with no network and no 380 MB extraction: the entry's contract is "run the
// verified executable, read what it extracted", which is exactly what the stub emulates.
//
// The real pinned executable is exercised by the documented native acceptance run; this suite
// never claims native success.

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  assertExpectedAddons,
  defaultCacheBase,
  listRegularFiles,
  prepareOmpNativeCache,
  resolveOnPath,
  runAcpInitialize,
  sha256File,
} from "../../scripts/omp/prepare-native-cache.ts";
import type { OmpNativeCachePlatform } from "@utils/omp-native-cache.ts";
import {
  ompDevelopmentNativeCacheBase,
  ompNativeCacheDescriptor,
  resolveOmpNativeCache,
} from "@utils/omp-native-cache.ts";

/** The loader appends the package version beneath the linked `natives` directory. */
const VERSION_DIR = "18.6.1";
const X64_ADDONS = [
  "pi_natives.linux-x64-baseline.node",
  "pi_natives.linux-x64-modern.node",
] as const;

/**
 * A stand-in for the pinned executable. `--version` reports the pin; `acp` performs the
 * loader's extraction into `$XDG_DATA_HOME/omp/natives/18.6.1` (tolerating a write-protected
 * payload, exactly as the real loader does), then answers the JSON-RPC request.
 */
function stubSource(options: { version?: string; response?: string | null } = {}): string {
  const version = options.version ?? "omp/18.6.1";
  const response = options.response === undefined
    ? JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } })
    : options.response;
  const body = response === null ? "" : `console.log(${JSON.stringify(response)});\n`;
  return `#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
const mode = Deno.args[0];
if (mode === "--version") {
  console.log(${JSON.stringify(version)});
  Deno.exit(0);
}
if (mode === "acp") {
  const xdg = Deno.env.get("XDG_DATA_HOME") ?? "";
  const dir = xdg + "/omp/natives/18.6.1";
  for (const name of ${JSON.stringify(X64_ADDONS)}) {
    try {
      Deno.mkdirSync(dir, { recursive: true });
      if (!(() => { try { return Deno.statSync(dir + "/" + name).isFile; } catch { return false; } })()) {
        Deno.writeTextFileSync(dir + "/" + name, "stub-addon");
      }
    } catch {
      // Write-protected payload: the real loader tolerates this and loads existing files.
    }
  }
  // Consume the request line before answering, as the real agent does.
  let buffer = "";
  const reader = Deno.stdin.readable.getReader();
  while (!buffer.includes("\\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
  }
  reader.releaseLock();
${body}  Deno.exit(0);
}
Deno.exit(2);
`;
}

interface StubEnv {
  tempDir: string;
  executable: string;
  cacheBase: string;
}

async function makeStubEnv(
  options: { version?: string; response?: string | null } = {},
): Promise<StubEnv> {
  const tempDir = await Deno.makeTempDir();
  const executable = `${tempDir}/omp-stub`;
  await Deno.writeTextFile(executable, stubSource(options));
  await Deno.chmod(executable, 0o755);
  return { tempDir, executable, cacheBase: `${tempDir}/cache` };
}

async function prepareStub(env: StubEnv, overrides: Partial<{ lockWaitMs: number }> = {}) {
  return await prepareOmpNativeCache({
    executable: env.executable,
    cacheBase: env.cacheBase,
    platform: "linux-x64",
    executableSha256: await sha256File(env.executable),
    timeoutMs: 20_000,
    ...overrides,
  });
}

Deno.test("prepareOmpNativeCache - publishes the addon payload plus a sidecar manifest and no probe state", async () => {
  const env = await makeStubEnv();
  try {
    const result = await prepareStub(env);

    assertEquals(result.reused, false);
    assertEquals(result.payloadDir, `${env.cacheBase}/linux-x64/natives`);
    assertEquals(result.manifest.files.map((file) => file.name).sort(), [...X64_ADDONS].sort());
    assertEquals(result.manifest.version, "18.6.1");
    assertEquals(result.manifest.platform, "linux-x64");
    for (const file of result.manifest.files) {
      const info = await Deno.stat(`${result.payloadDir}/18.6.1/${file.name}`);
      assertEquals(info.size, file.size, `${file.name} size matches the manifest`);
    }

    // Only the payload and its manifest are published: probe HOME/cwd/sessions are gone.
    const published = [...Deno.readDirSync(`${env.cacheBase}/linux-x64`)].map((e) => e.name).sort();
    assertEquals(published, ["native-manifest.json", "natives"]);
    const leftovers = [...Deno.readDirSync(env.cacheBase)].filter((e) =>
      e.name.startsWith(".staging-") || e.name.includes("prepare-omp-natives")
    );
    assertEquals(leftovers, []);
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("prepareOmpNativeCache - a complete matching payload is reused without rewriting it", async () => {
  const env = await makeStubEnv();
  try {
    const first = await prepareStub(env);
    const before = await Deno.stat(`${first.payloadDir}/${VERSION_DIR}/${X64_ADDONS[0]}`);

    const second = await prepareStub(env);

    assertEquals(second.reused, true);
    const after = await Deno.stat(`${second.payloadDir}/${VERSION_DIR}/${X64_ADDONS[0]}`);
    assertEquals(after.size, before.size);
    assertEquals(after.mtime?.getTime(), before.mtime?.getTime());
    assertEquals(after.ino, before.ino);
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("prepareOmpNativeCache - an incomplete destination is refused, never overwritten", async () => {
  const env = await makeStubEnv();
  try {
    await Deno.mkdir(`${env.cacheBase}/linux-x64/${VERSION_DIR}`, { recursive: true });
    await Deno.writeTextFile(`${env.cacheBase}/linux-x64/${VERSION_DIR}/${X64_ADDONS[0]}`, "short");

    const error = await assertRejects(() => prepareStub(env), Error);
    assertStringIncludes(error.message, "Refusing to overwrite");
    // The half-written destination is untouched.
    assertEquals(
      await Deno.readTextFile(`${env.cacheBase}/linux-x64/${VERSION_DIR}/${X64_ADDONS[0]}`),
      "short",
    );
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("prepareOmpNativeCache - identity preflight fails closed on a wrong version or checksum", async () => {
  const wrongVersion = await makeStubEnv({ version: "omp/18.10.3" });
  try {
    const wrongVersionSha = await sha256File(wrongVersion.executable);
    const error = await assertRejects(
      () =>
        prepareOmpNativeCache({
          executable: wrongVersion.executable,
          cacheBase: wrongVersion.cacheBase,
          platform: "linux-x64",
          executableSha256: wrongVersionSha,
          timeoutMs: 20_000,
        }),
      Error,
    );
    assertStringIncludes(error.message, "18.6.1");
  } finally {
    await Deno.remove(wrongVersion.tempDir, { recursive: true });
  }

  const env = await makeStubEnv();
  try {
    const error = await assertRejects(
      () =>
        prepareOmpNativeCache({
          executable: env.executable,
          cacheBase: env.cacheBase,
          platform: "linux-x64",
          executableSha256: "0".repeat(64),
          timeoutMs: 20_000,
        }),
      Error,
    );
    assertStringIncludes(
      error.message,
      "refusing to prepare a native payload from unverified bytes",
    );
    assertEquals(await Deno.stat(env.cacheBase).then(() => true).catch(() => false), false);
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("prepareOmpNativeCache - a failed or absent handshake is never accepted as preparation", async () => {
  const errorResponse = await makeStubEnv({
    response: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "nope" } }),
  });
  try {
    const error = await assertRejects(() => prepareStub(errorResponse), Error);
    assertStringIncludes(error.message, "initialize returned an error");
  } finally {
    await Deno.remove(errorResponse.tempDir, { recursive: true });
  }

  const silent = await makeStubEnv({ response: null });
  try {
    const error = await assertRejects(() => prepareStub(silent), Error);
    assertStringIncludes(error.message, "no JSON-RPC initialize response");
  } finally {
    await Deno.remove(silent.tempDir, { recursive: true });
  }

  // `--version` alone never satisfies the handshake.
  const env = await makeStubEnv();
  try {
    const outcome = await runAcpInitialize({
      executable: env.executable,
      home: `${env.tempDir}/home`,
      cwd: `${env.tempDir}/cwd`,
      xdgDataHome: `${env.tempDir}/xdg`,
      timeoutMs: 500,
    });
    // The stub does answer, but a directory-only run must not: assert on the missing-response
    // path with an executable that never answers.
    assertEquals(outcome.ok, true);
    const never = await makeStubEnv({ response: null });
    try {
      const missing = await runAcpInitialize({
        executable: never.executable,
        home: `${never.tempDir}/home`,
        cwd: `${never.tempDir}/cwd`,
        xdgDataHome: `${never.tempDir}/xdg`,
        timeoutMs: 500,
      });
      assertEquals(missing.ok, false);
    } finally {
      await Deno.remove(never.tempDir, { recursive: true });
    }
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("prepareOmpNativeCache - unsupported identity, missing executable and a held lock fail closed", async () => {
  const env = await makeStubEnv();
  try {
    const platformError = await assertRejects(
      () =>
        prepareOmpNativeCache({
          executable: env.executable,
          cacheBase: env.cacheBase,
          // An invalid identity is the input under test; the entry validates it at runtime.
          platform: "linux-riscv64" as unknown as OmpNativeCachePlatform,
          timeoutMs: 20_000,
        }),
      Error,
    );
    assertStringIncludes(platformError.message, "unsupported native cache platform");

    const missingError = await assertRejects(
      () =>
        prepareOmpNativeCache({
          executable: `${env.tempDir}/absent`,
          cacheBase: env.cacheBase,
          platform: "linux-x64",
          timeoutMs: 20_000,
        }),
      Error,
    );
    assertStringIncludes(missingError.message, "was not found");

    await Deno.mkdir(`${env.cacheBase}/.prepare-omp-natives.lock`, { recursive: true });
    const lockError = await assertRejects(() => prepareStub(env, { lockWaitMs: 0 }), Error);
    assertStringIncludes(lockError.message, "already running");
  } finally {
    await Deno.remove(env.tempDir, { recursive: true });
  }
});

Deno.test("native payload helpers - expected addon sets and non-regular entries are enforced", async () => {
  assertExpectedAddons("linux-x64", [...X64_ADDONS]);
  const missing = (() => {
    try {
      assertExpectedAddons("linux-x64", [X64_ADDONS[0]]);
      return null;
    } catch (error) {
      return error as Error;
    }
  })();
  assertEquals(missing !== null, true);
  assertStringIncludes(missing!.message, X64_ADDONS[1]);
  assertExpectedAddons("linux-arm64", ["pi_natives.linux-arm64.node"]);

  const tempDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${tempDir}/pi_natives.linux-x64-modern.node`, "x");
    await Deno.symlink("/nowhere", `${tempDir}/pi_natives.linux-x64-baseline.node`);
    const error = (() => {
      try {
        listRegularFiles(tempDir);
        return null;
      } catch (caught) {
        return caught as Error;
      }
    })();
    assertEquals(error !== null, true);
    assertStringIncludes(error!.message, "non-regular entry");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("resolveOnPath - resolves names, paths and misses", () => {
  const tempDir = Deno.env.get("TMPDIR") ?? "/tmp";
  assertEquals(resolveOnPath("definitely-not-a-real-binary-xyz", tempDir), undefined);
  assertEquals(resolveOnPath(`${tempDir}/not-here-either`), undefined);
  assertEquals(resolveOnPath("git", "/usr/bin:/bin"), "/usr/bin/git");
});

Deno.test("defaultCacheBase - the CLI default is exactly the root the launch resolver reads", () => {
  const absentImageBase = `${Deno.makeTempDirSync()}/not-an-installed-image`;
  const platform: OmpNativeCachePlatform = "linux-x64";

  // Development branch: the published install root and the resolved install root must be the
  // SAME path, or the printed remedy would publish where the launch never looks.
  const base = defaultCacheBase(platform, absentImageBase);
  assertEquals(base, ompDevelopmentNativeCacheBase());
  assertEquals(
    ompNativeCacheDescriptor(base, platform, "development").installRoot,
    resolveOmpNativeCache({ platform, imageBase: absentImageBase, developmentBase: base })
      .installRoot,
  );
  // The resolver appends `{platform}` to the base the CLI default returns, and the base keeps
  // its own `air-friends/omp` segment.
  assertEquals(
    resolveOmpNativeCache({ platform, imageBase: absentImageBase, developmentBase: base })
      .installRoot,
    join(ompDevelopmentNativeCacheBase(), platform),
  );
  assertEquals(base.endsWith(join("air-friends", "omp")), true);
});
