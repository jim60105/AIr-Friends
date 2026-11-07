# Design

## Context

See `proposal.md` for motivation. Observed facts:

- `tests/integration/omp-native-runtime/native-runtime.integration.test.ts` already drives pinned `omp acp` against a loopback server speaking the OpenAI chat-completions SSE shape, with `tests/fixtures/omp-native-runtime/home/.omp/agent/models.yml`.
- A throwaway probe (feasibility only, using host versions newer than the pins) completed `initialize`, `session/new` and `session/prompt` on both agents through `node:child_process` under Bun:
  - OpenCode, in a network namespace with only loopback and a fresh `HOME` and data directory, using a custom `@ai-sdk/openai-compatible` provider, sent two requests per prompt. So on 1.18.23 the provider package needed no download. The title request has no `tools` field; the main request has a non-empty `tools` array.
  - OMP, with no network configuration, sent one request and exposed the model as `<provider>/<id>` in the `model` config option.
- `ChatbotClient` and `AgentConnector` import Deno APIs and alias paths, so they cannot load under Bun yet. The driver here is a new, minimal client.
- The SDK's `ClientSideConnection` exposes `closed`, `signal`, `setSessionConfigOption`, `cancel`, `initialize`, `newSession` and `prompt`.
- `omp` extracts its native addons on first use into the private data home. Production prepares a shared cache instead, which this proof of concept does not need.

## Goals / Non-Goals

**Goals:** build the provider, launch fixtures and driver, and prove criteria ACP-01, 02, 03, 09 and 10 for both agents. `prove-bun-acp-failure-paths` reuses them for ACP-04 to ACP-08, so the `paced` and `stall` scripts and `stallAfter` are built here but exercised there.

**Non-Goals:**

- No port of `ChatbotClient`, `AgentProcessPool`, permission handling or skill flow.
- No real model provider and no credentials.
- No production agent config files; the trust boundary in `agent-config/` is proved in `prove-bun-injection-defenses` and the later plan.
- No product file changes. No change to `gate/`, `Containerfile` or `run-suite.sh`.

## Decisions

### D1. Loopback provider

`migration/bun/poc/acp/loopback-provider.ts`, built on `Bun.serve` at `127.0.0.1:43291`:

```ts
export type ProviderScript =
  | { kind: "text"; text: string; chunkBytes: number }
  | { kind: "paced"; chunkBytes: number; intervalMs: number; maxSeconds: number }
  | { kind: "stall" };
export interface LoopbackProvider {
  setScript(script: ProviderScript): void;
  requests(): { path: string; body: string }[];
  stop(): void;
}
export function startLoopbackProvider(agent: "opencode" | "omp"): LoopbackProvider;
```

Only `POST /v1/chat/completions` is served; other paths return 404. The response is `text/event-stream`, produced by a pull-based `ReadableStream` so it does not buffer the whole script. Frames, verbatim:

```ts
const base = { id: "poc", object: "chat.completion.chunk", created: 1, model };
// text delta
{ ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] }
// final
{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
```

Each frame is `data: <json>\n\n`, ending with `data: [DONE]\n\n`. For OpenCode, a request without a non-empty `tools` array is the title request and gets the single text `poc`. Every OMP request is a main request. `stall` keeps the stream open and writes nothing until `stop()`. `paced` writes generated text deltas until the client disconnects or `maxSeconds` passes.

### D2. Launch fixtures

`migration/bun/poc/acp/agents.ts`:

```ts
export type AgentKind = "opencode" | "omp";
export function prepareAgent(kind: AgentKind): AgentProcessOptions & { root: string };
```

Each call builds a fresh `mkdtemp` root with `home/`, `data/`, `tmp/` and `work/`, and `cwd` is `work/`. Environment passes only what is listed.

OpenCode: args `["acp"]`. Environment: `PATH`, `HOME`, `XDG_CONFIG_HOME=<root>/config`, `XDG_DATA_HOME=<root>/data`, `TMPDIR=<root>/tmp`. Write `<root>/config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "share": "disabled",
  "model": "poc/poc-model",
  "provider": {
    "poc": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "poc",
      "options": { "baseURL": "http://127.0.0.1:43291/v1", "apiKey": "poc" },
      "models": { "poc-model": { "name": "poc-model", "limit": { "context": 1000000000, "output": 1000000000 } } }
    }
  }
}
```

OMP: args `["acp"]`. Environment: `PATH`, `HOME`, `XDG_DATA_HOME=<root>/data`, `TMPDIR=<root>/tmp`. Write `<root>/home/.omp/agent/models.yml`:

```yaml
providers:
  poc-fixture:
    baseUrl: http://127.0.0.1:43291/v1
    auth: none
    api: openai-completions
    models:
      - id: poc-fixture
        name: poc-fixture
        reasoning: false
        input:
          - text
        contextWindow: 1000000000
        maxTokens: 1000000000
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
```

After `session/new` on OMP, find the option with `id === "model"` in `configOptions` and call `setSessionConfigOption({ sessionId, configId: "model", value: "poc-fixture/poc-fixture" })`.

The large limits stop agent-side context accounting from masking transport behavior.

### D3. ACP driver

`migration/bun/poc/acp/driver.ts`:

```ts
export interface DriverOptions {
  wrapStdout?: (s: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
}
export interface AcpRun {
  handle: AgentProcessHandle;
  connection: acp.ClientSideConnection;
  sessionId: string;
  text(): string;                    // concatenated agent_message_chunk text
  firstText: Promise<void>;
  promptOrCrash(text: string): Promise<acp.PromptResponse>;
  stop(): Promise<void>;             // terminateAgentProcess, then provider-independent cleanup
}
export function startRun(kind: AgentKind, options?: DriverOptions): Promise<AcpRun>;
export function stallAfter(bytes: number, stallMs: number):
  (s: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
```

Sequence, matching `AgentConnector.connect()`: `createAgentProcess`; start a loop that drains `stderr` to a byte counter; build `acp.ndJsonStream(handle.stdin, wrappedStdout)` and `new acp.ClientSideConnection(() => client, stream)`; call `initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false } })` and `newSession({ cwd, mcpServers: [] })`.

The `acp.Client` implementation: `sessionUpdate` appends `agent_message_chunk` text; `requestPermission` returns `{ outcome: { outcome: "cancelled" } }`; `readTextFile` and `writeTextFile` throw. `promptOrCrash` is `Promise.race` of `connection.prompt` and `handle.exited.then(() => { throw new Error("agent exited") })`, mirroring the connector's crash signal.

`stallAfter` returns a pull-based wrapper that reads from the source, counts bytes, and sleeps `stallMs` once after `bytes`.

### D4. Suite method

`migration/bun/poc/suites/acp.spec.ts` starts a provider per test, calls `run.stop()` and kills any recorded survivor in `afterEach`, and loops over `[["opencode", "OC"], ["omp", "OMP"]]`. Test titles are `ACP-NN-OC: ...` and `ACP-NN-OMP: ...`. Get a process with `waitForChild(handle.pid)` first, because `dumb-init` forks after `spawn` returns. The text generator returns printable ASCII from a seeded counter, so JSON escaping does not change sizes.

| ID | Method |
| --- | --- |
| ACP-01 | `text` script of 1 KiB. Assert stop reason and `text()`. |
| ACP-02 | `text` script of 16 MiB with `chunkBytes` 262144. Compare SHA-256. |
| ACP-03 | Prompt of 1 MiB generated text, reply 16 bytes. Assert some recorded request body contains the whole prompt string. |
| ACP-09 | Set the four sentinels in `process.env` before `startRun`, delete them in `afterEach`. After `session/new`, read `readEnviron` on every `descendantsOf(handle.pid)`. Assert the sentinels are absent and `PATH` and `HOME` hold the passed values. |
| ACP-10 | After a short prompt, record `descendantsOf(handle.pid)`, `stop()`, then assert `isAlive` is false for every recorded PID. |

## Risks / Trade-offs

- [An agent limits output or rewrites large text regardless of the fixture limits] → That shows as a failed ACP-02 or ACP-03. Under gate design D5, inspect it, and report it as an agent-side cause if so; do not lower the size.
- [The pinned OMP 18.6.1 differs from the probed 18.18.0] → `ACP-01-OMP` fails first and names the difference. The model option value and `omp acp` arguments are the likely points; the existing integration test is the reference.
- [An agent's child processes briefly outlive teardown] → ACP-10 runs after `exited`. If this shows up as a failure, it is real P0-3 evidence.
- [The pinned OpenCode downloads its provider package at run time] → `ACP-01-OC` hangs or errors under `--network=none`. Run it first (task 2.2). If that is the cause, report it; the image can pre-install the package only through an OpenSpec change to the harness.
- [OMP extracts native addons in every fresh data home] → Each test costs extra seconds. The 120 s per-test timeout covers this; report if it does not.
- [Port 43291 is busy] → The run uses `--network=none` in its own network namespace, so nothing else binds it.
