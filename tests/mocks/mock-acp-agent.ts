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
//
// Opt-in OMP lifecycle extensions (mock-acp-lifecycle-coverage; ALL dormant
// unless the matching env var is set, so shipped OpenCode behavior is
// byte-compatible when unset):
//   MOCK_STATE_FILE              - absolute path overriding the state-file
//                                  location (hermetic per-test state dirs)
//   MOCK_OMP_CONFIG_CATALOG      - "grouped" | "flat" | "miss" | "none":
//                                  OMP-shaped config catalogs returned by
//                                  session/new (and session/load unless
//                                  MOCK_OMP_LOAD_CONFIG_CATALOG overrides it)
//   MOCK_OMP_RECORD_RPC          - path to a JSONL file; every handled request
//                                  is appended as {gen,seq,pid,method,params}
//                                  (gen identifies the connection instance
//                                  across respawns; file persists in the
//                                  shared state dir, so slice by gen)
//   MOCK_CRASH_ON_PROMPT         - substring; a prompt containing it makes the
//                                  mock exit the whole process tree with no
//                                  delay dependency: when MOCK_SIDEBRO=1 a
//                                  long-lived side process is spawned first
//                                  (pid recorded to mock-sidebro.pid in the
//                                  state dir), then both side process and the
//                                  mock itself receive synchronous SIGKILLs.
//   MOCK_SIDEBRO                 - "1": spawn a long-lived `sleep` side process
//                                  when MOCK_CRASH_ON_PROMPT fires
//   mock-refresh-config prompt   - with an OMP catalog active, a prompt
//                                  containing "mock-refresh-config" emits a
//                                  genuine session/update `config_option_update`
//                                  notification (registry-refresh shape)
//                                  before end_turn, and advances the recorded
//                                  catalog state.

const PROMPT_DELAY_MS = parseInt(Deno.env.get("MOCK_PROMPT_DELAY_MS") ?? "12000", 10);

/** Per-process-connection generation marker for the RPC record (survives slicing). */
const MOCK_CONNECTION_GEN = `gen-${crypto.randomUUID()}`;

interface MockState {
  memorySaveDone: boolean;
  replySent: boolean;
  /** Current value of the mock `model` config option after set_config_option (OMP opt-in). */
  modelValue?: string;
  /** Number of config_option_update refreshes emitted (OMP opt-in). */
  refreshCount?: number;
}

function stateFile(): string {
  const override = Deno.env.get("MOCK_STATE_FILE");
  if (override) return override;
  const tmpDir = Deno.env.get("TMPDIR") ?? "/tmp";
  const sessionId = Deno.env.get("SESSION_ID") ?? "mock";
  return `${tmpDir}/${sessionId}/mock-state.json`;
}

function stateDir(): string {
  const file = stateFile();
  return file.slice(0, file.lastIndexOf("/"));
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

// ---------------------------------------------------------------------------
// OMP-shaped config catalogs (opt-in; synthetic shapes only — nothing here
// claims the native agent serves these catalogs).
// ---------------------------------------------------------------------------

type OmpCatalogKind = "grouped" | "flat" | "miss" | "none";

function ompCatalogKind(): OmpCatalogKind | undefined {
  const raw = Deno.env.get("MOCK_OMP_CONFIG_CATALOG");
  return raw === "grouped" || raw === "flat" || raw === "miss" || raw === "none" ? raw : undefined;
}

function ompLoadCatalogKind(): OmpCatalogKind | undefined {
  const raw = Deno.env.get("MOCK_OMP_LOAD_CONFIG_CATALOG");
  return raw === "grouped" || raw === "flat" || raw === "miss" || raw === "none"
    ? raw
    : ompCatalogKind();
}

function modelSelect(currentValue: string, models: readonly string[]): Record<string, unknown> {
  return {
    type: "select",
    id: "model",
    name: "Model",
    currentValue,
    options: models.map((v) => ({ value: v, name: v })),
  };
}

function thoughtLevelSelect(currentValue: string): Record<string, unknown> {
  return {
    type: "select",
    id: "thought_level",
    name: "Reasoning",
    currentValue,
    options: ["off", "low", "medium", "high"].map((v) => ({ value: v, name: v })),
  };
}

/** Build the OMP-shaped catalog for a kind; `state` carries post-set values. */
function buildOmpCatalog(kind: OmpCatalogKind, state: MockState): Record<string, unknown>[] {
  const modelValue = state.modelValue ?? "mock-model-canonical";
  switch (kind) {
    case "grouped":
      // Grouped OPTION lists inside the category-carrying selects: this is
      // the shape findOptionByCategory + collectOptionValues flatten (row-6
      // suite fixtures pin it); a top-level group wrapper would be invisible
      // to the shipped selection code.
      return [{
        ...modelSelect(modelValue, ["mock-model-canonical", "mock-model-other"]),
        category: "model",
        options: [{
          group: "mock-group",
          name: "Mock group",
          options: ["mock-model-canonical", "mock-model-other"].map((v) => ({
            value: v,
            name: v,
          })),
        }],
      }, { ...thoughtLevelSelect("off"), category: "thought_level" }];
    case "flat":
      return [
        {
          ...modelSelect(modelValue, ["mock-model-canonical", "mock-model-other"]),
          category: "model",
        },
        { ...thoughtLevelSelect("off"), category: "thought_level" },
      ];
    case "miss":
      // Catalog that does NOT contain the canonical model — post-load
      // catalog-miss fixtures drive the stable-first throw.
      return [
        { ...modelSelect("mock-model-unrelated", ["mock-model-unrelated"]), category: "model" },
        { ...thoughtLevelSelect("off"), category: "thought_level" },
      ];
    case "none":
      return [];
  }
}

let rpcRecordSeq = 0;
/** Monotonic per-process session counter (independent of RPC recording). */
let sessionSeq = 0;

function recordRpc(method: string, params: unknown): void {
  const target = Deno.env.get("MOCK_OMP_RECORD_RPC");
  if (!target) return;
  rpcRecordSeq += 1;
  const line = JSON.stringify({
    gen: MOCK_CONNECTION_GEN,
    seq: rpcRecordSeq,
    pid: Deno.pid,
    method,
    params,
  }) + "\n";
  try {
    Deno.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(target, line, { create: true, append: true });
  } catch {
    // Recording is diagnostic only; never crash the mock over it.
  }
}

/**
 * Process-tree crash with NO delay dependency: side processes and the mock
 * itself receive synchronous SIGKILLs (a queued SIGKILL is delivered by the
 * kernel regardless of this process's fate). The side-process pid is written
 * to mock-sidebro.pid in the state dir BEFORE any kill so the test can bound
 * its own liveness observation. No timers, no sleep.
 */
function crashProcessTree(): void {
  const crashSidebro = Deno.env.get("MOCK_SIDEBRO") === "1";
  if (crashSidebro) {
    let sidePid: number | undefined;
    try {
      const side = new Deno.Command("sleep", { args: ["600"], stdout: "null", stderr: "null" })
        .spawn();
      sidePid = side.pid;
      Deno.mkdirSync(stateDir(), { recursive: true });
      Deno.writeTextFileSync(`${stateDir()}/mock-sidebro.pid`, String(sidePid));
    } catch {
      // Sidebro is an optional witness; never prevent the crash itself.
    }
    if (sidePid !== undefined) {
      try {
        Deno.kill(sidePid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  Deno.kill(Deno.pid, "SIGKILL");
}

/** Emit a genuine session/update config_option_update notification (OMP opt-in). */
function emitConfigOptionUpdate(catalog: unknown[], acpSessionId: string): void {
  const notification = JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: acpSessionId,
      update: {
        sessionUpdate: "config_option_update",
        sessionId: acpSessionId,
        configOptions: catalog,
      },
    },
  }) + "\n";
  Deno.stdout.writeSync(new TextEncoder().encode(notification));
}

async function handlePrompt(
  prompt: ContentBlock[],
  acpSessionId: string,
): Promise<Record<string, unknown>> {
  const text = prompt
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("\n");
  const wantsSkills = text.includes("memory-save");

  const crashTrigger = Deno.env.get("MOCK_CRASH_ON_PROMPT");
  if (crashTrigger && text.includes(crashTrigger)) {
    crashProcessTree();
    // Unreachable: SIGKILL is already queued; the loop dies before responding.
    await new Promise<never>(() => {});
  }

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

  const catalogKind = ompCatalogKind();
  if (catalogKind && catalogKind !== "none" && text.includes("mock-refresh-config")) {
    const state = loadState();
    state.refreshCount = (state.refreshCount ?? 0) + 1;
    saveState(state);
    // Registry-refresh notification: updated catalog (thought level advanced).
    const refreshed = buildOmpCatalog(catalogKind, state).map((option) => {
      const record: Record<string, unknown> = structuredClone(option);
      if (record["id"] === "thought_level") record["currentValue"] = "low";
      return record;
    });
    emitConfigOptionUpdate(refreshed, acpSessionId);
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
        sessionId?: string;
        configId?: string;
        value?: string;
      };
    };
    const { id, method, params } = msg;
    recordRpc(method, params);

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
      case "session/new": {
        const catalogKind = ompCatalogKind();
        sessionSeq += 1;
        result = {
          // Unique per newSession so two sessions on one pooled process get
          // distinct ids (Date.now() alone could collide within one ms).
          sessionId: `mock-ses-${MOCK_CONNECTION_GEN.slice(4, 12)}-${sessionSeq}`,
          configOptions: catalogKind ? buildOmpCatalog(catalogKind, loadState()) : [],
        };
        break;
      }
      case "session/load": {
        const loadKind = ompLoadCatalogKind();
        result = { configOptions: loadKind ? buildOmpCatalog(loadKind, loadState()) : [] };
        break;
      }
      case "session/set_config_option": {
        const catalogKind = ompCatalogKind();
        if (!catalogKind || catalogKind === "none") {
          result = {};
          break;
        }
        const state = loadState();
        if (params?.configId === "model" && params.value !== undefined) {
          state.modelValue = params.value;
        }
        saveState(state);
        result = { configOptions: buildOmpCatalog(catalogKind, state) };
        break;
      }
      case "session/set_model":
      case "session/cancel":
        result = {};
        break;
      case "session/prompt":
        result = await handlePrompt(params?.prompt ?? [], params?.sessionId ?? "");
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
