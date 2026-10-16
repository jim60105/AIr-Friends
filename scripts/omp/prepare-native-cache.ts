#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run
// scripts/omp/prepare-native-cache.ts
//
// Preparation entry for the ONE shared OMP native runtime payload
// (`deduplicate-omp-native-runtime-cache`, design D1).
//
// It runs the checksum-verified PINNED executable's REAL ACP initialization in a throwaway
// HOME/cwd with an existing temporary `XDG_DATA_HOME/omp`, validates the regular addon files
// the loader extracted for the target platform, publishes ONLY that native subtree with a
// sidecar file manifest, and verifies the published bytes load read-only. Probe databases,
// HOME and sessions are discarded.
//
// `--version` or directory creation alone is never accepted: a bounded JSON-RPC `initialize`
// handshake must complete successfully.
//
// Usage:
//   deno task prepare:omp-natives [--executable <path>] [--cache-root <base>]
//                                 [--platform <linux-x64|linux-arm64>]
//                                 [--executable-sha256 <hex>] [--timeout-ms <n>]
//
// Packaging reuses this module from the `omp-unpacker` Containerfile stage after the
// executable's checksum has been verified, passing that stage's `OMP_SHA256` explicitly so
// the two pins cannot drift.
//
// No JavaScript/Bun runtime is installed: this runs under the Deno runtime the image already
// carries, and it parses no undocumented embedded binary format.

import { dirname, join, resolve } from "@std/path";
import {
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_LOCK_NAME,
  OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME,
  OMP_NATIVE_CACHE_PLATFORMS,
  OMP_NATIVE_CACHE_STAGING_PREFIX,
  OMP_NATIVE_CACHE_VERSION,
  ompDevelopmentNativeCacheBase,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  type OmpNativeCacheFileEntry,
  type OmpNativeCacheManifest,
  type OmpNativeCachePlatform,
  ompNativeCachePlatform,
  serializeOmpNativeCacheManifest,
} from "../../src/utils/omp-native-cache.ts";
import { detectOmpVersion, parseOmpSemver } from "../../src/utils/omp-version.ts";

/** The bounded JSON-RPC `initialize` handshake request. */
export const OMP_ACP_INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
  },
});

export interface PrepareOmpNativeCacheOptions {
  /** Absolute path (or PATH-resolvable name) of the pinned executable to prepare from. */
  readonly executable: string;
  /** Base under which `{platform}/` is published. */
  readonly cacheBase: string;
  readonly platform: OmpNativeCachePlatform;
  /** Expected SHA-256 of `executable`; defaults to the built-in per-platform pin. */
  readonly executableSha256?: string;
  /** Bounded handshake/termination budget for each probe child. */
  readonly timeoutMs?: number;
  /** Bounded wait for a concurrent preparation to release the lock. */
  readonly lockWaitMs?: number;
}

export interface PrepareOmpNativeCacheResult {
  readonly installRoot: string;
  readonly payloadDir: string;
  readonly manifestPath: string;
  readonly manifest: OmpNativeCacheManifest;
  /** True when a complete matching payload was validated and reused verbatim. */
  readonly reused: boolean;
}

const DEFAULT_PROBE_TIMEOUT_MS = 120_000;
const DEFAULT_LOCK_WAIT_MS = 15_000;
const TERMINATION_GRACE_MS = 5_000;
const STDERR_KEEP_BYTES = 8192;

function delay(ms: number): Promise<void> {
  const { promise, resolve: release } = Promise.withResolvers<void>();
  setTimeout(release, ms);
  return promise;
}

/** Resolve an executable name against PATH to its absolute spelling. */
export function resolveOnPath(
  name: string,
  pathValue = Deno.env.get("PATH") ?? "",
): string | undefined {
  if (name.includes("/")) {
    try {
      Deno.statSync(name);
      return resolve(name);
    } catch {
      return undefined;
    }
  }
  for (const dir of pathValue.split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    try {
      const info = Deno.statSync(candidate);
      if (info.isFile) return candidate;
    } catch {
      // Not here — keep looking.
    }
  }
  return undefined;
}

/** SHA-256 of a file. Preparation is a deliberate, non-hot-path step, so one buffered read
 * of the pinned executable is the simplest correct implementation. */
export async function sha256File(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Drain a byte stream into a bounded text tail so a child can never block on stderr. */
async function drainTail(stream: ReadableStream<Uint8Array>, keep: number): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    if (text.length > keep) text = text.slice(text.length - keep);
  }
  return text;
}

/**
 * Wait for a read-only JSON-RPC response with `id === 1`. Returns `null` when the stream
 * ends or the budget expires without one.
 */
async function readInitializeResponse(
  stream: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const timer = setTimeout(() => {
    reader.cancel().catch(() => {});
  }, timeoutMs);
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.includes('"jsonrpc"')) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed !== null && typeof parsed === "object" && parsed.id === 1) return parsed;
        } catch {
          // Not a response line — keep looking.
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one bounded `omp acp` initialization against a throwaway HOME/cwd. Succeeds only on a
 * JSON-RPC response carrying a result object (never a `--version`-only or directory-only
 * run). The child is terminated cleanly, escalating to SIGTERM then SIGKILL.
 */
export async function runAcpInitialize(options: {
  readonly executable: string;
  readonly home: string;
  readonly cwd: string;
  readonly xdgDataHome: string;
  readonly timeoutMs: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  Deno.mkdirSync(options.home, { recursive: true });
  Deno.mkdirSync(join(options.home, "tmp"), { recursive: true });
  Deno.mkdirSync(options.cwd, { recursive: true });
  Deno.mkdirSync(join(options.xdgDataHome, "omp"), { recursive: true });

  const child = new Deno.Command(options.executable, {
    args: ["acp"],
    cwd: options.cwd,
    clearEnv: true,
    env: {
      HOME: options.home,
      XDG_DATA_HOME: options.xdgDataHome,
      TMPDIR: join(options.home, "tmp"),
      PATH: Deno.env.get("PATH") ?? "/usr/local/bin:/usr/bin:/bin",
    },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const stderrTail = drainTail(child.stderr, STDERR_KEEP_BYTES);
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(`${OMP_ACP_INITIALIZE_REQUEST}\n`));

  const response = await readInitializeResponse(child.stdout, options.timeoutMs);

  try {
    await writer.close();
  } catch {
    // The child may already have exited.
  }

  const exit = await Promise.race([
    child.status,
    delay(TERMINATION_GRACE_MS).then(() => null),
  ]);
  if (exit === null) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    const soft = await Promise.race([child.status, delay(TERMINATION_GRACE_MS).then(() => null)]);
    if (soft === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  const stderr = await stderrTail;

  if (response === null) {
    return {
      ok: false,
      reason: `no JSON-RPC initialize response within ${options.timeoutMs}ms` +
        (exit === null ? "" : ` (exit ${exit.code})`) +
        (stderr.trim() ? `; stderr: ${stderr.trim()}` : ""),
    };
  }
  if ("error" in response) {
    return { ok: false, reason: `initialize returned an error: ${JSON.stringify(response.error)}` };
  }
  const result = response.result;
  if (typeof result !== "object" || result === null) {
    return {
      ok: false,
      reason: `initialize returned no result object: ${JSON.stringify(response)}`,
    };
  }
  return { ok: true };
}

/** Every regular file beneath `dir`, relative to it, with sizes; non-regular entries fail. */
export function listRegularFiles(dir: string): OmpNativeCacheFileEntry[] {
  const files: OmpNativeCacheFileEntry[] = [];
  const walk = (current: string, prefix: string, depth: number): void => {
    if (depth > 8) throw new Error(`native cache payload nests too deeply at "${current}"`);
    for (const entry of Deno.readDirSync(current)) {
      const full = join(current, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory) {
        walk(full, relative, depth + 1);
        continue;
      }
      if (!entry.isFile) {
        throw new Error(
          `native cache payload contains a non-regular entry "${full}" — only regular addon ` +
            "files may be published",
        );
      }
      files.push({ name: relative, size: Deno.statSync(full).size });
    }
  };
  walk(dir, "", 0);
  return files;
}

/** Fail unless `names` satisfies the platform's expected addon set. */
export function assertExpectedAddons(platform: OmpNativeCachePlatform, names: string[]): void {
  const expected = ompNativeCacheExpectedAddons(platform);
  const missing = expected.exact.filter((name) => !names.includes(name));
  for (const pattern of expected.atLeastOne) {
    if (!names.some((name) => pattern.test(name))) {
      missing.push(`at least one file matching ${pattern}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `the pinned ${platform} executable did not extract the expected native addon files ` +
        `(missing ${missing.join(", ")}); extracted: ${names.join(", ") || "(none)"}`,
    );
  }
}

/**
 * Snapshot of a published payload used as read-only proof: every regular file's name, size,
 * inode and mtime, plus the structural presence of each directory.
 *
 * A directory's own mtime is deliberately NOT compared. The pinned loader touches its version
 * directory's timestamp on every start (`prepareNativeVersionDir`), which is allowed for the
 * owning process even on a write-protected tree, and is caught-and-tolerated when the tree is
 * a genuinely read-only mount. Comparing it would report a mutation that never reaches any
 * published byte. A rewrite, addition or removal of payload FILES still fails the comparison,
 * which is the property a shared payload depends on.
 */
function snapshotPayload(payloadDir: string): string {
  const lines: string[] = [];
  const walk = (current: string, prefix: string): void => {
    const info = Deno.lstatSync(current);
    if (!info.isDirectory) {
      lines.push(`${prefix}\t${info.size}\t${info.mtime?.getTime() ?? 0}\t${info.ino ?? 0}`);
      return;
    }
    lines.push(`${prefix}\t(dir)`);
    for (const entry of [...Deno.readDirSync(current)].map((e) => e.name).sort()) {
      walk(join(current, entry), prefix === "" ? entry : `${prefix}/${entry}`);
    }
  };
  walk(payloadDir, "");
  return lines.join("\n");
}

/** Recursively set directory/file modes (`0555`/`0444` when read-only). */
function setTreeMode(dir: string, readonly: boolean): void {
  Deno.chmodSync(dir, readonly ? 0o555 : 0o755);
  for (const entry of Deno.readDirSync(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory) {
      setTreeMode(full, readonly);
    } else {
      Deno.chmodSync(full, readonly ? 0o444 : 0o644);
    }
  }
}

/**
 * Verify the staged payload loads through a fresh root linked to it while the payload tree is
 * write-protected, and that the load changed nothing (names, sizes, mtimes, inodes). The
 * unchanged-snapshot assertion is the privilege-independent evidence: even where a build
 * runs as root and can bypass the mode bits, any rewrite of the payload is detected.
 */
async function assertReadOnlyLoad(options: {
  executable: string;
  staging: string;
  payloadDir: string;
  versionDir: string;
  timeoutMs: number;
}): Promise<void> {
  const before = snapshotPayload(options.payloadDir);
  setTreeMode(options.versionDir, true);
  setTreeMode(options.payloadDir, true);
  try {
    const probeRoot = join(options.staging, "readonly-probe");
    const xdg = join(probeRoot, "xdg");
    Deno.mkdirSync(join(xdg, "omp"), { recursive: true });
    Deno.symlinkSync(options.payloadDir, join(xdg, "omp", "natives"));
    const outcome = await runAcpInitialize({
      executable: options.executable,
      home: join(probeRoot, "home"),
      cwd: join(probeRoot, "cwd"),
      xdgDataHome: xdg,
      timeoutMs: options.timeoutMs,
    });
    if (!outcome.ok) {
      throw new Error(
        `the published native payload does not load read-only: ${outcome.reason}`,
      );
    }
    const after = snapshotPayload(options.payloadDir);
    if (after !== before) {
      throw new Error(
        "the read-only native payload load MUTATED the payload (file set, sizes, mtimes or " +
          "inodes changed), so a shared read-only mount would be rewritten at runtime:" +
          describeSnapshotDifference(before, after),
      );
    }
    Deno.removeSync(probeRoot, { recursive: true });
  } finally {
    setTreeMode(options.payloadDir, false);
    setTreeMode(options.versionDir, false);
  }
}

/** First differing snapshot lines, bounded, for the read-only mutation diagnostic. */
function describeSnapshotDifference(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const length = Math.max(beforeLines.length, afterLines.length);
  const shown: string[] = [];
  for (let index = 0; index < length && shown.length < 8; index++) {
    if (beforeLines[index] !== afterLines[index]) {
      shown.push(
        `\n  before: ${beforeLines[index] ?? "(absent)"}` +
          `\n  after:  ${afterLines[index] ?? "(absent)"}`,
      );
    }
  }
  return shown.join("");
}

/** `{executable} --version` must be EXACTLY the pinned cache version. */
async function assertPinnedExecutableVersion(executable: string, timeoutMs: number): Promise<void> {
  const detected = await detectOmpVersion(timeoutMs, executable);
  const parsed = detected === null ? null : parseOmpSemver(detected);
  const pinned = parseOmpSemver(OMP_NATIVE_CACHE_VERSION)!;
  if (
    parsed === null || parsed.major !== pinned.major || parsed.minor !== pinned.minor ||
    parsed.patch !== pinned.patch
  ) {
    throw new Error(
      `executable "${executable}" reports ${
        detected === null ? "no parseable version" : `"${detected}"`
      }, ` +
        `but this native payload is pinned to OMP ${OMP_NATIVE_CACHE_VERSION}. Install the ` +
        `pinned release for ${OMP_NATIVE_CACHE_PLATFORMS.join("/")} and retry.`,
    );
  }
}

/** Validate a complete, matching published payload; `null` when absent or not matching. */
function reuseExisting(
  installRoot: string,
  platform: OmpNativeCachePlatform,
  expectedSha: string,
): OmpNativeCacheManifest | null {
  const descriptor = ompNativeCacheDescriptor(dirname(installRoot), platform, "development");
  let manifest: OmpNativeCacheManifest | null = null;
  try {
    manifest = readManifestSync(descriptor.manifestPath);
  } catch {
    return null;
  }
  if (manifest === null) return null;
  if (
    manifest.version !== OMP_NATIVE_CACHE_VERSION || manifest.platform !== descriptor.platform ||
    manifest.executableSha256 !== expectedSha
  ) {
    return null;
  }
  for (const file of manifest.files) {
    try {
      const info = Deno.lstatSync(join(descriptor.versionDir, file.name));
      if (!info.isFile || info.size !== file.size) return null;
    } catch {
      return null;
    }
  }
  try {
    assertExpectedAddons(descriptor.platform, manifest.files.map((f) => f.name));
  } catch {
    return null;
  }
  return manifest;
}

function readManifestSync(path: string): OmpNativeCacheManifest | null {
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(path)) as OmpNativeCacheManifest;
    return typeof parsed === "object" && parsed !== null && Array.isArray(parsed.files)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * Prepare (or validate and reuse) the shared OMP native runtime payload for one platform.
 * Exclusive, atomic and never partially observable: a same-filesystem staging sibling is
 * published with a single rename, and an incomplete destination fails rather than being
 * overwritten.
 */
export async function prepareOmpNativeCache(
  options: PrepareOmpNativeCacheOptions,
): Promise<PrepareOmpNativeCacheResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const platform = options.platform;
  if (!(OMP_NATIVE_CACHE_PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error(
      `unsupported native cache platform "${platform}"; supported identities are ` +
        `${OMP_NATIVE_CACHE_PLATFORMS.join(", ")} for the pinned OMP ${OMP_NATIVE_CACHE_VERSION}`,
    );
  }
  const base = resolve(options.cacheBase);
  const installRoot = join(base, platform);
  const payloadDir = join(installRoot, OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME);
  const manifestPath = join(installRoot, "native-manifest.json");
  const expectedSha = options.executableSha256 ?? OMP_NATIVE_CACHE_EXECUTABLE_SHA256[platform];

  const executable = resolveOnPath(options.executable);
  if (executable === undefined) {
    throw new Error(`pinned OMP executable "${options.executable}" was not found`);
  }
  await assertPinnedExecutableVersion(executable, timeoutMs);
  const actualSha = await sha256File(executable);
  if (actualSha !== expectedSha) {
    throw new Error(
      `executable "${executable}" has SHA-256 ${actualSha}, but the pinned ${platform} ` +
        `executable is ${expectedSha}; refusing to prepare a native payload from unverified ` +
        `bytes. Install the pinned OMP ${OMP_NATIVE_CACHE_VERSION} release for ${platform}, or ` +
        `pass --platform <${OMP_NATIVE_CACHE_PLATFORMS.join("|")}> to prepare this host's target.`,
    );
  }

  Deno.mkdirSync(base, { recursive: true });
  const lockDir = join(base, OMP_NATIVE_CACHE_LOCK_NAME);
  const deadline = Date.now() + (options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS);
  for (;;) {
    try {
      Deno.mkdirSync(lockDir);
      break;
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `another OMP native runtime cache preparation is already running (lock "${lockDir}"). ` +
            "Wait for it to finish; if it crashed, remove that lock directory and retry.",
        );
      }
      await delay(200);
    }
  }

  try {
    const existing = reuseExisting(installRoot, platform, expectedSha);
    if (existing !== null) {
      return { installRoot, payloadDir, manifestPath, manifest: existing, reused: true };
    }
    try {
      Deno.lstatSync(installRoot);
      throw new Error(
        `OMP native runtime cache destination "${installRoot}" already exists but is not a ` +
          `complete payload for ${platform} @ ${OMP_NATIVE_CACHE_VERSION}. Refusing to ` +
          "overwrite it: inspect and remove that directory by hand, then prepare again.",
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }

    const staging = join(
      base,
      `${OMP_NATIVE_CACHE_STAGING_PREFIX}${Deno.pid}-${crypto.randomUUID()}`,
    );
    Deno.mkdirSync(staging, { recursive: true });
    let published = false;
    try {
      const probe = join(staging, "probe");
      const xdg = join(probe, "xdg");
      const handshake = await runAcpInitialize({
        executable,
        home: join(probe, "home"),
        cwd: join(probe, "cwd"),
        xdgDataHome: xdg,
        timeoutMs,
      });
      if (!handshake.ok) {
        throw new Error(`native payload preparation handshake failed: ${handshake.reason}`);
      }
      const extractedNatives = join(xdg, "omp", OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME);
      const versionDir = join(extractedNatives, OMP_NATIVE_CACHE_VERSION);
      let versionInfo: Deno.FileInfo;
      try {
        versionInfo = Deno.lstatSync(versionDir);
      } catch {
        throw new Error(
          `the pinned executable extracted no native payload at "${versionDir}" — a ` +
            "`--version`-only or directory-only run is not accepted",
        );
      }
      if (!versionInfo.isDirectory) {
        throw new Error(`extracted native payload "${versionDir}" is not a directory`);
      }
      const files = listRegularFiles(versionDir);
      assertExpectedAddons(platform, files.map((file) => file.name));

      // Publish only the native subtree; probe databases, HOME and sessions are discarded.
      Deno.renameSync(extractedNatives, join(staging, OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME));
      Deno.removeSync(probe, { recursive: true });

      const stagedPayload = join(staging, OMP_NATIVE_CACHE_PAYLOAD_DIR_NAME);
      const stagedVersion = join(stagedPayload, OMP_NATIVE_CACHE_VERSION);
      await assertReadOnlyLoad({
        executable,
        staging,
        payloadDir: stagedPayload,
        versionDir: stagedVersion,
        timeoutMs,
      });

      const manifest: OmpNativeCacheManifest = {
        version: OMP_NATIVE_CACHE_VERSION,
        platform,
        executableSha256: expectedSha,
        files,
      };
      Deno.writeTextFileSync(
        join(staging, "native-manifest.json"),
        serializeOmpNativeCacheManifest(manifest),
      );

      Deno.renameSync(staging, installRoot);
      published = true;
      return { installRoot, payloadDir, manifestPath, manifest, reused: false };
    } finally {
      if (!published) {
        try {
          Deno.removeSync(staging, { recursive: true });
        } catch {
          // Nothing staged, or already gone.
        }
      }
    }
  } finally {
    try {
      Deno.removeSync(lockDir, { recursive: true });
    } catch {
      // Already released.
    }
  }
}

/** Default cache base: the installed image tree when present, else the development cache. */
export function defaultCacheBase(
  platform: OmpNativeCachePlatform,
  imageBase: string,
): string {
  try {
    Deno.lstatSync(join(imageBase, platform));
    return imageBase;
  } catch {
    // The development base already ends in `air-friends/omp`; the resolver appends `{platform}`
    // itself, so returning anything higher would publish outside the path the launch reads.
    return ompDevelopmentNativeCacheBase();
  }
}

interface ParsedArgs {
  executable?: string;
  cacheBase?: string;
  platform?: string;
  executableSha256?: string;
  timeoutMs?: number;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = (): string => {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    switch (arg) {
      case "--executable":
        parsed.executable = next();
        break;
      case "--cache-root":
        parsed.cacheBase = next();
        break;
      case "--platform":
        parsed.platform = next();
        break;
      case "--executable-sha256":
        parsed.executableSha256 = next();
        break;
      case "--timeout-ms":
        parsed.timeoutMs = Number(next());
        break;
      case "-h":
      case "--help":
        console.log(
          "usage: prepare-native-cache.ts [--executable <path>] [--cache-root <base>] " +
            "[--platform <linux-x64|linux-arm64>] [--executable-sha256 <hex>] [--timeout-ms <n>]",
        );
        Deno.exit(0);
        break;
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }
  return parsed;
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  // Default to the target this host actually runs, so an arm64 deployment prepares its own
  // identity instead of failing the x64 checksum check.
  const platform = (args.platform ?? ompNativeCachePlatform()) as OmpNativeCachePlatform;
  const cacheBase = args.cacheBase ?? defaultCacheBase(platform, "/opt/air/omp/native-cache");
  const result = await prepareOmpNativeCache({
    executable: args.executable ?? "omp",
    cacheBase,
    platform,
    executableSha256: args.executableSha256,
    timeoutMs: args.timeoutMs,
  });
  console.log(
    `${
      result.reused ? "reused" : "prepared"
    } OMP native runtime payload at ${result.installRoot} ` +
      `(${result.manifest.files.length} files, ${platform} @ ${result.manifest.version})`,
  );
}
