// tests/acp/email-intent-runtime.test.ts
//
// `email-intent-runtime` — the isolated intent interpretation runtime
// (`src/core/email-intent-runtime.ts`), its ACP deny-all/bounded-capture layer
// (`src/acp/client.ts`) and its intent branch
// (`src/acp/agent-connector.ts`).
//
// EVIDENCE BOUNDARIES: every case drives the REAL runtime, the REAL
// `AgentConnector` and the REAL `ChatbotClient` against a scripted FAKE ACP
// engine over a real stdio pipe
// (`tests/acp/fixtures/email-intent-acp-engine.ts`, spawned exactly like a
// production launch under `dumb-init`). The cases therefore prove spawn,
// profile identity, session-mode/model verification, deny-all callbacks,
// bounded capture, deadline and teardown — and claim NOTHING about a real
// `opencode`/`omp` executable, a provider, or a model's own judgment. The
// subprocess-backed cases self-skip when `dumb-init` is absent.
//
// The engines are configured with an authored-looking profile (the SHIPPED
// deny-all documents plus a fixture native payload) so the profile factory,
// its docs validation and the private-root contract are all the real ones.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join, resolve } from "@std/path";
import { stringify as stringifyYaml } from "@std/yaml";
import {
  type EmailIntentProfileOptions,
  type EmailIntentProviderSelection,
} from "@acp/agent-factory.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import type { AgentConnectorOptions, AgentType, ClientConfig } from "@acp/types.ts";
import {
  OMP_INTENT_PROFILE_FLAG,
  OMP_INTENT_PROFILE_FLAG_VALUE,
} from "@acp/omp/extension/native-registration.ts";
import {
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_VERSION,
  type OmpNativeCache,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  ompNativeCachePlatform,
  serializeOmpNativeCacheManifest,
} from "@utils/omp-native-cache.ts";
import { OMP_TRUSTED_EXTENSION_BUNDLE_PATH, ompHomeModelsPath } from "@utils/omp-paths.ts";
import { observeTrustedSkillsRoot } from "@core/skills-root.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import {
  EMAIL_INTENT_DEADLINE_MS,
  EMAIL_INTENT_MAX_OUTPUT_BYTES,
  type EmailIntentConnector,
  type EmailIntentConnectorFactory,
  EmailIntentRuntime,
  type EmailIntentRuntimeOptions,
  type EmailIntentUnavailableReason,
} from "@core/email-intent-runtime.ts";
import type { Config } from "../../src/types/config.ts";

// ---------------------------------------------------------------------------
// Fixture plumbing
// ---------------------------------------------------------------------------

/** The shipped authored deny-all documents, read from the repository tree. */
const SHIPPED_OPENCODE_CONFIG = fromFileUrl(
  new URL("../../agent-config/email-intent-opencode.json", import.meta.url),
);
const SHIPPED_OMP_SETTINGS = fromFileUrl(
  new URL("../../agent-config/omp/email-intent.yml", import.meta.url),
);
const SHIPPED_OMP_MODELS = fromFileUrl(
  new URL("../../agent-config/omp/models.yml", import.meta.url),
);

/** The scripted fake ACP engine this suite spawns in place of the real engine. */
const SCRIPTED_ENGINE = fromFileUrl(
  new URL("./fixtures/email-intent-acp-engine.ts", import.meta.url),
);

/** The `deno` executable that runs the scripted engine. */
const DENO_EXEC = Deno.execPath();

const DAEMON_HOME = "/home/test-daemon";
const SELECTION: EmailIntentProviderSelection = {
  providerID: "openrouter",
  modelID: "fixture-model",
};
const SELECTION_SELECTOR = `${SELECTION.providerID}/${SELECTION.modelID}`;

/** The authored text of every case; a unique marker so no log may contain it. */
const AUTHORED_TEXT = "interpret this authorized request AUTHORED-ONLY-MARKER";

/** Whether the wrapper the production launch uses is available locally. */
function dumbInitAvailable(): boolean {
  try {
    return new Deno.Command("dumb-init", { args: ["--", "/bin/true"] })
      .outputSync().success;
  } catch {
    return false;
  }
}

const SUBPROCESS_SKIP = !dumbInitAvailable();

/** Scripted engine inputs, one per case. */
interface EngineScript {
  mode?: string;
  modes?: string[];
  model?: string;
  models?: string[];
  stopReason?: string;
  chunks?: string[];
  chunkBytes?: number;
  toolCall?: boolean;
  permission?: boolean;
  writeFile?: string;
  readFile?: string;
  hang?: boolean;
  stderrMarker?: string;
  sessionNewChunks?: string[];
  sessionNewToolCall?: boolean;
  foreignSessionChunks?: string[];
  setConfigIgnoresValue?: boolean;
}

/** One recorded engine observation. */
type EngineRecord = Record<string, unknown>;

/** A captured log record; the harness never lets a case read a logger directly. */
interface CapturedLog {
  level: string;
  message: string;
  context: string;
}

/** Everything one case may inspect or assert on. */
interface CaseContext {
  readonly workspace: string;
  readonly rootsBase: string;
  readonly result: Awaited<ReturnType<EmailIntentRuntime["interpret"]>>;
  readonly records: EngineRecord[];
  readonly logs: CapturedLog[];
  readonly launches: AgentConnectorOptions[];
  readonly launchChecks: LaunchCheck[];
  readonly sentinel: string;
  readonly authoredText: string;
  readonly engineSpawned: boolean;
}

/**
 * Facts observed at LAUNCH time, before the runtime tears the private roots
 * down again: the private-root layout and the copied authored model file exist
 * only for the duration of the interpretation.
 */
interface LaunchCheck {
  readonly home: string;
  readonly homeMode: number | undefined;
  readonly ompModelsCopied: boolean;
}

/** Whether one path exists, without throwing. */
function pathExists(path: string): boolean {
  try {
    return Deno.lstatSync(path).isFile;
  } catch {
    return false;
  }
}

/** The permission mode of one path, or `undefined` when unobservable. */
function pathMode(path: string): number | undefined {
  try {
    return Deno.lstatSync(path).mode ?? undefined;
  } catch {
    return undefined;
  }
}

function readRecords(path: string): EngineRecord[] {
  try {
    return Deno.readTextFileSync(path)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as EngineRecord);
  } catch {
    return [];
  }
}

/** Every entry of one recorded engine observation carrying the given method. */
function recordOf(records: EngineRecord[], method: string): EngineRecord | undefined {
  return records.find((entry) => entry.method === method);
}

/** One recorded engine EVENT (`permission_answer`, `write_answer`, `read_answer`). */
function eventOf(records: EngineRecord[], event: string): EngineRecord | undefined {
  return records.find((entry) => entry.event === event);
}

/** Hex SHA-256 of one string, matching the fixture's own observation. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The intent-profile seams: the shipped documents plus a fixture native payload. */
function intentProfileOptions(
  workspace: string,
  backend: AgentType,
  env: Record<string, string>,
): EmailIntentProfileOptions {
  const modelsPath = join(workspace, "omp-models.yml");
  const opencodeCatalogPath = join(workspace, "opencode-catalog.json");
  Deno.writeTextFileSync(
    modelsPath,
    stringifyYaml({ providers: { openrouter: { headers: { "X-Title": "fixture" } } } }),
  );
  Deno.writeTextFileSync(
    opencodeCatalogPath,
    JSON.stringify({ provider: { openrouter: { models: { "fixture-model": {} } } } }),
  );
  const cache = provisionNativeCache(join(workspace, "native-cache"));
  return {
    env: (name) => env[name],
    authoredConfigPath: backend === "omp" ? SHIPPED_OMP_SETTINGS : SHIPPED_OPENCODE_CONFIG,
    catalogPath: backend === "omp" ? modelsPath : opencodeCatalogPath,
    ompNativeCache: {
      installRoot: cache.installRoot,
      launchExecutableVersion: OMP_NATIVE_CACHE_VERSION,
    },
    readFile: (path) => Deno.readTextFileSync(path),
    exists: (path) =>
      path === SHIPPED_OMP_SETTINGS || path === SHIPPED_OMP_MODELS || path === modelsPath ||
      path === opencodeCatalogPath || path === SHIPPED_OPENCODE_CONFIG ||
      path === resolve(OMP_TRUSTED_EXTENSION_BUNDLE_PATH),
  };
}

/** The fixture native payload: the pinned addon files plus their published manifest. */
function provisionNativeCache(base: string): OmpNativeCache {
  const platform = ompNativeCachePlatform();
  const cache = ompNativeCacheDescriptor(base, platform, "development");
  Deno.mkdirSync(cache.versionDir, { recursive: true, mode: 0o700 });
  const names = ompNativeCacheExpectedAddons(platform).exact;
  const files = names.map((name) => {
    const bytes = `fixture addon ${name}`;
    Deno.writeTextFileSync(join(cache.versionDir, name), bytes);
    return { name, size: bytes.length };
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

/** The deployment config the runtime consumes (only workspace/agent matter here). */
function testConfig(workspace: string): Config {
  return {
    platforms: {
      discord: { enabled: false, token: "" },
      misskey: { enabled: false, host: "", token: "" },
    },
    agent: { model: "fixture-model", systemPromptPath: "./test.md", tokenLimit: 20000 },
    memory: { recentMessageLimit: 20, workingTierLimit: 20 },
    // The fixture native payload lives beside the repo root, not inside it: the
    // profile refuses a payload under a backed-up data/workspace root.
    workspace: { repoPath: join(workspace, "repo"), workspacesDir: "workspaces" },
    logging: { level: "INFO" },
  } as unknown as Config;
}

/** A logger that records every call, so a case can prove what was NOT logged. */
function capturingLogger(logs: CapturedLog[]): Logger {
  const logger = new Logger("email-intent-test", { level: LogLevel.DEBUG });
  for (const level of ["info", "warn", "error", "debug"] as const) {
    const original = logger[level].bind(logger);
    logger[level] = (message: string, context?: Record<string, unknown>) => {
      logs.push({ level, message, context: JSON.stringify(context ?? {}) });
      original(message, context);
    };
  }
  return logger;
}

/**
 * The connector factory every case uses: the REAL `AgentConnector`, with only
 * the launched executable replaced by the scripted fake engine. The profile's
 * own `cwd`/`env` (private roots, isolation variables, the OMP intent marker)
 * are passed through untouched, so the spawn contract under test is the real
 * one.
 */
function scriptedEngineFactory(
  scriptPath: string,
  recordPath: string,
  launches: AgentConnectorOptions[],
  launchChecks: LaunchCheck[] = [],
): EmailIntentConnectorFactory {
  return (options: AgentConnectorOptions): EmailIntentConnector => {
    launches.push(options);
    const home = options.agentConfig.env?.["HOME"] ?? "";
    launchChecks.push({
      home,
      homeMode: home === "" ? undefined : pathMode(home),
      ompModelsCopied: home === "" ? false : pathExists(ompHomeModelsPath(home)),
    });
    return new AgentConnector({
      ...options,
      agentConfig: {
        ...options.agentConfig,
        command: DENO_EXEC,
        args: [
          "run",
          "--no-check",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          SCRIPTED_ENGINE,
          scriptPath,
          recordPath,
        ],
      },
    });
  };
}

/** Run one case against the scripted engine and check the invariants every case owes. */
async function withRuntime(
  options: {
    backend: AgentType;
    script: EngineScript;
    deadlineMs?: number;
    maxOutputBytes?: number;
    model?: EmailIntentProviderSelection;
    withConnector?: boolean;
  },
  run: (ctx: CaseContext) => void | Promise<void>,
): Promise<void> {
  const workspace = await Deno.makeTempDir({ prefix: "email-intent-runtime-case-" });
  const rootsBase = join(workspace, "roots");
  Deno.mkdirSync(rootsBase, { mode: 0o700 });
  const scriptPath = join(workspace, "script.json");
  const recordPath = join(workspace, "engine-record.jsonl");
  const sentinel = join(workspace, "tool-effect-sentinel.txt");
  Deno.writeTextFileSync(scriptPath, JSON.stringify(options.script));

  const env: Record<string, string> = {
    HOME: DAEMON_HOME,
    PATH: Deno.env.get("PATH") ?? "/usr/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    USER: "deno",
    OPENROUTER_API_KEY: "fixture-provider-key",
  };
  const logs: CapturedLog[] = [];
  const launches: AgentConnectorOptions[] = [];
  const launchChecks: LaunchCheck[] = [];
  const runtimeOptions: EmailIntentRuntimeOptions = {
    config: testConfig(workspace),
    logger: capturingLogger(logs),
    rootsBase,
    profileOptions: intentProfileOptions(workspace, options.backend, env),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
    ...(options.withConnector === false ? {} : {
      connectorFactory: scriptedEngineFactory(scriptPath, recordPath, launches, launchChecks),
    }),
  };
  const runtime = new EmailIntentRuntime(runtimeOptions);

  try {
    const result = await runtime.interpret({
      authoredText: AUTHORED_TEXT,
      model: options.model ?? SELECTION,
      backend: options.backend,
    });
    const records = readRecords(recordPath);
    const ctx: CaseContext = {
      workspace,
      rootsBase,
      result,
      records,
      logs,
      launches,
      launchChecks,
      sentinel,
      authoredText: AUTHORED_TEXT,
      engineSpawned: recordOf(records, "session/new") !== undefined,
    };
    await run(ctx);

    // Every case owes these two invariants: the interpretation's private roots
    // are gone again (nothing is retained outside the session roots), and no
    // log record ever carries the authored text or any captured output.
    assertEquals(
      [...Deno.readDirSync(rootsBase)].map((entry) => entry.name),
      [],
      "the interpretation must reclaim every root it allocated",
    );
    const serialized = JSON.stringify(logs);
    assertEquals(
      serialized.includes("AUTHORED-ONLY-MARKER"),
      false,
      "no log record may carry the authored text",
    );
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
}

/** Assert one `unavailable` result and return its reason. */
function unavailableReason(
  result: CaseContext["result"],
): EmailIntentUnavailableReason {
  assertEquals(result.status, "unavailable");
  return result.status === "unavailable" ? result.reason : "session_failed";
}

// ---------------------------------------------------------------------------
// Isolated interpretation: bounded capture, deny-all, identity
// ---------------------------------------------------------------------------

for (const backend of ["opencode", "omp"] as const) {
  Deno.test(`runtime - ${backend}: captures the bounded final text and reclaims its roots`, {
    ignore: SUBPROCESS_SKIP,
  }, async () => {
    await withRuntime({
      backend,
      script: {
        mode: "email-intent",
        model: SELECTION_SELECTOR,
        chunks: ['{"action":"none"}\n', "done"],
      },
    }, async (ctx) => {
      assertEquals(ctx.result, { status: "complete", text: '{"action":"none"}\ndone' });
      // The authored request is the ONLY thing the interpretation received.
      // Compared by digest: the fixture deliberately keeps no plaintext.
      const prompt = recordOf(ctx.records, "session/prompt");
      assert(prompt !== undefined, "the authored request must reach the engine");
      assertEquals(prompt.promptLength, AUTHORED_TEXT.length);
      assertEquals(prompt.promptSha256, await sha256Hex(AUTHORED_TEXT));
      // Exactly one prompt was dispatched, and no tool was ever attempted.
      assertEquals(
        ctx.records.filter((entry) => entry.method === "session/prompt").length,
        1,
      );
      assert(ctx.engineSpawned, "the intent launch must create one ACP session");
      // The launch is the real intent profile, and it carries no
      // mailbox/Skill API material or user mount.
      const launch = ctx.launches[0];
      assertEquals(launch.agentConfig.executionProfile, "email-intent");
      assertEquals(launch.clientConfig.intentCapture !== undefined, true);
      assertEquals(launch.clientConfig.trustedSkills, undefined);
      assertEquals(launch.clientConfig.sessionId, undefined);
      assertEquals(launch.clientConfig.yolo, undefined);
      assertEquals(launch.clientConfig.logAgentStreamChunks, false);
      const envNames = Object.keys(launch.agentConfig.env ?? {});
      for (const name of envNames) {
        assert(
          !/^(EMAIL|SKILL|DISCORD|MISSKEY)_/.test(name),
          `the intent launch must not carry ${name}`,
        );
      }
      assert(!envNames.includes("SKILL_JWT_DIR"), "no Skill JWT directory is provisioned");
      if (backend === "omp") {
        assertEquals(
          launch.agentConfig.env?.[OMP_INTENT_PROFILE_FLAG],
          OMP_INTENT_PROFILE_FLAG_VALUE,
        );
      }
      // The fresh private HOME is this interpretation's own root, mode 0700,
      // and (OMP) already holds the byte-copied authored model configuration.
      const check = ctx.launchChecks[0];
      assert(
        check.home.startsWith(ctx.rootsBase),
        "the launch's HOME must be this interpretation's own private root",
      );
      assertEquals(check.homeMode === undefined ? undefined : check.homeMode & 0o777, 0o700);
      assertEquals(check.ompModelsCopied, backend === "omp");
    });
  });
}

Deno.test("runtime - a permission attempt fails the interpretation closed with zero tool effect", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "opencode",
    script: {
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      permission: true,
      chunks: ['{"action":"none"}'],
    },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "tool_attempted");
    // The client refused with the explicit reject option, so the engine cannot
    // proceed with the operation it asked about.
    const answer = eventOf(ctx.records, "permission_answer")?.answer as {
      outcome?: { outcome?: string; optionId?: string };
    } | undefined;
    assertEquals(answer?.outcome?.outcome, "selected");
    assertEquals(answer?.outcome?.optionId, "reject-once");
    // The prompt resolved, yet no captured text is returned: a blocked tool can
    // never turn into authorization output.
    assert(ctx.result.status === "unavailable" && ctx.result.reason === "tool_attempted");
  });
});

Deno.test("runtime - a tool-call notification fails the interpretation closed", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "omp",
    script: {
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      toolCall: true,
      chunks: ["text after a tool attempt"],
    },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "tool_attempted");
  });
});

Deno.test("runtime - a write attempt is refused without creating the target file", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  // The sentinel path is handed to the engine through the script file, so the
  // factory has to be built after the workspace exists: the case below reuses
  // `withRuntime`'s own sentinel by interpolating it into a second workspace.
  const workspace = await Deno.makeTempDir({ prefix: "email-intent-runtime-write-" });
  const rootsBase = join(workspace, "roots");
  Deno.mkdirSync(rootsBase, { mode: 0o700 });
  const sentinel = join(workspace, "tool-effect-sentinel.txt");
  const scriptPath = join(workspace, "script.json");
  const recordPath = join(workspace, "engine-record.jsonl");
  Deno.writeTextFileSync(
    scriptPath,
    JSON.stringify({
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      writeFile: sentinel,
      chunks: ["never returned"],
    }),
  );
  const env: Record<string, string> = {
    HOME: DAEMON_HOME,
    PATH: Deno.env.get("PATH") ?? "/usr/bin",
    LANG: "C.UTF-8",
    USER: "deno",
    OPENROUTER_API_KEY: "fixture-provider-key",
  };
  const logs: CapturedLog[] = [];
  const launches: AgentConnectorOptions[] = [];
  try {
    const runtime = new EmailIntentRuntime({
      config: testConfig(workspace),
      logger: capturingLogger(logs),
      rootsBase,
      profileOptions: intentProfileOptions(workspace, "opencode", env),
      connectorFactory: scriptedEngineFactory(scriptPath, recordPath, launches),
    });
    const result = await runtime.interpret({
      authoredText: AUTHORED_TEXT,
      model: SELECTION,
      backend: "opencode",
    });
    assertEquals(result, { status: "unavailable", reason: "tool_attempted" });
    // Zero tool effect: the file the caller attempted to write does not exist.
    assertEquals(
      (() => {
        try {
          Deno.lstatSync(sentinel);
          return true;
        } catch {
          return false;
        }
      })(),
      false,
      "the refused write must not create its target",
    );
    const answer = JSON.stringify(eventOf(readRecords(recordPath), "write_answer") ?? {});
    assertStringIncludes(answer, "rejected_intent_no_tools");
    assertEquals(
      answer.includes(sentinel),
      false,
      "the refusal must not disclose the attempted path",
    );
    assertEquals(JSON.stringify(logs).includes(sentinel), false);
    assertEquals([...Deno.readDirSync(rootsBase)].length, 0);
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("runtime - a read attempt is refused and discloses no content", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  const workspace = await Deno.makeTempDir({ prefix: "email-intent-runtime-read-" });
  const rootsBase = join(workspace, "roots");
  Deno.mkdirSync(rootsBase, { mode: 0o700 });
  const readable = join(workspace, "private.txt");
  Deno.writeTextFileSync(readable, "PRIVATE-CONTENT-MARKER");
  const scriptPath = join(workspace, "script.json");
  const recordPath = join(workspace, "engine-record.jsonl");
  Deno.writeTextFileSync(
    scriptPath,
    JSON.stringify({ mode: "email-intent", model: SELECTION_SELECTOR, readFile: readable }),
  );
  const env: Record<string, string> = {
    HOME: DAEMON_HOME,
    PATH: Deno.env.get("PATH") ?? "/usr/bin",
    USER: "deno",
    OPENROUTER_API_KEY: "fixture-provider-key",
  };
  const logs: CapturedLog[] = [];
  try {
    const runtime = new EmailIntentRuntime({
      config: testConfig(workspace),
      logger: capturingLogger(logs),
      rootsBase,
      profileOptions: intentProfileOptions(workspace, "opencode", env),
      connectorFactory: scriptedEngineFactory(scriptPath, recordPath, []),
    });
    const result = await runtime.interpret({
      authoredText: AUTHORED_TEXT,
      model: SELECTION,
      backend: "opencode",
    });
    assertEquals(result, { status: "unavailable", reason: "tool_attempted" });
    const answer = JSON.stringify(eventOf(readRecords(recordPath), "read_answer") ?? {});
    assertStringIncludes(answer, "rejected_intent_no_tools");
    assertEquals(answer.includes("PRIVATE-CONTENT-MARKER"), false);
    assertEquals(JSON.stringify(logs).includes("PRIVATE-CONTENT-MARKER"), false);
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Bounded private interpretation
// ---------------------------------------------------------------------------

Deno.test("runtime - an exceeded deadline returns unavailable and still reclaims", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  const started = Date.now();
  await withRuntime({
    backend: "omp",
    deadlineMs: 600,
    script: { mode: "email-intent", model: SELECTION_SELECTOR, hang: true },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "timeout");
    assert(
      Date.now() - started < EMAIL_INTENT_DEADLINE_MS,
      "the deadline, not the connector's idle timeout, must end the turn",
    );
  });
});

Deno.test("runtime - an output overflow past the 8 KiB bound returns no partial text", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "opencode",
    script: {
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      chunkBytes: EMAIL_INTENT_MAX_OUTPUT_BYTES + 1,
    },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "output_overflow");
    assertEquals(
      JSON.stringify(ctx.result).includes("xxx"),
      false,
      "no partially captured output may be returned",
    );
  });
});

Deno.test("runtime - an exactly-8 KiB output is still complete", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "opencode",
    script: {
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      chunkBytes: EMAIL_INTENT_MAX_OUTPUT_BYTES,
    },
  }, (ctx) => {
    assertEquals(ctx.result.status, "complete");
    if (ctx.result.status === "complete") {
      assertEquals(new TextEncoder().encode(ctx.result.text).length, EMAIL_INTENT_MAX_OUTPUT_BYTES);
    }
  });
});

Deno.test("runtime - a broadened constructor bound is clamped to the hard limits", () => {
  const runtime = new EmailIntentRuntime({
    config: testConfig("/tmp/email-intent-clamp"),
    logger: capturingLogger([]),
    deadlineMs: EMAIL_INTENT_DEADLINE_MS * 10,
    maxOutputBytes: EMAIL_INTENT_MAX_OUTPUT_BYTES * 10,
  });
  assertEquals(Reflect.get(runtime, "deadlineMs"), EMAIL_INTENT_DEADLINE_MS);
  assertEquals(Reflect.get(runtime, "maxOutputBytes"), EMAIL_INTENT_MAX_OUTPUT_BYTES);
});

Deno.test("runtime - an unusable bound override cannot disable a hard limit", () => {
  // A non-finite or non-positive override would otherwise make every overflow
  // comparison false (or the deadline immediate): both fall back to the hard
  // limit instead of silently removing the bound.
  for (const override of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    const runtime = new EmailIntentRuntime({
      config: testConfig("/tmp/email-intent-clamp-unusable"),
      logger: capturingLogger([]),
      deadlineMs: override,
      maxOutputBytes: override,
    });
    assertEquals(Reflect.get(runtime, "deadlineMs"), EMAIL_INTENT_DEADLINE_MS);
    assertEquals(Reflect.get(runtime, "maxOutputBytes"), EMAIL_INTENT_MAX_OUTPUT_BYTES);
  }
});

Deno.test("runtime - text that is not this prompt turn's answer is never returned", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  // The engine speaks during setup and on a foreign session, then answers the
  // authored prompt with `end_turn` and NO text of its own. Contaminated text
  // must not be presented as this interpretation's result.
  await withRuntime({
    backend: "opencode",
    script: {
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      sessionNewChunks: ["SETUP-TEXT-NOT-AN-ANSWER"],
      foreignSessionChunks: ["FOREIGN-SESSION-TEXT"],
      chunks: [],
    },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "incomplete_output");
    assertEquals(JSON.stringify(ctx.result).includes("SETUP-TEXT-NOT-AN-ANSWER"), false);
    assertEquals(JSON.stringify(ctx.result).includes("FOREIGN-SESSION-TEXT"), false);
  });
});

Deno.test("runtime - a pre-prompt tool attempt still fails the interpretation closed", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  // A tool attempt is latched regardless of prompt-turn arming: an attempt made
  // while the session was being set up must never be forgotten.
  await withRuntime({
    backend: "opencode",
    script: {
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      sessionNewChunks: ["setup"],
      sessionNewToolCall: true,
      chunks: ["would be an answer"],
    },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "tool_attempted");
  });
});

for (
  const stop of [
    { name: "no captured text", script: { chunks: [] as string[] } },
    {
      name: "a non-end_turn stop reason",
      script: { chunks: ["partial"], stopReason: "max_tokens" },
    },
    { name: "blank captured text", script: { chunks: ["   \n"] } },
  ]
) {
  Deno.test(`runtime - incomplete output (${stop.name}) returns unavailable`, {
    ignore: SUBPROCESS_SKIP,
  }, async () => {
    await withRuntime({
      backend: "opencode",
      script: {
        mode: "email-intent",
        model: SELECTION_SELECTOR,
        ...stop.script,
      },
    }, (ctx) => {
      assertEquals(unavailableReason(ctx.result), "incomplete_output");
    });
  });
}

// ---------------------------------------------------------------------------
// Profile identity: fail closed before dispatch
// ---------------------------------------------------------------------------

Deno.test("runtime - a model selection the catalog does not carry never spawns an engine", async () => {
  await withRuntime({
    backend: "opencode",
    model: { providerID: "openrouter", modelID: "undeclared-model" },
    script: { mode: "email-intent", model: SELECTION_SELECTOR, chunks: ["unreachable"] },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "profile_unavailable");
    assertEquals(ctx.records.length, 0, "no engine may be spawned for a refused profile");
  });
});

Deno.test("runtime - a session that is not in the intent mode fails closed before any prompt", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "opencode",
    script: { mode: "build", modes: ["build"], model: SELECTION_SELECTOR, chunks: ["unreachable"] },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "profile_unavailable");
    assertEquals(
      recordOf(ctx.records, "session/prompt"),
      undefined,
      "the authored text must never be dispatched to a non-intent session",
    );
  });
});

Deno.test("runtime - a session advertising NO mode selector fails closed", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "opencode",
    script: { model: SELECTION_SELECTOR, chunks: ["unreachable"] },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "profile_unavailable");
    assertEquals(recordOf(ctx.records, "session/prompt"), undefined);
  });
});

Deno.test("runtime - a mode selector offering another mode fails closed", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "opencode",
    script: {
      mode: "email-intent",
      modes: ["email-intent", "build"],
      model: SELECTION_SELECTOR,
      chunks: ["unreachable"],
    },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "profile_unavailable");
    assertEquals(recordOf(ctx.records, "session/prompt"), undefined);
  });
});

Deno.test("runtime - a mode selector advertising an EMPTY roster fails closed", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  // The pinned contract advertises exactly one selectable mode. An empty roster
  // proves nothing about what the session can switch to, so it is refused.
  await withRuntime({
    backend: "opencode",
    script: {
      mode: "email-intent",
      modes: [],
      model: SELECTION_SELECTOR,
      chunks: ["unreachable"],
    },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "profile_unavailable");
    assertEquals(recordOf(ctx.records, "session/prompt"), undefined);
  });
});

Deno.test("runtime - a model pin the engine does not apply fails closed before dispatch", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  // The pin's OWN response replaces the cached options, so the resulting active
  // model is re-verified: an engine that answers without applying the selection
  // must not reach the prompt.
  await withRuntime({
    backend: "omp",
    script: {
      mode: "email-intent",
      model: "openrouter/engine-default",
      models: ["openrouter/engine-default", SELECTION_SELECTOR],
      setConfigIgnoresValue: true,
      chunks: ["unreachable"],
    },
  }, (ctx) => {
    assertEquals(unavailableReason(ctx.result), "profile_unavailable");
    assertEquals(recordOf(ctx.records, "session/prompt"), undefined);
  });
});

Deno.test("runtime - an unconfirmed producer termination retains the private roots", async () => {
  // Producer-safe reclamation: a launched wrapper whose exit was never
  // POSITIVELY observed must keep the roots it could still be using, instead of
  // having them reclaimed underneath it. The seam substitutes only the process
  // evidence, so nothing is actually spawned.
  const workspace = await Deno.makeTempDir({ prefix: "email-intent-unconfirmed-" });
  const rootsBase = join(workspace, "roots");
  Deno.mkdirSync(rootsBase, { mode: 0o700 });
  const logs: CapturedLog[] = [];
  try {
    const runtime = new EmailIntentRuntime({
      config: testConfig(workspace),
      logger: capturingLogger(logs),
      rootsBase,
      profileOptions: intentProfileOptions(workspace, "opencode", {
        HOME: DAEMON_HOME,
        PATH: Deno.env.get("PATH") ?? "/usr/bin",
        USER: "deno",
        OPENROUTER_API_KEY: "fixture-provider-key",
      }),
      connectorFactory: () => ({
        connect: () => Promise.resolve(),
        createSession: () => Promise.resolve("ses-unconfirmed"),
        prompt: () => Promise.reject(new Error("engine disappeared mid-turn")),
        cancel: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        // A wrapper was spawned and its exit was never observed.
        getProcessEvidence: () => ({ generations: 1, pid: undefined }),
      }),
    });
    const result = await runtime.interpret({
      authoredText: AUTHORED_TEXT,
      model: SELECTION,
      backend: "opencode",
    });
    assertEquals(result, { status: "unavailable", reason: "session_failed" });
    const retained = [...Deno.readDirSync(rootsBase)].map((entry) => entry.name);
    assertEquals(retained.length, 1, "an unconfirmed teardown must retain its own roots");
    assert(
      JSON.stringify(logs).includes("unconfirmed"),
      "the retention must be reported with a bounded warning",
    );
    await Deno.remove(join(rootsBase, retained[0]), { recursive: true });
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("runtime - the requested model is pinned when the session advertises another", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "omp",
    script: {
      mode: "email-intent",
      model: "openrouter/engine-default",
      models: ["openrouter/engine-default", SELECTION_SELECTOR],
      chunks: ['{"action":"none"}'],
    },
  }, (ctx) => {
    assertEquals(ctx.result.status, "complete");
    const applied = recordOf(ctx.records, "session/set_config_option");
    assert(applied !== undefined, "the engine default must be replaced by the selection");
    assertEquals(
      (applied.params as Record<string, unknown> | undefined)?.value,
      SELECTION_SELECTOR,
    );
  });
});

// ---------------------------------------------------------------------------
// Privacy and teardown
// ---------------------------------------------------------------------------

Deno.test("runtime - engine stderr is drained but never logged", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "opencode",
    script: {
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      stderrMarker: "STDERR-SECRET-MARKER",
      chunks: ["ok"],
    },
  }, (ctx) => {
    assertEquals(ctx.result.status, "complete");
    assertEquals(
      JSON.stringify(ctx.logs).includes("STDERR-SECRET-MARKER"),
      false,
      "no engine stderr content may reach a log",
    );
  });
});

Deno.test("runtime - captured output never reaches a log record", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  await withRuntime({
    backend: "omp",
    script: {
      mode: "email-intent",
      model: SELECTION_SELECTOR,
      chunks: ["CAPTURED-OUTPUT-MARKER"],
    },
  }, (ctx) => {
    assertEquals(ctx.result, { status: "complete", text: "CAPTURED-OUTPUT-MARKER" });
    assertEquals(JSON.stringify(ctx.logs).includes("CAPTURED-OUTPUT-MARKER"), false);
  });
});

Deno.test("runtime - an ordinary launch keeps its ordinary connector behavior", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  // The regression that matters for `email-intent-runtime`: a launch without
  // the intent profile and without the intent capture seam is driven exactly as
  // before — the trusted-root inventory is still mandatory, the client still
  // answers permissions through its ordinary paths and the prompt still
  // completes with its ordinary logging.
  const workspace = await Deno.makeTempDir({ prefix: "email-intent-ordinary-" });
  const scriptPath = join(workspace, "script.json");
  const recordPath = join(workspace, "engine-record.jsonl");
  const skillsDir = join(workspace, "skills");
  Deno.mkdirSync(skillsDir, { recursive: true });
  Deno.writeTextFileSync(
    scriptPath,
    JSON.stringify({
      model: SELECTION_SELECTOR,
      permission: true,
      chunks: ["ordinary reply"],
    }),
  );
  const logs: CapturedLog[] = [];
  const clientConfig: ClientConfig = {
    workingDir: workspace,
    platform: "discord",
    userId: "123",
    channelId: "456",
    isDM: false,
    logAgentStreamChunks: true,
  };
  const connector = new AgentConnector({
    agentConfig: {
      command: DENO_EXEC,
      args: [
        "run",
        "--no-check",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        SCRIPTED_ENGINE,
        scriptPath,
        recordPath,
      ],
      cwd: workspace,
      env: { PATH: Deno.env.get("PATH") ?? "/usr/bin" },
      skillsRoot: observeTrustedSkillsRoot("opencode", skillsDir),
    },
    clientConfig,
    skillRegistry: {},
    logger: capturingLogger(logs),
    agentType: "opencode",
  });
  try {
    await connector.connect();
    const sessionId = await connector.createSession([], workspace);
    const response = await connector.prompt(sessionId, "ordinary request");
    assertEquals(response.stopReason, "end_turn");
    // The ordinary path answered the permission request through its own policy
    // (an unregistered skill execution is refused) rather than the intent sink.
    const answer = eventOf(readRecords(recordPath), "permission_answer")?.answer as {
      outcome?: { outcome?: string; optionId?: string };
    } | undefined;
    assertEquals(answer?.outcome?.outcome, "selected");
    // The ordinary path still logged its stream, which the intent path never does.
    assert(
      logs.some((entry) => entry.message.includes("Agent message chunk")),
      "an ordinary launch keeps its stream logging",
    );
  } finally {
    await connector.disconnect();
    await Deno.remove(workspace, { recursive: true });
  }
});

/**
 * The intent launch identity and the intent capture seam must agree in BOTH
 * directions, and the agreement is checked BEFORE anything is spawned: a
 * mismatched pair would otherwise spawn successfully and then use the ordinary
 * logging and permission shortcuts (or the deny-all callbacks without the
 * private launch shape).
 */
Deno.test("runtime - a mismatched intent profile/capture pair is refused before spawn", async () => {
  const workspace = await Deno.makeTempDir({ prefix: "email-intent-mismatch-" });
  const skillsDir = join(workspace, "skills");
  Deno.mkdirSync(skillsDir, { recursive: true });
  const intentCamera = (): ClientConfig => ({
    workingDir: workspace,
    platform: "email",
    userId: "email-intent-runtime",
    channelId: "email-intent-runtime",
    isDM: true,
  });
  const launch = (executionProfile?: "email-intent") => ({
    command: "true",
    args: [] as string[],
    cwd: workspace,
    // `true` is harmless: the refusal must happen before any spawn, so a
    // launched process would prove the guard failed.
    env: { PATH: Deno.env.get("PATH") ?? "/usr/bin" },
    skillsRoot: observeTrustedSkillsRoot("opencode", skillsDir),
    ...(executionProfile === undefined ? {} : { executionProfile }),
  });
  try {
    // Profile without the capture seam.
    const missingCapture = new AgentConnector({
      agentConfig: launch("email-intent"),
      clientConfig: intentCamera(),
      skillRegistry: {},
      logger: capturingLogger([]),
      agentType: "opencode",
    });
    const profileSideError = await missingCapture.connect().then(
      () => undefined,
      (error: unknown) => error,
    );
    assertStringIncludes(String(profileSideError), "capture_agreement");

    // Capture seam on a launch that is not the intent profile.
    const missingProfile = new AgentConnector({
      agentConfig: launch(),
      clientConfig: {
        ...intentCamera(),
        intentCapture: { onText: () => {}, onToolAttempt: () => {} },
      },
      skillRegistry: {},
      logger: capturingLogger([]),
      agentType: "opencode",
    });
    const captureSideError = await missingProfile.connect().then(
      () => undefined,
      (error: unknown) => error,
    );
    assertStringIncludes(String(captureSideError), "capture_agreement");
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

Deno.test("runtime - the OMP arm refuses a launch without its intent marker", {
  ignore: SUBPROCESS_SKIP,
}, async () => {
  const workspace = await Deno.makeTempDir({ prefix: "email-intent-marker-" });
  const rootsBase = join(workspace, "roots");
  Deno.mkdirSync(rootsBase, { mode: 0o700 });
  const env: Record<string, string> = {
    HOME: DAEMON_HOME,
    PATH: Deno.env.get("PATH") ?? "/usr/bin",
    USER: "deno",
    OPENROUTER_API_KEY: "fixture-provider-key",
  };
  try {
    const runtime = new EmailIntentRuntime({
      config: testConfig(workspace),
      logger: capturingLogger([]),
      rootsBase,
      profileOptions: intentProfileOptions(workspace, "omp", env),
      connectorFactory: (options) =>
        new AgentConnector({
          ...options,
          agentConfig: {
            ...options.agentConfig,
            // Strip the host-only marker: the launch identity is gone.
            env: Object.fromEntries(
              Object.entries(options.agentConfig.env ?? {}).filter(
                ([name]) => name !== OMP_INTENT_PROFILE_FLAG,
              ),
            ),
          },
        }),
    });
    const result = await runtime.interpret({
      authoredText: AUTHORED_TEXT,
      model: SELECTION,
      backend: "omp",
    });
    assertEquals(result, { status: "unavailable", reason: "profile_unavailable" });
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});
