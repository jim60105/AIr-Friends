// tests/acp/agent-process.test.ts
//
// Behaviour of the single agent spawn boundary (`src/acp/agent-process.ts`)
// against DETERMINISTIC child processes it really spawns under `dumb-init`:
// stdin backpressure, byte-intact piping, stderr-free exit reports, signal
// exits and the connector's SIGKILL escalation after its 2-second grace.
//
// The scenarios mirror the `Agent Stdin Backpressure` and `Agent Exit Report`
// requirements; the fixtures are tiny inline scripts written to a temp dir and
// launched with the running Bun executable, so nothing outside this test
// process is required except `dumb-init`.
//
// Real timers are deliberate: these cases measure the OPERATING SYSTEM's pipe
// backpressure and the real 2-second SIGTERM→SIGKILL grace against a live child
// process, so fake timers cannot drive them.
import { assert, assertEquals, assertRejects } from "@std/assert";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "bun:test";
import { AgentConnector } from "@acp/agent-connector.ts";
import { type AgentProcessHandle, createAgentProcess } from "../../src/acp/agent-process.ts";
import { Logger, LogLevel } from "@utils/logger.ts";

const MIB = 1024 * 1024;
const DUMB_INIT_AVAILABLE = Bun.which("dumb-init") !== null;

/** The child environment every fixture runs with: explicit, never inherited. */
const CHILD_ENV: Record<string, string> = {
  PATH: process.env["PATH"] ?? "/usr/local/bin:/usr/bin:/bin",
  HOME: "/tmp",
};

/** Scratch dir holding this file's inline fixture scripts. */
const scratch = mkdtempSync(join(tmpdir(), "agent-process-"));

/** Writes one fixture script and returns its path. */
function fixture(name: string, source: string): string {
  const path = join(scratch, name);
  writeFileSync(path, source);
  return path;
}

const ECHO = fixture("echo.js", "process.stdin.pipe(process.stdout);\n");
const DELAYED_ECHO = fixture(
  "delayed-echo.js",
  "setTimeout(() => process.stdin.pipe(process.stdout), 2000);\n",
);
const EXIT_3 = fixture("exit-3.js", "process.exit(3);\n");
const EXIT_NOW = fixture("exit-now.js", "process.exit(0);\n");
const IGNORE_TERM = fixture(
  "ignore-term.js",
  'process.on("SIGTERM", () => {});\n' +
    'require("node:fs").writeFileSync(process.argv[2], String(process.pid));\n' +
    "setInterval(() => {}, 1000);\n",
);

/** Starts one fixture through the real boundary, wrapped by `dumb-init`. */
function start(script: string, extraArgs: readonly string[] = []): AgentProcessHandle {
  return createAgentProcess({
    command: process.execPath,
    args: ["run", "--no-env-file", script, ...extraArgs],
    cwd: scratch,
    env: CHILD_ENV,
  });
}

/** Reads a stream to its end, returning the byte count and the SHA-256. */
async function drain(
  stream: ReadableStream<Uint8Array>,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    hash.update(value);
  }
  return { bytes, sha256: hash.digest("hex") };
}

/** Races a promise against a deadline so a stuck child fails instead of hanging. */
async function within<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => deadline.reject(new Error(`${label} did not settle within ${timeoutMs} ms`)),
    timeoutMs,
  );
  try {
    return await Promise.race([promise, deadline.promise]);
  } finally {
    clearTimeout(timer);
  }
}

/** Waits until the fixture reports its PID, then returns it. */
async function waitForPidFile(path: string): Promise<number> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) {
      throw new Error(`fixture never wrote its readiness file ${path}`);
    }
    await Bun.sleep(10);
  }
  return Number.parseInt(readFileSync(path, "utf8"), 10);
}

describe.skipIf(!DUMB_INIT_AVAILABLE)("agent process boundary", () => {
  test("Agent Stdin Backpressure - sleeping child: a 16 MiB write stays pending, then resolves", async () => {
    const handle = start(DELAYED_ECHO);
    const writer = handle.stdin.getWriter();
    const output = drain(handle.stdout);
    const inputHash = createHash("sha256");
    const chunk = new Uint8Array(16 * MIB).fill(7);
    inputHash.update(chunk);

    try {
      const write = writer.write(chunk);
      const outcome = await Promise.race([
        write.then(() => "done" as const),
        Bun.sleep(500).then(() => "pending" as const),
      ]);
      assertEquals(outcome, "pending", "the write must be held back by the sleeping child");

      await within(write, 30_000, "the backpressured write");
      await writer.close();

      const echoed = await within(output, 30_000, "the echoed stdout");
      const exit = await within(handle.exited, 30_000, "the child exit");
      assertEquals(echoed.bytes, 16 * MIB);
      assertEquals(echoed.sha256, inputHash.digest("hex"));
      assertEquals(exit.code, 0);
      assertEquals(exit.success, true);
    } finally {
      await writer.abort().catch(() => undefined);
      handle.kill("SIGKILL");
    }
  });

  test("Agent Stdin Backpressure - data intact: 32 MiB echoes back byte-identically", async () => {
    const handle = start(ECHO);
    const writer = handle.stdin.getWriter();
    const output = drain(handle.stdout);
    const inputHash = createHash("sha256");

    try {
      for (let index = 0; index < 32; index++) {
        const chunk = new Uint8Array(MIB).fill(index & 0xff);
        inputHash.update(chunk);
        await within(writer.write(chunk), 30_000, "one 1 MiB write");
      }
      await writer.close();

      const echoed = await within(output, 30_000, "the 32 MiB echo");
      const exit = await within(handle.exited, 30_000, "the child exit");
      assertEquals(echoed.bytes, 32 * MIB);
      assertEquals(echoed.sha256, inputHash.digest("hex"));
      assertEquals(exit.code, 0);
    } finally {
      await writer.abort().catch(() => undefined);
      handle.kill("SIGKILL");
    }
  });

  test("Agent Exit Report - normal exit reports code 3, no signal, not a success", async () => {
    const handle = start(EXIT_3);
    const exit = await within(handle.exited, 30_000, "the child exit");
    assertEquals(exit, { code: 3, signal: null, success: false });
  });

  test("Agent Exit Report - a SIGKILLed wrapper reports a null code and the signal name", async () => {
    const handle = start("sleep", ["0.2"]);
    try {
      handle.kill("SIGKILL");
      const exit = await within(handle.exited, 30_000, "the child exit");
      assertEquals(exit, { code: null, signal: "SIGKILL", success: false });
    } finally {
      handle.kill("SIGKILL");
    }
  });

  test("Agent Exit Report - the connector sends SIGKILL 2 s after SIGTERM when the child ignores it", async () => {
    const readyPath = join(scratch, `ready-${randomUUID()}`);
    const handle = start(IGNORE_TERM, [readyPath]);
    const connector = new AgentConnector({
      agentConfig: { command: "unused", args: [], cwd: scratch },
      clientConfig: {
        workingDir: scratch,
        platform: "test",
        userId: "user",
        channelId: "channel",
        isDM: false,
      },
      skillRegistry: null,
      logger: new Logger("agent-process-test", { level: LogLevel.FATAL }),
      agentType: "opencode",
    });
    let childPid: number | undefined;
    try {
      childPid = await within(waitForPidFile(readyPath), 30_000, "the fixture readiness report");
      // Record the signals the connector really sends, still forwarding them.
      const sent: { signal: string; at: number }[] = [];
      const forwardKill = handle.kill.bind(handle);
      handle.kill = (signal) => {
        sent.push({ signal, at: performance.now() });
        forwardKill(signal);
      };
      connector["process"] = handle;

      const started = performance.now();
      await within(connector.disconnect(), 30_000, "the connector disconnect");
      const elapsedMs = performance.now() - started;

      const exit = await within(handle.exited, 30_000, "the escalated exit");
      assert(elapsedMs >= 1900, `SIGKILL came after only ${elapsedMs.toFixed(0)} ms`);
      assert(elapsedMs <= 3000, `SIGKILL came after ${elapsedMs.toFixed(0)} ms, past the grace`);
      assertEquals(
        sent.map((entry) => entry.signal),
        ["SIGTERM", "SIGKILL"],
        "the connector must send SIGTERM first and SIGKILL only on escalation",
      );
      assert(
        sent[1].at - sent[0].at >= 1900,
        `SIGKILL followed SIGTERM after only ${(sent[1].at - sent[0].at).toFixed(0)} ms`,
      );
      assertEquals(exit, { code: null, signal: "SIGKILL", success: false });
    } finally {
      // The wrapper-only SIGKILL reparents the SIGTERM-ignoring child.
      if (childPid !== undefined) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      handle.kill("SIGKILL");
    }
  });

  test("Agent Exit Report - a write after the child closed stdin rejects instead of crashing", async () => {
    const handle = start(EXIT_NOW);
    await within(handle.exited, 30_000, "the child exit");
    const writer = handle.stdin.getWriter();
    await assertRejects(
      () => writer.write(new Uint8Array(1024)),
      Error,
      undefined,
      "writing to a dead child must reject the write, not raise an uncaught stream error",
    );
  });
});

// The scratch dir is per test process; removing it here keeps repeated runs clean.
process.on("exit", () => {
  rmSync(scratch, { recursive: true, force: true });
});
