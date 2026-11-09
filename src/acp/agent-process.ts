/**
 * The single agent spawn boundary of design section 4.3 of
 * `docs/superpowers/specs/2026-11-07-bun-runtime-migration-design.md`.
 *
 * Every child is wrapped by `dumb-init`, exactly like the production
 * `AgentConnector`, and receives only the explicitly passed environment — the
 * parent environment is never spread, so a parent secret cannot leak into an
 * agent.
 */
import { spawn } from "node:child_process";
import { Readable } from "node:stream";

/** Default path to the dumb-init binary that wraps every agent subprocess. */
export const DUMB_INIT_PATH = "dumb-init";

/** Grace period between SIGTERM and SIGKILL, in milliseconds. */
export const DEFAULT_GRACE_MS = 2000;

export interface AgentProcessOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  /** The COMPLETE child environment. Never build this by spreading `process.env`. */
  env: Record<string, string>;
  /** Wrapper executable; defaults to {@link DUMB_INIT_PATH}. */
  wrapper?: string;
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
 * Spawns `<wrapper> -- <command> <args>` with the passed environment only.
 *
 * `env` is passed as-is: it is the complete child environment, so NEVER spread
 * `process.env` into it here.
 *
 * The stdin adapter deliberately does not use `Writable.toWeb`: on Bun 1.4.2
 * that adapter resolves a 16 MiB write to a sleeping child in 6 ms, so it
 * propagates no backpressure. Forwarding through `child.stdin.write`'s
 * callback keeps the write pending until the child actually drains the pipe.
 *
 * Unlike the PoC copy, the underlying writable's `error` event is consumed
 * here: a child that closes stdin or dies mid-write otherwise raises an
 * uncaught `EPIPE` that would take the bot process down.
 */
export function createAgentProcess(options: AgentProcessOptions): AgentProcessHandle {
  const child = spawn(options.wrapper ?? DUMB_INIT_PATH, ["--", options.command, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const exitBridge = Promise.withResolvers<AgentProcessExit>();
  child.once("exit", (code, signal) => exitBridge.resolve({ code, signal, success: code === 0 }));
  child.once("error", () => exitBridge.resolve({ code: null, signal: null, success: false }));
  const exited = exitBridge.promise;

  let stdinFailure: Error | null = null;
  let rejectPending: ((reason: unknown) => void) | null = null;
  // A write rejects through its callback, but the writable also emits `error`;
  // an unhandled `error` event on a Node stream is an uncaught exception.
  child.stdin!.on("error", (error: Error) => {
    stdinFailure = error;
    rejectPending?.(error);
    rejectPending = null;
  });

  const stdin = new WritableStream<Uint8Array>({
    write: (chunk) => {
      if (stdinFailure !== null) return Promise.reject(stdinFailure);
      const pending = Promise.withResolvers<void>();
      rejectPending = pending.reject;
      child.stdin!.write(chunk, (error) => {
        rejectPending = null;
        if (error) {
          pending.reject(error);
        } else {
          pending.resolve();
        }
      });
      return pending.promise;
    },
    close: () => {
      const pending = Promise.withResolvers<void>();
      child.stdin!.end(() => {
        if (stdinFailure !== null) {
          pending.reject(stdinFailure);
        } else {
          pending.resolve();
        }
      });
      return pending.promise;
    },
    abort: () => {
      child.stdin!.destroy();
    },
  }, new CountQueuingStrategy({ highWaterMark: 1 }));

  return {
    pid: child.pid!,
    stdin,
    stdout: Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(child.stderr!) as unknown as ReadableStream<Uint8Array>,
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
