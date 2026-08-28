// tests/mocks/mock-acp-agent.ts
//
// Hermetic mock ACP agent for integration tests. Speaks ACP JSON-RPC over
// stdio in place of a real `opencode acp` subprocess, so tests exercise the
// full pool/lease/JWT/recovery flow without spending model tokens.
//
// Launched by the AgentConnector as:
//   dumb-init -- deno run --no-check --allow-env --allow-read --allow-write --allow-net <this file>
//
// The agent environment (set by the pool) provides:
//   SESSION_ID     - current session identifier
//   TMPDIR         - session-scoped tmp dir ({dataRoot}/channel-tmp/{poolKey})
//   SKILL_JWT_DIR  - directory holding {sessionId}.jwt files
//   SKILL_API_URL  - Skill API base URL (test override)
//
// The mock's `session/prompt` handler:
//   1. Waits MOCK_PROMPT_DELAY_MS (default 12s) so the kill/recovery test
//      can kill the process tree while the prompt is in flight.
//   2. If the prompt text contains "memory-save", simulates agent tool calls
//      by driving the bot's Skill API (memory-save + send-reply) exactly like
//      a real agent would. A state file at $TMPDIR/$SESSION_ID/mock-state.json
//      survives the process restart so the recovery re-prompt never duplicates
//      the memory line or the reply.
//   3. Responds with stopReason "end_turn".

const PROMPT_DELAY_MS = parseInt(Deno.env.get("MOCK_PROMPT_DELAY_MS") ?? "12000", 10);

interface MockState {
  memorySaveDone: boolean;
  replySent: boolean;
}

function stateFile(): string {
  const tmpDir = Deno.env.get("TMPDIR") ?? "/tmp";
  const sessionId = Deno.env.get("SESSION_ID") ?? "mock";
  return `${tmpDir}/${sessionId}/mock-state.json`;
}

function loadState(): MockState {
  try {
    return JSON.parse(Deno.readTextFileSync(stateFile())) as MockState;
  } catch {
    return { memorySaveDone: false, replySent: false };
  }
}

function saveState(state: MockState): void {
  const file = stateFile();
  const dir = file.slice(0, file.lastIndexOf("/"));
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeFileSync(file, new TextEncoder().encode(JSON.stringify(state)));
}

async function callSkillApi(
  endpoint: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const skillApiUrl = Deno.env.get("SKILL_API_URL") ?? "http://127.0.0.1:3001";
  const skillJwtDir = Deno.env.get("SKILL_JWT_DIR") ?? "data/skill-jwt";
  const sessionId = Deno.env.get("SESSION_ID") ?? "mock";
  const jwt = Deno.readTextFileSync(`${skillJwtDir}/${sessionId}.jwt`).trim();
  const res = await fetch(`${skillApiUrl}/api/skill/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      sessionId,
      parameters,
    }),
  });
  const body = await res.json() as { success: boolean; error?: string; data?: unknown };
  if (!res.ok || !body.success) {
    throw new Error(`Skill API ${endpoint} failed: ${body.error ?? res.status}`);
  }
  return body.data;
}

interface ContentBlock {
  type: string;
  text?: string;
}

async function handlePrompt(prompt: ContentBlock[]): Promise<Record<string, unknown>> {
  const text = prompt
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("\n");
  const wantsSkills = text.includes("memory-save");

  if (PROMPT_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, PROMPT_DELAY_MS));
  }

  if (wantsSkills) {
    const state = loadState();
    if (!state.memorySaveDone) {
      await callSkillApi("memory-save", { content: "integration recovery fact" });
      state.memorySaveDone = true;
      saveState(state);
    }
    if (!state.replySent) {
      await callSkillApi("send-reply", { message: "done" });
      state.replySent = true;
      saveState(state);
    }
  }

  return { stopReason: "end_turn" };
}

async function* readLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, undefined, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.length > 0) yield buffer;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        yield line;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function main(): Promise<void> {
  for await (const line of readLines(Deno.stdin.readable)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const msg = JSON.parse(trimmed) as {
      id?: number;
      method: string;
      params?: {
        prompt?: ContentBlock[];
      };
    };
    const { id, method, params } = msg;

    let result: unknown;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: 1,
          agentCapabilities: {
            loadSession: true,
            mcpCapabilities: { http: false, sse: false },
            promptCapabilities: { embeddedContext: false, image: false, audio: false },
            sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
          },
        };
        break;
      case "session/new":
        result = {
          sessionId: `mock-ses-${Date.now().toString(36)}`,
          configOptions: [],
        };
        break;
      case "session/load":
      case "session/set_model":
      case "session/set_config_option":
      case "session/cancel":
        result = {};
        break;
      case "session/prompt":
        result = await handlePrompt(params?.prompt ?? []);
        break;
      default:
        result = {};
    }

    if (id !== undefined) {
      const response = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
      Deno.stdout.writeSync(new TextEncoder().encode(response));
    }
  }
}

main();
