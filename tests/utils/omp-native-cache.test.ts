// tests/utils/omp-native-cache.test.ts
//
// Focused unit coverage of the shared OMP native runtime cache
// (`src/utils/omp-native-cache.ts`) — the single source of truth for the prepared
// native payload that every pooled and per-spawn mode root consumes.
//
// Everything here runs against REAL temporary directories and REAL symlinks:
// identity resolution, the manifest contract, payload completeness, launch
// preflight agreement, link installation and the end-to-end root preparation.
// The pinned v18.6.1 payload bytes and the native acceptance legs are NOT
// exercised: this host has no pinned executable, so fixture payloads stand in
// for the prepared payload and no OMP process is ever spawned.

import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  assertOmpLaunchExecutableAgreement,
  assertOmpNativeCacheComplete,
  assertOmpNativeCacheLocationAllowed,
  installOmpNativeCacheLink,
  missingExpectedAddons,
  OMP_DEVELOPMENT_NATIVE_CACHE_RELATIVE,
  OMP_IMAGE_NATIVE_CACHE_ROOT,
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_LOCK_NAME,
  OMP_NATIVE_CACHE_MANIFEST_NAME,
  OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME,
  OMP_NATIVE_CACHE_STAGING_PREFIX,
  OMP_NATIVE_CACHE_VERSION,
  OMP_NATIVE_CACHE_X64_ADDONS,
  ompDevelopmentNativeCacheBase,
  type OmpNativeCache,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  ompNativeCacheForbiddenRoots,
  ompNativeCacheFromSelection,
  ompNativeCacheLinkPath,
  type OmpNativeCacheManifest,
  type OmpNativeCachePlatform,
  ompNativeCachePlatform,
  ompNativeCachePrepareRemedy,
  prepareOmpNativeCacheRoot,
  readOmpNativeCacheManifest,
  resolveOmpNativeCache,
  serializeOmpNativeCacheManifest,
} from "../../src/utils/omp-native-cache.ts";
import { getMinimumOmpVersion } from "@utils/omp-version.ts";

/** Byte length of every fixture addon file (payload size is irrelevant here). */
const FIXTURE_BYTES = 12;

/** Names a COMPLETE payload of `platform` must publish. */
function requiredAddonNames(platform: OmpNativeCachePlatform): string[] {
  const { exact } = ompNativeCacheExpectedAddons(platform);
  if (exact.length > 0) return [...exact];
  // The arm64 set is a pattern requirement (the pinned arm64 names are
  // uncharacterised), so the fixture uses the container-packaging name.
  return ["pi_natives.linux-arm64.node"];
}

/** Run `body` against a fresh real temporary directory, always cleaning it up. */
async function withTempRoot(body: (root: string) => Promise<void> | void): Promise<void> {
  const root = await Deno.makeTempDir();
  try {
    await body(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

/**
 * Write a real fixture payload at `{base}/{platform}`: the extracted version
 * directory with regular addon files plus the sidecar manifest. Every option
 * exists to produce one specific INCOMPLETE or MISMATCHED payload.
 */
function writePreparedPayload(
  base: string,
  platform: OmpNativeCachePlatform,
  options: {
    manifestVersion?: string;
    manifestPlatform?: OmpNativeCachePlatform;
    executableSha256?: string;
    addons?: readonly string[];
    manifestFiles?: readonly { name: string; size: number }[];
    /** Addon names written as DIRECTORIES instead of regular files. */
    directories?: readonly string[];
    omitVersionDir?: boolean;
    omitManifest?: boolean;
  } = {},
): OmpNativeCache {
  const cache = ompNativeCacheDescriptor(base, platform, "development");
  if (!options.omitVersionDir) {
    Deno.mkdirSync(cache.versionDir, { recursive: true });
    const addons = options.addons ?? requiredAddonNames(platform);
    for (const name of addons) {
      const path = join(cache.versionDir, name);
      if (options.directories?.includes(name)) {
        Deno.mkdirSync(path);
      } else {
        Deno.writeTextFileSync(path, "n".repeat(FIXTURE_BYTES));
      }
    }
  }
  if (!options.omitManifest) {
    Deno.mkdirSync(cache.installRoot, { recursive: true });
    const published = options.addons ?? requiredAddonNames(platform);
    Deno.writeTextFileSync(
      cache.manifestPath,
      serializeOmpNativeCacheManifest({
        version: options.manifestVersion ?? OMP_NATIVE_CACHE_VERSION,
        platform: options.manifestPlatform ?? platform,
        executableSha256: options.executableSha256 ??
          OMP_NATIVE_CACHE_EXECUTABLE_SHA256[platform],
        files: options.manifestFiles ?? published.map((name) => ({ name, size: FIXTURE_BYTES })),
      }),
    );
  }
  return cache;
}

// ---------------------------------------------------------------------------
// Identity and layout
// ---------------------------------------------------------------------------

Deno.test("ompNativeCachePlatform - maps the two supported targets and refuses the rest", () => {
  assertEquals(ompNativeCachePlatform("x86_64", "linux"), "linux-x64");
  assertEquals(ompNativeCachePlatform("aarch64", "linux"), "linux-arm64");

  const error = assertThrows(() => ompNativeCachePlatform("x86_64", "darwin"), Error);
  assertStringIncludes(error.message, "darwin-x86_64");
  assertStringIncludes(error.message, "linux-x64, linux-arm64");
  assertStringIncludes(error.message, OMP_NATIVE_CACHE_VERSION);
  assertStringIncludes(error.message, "prepare:omp-natives");
  assertThrows(() => ompNativeCachePlatform("riscv64", "linux"), Error);
  assertThrows(() => ompNativeCachePlatform("aarch64", "darwin"), Error);
});

Deno.test("cache identity follows the 18.6.1 pin, never the AGENT_OMP_MIN_VERSION override", async () => {
  const original = Deno.env.get("AGENT_OMP_MIN_VERSION");
  await withTempRoot((root) => {
    try {
      Deno.env.set("AGENT_OMP_MIN_VERSION", "20.1.0");
      // The operator override moves the bootstrap compatibility minimum...
      assertEquals(getMinimumOmpVersion(), "20.1.0");
      // ...but the cache identity stays pinned.
      assertEquals(OMP_NATIVE_CACHE_VERSION, "18.6.1");
      const cache = writePreparedPayload(root, "linux-x64");
      assertEquals(cache.version, "18.6.1");
      assertEquals(cache.versionDir, resolve(join(root, "linux-x64", "natives", "18.6.1")));
      assertEquals(assertOmpNativeCacheComplete(cache).version, "18.6.1");

      // A payload prepared for the override version is NOT consumable.
      const overridden = writePreparedPayload(join(root, "override"), "linux-x64", {
        manifestVersion: "20.1.0",
      });
      const error = assertThrows(() => assertOmpNativeCacheComplete(overridden), Error);
      assertStringIncludes(error.message, "identity mismatch");
      assertStringIncludes(error.message, "20.1.0");
    } finally {
      if (original === undefined) Deno.env.delete("AGENT_OMP_MIN_VERSION");
      else Deno.env.set("AGENT_OMP_MIN_VERSION", original);
    }
  });
});

Deno.test("published layout constants pin the image and development conventions", () => {
  assertEquals(OMP_IMAGE_NATIVE_CACHE_ROOT, "/opt/air/omp/native-cache");
  assertEquals(OMP_DEVELOPMENT_NATIVE_CACHE_RELATIVE, join("air-friends", "omp"));
  assertEquals(OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME, "natives");
  assertEquals(OMP_NATIVE_CACHE_MANIFEST_NAME, "native-manifest.json");
  assertEquals(OMP_NATIVE_CACHE_LOCK_NAME, ".prepare-omp-natives.lock");
  assert(OMP_NATIVE_CACHE_STAGING_PREFIX.startsWith("."));

  const image = ompNativeCacheDescriptor(OMP_IMAGE_NATIVE_CACHE_ROOT, "linux-arm64", "image");
  assertEquals(image.mode, "image");
  assertEquals(image.platform, "linux-arm64");
  assertEquals(image.installRoot, resolve(join(OMP_IMAGE_NATIVE_CACHE_ROOT, "linux-arm64")));
  // The loader appends the version itself: the link target is `.../natives`.
  assertEquals(image.payloadDir, resolve(join(image.installRoot, "natives")));
  assertEquals(image.versionDir, resolve(join(image.payloadDir, OMP_NATIVE_CACHE_VERSION)));
  // The sidecar manifest is published OUTSIDE the native payload subtree, so it
  // is never part of what the loader reads.
  assertEquals(
    image.manifestPath,
    resolve(join(image.installRoot, OMP_NATIVE_CACHE_MANIFEST_NAME)),
  );
  assertEquals(image.manifestPath.startsWith(`${image.payloadDir}/`), false);
});

Deno.test("ompNativeCacheExpectedAddons - exact x64 variants, one arm64 addon required", () => {
  const x64 = ompNativeCacheExpectedAddons("linux-x64");
  assertEquals(x64.exact, OMP_NATIVE_CACHE_X64_ADDONS);
  assertEquals(x64.exact, [
    "pi_natives.linux-x64-baseline.node",
    "pi_natives.linux-x64-modern.node",
  ]);
  assertEquals(x64.atLeastOne, []);

  const arm64 = ompNativeCacheExpectedAddons("linux-arm64");
  assertEquals(arm64.exact, []);
  assertEquals(arm64.atLeastOne.length, 1);
  const pattern = arm64.atLeastOne[0];
  assert(pattern.test("pi_natives.linux-arm64.node"));
  assert(pattern.test("pi_natives.linux-arm64-baseline.node"));
  assert(pattern.test("pi_natives.linux-arm64-modern.node"));
  assert(!pattern.test("pi_natives.linux-x64-modern.node"));
  assert(!pattern.test("notes.txt"));

  assertEquals(missingExpectedAddons("linux-x64", [...x64.exact]), []);
  assertEquals(missingExpectedAddons("linux-x64", [x64.exact[0]]), [x64.exact[1]]);
  assertEquals(missingExpectedAddons("linux-arm64", ["pi_natives.linux-arm64.node"]), []);
  const armMissing = missingExpectedAddons("linux-arm64", ["pi_natives.linux-x64-modern.node"]);
  assertEquals(armMissing.length, 1);
  assertStringIncludes(armMissing[0], "at least one file matching");
});

Deno.test("resolveOmpNativeCache - the installed image root wins, development only without one", async () => {
  await withTempRoot((root) => {
    const imageBase = join(root, "opt", "air", "omp", "native-cache");
    const developmentBase = join(root, "home", ".cache", OMP_DEVELOPMENT_NATIVE_CACHE_RELATIVE);

    // No installed root for this platform yet: the development root is selected.
    const development = resolveOmpNativeCache({
      platform: "linux-x64",
      imageBase,
      developmentBase,
    });
    assertEquals(development.mode, "development");
    assertEquals(development.installRoot, resolve(join(developmentBase, "linux-x64")));

    // Another platform's installed root never satisfies this platform.
    Deno.mkdirSync(join(imageBase, "linux-arm64"), { recursive: true });
    assertEquals(
      resolveOmpNativeCache({ platform: "linux-x64", imageBase, developmentBase }).mode,
      "development",
    );

    // An INSTALLED root for this platform wins — even an incomplete one, where
    // development bytes exist and must NOT be substituted.
    Deno.mkdirSync(join(imageBase, "linux-x64", "natives"), { recursive: true });
    writePreparedPayload(developmentBase, "linux-x64");
    const installed = resolveOmpNativeCache({ platform: "linux-x64", imageBase, developmentBase });
    assertEquals(installed.mode, "image");
    assertEquals(installed.installRoot, resolve(join(imageBase, "linux-x64")));
    const error = assertThrows(() => assertOmpNativeCacheComplete(installed), Error);
    assertStringIncludes(error.message, "installed cache root is incomplete");
    assertStringIncludes(error.message, ompNativeCachePrepareRemedy());
    // The complete development payload is still untouched and complete.
    assertOmpNativeCacheComplete(
      ompNativeCacheDescriptor(developmentBase, "linux-x64", "development"),
    );

    // A real file (not a directory) at the installed root still counts as
    // installed, so the preflight — never a silent fallback — reports it.
    const fileBase = join(root, "file-image");
    Deno.mkdirSync(fileBase, { recursive: true });
    Deno.writeTextFileSync(join(fileBase, "linux-x64"), "not a directory\n");
    assertEquals(
      resolveOmpNativeCache({ platform: "linux-x64", imageBase: fileBase, developmentBase }).mode,
      "image",
    );
  });
});

Deno.test("ompDevelopmentNativeCacheBase - XDG_CACHE_HOME, then HOME/.cache, else a named failure", () => {
  const env = (values: Record<string, string>) => ({
    get: (key: string): string | undefined => values[key],
  });
  assertEquals(
    ompDevelopmentNativeCacheBase(env({ XDG_CACHE_HOME: "/xdg", HOME: "/home/u" })),
    resolve(join("/xdg", "air-friends", "omp")),
  );
  assertEquals(
    ompDevelopmentNativeCacheBase(env({ HOME: "/home/u" })),
    resolve(join("/home/u", ".cache", "air-friends", "omp")),
  );
  // A blank XDG_CACHE_HOME falls back to HOME rather than resolving to `/`.
  assertEquals(
    ompDevelopmentNativeCacheBase(env({ XDG_CACHE_HOME: "  ", HOME: "/home/u" })),
    resolve(join("/home/u", ".cache", "air-friends", "omp")),
  );
  const error = assertThrows(() => ompDevelopmentNativeCacheBase(env({})), Error);
  assertStringIncludes(error.message, "XDG_CACHE_HOME");
  assertStringIncludes(error.message, OMP_IMAGE_NATIVE_CACHE_ROOT);
});

Deno.test("ompNativeCacheFromSelection - a seam root must be this platform's root", () => {
  const matching = ompNativeCacheFromSelection(
    { installRoot: "/cache/omp/linux-x64" },
    "linux-x64",
  );
  assertEquals(matching.mode, "development");
  assertEquals(matching.installRoot, resolve("/cache/omp/linux-x64"));
  assertEquals(matching.payloadDir, resolve("/cache/omp/linux-x64/natives"));

  const error = assertThrows(
    () => ompNativeCacheFromSelection({ installRoot: "/cache/omp/linux-arm64" }, "linux-x64"),
    Error,
  );
  assertStringIncludes(error.message, "/cache/omp/linux-arm64");
  assertStringIncludes(error.message, "linux-x64");
  assertStringIncludes(error.message, OMP_NATIVE_CACHE_VERSION);

  // An empty seam (production posture) resolves the contracted mapping.
  const resolved = ompNativeCacheFromSelection({});
  assertEquals(resolved.platform, ompNativeCachePlatform());
  assertEquals(resolved.version, OMP_NATIVE_CACHE_VERSION);
  assert(resolved.mode === "image" || resolved.mode === "development");
});

// ---------------------------------------------------------------------------
// Location guard
// ---------------------------------------------------------------------------

Deno.test("forbidden native-cache locations are refused with the operator remedy", () => {
  const repo = "/data/air-friends";
  const roots = ompNativeCacheForbiddenRoots({ repoPath: repo, workspacesDir: "workspaces" });
  assertEquals(roots, [
    resolve(repo),
    resolve(join(repo, "workspaces")),
    resolve(join(repo, "agent-workspace")),
  ]);
  assertEquals(ompNativeCacheForbiddenRoots({ repoPath: repo }), [
    resolve(repo),
    resolve(join(repo, "agent-workspace")),
  ]);

  const insideDataRoot = join(repo, "omp", "native-cache", "linux-x64");
  const dataError = assertThrows(
    () => assertOmpNativeCacheLocationAllowed(insideDataRoot, roots),
    Error,
  );
  assertStringIncludes(dataError.message, "Refusing");
  assertStringIncludes(dataError.message, insideDataRoot);
  assertStringIncludes(dataError.message, resolve(repo));
  assertStringIncludes(dataError.message, "outside the backed-up data root");

  // Inside a configured user/shared workspace root.
  assertThrows(() =>
    assertOmpNativeCacheLocationAllowed(
      join(repo, "workspaces", "discord/123", "native-cache", "linux-x64"),
      roots,
    )
  );
  // Inside the shared agent workspace.
  assertThrows(() =>
    assertOmpNativeCacheLocationAllowed(join(repo, "agent-workspace", "linux-x64"), roots)
  );
  // Equal to a root.
  assertThrows(() => assertOmpNativeCacheLocationAllowed(resolve(repo), roots));

  // A configured workspace path that itself overlaps the canonical cache root
  // is refused in the other direction.
  const overlapping = ompNativeCacheForbiddenRoots({
    repoPath: repo,
    workspacesDir: join("omp", "native-cache"),
  });
  assertThrows(() =>
    assertOmpNativeCacheLocationAllowed(join(repo, "omp", "native-cache", "linux-x64"), overlapping)
  );

  // Outside every root is allowed; empty candidates are ignored.
  assertOmpNativeCacheLocationAllowed("/var/lib/air-friends/omp/native-cache/linux-x64", roots);
  assertOmpNativeCacheLocationAllowed(resolve(repo), [undefined, "", "/elsewhere"]);
});

// ---------------------------------------------------------------------------
// Manifest contract
// ---------------------------------------------------------------------------

Deno.test("manifest - deterministic serialisation round-trips through reading", async () => {
  await withTempRoot(async (root) => {
    const manifest: OmpNativeCacheManifest = {
      version: OMP_NATIVE_CACHE_VERSION,
      platform: "linux-x64",
      executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256["linux-x64"],
      files: [{ name: "b.node", size: 2 }, { name: "a.node", size: 1 }],
    };
    const text = serializeOmpNativeCacheManifest(manifest);
    assert(text.endsWith("\n"));
    assertEquals(
      (JSON.parse(text) as OmpNativeCacheManifest).files.map((file) => file.name),
      ["a.node", "b.node"],
      "files are serialised sorted by name",
    );
    assertEquals(serializeOmpNativeCacheManifest(manifest), text, "serialisation is stable");

    const path = join(root, OMP_NATIVE_CACHE_MANIFEST_NAME);
    await Deno.writeTextFile(path, text);
    const read = readOmpNativeCacheManifest(path);
    assertEquals(read, {
      version: OMP_NATIVE_CACHE_VERSION,
      platform: "linux-x64",
      executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256["linux-x64"],
      files: [{ name: "a.node", size: 1 }, { name: "b.node", size: 2 }],
    });
    assertEquals(serializeOmpNativeCacheManifest(read!), text);
  });
});

Deno.test("manifest - structurally invalid documents are rejected, never trusted", async () => {
  await withTempRoot(async (root) => {
    const path = join(root, OMP_NATIVE_CACHE_MANIFEST_NAME);
    assertEquals(readOmpNativeCacheManifest(join(root, "absent.json")), null);
    // A directory at the manifest path is unreadable, not a crash.
    assertEquals(readOmpNativeCacheManifest(root), null);

    const valid: OmpNativeCacheManifest = {
      version: OMP_NATIVE_CACHE_VERSION,
      platform: "linux-x64",
      executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256["linux-x64"],
      files: [{ name: "a.node", size: 1 }],
    };
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["not JSON", "{"],
      ["JSON null", "null"],
      ["JSON array", "[]"],
      ["JSON string", '"manifest"'],
      ["missing version", JSON.stringify({ ...valid, version: undefined })],
      ["non-string version", JSON.stringify({ ...valid, version: 18 })],
      ["missing platform", JSON.stringify({ ...valid, platform: undefined })],
      ["missing executableSha256", JSON.stringify({ ...valid, executableSha256: undefined })],
      ["files not an array", JSON.stringify({ ...valid, files: {} })],
      ["file entry not an object", JSON.stringify({ ...valid, files: [1] })],
      ["file entry null", JSON.stringify({ ...valid, files: [null] })],
      ["file entry missing name", JSON.stringify({ ...valid, files: [{ size: 1 }] })],
      ["file entry non-string name", JSON.stringify({ ...valid, files: [{ name: 1, size: 1 }] })],
      ["file entry missing size", JSON.stringify({ ...valid, files: [{ name: "a.node" }] })],
      [
        "file entry non-numeric size",
        JSON.stringify({ ...valid, files: [{ name: "n", size: "1" }] }),
      ],
    ];
    for (const [label, text] of cases) {
      await Deno.writeTextFile(path, text);
      assertEquals(readOmpNativeCacheManifest(path), null, label);
    }

    await Deno.writeTextFile(path, JSON.stringify(valid));
    assertEquals(readOmpNativeCacheManifest(path), valid);
  });
});

// ---------------------------------------------------------------------------
// Payload completeness
// ---------------------------------------------------------------------------

Deno.test("assertOmpNativeCacheComplete - accepts a matching payload and names every mismatch", async (t) => {
  await t.step("complete payload returns its manifest", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64");
      const manifest = assertOmpNativeCacheComplete(cache);
      assertEquals(manifest.version, OMP_NATIVE_CACHE_VERSION);
      assertEquals(manifest.platform, "linux-x64");
      assertEquals(
        manifest.files.map((file) => file.name).sort(),
        [...OMP_NATIVE_CACHE_X64_ADDONS].sort(),
      );
    });
  });

  await t.step("absent payload directory", async () => {
    await withTempRoot((root) => {
      const cache = ompNativeCacheDescriptor(root, "linux-x64", "development");
      const error = assertThrows(() => assertOmpNativeCacheComplete(cache), Error);
      assertStringIncludes(error.message, cache.payloadDir);
      assertStringIncludes(error.message, "is missing");
      assertStringIncludes(error.message, ompNativeCachePrepareRemedy());
    });
  });

  await t.step("payload directory replaced by a regular file", async () => {
    await withTempRoot((root) => {
      const cache = ompNativeCacheDescriptor(root, "linux-x64", "development");
      Deno.mkdirSync(cache.installRoot, { recursive: true });
      Deno.writeTextFileSync(cache.payloadDir, "not a directory\n");
      assertThrows(() => assertOmpNativeCacheComplete(cache), Error, "is missing");
    });
  });

  await t.step("missing manifest", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64", { omitManifest: true });
      const error = assertThrows(() => assertOmpNativeCacheComplete(cache), Error);
      assertStringIncludes(error.message, cache.manifestPath);
      assertStringIncludes(error.message, "incomplete");
      assertStringIncludes(error.message, ompNativeCachePrepareRemedy());
    });
  });

  await t.step("structurally invalid manifest", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64");
      Deno.writeTextFileSync(cache.manifestPath, '{"version": 18}\n');
      assertThrows(() => assertOmpNativeCacheComplete(cache), Error, "invalid");
    });
  });

  await t.step("version mismatch", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64", { manifestVersion: "18.6.0" });
      const error = assertThrows(() => assertOmpNativeCacheComplete(cache), Error);
      assertStringIncludes(error.message, "identity mismatch");
      assertStringIncludes(error.message, "18.6.0");
      assertStringIncludes(error.message, "18.6.1");
    });
  });

  await t.step("platform mismatch", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64", { manifestPlatform: "linux-arm64" });
      const error = assertThrows(() => assertOmpNativeCacheComplete(cache), Error);
      assertStringIncludes(error.message, "linux-arm64 @ 18.6.1");
      assertStringIncludes(error.message, "linux-x64 @ 18.6.1");
    });
  });

  await t.step("executable identity mismatch", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64", { executableSha256: "0".repeat(64) });
      const error = assertThrows(() => assertOmpNativeCacheComplete(cache), Error);
      assertStringIncludes(error.message, "executable identity mismatch");
      assertStringIncludes(error.message, "0".repeat(64));
      assertStringIncludes(error.message, OMP_NATIVE_CACHE_EXECUTABLE_SHA256["linux-x64"]);
    });
  });

  await t.step("expected addon file absent from the manifest", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64", {
        addons: [OMP_NATIVE_CACHE_X64_ADDONS[0]],
      });
      const error = assertThrows(() => assertOmpNativeCacheComplete(cache), Error);
      assertStringIncludes(error.message, "is incomplete");
      assertStringIncludes(error.message, OMP_NATIVE_CACHE_X64_ADDONS[1]);
      assertStringIncludes(error.message, cache.versionDir);
    });
  });

  await t.step("recorded file absent from disk", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64");
      Deno.removeSync(join(cache.versionDir, OMP_NATIVE_CACHE_X64_ADDONS[0]));
      const error = assertThrows(() => assertOmpNativeCacheComplete(cache), Error);
      assertStringIncludes(error.message, OMP_NATIVE_CACHE_X64_ADDONS[0]);
      assertStringIncludes(error.message, "wrong size");
      assertStringIncludes(error.message, `expected ${FIXTURE_BYTES} bytes`);
    });
  });

  await t.step("recorded file size mismatch", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64", {
        manifestFiles: [
          { name: OMP_NATIVE_CACHE_X64_ADDONS[0], size: FIXTURE_BYTES },
          { name: OMP_NATIVE_CACHE_X64_ADDONS[1], size: FIXTURE_BYTES + 1 },
        ],
      });
      const error = assertThrows(() => assertOmpNativeCacheComplete(cache), Error);
      assertStringIncludes(error.message, OMP_NATIVE_CACHE_X64_ADDONS[1]);
      assertStringIncludes(error.message, `expected ${FIXTURE_BYTES + 1} bytes`);
    });
  });

  await t.step("recorded entry is not a regular file", async () => {
    await withTempRoot((root) => {
      const cache = writePreparedPayload(root, "linux-x64", {
        directories: [OMP_NATIVE_CACHE_X64_ADDONS[0]],
      });
      assertThrows(() => assertOmpNativeCacheComplete(cache), Error, "wrong size");
    });
  });

  await t.step("arm64 payload completeness follows the pattern requirement", async () => {
    await withTempRoot((root) => {
      const complete = writePreparedPayload(root, "linux-arm64");
      assertEquals(assertOmpNativeCacheComplete(complete).platform, "linux-arm64");
      const incomplete = writePreparedPayload(join(root, "incomplete"), "linux-arm64", {
        addons: ["notes.txt"],
      });
      const error = assertThrows(() => assertOmpNativeCacheComplete(incomplete), Error);
      assertStringIncludes(error.message, "at least one file matching");
    });
  });
});

// ---------------------------------------------------------------------------
// Launch-executable agreement
// ---------------------------------------------------------------------------

Deno.test("assertOmpLaunchExecutableAgreement - pin agreement, absent probe, mismatch", () => {
  const cache = ompNativeCacheDescriptor("/cache", "linux-x64", "development");

  // Agreeing observations in either shape.
  assertOmpLaunchExecutableAgreement(cache, "18.6.1");
  assertOmpLaunchExecutableAgreement(cache, "omp v18.6.1");
  assertOmpLaunchExecutableAgreement(cache, "omp 18.6.1 (linux-x64)");

  // Absent probe (never run) and undeterminable probe (null) skip ONLY this
  // check — the payload identity check has already run in the preflight.
  assertOmpLaunchExecutableAgreement(cache, undefined);
  assertOmpLaunchExecutableAgreement(cache, null);

  for (const version of ["18.6.0", "18.7.0", "19.0.0", "17.6.1"]) {
    const error = assertThrows(() => assertOmpLaunchExecutableAgreement(cache, version), Error);
    assertStringIncludes(error.message, "identity mismatch");
    assertStringIncludes(error.message, version);
    assertStringIncludes(error.message, "18.6.1");
    assertStringIncludes(error.message, ompNativeCachePrepareRemedy());
  }

  // A present but unparseable observation fails closed rather than skipping.
  assertThrows(() => assertOmpLaunchExecutableAgreement(cache, "not-a-version"), Error);
  assertThrows(() => assertOmpLaunchExecutableAgreement(cache, ""), Error);
});

// ---------------------------------------------------------------------------
// Reserved link installation
// ---------------------------------------------------------------------------

/** Create a real payload directory used only as a link target. */
function makePayloadTarget(root: string, name = "payload"): string {
  const target = join(root, name, "linux-x64", "natives");
  Deno.mkdirSync(target, { recursive: true });
  return target;
}

Deno.test("installOmpNativeCacheLink - fresh install, idempotent reuse, no temporary litter", async () => {
  await withTempRoot(async (root) => {
    const baseRoot = join(root, "omp-pools", "pool-key");
    const target = makePayloadTarget(root);
    const linkPath = ompNativeCacheLinkPath(baseRoot, "restricted");
    assertEquals(
      linkPath,
      resolve(join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp", "natives")),
    );

    const installed = installOmpNativeCacheLink({
      baseRoot,
      mode: "restricted",
      cache: { payloadDir: target },
    });
    assertEquals(installed, linkPath);
    const info = Deno.lstatSync(linkPath);
    assert(info.isSymlink, "the reserved entry must be a symlink");
    assertEquals(Deno.readLinkSync(linkPath), target);
    // The mode application directory stays a real, writable private directory.
    assert(Deno.statSync(join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp")).isDirectory);
    await Deno.writeTextFile(
      join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp", "db.sqlite"),
      "x",
    );
    assertEquals(
      [...Deno.readDirSync(join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp"))]
        .map((entry) => entry.name)
        .sort(),
      ["db.sqlite", "natives"],
    );

    // Idempotent re-run: same link, and no temporary link file is left behind.
    assertEquals(
      installOmpNativeCacheLink({ baseRoot, mode: "restricted", cache: { payloadDir: target } }),
      linkPath,
    );
    assertEquals(Deno.readLinkSync(linkPath), target);
    const entries = [
      ...Deno.readDirSync(join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp")),
    ]
      .map((entry) => entry.name)
      .filter((name) => name !== "db.sqlite")
      .sort();
    assertEquals(entries, ["natives"]);

    // The sibling mode gets its OWN reserved entry in its own private root.
    const yoloLink = installOmpNativeCacheLink({
      baseRoot,
      mode: "native-yolo",
      cache: { payloadDir: target },
    });
    assertEquals(Deno.readLinkSync(yoloLink), target);
    assert(yoloLink !== linkPath);
  });
});

Deno.test("installOmpNativeCacheLink - an identical link written by a concurrent creator is success", async () => {
  await withTempRoot(async (root) => {
    const baseRoot = join(root, "omp-pools", "pool-race");
    const target = makePayloadTarget(root);
    const linkPath = ompNativeCacheLinkPath(baseRoot, "restricted");
    Deno.mkdirSync(join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp"), {
      recursive: true,
    });

    // Concurrent (overlapping) creators of the identical link: every call
    // succeeds and exactly one reserved entry exists.
    const results = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          Promise.resolve().then(() =>
            installOmpNativeCacheLink({
              baseRoot,
              mode: "restricted",
              cache: { payloadDir: target },
            })
          ),
      ),
    );
    for (const result of results) assertEquals(result, linkPath);
    assertEquals(Deno.readLinkSync(linkPath), target);
    assertEquals(
      [...Deno.readDirSync(join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp"))]
        .map((entry) => entry.name),
      ["natives"],
    );

    // A pre-existing exact managed link (the state a winning racer leaves) is
    // reused rather than replaced or refused.
    const inodeBefore = Deno.lstatSync(linkPath).ino;
    assertEquals(
      installOmpNativeCacheLink({ baseRoot, mode: "restricted", cache: { payloadDir: target } }),
      linkPath,
    );
    assertEquals(Deno.lstatSync(linkPath).ino, inodeBefore);
  });
});

Deno.test("installOmpNativeCacheLink - dangling and differently targeted links are refused", async () => {
  await withTempRoot((root) => {
    const target = makePayloadTarget(root);
    const other = makePayloadTarget(root, "other");

    // Dangling link.
    const danglingRoot = join(root, "dangling");
    const danglingLink = ompNativeCacheLinkPath(danglingRoot, "restricted");
    Deno.mkdirSync(join(danglingRoot, "omp-agent", "restricted", "xdg-data", "omp"), {
      recursive: true,
    });
    Deno.symlinkSync(join(root, "vanished"), danglingLink);
    const danglingError = assertThrows(
      () =>
        installOmpNativeCacheLink({
          baseRoot: danglingRoot,
          mode: "restricted",
          cache: { payloadDir: target },
        }),
      Error,
    );
    assertStringIncludes(danglingError.message, danglingLink);
    assertStringIncludes(danglingError.message, join(root, "vanished"));
    assertStringIncludes(danglingError.message, target);
    assertEquals(Deno.readLinkSync(danglingLink), join(root, "vanished"), "link left untouched");

    // Different target.
    const otherRoot = join(root, "other-target");
    const otherLink = ompNativeCacheLinkPath(otherRoot, "restricted");
    Deno.mkdirSync(join(otherRoot, "omp-agent", "restricted", "xdg-data", "omp"), {
      recursive: true,
    });
    Deno.symlinkSync(other, otherLink);
    const otherError = assertThrows(
      () =>
        installOmpNativeCacheLink({
          baseRoot: otherRoot,
          mode: "restricted",
          cache: { payloadDir: target },
        }),
      Error,
    );
    assertStringIncludes(otherError.message, otherLink);
    assertStringIncludes(otherError.message, other);
    assertStringIncludes(otherError.message, "not to the selected shared payload");
    assertEquals(Deno.readLinkSync(otherLink), other, "link left untouched");
  });
});

Deno.test("installOmpNativeCacheLink - a regular file at the reserved entry is refused", async () => {
  await withTempRoot(async (root) => {
    const baseRoot = join(root, "occupied-file");
    const target = makePayloadTarget(root);
    const linkPath = ompNativeCacheLinkPath(baseRoot, "restricted");
    Deno.mkdirSync(join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp"), {
      recursive: true,
    });
    await Deno.writeTextFile(linkPath, "not a link\n");

    const error = assertThrows(
      () =>
        installOmpNativeCacheLink({ baseRoot, mode: "restricted", cache: { payloadDir: target } }),
      Error,
    );
    assertStringIncludes(error.message, linkPath);
    assertStringIncludes(error.message, "non-symlink file");
    assert(Deno.lstatSync(linkPath).isFile, "the occupying file is left untouched");
    assertEquals(await Deno.readTextFile(linkPath), "not a link\n");
  });
});

Deno.test("installOmpNativeCacheLink - an occupied legacy directory is refused, named and preserved", async () => {
  await withTempRoot(async (root) => {
    const baseRoot = join(root, "omp-pools", "legacy-pool");
    const target = makePayloadTarget(root);
    const linkPath = ompNativeCacheLinkPath(baseRoot, "restricted");
    // The legacy shape: a previous OMP release extracted channel-local native
    // copies into the reserved entry as a REAL directory.
    const legacyAddon = join(
      linkPath,
      OMP_NATIVE_CACHE_VERSION,
      "pi_natives.linux-x64-modern.node",
    );
    Deno.mkdirSync(join(linkPath, OMP_NATIVE_CACHE_VERSION), { recursive: true });
    await Deno.writeTextFile(legacyAddon, "legacy native bytes");

    const error = assertThrows(
      () =>
        installOmpNativeCacheLink({ baseRoot, mode: "restricted", cache: { payloadDir: target } }),
      Error,
    );
    // The diagnostic names the exact path and the operator removal action.
    assertStringIncludes(error.message, "is an existing directory");
    assertStringIncludes(error.message, linkPath);
    assertStringIncludes(error.message, `rm -rf '${linkPath}'`);
    assertStringIncludes(error.message, "Stop the bot");
    assertStringIncludes(error.message, "never deletes or migrates legacy native copies");

    // The legacy directory is left untouched: neither followed, deleted nor migrated.
    assert(Deno.lstatSync(linkPath).isDirectory, "legacy directory preserved as a directory");
    assertEquals(await Deno.readTextFile(legacyAddon), "legacy native bytes");
    assertEquals(
      [...Deno.readDirSync(linkPath)].map((entry) => entry.name),
      [OMP_NATIVE_CACHE_VERSION],
    );
  });
});

Deno.test("installOmpNativeCacheLink - symlinked or escaping managed parents are refused", async () => {
  await withTempRoot(async (root) => {
    const target = makePayloadTarget(root);
    const escape = join(root, "escape");
    Deno.mkdirSync(escape, { recursive: true });

    const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["omp-agent", ["omp-agent"]],
      ["mode", ["omp-agent", "restricted"]],
      ["xdg-data", ["omp-agent", "restricted", "xdg-data"]],
      ["omp", ["omp-agent", "restricted", "xdg-data", "omp"]],
    ];
    for (const [label, components] of cases) {
      const baseRoot = join(root, `parent-${label}`);
      const parent = join(baseRoot, ...components);
      Deno.mkdirSync(parent, { recursive: true });
      // Replace the deepest managed component with a symlink out of the root.
      Deno.removeSync(parent);
      Deno.symlinkSync(escape, parent);

      const error = assertThrows(
        () =>
          installOmpNativeCacheLink({
            baseRoot,
            mode: "restricted",
            cache: { payloadDir: target },
          }),
        Error,
      );
      assertStringIncludes(error.message, parent, label);
      assertStringIncludes(error.message, "symbolic link", label);
      // Nothing was created through the escaping component.
      assertEquals([...Deno.readDirSync(escape)].length, 0, label);
    }

    // A non-directory managed parent is refused too.
    const fileBase = join(root, "parent-file");
    const fileParent = join(fileBase, "omp-agent", "restricted", "xdg-data", "omp");
    Deno.mkdirSync(join(fileBase, "omp-agent", "restricted", "xdg-data"), { recursive: true });
    await Deno.writeTextFile(fileParent, "occupied\n");
    const fileError = assertThrows(
      () =>
        installOmpNativeCacheLink({
          baseRoot: fileBase,
          mode: "restricted",
          cache: { payloadDir: target },
        }),
      Error,
    );
    assertStringIncludes(fileError.message, fileParent);
    assertStringIncludes(fileError.message, "not a directory");
    assertEquals(await Deno.readTextFile(fileParent), "occupied\n");
  });
});

// ---------------------------------------------------------------------------
// End-to-end root preparation
// ---------------------------------------------------------------------------

Deno.test("prepareOmpNativeCacheRoot - installs the shared payload link over a temp payload", async () => {
  await withTempRoot((root) => {
    const installBase = join(root, "cache");
    const platform = ompNativeCachePlatform();
    const cache = writePreparedPayload(installBase, platform);
    const baseRoot = join(root, "omp-pools", "pool-key");

    const prepared = prepareOmpNativeCacheRoot({
      baseRoot,
      mode: "restricted",
      selection: {
        installRoot: join(installBase, platform),
        launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
      },
      forbiddenRoots: [],
    });
    assertEquals(prepared.installRoot, cache.installRoot);
    assertEquals(prepared.payloadDir, cache.payloadDir);

    const linkPath = ompNativeCacheLinkPath(baseRoot, "restricted");
    assert(Deno.lstatSync(linkPath).isSymlink);
    assertEquals(Deno.readLinkSync(linkPath), cache.payloadDir);
    // The extracted version directory is reachable THROUGH the link, i.e. the
    // root consumes shared bytes rather than a channel-local copy.
    const addon = requiredAddonNames(platform)[0];
    assertEquals(
      Deno.statSync(join(linkPath, OMP_NATIVE_CACHE_VERSION, addon)).ino,
      Deno.statSync(join(cache.versionDir, addon)).ino,
    );

    // Per-spawn shape: {workingDir}/tmp, mode-distinct reserved entries.
    const perSpawnBase = join(root, "workspace", "tmp");
    const perSpawn = prepareOmpNativeCacheRoot({
      baseRoot: perSpawnBase,
      mode: "native-yolo",
      selection: {
        installRoot: join(installBase, platform),
        launchExecutableVersion: "omp v18.6.1",
      },
      forbiddenRoots: [],
    });
    assertEquals(perSpawn.payloadDir, cache.payloadDir);
    assertEquals(
      Deno.readLinkSync(ompNativeCacheLinkPath(perSpawnBase, "native-yolo")),
      cache.payloadDir,
    );
  });
});

Deno.test("prepareOmpNativeCacheRoot - fails before spawn and leaves existing state untouched", async () => {
  await withTempRoot(async (root) => {
    const platform = ompNativeCachePlatform();
    const baseRoot = join(root, "omp-pools", "pool-key");
    const privateDir = join(baseRoot, "omp-agent", "restricted", "xdg-data", "omp");
    const privateState = join(privateDir, "db.sqlite");
    Deno.mkdirSync(privateDir, { recursive: true });
    await Deno.writeTextFile(privateState, "private\n");

    // Absent payload.
    const absent = assertThrows(
      () =>
        prepareOmpNativeCacheRoot({
          baseRoot,
          mode: "restricted",
          selection: {
            installRoot: join(root, "missing-cache", platform),
            launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
          },
          forbiddenRoots: [],
        }),
      Error,
    );
    assertStringIncludes(absent.message, "is missing");
    assertStringIncludes(absent.message, ompNativeCachePrepareRemedy());

    // Incomplete payload (a real install root without a manifest).
    const incompleteBase = join(root, "incomplete");
    writePreparedPayload(incompleteBase, platform, { omitManifest: true });
    const incomplete = assertThrows(
      () =>
        prepareOmpNativeCacheRoot({
          baseRoot,
          mode: "restricted",
          selection: {
            installRoot: join(incompleteBase, platform),
            launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
          },
          forbiddenRoots: [],
        }),
      Error,
    );
    assertStringIncludes(incomplete.message, "incomplete");
    assertStringIncludes(incomplete.message, ompNativeCachePrepareRemedy());

    // Mismatched launch executable.
    const validBase = join(root, "valid");
    writePreparedPayload(validBase, platform);
    const mismatched = assertThrows(
      () =>
        prepareOmpNativeCacheRoot({
          baseRoot,
          mode: "restricted",
          selection: { installRoot: join(validBase, platform), launchExecutableVersion: "18.5.0" },
          forbiddenRoots: [],
        }),
      Error,
    );
    assertStringIncludes(mismatched.message, "identity mismatch");

    // Forbidden location (inside a configured workspace root).
    const forbidden = assertThrows(
      () =>
        prepareOmpNativeCacheRoot({
          baseRoot,
          mode: "restricted",
          selection: {
            installRoot: join(validBase, platform),
            launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
          },
          forbiddenRoots: [validBase],
        }),
      Error,
    );
    assertStringIncludes(forbidden.message, "Refusing");

    // Nothing was linked and the pre-existing private state is byte-identical.
    assertThrows(
      () => Deno.lstatSync(join(privateDir, "natives")),
      Deno.errors.NotFound,
      undefined,
      "no reserved entry may be installed when the preflight fails",
    );
    assertEquals(await Deno.readTextFile(privateState), "private\n");
    assertEquals([...Deno.readDirSync(privateDir)].map((entry) => entry.name), ["db.sqlite"]);
  });
});

Deno.test("prepareOmpNativeCacheRoot - an absent probe outcome falls through to the payload check", async () => {
  await withTempRoot((root) => {
    const installBase = join(root, "cache");
    const platform = ompNativeCachePlatform();
    const cache = writePreparedPayload(installBase, platform);
    const baseRoot = join(root, "workspace", "tmp");

    // No `launchExecutableVersion` in the seam: this process memoised no probe,
    // so the undeterminable outcome skips ONLY the executable agreement check
    // while the payload identity/completeness check still runs.
    const prepared = prepareOmpNativeCacheRoot({
      baseRoot,
      mode: "restricted",
      selection: { installRoot: join(installBase, platform) },
      forbiddenRoots: [],
    });
    assertEquals(prepared.payloadDir, cache.payloadDir);
    assertEquals(
      Deno.readLinkSync(ompNativeCacheLinkPath(baseRoot, "restricted")),
      cache.payloadDir,
    );

    // With no prepared payload at all the same seam still fails closed.
    const absentBase = join(root, "absent");
    const failure = assertThrows(
      () =>
        prepareOmpNativeCacheRoot({
          baseRoot: join(root, "workspace-absent", "tmp"),
          mode: "restricted",
          selection: { installRoot: join(absentBase, platform) },
          forbiddenRoots: [],
        }),
      Error,
    );
    assertStringIncludes(failure.message, "is missing");
    assertStringIncludes(failure.message, ompNativeCachePrepareRemedy());
  });
});
