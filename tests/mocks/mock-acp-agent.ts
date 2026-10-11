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
//   MOCK_SKILL_CALLS_FILE        - path to a JSON file holding an ordered array
//                                  of scripted skill-invocation steps, consumed
//                                  ONE PER session/prompt (prompt #N consumes
//                                  step #N; exhausted arrays stay silent):
//                                    {
//                                      stagePayload?: { file, content },
//                                      invocations?: [
//                                        { script: abs path/URL of the REAL
//                                          skills/<name>/scripts/<name>.ts,
//                                          argv?: literal CLI args,
//                                          cwd?: spawn cwd,
//                                          env?: per-invocation overrides },
//                                        ... // run SEQUENTIALLY, one record each
//                                      ],
//                                    }
//                                  Token expansion happens FIRST (fixture
//                                  placeholders resolved against material the
//                                  bot process already wrote BEFORE the first
//                                  prompt — per-spawn: {jwtDir}/{sessionId}.jwt
//                                  (sub-claimable without verification), or
//                                  the lease's {jwtDir}/active.json):
//                                    @SESSION_ID   Skill API session id
//                                    @STAGING_DIR  pointer staging path, or
//                                                  the JWT session's workspace
//                                                  tmp under jwtDir's parent
//                                  — so argv can carry the LITERAL pair the
//                                  suite asserts on, with no pre-knowledge of
//                                  the fresh registration id and no polling.
//                                  The mock writes the staged payload file at
//                                  the ABSOLUTE path with its own fs access
//                                  (standing in for "the agent wrote the file"
//                                  — the write-authorization decision under
//                                  test is the client-side gate, never
//                                  simulated enforcement here), then spawns the
//                                  REAL skill script(s) via `deno run`, AWAITING
//                                  each exit (event-signaled, no polling), then
//                                  emits a `mock_skill_call_done` session/update
//                                  notification (with every exit code) before
//                                  end_turn.
//   MOCK_SKILL_ENV_FILE          - path to a JSON file with the base env for
//                                  skill-script spawns (SKILL_API_URL,
//                                  SKILL_JWT_DIR, SESSION_ID /
//                                  SKILL_SHARED_PROCESS, PATH, HOME); per-step
//                                  `env` overrides win. Spawned with clearEnv,
//                                  so ONLY this map (+overrides) reaches the
//                                  script — never the mock's own full env.
//   MOCK_SKILL_RECORD_FILE       - path to a JSONL file; every invocation of
//                                  every consumed step is appended as
//                                  {gen,seq,script,argv,cwd,code,stdout,stderr}
//                                  BEFORE the prompt responds,
//                                  so a resolved processMessage implies the
//                                  whole skill-call record is flushed.
//                                  A spawned script's exit code is recorded as
//                                  data (client-side rejection composition),
//                                  never swallowed.

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
/** Number of scripted skill-invocation steps consumed so far (per process). */
let skillStepSeq = 0;

// ---------------------------------------------------------------------------
// Scripted skill invocation (finish-omp-mocked-skill-handoff; opt-in via
// MOCK_SKILL_CALLS_FILE only — the shipped OpenCode behavior above is
// byte-unchanged when unset). The mock plays the AGENT side: it writes the
// staged payload at the absolute path with its own fs access (a fixture
// stand-in for the agent's write — NOT a claim that any client gate or native
// tool authorized it) and spawns the REAL skill script, awaiting its exit as
// the completion event (no polling, no sleep).
// ---------------------------------------------------------------------------

/** One REAL skill-script invocation inside a scripted step. */
interface MockSkillInvocation {
  script: string;
  argv?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

interface MockSkillPayloadFile {
  file: string;
  content: string;
}

interface MockSkillCallStep {
  /** One payload file, or several (a step whose invocations consume multiple
   * staged payloads lists them; all land before any invocation spawns). */
  stagePayload?: MockSkillPayloadFile | MockSkillPayloadFile[];
  invocations?: MockSkillInvocation[];
  /** Real agent->client ACP requests issued over this mock's LIVE stdio
   * connection mid-turn, so the request traverses the REAL
   * ChatbotClient.requestPermission / readTextFile / writeTextFile policy
   * (client.ts) — the agent side of the client-side-gate composition. */
  acpRequests?: MockAcpRequest[];
}

/** One scripted agent->client ACP request inside a step. `method` names the
 * wire method the main loop sends; `expect` records how the scripted turn
 * consumed the real client's answer: `"ok"` requires a successful response
 * (the loop then performs the follow-up the request promised — the write's
 * result, not the mock's own fs, is what the payload gate checks),
 * `"error:<substring>"` requires a JSON-RPC error containing the substring
 * (the honest negative), `"result:<substring>"` requires a successful
 * response whose JSON result contains the substring (e.g. a permission
 * outcome selecting the reject option — a denial is a NORMAL result, never
 * an error, on the ACP permission wire), anything else fails the turn. */
interface MockAcpRequest {
  method: "session/request_permission" | "fs/read_text_file" | "fs/write_text_file";
  params?: Record<string, unknown>;
  expect?: string;
  /** For successful write_text_file: copy the bytes the CLIENT wrote (read
   * back with the mock's own fs) to this file, proving the write landed
   * through the client policy rather than mock-local staging. */
  copyResultTo?: string;
}

/** Outbound-request bookkeeping: id -> expectation. Settlement outcomes
 * propagate through sendAcpRequestAndAwait's return value and the step's
 * completion notification; mismatches additionally raise acpExpectationFailures. */
const pendingAcpExpectations = new Map<number, string>();
/** Count of scripted ACP expectations that settled WRONG (approved where an
 * error was scripted, or vice versa). The prompt response is refused while
 * this is nonzero, so a client-policy drift cannot pass silently: the mock
 * turn fails instead of end_turn, and the orchestrator-side assertions then
 * observe a failed run rather than the scripted denial. */
let acpExpectationFailures = 0;

/** Resolve "@SESSION_ID"/"@STAGING_DIR"/"@ACP_SESSION_ID" placeholders inside
 * nested request param objects/arrays/strings (fixture-only helper; leaves
 * other JSON — including literal `$TMPDIR`/`$SESSION_ID` tokens, which belong
 * to the CLIENT's resolver — untouched). */
function resolveFixtureValue(value: unknown, ctx: SkillFixtureContext): unknown {
  if (typeof value === "string") return expandSkillTokens(value, ctx);
  if (Array.isArray(value)) return value.map((item) => resolveFixtureValue(item, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveFixtureValue(v, ctx);
    return out;
  }
  return value;
}

/** Runtime-narrowed one-off reads of scripted/response JSON envelopes (the
 * fixture controls these shapes, but narrowing is checked, never an inline
 * cast). */
function extractStringField(value: unknown, key: "path"): string | undefined {
  if (value && typeof value === "object" && key in value && typeof value[key] === "string") {
    return value[key];
  }
  return undefined;
}

function extractResultContent(result: unknown): string {
  if (
    result && typeof result === "object" && "content" in result &&
    typeof result.content === "string"
  ) {
    return result.content;
  }
  return "";
}

function describeRpcError(error: unknown): string {
  const parts: string[] = [];
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") parts.push(error.message);
    if ("code" in error && (typeof error.code === "number" || typeof error.code === "string")) {
      parts.push(String(error.code));
    }
  }
  return parts.join(" ");
}

function writeJsonLine(value: unknown): void {
  Deno.stdout.writeSync(new TextEncoder().encode(JSON.stringify(value) + "\n"));
}

/** Single shared stdin iterator (module-level so an in-turn outbound-request
 * wait can pull lines while `main()` is parked inside `handlePrompt` — the
 * two consumers are never concurrently awaiting `next()`). */
let stdinIterator: AsyncIterator<string> | null = null;
let outboundRequestId = 400_000;
/** JSON-RPC error text from the most recent settling line (diagnostic surface
 * for the completion notification: a mismatch shows WHY the client answered
 * the way it did without re-running the scenario). */
let lastSettleError = "";

/** Send one agent->client ACP request and await its settling line. Pulls the
 * shared iterator directly (RPC-awaited, no polling): during an in-turn wait
 * the only inbound traffic is the response (plus a defensive passthrough for
 * any unexpected request line, answered with `{}`). */
async function sendAcpRequestAndAwait(
  req: MockAcpRequest,
  ctx: SkillFixtureContext,
): Promise<"ok" | "error" | "failed"> {
  if (!stdinIterator) {
    return "failed";
  }
  outboundRequestId += 1;
  const id = outboundRequestId;
  const expect = req.expect ?? "ok";
  pendingAcpExpectations.set(id, expect);
  const params = resolveFixtureValue(req.params ?? {}, ctx);
  writeJsonLine({ jsonrpc: "2.0", id, method: req.method, params });
  for (;;) {
    const next = await stdinIterator.next();
    if (next.done) {
      // Connection closed before the real client answered: the scripted
      // expectation can no longer be settled — record failure, do not fake it.
      pendingAcpExpectations.delete(id);
      acpExpectationFailures += 1;
      return "failed";
    }
    const trimmed = next.value.trim();
    if (!trimmed) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (msg.id === id && msg.method === undefined) {
      lastSettleError = settleErrorText(msg);
      const settled = settleAcpResponse(id, msg);
      if (settled === "failed") acpExpectationFailures += 1;
      if (settled === "ok" && req.copyResultTo) {
        // Audit-copy what the CLIENT produced: for a successful write the
        // bytes now on disk at the requested path (the client's canonical
        // write, verified by re-reading); for a successful read the content
        // string the client returned in its JSON-RPC result.
        const target = req.copyResultTo;
        if (req.method === "fs/write_text_file") {
          const path = extractStringField(params, "path");
          if (path === undefined) {
            acpExpectationFailures += 1;
            return "failed";
          }
          Deno.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
          Deno.writeTextFileSync(target, Deno.readTextFileSync(path));
        } else if (req.method === "fs/read_text_file") {
          Deno.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
          Deno.writeTextFileSync(target, extractResultContent(msg.result));
        }
      }
      return settled;
    }
    if (msg.method !== undefined) {
      // Unexpected inbound request during an in-turn wait: answer minimally
      // (never crash the scripted turn) and let the outer loop keep going.
      if (msg.id !== undefined) {
        writeJsonLine({ jsonrpc: "2.0", id: msg.id, result: {} });
      }
      recordRpc(String(msg.method), msg.params);
    }
  }
}

/** Error text carried by a settling line ("" when it is a normal result). */
function settleErrorText(msg: Record<string, unknown>): string {
  return msg.error === undefined ? "" : describeRpcError(msg.error);
}

/** Verify a settling line against the scripted expectation (a false "ok" can
 * never pass silently). */
function settleAcpResponse(id: number, msg: Record<string, unknown>): "ok" | "error" | "failed" {
  const expect = pendingAcpExpectations.get(id);
  pendingAcpExpectations.delete(id);
  if (expect === undefined) return "failed";
  const isError = msg.error !== undefined;
  const haystack = isError ? describeRpcError(msg.error) : JSON.stringify(msg.result ?? null);
  let ok: boolean;
  if (expect === "ok") ok = !isError;
  else if (expect.startsWith("error:")) {
    ok = isError && haystack.includes(expect.slice("error:".length));
  } else if (expect.startsWith("result:")) {
    ok = !isError && haystack.includes(expect.slice("result:".length));
  } else {
    ok = false;
  }
  if (!ok) {
    return "failed";
  }
  return isError ? "error" : "ok";
}

/** Fixture identity/staging placeholders + their resolution context. */
interface SkillFixtureContext {
  sessionId: string;
  stagingDir: string;
  /** The mock's OWN ACP session id (the id the client holds a gate context
   * for — `@ACP_SESSION_ID` in scripted request params). */
  acpSessionId: string;
}

/**
 * Resolve @SESSION_ID / @STAGING_DIR from identity material the bot process
 * writes BEFORE its first session/prompt (documented ordering: per-spawn JWT
 * issuance and the pool's lease pointer both precede the prompt). READ-ONLY
 * over production-owned files (never claims or empties them):
 *  - pooled tier: {SKILL_JWT_DIR}/active.json (sessionId + staging tmp root;
 *    the staging literal is `{staging}/{sessionId}`, matching the shipped
 *    payload-base composition);
 *  - per-spawn tier: the unique {sessionId}.jwt filename (frozen-identity
 *    shape writes exactly one per harness run); the workspace tmp root comes
 *    from MOCK_STAGING_BASE when set, else from the spawn cwd (the shipped
 *    factory launches the agent process AT the session workspace root, so
 *    `{cwd}/tmp` is the workspace tmp root the prompt renders).
 * Returns undefined when neither source is available yet — a token-bearing
 * step then records an explicit failure instead of spawning unexpanded.
 */
function resolveSkillFixtureContext(acpSessionId: string): SkillFixtureContext | undefined {
  const jwtDir = Deno.env.get("SKILL_JWT_DIR");
  if (!jwtDir) return undefined;
  try {
    const pointer = JSON.parse(Deno.readTextFileSync(`${jwtDir}/active.json`)) as {
      sessionId?: string;
      staging?: string;
    };
    if (typeof pointer.sessionId === "string" && pointer.sessionId.length > 0) {
      const root = typeof pointer.staging === "string" && pointer.staging.length > 0
        ? pointer.staging
        : Deno.env.get("MOCK_STAGING_BASE");
      if (root) {
        return {
          sessionId: pointer.sessionId,
          stagingDir: `${root}/${pointer.sessionId}`,
          acpSessionId,
        };
      }
    }
  } catch {
    // pointer absent/empty: per-spawn tier below
  }
  try {
    const base = Deno.env.get("MOCK_STAGING_BASE") ?? `${Deno.cwd()}/tmp`;
    const jwtNames = [...Deno.readDirSync(jwtDir)]
      .filter((e) => e.name.endsWith(".jwt"))
      .map((e) => e.name);
    if (jwtNames.length !== 1) return undefined;
    const sessionId = jwtNames[0].slice(0, -".jwt".length);
    return {
      sessionId,
      stagingDir: `${base}/${sessionId}`,
      acpSessionId,
    };
  } catch {
    return undefined;
  }
}

/** Substitute fixture placeholders across every step string field. */
function expandSkillTokens(value: string, ctx: SkillFixtureContext): string {
  return value
    .replaceAll("@SESSION_ID", ctx.sessionId)
    .replaceAll("@STAGING_DIR", ctx.stagingDir)
    .replaceAll("@ACP_SESSION_ID", ctx.acpSessionId);
}

function appendSkillRecord(target: string, line: Record<string, unknown>): void {
  Deno.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  Deno.writeTextFileSync(target, JSON.stringify(line) + "\n", { create: true, append: true });
}

/** Emit the completion/settlement notification for this step (exit codes +
 * the ACP settlement summary when the step scripted agent->client requests). */
function flushAcpNote(
  acp: Array<Record<string, unknown>>,
  stepIndex: number,
  acpSessionId: string,
  exitCodes: number[] = [],
): void {
  const note = JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: acpSessionId,
      update: {
        sessionUpdate: "mock_skill_call_done",
        seq: stepIndex + 1,
        exitCodes,
        ...(acp.length > 0 ? { acp } : {}),
      },
    },
  }) + "\n";
  Deno.stdout.writeSync(new TextEncoder().encode(note));
}

/**
 * Run this prompt's scripted step (if any): stage files, then spawn every
 * scripted invocation of the step IN ORDER (each awaited to exit, each
 * recorded to the record file). One completion notification per prompt that
 * spawned at least one invocation carries the per-invocation exit codes.
 * Returns the number of invocations spawned (0 when the step is silent or
 * no step exists for this prompt), or throws when a scripted ACP expectation
 * settled wrong (sendAcpRequestAndAwait's hard-failure paths).
 */
async function runSkillCallStep(acpSessionId: string): Promise<number> {
  const callsTarget = Deno.env.get("MOCK_SKILL_CALLS_FILE");
  if (!callsTarget) return 0;
  let steps: MockSkillCallStep[] = [];
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(callsTarget));
    if (Array.isArray(parsed)) steps = parsed as MockSkillCallStep[];
  } catch {
    return 0;
  }
  const index = skillStepSeq;
  if (index >= steps.length) return 0;
  skillStepSeq += 1;
  let step = steps[index];

  const invocations = step.invocations ?? [];
  const tokenized = JSON.stringify(step).includes("@SESSION_ID") ||
    JSON.stringify(step).includes("@STAGING_DIR") ||
    JSON.stringify(step).includes("@ACP_SESSION_ID");
  if (tokenized) {
    const ctx = resolveSkillFixtureContext(acpSessionId);
    if (ctx) {
      step = JSON.parse(expandSkillTokens(JSON.stringify(step), ctx)) as MockSkillCallStep;
    } else if (invocations.length > 0 || (step.acpRequests?.length ?? 0) > 0) {
      // A token-bearing step cannot run without its identity context: record
      // the explicit failure instead of spawning with an unexpanded token.
      const recordTarget = Deno.env.get("MOCK_SKILL_RECORD_FILE");
      if (recordTarget) {
        for (const invocation of invocations) {
          appendSkillRecord(recordTarget, {
            gen: MOCK_CONNECTION_GEN,
            seq: index + 1,
            script: invocation.script,
            argv: invocation.argv ?? [],
            cwd: invocation.cwd ?? Deno.cwd(),
            code: 112,
            stdout: "",
            stderr: "skill fixture context unavailable (no JWT/pointer material yet)",
          });
        }
      }
      return 0;
    }
  }

  const staged = step.stagePayload === undefined
    ? []
    : Array.isArray(step.stagePayload)
    ? step.stagePayload
    : [step.stagePayload];
  for (const payload of staged) {
    Deno.mkdirSync(payload.file.slice(0, payload.file.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(payload.file, payload.content);
  }

  // Real agent->client ACP requests first (before any spawn): each crosses
  // the live stdio boundary and is answered by the REAL ChatbotClient policy
  // (requestPermission / readTextFile / writeTextFile in client.ts). The
  // per-request settlement ("ok" = success required and succeeded,
  // "error" = scripted error expectation matched, "failed" = expectation
  // mismatch) is recorded and reported in the completion notification — an
  // unexpected answer can never pass silently.
  let acpSummary: Array<Record<string, unknown>> | undefined;
  const acpReqs = step.acpRequests ?? [];
  if (acpReqs.length > 0) {
    const ctx = resolveSkillFixtureContext(acpSessionId) ??
      { sessionId: "", stagingDir: "", acpSessionId };
    acpSummary = [];
    for (const req of acpReqs) {
      const settled = await sendAcpRequestAndAwait(req, ctx);
      acpSummary.push({
        method: req.method,
        expect: req.expect ?? "ok",
        settled,
        ...(lastSettleError !== "" ? { error: lastSettleError } : {}),
      });
    }
    if (acpExpectationFailures > 0) {
      // Flush the settlement note first so the observer sees what was answered,
      // then refuse the turn.
      flushAcpNote(acpSummary, index, acpSessionId);
      throw new Error(`scripted ACP expectation mismatch (${acpExpectationFailures})`);
    }
  }

  const spawn: MockSkillInvocation[] = step.invocations ?? [];
  if (spawn.length === 0) {
    // Explicit silent step (or stage-only step): consumed its slot, spawned
    // nothing, NO completion notification (one exists only for an actual
    // spawned skill call — or for scripted ACP requests, whose settlement
    // the scenario still needs to await).
    if (acpSummary) flushAcpNote(acpSummary, index, acpSessionId);
    return 0;
  }

  let baseEnv: Record<string, string> = {};
  const envTarget = Deno.env.get("MOCK_SKILL_ENV_FILE");
  if (envTarget) {
    try {
      baseEnv = JSON.parse(Deno.readTextFileSync(envTarget)) as Record<string, string>;
    } catch {
      baseEnv = {};
    }
  }
  const recordTarget = Deno.env.get("MOCK_SKILL_RECORD_FILE");
  const codes: number[] = [];
  for (const invocation of spawn) {
    const env = { ...baseEnv, ...(invocation.env ?? {}) };
    const run = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-check",
        "--allow-net",
        "--allow-env",
        "--allow-read",
        "--allow-write",
        invocation.script,
        ...(invocation.argv ?? []),
      ],
      cwd: invocation.cwd ?? Deno.cwd(),
      env,
      clearEnv: true,
    }).output();
    codes.push(run.code);
    if (recordTarget) {
      appendSkillRecord(recordTarget, {
        gen: MOCK_CONNECTION_GEN,
        seq: index + 1,
        script: invocation.script,
        argv: invocation.argv ?? [],
        cwd: invocation.cwd ?? Deno.cwd(),
        code: run.code,
        stdout: new TextDecoder().decode(run.stdout),
        stderr: new TextDecoder().decode(run.stderr),
      });
    }
  }

  flushAcpNote(acpSummary ?? [], index, acpSessionId, codes);
  return spawn.length;
}

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

  // Scripted skill invocation (opt-in; silent when MOCK_SKILL_CALLS_FILE is
  // unset): stage → spawn the REAL skill script → await its exit → record →
  // notify — all BEFORE this prompt responds, so a resolved processMessage
  // implies the whole skill-call record is flushed.
  await runSkillCallStep(acpSessionId);
  // A scripted agent->client expectation that settled WRONG (e.g. the client
  // approved an operation the scenario scripted as denied) fails this turn
  // outright — never a silent end_turn over a drifted answer.
  if (acpExpectationFailures > 0) {
    throw new Error(`scripted ACP expectation mismatch (${acpExpectationFailures})`);
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
  const lines = readLines(Deno.stdin.readable);
  stdinIterator = lines[Symbol.asyncIterator]();
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const msg = JSON.parse(trimmed) as {
      id?: number;
      method?: string;
      params?: {
        prompt?: ContentBlock[];
        sessionId?: string;
        configId?: string;
        value?: string;
      };
    };
    const { id, method, params } = msg;
    // Response to one of the mock's own outbound requests that settles
    // BETWEEN turns (no in-turn waiter consumed it): settle it against the
    // scripted expectation so a late answer is never misread as a request.
    if (method === undefined && id !== undefined && pendingAcpExpectations.has(id)) {
      settleAcpResponse(id, msg);
      continue;
    }
    if (method === undefined) continue;
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
        try {
          result = await handlePrompt(params?.prompt ?? [], params?.sessionId ?? "");
        } catch (turnError) {
          // A refused turn (scripted ACP expectation mismatch): answer the
          // prompt with a JSON-RPC error — a failed turn the real connector
          // and orchestrator observe, NOT a process crash (which would drag
          // pooled crash-recovery paths into an honest-posture scenario).
          if (id !== undefined) {
            writeJsonLine({
              jsonrpc: "2.0",
              id,
              error: { code: -32603, message: String((turnError as Error).message) },
            });
          }
          break;
        }
        break;
      default:
        result = {};
    }

    if (id !== undefined) {
      if (method === "session/prompt" && result === undefined) continue; // error answered above
      const response = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
      Deno.stdout.writeSync(new TextEncoder().encode(response));
    }
  }
}

main();
