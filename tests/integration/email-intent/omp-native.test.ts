// tests/integration/email-intent/omp-native.test.ts
//
// `email-omp-intent-profile` — native tool-dispatch acceptance for the INTERNAL
// email-intent OMP profile (`createEmailIntentAgentConfig("omp", ...)`).
//
// EVIDENCE BOUNDARIES (read before citing anything from this file):
//
// - The MODEL is a mock: a test-owned loopback HTTP server serves the OpenAI
//   chat-completions SSE shape and hands the agent a SCRIPTED plan of tool calls
//   (read, bash, web_search, the deployment-extension fixture tool and the
//   fixture's `xd://` device route). No paid or public provider is contacted and
//   no model reasoning is exercised.
// - The DISPATCH is real: the official pinned `omp` executable is spawned
//   through the shipped profile factory (`createEmailIntentAgentConfig("omp",
//   ...)`) and the real ACP lifecycle (initialize → session/new → model select →
//   session/prompt), driven by the repository's `@agentclientprotocol/sdk`
//   client side. Every tool outcome asserted below is the engine's own.
// - The profile's SETTINGS document and the generated extension bundle are the
//   REAL shipped artifacts. Only the model catalog is test-owned: the tracked
//   loopback fixture's provider entry (`tests/fixtures/omp-native-runtime/home/
//   .omp/agent/models.yml`), re-pointed at this run's ephemeral loopback port,
//   because the deployment's authored catalog names real providers. The
//   generated bundle is the DEFAULT `--trusted-extension`; the fixture's
//   `unknown-tools.js` is loaded as an EXTRA one, as the native-runtime suite
//   documents.
// - The harness carries a POSITIVE CONTROL (the same launch without the
//   host-only marker): the intent leg's bounded denial reason MUST appear for
//   every scripted call, and the control leg MUST be denied WITHOUT it, so a
//   harness that could never observe a real per-name decision is visible.
// - The ACP client here is a minimal test-owned driver, NOT the production
//   connector: `AgentConnector.connect()` requires an `AgentConfig.skillsRoot`
//   that the profile deliberately does not provision. The ACP callback layer and
//   its deny-all handling belong to `email-intent-runtime`.
// - Prerequisites are EXACT. With `EMAIL_INTENT_OMP_ACCEPTANCE=1` (the
//   documented acceptance mode) every unavailable prerequisite is a FAILED test
//   naming the precise reason; without it the native leg stays UNEXERCISED
//   (Deno reports the test as ignored) rather than claiming native success.
// - The denial-attribution assertion is written against the pinned pre-dispatch
//   contract `{block: true, reason}`: the extension blocks EVERY name on this
//   launch, so the model must see that bounded reason rather than an executed
//   tool. Whether the pinned executable renders it verbatim is the open question
//   this leg answers — it has NOT been executed in the environment that wrote it
//   (no pinned 18.6.1 executable was available), so its first run is the
//   evidence, never this comment.
// - No assertion here inspects engine sources or compares tool-result payload
//   bytes. Assertions are about the requested operation, the denial the engine
//   reported, and the absence of every side effect.

import * as acp from "@agentclientprotocol/sdk";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, resolve } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import {
  createEmailIntentAgentConfig,
  EMAIL_INTENT_PROFILE,
  type EmailIntentProfileOptions,
} from "@acp/agent-factory.ts";
import { OMP_INTENT_BLOCKED_REASON } from "@acp/omp/extension/native-registration.ts";
import { resolveOmpExtensionPath } from "@utils/omp-paths.ts";
import { ompNativeCachePlatform } from "@utils/omp-native-cache.ts";
import { prepareOmpNativeCache, resolveOnPath } from "../../../scripts/omp/prepare-native-cache.ts";
import {
  PARITY_UNKNOWN_TOOLS,
  parityMarkerPath,
} from "../../fixtures/omp-native-runtime/unknown-tools.js";
import type { AgentConfig } from "@acp/types.ts";

/** Checkout root (this file lives at `<root>/tests/integration/email-intent/`). */
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..");

/** The authored settings document the profile launches (real shipped bytes). */
const SHIPPED_SETTINGS_PATH = join(REPO_ROOT, "agent-config/omp/email-intent.yml");

/** The tracked loopback model fixture whose provider entry this leg consumes. */
const FIXTURE_MODELS_PATH = join(
  REPO_ROOT,
  "tests/fixtures/omp-native-runtime/home/.omp/agent/models.yml",
);

/** The exact pinned release the profile's package pin describes. */
const PINNED_OMP_VERSION = "18.6.1";

/** Acceptance mode: every unavailable prerequisite becomes a named failure. */
const ACCEPTANCE_MODE = Deno.env.get("EMAIL_INTENT_OMP_ACCEPTANCE") === "1";

/** Fixed loopback HOST: the ephemeral PORT is this run's own. */
const LOOPBACK_HOST = "127.0.0.1";
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

/** The provider/model this leg selects from the fixture catalog. */
const FIXTURE_PROVIDER_ID = "parity-fixture";
const FIXTURE_MODEL_ID = "parity-fixture";
const FIXTURE_MODEL_SELECTOR = `${FIXTURE_PROVIDER_ID}/${FIXTURE_MODEL_ID}`;

/** Content the plan tries to obtain: present in results ONLY if a tool ran. */
const READ_SENTINEL_MARKER = "email-intent-omp-read-sentinel-must-never-be-read";

/** The scripted provider's terminal turn text (the prompt resolves on it). */
const TERMINAL_TEXT = "email omp intent scripted plan complete";

/** One decoded YAML object. */
type YamlObject = Record<string, unknown>;

function isObject(value: unknown): value is YamlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): YamlObject {
  if (!isObject(value)) throw new Error(`${label} is not a YAML mapping`);
  return value;
}

/** One scripted tool call: the id correlates the plan with the tool result. */
interface PlannedCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** One scripted provider: the loopback endpoint plus its observations. */
interface ScriptedProvider {
  readonly origin: string;
  readonly requests: unknown[];
  readonly pathCounts: Map<string, number>;
  shutdown(): Promise<void>;
}

/** A minimal OpenAI-compatible SSE frame. */
function sseFrame(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** The scripted provider request's message list, as far as it matters here. */
function requestMessages(body: unknown): readonly unknown[] {
  if (!isObject(body)) return [];
  const messages = body["messages"];
  return Array.isArray(messages) ? messages : [];
}

/** How many tool results the engine has already sent back to the provider. */
function toolResultCount(body: unknown): number {
  return requestMessages(body).filter((message) => isObject(message) && message["role"] === "tool")
    .length;
}

/** Every tool-message id and rendered text the provider has observed. */
function observedToolResults(requests: readonly unknown[]): Map<string, string> {
  const results = new Map<string, string>();
  for (const request of requests) {
    for (const message of requestMessages(request)) {
      if (!isObject(message) || message["role"] !== "tool") continue;
      const id = typeof message["tool_call_id"] === "string" ? message["tool_call_id"] : null;
      if (id === null) continue;
      const content = message["content"];
      results.set(id, typeof content === "string" ? content : JSON.stringify(content));
    }
  }
  return results;
}

/**
 * Start the scripted loopback provider on an EPHEMERAL port. It serves
 * `plan[<tool results so far>]` as a tool call, and the terminal text once the
 * whole plan has been answered.
 */
function startScriptedProvider(plan: readonly PlannedCall[]): ScriptedProvider {
  const requests: unknown[] = [];
  const pathCounts = new Map<string, number>();
  const service = Deno.serve(
    { hostname: LOOPBACK_HOST, port: 0, onListen: () => {} },
    async (request) => {
      const url = new URL(request.url);
      pathCounts.set(url.pathname, (pathCounts.get(url.pathname) ?? 0) + 1);
      if (url.pathname !== CHAT_COMPLETIONS_PATH) {
        return new Response("not found", { status: 404 });
      }
      const body: unknown = await request.json();
      requests.push(body);
      const step = toolResultCount(body);
      const call = plan[step];
      const base = {
        id: `omp-intent-${step}`,
        object: "chat.completion.chunk",
        created: 1,
        model: FIXTURE_MODEL_ID,
      };
      const frames: Uint8Array[] = [];
      if (call === undefined) {
        frames.push(
          sseFrame({
            ...base,
            choices: [{
              index: 0,
              delta: { role: "assistant", content: TERMINAL_TEXT },
              finish_reason: null,
            }],
          }),
          sseFrame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        );
      } else {
        frames.push(
          sseFrame({
            ...base,
            choices: [{
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [{
                  index: 0,
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                }],
              },
              finish_reason: null,
            }],
          }),
          sseFrame({
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          }),
        );
      }
      frames.push(new TextEncoder().encode("data: [DONE]\n\n"));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const frame of frames) controller.enqueue(frame);
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  );
  return {
    origin: `http://${LOOPBACK_HOST}:${service.addr.port}`,
    requests,
    pathCounts,
    shutdown: () => service.shutdown(),
  };
}

/**
 * Build this run's model catalog from the TRACKED loopback fixture: the same
 * provider entry, re-pointed at this run's ephemeral origin. The entry's own
 * contract (`auth: none`, the fixture model id) is asserted rather than assumed.
 */
function fixtureCatalog(origin: string): string {
  const document = requireObject(
    parseYaml(Deno.readTextFileSync(FIXTURE_MODELS_PATH)),
    "the tracked loopback model fixture",
  );
  const providers = requireObject(document["providers"], "providers");
  const entry = requireObject(
    providers[FIXTURE_PROVIDER_ID],
    `providers.${FIXTURE_PROVIDER_ID}`,
  );
  assertEquals(
    entry["auth"],
    "none",
    "the fixture provider is credential-free by contract, so this leg provisions no credential",
  );
  return stringifyYaml({
    providers: { [FIXTURE_PROVIDER_ID]: { ...entry, baseUrl: `${origin}/v1` } },
  });
}

/** What the ACP client observed for one prompt turn. */
interface ClientObservations {
  readonly plannedToolCallIds: Set<string>;
  notificationText: string;
  messageText: string;
  permissionRequests: number;
  fsReads: number;
  fsWrites: number;
}

/** The session's model config option values, flattening the grouped form. */
function configOptionValues(
  options: readonly acp.SessionConfigSelectOption[] | readonly acp.SessionConfigSelectGroup[],
): string[] {
  const values: string[] = [];
  for (const entry of options) {
    if ("value" in entry) {
      values.push(entry.value);
      continue;
    }
    for (const grouped of entry.options) values.push(grouped.value);
  }
  return values;
}

/**
 * Drive one real `omp acp` child through the shipped profile config. The extra
 * fixture extension is appended the way the native-runtime suite documents
 * repeatable `--trusted-extension` loading.
 */
async function runProfilePrompt(
  agentConfig: AgentConfig,
  promptText: string,
): Promise<ClientObservations> {
  const command = new Deno.Command(agentConfig.command, {
    args: [...agentConfig.args, "--trusted-extension", FIXTURE_EXTENSION_PATH],
    cwd: agentConfig.cwd,
    clearEnv: true,
    env: agentConfig.env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const process = command.spawn();
  const observations: ClientObservations = {
    plannedToolCallIds: new Set<string>(),
    notificationText: "",
    messageText: "",
    permissionRequests: 0,
    fsReads: 0,
    fsWrites: 0,
  };
  const stream = acp.ndJsonStream(process.stdin, process.stdout);
  const connection = new acp.ClientSideConnection(
    () => ({
      sessionUpdate: (notification) => {
        observations.notificationText += `\n${JSON.stringify(notification)}`;
        const update = notification.update;
        if (update.sessionUpdate === "tool_call") {
          observations.plannedToolCallIds.add(update.toolCallId);
          return Promise.resolve();
        }
        if (update.sessionUpdate === "agent_message_chunk") {
          if (update.content.type === "text") observations.messageText += update.content.text;
          return Promise.resolve();
        }
        return Promise.resolve();
      },
      requestPermission: (params) => {
        observations.permissionRequests++;
        // Never approve through this bridge: the profile's denial is
        // pre-dispatch, so a permission request here would already be a finding,
        // and this leg must not turn one into an approved operation.
        const rejection = params.options.find((option) =>
          option.kind.startsWith("reject") || /reject|deny/i.test(option.optionId)
        );
        const optionId = (rejection ?? params.options[params.options.length - 1]).optionId;
        return Promise.resolve({ outcome: { outcome: "selected" as const, optionId } });
      },
      readTextFile: () => {
        observations.fsReads++;
        return Promise.resolve({ content: "" });
      },
      writeTextFile: () => {
        observations.fsWrites++;
        return Promise.resolve({});
      },
    }),
    stream,
  );
  try {
    const initialized = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    assertEquals(initialized.protocolVersion, acp.PROTOCOL_VERSION);

    const session = await connection.newSession({ cwd: agentConfig.cwd, mcpServers: [] });
    const model = (session.configOptions ?? []).find((option) => option.id === "model");
    assert(model !== undefined, "the session must advertise a model selector");
    const values = configOptionValues(model.options);
    assertEquals(
      values,
      [FIXTURE_MODEL_SELECTOR],
      `the launch must advertise only the authored fixture catalog: ${values.join(", ")}`,
    );
    if (model.currentValue !== FIXTURE_MODEL_SELECTOR) {
      await connection.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "model",
        value: FIXTURE_MODEL_SELECTOR,
      });
    }

    const prompt = await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: promptText }],
    });
    assertEquals(prompt.stopReason, "end_turn");
    return observations;
  } finally {
    try {
      process.kill();
    } catch {
      // Already gone.
    }
    await process.status;
    await process.stderr.cancel().catch(() => {});
  }
}

/** Synchronous command probe (no shell). */
function runSyncProbe(command: string, args: readonly string[]): string | undefined {
  try {
    const result = new Deno.Command(command, { args: [...args], stdout: "piped", stderr: "null" })
      .outputSync();
    return result.success ? new TextDecoder().decode(result.stdout).trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The detected `omp --version` output, exactly as the installed binary prints it. */
const OMP_VERSION_OUTPUT = runSyncProbe("omp", ["--version"]);

/** True only for the exact pinned release (`omp/18.6.1`). */
const PINNED_BINARY_READY = (OMP_VERSION_OUTPUT ?? "").includes(PINNED_OMP_VERSION);

/** The shipped generated extension bundle the profile's preflight requires. */
const TRUSTED_EXTENSION_PATH = resolve(resolveOmpExtensionPath());

/** The test-owned exposure-control extension this leg loads IN ADDITION. */
const FIXTURE_EXTENSION_PATH = resolve(
  REPO_ROOT,
  "tests/fixtures/omp-native-runtime/unknown-tools.js",
);

/** Synchronous file existence probe. */
function existsSync(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/**
 * Every native-leg prerequisite is asserted here, in acceptance or in a run that
 * got past the `ignore` predicate: the pinned executable, the generated
 * extension bundle and the fixture assets this leg consumes.
 */
function assertNativePrerequisites(): void {
  if (!PINNED_BINARY_READY) {
    throw new Error(
      `EMAIL_INTENT_OMP_ACCEPTANCE=1 requires the pinned omp ${PINNED_OMP_VERSION} executable ` +
        `on PATH; observed ${JSON.stringify(OMP_VERSION_OUTPUT ?? null)}, so native denial ` +
        `cannot be verified`,
    );
  }
  for (const path of [TRUSTED_EXTENSION_PATH, SHIPPED_SETTINGS_PATH, FIXTURE_MODELS_PATH]) {
    if (!existsSync(path)) {
      throw new Error(
        path === TRUSTED_EXTENSION_PATH
          ? `the generated trusted extension bundle is missing at "${path}"; build it with ` +
            `deno task bundle:omp-extension`
          : `the fixture asset "${path}" is missing`,
      );
    }
  }
}

/** Everything one leg works with. */
interface LegFixture {
  readonly root: string;
  /** Absolute path of one harmless file OUTSIDE the launch's private roots. */
  readonly sentinel: string;
  /** The prepared shared native payload this leg's launch links. */
  readonly payload: { readonly installRoot: string };
}

/** One leg's evidence. */
interface LegEvidence {
  readonly observations: ClientObservations;
  readonly results: Map<string, string>;
  readonly provider: ScriptedProvider;
}

/**
 * Run one leg: build a private-root set and the profile config from this run's
 * catalog, script `plan`, spawn the pinned executable and collect the evidence.
 * `marker` selects the launch shape — the intent launch sets the host-only
 * marker; the positive control does NOT.
 */
async function runLeg(
  fixture: LegFixture,
  label: string,
  marker: boolean,
  plan: readonly PlannedCall[],
): Promise<LegEvidence> {
  const provider = startScriptedProvider(plan);
  const root = join(fixture.root, label);
  try {
    const catalogPath = join(root, "models.yml");
    Deno.mkdirSync(root, { recursive: true });
    Deno.writeTextFileSync(catalogPath, fixtureCatalog(provider.origin));

    const options: EmailIntentProfileOptions = {
      authoredConfigPath: SHIPPED_SETTINGS_PATH,
      catalogPath,
      ompNativeCache: {
        installRoot: fixture.payload.installRoot,
        launchExecutableVersion: PINNED_OMP_VERSION,
      },
    };
    const config = createEmailIntentAgentConfig(
      "omp",
      { providerID: FIXTURE_PROVIDER_ID, modelID: FIXTURE_MODEL_ID },
      { home: join(root, "home"), cwd: join(root, "cwd") },
      options,
    );
    assertEquals(config.executionProfile, EMAIL_INTENT_PROFILE);
    assertEquals(config.args.includes("--system-prompt"), false);

    const childEnv = { ...config.env };
    if (!marker) delete childEnv["OMP_INTENT_PROFILE"];
    const observations = await runProfilePrompt(
      { ...config, env: childEnv },
      "follow the scripted plan exactly",
    );
    return { observations, results: observedToolResults(provider.requests), provider };
  } catch (error) {
    await provider.shutdown();
    throw error;
  }
}

Deno.test({
  name: "email-intent OMP profile - scripts every native surface and observes zero effects",
  ignore: !ACCEPTANCE_MODE,
  async fn() {
    assertNativePrerequisites();
    const executable = resolveOnPath("omp");
    assert(executable !== undefined, "the pinned omp executable resolves on PATH");

    const root = await Deno.makeTempDir({ prefix: "email-intent-omp-native-" });
    try {
      // A sentinel file OUTSIDE the profile's private roots: if any read tool
      // ever ran, its marker would travel back to the scripted provider.
      const outside = join(root, "outside");
      Deno.mkdirSync(outside, { recursive: true });
      const sentinel = join(outside, "sentinel.txt");
      Deno.writeTextFileSync(sentinel, `# sentinel\n\n${READ_SENTINEL_MARKER}\n`);
      const sentinelBytes = Deno.readTextFileSync(sentinel);

      const payload = await prepareOmpNativeCache({
        executable,
        cacheBase: join(root, "native-cache"),
        platform: ompNativeCachePlatform(),
        timeoutMs: 300_000,
      });
      const fixture: LegFixture = {
        root,
        sentinel,
        payload,
      };

      const bashSentinel = join(root, "bash-escaped.txt");
      const exposedTool = PARITY_UNKNOWN_TOOLS.direct.name;
      const mountedTool = PARITY_UNKNOWN_TOOLS.mounted.name;
      const calls: readonly PlannedCall[] = [
        { id: "call-read", name: "read", arguments: { path: sentinel } },
        {
          id: "call-bash",
          name: "bash",
          arguments: { command: `touch ${bashSentinel}`, description: "scripted escape attempt" },
        },
        {
          id: "call-web-search",
          name: "web_search",
          arguments: { query: "email intent omp profile probe" },
        },
        { id: "call-exposed-tool", name: exposedTool, arguments: {} },
        {
          id: "call-mounted-tool",
          name: "write",
          arguments: { path: `xd://${mountedTool}`, content: "{}" },
        },
      ];

      const intent = await runLeg(fixture, "intent", true, calls);
      try {
        // Every scripted call was attempted and answered from the engine's own
        // conversation, and EVERY answer carries the profile's bounded
        // pre-dispatch reason: on an intent launch the trusted extension blocks
        // every name, so no tool surface — shipped, deployment-extension or
        // unknown — dispatched.
        assertEquals(
          [...intent.observations.plannedToolCallIds].sort(),
          calls.map((call) => call.id).sort(),
          "every scripted tool call must reach the client",
        );
        for (const call of calls) {
          const result = intent.results.get(call.id);
          assert(result !== undefined, `the scripted ${call.name} call must have a tool result`);
          assertStringIncludes(
            result,
            OMP_INTENT_BLOCKED_REASON,
            `the ${call.name} call must be denied before dispatch`,
          );
          assert(
            !result.includes(READ_SENTINEL_MARKER),
            `the ${call.name} result must not carry sentinel bytes`,
          );
        }

        // Zero side effects: the denied command never ran, the sentinel file is
        // byte-identical, and neither exposure-control tool wrote its marker.
        assert(!existsSync(bashSentinel), "the denied bash command must never have run");
        assertEquals(Deno.readTextFileSync(sentinel), sentinelBytes);
        for (const marker of ["direct", "mounted"] as const) {
          const markerPath = parityMarkerPath(
            join(root, "intent", "cwd"),
            PARITY_UNKNOWN_TOOLS[marker].marker,
          );
          assert(
            !existsSync(markerPath),
            `the blocked fixture tool must not have run ${markerPath}`,
          );
        }

        // The loopback endpoint saw conversation traffic only: no other path was
        // ever requested, and no sentinel bytes reached the provider.
        for (const path of intent.provider.pathCounts.keys()) {
          assertEquals(path, CHAT_COMPLETIONS_PATH, `${path} must never be requested`);
        }
        assert(
          !JSON.stringify(intent.provider.requests).includes(READ_SENTINEL_MARKER),
          "the sentinel bytes must never reach the provider",
        );

        // The turn completed on the scripted terminal text, after the engine
        // answered every scripted step.
        assertStringIncludes(intent.observations.messageText, TERMINAL_TEXT);
        assert(
          intent.provider.requests.length >= calls.length + 1,
          `the scripted provider must have seen one request per plan step plus the terminal turn ` +
            `(observed ${intent.provider.requests.length})`,
        );
      } finally {
        await intent.provider.shutdown();
      }

      // POSITIVE CONTROL: the SAME launch without the host-only marker is denied
      // too — but NOT with the profile's bounded reason. That distinction is what
      // proves this harness observes the engine's real per-name decisions instead
      // of a mock that would report a denial for anything.
      const controlCalls: readonly PlannedCall[] = [
        { id: "control-read", name: "read", arguments: { path: sentinel } },
        { id: "control-exposed", name: exposedTool, arguments: {} },
      ];
      const control = await runLeg(fixture, "control", false, controlCalls);
      try {
        for (const call of controlCalls) {
          const result = control.results.get(call.id);
          assert(result !== undefined, `the control ${call.name} call must have a tool result`);
          assert(
            !result.includes(OMP_INTENT_BLOCKED_REASON),
            `the control ${call.name} result must not carry the intent profile's reason`,
          );
          assert(
            !result.includes(READ_SENTINEL_MARKER),
            `the control ${call.name} result must not carry sentinel bytes`,
          );
        }
        assertStringIncludes(control.observations.messageText, TERMINAL_TEXT);
        console.log(
          `email-intent OMP native control evidence: ${control.provider.requests.length} provider ` +
            `requests, ${control.results.size} tool results without the intent reason`,
        );
      } finally {
        await control.provider.shutdown();
      }

      // EXACT evidence record of what this run really exercised. The permission
      // counter is reported rather than asserted: the pinned engine's own ACP
      // bridge usage is not part of this change's contract, while a nonzero
      // count alongside every expected denial would be worth investigating.
      console.log(
        `email-intent OMP native evidence: ${intent.provider.requests.length} provider requests, ` +
          `${intent.results.size} tool results, ` +
          `${intent.observations.plannedToolCallIds.size}/${calls.length} attempted calls, ` +
          `permission requests=${intent.observations.permissionRequests}, ` +
          `fs reads=${intent.observations.fsReads}, fs writes=${intent.observations.fsWrites}, ` +
          `native payload platform=${ompNativeCachePlatform()}`,
      );
    } finally {
      await Deno.remove(root, { recursive: true }).catch(() => {});
    }
  },
});
