/**
 * Agent process boundary suite: drives the `createAgentProcess` boundary the
 * Bun migration has to prove (design section 4.3) against deterministic child
 * processes. Each test title starts with the criterion ID the gate matches.
 */
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observe } from "../gate/evidence.ts";
import {
  createAgentProcess,
  type AgentProcessHandle,
  terminateAgentProcess,
} from "../process/agent-process.ts";
import {
  descendantsOf,
  isAlive,
  openFdCount,
  readEnviron,
  waitForChild,
} from "../process/proc-tree.ts";

const MIB = 1024 * 1024;
const CHILDREN_DIR = join(import.meta.dir, "..", "fixtures", "children");
const CHILD_ENV = {
  PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  HOME: "/tmp",
};

/** Handles of the running test, terminated best-effort if a test fails mid-way. */
let live: AgentProcessHandle[] = [];
/** PIDs a test proved alive after teardown; killed in `afterEach`. */
let survivors = new Set<number>();
let scratch = "";

function childCommand(name: string, ...args: string[]): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ["run", "--no-env-file", join(CHILDREN_DIR, name), ...args],
  };
}

function start(
  command: string,
  args: readonly string[] = [],
  env: Record<string, string> = CHILD_ENV,
): AgentProcessHandle {
  const handle = createAgentProcess({ command, args, cwd: process.cwd(), env });
  live.push(handle);
  return handle;
}

/** The producer's reported progress; 0 while the file does not exist yet. */
function readProgress(file: string): number {
  try {
    return Number.parseInt(readFileSync(file, "utf8"), 10) || 0;
  } catch {
    return 0;
  }
}

/** Reads a stream to its end, returning the byte count and the SHA-256. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<{ bytes: number; sha256: string }> {
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

/**
 * Reads the child's environment, retrying briefly: `/proc/<pid>/environ` can
 * read empty in the window between `fork` and a completed `execve`.
 */
async function waitForEnviron(pid: number): Promise<Record<string, string>> {
  const deadline = Date.now() + 500;
  for (;;) {
    let environment: Record<string, string> = {};
    let failure: unknown;
    try {
      environment = readEnviron(pid);
    } catch (error) {
      failure = error;
    }
    if (Object.keys(environment).length > 0) return environment;
    if (Date.now() >= deadline) {
      if (failure !== undefined) throw failure;
      return environment;
    }
    await Bun.sleep(5);
  }
}

/** Races `exited` against a deadline so a stuck child fails instead of hanging. */
async function expectExitWithin(
  handle: AgentProcessHandle,
  timeoutMs: number,
): Promise<{ code: number | null; signal: string | null; success: boolean }> {
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => deadline.reject(new Error(`child did not exit within ${timeoutMs} ms`)), timeoutMs);
  try {
    return await Promise.race([handle.exited, deadline.promise]);
  } finally {
    clearTimeout(timer);
  }
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "poc-process-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

afterEach(async () => {
  for (const handle of live) {
    await terminateAgentProcess(handle).catch(() => undefined);
  }
  live = [];
  for (const pid of survivors) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  survivors = new Set();
});

test("PROC-01: a stalled consumer stops the producer and bounds parent RSS", async () => {
  const totalBytes = 268435456;
  const progressFile = join(scratch, "progress-01");
  const { command, args } = childCommand("producer.ts", String(totalBytes), progressFile);

  const rssBefore = process.memoryUsage().rss;
  const handle = start(command, args);
  const reader = handle.stdout.getReader();
  const first = await reader.read();
  expect(first.done).toBe(false);
  const firstBytes = first.value?.byteLength ?? 0;

  await Bun.sleep(200);
  const progress200 = readProgress(progressFile);
  const rss200 = process.memoryUsage().rss;
  await Bun.sleep(800);
  const progress1000 = readProgress(progressFile);
  const rss1000 = process.memoryUsage().rss;

  // The producer must have made progress, must not have finished, and must have
  // stopped advancing once nothing consumed its output.
  expect(progress200).toBeGreaterThan(0);
  expect(progress200).toBeLessThan(totalBytes);
  expect(progress1000).toBe(progress200);
  expect(Math.max(rss200, rss1000) - rssBefore).toBeLessThan(32 * MIB);

  let restBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    restBytes += value.byteLength;
  }
  const exit = await handle.exited;

  expect(firstBytes + restBytes).toBe(totalBytes);
  expect(readProgress(progressFile)).toBe(totalBytes);
  expect(exit.code).toBe(0);
});

test("PROC-02: a write to a child that is not reading stays pending", async () => {
  const handle = start("sh", ["-c", "sleep 2; cat > /dev/null"]);
  const writer = handle.stdin.getWriter();

  const write = writer.write(new Uint8Array(16 * MIB));
  const outcome = await Promise.race([
    write.then(() => "done" as const),
    Bun.sleep(500).then(() => "pending" as const),
  ]);
  expect(outcome).toBe("pending");

  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => deadline.reject(new Error("16 MiB write did not complete within 30 s")),
    30_000,
  );
  try {
    await Promise.race([write, deadline.promise]);
  } finally {
    clearTimeout(timer);
  }

  await writer.close();
  const exit = await expectExitWithin(handle, 30_000);
  expect(exit.code).toBe(0);
});

test("PROC-03: 64 MiB round trips through cat byte-identically", async () => {
  const handle = start("cat");
  const writer = handle.stdin.getWriter();
  const totalBytes = 64 * MIB;
  const inputHash = createHash("sha256");
  const outputBytes = drain(handle.stdout);

  const writing = (async () => {
    for (let index = 0; index < 64; index++) {
      const chunk = new Uint8Array(MIB).fill(index & 0xff);
      inputHash.update(chunk);
      await writer.write(chunk);
    }
    await writer.close();
  })();

  const [, output] = await Promise.all([writing, outputBytes]);
  const exit = await expectExitWithin(handle, 30_000);

  expect(output.bytes).toBe(totalBytes);
  expect(output.sha256).toBe(inputHash.digest("hex"));
  expect(exit.code).toBe(0);
});

test("PROC-04: stderr drains alongside stdout without stalling", async () => {
  const bytesEach = 8 * MIB;
  const { command, args } = childCommand("dual-writer.ts", String(bytesEach));
  const handle = start(command, args);

  const [stdout, stderr] = await Promise.all([drain(handle.stdout), drain(handle.stderr)]);
  const exit = await expectExitWithin(handle, 30_000);

  expect(stdout.bytes).toBe(bytesEach);
  expect(stderr.bytes).toBe(bytesEach);
  expect(exit.code).toBe(0);
});

test("PROC-05: closing stdin delivers EOF and resolves exited", async () => {
  const handle = start("cat");
  const writer = handle.stdin.getWriter();
  await writer.close();

  const output = await drain(handle.stdout);
  const exit = await handle.exited;

  expect(output.bytes).toBe(0);
  expect(exit.code).toBe(0);
});

test("PROC-06: the child environment holds exactly the passed variables", async () => {
  process.env.AIR_POC_SECRET_TOKEN = "sentinel";
  const env = { PATH: CHILD_ENV.PATH, HOME: "/tmp", AIR_POC_ALLOWED: "yes" };
  const handle = start("sleep", ["30"], env);
  try {
    const childPid = await waitForChild(handle.pid);
    const observed = await waitForEnviron(childPid);

    expect(Object.keys(observed).sort()).toEqual(Object.keys(env).sort());
    expect(observed.PATH).toBe(env.PATH);
    expect(observed.HOME).toBe("/tmp");
    expect(observed.AIR_POC_ALLOWED).toBe("yes");
    expect(observed.AIR_POC_SECRET_TOKEN).toBeUndefined();
  } finally {
    delete process.env.AIR_POC_SECRET_TOKEN;
  }
});

test("PROC-07: SIGTERM through dumb-init ends the wrapper and its child", async () => {
  const handle = start("sleep", ["60"]);
  const childPid = await waitForChild(handle.pid);

  const result = await terminateAgentProcess(handle);
  await handle.exited;

  expect(result.escalated).toBe(false);
  expect(result.elapsedMs).toBeLessThan(2000);
  expect(isAlive(handle.pid)).toBe(false);
  expect(isAlive(childPid)).toBe(false);
});

test("PROC-08: SIGKILL follows the 2000 ms grace timer", async () => {
  const handle = start("sh", ["-c", 'trap "" TERM; sleep 60']);
  await waitForChild(handle.pid);
  // Give the shell time to start the grandchild the SIGKILL corner strands.
  await Bun.sleep(300);
  const recorded = descendantsOf(handle.pid);
  expect(recorded.length).toBeGreaterThan(0);

  const started = performance.now();
  const result = await terminateAgentProcess(handle);
  const observedBy = performance.now() - started;
  const exit = await handle.exited;

  expect(result.escalated).toBe(true);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(1990);
  expect(result.elapsedMs).toBeLessThanOrEqual(2500);
  expect(observedBy).toBeLessThanOrEqual(2500);
  expect(exit.signal).toBe("SIGKILL");

  // The wrapper is SIGKILLed, so its children are reparented away: liveness must
  // be judged on the PIDs recorded before the kill.
  const alive = recorded.filter((pid) => isAlive(pid));
  observe("sigkillSurvivors", alive.length);
  for (const pid of alive) survivors.add(pid);
});

test("PROC-09: twenty spawn and teardown cycles leave no residue", async () => {
  const before = openFdCount();
  const spawned: number[] = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    const handle = start("sleep", ["60"]);
    spawned.push(handle.pid, await waitForChild(handle.pid));
    await terminateAgentProcess(handle);
    await handle.exited;
    // Let the event loop release the parent-side pipe descriptors of the cycle.
    await Bun.sleep(20);
  }

  expect(Math.abs(openFdCount() - before)).toBeLessThanOrEqual(2);
  const alive = spawned.filter((pid) => isAlive(pid));
  for (const pid of alive) survivors.add(pid);
  expect(alive).toEqual([]);
});
