// tests/acp/fixtures/email-intent-acp-engine.ts
//
// Scripted / FAKE ACP engine for the `email-intent-runtime` suite.
//
// It speaks ACP JSON-RPC over stdio in place of the real `opencode acp` /
// `omp acp` executable, so the suite drives the REAL `AgentConnector` (spawn
// under dumb-init, intent branch, session-mode and model verification, bounded
// capture, teardown) end to end without a model, a credential, a network call
// or a container.
//
// Usage — the suite replaces only the launch's executable and arguments:
//   deno run --no-check --allow-read --allow-write --allow-env \
//     <this file> <script.json> <record.jsonl>
//
// `script.json` fields (all optional):
//   mode          session-mode value advertised as ACTIVE
//   modes         selectable mode values (defaults to [mode])
//   model         model selector value advertised as ACTIVE
//   models        selectable model values (defaults to [model])
//   stopReason    prompt response stop reason (default "end_turn")
//   chunks        text chunks emitted as `agent_message_chunk` notifications
//   chunkBytes    emit one chunk of N "x" bytes (overflow scenarios)
//   toolCall      emit one `tool_call` notification before answering
//   permission    send `session/request_permission` and await the answer
//   writeFile     attempt `fs/write_text_file` at this absolute path
//   readFile      attempt `fs/read_text_file` at this absolute path
//   hang          never answer the prompt (deadline scenarios)
//   stderrMarker  text written to stderr once (stderr-privacy scenarios)
//   sessionNewChunks     text emitted right after `session/new` responds, i.e.
//                        BEFORE the authored prompt turn (contamination case)
//   sessionNewToolCall   a `tool_call` notification emitted at the same moment
//                        (a pre-prompt tool attempt)
//   foreignSessionChunks text emitted on another session id before answering
//   setConfigIgnoresValue  answer `session/set_config_option` without applying
//                        the requested value (model-pin verification case)
//
// The record file is JSONL of the engine's OWN observations: every handled
// request, a SHA-256 digest and length of the prompt (never its text), the
// permission answer and every filesystem error. It is the fixture's evidence,
// not production behavior — and it deliberately keeps no plaintext of the
// authored request.

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

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

const encoder = new TextEncoder();

const scriptPath = Deno.args[0];
const recordPath = Deno.args[1];
const script = JSON.parse(Deno.readTextFileSync(scriptPath)) as EngineScript;

function record(entry: Record<string, unknown>): void {
  Deno.writeTextFileSync(recordPath, `${JSON.stringify(entry)}\n`, {
    create: true,
    append: true,
  });
}

function send(message: JsonRpcMessage): void {
  Deno.stdout.writeSync(encoder.encode(`${JSON.stringify(message)}\n`));
}

function readText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (typeof block !== "object" || block === null) return "";
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }
  return typeof value === "string" ? value : "";
}

/** Hex SHA-256 of one string, so the fixture never records plaintext. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const pending = new Map<number, (message: JsonRpcMessage) => void>();
let nextRequestId = 1;

/**
 * Send one engine->client request and await its response. The read loop keeps
 * draining stdin while this promise is outstanding, so a client answer is
 * delivered instead of deadlocking the engine.
 */
function request(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<JsonRpcMessage> {
  const id = nextRequestId++;
  const settled = Promise.withResolvers<JsonRpcMessage>();
  pending.set(id, settled.resolve);
  send({ jsonrpc: "2.0", id, method, params });
  const timer = setTimeout(() => {
    if (pending.delete(id)) settled.resolve({ error: "fixture-request-timeout" });
  }, timeoutMs);
  return settled.promise.finally(() => clearTimeout(timer));
}

function notify(sessionId: string, update: Record<string, unknown>): void {
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
}

function configOptions(): Array<Record<string, unknown>> {
  const options: Array<Record<string, unknown>> = [];
  if (script.mode !== undefined) {
    options.push({
      id: "mode",
      name: "Mode",
      description: "",
      category: "mode",
      type: "select",
      currentValue: script.mode,
      options: (script.modes ?? [script.mode]).map((value) => ({ value, name: value })),
    });
  }
  if (script.model !== undefined) {
    options.push({
      id: "model",
      name: "Model",
      description: "",
      category: "model",
      type: "select",
      currentValue: script.model,
      options: (script.models ?? [script.model]).map((value) => ({ value, name: value })),
    });
  }
  return options;
}

async function handlePrompt(message: JsonRpcMessage): Promise<void> {
  const params = message.params ?? {};
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : "ses-intent-1";
  const promptText = readText(params.prompt);
  record({
    method: "session/prompt",
    sessionId,
    promptLength: promptText.length,
    promptSha256: await sha256Hex(promptText),
  });

  // Deadline scenario: the turn never settles. The read loop keeps draining
  // stdin so the client's own teardown is what ends this process.
  if (script.hang === true) return;

  if (script.toolCall === true) {
    notify(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "call-tool",
      title: "bash",
      kind: "execute",
      status: "pending",
    });
  }

  // Contamination scenarios: text that is NOT this prompt turn's answer.
  for (const text of script.foreignSessionChunks ?? []) {
    notify("ses-foreign", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    });
  }

  if (script.permission === true) {
    const answer = await request("session/request_permission", {
      sessionId,
      toolCall: { toolCallId: "call-perm", title: "bash", kind: "execute", status: "pending" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
      ],
    });
    record({ event: "permission_answer", answer: answer.result ?? answer.error });
  }

  if (typeof script.writeFile === "string") {
    const answer = await request("fs/write_text_file", {
      sessionId,
      path: script.writeFile,
      content: "sentinel",
    });
    record({ event: "write_answer", answer: answer.result ?? answer.error });
  }

  if (typeof script.readFile === "string") {
    const answer = await request("fs/read_text_file", { sessionId, path: script.readFile });
    record({ event: "read_answer", answer: answer.result ?? answer.error });
  }

  const chunks = [...(script.chunks ?? [])];
  if (typeof script.chunkBytes === "number") chunks.push("x".repeat(script.chunkBytes));
  for (const text of chunks) {
    notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
  }

  send({
    jsonrpc: "2.0",
    id: message.id,
    result: { stopReason: script.stopReason ?? "end_turn" },
  });
}

async function handle(message: JsonRpcMessage): Promise<void> {
  // A response to one of the engine's own requests.
  if (
    message.id !== undefined &&
    message.method === undefined &&
    (message.result !== undefined || message.error !== undefined)
  ) {
    const resolve = pending.get(message.id);
    if (resolve !== undefined) {
      pending.delete(message.id);
      resolve(message);
    }
    return;
  }

  const params = message.params ?? {};
  // `session/prompt` has its own richer record (written by `handlePrompt`), so
  // it is not duplicated here.
  if (message.method !== "session/prompt") {
    record({ method: message.method ?? "", params });
  }
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { protocolVersion: params.protocolVersion, agentCapabilities: {} },
      });
      break;
    case "session/new":
      // Setup chatter is written BEFORE the session/new response, so its
      // delivery order is deterministic: it reaches the client while no prompt
      // turn exists for the session. A pre-prompt tool attempt is emitted at
      // the same point for the same reason.
      for (const text of script.sessionNewChunks ?? []) {
        notify("ses-intent-1", {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        });
      }
      if (script.sessionNewToolCall === true) {
        notify("ses-intent-1", {
          sessionUpdate: "tool_call",
          toolCallId: "call-setup",
          title: "bash",
          kind: "execute",
          status: "pending",
        });
      }
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "ses-intent-1", configOptions: configOptions() },
      });
      break;
    case "session/prompt":
      await handlePrompt(message);
      break;
    case "session/cancel":
      send({ jsonrpc: "2.0", id: message.id, result: {} });
      break;
    case "session/set_config_option": {
      const next = configOptions();
      if (script.setConfigIgnoresValue !== true) {
        const target = next.find((option) => option.id === params.configId);
        if (target !== undefined) target.currentValue = params.value;
      }
      send({ jsonrpc: "2.0", id: message.id, result: { configOptions: next } });
      break;
    }
    default:
      if (message.id !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, result: {} });
      }
      break;
  }
}

if (typeof script.stderrMarker === "string") {
  Deno.stderr.writeSync(encoder.encode(`${script.stderrMarker}\n`));
}

const reader = Deno.stdin.readable.getReader();
const decoder = new TextDecoder();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim() !== "") {
      // Handlers overlap: a prompt handler awaits client answers, and the read
      // loop must stay free to deliver them.
      void handle(JSON.parse(line) as JsonRpcMessage);
    }
    newline = buffer.indexOf("\n");
  }
}
