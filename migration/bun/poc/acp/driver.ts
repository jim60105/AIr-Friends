/**
 * Minimal ACP client over the proof-of-concept spawn boundary (design D3).
 *
 * It mirrors `AgentConnector.connect()` — same `ndJsonStream` wiring, same
 * initialize payload, same crash race around every request — but without the
 * production `ChatbotClient`, which still imports Deno APIs. Permission
 * requests are cancelled and no filesystem callback is served, because these
 * suites only exercise the transport.
 */
import * as acp from "@agentclientprotocol/sdk";
import { rmSync } from "node:fs";
import {
  createAgentProcess,
  type AgentProcessHandle,
  terminateAgentProcess,
} from "../process/agent-process.ts";
import { prepareAgent, type AgentKind } from "./agents.ts";

/** OMP exposes its models as `<provider>/<id>`; launch fixtures name both `poc-fixture`. */
const OMP_MODEL_VALUE = "poc-fixture/poc-fixture";
const STDERR_TAIL_CHARS = 8192;

export interface DriverOptions {
  wrapStdout?: (stream: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
}

export interface AcpRun {
  kind: AgentKind;
  handle: AgentProcessHandle;
  connection: acp.ClientSideConnection;
  sessionId: string;
  /** The temporary root of this run's home, data, tmp and work directories. */
  root: string;
  /** Exactly the environment the agent was launched with. */
  env: Record<string, string>;
  /** The session working directory passed to `session/new`. */
  cwd: string;
  stderr(): { bytes: number; tail: string };
  /** Concatenated `agent_message_chunk` text seen so far. */
  text(): string;
  /** Resolves when the first `agent_message_chunk` arrives. */
  firstText: Promise<void>;
  /** `connection.prompt`, rejecting if the agent exits first. */
  promptOrCrash(text: string): Promise<acp.PromptResponse>;
  /** `terminateAgentProcess`, then removes the temporary root. Idempotent. */
  stop(): Promise<void>;
}

/** Counts stderr bytes while keeping the tail for a crash message. */
function drainStderr(stream: ReadableStream<Uint8Array>): {
  bytes: () => number;
  tail: () => string;
} {
  let bytes = 0;
  let tail = "";
  const decoder = new TextDecoder();
  void (async () => {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        tail = `${tail}${decoder.decode(value, { stream: true })}`.slice(-STDERR_TAIL_CHARS);
      }
    } catch {
      // The agent died mid-read; the count already observed stands.
    }
  })();
  return { bytes: () => bytes, tail: () => tail };
}

/** Races an ACP request against the agent's exit, mirroring the connector's crash signal. */
function crashRace<T>(
  handle: AgentProcessHandle,
  request: Promise<T>,
  stderr: () => string,
): Promise<T> {
  return Promise.race([
    request,
    handle.exited.then((exit) => {
      const detail = stderr().trim();
      const suffix = detail === "" ? "" : `: ${detail}`;
      throw new Error(
        `agent exited (code ${exit.code}, signal ${exit.signal}) before the ACP call completed${suffix}`,
      );
    }),
  ]);
}

class DriverClient implements acp.Client {
  #chunks: string[] = [];
  #joined = "";
  #dirty = false;
  #markFirstText: () => void;
  readonly firstText: Promise<void>;

  constructor() {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.firstText = promise;
    this.#markFirstText = resolve;
  }

  text(): string {
    if (this.#dirty) {
      this.#joined = this.#chunks.join("");
      this.#dirty = false;
    }
    return this.#joined;
  }

  sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      this.#chunks.push(update.content.text);
      this.#dirty = true;
      this.#markFirstText();
    }
    return Promise.resolve();
  }

  requestPermission(): Promise<acp.RequestPermissionResponse> {
    return Promise.resolve({ outcome: { outcome: "cancelled" } });
  }

  readTextFile(): Promise<acp.ReadTextFileResponse> {
    return Promise.reject(new Error("the POC driver serves no readTextFile callback"));
  }

  writeTextFile(): Promise<acp.WriteTextFileResponse> {
    return Promise.reject(new Error("the POC driver serves no writeTextFile callback"));
  }
}

export async function startRun(kind: AgentKind, options: DriverOptions = {}): Promise<AcpRun> {
  const prepared = prepareAgent(kind);
  const handle = createAgentProcess(prepared);
  const stderr = drainStderr(handle.stderr);

  try {
    const client = new DriverClient();
    const stdout = options.wrapStdout === undefined
      ? handle.stdout
      : options.wrapStdout(handle.stdout);
    const connection = new acp.ClientSideConnection(
      () => client,
      acp.ndJsonStream(handle.stdin, stdout),
    );

    await crashRace(
      handle,
      connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
      }),
      stderr.tail,
    );

    const session = await crashRace(
      handle,
      connection.newSession({ cwd: prepared.cwd, mcpServers: [] }),
      stderr.tail,
    );

    if (kind === "omp") {
      const advertised = session.configOptions ?? [];
      const modelOption = advertised.find((option) => option.id === "model");
      if (modelOption === undefined) {
        const ids = advertised.map((option) => option.id).join(", ") || "none";
        throw new Error(`omp advertised no model config option (advertised: ${ids})`);
      }
      await crashRace(
        handle,
        connection.setSessionConfigOption({
          sessionId: session.sessionId,
          configId: "model",
          value: OMP_MODEL_VALUE,
        }),
        stderr.tail,
      );
    }

    let stopping: Promise<void> | null = null;
    return {
      kind,
      handle,
      connection,
      sessionId: session.sessionId,
      root: prepared.root,
      env: prepared.env,
      cwd: prepared.cwd,
      stderr: () => ({ bytes: stderr.bytes(), tail: stderr.tail() }),
      text: () => client.text(),
      firstText: client.firstText,
      promptOrCrash: (text) =>
        crashRace(
          handle,
          connection.prompt({
            sessionId: session.sessionId,
            prompt: [{ type: "text", text }],
          }),
          stderr.tail,
        ),
      stop: () => {
        stopping ??= (async () => {
          try {
            await terminateAgentProcess(handle);
          } finally {
            rmSync(prepared.root, { recursive: true, force: true });
          }
        })();
        return stopping;
      },
    };
  } catch (error) {
    // A failed handshake must not leave an agent or a temporary root behind.
    try {
      await terminateAgentProcess(handle);
    } finally {
      rmSync(prepared.root, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * A pull-based wrapper that stops draining the source for `stallMs` once
 * `bytes` have passed, so the agent's writes back up into the pipe exactly as
 * they would for a stalled consumer.
 */
export function stallAfter(
  bytes: number,
  stallMs: number,
): (stream: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array> {
  return (source) => {
    const reader = source.getReader();
    let seen = 0;
    let stalled = false;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        seen += value.byteLength;
        if (!stalled && seen >= bytes) {
          stalled = true;
          await Bun.sleep(stallMs);
        }
        controller.enqueue(value);
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    });
  };
}
