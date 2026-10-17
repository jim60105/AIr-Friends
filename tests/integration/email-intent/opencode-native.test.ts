// tests/integration/email-intent/opencode-native.test.ts
//
// `email-opencode-intent-profile` — native tool-dispatch acceptance for the
// INTERNAL email-intent OpenCode profile.
//
// EVIDENCE BOUNDARIES (read before citing anything from this file):
//
// - The MODEL is a mock: a test-owned loopback HTTP server serves the OpenAI
//   chat-completions SSE shape and hands the agent a SCRIPTED plan of tool
//   calls (read, bash, webfetch, websearch, skill and an unknown tool). No
//   paid or public provider is contacted and no model reasoning is exercised.
//   The response shape is the documented one for the pinned engine's
//   openai-compatible transport (verified against the installed executable
//   before this file was written).
// - The DISPATCH is real: the official `opencode` executable is spawned through
//   the shipped profile factory (`createEmailIntentAgentConfig`) and the real
//   ACP lifecycle (initialize → session/new → session/prompt), driven by the
//   repository's `@agentclientprotocol/sdk` client side. Every tool outcome
//   asserted below is the engine's own native result.
// - The profile documents are the REAL shipped ones: the authored deny-all
//   document and the profile factory's composed `OPENCODE_CONFIG_CONTENT`. Only
//   the provider catalog is test-owned (a loopback provider written by this
//   test), because the deployment's catalog names real providers.
// - The ACP client here is a minimal test-owned driver, NOT the production
//   connector: `AgentConnector.connect()` requires an `AgentConfig.skillsRoot`
//   that the profile deliberately does not provision. The ACP callback layer
//   and its deny-all handling belong to `email-intent-runtime`.
// - Prerequisites are EXACT. With `EMAIL_INTENT_OPENCODE_ACCEPTANCE=1` (the
//   documented acceptance mode) every unavailable prerequisite is a FAILED test
//   naming the precise reason; without it the native leg stays UNEXERCISED
//   (Deno reports the test as ignored) rather than claiming native success.
// - No assertion here inspects engine sources or compares tool-result payload
//   bytes. Assertions are about the requested operation, the denial the engine
//   reported, and the absence of every side effect.

import * as acp from "@agentclientprotocol/sdk";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, resolve } from "@std/path";
import { createEmailIntentAgentConfig } from "@acp/agent-factory.ts";
import type { AgentConfig } from "@acp/types.ts";

/** Checkout root (this file lives at `<root>/tests/integration/email-intent/`). */
const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..", "..");

/** The authored deny-all document the profile launches (real shipped bytes). */
const SHIPPED_ASSET_PATH = join(REPO_ROOT, "agent-config/email-intent-opencode.json");

/** Acceptance mode: every unavailable prerequisite becomes a named failure. */
const ACCEPTANCE_MODE = Deno.env.get("EMAIL_INTENT_OPENCODE_ACCEPTANCE") === "1";

const LOOPBACK_HOST = "127.0.0.1";
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

/** The one URL the scripted plan tries to fetch; a hit here is a side effect. */
const WEBFETCH_PATH = "/fixture.txt";

/** The provider/model this leg selects from its own test-owned catalog. */
const FIXTURE_PROVIDER_ID = "scripted";
const FIXTURE_MODEL_ID = "email-intent-fixture";
const FIXTURE_MODEL_SELECTOR = `${FIXTURE_PROVIDER_ID}/${FIXTURE_MODEL_ID}`;

/** Content the plan tries to obtain: present in results ONLY if a tool ran. */
const READ_SENTINEL_MARKER = "email-intent-read-sentinel-must-never-be-read";
const WEBFETCH_SENTINEL_MARKER = "email-intent-webfetch-sentinel-must-never-be-served";

/** The scripted provider's terminal turn text (the prompt resolves on it). */
const TERMINAL_TEXT = "email intent scripted plan complete";

/** The engine's own pre-dispatch denial text for an unavailable tool. */
const NATIVE_DENIAL_PATTERN = "unavailable tool";

/** One scripted tool call: the id correlates the plan with the ACP update. */
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The selectable values of one session config option, flattening the grouped
 * form the protocol also allows.
 */
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

/**
 * Start the scripted loopback provider. It serves `plan[<tool results so far>]`
 * as a tool call, and the terminal text once the whole plan has been answered.
 */
function startScriptedProvider(plan: readonly PlannedCall[]): ScriptedProvider {
  const requests: unknown[] = [];
  const pathCounts = new Map<string, number>();
  const service = Deno.serve(
    { hostname: LOOPBACK_HOST, port: 0, onListen: () => {} },
    async (request) => {
      const url = new URL(request.url);
      pathCounts.set(url.pathname, (pathCounts.get(url.pathname) ?? 0) + 1);
      if (url.pathname === WEBFETCH_PATH) {
        return new Response(`# scripted fixture\n\n${WEBFETCH_SENTINEL_MARKER}\n`);
      }
      if (url.pathname !== CHAT_COMPLETIONS_PATH) {
        return new Response("not found", { status: 404 });
      }
      const body: unknown = await request.json();
      requests.push(body);
      const step = toolResultCount(body);
      const call = plan[step];
      const base = {
        id: `scripted-${step}`,
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
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
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

/** What the ACP client observed for one prompt turn. */
interface ClientObservations {
  readonly plannedToolCallIds: Set<string>;
  readonly failedToolCalls: Map<string, string>;
  readonly notificationText: string;
  readonly messageText: string;
  permissionRequests: number;
  fsReads: number;
  fsWrites: number;
}

/** Drive one real `opencode acp` child through the shipped profile config. */
async function runProfilePrompt(
  agentConfig: AgentConfig,
  promptText: string,
): Promise<ClientObservations> {
  const command = new Deno.Command(agentConfig.command, {
    args: agentConfig.args,
    cwd: agentConfig.cwd,
    clearEnv: true,
    env: agentConfig.env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const process = command.spawn();
  const observations = {
    plannedToolCallIds: new Set<string>(),
    failedToolCalls: new Map<string, string>(),
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
        if (update.sessionUpdate === "tool_call_update" && update.status === "failed") {
          let denial = "";
          for (const item of update.content ?? []) {
            if (item.type === "content" && item.content.type === "text") {
              denial += item.content.text;
            }
          }
          observations.failedToolCalls.set(update.toolCallId, denial);
        }
        return Promise.resolve();
      },
      requestPermission: () => {
        observations.permissionRequests++;
        return Promise.resolve({ outcome: { outcome: "selected" as const, optionId: "reject" } });
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
    // The engine advertises the profile's ONLY selectable session mode and the
    // ONLY provisioned model: build/yolo and every other provider are absent.
    const options = session.configOptions ?? [];
    const mode = options.find((option) => option.id === "mode");
    assert(mode !== undefined, "the session must advertise a session-mode selector");
    assertEquals(mode.currentValue, "email-intent");
    assertEquals(configOptionValues(mode.options), ["email-intent"]);
    const model = options.find((option) => option.id === "model");
    assert(model !== undefined, "the session must advertise a model selector");
    assertEquals(model.currentValue, FIXTURE_MODEL_SELECTOR);
    assertEquals(configOptionValues(model.options), [FIXTURE_MODEL_SELECTOR]);

    // A mode switch to a built-in agent (or the ordinary yolo agent) cannot
    // take effect: the authored document disables them.
    for (const forbidden of ["build", "plan", "yolo", "general"]) {
      let rejected = false;
      try {
        await connection.setSessionMode({ sessionId: session.sessionId, modeId: forbidden });
      } catch {
        rejected = true;
      }
      assert(rejected, `the session mode "${forbidden}" must not be selectable`);
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

/** Synchronous probe: is the pinned executable available on PATH? */
function executableAvailable(name: string): string | undefined {
  for (const segment of (Deno.env.get("PATH") ?? "").split(":")) {
    if (segment === "") continue;
    const candidate = join(segment, name);
    try {
      if (Deno.statSync(candidate).isFile) return candidate;
    } catch {
      // Keep looking.
    }
  }
  return undefined;
}

const OPENCODE_BINARY = executableAvailable("opencode");

Deno.test({
  name: "email-intent OpenCode profile - scripts every native surface and observes zero effects",
  ignore: !ACCEPTANCE_MODE,
  async fn() {
    if (OPENCODE_BINARY === undefined) {
      throw new Error(
        "EMAIL_INTENT_OPENCODE_ACCEPTANCE=1 requires the real `opencode` executable on PATH; " +
          "none was found, so native denial cannot be verified",
      );
    }

    const root = await Deno.makeTempDir({ prefix: "email-intent-native-" });
    // A sentinel file OUTSIDE the profile's private roots: if any read tool ever
    // ran, its marker would travel back to the scripted provider.
    const outside = join(root, "outside");
    Deno.mkdirSync(outside, { recursive: true });
    const readSentinel = join(outside, "sentinel.txt");
    Deno.writeTextFileSync(readSentinel, `# sentinel\n\n${READ_SENTINEL_MARKER}\n`);
    const bashSentinel = join(outside, "bash-escaped.txt");

    const plan: PlannedCall[] = [];
    const provider = startScriptedProvider(plan);
    const calls: readonly PlannedCall[] = [
      { id: "call-read", name: "read", arguments: { filePath: readSentinel } },
      {
        id: "call-bash",
        name: "bash",
        arguments: { command: `touch ${bashSentinel}`, description: "scripted escape attempt" },
      },
      {
        id: "call-webfetch",
        name: "webfetch",
        arguments: { url: `${provider.origin}${WEBFETCH_PATH}`, format: "text" },
      },
      {
        id: "call-websearch",
        name: "websearch",
        arguments: { query: "email intent profile probe", type: "auto", numResults: 1 },
      },
      { id: "call-skill", name: "skill", arguments: { name: "send-email" } },
      {
        id: "call-unknown",
        name: "email_intent_unknown_tool",
        arguments: { filePath: readSentinel },
      },
    ];
    plan.push(...calls);

    const catalogPath = join(root, "catalog.json");
    Deno.writeTextFileSync(
      catalogPath,
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        provider: {
          [FIXTURE_PROVIDER_ID]: {
            npm: "@ai-sdk/openai-compatible",
            name: "Scripted loopback",
            models: { [FIXTURE_MODEL_ID]: {} },
            options: { baseURL: `${provider.origin}/v1`, apiKey: "scripted-key" },
          },
        },
      }),
    );

    const agentConfig = createEmailIntentAgentConfig(
      "opencode",
      { providerID: FIXTURE_PROVIDER_ID, modelID: FIXTURE_MODEL_ID },
      { home: join(root, "home"), cwd: join(root, "cwd") },
      { catalogPath, authoredConfigPath: SHIPPED_ASSET_PATH },
    );
    assertEquals(agentConfig.executionProfile, "email-intent");

    try {
      const observations = await runProfilePrompt(agentConfig, "follow the scripted plan exactly");

      // Every planned tool was attempted and denied by the ENGINE, before any
      // dispatch: one failed tool call per planned id, carrying the engine's
      // own unavailable-tool text.
      assertEquals(
        [...observations.plannedToolCallIds].sort(),
        calls.map((call) => call.id).sort(),
        "every scripted tool call must reach the client",
      );
      for (const call of calls) {
        const denial = observations.failedToolCalls.get(call.id);
        assert(
          denial !== undefined,
          `the scripted ${call.name} call must be reported as failed`,
        );
        assertStringIncludes(
          denial,
          NATIVE_DENIAL_PATTERN,
          `the ${call.name} call must be denied natively`,
        );
      }

      // Zero side effects.
      let bashExisted = true;
      try {
        Deno.statSync(bashSentinel);
      } catch {
        bashExisted = false;
      }
      assert(!bashExisted, "the denied bash command must never have run");
      assertEquals(
        provider.pathCounts.get(WEBFETCH_PATH) ?? 0,
        0,
        "the denied webfetch must never reach the network",
      );
      for (const path of provider.pathCounts.keys()) {
        assertEquals(path, CHAT_COMPLETIONS_PATH, `${path} must never be requested`);
      }
      assert(
        !observations.notificationText.includes(READ_SENTINEL_MARKER),
        "the sentinel bytes must never reach the client",
      );
      assert(
        !JSON.stringify(provider.requests).includes(READ_SENTINEL_MARKER),
        "the sentinel bytes must never reach the provider",
      );
      assert(
        !JSON.stringify(provider.requests).includes(WEBFETCH_SENTINEL_MARKER),
        "the fetched fixture bytes must never reach the provider",
      );

      // The ACP callback surfaces were never touched: the denial is native.
      assertEquals(observations.permissionRequests, 0);
      assertEquals(observations.fsReads, 0);
      assertEquals(observations.fsWrites, 0);

      // The turn completed on the scripted terminal text, after the engine
      // answered every scripted step from its own provider conversation.
      assertStringIncludes(observations.messageText, TERMINAL_TEXT);
      assert(
        provider.requests.length >= calls.length + 1,
        `the scripted provider must have seen one request per plan step plus the terminal turn ` +
          `(observed ${provider.requests.length})`,
      );
      // EXACT evidence record of what this run really exercised.
      console.log(
        `email-intent native evidence: ${provider.requests.length} provider requests, ` +
          `${observations.failedToolCalls.size}/${calls.length} native denials, ` +
          `webfetch hits=${provider.pathCounts.get(WEBFETCH_PATH) ?? 0}`,
      );
    } finally {
      await provider.shutdown();
      await Deno.remove(root, { recursive: true });
    }
  },
});
