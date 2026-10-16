/**
 * Pinned native OMP confined-runtime probe (`verify-omp-confined-native-runtime`).
 *
 * This is the REAL-binary counterpart of the mock suites: it spawns the
 * official pinned OMP executable through the shipped production factory and the
 * real `AgentConnector`, drives the ACP lifecycle (initialize / session-new /
 * model select / cancel / respawn+session-load) in BOTH launch modes, observes
 * the production factory AND native start for writable opens or replacements of
 * the AUTHORED configuration, and repeats the lifecycle under filesystem
 * confinement through the real shared `AgentProcessPool`.
 *
 * Evidence boundaries (spec: "Pinned Native OMP Confined Runtime Consumer
 * Evidence"):
 * - Only this file produces native evidence. The model fixture it consumes is
 *   hand-authored and copied byte-for-byte into a temporary HOME BEFORE the
 *   observation interval; no serializer, interpolator or configuration
 *   generator runs here, and the authored deployment assets
 *   (`agent-config/omp/*.yml`, `models.yml`) are never rewritten by this test.
 * - Prerequisites are EXACT, never downgraded to a mock, a synthetic session id
 *   or a fabricated catalog. With `OMP_NATIVE_ACCEPTANCE=1` (the documented
 *   acceptance mode) every unavailable prerequisite is a FAILED test naming the
 *   precise reason; without it the native legs stay UNEXERCISED rather than
 *   claiming native success, so ordinary CI/developer runs (which have no `omp`,
 *   `bwrap` or `strace`) neither pass a native claim nor go red for a missing
 *   runtime. `docs/agent/acp-engine.md` documents the native acceptance
 *   commands a given run exercises.
 * - No paid provider request is made: catalog advertisement and
 *   `session/set_config_option` need no network, and no prompt is ever sent. The
 *   fixture `baseUrl` is a loopback address this file never binds.
 * - Init/catalog/load proves those mechanisms only. Native capability-handler
 *   (tool) execution remains the scripted native-dispatch change's evidence.
 * - The OMP launch environment is process-global (`HOME` is read by the
 *   factory), so every test here restores the parent environment in `finally`.
 *   Deno runs one module's tests sequentially, which is the serialization this
 *   relies on.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { copy } from "@std/fs/copy";
import { basename, dirname, join, resolve } from "@std/path";
import { createAgentConfig } from "@acp/agent-factory.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import { canConfineFilesystem } from "@acp/sandbox-capabilities.ts";
import { SandboxManager } from "@acp/sandbox-manager.ts";
import { AgentProcessPool, type PoolRunOptions } from "@core/agent-process-pool.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { SessionRegistry } from "../../src/skill-api/session-registry.ts";
import { ompXdgDataHome } from "@utils/omp-paths.ts";
import {
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_VERSION,
  type OmpNativeCache,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  ompNativeCachePlatform,
  serializeOmpNativeCacheManifest,
} from "@utils/omp-native-cache.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import type { AgentConfig, AgentConnectorOptions } from "@acp/types.ts";
import type { Config, SandboxConfig } from "../../src/types/config.ts";
import type { DriverParams, DriverResult } from "../mocks/omp-native-lifecycle-driver.ts";

// ---------------------------------------------------------------------------
// Pinned prerequisites and authored-asset inventory
// ---------------------------------------------------------------------------

/** The exact pinned release the adapters and the trusted extension consume. */
const PINNED_OMP_VERSION = "18.6.1";

/** Checkout root (this file lives at `<root>/tests/acp/`). */
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");

/** The tracked, hand-authored native model fixture consumed by this probe. */
const FIXTURE_MODELS_PATH = join(
  REPO_ROOT,
  "tests/fixtures/omp-native-runtime/home/.omp/agent/models.yml",
);

/** Its native config-home destination (`getAgentDir()/models.yml`). */
const HOME_MODELS_RELATIVE = join(".omp", "agent", "models.yml");

/**
 * The tracked skill tree copied into the fixture HOME's configured root. The
 * probe never invents a skill root: `agent.skillsDir` is the SAME provisioned
 * root, so the shipped factory, connector inventory and confinement consumer all
 * observe one root, exactly as in production.
 */
const TRACKED_SKILLS_DIR = join(REPO_ROOT, "skills");

/** The child-process driver that performs the factory + lifecycle under trace. */
const DRIVER_PATH = join(REPO_ROOT, "tests/mocks/omp-native-lifecycle-driver.ts");

/** The fixture model's id, as authored in the fixture YAML. */
const FIXTURE_MODEL_ID = "parity-fixture";

/**
 * The fixture model's ACTUAL advertised catalog selector.
 *
 * OMP's registry keeps `provider` + `id` identities and its ACP catalog
 * advertises the concrete `provider/modelId` value (docs/models.md "Provider and
 * model identity"). The connector's stable-first resolution matches advertised
 * values case-insensitively and only EXACTLY (`src/acp/session-config.ts`), so
 * the bare `parity-fixture` id is a catalog miss by construction. The negative
 * control asserts that and proves the positive selection resolved through the
 * REAL advertised catalog instead of a fabricated or unstable-fallback id.
 */
const FIXTURE_MODEL_SELECTOR = `${FIXTURE_MODEL_ID}/${FIXTURE_MODEL_ID}`;

/** A model id the fixture does not advertise (the catalog-miss control). */
const UNADVERTISED_MODEL_ID = "not-a-fixture-model";

/** Bounded wait for the pool's documented release drain before teardown. */
const POOL_IDLE_TIMEOUT_MS = 60_000;

/** Bounded poll interval while waiting for the pool's documented idle state. */
const POOL_IDLE_POLL_MS = 25;

/** Native artifacts a real OMP start leaves beneath its selected data root. */
const EXPECTED_NATIVE_STATE = ["agent.db", "sessions"];

/**
 * Acceptance mode. Set for the documented acceptance run so every prerequisite
 * becomes REQUIRED and is reported as a FAILURE naming the exact reason. Unset
 * (ordinary `deno task test` / CI), an unavailable prerequisite leaves the leg
 * UNEXERCISED instead of passing a native claim.
 */
const ACCEPTANCE_MODE = Deno.env.get("OMP_NATIVE_ACCEPTANCE") === "1";

// ---------------------------------------------------------------------------
// Synchronous prerequisite observation
// ---------------------------------------------------------------------------

/** One synchronous command result; a missing binary yields `ran: false`. */
interface SyncProbe {
  readonly ran: boolean;
  readonly success: boolean;
  readonly stdout: string;
}

function runSyncProbe(command: string, args: readonly string[]): SyncProbe {
  try {
    const output = new Deno.Command(command, {
      args: [...args],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    return {
      ran: true,
      success: output.success,
      stdout: new TextDecoder().decode(output.stdout).trim(),
    };
  } catch {
    return { ran: false, success: false, stdout: "" };
  }
}

/** Resolve an executable on `PATH` to its absolute spelling, without a shell. */
function resolveOnPath(name: string): string | undefined {
  for (const dir of (Deno.env.get("PATH") ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    try {
      if (Deno.statSync(candidate).isFile) return candidate;
    } catch {
      // Not in this directory; keep scanning.
    }
  }
  return undefined;
}

/** The detected `omp --version` output, exactly as the installed binary prints it. */
const OMP_VERSION_PROBE = runSyncProbe("omp", ["--version"]);

/**
 * The parsed `major.minor.patch` of the detected executable, or `null`.
 *
 * Requires a successful invocation and rejects prerelease/build suffixes: the
 * pin is an exact release, so `18.6.1-beta` or a failed probe never counts.
 */
const DETECTED_OMP_VERSION: string | null = (() => {
  if (!OMP_VERSION_PROBE.ran || !OMP_VERSION_PROBE.success) return null;
  return /(?:^|[^\d.])(\d+\.\d+\.\d+)(?![\d.+-])/.exec(OMP_VERSION_PROBE.stdout)?.[1] ?? null;
})();

/** True only for the exact pinned release; any other version is not evidence. */
const PINNED_BINARY_READY = DETECTED_OMP_VERSION === PINNED_OMP_VERSION;

/** Absolute `strace` path when the host provides one (the write observer). */
const TRACER_PATH = resolveOnPath("strace");

/** Why this host cannot materialise the production confinement mount list. */
const CONFINEMENT_HOST_REASON =
  "the host exposes /usr/local as a symlink into /var (Fedora Silverblue-style topology), " +
  "so bwrap cannot create the default read-only bind destination /usr/local/bin";

/**
 * Whether THIS host has the topology that cannot materialise the production
 * confinement mount list at all.
 *
 * `canConfineFilesystem()` only proves bwrap can create a user/mount namespace.
 * `--ro-bind-try` tolerates a missing SOURCE, but bwrap aborts the whole spawn
 * when it cannot create a bind DESTINATION, and the shared default read-only set
 * includes `/usr/local/bin` — unspawnable wherever `/usr/local` is a symlink into
 * `/var`. The existing real-bwrap IO controls
 * (`tests/acp/sandbox-manager.test.ts`) gate on exactly this condition, so both
 * agree on which hosts can produce confinement evidence; nothing here falls back
 * to unconfined success.
 */
function confinementHostUnsupported(): boolean {
  if (!canConfineFilesystem()) return false;
  try {
    return Deno.lstatSync("/usr/local").isSymlink;
  } catch {
    return false;
  }
}

/** True when a REAL confined spawn can be attempted on this host. */
const CONFINEMENT_READY = canConfineFilesystem() && !confinementHostUnsupported();

/**
 * The exact pinned executable must be present, must answer `--version`
 * successfully, and must report the pin. Never softened: a mismatched version is
 * a FAILED prerequisite, not a substitute binary.
 */
function assertPinnedBinaryPrerequisite(): void {
  if (!OMP_VERSION_PROBE.ran) {
    throw new Error("native prerequisite failed: no `omp` executable on PATH");
  }
  if (!OMP_VERSION_PROBE.success) {
    throw new Error(
      `native prerequisite failed: 'omp --version' exited non-zero (output: ${
        JSON.stringify(OMP_VERSION_PROBE.stdout)
      })`,
    );
  }
  if (DETECTED_OMP_VERSION !== PINNED_OMP_VERSION) {
    throw new Error(
      `native prerequisite failed: the installed executable reports ${
        DETECTED_OMP_VERSION ?? JSON.stringify(OMP_VERSION_PROBE.stdout)
      }, the acceptance requires exactly ${PINNED_OMP_VERSION}`,
    );
  }
}

/** The filesystem observer must exist; there is no byte-equality substitute. */
function assertObserverPrerequisite(): void {
  if (TRACER_PATH === undefined) {
    throw new Error(
      "native prerequisite failed: no `strace` filesystem observer on PATH — the " +
        "authored-configuration write requirement cannot be observed",
    );
  }
}

/** A real confined spawn must be possible; there is no unconfined fallback. */
function assertConfinementPrerequisites(): void {
  if (!canConfineFilesystem()) {
    throw new Error(
      "native prerequisite failed: bwrap cannot establish a user/mount namespace in this " +
        "runtime (unprivileged user namespaces appear disabled)",
    );
  }
  if (confinementHostUnsupported()) {
    throw new Error(
      `native prerequisite failed: this host cannot materialise the production confinement ` +
        `mount list — ${CONFINEMENT_HOST_REASON}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture provisioning (the named setup boundary)
// ---------------------------------------------------------------------------

/** One provisioned native probe environment. */
interface NativeFixture {
  /** Temporary deployment root; also the `workspace.repoPath` used by the pool. */
  readonly root: string;
  /** Temporary HOME carrying the authored model fixture at its native path. */
  readonly home: string;
  /** The session workspace (agent cwd; holds the per-spawn TMPDIR). */
  readonly workspace: string;
  /** The ONE configured skill root, provisioned from tracked skill bytes. */
  readonly skillsRoot: string;
  /**
   * The synthetic-payload selection seam, present only for a `"synthetic"`
   * fixture leg. The `"prepared"` legs leave it `undefined` so the shipped
   * resolver selects the operator's real prepared payload.
   */
  readonly nativeCacheSelection?: {
    readonly installRoot: string;
    readonly launchExecutableVersion: string;
  };
}

/**
 * Write a COMPLETE stand-in native payload (never executed) so an ungated leg
 * can drive the factory's cache preflight without an installed executable or a
 * prepared cache. Byte content is irrelevant here: no OMP process is spawned.
 */
function writeSyntheticNativeCachePayload(base: string): OmpNativeCache {
  const platform = ompNativeCachePlatform();
  const cache = ompNativeCacheDescriptor(base, platform, "development");
  const { exact } = ompNativeCacheExpectedAddons(platform);
  // The arm64 requirement is a pattern (`pi_natives.*linux-arm64*.node`); this
  // name satisfies it without a binary.
  const names = exact.length > 0 ? [...exact] : ["pi_natives.synthetic-linux-arm64.node"];
  Deno.mkdirSync(cache.versionDir, { recursive: true });
  const files = names.map((name) => {
    const bytes = new TextEncoder().encode(`synthetic native stand-in ${name}`);
    Deno.writeFileSync(join(cache.versionDir, name), bytes);
    return { name, size: bytes.byteLength };
  });
  Deno.writeTextFileSync(
    cache.manifestPath,
    serializeOmpNativeCacheManifest({
      version: OMP_NATIVE_CACHE_VERSION,
      platform,
      executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256[platform],
      files,
    }),
  );
  return cache;
}

/**
 * Which shared native payload a fixture leg consumes.
 *
 * - `"prepared"` (default, the gated native legs): expose the operator's
 *   AMBIENT development cache through `XDG_CACHE_HOME`, so the shipped resolver
 *   selects the REAL payload `deno task prepare:omp-natives` published (the
 *   documented acceptance prerequisite) even though this fixture overrides HOME
 *   to its own temporary tree.
 * - `"synthetic"`: publish a complete stand-in payload under a temporary cache
 *   OUTSIDE the fixture data root and hand back its selection seam, so the
 *   ungated fixture leg never needs an installed executable or prepared cache.
 */
type FixtureNativeCache = "prepared" | "synthetic";

/**
 * Provision the fixture boundary: temporary HOME + authored model bytes + the
 * configured skill root, with `HOME` exported for the duration (the shipped
 * factory inherits HOME and the confinement mounts the inherited HOME's native
 * model file). The parent environment is restored in `finally`.
 */
async function withNativeFixture(
  run: (fixture: NativeFixture) => Promise<void>,
  nativeCache: FixtureNativeCache = "prepared",
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "air-omp-native-runtime-" });
  const previousHome = Deno.env.get("HOME");
  const previousCacheHome = Deno.env.get("XDG_CACHE_HOME");
  let syntheticCacheRoot: string | undefined;
  try {
    const home = join(root, "home");
    const skillsRoot = join(home, ".agents", "skills");
    const workspace = join(root, "workspace");
    await Deno.mkdir(join(home, ".omp", "agent"), { recursive: true });
    await Deno.mkdir(join(workspace, "tmp"), { recursive: true });

    // Authored bytes are installed FIRST: the observation interval starts only
    // after this provisioning, so every later access is a production/native
    // access rather than a setup write.
    await copy(FIXTURE_MODELS_PATH, join(home, HOME_MODELS_RELATIVE));
    await copy(TRACKED_SKILLS_DIR, skillsRoot);

    const authoredBytes = await Deno.readTextFile(FIXTURE_MODELS_PATH);
    assertEquals(
      await Deno.readTextFile(join(home, HOME_MODELS_RELATIVE)),
      authoredBytes,
      "fixture provisioning installs the authored bytes verbatim",
    );

    Deno.env.set("HOME", home);
    let nativeCacheSelection: NativeFixture["nativeCacheSelection"];
    if (nativeCache === "synthetic") {
      syntheticCacheRoot = await Deno.makeTempDir({ prefix: "air-omp-native-cache-" });
      const payload = writeSyntheticNativeCachePayload(syntheticCacheRoot);
      Deno.env.set("XDG_CACHE_HOME", syntheticCacheRoot);
      nativeCacheSelection = {
        installRoot: payload.installRoot,
        launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
      };
    } else {
      // The ambient development cache base the documented preparation command
      // writes to, captured BEFORE HOME was overridden.
      const ambientBase = previousCacheHome?.trim() ||
        join(previousHome ?? home, ".cache");
      Deno.env.set("XDG_CACHE_HOME", ambientBase);
    }
    await run({ root, home, workspace, skillsRoot, nativeCacheSelection });
  } finally {
    if (previousHome === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", previousHome);
    if (previousCacheHome === undefined) Deno.env.delete("XDG_CACHE_HOME");
    else Deno.env.set("XDG_CACHE_HOME", previousCacheHome);
    if (syntheticCacheRoot !== undefined) {
      await Deno.remove(syntheticCacheRoot, { recursive: true }).catch(() => {});
    }
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

/** The production sandbox posture used by each leg of the probe. */
function probeSandbox(filesystemConfinement: boolean): SandboxConfig {
  return {
    filterEnv: true,
    networkIsolation: false,
    allowedEnvVars: [],
    allowedWriteExtensions: [".md", ".txt"],
    filesystemConfinement,
    egressProxy: false,
    egressProxyPort: 0,
    // The existing sandbox option that keeps the parent network namespace shared
    // (the loopback Skill API stays reachable); no network isolation is added.
    unrestrictedEgress: true,
    egressAllowHosts: [],
  };
}

/** Build the production configuration for one probe leg. */
function probeConfig(fixture: NativeFixture, filesystemConfinement: boolean): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: {
      defaultAgentType: "omp",
      model: FIXTURE_MODEL_ID,
      tokenLimit: 20_000,
      systemPromptPath: join(REPO_ROOT, "prompts/system_reply.md"),
      skillsDir: fixture.skillsRoot,
      idleTimeout: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
      sandbox: probeSandbox(filesystemConfinement),
    },
    memory: { recentMessageLimit: 10, workingTierLimit: 10 },
    workspace: { repoPath: fixture.root, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: [],
  };
}

/** Connector options carrying the real factory config and a test client identity. */
function connectorOptionsFor(
  agentConfig: AgentConfig,
  workingDir: string,
  yolo: boolean,
  skillRegistry: SkillRegistry,
): AgentConnectorOptions {
  return {
    agentConfig,
    clientConfig: {
      workingDir,
      platform: "discord",
      userId: "user",
      channelId: "channel",
      isDM: false,
      yolo,
    },
    skillRegistry,
    logger: new Logger("omp-native-runtime-smoke", { level: LogLevel.FATAL }),
    agentType: "omp",
  };
}

/**
 * Wait for the pool's documented idle state (its single release path has fully
 * completed) with a hard deadline. A real poll is required here: `isIdle()` is
 * driven by the pool's own release lifecycle, which the determinism rules
 * deliberately forbid fake timers from driving across a real subprocess.
 */
async function waitForPoolIdle(pool: AgentProcessPool, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pool.isIdle() && Date.now() < deadline) {
    const { promise, resolve: done } = Promise.withResolvers<void>();
    setTimeout(done, POOL_IDLE_POLL_MS);
    await promise;
  }
  assert(pool.isIdle(), "the pool released its lease within the documented drain budget");
}

/** Whether a pid still exists (Linux `/proc`); used for the leak assertion. */
function processAlive(pid: number): boolean {
  try {
    Deno.statSync(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * A pid plus every live descendant (`pgrep -P`, the same enumeration the pool's
 * own child drain uses), so the leak assertion covers the native process beneath
 * its `dumb-init`/`bwrap` wrappers rather than only the wrapper itself.
 */
async function liveProcessTree(pid: number): Promise<number[]> {
  const tree = [pid];
  const seen = new Set<number>([pid]);
  const queue = [pid];
  while (queue.length > 0 && seen.size < 64) {
    const parent = queue.shift()!;
    const output = await new Deno.Command("pgrep", {
      args: ["-P", String(parent)],
      stdout: "piped",
      stderr: "null",
    }).output().catch(() => null);
    if (output === null || !output.success) continue;
    for (const token of new TextDecoder().decode(output.stdout).split("\n")) {
      const child = Number(token.trim());
      if (token.trim() === "" || !Number.isInteger(child) || seen.has(child)) continue;
      seen.add(child);
      tree.push(child);
      queue.push(child);
    }
  }
  return tree;
}

/** Record a connector's live native process tree (wrapper plus descendants). */
async function recordProcessTree(
  connector: AgentConnector,
  into: Set<number>,
): Promise<void> {
  const pid = connector.getProcessPid();
  if (pid === undefined) return;
  for (const treePid of await liveProcessTree(pid)) into.add(treePid);
}

/** Boundedly wait for every recorded process to exit; returns the survivors. */
async function waitForProcessesGone(
  pids: Iterable<number>,
  timeoutMs: number,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  let survivors = [...pids].filter(processAlive);
  while (survivors.length > 0 && Date.now() < deadline) {
    const { promise, resolve: done } = Promise.withResolvers<void>();
    setTimeout(done, POOL_IDLE_POLL_MS);
    await promise;
    survivors = survivors.filter(processAlive);
  }
  return survivors;
}

// ---------------------------------------------------------------------------
// Filesystem write observation
// ---------------------------------------------------------------------------

/** The syscalls the observer classifies (the design's exact trace set). */
const OBSERVED_SYSCALLS = [
  "openat",
  "openat2",
  "creat",
  "rename",
  "renameat",
  "renameat2",
  "unlink",
  "unlinkat",
] as const;

/** Longest-first syscall alternation, so `openat2` never parses as `openat`. */
const SYSCALL_PATTERN =
  /(?:^|\s)(openat2|renameat2|renameat|unlinkat|openat|creat|rename|unlink)\(/;

/** Writable-open / mutating flag text in an `openat`/`openat2`/`creat` line. */
const WRITABLE_OPEN_FLAGS = /O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND/;

/** One observed mutating filesystem event. */
interface MutationEvent {
  readonly syscall: string;
  /** Pathname operands in argument order (absolute or relative spellings). */
  readonly operands: readonly string[];
  /** Directory paths strace decoded for descriptor arguments (`-y`). */
  readonly fdDirs: readonly string[];
  /** Whether the syscall completed successfully (`= <non-negative>`). */
  readonly succeeded: boolean;
}

/** Unescape strace's C-style quoting of a pathname operand. */
function unescapeOperand(operand: string): string {
  return operand.replace(/\\(.)/g, "$1");
}

/** Whether a parsed syscall is a mutation (creation, replacement or deletion). */
function isMutation(syscall: string, line: string): boolean {
  if (syscall.startsWith("rename") || syscall === "unlink" || syscall === "unlinkat") return true;
  if (syscall === "creat") return true;
  return WRITABLE_OPEN_FLAGS.test(line);
}

/** Every mutating filesystem event in a raw strace log. */
function parseMutationEvents(traceText: string): MutationEvent[] {
  const events: MutationEvent[] = [];
  for (const line of traceText.split("\n")) {
    const syscall = SYSCALL_PATTERN.exec(line)?.[1];
    if (syscall === undefined || !isMutation(syscall, line)) continue;
    const operands = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
      unescapeOperand(match[1])
    );
    const result = /\)\s*=\s*(-?\d+)/.exec(line);
    // `-y` renders descriptor ARGUMENTS as `3</some/dir>`; those decoded
    // directories are what resolves a relative pathname operand. Only the
    // argument part counts: a decoded RETURN descriptor (e.g. `= 9</cfg/x>`)
    // names the file that was opened, never a base directory.
    const argsPart = line.slice(0, result === null ? line.length : result.index);
    const fdDirs = [...argsPart.matchAll(/<([^<>]*)>/g)]
      .map((match) => match[1])
      .filter((path) => path.startsWith("/"));
    events.push({
      syscall,
      operands,
      fdDirs,
      succeeded: result !== null && Number(result[1]) >= 0,
    });
  }
  return events;
}

/**
 * Resolve an event's pathname operands to normalized absolute spellings.
 *
 * `resolved` holds operands that are absolute or that a decoded descriptor
 * directory resolves; `unresolved` holds relative operands this observer cannot
 * place on the filesystem. Normalization matters: `/cfg/./models.yml` and
 * `/cfg/models.yml` are the same file, and an escaped or dotted spelling must
 * not slip past the comparison. Callers must treat an unresolved operand naming
 * a watched file as a POTENTIAL write (fail closed) rather than as unrelated.
 */
function eventPaths(event: MutationEvent): { resolved: string[]; unresolved: string[] } {
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const operand of event.operands) {
    if (operand.startsWith("/")) {
      resolved.push(resolve(operand));
    } else if (event.fdDirs.length > 0) {
      for (const dir of event.fdDirs) resolved.push(resolve(join(dir, operand)));
    } else {
      unresolved.push(operand);
    }
  }
  return { resolved, unresolved };
}

/** Mutating events that name any of `watched` (fail-closed on unresolved names). */
function eventsTouching(
  events: readonly MutationEvent[],
  watched: readonly string[],
): MutationEvent[] {
  const watchedPaths = new Set(watched.map((path) => resolve(path)));
  const watchedNames = new Set(watched.map((path) => basename(path)));
  return events.filter((event) => {
    const { resolved, unresolved } = eventPaths(event);
    if (resolved.some((path) => watchedPaths.has(path))) return true;
    return unresolved.some((path) => watchedNames.has(basename(path)));
  });
}

/** Successfully COMPLETED mutating events beneath a directory (attempts excluded). */
function successfulEventsBeneath(
  events: readonly MutationEvent[],
  directory: string,
): MutationEvent[] {
  const root = resolve(directory);
  return events.filter((event) =>
    event.succeeded && eventPaths(event).resolved.some((path) => path.startsWith(`${root}/`))
  );
}

/**
 * Authored paths the native start really opened READ-ONLY and successfully.
 * Without this consumption evidence a "no writes" result would be vacuous: the
 * observer must prove it saw the native process actually read the authored bytes.
 */
function readOnlyConsumptions(traceText: string, paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const watched = new Map(paths.map((path) => [resolve(path), path]));
  const pattern = /(?:^|\s)(openat2|openat)\(/;
  for (const line of traceText.split("\n")) {
    if (!pattern.test(line) || !line.includes("O_RDONLY")) continue;
    if (WRITABLE_OPEN_FLAGS.test(line)) continue;
    if (!/\)\s*=\s*\d+/.test(line)) continue;
    const operand = /"((?:[^"\\]|\\.)*)"/.exec(line)?.[1];
    if (operand === undefined) continue;
    const original = watched.get(resolve(unescapeOperand(operand)));
    if (original !== undefined) seen.add(original);
  }
  return [...seen];
}

/**
 * Trace the PRODUCTION FACTORY and the NATIVE START in one interval.
 *
 * The factory is not a subprocess, so wrapping only the spawned command would
 * never observe it. The driver process performs the shipped
 * `createAgentConfig` construction and the whole real connector lifecycle, and
 * is run under `strace -f`, so the factory's own syscalls and every native
 * descendant land in ONE trace — with the production argv left unwrapped and no
 * second-invocation truncation (the recovery respawn is a descendant of the same
 * traced process).
 */
async function runTracedLifecycle(params: {
  readonly driverParams: DriverParams;
  readonly tracePath: string;
  readonly paramsPath: string;
  readonly home: string;
}): Promise<{ readonly success: boolean; readonly stderr: string }> {
  assert(TRACER_PATH !== undefined, "the traced lifecycle requires strace");
  await Deno.writeTextFile(params.paramsPath, JSON.stringify(params.driverParams));
  const output = await new Deno.Command("dumb-init", {
    args: [
      "--",
      TRACER_PATH,
      "-f",
      "-s",
      "256",
      "-y",
      "-e",
      `trace=${OBSERVED_SYSCALLS.join(",")}`,
      "-o",
      params.tracePath,
      "--",
      Deno.execPath(),
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      "--allow-ffi",
      DRIVER_PATH,
      params.paramsPath,
    ],
    cwd: REPO_ROOT,
    env: { ...Deno.env.toObject(), HOME: params.home },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: output.success,
    stderr: new TextDecoder().decode(output.stderr),
  };
}

// ---------------------------------------------------------------------------
// Test 1 — the observer's own classification contract
// ---------------------------------------------------------------------------

Deno.test("native probe observer: mutating events are resolved and classified fail-closed", () => {
  const trace = [
    // Absolute writable open of a watched file: a mutation.
    `100  openat(AT_FDCWD, "/cfg/models.yml", O_RDWR|O_CREAT, 0644) = 7`,
    // Read-only open of the same file: NOT a mutation, but consumption evidence.
    `100  openat(AT_FDCWD, "/cfg/models.yml", O_RDONLY|O_NOCTTY) = 8`,
    // Relative writable open whose descriptor directory strace decoded.
    `100  openat(3</cfg>, "models.yml", O_WRONLY) = 9`,
    // Relative writable open with no decoded descriptor: must stay unresolved.
    `100  openat(3, "models.yml", O_RDWR) = 10`,
    // Undecoded input descriptor plus a decoded RETURN descriptor: the return
    // value names the file that was opened, never a base directory.
    `100  openat(3, "models.yml", O_RDWR) = 10</cfg/models.yml>`,
    // The same watched file spelled with a dot segment.
    `100  openat(AT_FDCWD, "/cfg/./models.yml", O_WRONLY) = 11`,
    // openat2 carries its flags inside the struct form.
    `100  openat2(AT_FDCWD, "/data/agent.db", {flags=O_RDWR|O_CREAT|O_CLOEXEC, resolve=0x0}) = 11`,
    // Failed writable open: an attempt, never a successful write.
    `100  openat(AT_FDCWD, "/cfg/restricted.yml", O_RDWR) = -1 EACCES (Permission denied)`,
    // Replacement destinations are classified whichever dirfd form they use.
    `100  renameat2(3</cfg>, "models.yml.tmp", 3</cfg>, "models.yml", RENAME_NOREPLACE) = 0`,
    `100  unlinkat(AT_FDCWD, "/cfg/restricted.yml.tmp", 0) = 0`,
    // Unfinished records carry no result: treated as attempted, not successful.
    `100  openat(AT_FDCWD, "/cfg/models.yml", O_RDWR <unfinished ...>`,
    `100  <... openat resumed>) = 12`,
    // A failed attempt beneath the native data root is still only an attempt.
    `100  openat(AT_FDCWD, "/data/failed.db", O_RDWR|O_CREAT, 0644) = -1 ENOENT (No such file)`,
  ].join("\n");

  const events = parseMutationEvents(trace);
  const watchedModels = "/cfg/models.yml";

  // Nine writable openat/openat2 forms (absolute, descriptor-decoded relative,
  // two undecoded relative, dot-segment spelling, openat2 struct form, two
  // failed attempts, unfinished record); the read-only open and the resumed
  // record are not mutations.
  assertEquals(
    events.filter((event) => event.syscall.startsWith("openat")).length,
    9,
    "writable openat/openat2 forms are classified, read-only opens are not",
  );
  // Every spelling that designates the watched file counts: absolute, dot
  // segment, descriptor-decoded relative, and the unresolved relative operand.
  assertEquals(
    eventsTouching(events, [watchedModels]).length,
    7,
    "absolute, dot-segment, descriptor-decoded and unresolved spellings all match",
  );
  // The decoded RETURN descriptor must never be used as a directory base.
  assertEquals(
    events.some((event) => eventPaths(event).resolved.includes("/cfg/models.yml/models.yml")),
    false,
    "a return-descriptor annotation is not a directory base",
  );
  // The failed attempt touches the second watched file; the unlinkat names a
  // DIFFERENT file (`restricted.yml.tmp`), so it must not be attributed to it.
  assertEquals(
    eventsTouching(events, ["/cfg/restricted.yml"]).length,
    1,
    "the failed writable attempt touches the watched file and the temp unlink does not",
  );
  // Fail closed: the unresolved relative operand cannot be placed, so it is
  // reported for ANY watched file of that name rather than silently ignored.
  const unresolvedMatch = eventsTouching(events, ["/elsewhere/models.yml"]);
  assertEquals(
    unresolvedMatch.length,
    2,
    "an unresolved relative operand matching a watched basename is still reported",
  );
  assertEquals(
    unresolvedMatch.every((event) => event.fdDirs.length === 0),
    true,
    "both matches are operands with no decoded descriptor",
  );
  assertEquals(
    eventsTouching(events, ["/elsewhere/unwatched.yml"]),
    [],
    "an unrelated basename matches nothing",
  );
  // Completion is distinguished from attempt BY THE HELPER: the failed attempt
  // beneath /data is excluded while the successful openat2 is counted.
  assertEquals(
    successfulEventsBeneath(events, "/data").length,
    1,
    "only the successful native-data mutation counts as a positive control",
  );
  // Successfully completed mutations under /cfg: the two absolute writable opens
  // (one with a dot segment), the descriptor-decoded relative open, the
  // replacement and the unlink. The failed open and the unfinished record are
  // attempts, so they are excluded (while still counting as mutations above).
  assertEquals(successfulEventsBeneath(events, "/cfg").length, 5);
  // The dot-segment spelling is normalized to the watched file.
  assertEquals(
    eventPaths(events.find((event) => event.operands.includes("/cfg/./models.yml"))!)
      .resolved.includes(watchedModels),
    true,
  );
  // Consumption evidence requires a SUCCESSFUL read-only open.
  assertEquals(readOnlyConsumptions(trace, ["/cfg/models.yml"]), ["/cfg/models.yml"]);
  assertEquals(readOnlyConsumptions(trace, ["/data/agent.db"]), []);
});

// ---------------------------------------------------------------------------
// Test 2 — authored fixture and the provisioning boundary (no native binary)
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "native probe fixture: authored model bytes are installed into the configured HOME and skill root",
  fn: async () => {
    const authored = await Deno.readTextFile(FIXTURE_MODELS_PATH);
    // Hand-authored, never generated: the design's one credential-free,
    // zero-cost provider/model field set (provisioning identity, not native
    // schema or no-write evidence).
    assert(authored.includes(`${FIXTURE_MODEL_ID}:`), "authored provider key");
    assert(authored.includes("baseUrl: http://127.0.0.1:43187/v1"), "authored loopback baseUrl");
    assert(authored.includes("auth: none"), "authored credential-free provider");
    assert(authored.includes("api: openai-completions"), "authored provider api");
    assert(authored.includes(`- id: ${FIXTURE_MODEL_ID}`), "authored model id");
    assert(authored.includes("contextWindow: 8192"), "authored context window");
    assert(authored.includes("maxTokens: 1024"), "authored max tokens");
    assert(authored.includes("cacheWrite: 0"), "authored zero cost");

    const parentHome = Deno.env.get("HOME");
    await withNativeFixture(async (fixture) => {
      // The observation boundary: authored bytes installed, HOME exported, the
      // ONE configured skill root provisioned from tracked skill bytes.
      assertEquals(await Deno.readTextFile(join(fixture.home, HOME_MODELS_RELATIVE)), authored);
      assertEquals(Deno.env.get("HOME"), fixture.home);
      const observation = observeTrustedSkillsRoot("omp", fixture.skillsRoot);
      assertEquals(observation.root, await Deno.realPath(fixture.skillsRoot));
      assert(observation.identity !== undefined, "the provisioned root carries an identity");

      // The configured root IS the provisioned root (one root for every consumer).
      const config = probeConfig(fixture, false);
      // This leg runs without an installed executable or a prepared cache, so it
      // consumes the fixture's complete stand-in payload through the documented
      // internal selection seam (no OMP process is spawned here).
      config.agent.ompNativeCache = fixture.nativeCacheSelection;
      assertEquals(config.agent.skillsDir, fixture.skillsRoot);
      const agentConfig = createAgentConfig("omp", fixture.workspace, config, false);
      assertEquals(agentConfig.skillsRoot?.root, observation.root);

      // The authored mode document is selected verbatim, and nothing generates
      // or rewrites configuration inside the fixture root.
      const selected = [
        ...agentConfig.args.filter((_arg, index) =>
          agentConfig.args[index - 1] === "--config" ||
          agentConfig.args[index - 1] === "--system-prompt"
        ),
        join(fixture.home, HOME_MODELS_RELATIVE),
      ];
      assert(
        selected.some((path) => path.endsWith("restricted.yml")),
        `the restricted launch selected an authored mode document: ${selected.join(", ")}`,
      );
      for (const entry of Deno.readDirSync(fixture.root)) {
        assert(
          entry.name === "home" || entry.name === "workspace",
          `the fixture root gained unexpected entry ${entry.name}`,
        );
      }
    }, "synthetic");

    // The parent environment is restored once the fixture boundary closes.
    assertEquals(Deno.env.get("HOME"), parentHome);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ---------------------------------------------------------------------------
// Test 3 — traced factory + real unconfined native lifecycle in BOTH modes
// ---------------------------------------------------------------------------

Deno.test({
  name: `native OMP ACP lifecycle in both launch modes: traced production factory + real ` +
    `${PINNED_OMP_VERSION} start, advertised fixture catalog, respawn+load, zero authored writes`,
  // Acceptance mode makes the prerequisites REQUIRED (the body fails loudly);
  // otherwise an unavailable runtime leaves this evidence UNEXERCISED.
  ignore: !ACCEPTANCE_MODE && !(PINNED_BINARY_READY && TRACER_PATH !== undefined),
  fn: async () => {
    assertPinnedBinaryPrerequisite();
    assertObserverPrerequisite();

    await withNativeFixture(async (fixture) => {
      const config = probeConfig(fixture, false);

      for (const mode of ["restricted", "native-yolo"] as const) {
        const tracePath = join(fixture.root, `strace-${mode}.log`);
        const paramsPath = join(fixture.root, `params-${mode}.json`);
        const resultPath = join(fixture.root, `result-${mode}.json`);
        const driverParams: DriverParams = {
          config,
          mode,
          workspace: fixture.workspace,
          agentType: "omp",
          sessionId: "probe-session",
          fixtureModelSelector: FIXTURE_MODEL_SELECTOR,
          unadvertisedModelId: UNADVERTISED_MODEL_ID,
          resultPath,
        };
        const run = await runTracedLifecycle({
          driverParams,
          tracePath,
          paramsPath,
          home: fixture.home,
        });
        assert(run.success, `${mode}: traced driver failed: ${run.stderr}`);

        const result = JSON.parse(await Deno.readTextFile(resultPath)) as DriverResult;
        assert(result.sessionId.length > 0, `${mode}: the native agent returned a real session id`);
        assertEquals(result.resumed, true, `${mode}: the real session was restored`);
        // The negative control's rejection message carries the REAL advertised
        // catalog, so the positive selection provably resolved through it.
        assert(
          result.catalogMissMessage.includes("is not offered in advertised catalog"),
          `${mode}: the unadvertised control was rejected as a catalog miss: ${result.catalogMissMessage}`,
        );
        assert(
          result.catalogMissMessage.includes(FIXTURE_MODEL_SELECTOR),
          `${mode}: the rejection names the advertised fixture selector`,
        );
        assertEquals(
          result.dataRoot,
          ompXdgDataHome(join(fixture.workspace, "tmp"), mode),
          `${mode}: the factory selected this mode's native data root`,
        );
        assert(
          result.settingsPath.endsWith(`${mode}.yml`),
          `${mode}: the launch selected this mode's authored document`,
        );

        // Native persistence beneath the SELECTED mode root, including the
        // artifacts `session/load` needs.
        const nativeState = [...Deno.readDirSync(join(result.dataRoot, "omp"))].map((entry) =>
          entry.name
        );
        for (const expected of EXPECTED_NATIVE_STATE) {
          assert(
            nativeState.includes(expected),
            `${mode}: native state "${expected}" is present (found ${nativeState.join(", ")})`,
          );
        }

        const traceText = await Deno.readTextFile(tracePath);
        const events = parseMutationEvents(traceText);
        // Positive control: the observer really saw this mode's native writes.
        assert(
          successfulEventsBeneath(events, join(result.dataRoot, "omp")).length > 0,
          `${mode}: the observer saw successful native data writes beneath the selected root`,
        );
        // The authored inputs the launch selected are READ-ONLY for the WHOLE
        // interval, including the recovery respawn (one trace, one traced tree).
        assertEquals(
          eventsTouching(events, result.authoredPaths),
          [],
          `${mode}: no writable open or replacement of authored configuration`,
        );
        // Consumption evidence: the native process really READ the selected mode
        // document and the provisioned fixture model, so the zero-write result
        // above is a real observation rather than an empty trace.
        const settings = result.authoredPaths.find((path) => path.endsWith(`${mode}.yml`));
        assert(settings !== undefined, `${mode}: the launch selected an authored document`);
        const modelsFile = join(fixture.home, HOME_MODELS_RELATIVE);
        assertEquals(
          readOnlyConsumptions(traceText, [settings, modelsFile]).sort(),
          [settings, modelsFile].sort(),
          `${mode}: the native start read the authored mode document and the model fixture`,
        );
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ---------------------------------------------------------------------------
// Test 4 — confined real pool consumers
// ---------------------------------------------------------------------------

/** Read the `key=<n>` lines a confined control script prints. */
function statusReader(stdout: string): (key: string) => number {
  return (key: string) => {
    const match = stdout.match(new RegExp(`(?:^|\\n)${key}=(\\d+)`));
    assert(match !== null, `confined script printed no "${key}" status: ${stdout}`);
    return Number(match[1]);
  };
}

Deno.test({
  name:
    "confined pooled native consumers: opposite modes on one pool key, selected-root IO controls, " +
    "own-data persistence and same-mode reload",
  ignore: !ACCEPTANCE_MODE && !(PINNED_BINARY_READY && CONFINEMENT_READY),
  fn: async () => {
    assertPinnedBinaryPrerequisite();
    assertConfinementPrerequisites();

    await withNativeFixture(async (fixture) => {
      const config = probeConfig(fixture, true);
      const skillRegistry = new SkillRegistry(
        new MemoryStore(new WorkspaceManager(config.workspace), {}),
      );
      const registry = new SessionRegistry();
      const poolKey = "discord:channel";
      const poolBase = join(fixture.root, "omp-pools", poolKey);
      const captured: AgentConnector[] = [];
      const pool = new AgentProcessPool(
        config,
        registry,
        "",
        // The REAL connector: the injection point only captures the instance so
        // the resumed session can be driven through it afterwards.
        (options: AgentConnectorOptions) => {
          const connector = new AgentConnector(options);
          captured.push(connector);
          return connector;
        },
      );

      const runs: Array<{
        mode: "restricted" | "native-yolo";
        connector: AgentConnector;
        sessionId: string;
      }> = [];
      // Every native process tree this leg ever started — the acquire wrapper
      // and its descendants, plus the respawned tree recovery creates — so the
      // leak assertion covers the PROCESSES, not just the connector's latest
      // reference (which `disconnect()` clears regardless of the kill result).
      const recordedPids = new Set<number>();
      try {
        for (
          const { yolo, mode } of [
            { yolo: false, mode: "restricted" as const },
            { yolo: true, mode: "native-yolo" as const },
          ]
        ) {
          const agentConfig = createAgentConfig(
            "omp",
            fixture.workspace,
            config,
            yolo,
            undefined,
            undefined,
            poolKey,
          );
          assertEquals(agentConfig.command, "bwrap", "the confined launch is wrapped by bwrap");

          // The sibling mode's state exists on the host BEFORE the confined
          // spawn, so a failing read inside can only come from the mount policy.
          // It sits OUTSIDE every selected `xdg-data/omp` child so it can never
          // be mistaken for this mode's own native persistence.
          const siblingXdgRoot = ompXdgDataHome(
            poolBase,
            mode === "restricted" ? "native-yolo" : "restricted",
          );
          const siblingMarker = join(siblingXdgRoot, "sibling-marker");
          await Deno.mkdir(siblingXdgRoot, { recursive: true });
          const siblingSentinel = `sibling-${mode}-sentinel`;
          await Deno.writeTextFile(siblingMarker, siblingSentinel);
          assertEquals(await Deno.readTextFile(siblingMarker), siblingSentinel);

          const options: PoolRunOptions = {
            poolKey,
            agentType: "omp",
            permissionMode: mode,
            sessionType: "message",
            shellSessionId: null,
            priority: "interactive",
            sessionCwd: fixture.workspace,
            connectorOptions: connectorOptionsFor(
              agentConfig,
              fixture.workspace,
              yolo,
              skillRegistry,
            ),
          };
          const capturedBefore = captured.length;
          const result = await pool.run(options, async (session, runOptions) => {
            const sessionId = await session.createSession([], runOptions.sessionCwd);
            await assertRejects(
              () => session.setSessionModel(sessionId, UNADVERTISED_MODEL_ID),
              Error,
              "is not offered in advertised catalog",
            );
            await session.setSessionModel(sessionId, FIXTURE_MODEL_SELECTOR);
            await session.cancel(sessionId);
            return sessionId;
          });
          assert(result.acpSessionId !== null, `${mode}: the real pool consumer created a session`);
          assertEquals(
            captured.length,
            capturedBefore + 1,
            `${mode}: the pool acquired one real connector through its factory`,
          );

          // THIS mode's own selected data root: identifiable native artifacts,
          // never a setup marker.
          const ownDataRoot = join(ompXdgDataHome(poolBase, mode), "omp");
          const nativeState = [...Deno.readDirSync(ownDataRoot)].map((entry) => entry.name);
          for (const expected of EXPECTED_NATIVE_STATE) {
            assert(
              nativeState.includes(expected),
              `${mode}: native state "${expected}" persisted in its own data root (found ${
                nativeState.join(", ")
              })`,
            );
          }

          runs.push({
            mode,
            connector: captured[captured.length - 1],
            sessionId: result.acpSessionId,
          });
          await recordProcessTree(captured[captured.length - 1], recordedPids);
        }

        // ── Per-spawn confined root ───────────────────────────────────────────
        // The complementary launch shape: the per-spawn factory puts the mode
        // data under the session TMPDIR and tmpfs-shadows its `omp-agent` parent.
        // The payload's HARD ro bind is emitted LAST, after that shadow and after
        // the late writable child re-bind that restores the path the `natives`
        // link resolves through, so reading payload bytes through the link proves
        // the shadow does not hide the payload binding (task 4.1).
        const perSpawnCwd = join(fixture.root, "per-spawn-workspace");
        await Deno.mkdir(join(perSpawnCwd, "tmp"), { recursive: true });
        const perSpawnConfig = createAgentConfig("omp", perSpawnCwd, config, false);
        const perSpawnMounts = perSpawnConfig.runtimeMounts;
        assert(perSpawnMounts !== undefined, "the per-spawn factory exposes its runtime mounts");
        const payloadDir = perSpawnMounts.payloadReadOnlyPaths?.[0];
        assert(
          payloadDir !== undefined,
          "the per-spawn factory selects exactly one shared payload",
        );
        const perSpawnShadowedParent = join(perSpawnCwd, "tmp", "omp-agent");
        const perSpawnLink = join(
          ompXdgDataHome(join(perSpawnCwd, "tmp"), "restricted"),
          "omp",
          "natives",
        );
        assertEquals(
          Deno.readLinkSync(perSpawnLink),
          payloadDir,
          "the per-spawn root's reserved entry links to the shared payload",
        );
        const perSpawnSiblingMarker = join(
          perSpawnShadowedParent,
          "native-yolo",
          "xdg-data",
          "omp",
          "sibling-marker",
        );
        await Deno.mkdir(dirname(perSpawnSiblingMarker), { recursive: true });
        const perSpawnSiblingSentinel = "per-spawn-sibling-sentinel";
        await Deno.writeTextFile(perSpawnSiblingMarker, perSpawnSiblingSentinel);
        assertEquals(
          await Deno.readTextFile(perSpawnSiblingMarker),
          perSpawnSiblingSentinel,
        );

        const payloadAddon = [...Deno.readDirSync(join(payloadDir, PINNED_OMP_VERSION))]
          .map((entry) => entry.name)
          .find((name) => name.endsWith(".node"));
        assert(payloadAddon !== undefined, "the prepared payload holds a native addon");
        const payloadFile = join(payloadDir, PINNED_OMP_VERSION, payloadAddon);
        const payloadBytesBefore = await Deno.readFile(payloadFile);

        const perSpawnScript = [
          `cat '${join(perSpawnLink, PINNED_OMP_VERSION, payloadAddon)}' >/dev/null`,
          'echo "payload_read_status=$?"',
          `printf '%s' 'tampered' > '${
            join(perSpawnLink, PINNED_OMP_VERSION, payloadAddon)
          }' 2>/dev/null`,
          'echo "payload_write_status=$?"',
          `cat '${perSpawnSiblingMarker}' 2>/dev/null`,
          'echo "sibling_read_status=$?"',
        ].join("\n");
        const perSpawnSpawn = new SandboxManager(probeSandbox(true)).buildSpawnOptions(
          "omp",
          "sh",
          ["-c", perSpawnScript],
          perSpawnConfig.env ?? {},
          perSpawnCwd,
          perSpawnConfig.skillsRoot,
          perSpawnMounts,
        );
        assertEquals(perSpawnSpawn.command, "bwrap");
        const perSpawnSeparator = perSpawnSpawn.args.indexOf("--");
        assertEquals(
          perSpawnSpawn.args.slice(perSpawnSeparator - 3, perSpawnSeparator),
          ["--ro-bind", payloadDir, payloadDir],
          "the payload is the hard-bound LAST mount of the per-spawn launch",
        );
        const perSpawnShadow = perSpawnSpawn.args.findIndex((arg, index) =>
          arg === "--tmpfs" && perSpawnSpawn.args[index + 1] === perSpawnShadowedParent
        );
        assert(perSpawnShadow > -1, "the per-spawn mode parent is tmpfs-shadowed");
        assert(perSpawnShadow < perSpawnSeparator - 3, "the shadow precedes the payload bind");
        assertEquals(
          perSpawnSpawn.args.some((arg, index) =>
            arg === "--ro-bind-try" && perSpawnSpawn.args[index + 1] === payloadDir
          ),
          false,
          "the payload is never bound through the lenient -try variant",
        );

        const perSpawnOutput = await new Deno.Command(perSpawnSpawn.command, {
          args: perSpawnSpawn.args,
          cwd: perSpawnSpawn.cwd,
          env: perSpawnSpawn.env,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assert(
          perSpawnOutput.success,
          `per-spawn confined control exited ${perSpawnOutput.code}: ${
            new TextDecoder().decode(perSpawnOutput.stderr)
          }`,
        );
        const perSpawnStatus = statusReader(new TextDecoder().decode(perSpawnOutput.stdout));
        assertEquals(
          perSpawnStatus("payload_read_status"),
          0,
          "the payload reads through the tmpfs-shadowed mode parent",
        );
        assertEquals(
          perSpawnStatus("payload_write_status") !== 0,
          true,
          "the shared payload refuses writes from the confined view",
        );
        assertEquals(
          perSpawnStatus("sibling_read_status") !== 0,
          true,
          "the per-spawn sibling mode's state stays hidden",
        );
        assertEquals(
          await Deno.readFile(payloadFile),
          payloadBytesBefore,
          "the shared payload bytes stay unchanged",
        );

        // ── Selected-root IO controls through the shipped mount policy ───────
        // The same real-bwrap controls the confinement suite uses, driven by the
        // OMP factory's own runtimeMounts for the restricted launch.
        const restrictedConfig = createAgentConfig(
          "omp",
          fixture.workspace,
          config,
          false,
          undefined,
          undefined,
          poolKey,
        );
        const ownMarker = join(ompXdgDataHome(poolBase, "restricted"), "omp", "probe-marker");
        const forbiddenSkillFile = join(fixture.skillsRoot, "forbidden.md");
        const script = [
          `cat '${join(fixture.home, HOME_MODELS_RELATIVE)}' >/dev/null`,
          'echo "models_read_status=$?"',
          `printf '%s' 'native-probe-marker' > '${ownMarker}'`,
          'echo "own_write_status=$?"',
          `cat '${join(fixture.skillsRoot, "memory-save", "SKILL.md")}' >/dev/null`,
          'echo "skill_read_status=$?"',
          `touch '${forbiddenSkillFile}' 2>/dev/null`,
          'echo "skill_write_status=$?"',
          `cat '${join(ompXdgDataHome(poolBase, "native-yolo"), "sibling-marker")}' 2>/dev/null`,
          'echo "sibling_read_status=$?"',
        ].join("\n");
        const sandbox = new SandboxManager(probeSandbox(true));
        const spawn = sandbox.buildSpawnOptions(
          "omp",
          "sh",
          ["-c", script],
          restrictedConfig.env ?? {},
          fixture.workspace,
          restrictedConfig.skillsRoot,
          restrictedConfig.runtimeMounts,
        );
        assertEquals(spawn.command, "bwrap");
        const output = await new Deno.Command(spawn.command, {
          args: spawn.args,
          cwd: spawn.cwd,
          env: spawn.env,
          stdout: "piped",
          stderr: "piped",
        }).output();
        const stdout = new TextDecoder().decode(output.stdout);
        assert(
          output.success,
          `confined IO control exited ${output.code}: ${new TextDecoder().decode(output.stderr)}`,
        );
        const status = statusReader(stdout);
        assertEquals(status("models_read_status"), 0, "the authored model file reads ro-mounted");
        assertEquals(status("own_write_status"), 0, "the selected native data child is writable");
        assertEquals(await Deno.readTextFile(ownMarker), "native-probe-marker");
        assertEquals(status("skill_read_status"), 0, "the configured skill root reads read-only");
        assert(status("skill_write_status") !== 0, "the skill root refuses writes");
        assert(
          (await Deno.lstat(forbiddenSkillFile).catch(() => null)) === null,
          "the refused skill-root write landed nowhere on the host",
        );
        assert(status("sibling_read_status") !== 0, "the sibling mode's state is unreachable");

        // ── Same-mode session restore through each captured connector ────────
        await waitForPoolIdle(pool, POOL_IDLE_TIMEOUT_MS);
        for (const run of runs) {
          const resumed = await run.connector.reconnectAndResumeSession(
            run.sessionId,
            fixture.workspace,
            [],
          );
          assertEquals(resumed, true, `${run.mode}: the confined session was restored`);
          // Record the respawned tree BEFORE it is torn down below.
          await recordProcessTree(run.connector, recordedPids);
        }
      } finally {
        // Every process tree this leg started is already recorded (each acquire
        // and each recovery respawn); capture the still-live trees once more so
        // nothing started between those points is missed.
        for (const connector of captured) {
          await recordProcessTree(connector, recordedPids);
        }

        await waitForPoolIdle(pool, POOL_IDLE_TIMEOUT_MS).catch(() => {});
        for (const connector of captured) {
          await connector.disconnect().catch(() => {});
        }
        pool.stop();
        registry.stop();

        // Connector-state check: each connector dropped its process reference.
        for (const connector of captured) {
          assertEquals(
            connector.getProcessPid(),
            undefined,
            "every captured connector released its native process",
          );
        }
        // Process-tree evidence: every recorded wrapper AND descendant really
        // exited, not merely that a reference was cleared.
        const survivors = await waitForProcessesGone(recordedPids, POOL_IDLE_TIMEOUT_MS);
        assertEquals(
          survivors,
          [],
          "every native process this leg started exited during teardown",
        );
      }
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
