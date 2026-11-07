/**
 * ACP failure suite: the pinned real `opencode` and `omp` executables are driven
 * over ACP by a Bun parent through the proof-of-concept spawn boundary, and the
 * transport is deliberately made to fail (migration design section 8 step 2,
 * criteria ACP-04 to ACP-08). A scripted loopback model provider produces the
 * slow, paced, stalled and closed streams, so a run contacts no model provider
 * and needs no credentials. Every title starts with the criterion ID the gate
 * matches; a failing check is a result, so no bound here is relaxed.
 */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AgentKind } from "../acp/agents.ts";
import { type AcpRun, type DriverOptions, startRun, stallAfter } from "../acp/driver.ts";
import {
  type LoopbackProvider,
  printableText,
  type ProviderScript,
  startLoopbackProvider,
} from "../acp/loopback-provider.ts";
import { descendantsOf, isAlive, waitForChild } from "../process/proc-tree.ts";

const MIB = 1024 * 1024;

/** ACP-04: 4 MiB of text in 256 KiB chunks, with a stall after the first 1 MiB. */
const SLOW_OUTPUT_BYTES = 4 * MIB;
const SLOW_OUTPUT_CHUNK_BYTES = 262144;
const SLOW_CONSUMER_STALL_AFTER_BYTES = MIB;
const SLOW_CONSUMER_STALL_MS = 3000;

/** ACP-05: a paced stream that outlives the 5 s cancellation bound. */
const PACED_CHUNK_BYTES = 65536;
const PACED_INTERVAL_MS = 50;
const PACED_MAX_SECONDS = 60;
const CANCEL_BOUND_MS = 5000;

/** ACP-06: the client gives up after 3 s; teardown then has 5 s. */
const CLIENT_TIMEOUT_MS = 3000;
const TEARDOWN_BOUND_MS = 5000;

/** ACP-07: a killed agent must surface the failure within 3 s. */
const CRASH_BOUND_MS = 3000;

/** ACP-08: a closed connection must be observed within 5 s. */
const CLOSE_BOUND_MS = 5000;

const SHORT_REPLY_BYTES = 64;

/** The pinned agents, in the order of the gate's criterion suffixes. */
const AGENTS: readonly (readonly [AgentKind, string])[] = [["opencode", "OC"], ["omp", "OMP"]];

let provider: LoopbackProvider | null = null;
let run: AcpRun | null = null;

afterEach(async () => {
  const current = run;
  run = null;
  if (current !== null) {
    const recorded = descendantsOf(current.handle.pid);
    await current.stop();
    for (const pid of recorded) {
      if (!isAlive(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Best effort: the PID was already reaped.
      }
    }
  }
  provider?.stop();
  provider = null;
});

/**
 * Starts the provider with the test's script, then the agent, then waits for
 * `dumb-init`'s fork. The script is installed before the spawn so a pin that
 * asks the provider anything during the handshake cannot hang on the default.
 */
async function start(
  kind: AgentKind,
  script: ProviderScript,
  options: DriverOptions = {},
): Promise<{ provider: LoopbackProvider; run: AcpRun }> {
  const startedProvider = startLoopbackProvider(kind);
  startedProvider.setScript(script);
  provider = startedProvider;
  const startedRun = await startRun(kind, options);
  run = startedRun;
  await waitForChild(startedRun.handle.pid);
  return { provider: startedProvider, run: startedRun };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Rejects with a descriptive error when `promise` has not settled within `ms`. */
function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = Bun.sleep(ms).then(() => {
    throw new Error(`${label} did not settle within ${ms} ms`);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Which settles first: the promise (either outcome) or the timer. Attaches its
 * own handlers, so a later rejection of `promise` is never unhandled.
 */
function firstSettled(promise: Promise<unknown>, ms: number): Promise<"settled" | "timer"> {
  return Promise.race([
    promise.then(() => "settled" as const, () => "settled" as const),
    Bun.sleep(ms).then(() => "timer" as const),
  ]);
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value): Settled<T> => ({ ok: true, value }),
    (error): Settled<T> => ({ ok: false, error }),
  );
}

async function acp04(kind: AgentKind): Promise<void> {
  const text = printableText(SLOW_OUTPUT_BYTES, 0);
  const started = await start(
    kind,
    { kind: "text", text, chunkBytes: SLOW_OUTPUT_CHUNK_BYTES },
    { wrapStdout: stallAfter(SLOW_CONSUMER_STALL_AFTER_BYTES, SLOW_CONSUMER_STALL_MS) },
  );
  const response = await started.run.promptOrCrash("poc slow consumer");
  expect(response.stopReason).toBe("end_turn");
  const received = started.run.text();
  expect(Buffer.byteLength(received, "utf8")).toBe(SLOW_OUTPUT_BYTES);
  expect(sha256(received)).toBe(sha256(text));
}

async function acp05(kind: AgentKind): Promise<void> {
  const started = await start(kind, {
    kind: "paced",
    chunkBytes: PACED_CHUNK_BYTES,
    intervalMs: PACED_INTERVAL_MS,
    maxSeconds: PACED_MAX_SECONDS,
  });
  const pending = started.run.promptOrCrash("poc cancel");
  await started.run.firstText;
  await started.run.connection.cancel({ sessionId: started.run.sessionId });
  const response = await within(pending, CANCEL_BOUND_MS, "cancelled prompt");
  expect(response.stopReason).toBe("cancelled");
}

async function acp06(kind: AgentKind): Promise<void> {
  const started = await start(kind, { kind: "stall" });
  const pending = started.run.promptOrCrash("poc stalled provider");
  const tracked = settle(pending);

  // The client-side timeout: the stalled provider never gives the prompt a
  // reason to finish, so the timer has to win.
  expect(await firstSettled(tracked, CLIENT_TIMEOUT_MS)).toBe("timer");

  // Teardown has to complete while that prompt is still outstanding, and the
  // wrapper's exit has to be observable afterwards.
  await within(started.run.stop(), TEARDOWN_BOUND_MS, "teardown");
  const exit = await within(started.run.handle.exited, TEARDOWN_BOUND_MS, "wrapper exit");
  expect(typeof exit.code === "number" || typeof exit.signal === "string").toBe(true);

  // The client-side timeout has to surface as a rejected call, and teardown
  // must not leave it hanging: the abandoned prompt has to settle, rejecting.
  const timedOut = await within(tracked, TEARDOWN_BOUND_MS, "abandoned prompt");
  expect(timedOut.ok).toBe(false);
}

async function acp07(kind: AgentKind): Promise<void> {
  const started = await start(kind, {
    kind: "paced",
    chunkBytes: PACED_CHUNK_BYTES,
    intervalMs: PACED_INTERVAL_MS,
    maxSeconds: PACED_MAX_SECONDS,
  });
  const tracked = settle(started.run.promptOrCrash("poc abrupt exit"));
  await started.run.firstText;
  process.kill(await waitForChild(started.run.handle.pid), "SIGKILL");

  const crashed = await within(tracked, CRASH_BOUND_MS, "pending prompt");
  expect(crashed.ok).toBe(false);
  const exit = await within(started.run.handle.exited, CRASH_BOUND_MS, "wrapper exit");
  expect(typeof exit.code === "number" || typeof exit.signal === "string").toBe(true);
}

async function acp08(kind: AgentKind): Promise<void> {
  const started = await start(kind, {
    kind: "text",
    text: printableText(SHORT_REPLY_BYTES, 3),
    chunkBytes: SHORT_REPLY_BYTES,
  });
  const response = await started.run.promptOrCrash("poc end of stream");
  expect(response.stopReason).toBe("end_turn");

  await started.run.stop();
  expect(await firstSettled(started.run.connection.closed, CLOSE_BOUND_MS)).toBe("settled");
}

/** Criterion suffix, title description and body, in ID order for both agents. */
const CASES: readonly (readonly [string, string, (kind: AgentKind) => Promise<void>])[] = [
  ["04", "a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256", acp04],
  ["05", "session/cancel ends a paced stream with stop reason cancelled within 5 s", acp05],
  ["06", "a 3 s client timeout leaves teardown to resolve with the wrapper exited", acp06],
  ["07", "SIGKILL mid-stream rejects the pending prompt within 3 s and resolves exited", acp07],
  ["08", "teardown ends stdout and resolves the connection closed signal within 5 s", acp08],
];

for (const [id, description, body] of CASES) {
  for (const [kind, tag] of AGENTS) {
    test(`ACP-${id}-${tag}: ${description}`, () => body(kind));
  }
}
