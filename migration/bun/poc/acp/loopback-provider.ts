/**
 * Scripted loopback model provider for the ACP suites: an OpenAI
 * chat-completions endpoint on `127.0.0.1:43291` that neither agent can reach
 * beyond the container's own network namespace, so a run needs no credentials
 * and no network.
 *
 * The response is a pull-based `text/event-stream`: every frame is generated
 * when the socket asks for one, so a 16 MiB script is never buffered as a
 * single body. OpenCode sends a separate title request that carries no `tools`
 * array; it is answered with the fixed text `poc` so the scripted text only
 * ever describes the main request.
 */
export const PROVIDER_PORT = 43291;
export const PROVIDER_BASE_URL = `http://127.0.0.1:${PROVIDER_PORT}/v1`;
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
/** The answer to OpenCode's title request, which carries no tools. */
const TITLE_TEXT = "poc";

export type ProviderScript =
  | { kind: "text"; text: string; chunkBytes: number }
  | { kind: "paced"; chunkBytes: number; intervalMs: number; maxSeconds: number }
  | { kind: "stall" };

export interface LoopbackProvider {
  setScript(script: ProviderScript): void;
  requests(): { path: string; body: string }[];
  stop(): void;
}

/**
 * Printable ASCII (`!` through `~`) minus `"` and `\`, which JSON escapes and
 * so would change a byte count in either direction of the transport. Every
 * chunk is regenerable from its offset alone.
 */
const PRINTABLE = Array.from({ length: 94 }, (_, index) => 0x21 + index).filter(
  (byte) => byte !== 0x22 && byte !== 0x5c,
);

/**
 * Mixes a position into a 32-bit value (the `lowbias32` integer hash), so each
 * byte depends on its absolute position alone and no short cycle appears.
 */
function mixPosition(position: number): number {
  let value = position >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

/**
 * Deterministic text from the seeded printable alphabet above. Byte `i` is a
 * hash of `seed + i`, so any slice is regenerable from its offset alone.
 *
 * The text must not be periodic: OMP 18.6.1 runs a thinking-loop detector
 * over model output and treats a short repeated cycle (the alphabet repeated
 * 13 times) as a stream stall, then aborts and retries the request. A
 * `(seed + i) % alphabet` sequence trips it after about 1.2 KB and the agent
 * forwards only 12,990 bytes whatever the script length, under any parent
 * runtime.
 */
export function printableText(length: number, seed = 0): string {
  const bytes = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index++) {
    bytes[index] = PRINTABLE[mixPosition(seed + index) % PRINTABLE.length];
  }
  return bytes.toString("latin1");
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function deltaFrame(model: string, content: string): string {
  const base = { id: "poc", object: "chat.completion.chunk", created: 1, model };
  const chunk = {
    ...base,
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function finalFrame(model: string): string {
  const base = { id: "poc", object: "chat.completion.chunk", created: 1, model };
  const chunk = {
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

const DONE_FRAME = "data: [DONE]\n\n";

interface StreamState {
  script: ProviderScript;
  model: string;
  waiters: Set<() => void>;
}

/**
 * The SSE body for one request, driven from the script captured when the
 * request arrived. `stall` writes nothing until the provider stops; `paced`
 * repeats printable deltas until the client disconnects or `maxSeconds`
 * passes, then ends the stream normally so a slow consumer fails an assertion
 * rather than hanging the suite.
 */
function scriptedStream(state: StreamState): ReadableStream<Uint8Array> {
  const script = state.script;
  const started = performance.now();
  let cancelled = false;
  let closed = false;
  let offset = 0;
  let phase: "body" | "final" | "done" = "body";
  let waiter: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled || closed) return;
      if (script.kind === "stall") {
        const { promise, resolve } = Promise.withResolvers<void>();
        waiter = resolve;
        state.waiters.add(resolve);
        await promise;
        waiter = null;
        state.waiters.delete(resolve);
        if (cancelled) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The connection is already gone.
        }
        return;
      }
      if (phase === "body" && script.kind === "paced") {
        if (performance.now() - started >= script.maxSeconds * 1000) {
          phase = "final";
        } else {
          const size = Math.max(1, Math.floor(script.chunkBytes));
          controller.enqueue(encode(deltaFrame(state.model, printableText(size, offset))));
          offset += size;
          await Bun.sleep(Math.max(0, script.intervalMs));
          return;
        }
      }
      if (phase === "body") {
        const { text, chunkBytes } = script as { text: string; chunkBytes: number };
        const size = Math.max(1, Math.floor(chunkBytes));
        if (offset < text.length) {
          const content = text.slice(offset, offset + size);
          offset += content.length;
          controller.enqueue(encode(deltaFrame(state.model, content)));
          return;
        }
        phase = "final";
      }
      if (phase === "final") {
        phase = "done";
        controller.enqueue(encode(finalFrame(state.model)));
        return;
      }
      closed = true;
      controller.enqueue(encode(DONE_FRAME));
      controller.close();
    },
    cancel() {
      cancelled = true;
      if (waiter !== null) {
        state.waiters.delete(waiter);
        waiter();
        waiter = null;
      }
    },
  });
}

/** Reads the model name and whether this is a main (tool-carrying) request. */
function describeRequest(body: string): { model: string; main: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { model: "poc-model", main: true };
  }
  const record =
    parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const model = typeof record.model === "string" ? record.model : "poc-model";
  const tools = record.tools;
  return { model, main: Array.isArray(tools) && tools.length > 0 };
}

export function startLoopbackProvider(agent: "opencode" | "omp"): LoopbackProvider {
  let script: ProviderScript = { kind: "stall" };
  const recorded: { path: string; body: string }[] = [];
  const waiters = new Set<() => void>();
  let stopped = false;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: PROVIDER_PORT,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body = await request.text();
      recorded.push({ path, body });
      if (request.method !== "POST" || path !== CHAT_COMPLETIONS_PATH) {
        return new Response("not found", { status: 404 });
      }
      const { model, main } = describeRequest(body);
      // OpenCode asks for the session title in a separate request that carries
      // no tools; it is answered with the fixed text whatever the script is.
      const requestScript: ProviderScript = agent === "opencode" && !main
        ? { kind: "text", text: TITLE_TEXT, chunkBytes: TITLE_TEXT.length }
        : script;
      const stream = scriptedStream({ script: requestScript, model, waiters });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    },
  });

  return {
    setScript(next) {
      script = next;
    },
    requests() {
      return recorded.map((entry) => ({ ...entry }));
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const resolve of waiters) resolve();
      waiters.clear();
      server.stop(true);
    },
  };
}
