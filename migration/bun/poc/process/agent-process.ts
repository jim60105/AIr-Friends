/**
 * The single agent spawn boundary the Bun migration has to prove: the same
 * `AgentProcessHandle` contract as design section 4.3 of
 * `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`.
 *
 * Every child is wrapped by `dumb-init`, exactly like the production
 * `AgentConnector`, and receives only the explicitly passed environment — the
 * parent environment is never spread, so a parent secret cannot leak into an
 * agent.
 */
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { observe } from "../gate/evidence.ts";

const DEFAULT_GRACE_MS = 2000;

let reportedBackend = false;

export interface AgentProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
}

export interface AgentProcessExit {
  code: number | null;
  signal: string | null;
  success: boolean;
}

export interface AgentProcessHandle {
  pid: number;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<AgentProcessExit>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export interface TerminateResult {
  escalated: boolean;
  elapsedMs: number;
}

/**
 * Spawns `dumb-init -- <command> <args>` with the passed environment only.
 *
 * The stdin adapter deliberately does not use `Writable.toWeb`: on Bun 1.4.2
 * that adapter resolves a 16 MiB write to a sleeping child in 6 ms, so it
 * propagates no backpressure. Forwarding through `child.stdin.write`'s
 * callback keeps the write pending until the child actually drains the pipe.
 */
export function createAgentProcess(options: AgentProcessOptions): AgentProcessHandle {
  const backend = process.env.POC_SPAWN_BACKEND ?? "node";
  if (!reportedBackend) {
    observe("spawnBackend", backend);
    reportedBackend = true;
  }
  if (backend !== "node") {
    throw new Error(`unsupported POC_SPAWN_BACKEND "${backend}": no backend is implemented for it`);
  }

  const child = spawn("dumb-init", ["--", options.command, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const exited = new Promise<AgentProcessExit>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal, success: code === 0 }));
    child.once("error", () => resolve({ code: null, signal: null, success: false }));
  });

  const stdin = new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        child.stdin!.write(chunk, (error) => (error ? reject(error) : resolve()));
      }),
    close: () =>
      new Promise<void>((resolve) => {
        child.stdin!.end(() => resolve());
      }),
    abort: () => {
      child.stdin!.destroy();
    },
  }, new CountQueuingStrategy({ highWaterMark: 1 }));

  return {
    pid: child.pid!,
    stdin,
    stdout: Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>,
    exited,
    kill: (signal) => {
      try {
        child.kill(signal);
      } catch {
        // Best effort: the process may have exited between the race and here.
      }
    },
  };
}

/**
 * Mirrors the connector's `disconnect()`: SIGTERM, a 2000 ms grace race, then
 * SIGKILL to the wrapper only. `elapsedMs` starts when SIGTERM returns and is
 * taken when SIGKILL is sent, or when the wrapper is observed to exit.
 */
export async function terminateAgentProcess(
  handle: AgentProcessHandle,
  graceMs: number = DEFAULT_GRACE_MS,
): Promise<TerminateResult> {
  handle.kill("SIGTERM");
  const started = performance.now();
  let exited = false;
  const grace = Promise.withResolvers<void>();
  const timer = setTimeout(() => grace.resolve(), graceMs);
  await Promise.race([
    handle.exited.then(() => {
      exited = true;
    }),
    grace.promise,
  ]).finally(() => clearTimeout(timer));

  if (exited) {
    return { escalated: false, elapsedMs: performance.now() - started };
  }

  const elapsedMs = performance.now() - started;
  handle.kill("SIGKILL");
  await handle.exited;
  return { escalated: true, elapsedMs };
}
