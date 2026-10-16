/**
 * Native OMP tool-dispatch integration (`document-omp-parity-and-consumer-regressions`
 * task 1.2: "Drive shipped native tools with a free loopback scripted provider").
 *
 * EVIDENCE BOUNDARIES (read before citing anything from this file):
 *
 * - The MODEL is a mock: a fixed loopback HTTP server (`127.0.0.1:43187`) serves
 *   the OpenAI chat-completions SSE shape and hands the agent a scripted
 *   tool-call plan. No paid or public provider is contacted and no model
 *   reasoning is exercised. The response shape is the documented one for pinned
 *   `packages/ai/src/providers/openai-completions.ts` (its `postOpenAIStream`
 *   transport plus the `data:`-frame reader, which terminates on `[DONE]`).
 * - The DISPATCH is real: the official pinned `omp acp` executable is spawned
 *   through the shipped production factory (`createAgentConfig`) and the real
 *   `AgentConnector`, with the shipped restricted capability bundle, the authored
 *   mode documents and the authored HOME model fixture. Every tool result this
 *   file asserts on is the native agent's own result, read back out of the
 *   follow-up provider request the native agent composed.
 * - The `--trusted-extension` fixture in
 *   `tests/fixtures/omp-native-runtime/unknown-tools.js` is loaded ONLY by these
 *   test launches (an additional repeatable `--trusted-extension`). It is a
 *   test-owned exposure control, never a production dependency, and its empty
 *   TypeBox schema describes only its own two tools.
 * - Prerequisites are EXACT. With `OMP_NATIVE_ACCEPTANCE=1` (the documented
 *   acceptance mode) every unavailable prerequisite is a FAILED test naming the
 *   precise reason; without it the native legs stay UNEXERCISED (Deno reports the
 *   test as ignored) rather than claiming native success.
 * - The ACP filesystem-callback scenarios run through the repository's documented
 *   `ClientConfig.nativeCalls` test seam (`tests/acp/filesystem-test-calls.ts`,
 *   the same seam the OMP lifecycle and skill-handoff integration suites use).
 *   The production backend is "owned Debian libc at
 *   `/lib/x86_64-linux-gnu/libc.so.6`"; a host without that exact path (e.g. a
 *   Fedora bot process, which has only `/lib64/libc.so.6`) fails closed and would
 *   deny EVERY callback for an environment reason. The seam keeps the REAL
 *   authorization + access-admission logic on the REAL paths with REAL file
 *   handles, so a denial still means the shared policy denied it. The seam does
 *   not certify libc/openat2 — the confinement probe owns the descriptor-only
 *   native path.
 * - The native context reducer may elide a large tool result before the model
 *   reads it (observed: `[shaken ~N tokens — recover: artifact://…]`). This file
 *   therefore (a) takes the hashline tag from the newest usable result and never
 *   parses an elided one, and (b) records such outcomes as "elided by the native
 *   context reducer" instead of claiming the elided content. Tool results that a
 *   scenario asserts on are small enough to survive on this pin; an elided one
 *   fails loudly with the observed text rather than passing vacuously.
 * - The external-directory read is CAPTURED, not policed: a harmless file outside
 *   every authorized root is read with an ordinary native `read`, the bytes it
 *   delivered are asserted, and the ACP callback decision this deployment really
 *   made is recorded (authorized / denied with the native disk fallback / no
 *   callback at all). This leg adds no read policy and widens no authorization.
 * - The provider credentials the factory would forward from the host environment
 *   are removed from the launch, so no credential-backed search provider can be
 *   billed from this test. Native web search is still dispatched natively and its
 *   model-facing outcome is RECORDED, never asserted: the pinned binary may run a
 *   keyless search backend on some hosts and report its own no-backend outcome on
 *   others, and the context reducer may elide the result entirely. No claim of a
 *   successful live search is made either way.
 * - No assertion here inspects tool sources, registry epochs or schema bytes, and
 *   none compares result payload bytes. Assertions are about the requested
 *   operation, the selected permission, and filesystem/delivery outcomes.
 * - The launch environment is process-global (`HOME` is read by the factory), so
 *   the fixture boundary restores the parent environment in `finally`.
 */

import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs/copy";
import { dirname, join, resolve } from "@std/path";
import { createAgentConfig } from "@acp/agent-factory.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import { MemoryStore } from "@core/memory-store.ts";
import { WorkspaceManager } from "@core/workspace-manager.ts";
import { SkillRegistry } from "@skills/registry.ts";
import { resolveOmpExtensionPath } from "@utils/omp-paths.ts";
import {
  OMP_NATIVE_CACHE_EXECUTABLE_SHA256,
  OMP_NATIVE_CACHE_VERSION,
  ompNativeCacheDescriptor,
  ompNativeCacheExpectedAddons,
  ompNativeCachePlatform,
  type OmpNativeCacheSelection,
  serializeOmpNativeCacheManifest,
} from "@utils/omp-native-cache.ts";
import { prepareOmpNativeCache, resolveOnPath } from "../../../scripts/omp/prepare-native-cache.ts";
import { Logger, LogLevel } from "@utils/logger.ts";
import { createFilesystemTestCalls } from "../../acp/filesystem-test-calls.ts";
import type { ChatbotClient } from "@acp/client.ts";
import type { AgentConfig, AgentConnectorOptions, PermissionRejection } from "@acp/types.ts";
import type { Config } from "../../../src/types/config.ts";

// ---------------------------------------------------------------------------
// Pinned prerequisites and authored-asset inventory
// ---------------------------------------------------------------------------

/** The exact pinned release the adapters, the bundle and the fixture consume. */
const PINNED_OMP_VERSION = "18.6.1";

/** Checkout root (this file lives at `<root>/tests/integration/omp-native-runtime/`). */
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..");

/** Fixed loopback endpoint: the authored model fixture pins this exact base URL. */
const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 43187;
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const URL_BYTES_PATH = "/fixture.txt";

/** The tracked, hand-authored native model fixture consumed by this leg. */
const FIXTURE_MODELS_PATH = join(
  REPO_ROOT,
  "tests/fixtures/omp-native-runtime/home/.omp/agent/models.yml",
);

/** Its native config-home destination (`getAgentDir()/models.yml`). */
const HOME_MODELS_RELATIVE = join(".omp", "agent", "models.yml");

/** The tracked skill tree copied into the fixture HOME's configured root. */
const TRACKED_SKILLS_DIR = join(REPO_ROOT, "skills");

/** The test-owned native extension fixture (loaded by an extra `--trusted-extension`). */
const UNKNOWN_TOOLS_FIXTURE = join(
  REPO_ROOT,
  "tests/fixtures/omp-native-runtime/unknown-tools.js",
);

/** The fixture model's id and its ACTUAL advertised catalog selector. */
const FIXTURE_MODEL_ID = "parity-fixture";
const FIXTURE_MODEL_SELECTOR = `${FIXTURE_MODEL_ID}/${FIXTURE_MODEL_ID}`;

/** The active Skill API session id this test registers (the staging directory owner). */
const SKILL_SESSION_ID = "parity-session";

/** The scripted provider's terminal turn text (the prompt resolves on it). */
const TERMINAL_TURN_TEXT = "parity scripted plan complete";

/**
 * Extra provider requests tolerated beyond one per plan step before the scripted
 * turn is closed: a stalled plan (a step whose tool result never arrives) ends the
 * turn instead of hanging, and the leg assertions then name the missing step.
 */
const STALL_ALLOWANCE_REQUESTS = 8;

/** Provider credentials the launch must never carry (native web search posture). */
const PROVIDER_CREDENTIALS = ["GEMINI_API_KEY", "OPENROUTER_API_KEY"] as const;

/** Content sentinels: the only bytes this file's own fixtures ever serve. */
const FIXTURE_MD_MARKER = "parity-smoke fixture";
const FIXTURE_MD_CONTENT = `# ${FIXTURE_MD_MARKER}\n\nparity-smoke line for grep.\n`;
const EDIT_TARGET_FIRST_LINE = "parity-smoke original";
const EDIT_TARGET_CONTENT = `${EDIT_TARGET_FIRST_LINE}\nsecond line kept\n`;
const EDITED_FIRST_LINE = "parity-edited";
const URL_BYTES_MARKER = "parity-smoke url bytes";
const URL_BYTES_CONTENT = `${URL_BYTES_MARKER}\n`;
const WRITE_CONTENT = "parity-smoke";

/**
 * Sentinel of the HARMLESS file provisioned outside every authorized daemon root
 * (see {@link NativeFixture.externalFile}). Present in the external read's result
 * when that read really delivered the file's bytes, and absent from the denied
 * bash command's result because that command never ran.
 */
const EXTERNAL_SENTINEL = "parity-external-read-sentinel";
const EXTERNAL_FILE_CONTENT = `# external-directory read fixture\n\n${EXTERNAL_SENTINEL}\n`;

/** The loopback URL read (`read { path: <url> }`) served by this test. */
const FIXTURE_URL = `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}${URL_BYTES_PATH}`;

/**
 * Bounded vocabulary for the credential/backend-absent native web-search
 * outcome. Deliberately loose: it CLASSIFIES the recorded outcome for the
 * evidence label — it never pins one upstream error string, and the test never
 * asserts that the host has no backend (a host with a configured/free provider
 * legitimately produces real results).
 */
const WEB_SEARCH_ABSENT_PATTERN = new RegExp(
  [
    "no web search",
    "not (?:configured|available)",
    "credential",
    "no (?:supported )?(?:model|provider|backend)",
  ].join("|"),
  "i",
);

/**
 * Outcomes that mean the native call was NEVER ADMITTED to `web_search` — an
 * unknown/unregistered tool, a capability-policy or approval block, or a failed
 * dispatch. Any of these satisfies "the tool was called" vacuously, so the
 * web-search scenario fails the leg when the observed result matches.
 */
const UNAVAILABLE_DISPATCH_PATTERN = new RegExp(
  [
    "rejected_unknown_tool",
    '\\btool\\s+"?web_search"?\\s+not found\\b',
    'unknown tool\\s+"?web_search"?',
    '"?web_search"?\\s+is not (?:a )?known',
    "blocked by (?:user|tool) policy",
    "requires approval but no interactive UI",
  ].join("|"),
  "i",
);

/** Acceptance mode: every unavailable prerequisite becomes a named failure. */
const ACCEPTANCE_MODE = Deno.env.get("OMP_NATIVE_ACCEPTANCE") === "1";

/** The fixture's own tool/marker/load-mode contract (one source of truth). */
const FIXTURE_TOOLS = {
  /** `loadMode: "essential"` — kept top-level, so it is directly callable. */
  direct: {
    name: "parity_unknown_direct",
    marker: "parity-unknown-direct.marker",
    loadMode: "essential",
  },
  /** `loadMode: "discoverable"` — reachable only through `write xd://<name>`. */
  mounted: {
    name: "parity_unknown_mounted",
    marker: "parity-unknown-mounted.marker",
    loadMode: "discoverable",
  },
  /** Marker directory, relative to the session working directory (`ctx.cwd`). */
  markerDirectory: "tmp",
} as const;

/**
 * The native roster names this leg REQUIRES the agent to have advertised to the
 * model: the listed abilities task 1.2 drives, plus the fixture's own essential
 * tool. Name presence only — never schema bytes, source text or registry internals.
 */
const REQUIRED_ROSTER_NAMES = [
  "read",
  "grep",
  "glob",
  "todo",
  "web_search",
  "write",
  "edit",
  "bash",
  FIXTURE_TOOLS.direct.name,
] as const;

// ---------------------------------------------------------------------------
// Synchronous prerequisite observation
// ---------------------------------------------------------------------------

/** One synchronous command result; a missing binary yields `ran: false`. */
interface SyncProbe {
  readonly ran: boolean;
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Synchronous file existence probe. */
function existsSync(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Run a short synchronous probe without a shell. */
function runSyncProbe(command: string, args: readonly string[]): SyncProbe {
  try {
    const output = new Deno.Command(command, {
      args: [...args],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const decoder = new TextDecoder();
    return {
      ran: true,
      success: output.success,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } catch (error) {
    return {
      ran: false,
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The detected `omp --version` output, exactly as the installed binary prints it. */
const OMP_VERSION_PROBE = runSyncProbe("omp", ["--version"]);

/**
 * The parsed `major.minor.patch` of the detected executable, or `null`.
 *
 * Mirrors the confined-runtime probe's gate exactly: a successful invocation is
 * REQUIRED, and prerelease/build suffixes are rejected, so `18.6.1-beta`, a
 * nonzero exit that merely prints `18.6.1`, or a mismatched release never counts
 * as this pin.
 */
const DETECTED_OMP_VERSION: string | null = (() => {
  if (!OMP_VERSION_PROBE.ran || !OMP_VERSION_PROBE.success) return null;
  return /(?:^|[^\d.])(\d+\.\d+\.\d+)(?![\d.+-])/.exec(OMP_VERSION_PROBE.stdout)?.[1] ?? null;
})();

/** True only for the exact pinned release. */
const PINNED_BINARY_READY = DETECTED_OMP_VERSION === PINNED_OMP_VERSION;

/** The real connector wraps every launch in `dumb-init`; without it nothing spawns. */
const DUMB_INIT_READY = (Deno.env.get("PATH") ?? "")
  .split(":")
  .some((entry) => entry.length > 0 && existsSync(join(entry, "dumb-init")));

/** The shipped restricted capability bundle the production factory requires. */
const TRUSTED_EXTENSION_PATH = resolve(resolveOmpExtensionPath());

/** Whether that bundle exists (the factory preflight fails closed without it). */
const TRUSTED_EXTENSION_READY = existsSync(TRUSTED_EXTENSION_PATH);

/** One bind/release observation of the fixed loopback port. */
interface LoopbackPortObservation {
  readonly free: boolean;
  readonly reason?: string;
}

/**
 * Probe the fixed port by really binding and releasing it. An occupied port is an
 * EXPLICIT prerequisite failure, never a silently skipped or claimed pass.
 */
function observeLoopbackPort(): LoopbackPortObservation {
  try {
    const listener = Deno.listen({ hostname: LOOPBACK_HOST, port: LOOPBACK_PORT });
    listener.close();
    return { free: true };
  } catch (error) {
    return { free: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The load-time port observation reused by the `ignore` predicate. */
const LOOPBACK_PORT_OBSERVATION = observeLoopbackPort();

/**
 * The exact pinned executable must be present and must report the pin. Every
 * native-leg prerequisite is asserted here, in acceptance or in a run that got
 * past the `ignore` predicate.
 */
function assertNativePrerequisites(): void {
  assert(
    OMP_VERSION_PROBE.ran,
    `native prerequisite failed: no \`omp\` executable on PATH — ${OMP_VERSION_PROBE.stderr}`,
  );
  assert(
    OMP_VERSION_PROBE.success,
    "native prerequisite failed: 'omp --version' exited non-zero (output: " +
      `${JSON.stringify(OMP_VERSION_PROBE.stdout)}; stderr: ${
        JSON.stringify(OMP_VERSION_PROBE.stderr)
      })`,
  );
  assert(
    DETECTED_OMP_VERSION === PINNED_OMP_VERSION,
    `native prerequisite failed: the installed executable reports ${
      DETECTED_OMP_VERSION ?? JSON.stringify(OMP_VERSION_PROBE.stdout)
    }, the acceptance requires exactly ${PINNED_OMP_VERSION}; a substitute binary is never evidence`,
  );
  assert(
    DUMB_INIT_READY,
    "native prerequisite failed: `dumb-init` is not on PATH, so the real AgentConnector " +
      "cannot spawn",
  );
  assert(
    LOOPBACK_PORT_OBSERVATION.free,
    `native prerequisite failed: ${LOOPBACK_HOST}:${LOOPBACK_PORT} is not available — ` +
      `${LOOPBACK_PORT_OBSERVATION.reason ?? "occupied"}`,
  );
  assert(
    TRUSTED_EXTENSION_READY,
    `native prerequisite failed: the generated trusted extension bundle is missing at ` +
      `"${TRUSTED_EXTENSION_PATH}" — build it with \`deno task bundle:omp-extension\``,
  );
}

// ---------------------------------------------------------------------------
// The loopback scripted provider (mock model, real native dispatch)
// ---------------------------------------------------------------------------

/** One scripted assistant turn: a tool call the native agent must dispatch. */
interface ScriptedToolStep {
  readonly name: string;
  /** Args are computed at serve time (the hashline steps need the captured tag). */
  readonly args: () => Record<string, unknown>;
}

/** The subset of an OpenAI chat-completions message this provider reads back. */
interface ChatMessageView {
  readonly role?: unknown;
  readonly tool_call_id?: unknown;
  readonly content?: unknown;
}

/** The message objects a chat-completions request body carries. */
function chatMessages(body: Record<string, unknown>): ChatMessageView[] {
  const messages = body.messages;
  if (!Array.isArray(messages)) return [];
  return messages.filter((message): message is ChatMessageView =>
    typeof message === "object" && message !== null
  );
}

/**
 * The tool names the native agent advertised to the model in one chat request.
 * This is the model-visible roster the pinned provider builds, so it is
 * independent availability/admission evidence for a tool NAME (never a schema
 * mirror): an unavailable tool can never appear here, and a call to a name absent
 * from it could only produce a not-found result.
 */
function advertisedToolNames(body: Record<string, unknown>): string[] {
  const tools = body.tools;
  if (!Array.isArray(tools)) return [];
  const names: string[] = [];
  for (const entry of tools) {
    if (typeof entry !== "object" || entry === null) continue;
    if (
      "function" in entry && typeof entry.function === "object" && entry.function !== null &&
      "name" in entry.function && typeof entry.function.name === "string"
    ) {
      names.push(entry.function.name);
    } else if ("name" in entry && typeof entry.name === "string") {
      names.push(entry.name);
    }
  }
  return names;
}

/** Join a tool message's content (string, or typed content parts) into text. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (typeof part !== "object" || part === null || !("text" in part)) return "";
    return typeof part.text === "string" ? part.text : "";
  }).join("");
}

/** The deterministic scripted tool-call id for a plan step (lockstep with the assertions). */
function callIdForStep(index: number): string {
  return `call_parity_${index}`;
}

/** One OpenAI chat-completions streaming chunk carrying `delta`. */
function completionChunk(
  delta: Record<string, unknown>,
  finishReason: string | null,
): Record<string, unknown> {
  return {
    id: "chatcmpl-parity",
    object: "chat.completion.chunk",
    created: 0,
    model: FIXTURE_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/** The two chunks of one scripted tool-call turn. */
function toolCallChunks(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown>[] {
  return [
    completionChunk({
      tool_calls: [
        {
          index: 0,
          id: callId,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }, null),
    completionChunk({}, "tool_calls"),
  ];
}

/** Serialize frames as an SSE body terminated by the OpenAI `[DONE]` sentinel. */
function sseResponse(frames: readonly Record<string, unknown>[]): Response {
  const body = `${
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")
  }data: [DONE]\n\n`;
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

/** One bounded error rendering for assertions and provider error lists. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Everything the leg assertions may read back out of the scripted provider. */
interface ScriptedProvider {
  /** Request pathnames the server observed, in order. */
  observedRequestPaths(): readonly string[];
  /** Tool names the native agent advertised to the model (union across requests). */
  advertisedToolNames(): readonly string[];
  /** Chat-completions requests served. */
  chatRequestCount(): number;
  /** True once the terminal (no tool call) turn was served. */
  terminalTurnServed(): boolean;
  /** The native tool result the agent composed for a plan step, when observed. */
  toolResultForStep(index: number): string | undefined;
  /** Serve-time failures (never swallowed). */
  errors(): readonly string[];
  close(): Promise<void>;
}

/** Start the fixed loopback provider for one leg. */
function startScriptedProvider(
  plan: readonly ScriptedToolStep[],
  label: string,
): ScriptedProvider {
  const observedRequestPaths: string[] = [];
  const chatBodies: Record<string, unknown>[] = [];
  const roster = new Set<string>();
  const errors: string[] = [];
  let terminalServed = false;

  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    observedRequestPaths.push(url.pathname);
    if (url.pathname === URL_BYTES_PATH) {
      return new Response(URL_BYTES_CONTENT, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (request.method !== "POST" || url.pathname !== CHAT_COMPLETIONS_PATH) {
      errors.push(`${label}: unexpected request ${request.method} ${url.pathname}`);
      return new Response("not found", { status: 404 });
    }
    let body: Record<string, unknown>;
    try {
      // Boundary read: the only members this fixture consumes are `messages`,
      // whose shape is re-checked property by property in `chatMessages`.
      body = JSON.parse(await request.text()) as Record<string, unknown>;
    } catch (error) {
      errors.push(`${label}: chat request body was not JSON — ${describeError(error)}`);
      return new Response("bad request", { status: 400 });
    }
    chatBodies.push(body);
    for (const name of advertisedToolNames(body)) roster.add(name);

    // The native agent appends one `role: "tool"` message per dispatched call, so
    // the count of those messages is this plan's step cursor. An extra request at
    // the same cursor (a retry) simply re-issues the same step.
    const completed = chatMessages(body).filter((message) => message.role === "tool").length;
    if (completed < plan.length && chatBodies.length <= plan.length + STALL_ALLOWANCE_REQUESTS) {
      const planned = plan[completed];
      try {
        return sseResponse(
          toolCallChunks(callIdForStep(completed), planned.name, planned.args()),
        );
      } catch (error) {
        errors.push(
          `${label}: step ${completed} (${planned.name}) could not be scripted — ${
            describeError(error)
          }`,
        );
      }
    }
    terminalServed = true;
    return sseResponse([
      completionChunk({ content: TERMINAL_TURN_TEXT }, null),
      completionChunk({}, "stop"),
    ]);
  };

  let server: Deno.HttpServer;
  try {
    server = Deno.serve(
      { hostname: LOOPBACK_HOST, port: LOOPBACK_PORT, onListen: () => {} },
      handler,
    );
  } catch (error) {
    throw new Error(
      `native prerequisite failed: the loopback provider could not bind ` +
        `${LOOPBACK_HOST}:${LOOPBACK_PORT} — ${describeError(error)}`,
    );
  }

  /** The content of the tool message the native agent produced for `callId`. */
  const toolResultForCallId = (callId: string): string | undefined => {
    for (const body of chatBodies) {
      for (const message of chatMessages(body)) {
        if (message.role !== "tool" || message.tool_call_id !== callId) continue;
        return contentText(message.content);
      }
    }
    return undefined;
  };

  return {
    observedRequestPaths: () => [...observedRequestPaths],
    advertisedToolNames: () => [...roster].sort(),
    chatRequestCount: () => chatBodies.length,
    terminalTurnServed: () => terminalServed,
    toolResultForStep: (index) => toolResultForCallId(callIdForStep(index)),
    errors: () => [...errors],
    close: async () => {
      await server.shutdown();
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture provisioning (the named setup boundary)
// ---------------------------------------------------------------------------

/** Both native launch modes this evidence covers. */
const NATIVE_MODES = ["restricted", "native-yolo"] as const;

/** The mode type (one of the two shipped launch modes). */
type NativeMode = typeof NATIVE_MODES[number];

/**
 * Provide the fixture's shared native payload.
 *
 * With the pinned executable present (acceptance mode) the payload is produced by the SAME
 * entry a deployment runs, from the PINNED bytes, so the launch consumes a real prepared
 * payload rather than a stand-in. Without it this fixture would be unusable for the ungated
 * factory test, so a synthetic payload — explicitly labelled as a fixture, and never cited as
 * native evidence — is written instead.
 */
async function provisionNativeCache(cacheBase: string): Promise<OmpNativeCacheSelection> {
  const platform = ompNativeCachePlatform();
  if (PINNED_BINARY_READY) {
    const executable = resolveOnPath("omp");
    assert(executable !== undefined, "the pinned omp executable resolves on PATH");
    const result = await prepareOmpNativeCache({
      executable,
      cacheBase,
      platform,
      timeoutMs: 300_000,
    });
    return { installRoot: result.installRoot, launchExecutableVersion: OMP_NATIVE_CACHE_VERSION };
  }
  const cache = ompNativeCacheDescriptor(cacheBase, platform, "development");
  const { exact } = ompNativeCacheExpectedAddons(platform);
  const names = exact.length > 0 ? [...exact] : ["pi_natives.synthetic-linux-arm64.node"];
  await Deno.mkdir(cache.versionDir, { recursive: true });
  for (const name of names) {
    await Deno.writeTextFile(join(cache.versionDir, name), "fixture-native-payload");
  }
  await Deno.writeTextFile(
    cache.manifestPath,
    serializeOmpNativeCacheManifest({
      version: OMP_NATIVE_CACHE_VERSION,
      platform,
      executableSha256: OMP_NATIVE_CACHE_EXECUTABLE_SHA256[platform],
      files: names.map((name) => ({ name, size: "fixture-native-payload".length })),
    }),
  );
  return { installRoot: cache.installRoot, launchExecutableVersion: OMP_NATIVE_CACHE_VERSION };
}

/** One provisioned native leg environment. */
interface NativeFixture {
  /** Temporary deployment root; also the `workspace.repoPath` used by the config. */
  readonly root: string;
  /** Temporary HOME carrying the authored model fixture at its native path. */
  readonly home: string;
  /** The ONE configured skill root, provisioned from tracked skill bytes. */
  readonly skillsRoot: string;
  /**
   * A HARMLESS, OS-readable file OUTSIDE every authorized root (workspace,
   * staging, shared agent workspace, trusted skills). Its sentinel is what makes
   * the external-directory read route and the denied bash command observable.
   */
  readonly externalFile: string;
  /**
   * The shared OMP native runtime payload this fixture's launch consumes, selected
   * through the documented `agent.ompNativeCache` seam. An acceptance leg prepares it with
   * the PINNED executable (`prepare:omp-natives`), exactly as a deployment does; without a
   * pinned binary the fixture provisions a synthetic payload so the ungated factory test can
   * still build the production configuration.
   */
  readonly nativeCache: OmpNativeCacheSelection;
}

/** One leg's workspace paths, all derived from one spelling. */
interface LegPaths {
  readonly workspace: string;
  readonly staging: string;
  readonly fixtureFile: string;
  readonly editTarget: string;
  readonly payload: string;
  readonly escapeWrite: string;
  readonly directMarker: string;
  readonly mountedMarker: string;
}

/** Every path one leg works with. */
function legPathsFor(root: string, mode: NativeMode): LegPaths {
  const workspace = join(root, "legs", mode);
  const staging = join(workspace, "tmp", SKILL_SESSION_ID);
  const markerDirectory = join(workspace, FIXTURE_TOOLS.markerDirectory);
  return {
    workspace,
    staging,
    fixtureFile: join(workspace, "fixture.md"),
    editTarget: join(staging, "edit-target.md"),
    payload: join(staging, "payload.md"),
    escapeWrite: join(workspace, "escape.md"),
    directMarker: join(markerDirectory, FIXTURE_TOOLS.direct.marker),
    mountedMarker: join(markerDirectory, FIXTURE_TOOLS.mounted.marker),
  };
}

/** The staging payload's scripted RELATIVE spelling (`tmp/<Skill API ID>/payload.md`). */
const STAGING_PAYLOAD_RELATIVE = join("tmp", SKILL_SESSION_ID, "payload.md");

/**
 * Provision the fixture boundary: temporary HOME + authored model bytes + the
 * configured skill root + one workspace per leg + the external sentinel file,
 * with `HOME` exported for the duration. Every path this leg observes is written
 * BEFORE the observation interval; the parent environment is restored in
 * `finally`.
 */
async function withNativeFixture(run: (fixture: NativeFixture) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "air-omp-native-runtime-tools-" });
  // Outside `root` on purpose: neither the workspace, the staging directory, the
  // shared agent workspace nor the trusted skills root authorizes this path.
  const externalRoot = await Deno.makeTempDir({ prefix: "air-omp-external-read-" });
  const externalFile = join(externalRoot, "external.md");
  // The prepared native payload also lives OUTSIDE `root`, where the deployment's own cache
  // location guard requires it (a canonical cache inside the data root is refused).
  const cacheBase = await Deno.makeTempDir({ prefix: "air-omp-native-cache-" });
  const previousHome = Deno.env.get("HOME");
  try {
    const home = join(root, "home");
    const skillsRoot = join(home, ".agents", "skills");
    await Deno.mkdir(join(home, ".omp", "agent"), { recursive: true });

    // Authored bytes are installed FIRST: the observation interval starts only
    // after this provisioning, so every later access is a production/native
    // access rather than a setup write.
    await copy(FIXTURE_MODELS_PATH, join(home, HOME_MODELS_RELATIVE));
    await copy(TRACKED_SKILLS_DIR, skillsRoot);
    await Deno.writeTextFile(externalFile, EXTERNAL_FILE_CONTENT);
    assertEquals(
      (await Deno.stat(externalFile)).isFile,
      true,
      "the external sentinel file is provisioned and OS-readable before the leg starts",
    );

    for (const mode of NATIVE_MODES) {
      const paths = legPathsFor(root, mode);
      await Deno.mkdir(paths.staging, { recursive: true });
      await Deno.writeTextFile(paths.fixtureFile, FIXTURE_MD_CONTENT);
      await Deno.writeTextFile(paths.editTarget, EDIT_TARGET_CONTENT);
    }

    Deno.env.set("HOME", home);
    const nativeCache = await provisionNativeCache(cacheBase);
    await run({ root, home, skillsRoot, externalFile, nativeCache });
  } finally {
    if (previousHome === undefined) Deno.env.delete("HOME");
    else Deno.env.set("HOME", previousHome);
    await Deno.remove(root, { recursive: true }).catch(() => {});
    await Deno.remove(externalRoot, { recursive: true }).catch(() => {});
    await Deno.remove(cacheBase, { recursive: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Production configuration and launch
// ---------------------------------------------------------------------------

/** Build the production configuration for one leg. */
function legConfig(fixture: NativeFixture): Config {
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
      // The shared native runtime payload this fixture provisioned, selected through the
      // documented seam: the launch consumes one prepared payload instead of letting the
      // loader extract a channel-local copy.
      ompNativeCache: fixture.nativeCache,
      idleTimeout: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
      sandbox: {
        filterEnv: true,
        networkIsolation: false,
        allowedEnvVars: [],
        allowedWriteExtensions: [".md", ".txt"],
        // Unconfined: this evidence is about native tool dispatch and the shared
        // callbacks, not about the confinement mounts (the `verify-omp-confined-
        // native-runtime` probe owns those).
        filesystemConfinement: false,
        egressProxy: false,
        egressProxyPort: 0,
        // Keeps the parent network namespace shared so the loopback provider and
        // the loopback URL fixture stay reachable; no network isolation is added.
        unrestrictedEgress: true,
        egressAllowHosts: [],
      },
    },
    memory: { recentMessageLimit: 10, workingTierLimit: 10 },
    workspace: { repoPath: fixture.root, workspacesDir: "workspaces" },
    logging: { level: "FATAL" },
    replyPolicy: "channels",
    channels: [],
  };
}

/**
 * The production launch for one leg, plus this test's two additions:
 *  - the fixture extension as an ADDITIONAL repeatable `--trusted-extension`;
 *  - removal of the provider credentials the factory would otherwise forward from
 *    the host environment, so no credential-backed model or search provider can be
 *    billed from this test. Native web search is still dispatched natively; its
 *    (host-dependent) outcome is recorded, never asserted.
 */
function legAgentConfig(
  _fixture: NativeFixture,
  config: Config,
  paths: LegPaths,
  mode: NativeMode,
): AgentConfig {
  const agentConfig = createAgentConfig(
    "omp",
    paths.workspace,
    config,
    mode === "native-yolo",
    undefined,
    SKILL_SESSION_ID,
  );
  assertEquals(agentConfig.command, "omp", `${mode}: the unconfined launch runs omp directly`);
  agentConfig.args.push("--trusted-extension", UNKNOWN_TOOLS_FIXTURE);
  if (agentConfig.env) {
    for (const credential of PROVIDER_CREDENTIALS) delete agentConfig.env[credential];
  }
  for (const credential of PROVIDER_CREDENTIALS) {
    assertEquals(
      agentConfig.env?.[credential],
      undefined,
      `${mode}: the launch carries no ${credential}, so the leg cannot bill a ` +
        `credential-backed provider`,
    );
  }
  return agentConfig;
}

/** Connector options carrying the real factory config and a test client identity. */
function connectorOptionsFor(
  agentConfig: AgentConfig,
  config: Config,
  paths: LegPaths,
  mode: NativeMode,
  skillRegistry: SkillRegistry,
): AgentConnectorOptions {
  return {
    agentConfig,
    clientConfig: {
      workingDir: paths.workspace,
      sessionId: SKILL_SESSION_ID,
      platform: "discord",
      userId: "user",
      channelId: "channel",
      isDM: false,
      yolo: mode === "native-yolo",
      allowedWriteExtensions: config.agent.sandbox?.allowedWriteExtensions,
      // Documented `ClientConfig` test seam (the same one the OMP lifecycle and
      // skill-handoff integration suites use): the offline native-call model with
      // real file handles. This host's bot process has no Debian libc at the
      // owned path `/lib/x86_64-linux-gnu/libc.so.6`, so the real libc/openat2
      // backend fails closed and every ACP filesystem callback would be denied
      // for an environment reason; the REAL authorization + access admission
      // logic still runs on the REAL paths, and real bytes land on disk.
      nativeCalls: createFilesystemTestCalls(),
    },
    skillRegistry,
    logger: new Logger("omp-native-runtime-tools", { level: LogLevel.FATAL }),
    agentType: "omp",
    idleTimeoutConfig: { enabled: false, timeoutMs: 300_000, checkIntervalMs: 30_000 },
  };
}

// ---------------------------------------------------------------------------
// ACP-side observation (requested operation + selected permission)
// ---------------------------------------------------------------------------

/** One recorded ACP permission request and the option this client selected. */
interface RecordedPermissionRequest {
  readonly toolCallId: string;
  readonly title: string;
  readonly kind: string;
  readonly locations: readonly string[];
  readonly outcome: string;
  readonly selectedOptionId?: string;
}

/** One recorded ACP filesystem callback (the native file bridge). */
interface RecordedFilesystemCall {
  readonly operation: "read" | "write";
  readonly path: string;
  readonly allowed: boolean;
  readonly denial?: string;
}

/** One recorded tool-call lifecycle notification. */
interface RecordedToolUpdate {
  readonly sessionUpdate: string;
  readonly toolCallId: string;
  readonly title: string;
  readonly kind: string;
  readonly status: string;
  readonly locations: readonly string[];
}

/** The path of one ACP `locations` entry, when it is a string. */
function locationPath(location: unknown): string[] {
  if (typeof location !== "object" || location === null || !("path" in location)) return [];
  return typeof location.path === "string" ? [location.path] : [];
}

/** Every ACP-side observation for one leg. */
interface AcpObservation {
  readonly permissionRequests: readonly RecordedPermissionRequest[];
  readonly filesystemCalls: readonly RecordedFilesystemCall[];
  readonly toolUpdates: readonly RecordedToolUpdate[];
}

/**
 * Observe the REAL `ChatbotClient` for one leg by wrapping the four callbacks the
 * native agent drives, delegating to the original implementation unchanged. This
 * is the "requested operation + selected permission" channel: the native agent
 * really calls back, and the recorded selection is this deployment's decision.
 */
function observeAcpClient(connector: AgentConnector): AcpObservation {
  const client = connector.getClient();
  assert(client !== null, "the real connector exposed its ACP client");
  const permissionRequests: RecordedPermissionRequest[] = [];
  const filesystemCalls: RecordedFilesystemCall[] = [];
  const toolUpdates: RecordedToolUpdate[] = [];

  const originalPermission = client.requestPermission.bind(client);
  const recordPermission: ChatbotClient["requestPermission"] = async (params) => {
    const response = await originalPermission(params);
    permissionRequests.push({
      toolCallId: params.toolCall.toolCallId,
      title: params.toolCall.title ?? "",
      kind: params.toolCall.kind ?? "",
      locations: (params.toolCall.locations ?? []).flatMap(locationPath),
      outcome: response.outcome.outcome,
      selectedOptionId: response.outcome.outcome === "selected"
        ? response.outcome.optionId
        : undefined,
    });
    return response;
  };
  client.requestPermission = recordPermission;

  const originalRead = client.readTextFile.bind(client);
  const recordRead: ChatbotClient["readTextFile"] = async (params) => {
    try {
      const response = await originalRead(params);
      filesystemCalls.push({ operation: "read", path: params.path, allowed: true });
      return response;
    } catch (error) {
      filesystemCalls.push({
        operation: "read",
        path: params.path,
        allowed: false,
        denial: describeError(error),
      });
      throw error;
    }
  };
  client.readTextFile = recordRead;

  const originalWrite = client.writeTextFile.bind(client);
  const recordWrite: ChatbotClient["writeTextFile"] = async (params) => {
    try {
      const response = await originalWrite(params);
      filesystemCalls.push({ operation: "write", path: params.path, allowed: true });
      return response;
    } catch (error) {
      filesystemCalls.push({
        operation: "write",
        path: params.path,
        allowed: false,
        denial: describeError(error),
      });
      throw error;
    }
  };
  client.writeTextFile = recordWrite;

  const originalUpdate = client.sessionUpdate.bind(client);
  const recordUpdate: ChatbotClient["sessionUpdate"] = (params) => {
    const update = params.update;
    // The SDK union is discriminated on `sessionUpdate`, so these two arms are
    // fully typed: no cast, and every recorded field is read from the real shape.
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      toolUpdates.push({
        sessionUpdate: update.sessionUpdate,
        toolCallId: update.toolCallId,
        title: update.title ?? "",
        kind: update.kind ?? "",
        status: update.status ?? "",
        locations: (update.locations ?? []).flatMap(locationPath),
      });
    }
    return originalUpdate(params);
  };
  client.sessionUpdate = recordUpdate;

  return { permissionRequests, filesystemCalls, toolUpdates };
}

// ---------------------------------------------------------------------------
// The scripted plans
// ---------------------------------------------------------------------------

/** The hashline `PUT` patch this test sends for the ordinary edit. */
function hashlinePut(target: string, tag: string, body: readonly string[]): string {
  const rows = body.map((line) => `+${line}`).join("\n");
  return `*** Begin Patch\n[${target}#${tag}]\nPUT 1.=1:\n${rows}\n*** End Patch`;
}

/** The hashline `REM` patch this test sends for the unsupported destructive case. */
function hashlineRem(target: string, tag: string): string {
  return `*** Begin Patch\n[${target}#${tag}]\nREM\n*** End Patch`;
}

/** Bounded rendering of native/model text inside assertion messages. */
function boundedText(text: string, max = 400): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * Capture the native four-hex snapshot tag from a read/`grep`/edit result. The
 * pinned grammar (`edit/hashline-compact.md`, `docs/tools/edit.md`) emits a
 * `[PATH#TAG]` header; a bare `#TAG` is accepted as the fallback spelling.
 */
function captureSnapshotTag(toolResult: string, label: string): string {
  const header = toolResult.match(/\[[^\]\r\n#]*#([0-9A-Fa-f]{4})\]/);
  if (header) return header[1];
  const matches = [...toolResult.matchAll(/#([0-9A-Fa-f]{4})\b/g)];
  if (matches.length === 0) {
    throw new Error(
      `${label}: no native four-hex snapshot tag in the tool result — observed: ${
        boundedText(toolResult)
      }`,
    );
  }
  return matches[matches.length - 1][1];
}

/**
 * The plan's tag source, tried in order of recency. The anchoring read is the
 * documented tag source; a successful hashline section's own fresh `[path#TAG]`
 * header is the documented equivalent, and it is the fallback because the native
 * context reducer may ELIDE a large/older tool result before the model sees it
 * (observed: `[shaken ~N tokens — recover: artifact://…]`). An elided or missing
 * result is never parsed for a tag; the next candidate is tried, and exhausting
 * every candidate fails with all observed texts.
 */
function tagFromSteps(
  provider: ScriptedProvider | undefined,
  indexes: readonly number[],
  label: string,
): string {
  if (provider === undefined) throw new Error(`${label}: the scripted provider was not started`);
  const observed: string[] = [];
  for (const index of indexes) {
    const toolResult = provider.toolResultForStep(index);
    if (toolResult === undefined) {
      observed.push(`step ${index}: <no tool result>`);
      continue;
    }
    if (toolResult.includes("[shaken")) {
      observed.push(`step ${index}: ${boundedText(toolResult, 120)}`);
      continue;
    }
    return captureSnapshotTag(toolResult, `${label} step ${index}`);
  }
  throw new Error(
    `${label}: no usable native four-hex snapshot tag from plan steps ${
      indexes.join(", ")
    } — observed: ${observed.join(" | ")}`,
  );
}

/** The restricted plan's tag-anchoring steps (the read, then the edit's own header). */
const RESTRICTED_TAG_STEPS_PUT = [1] as const;
const RESTRICTED_TAG_STEPS_REM = [12, 11] as const;

/** Build the restricted leg's scripted plan. */
function restrictedPlan(
  paths: LegPaths,
  readTag: (indexes: readonly number[]) => string,
  externalFile: string,
): ScriptedToolStep[] {
  return [
    // 0/1 — local reads; the second anchors the hashline tag.
    { name: "read", args: () => ({ path: "fixture.md" }) },
    { name: "read", args: () => ({ path: paths.editTarget }) },
    // 2 — native skill instruction read through the resolved skill root.
    { name: "read", args: () => ({ path: "skill://send-reply" }) },
    // 3 — URL read served by the fixed loopback server.
    { name: "read", args: () => ({ path: FIXTURE_URL }) },
    // 4/5 — local search (the native glob has no separate pattern field).
    { name: "grep", args: () => ({ pattern: "parity-smoke", path: "fixture.md" }) },
    { name: "glob", args: () => ({ path: "*.md" }) },
    // 6/7 — todo lifecycle.
    { name: "todo", args: () => ({ op: "init", items: ["parity-smoke"] }) },
    { name: "todo", args: () => ({ op: "view" }) },
    // 8/9 — bash allowed by the shared command policy, then denied by it.
    { name: "bash", args: () => ({ command: "cat fixture.md" }) },
    // The denied command names a path OUTSIDE every authorized root (the external
    // sentinel file), so its result must never carry that file's bytes.
    { name: "bash", args: () => ({ command: `cat '${externalFile}'` }) },
    // 10 — native web search; its ACTUAL provider outcome is recorded, never
    // asserted as a live-search claim.
    { name: "web_search", args: () => ({ query: "parity smoke" }) },
    // 11 — the ordinary default-`hashline` edit (tag copied from step 1).
    {
      name: "edit",
      args: () => ({
        input: hashlinePut(paths.editTarget, readTag(RESTRICTED_TAG_STEPS_PUT), [
          EDITED_FIRST_LINE,
        ]),
      }),
    },
    // 12 — re-read: a snapshot tag is only valid for the current content.
    { name: "read", args: () => ({ path: paths.editTarget }) },
    // 13 — destructive hashline REM (tag copied from step 12): the shared
    // unsupported destructive-patch denial must survive.
    {
      name: "edit",
      args: () => ({ input: hashlineRem(paths.editTarget, readTag(RESTRICTED_TAG_STEPS_REM)) }),
    },
    // 14 — the native roster exposes no `delete`/`move` tool (the ACP bridge's
    // permission-gate vocabulary covers deployment-registered ones), so the
    // COMPLETE destructive case is not reachable through a shipped native tool.
    { name: "delete", args: () => ({ path: paths.editTarget }) },
    // 15/16 — a staging write the ACP callback authorizes, then one it denies.
    { name: "write", args: () => ({ path: STAGING_PAYLOAD_RELATIVE, content: WRITE_CONTENT }) },
    { name: "write", args: () => ({ path: "escape.md", content: WRITE_CONTENT }) },
    // 17 — the fixture's essential tool, called directly.
    { name: FIXTURE_TOOLS.direct.name, args: () => ({}) },
    // 18 — the fixture's discoverable tool, reached through the write device.
    {
      name: "write",
      args: () => ({ path: `xd://${FIXTURE_TOOLS.mounted.name}`, content: "{}" }),
    },
    // 19 — the explicit LSP tool denial authored in both mode documents.
    {
      name: "write",
      args: () => ({ path: "xd://lsp", content: JSON.stringify({ action: "status" }) }),
    },
    // 20 — an ORDINARY read of a file outside every authorized daemon root. Its
    // result and the ACP callback decision are captured, not policed: the
    // deployment's read policy is unchanged and this leg introduces no new rule.
    { name: "read", args: () => ({ path: externalFile }) },
  ];
}

/** The YOLO plan's tag-anchoring read. */
const YOLO_TAG_STEPS_PUT = [0] as const;

/** Build the native-YOLO leg's scripted plan (the exposure positive control). */
function yoloPlan(
  paths: LegPaths,
  readTag: (indexes: readonly number[]) => string,
): ScriptedToolStep[] {
  return [
    // 0 — tag-anchoring read.
    { name: "read", args: () => ({ path: paths.editTarget }) },
    // 1 — the fixture's essential tool must really execute.
    { name: FIXTURE_TOOLS.direct.name, args: () => ({}) },
    // 2 — the fixture's mounted device must really execute.
    {
      name: "write",
      args: () => ({ path: `xd://${FIXTURE_TOOLS.mounted.name}`, content: "{}" }),
    },
    // 3 — bash under the permissive native policy.
    { name: "bash", args: () => ({ command: "cat fixture.md" }) },
    // 4 — ordinary hashline edit.
    {
      name: "edit",
      args: () => ({
        input: hashlinePut(paths.editTarget, readTag(YOLO_TAG_STEPS_PUT), [EDITED_FIRST_LINE]),
      }),
    },
    // 5 — ordinary write.
    { name: "write", args: () => ({ path: STAGING_PAYLOAD_RELATIVE, content: WRITE_CONTENT }) },
    // 6 — the explicit LSP denial is per-mode YAML in YOLO too.
    {
      name: "write",
      args: () => ({ path: "xd://lsp", content: JSON.stringify({ action: "status" }) }),
    },
  ];
}

// ---------------------------------------------------------------------------
// The leg runner
// ---------------------------------------------------------------------------

/** One leg's complete evidence. */
interface NativeLegEvidence {
  readonly label: string;
  readonly plan: readonly ScriptedToolStep[];
  /** Native tool results, indexed by plan step. */
  readonly toolResults: readonly (string | undefined)[];
  /** Tool names the native agent advertised to the model during this leg. */
  readonly advertisedToolNames: readonly string[];
  readonly stopReason: string;
  readonly observedRequestPaths: readonly string[];
  readonly chatRequestCount: number;
  readonly terminalTurnServed: boolean;
  readonly providerErrors: readonly string[];
  readonly acp: AcpObservation;
  readonly rejections: readonly PermissionRejection[];
}

/** Run one leg: connect, create the session, prompt the scripted plan, observe. */
async function runNativeLeg(
  fixture: NativeFixture,
  mode: NativeMode,
): Promise<NativeLegEvidence> {
  const paths = legPathsFor(fixture.root, mode);
  const config = legConfig(fixture);
  const label = mode;
  const skillRegistry = new SkillRegistry(
    new MemoryStore(new WorkspaceManager(config.workspace), {}),
  );
  const agentConfig = legAgentConfig(fixture, config, paths, mode);
  const connector = new AgentConnector(
    connectorOptionsFor(agentConfig, config, paths, mode, skillRegistry),
  );

  let provider: ScriptedProvider | undefined;
  try {
    await connector.connect();
    const observation = observeAcpClient(connector);
    const sessionId = await connector.createSession([], paths.workspace);
    await connector.setSessionModel(sessionId, FIXTURE_MODEL_SELECTOR);

    const readTag = (indexes: readonly number[]): string => tagFromSteps(provider, indexes, label);
    const plan = mode === "restricted"
      ? restrictedPlan(paths, readTag, fixture.externalFile)
      : yoloPlan(paths, readTag);
    provider = await startScriptedProvider(plan, label);

    const response = await connector.prompt(sessionId, `Run the scripted parity plan (${mode}).`);
    return {
      label,
      plan,
      toolResults: plan.map((_step, index) => provider?.toolResultForStep(index)),
      advertisedToolNames: provider.advertisedToolNames(),
      stopReason: String(response.stopReason ?? ""),
      observedRequestPaths: provider.observedRequestPaths(),
      chatRequestCount: provider.chatRequestCount(),
      terminalTurnServed: provider.terminalTurnServed(),
      providerErrors: provider.errors(),
      acp: observation,
      rejections: connector.getClient()?.getRecentPermissionRejections() ?? [],
    };
  } finally {
    if (provider !== undefined) {
      await provider.close().catch(() => {});
    }
    await connector.disconnect().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** The native tool result for one plan step, or a named failure. */
function toolResult(evidence: NativeLegEvidence, index: number): string {
  const stepName = evidence.plan[index]?.name ?? "(out of range)";
  const result = evidence.toolResults[index];
  assert(
    result !== undefined,
    `${evidence.label}: step ${index} (${stepName}) produced no tool result — the native agent ` +
      `never dispatched it (chat requests: ${evidence.chatRequestCount})`,
  );
  return boundedText(result, 4000);
}

/** Assert a substring is present, naming the observed native text on failure. */
function assertToolResultIncludes(
  evidence: NativeLegEvidence,
  index: number,
  needle: string,
  message: string,
): void {
  const observed = toolResult(evidence, index);
  assert(
    observed.includes(needle),
    `${evidence.label}: ${message} — expected "${needle}", observed: ${boundedText(observed)}`,
  );
}

/** Assert the leg's scripted plan completed against a live native agent. */
function assertLegCompletion(evidence: NativeLegEvidence): void {
  assertEquals(
    evidence.providerErrors,
    [],
    `${evidence.label}: the scripted provider served every request without error`,
  );
  assert(
    evidence.terminalTurnServed,
    `${evidence.label}: the terminal turn was served (${evidence.chatRequestCount} chat requests)`,
  );
  assert(
    evidence.stopReason.length > 0,
    `${evidence.label}: the ACP prompt resolved with a stop reason`,
  );
  assert(
    evidence.chatRequestCount >= evidence.plan.length,
    `${evidence.label}: every scripted step got its own provider turn ` +
      `(${evidence.chatRequestCount} requests for ${evidence.plan.length} steps)`,
  );
  assert(
    evidence.acp.toolUpdates.length > 0,
    `${evidence.label}: the ACP client received native tool-call lifecycle notifications`,
  );
  // The only endpoints this loopback fixture serves; anything else would mean a
  // route this test does not own was contacted.
  const unexpected = evidence.observedRequestPaths.filter((path) =>
    path !== CHAT_COMPLETIONS_PATH && path !== URL_BYTES_PATH
  );
  assertEquals(
    unexpected,
    [],
    `${evidence.label}: the model/URL fixture was the only endpoint contacted`,
  );
  assert(
    evidence.observedRequestPaths.includes(CHAT_COMPLETIONS_PATH),
    `${evidence.label}: the scripted provider really served the chat completions route`,
  );
}

/** Whether a marker path exists on disk right now. */
async function markerExists(path: string): Promise<boolean> {
  return await Deno.lstat(path).then(() => true, () => false);
}

/** The restricted leg: blocked vs allowed outcomes, with unchanged files on denial. */
async function assertRestrictedLeg(
  evidence: NativeLegEvidence,
  paths: LegPaths,
  externalFile: string,
): Promise<void> {
  // ── Native availability/admission, independent of any dispatch outcome ───
  // The agent advertised these tool names to the model on its own roster, so a
  // later call to any of them can only be a REAL tool call (an unregistered name
  // could not appear here, and would answer "not found").
  const missingFromRoster = REQUIRED_ROSTER_NAMES.filter((name) =>
    !evidence.advertisedToolNames.includes(name)
  );
  assertEquals(
    missingFromRoster,
    [],
    `${evidence.label}: the native roster advertised every required tool — observed ` +
      `(${evidence.advertisedToolNames.length} names): ${evidence.advertisedToolNames.join(", ")}`,
  );

  // ── Read / search / todo: the shipped native tools really ran ────────────
  assertToolResultIncludes(evidence, 0, FIXTURE_MD_MARKER, "read returned the local file bytes");
  const tagForPut = captureSnapshotTag(toolResult(evidence, 1), `${evidence.label} step 1`);
  assertEquals(tagForPut.length, 4, "the read result carries a native four-hex snapshot tag");
  assertToolResultIncludes(evidence, 2, "send-reply", "read resolved the skill instruction");
  assertToolResultIncludes(evidence, 3, URL_BYTES_MARKER, "read returned the URL bytes");
  assertToolResultIncludes(evidence, 4, "parity-smoke", "grep returned the matching line");
  assertToolResultIncludes(evidence, 5, "fixture.md", "glob returned the matching file");
  assertToolResultIncludes(evidence, 6, "parity-smoke", "todo init stored the task");
  assertToolResultIncludes(evidence, 7, "parity-smoke", "todo view returned the stored task");

  // ── bash: allowed then denied by the shared command policy ───────────────
  assertToolResultIncludes(evidence, 8, FIXTURE_MD_MARKER, "the allowed bash command really ran");
  const bashPermissions = evidence.acp.permissionRequests.filter((request) =>
    request.kind === "execute"
  );
  assertEquals(
    bashPermissions.map((request) => request.selectedOptionId),
    ["allow_once", "reject_once"],
    `${evidence.label}: the client approved the workspace-confined command and rejected the ` +
      `out-of-boundary one — observed: ${JSON.stringify(evidence.acp.permissionRequests)}`,
  );
  const bashDenial = evidence.rejections.find((rejection) => rejection.kind === "execute");
  assert(
    bashDenial !== undefined,
    `${evidence.label}: the denied bash command was recorded — observed: ${
      JSON.stringify(evidence.rejections)
    }`,
  );
  assertMatch(
    bashDenial.reason,
    /^rejected_generic_command_/,
    `${evidence.label}: the denial names the shared command policy reason`,
  );
  assert(
    (bashDenial.commandOrPath ?? "").length > 0,
    `${evidence.label}: the denial records the rejected command segment`,
  );
  // The rejected command never ran: a command naming a path outside every
  // authorized root produces no output at all, so the external file's sentinel
  // must never appear (an absence-of-unrelated-fixture check would not prove it).
  const deniedBashResult = toolResult(evidence, 9);
  assert(
    !deniedBashResult.includes(EXTERNAL_SENTINEL),
    `${evidence.label}: the denied bash command never read the external file (sentinel ` +
      `absent) — observed: ${boundedText(deniedBashResult)}`,
  );

  // ── web_search: attempted native dispatch, ACTUAL provider outcome ───────
  // The provider outcome is host-dependent and is deliberately not asserted as
  // a stable native compatibility contract (task 1.2 risk note): with a
  // configured/free backend the pinned binary performs a real search, and
  // without one it reports its own absence outcome. The native context reducer
  // may additionally elide the (large) search result before the model reads it.
  // Either way this leg records the ACTUAL model-facing text and only asserts it
  // never fabricates fixture content.
  const webSearch = toolResult(evidence, 10);
  assert(webSearch.length > 0, "web_search produced a native result");
  assert(
    !webSearch.includes("parity-smoke"),
    `web_search fabricated no fixture content — observed: ${boundedText(webSearch)}`,
  );
  // An unavailable/unadmitted tool (unregistered name, capability or approval
  // block) would satisfy "a result exists" vacuously, so it fails the leg here.
  assert(
    !UNAVAILABLE_DISPATCH_PATTERN.test(webSearch),
    `${evidence.label}: web_search was available and admitted to dispatch (no ` +
      `unknown-tool/not-found/policy-block outcome) — observed: ${boundedText(webSearch)}`,
  );
  const webSearchOutcome = webSearch.startsWith("[shaken ~")
    ? "elided by the native context reducer before the model read it"
    : WEB_SEARCH_ABSENT_PATTERN.test(webSearch)
    ? "no-backend/credential"
    : "provider result";
  console.log(
    `[native evidence] ${evidence.label}: web_search advertised on the native roster and ` +
      `admitted to dispatch; outcome = ${webSearchOutcome} ` +
      `(${webSearch.length} chars; not asserted as a live-search claim)`,
  );

  // ── Ordinary hashline edit: the allowed file's first line changes ────────
  const edited = (await Deno.readTextFile(paths.editTarget)).split("\n");
  assertEquals(edited[0], EDITED_FIRST_LINE, `${evidence.label}: the ordinary hashline PUT landed`);
  assertEquals(
    edited.length,
    EDIT_TARGET_CONTENT.split("\n").length,
    `${evidence.label}: the edit touched only line 1`,
  );

  // ── Destructive hashline REM: shared unsupported-patch denial, file kept ─
  const destructive = evidence.rejections.filter((rejection) =>
    rejection.reason.startsWith("rejected_destructive")
  );
  assert(
    destructive.length > 0,
    `${evidence.label}: the destructive hashline REM was denied by the shared destructive ` +
      `policy — observed rejections: ${JSON.stringify(evidence.rejections)}`,
  );
  const destructiveRequest = evidence.acp.permissionRequests.find((request) =>
    /^(delete|move)(\s|$)/i.test(request.title)
  );
  assert(
    destructiveRequest !== undefined,
    `${evidence.label}: the native edit surfaced a destructive permission request — observed: ${
      JSON.stringify(evidence.acp.permissionRequests)
    }`,
  );
  assertEquals(
    destructiveRequest.selectedOptionId,
    "reject_once",
    `${evidence.label}: the client selected the reject option for the destructive request`,
  );
  assert(
    destructiveRequest.locations.some((path) => path.endsWith("edit-target.md")),
    `${evidence.label}: the request carried the native display locations — observed: ${
      destructiveRequest.locations.join(", ")
    }`,
  );
  assertEquals(
    (await Deno.readTextFile(paths.editTarget)).split("\n")[0],
    EDITED_FIRST_LINE,
    `${evidence.label}: the denied destructive REM left the file unchanged`,
  );

  // ── The COMPLETE destructive case is not exposed by a shipped native tool ─
  const notExposed = toolResult(evidence, 14);
  assertMatch(
    notExposed,
    /not (?:a )?known tool|not found|no such tool|unknown tool/i,
    `${evidence.label}: \`delete\` is not dispatchable from the native roster — observed: ${
      boundedText(notExposed)
    }`,
  );

  // ── Writes: the ACP callback authorizes staging and denies elsewhere ─────
  assertEquals(
    await Deno.readTextFile(paths.payload),
    WRITE_CONTENT,
    `${evidence.label}: the authorized staging write landed on disk`,
  );
  const stagingCall = evidence.acp.filesystemCalls.find((call) =>
    call.operation === "write" && call.path === paths.payload
  );
  assert(
    stagingCall?.allowed === true,
    `${evidence.label}: the staging write went through the ACP writeTextFile callback and was ` +
      `authorized — observed: ${JSON.stringify(evidence.acp.filesystemCalls)}`,
  );
  assertEquals(
    await markerExists(paths.escapeWrite),
    false,
    `${evidence.label}: the denied write left nothing on disk`,
  );
  const escapeCall = evidence.acp.filesystemCalls.find((call) =>
    call.operation === "write" && call.path === paths.escapeWrite
  );
  assert(
    escapeCall !== undefined && !escapeCall.allowed,
    `${evidence.label}: the out-of-root write was refused by the ACP callback — observed: ${
      JSON.stringify(evidence.acp.filesystemCalls)
    }`,
  );
  assertMatch(
    escapeCall.denial ?? "",
    /^Filesystem request denied: rejected_/,
    `${evidence.label}: the callback denial names a bounded shared reason`,
  );

  // ── Unmatched effectful tools: blocked before dispatch, markers absent ──
  assertToolResultIncludes(
    evidence,
    17,
    "rejected_unknown_tool",
    "the direct unmatched tool was blocked by the restricted capability callback",
  );
  assertEquals(
    await markerExists(paths.directMarker),
    false,
    `${evidence.label}: the blocked direct tool wrote no marker`,
  );
  assertToolResultIncludes(
    evidence,
    18,
    "rejected_unknown_tool",
    "the xd:// route to the mounted unmatched tool was blocked before dispatch",
  );
  assertEquals(
    await markerExists(paths.mountedMarker),
    false,
    `${evidence.label}: the blocked mounted tool wrote no marker`,
  );

  // ── The explicit LSP denial is native exact-name approval policy ────────
  const lspResult = toolResult(evidence, 19);
  assertMatch(
    lspResult,
    /blocked by (?:user|tool) policy/i,
    `${evidence.label}: the lsp call was denied by native approval policy — observed: ${
      boundedText(lspResult)
    }`,
  );

  // ── Ordinary read of a file OUTSIDE every authorized root ────────────────
  // The requested operation and its ACTUAL outcome are captured, and the ACP
  // callback decision is recorded: this leg adds no read policy and widens no
  // authorization, it reports the route this deployment really took.
  const externalRead = toolResult(evidence, 20);
  assert(
    externalRead.includes(EXTERNAL_SENTINEL),
    `${evidence.label}: the external-directory read returned the file's own bytes — ` +
      `observed: ${boundedText(externalRead)}`,
  );
  const externalReadCall = evidence.acp.filesystemCalls.find((call) =>
    call.operation === "read" && call.path === externalFile
  );
  const externalReadRoute = externalReadCall === undefined
    ? "no ACP readTextFile callback (the native read served the path itself)"
    : externalReadCall.allowed
    ? "ACP readTextFile callback authorized the read"
    : `ACP readTextFile callback denied it (${externalReadCall.denial}); the native read ` +
      `fell back to its own disk read`;
  console.log(
    `[native evidence] ${evidence.label}: external-directory read route = ${externalReadRoute}`,
  );

  // The capability callback received native tool-call notifications for the
  // scripted operations (requested-operation evidence, not a policy claim).
  assert(
    evidence.acp.toolUpdates.some((update) => update.title.length > 0 || update.kind.length > 0),
    `${evidence.label}: tool-call notifications carried a title/kind — observed: ${
      JSON.stringify(evidence.acp.toolUpdates)
    }`,
  );
}

/** The native-YOLO leg: the exposure/dispatch positive control. */
async function assertYoloLeg(evidence: NativeLegEvidence, paths: LegPaths): Promise<void> {
  // Both unmatched-name routes MUST execute: this is what proves the restricted
  // leg's "rejected_unknown_tool" is a policy denial, not an unavailable tool.
  assertEquals(
    await markerExists(paths.directMarker),
    true,
    `${evidence.label}: the essential fixture tool really executed (marker present)`,
  );
  assertStringIncludes(
    await Deno.readTextFile(paths.directMarker),
    FIXTURE_TOOLS.direct.name,
    `${evidence.label}: the direct marker names its executing tool`,
  );
  assertToolResultIncludes(
    evidence,
    1,
    FIXTURE_TOOLS.direct.marker,
    "the direct fixture tool returned its marker path",
  );
  assertEquals(
    await markerExists(paths.mountedMarker),
    true,
    `${evidence.label}: the mounted fixture device really executed (marker present)`,
  );
  assertStringIncludes(
    await Deno.readTextFile(paths.mountedMarker),
    FIXTURE_TOOLS.mounted.name,
    `${evidence.label}: the mounted marker names its executing tool`,
  );
  assertToolResultIncludes(
    evidence,
    2,
    FIXTURE_TOOLS.mounted.marker,
    "the mounted fixture device returned its marker path",
  );

  // Ordinary operations stay permissive in YOLO.
  assertToolResultIncludes(evidence, 3, FIXTURE_MD_MARKER, "bash ran under native YOLO policy");
  assertEquals(
    (await Deno.readTextFile(paths.editTarget)).split("\n")[0],
    EDITED_FIRST_LINE,
    `${evidence.label}: the ordinary hashline edit landed`,
  );
  assertEquals(
    await Deno.readTextFile(paths.payload),
    WRITE_CONTENT,
    `${evidence.label}: the ordinary write landed`,
  );

  // The single explicit exception is native exact-name approval in this mode too.
  const lspResult = toolResult(evidence, 6);
  assertMatch(
    lspResult,
    /blocked by (?:user|tool) policy/i,
    `${evidence.label}: YOLO keeps the explicit lsp denial — observed: ${boundedText(lspResult)}`,
  );

  // YOLO permission behavior: the client gate is never consulted, because the
  // authored `tools.approvalMode: yolo` is the explicit auto-approve opt-in.
  assertEquals(
    evidence.acp.permissionRequests,
    [],
    `${evidence.label}: native-YOLO asked the client for no permission — observed: ${
      JSON.stringify(evidence.acp.permissionRequests)
    }`,
  );
  assertEquals(
    evidence.rejections,
    [],
    `${evidence.label}: native-YOLO recorded no permission denial — observed: ${
      JSON.stringify(evidence.rejections)
    }`,
  );
}

// ---------------------------------------------------------------------------
// Test 1 — prerequisite observation (always runs; claims no native behavior)
// ---------------------------------------------------------------------------

/** The observed prerequisite state, reported by the always-running test. */
interface NativePrerequisiteReport {
  readonly pinnedVersion: string;
  readonly detectedVersion: string | null;
  readonly pinnedBinaryReady: boolean;
  readonly dumbInitReady: boolean;
  readonly loopbackPortFree: boolean;
  readonly trustedExtensionPath: string;
  readonly trustedExtensionReady: boolean;
}

Deno.test({
  name: `native runtime prerequisites are observed: pinned omp ${PINNED_OMP_VERSION}, dumb-init, ` +
    `loopback ${LOOPBACK_HOST}:${LOOPBACK_PORT}, trusted extension bundle`,
  fn: () => {
    const report: NativePrerequisiteReport = {
      pinnedVersion: PINNED_OMP_VERSION,
      detectedVersion: DETECTED_OMP_VERSION,
      pinnedBinaryReady: PINNED_BINARY_READY,
      dumbInitReady: DUMB_INIT_READY,
      loopbackPortFree: observeLoopbackPort().free,
      trustedExtensionPath: TRUSTED_EXTENSION_PATH,
      trustedExtensionReady: TRUSTED_EXTENSION_READY,
    };
    assertEquals(report.pinnedVersion, PINNED_OMP_VERSION, "the pin is the pinned release");
    assertEquals(
      report.pinnedBinaryReady,
      report.detectedVersion === PINNED_OMP_VERSION,
      `pinned-binary readiness follows the detected version (${report.detectedVersion ?? "none"})`,
    );
    assertEquals(
      report.loopbackPortFree,
      observeLoopbackPort().free,
      "the port observation is a real bind/release probe",
    );
    assert(
      report.trustedExtensionPath.startsWith("/"),
      `the extension bundle path is absolute: ${report.trustedExtensionPath}`,
    );
    assertEquals(
      report.trustedExtensionReady,
      existsSync(report.trustedExtensionPath),
      "bundle readiness follows the artifact's existence",
    );
  },
});

// ---------------------------------------------------------------------------
// Test 2 — the fixture's own exposure/dispatch contract (no native binary)
// ---------------------------------------------------------------------------

/** One tool the fixture registered, as the native API receives it. */
interface RegisteredFixtureTool {
  readonly name: string;
  readonly loadMode?: string;
  readonly defaultInactive?: boolean;
  readonly approval?: unknown;
  readonly parameters: Record<string | symbol, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { readonly cwd: string },
  ): Promise<{ content: readonly { type: string; text: string }[] }>;
}

/** The fixture module surface this test drives. */
interface FixtureModule {
  readonly default: (api: { registerTool(tool: RegisteredFixtureTool): void }) => void;
  readonly PARITY_UNKNOWN_TOOLS: {
    readonly direct: { readonly name: string; readonly marker: string; readonly loadMode: string };
    readonly mounted: { readonly name: string; readonly marker: string; readonly loadMode: string };
    readonly markerDirectory: string;
  };
  readonly parityMarkerPath: (cwd: string, marker: string) => string;
}

Deno.test({
  name: "unknown-tools fixture: a native default factory registers both exposure modes and its " +
    "execute really writes its marker (no native binary involved)",
  fn: async () => {
    // The fixture is a native `--trusted-extension` module, so it is loaded here
    // through the module-loading boundary itself (a runtime-selected path) rather
    // than a TS re-export; the cast names the interface the suite drives.
    const url = new URL("../../fixtures/omp-native-runtime/unknown-tools.js", import.meta.url).href;
    const fixture = await import(url) as FixtureModule;
    assertEquals(typeof fixture.default, "function", "the module default is the extension factory");
    assertEquals(
      fixture.PARITY_UNKNOWN_TOOLS.direct.name,
      FIXTURE_TOOLS.direct.name,
      "the fixture contract matches the names this suite scripts",
    );
    assertEquals(
      fixture.PARITY_UNKNOWN_TOOLS.mounted.name,
      FIXTURE_TOOLS.mounted.name,
      "the fixture contract matches the mounted name this suite scripts",
    );

    const registered: RegisteredFixtureTool[] = [];
    fixture.default({ registerTool: (tool) => registered.push(tool) });
    assertEquals(registered.length, 2, "the factory registers exactly its two tools");

    const byName = new Map(registered.map((tool) => [tool.name, tool]));
    for (const contract of [FIXTURE_TOOLS.direct, FIXTURE_TOOLS.mounted]) {
      const tool = byName.get(contract.name);
      assert(tool !== undefined, `the fixture registered "${contract.name}"`);
      assertEquals(tool.loadMode, contract.loadMode, `${contract.name}: declared load mode`);
      assertEquals(
        tool.defaultInactive,
        false,
        `${contract.name}: registered active without an explicit --tools listing`,
      );
      assertEquals(tool.approval, "write", `${contract.name}: declared approval tier`);
      assertEquals(tool.parameters.type, "object", `${contract.name}: empty object schema`);
      assertEquals(
        tool.parameters.additionalProperties,
        false,
        `${contract.name}: closed object schema`,
      );
      assertEquals(
        tool.parameters[Symbol.for("TypeBox.Kind")],
        "Object",
        `${contract.name}: legacy TypeBox brand`,
      );
      const required = tool.parameters.required;
      assertEquals(
        Array.isArray(required) ? required.length : -1,
        0,
        `${contract.name}: no required properties`,
      );
    }

    // Dispatch control: each tool's own execute really writes its distinct marker
    // under the session working directory's tmp/.
    const cwd = await Deno.makeTempDir({ prefix: "parity-fixture-exec-" });
    try {
      for (const contract of [FIXTURE_TOOLS.direct, FIXTURE_TOOLS.mounted]) {
        const tool = byName.get(contract.name);
        assert(tool !== undefined, `${contract.name}: registered`);
        const result = await tool.execute(
          `call_fixture_${contract.name}`,
          {},
          undefined,
          undefined,
          { cwd },
        );
        const markerPath = fixture.parityMarkerPath(cwd, contract.marker);
        assert(existsSync(markerPath), `${contract.name}: execute wrote its marker`);
        assertStringIncludes(
          await Deno.readTextFile(markerPath),
          contract.name,
          `${contract.name}: the marker names the executing tool`,
        );
        assertStringIncludes(
          result.content[0].text,
          markerPath,
          `${contract.name}: execute returns the marker path as text content`,
        );
      }
      assert(
        fixture.PARITY_UNKNOWN_TOOLS.direct.marker !==
          fixture.PARITY_UNKNOWN_TOOLS.mounted.marker,
        "the two markers are distinct, so each route's side effect is attributable",
      );
    } finally {
      await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
  },
});

// ---------------------------------------------------------------------------
// Test 3 — the real native legs
// ---------------------------------------------------------------------------

Deno.test({
  name: `native OMP ${PINNED_OMP_VERSION} tool dispatch against the loopback scripted provider: ` +
    `restricted block/allow outcomes and native-YOLO exposure control ` +
    `(detected omp: ${DETECTED_OMP_VERSION ?? "none"})`,
  // Acceptance mode makes the prerequisites REQUIRED (the body fails loudly);
  // otherwise an unavailable runtime leaves this evidence UNEXERCISED.
  ignore: !ACCEPTANCE_MODE &&
    !(PINNED_BINARY_READY && DUMB_INIT_READY && LOOPBACK_PORT_OBSERVATION.free &&
      TRUSTED_EXTENSION_READY),
  fn: async () => {
    assertNativePrerequisites();

    await withNativeFixture(async (fixture) => {
      const restricted = await runNativeLeg(fixture, "restricted");
      assertLegCompletion(restricted);
      await assertRestrictedLeg(
        restricted,
        legPathsFor(fixture.root, "restricted"),
        fixture.externalFile,
      );

      const yolo = await runNativeLeg(fixture, "native-yolo");
      assertLegCompletion(yolo);
      await assertYoloLeg(yolo, legPathsFor(fixture.root, "native-yolo"));
    });
  },
  sanitizeOps: false,
  sanitizeResources: false,
});
