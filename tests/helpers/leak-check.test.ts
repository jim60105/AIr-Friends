// tests/helpers/leak-check.test.ts
//
// The two spec scenarios of "Integration Suites Leave No Leaked Descriptors Or
// Processes", driven by a real `sleep 30` child: a killed and reaped child
// leaves the descriptor table and the process tree at the measured baseline,
// and a SURVIVING child fails the check while naming its PID.

import { test } from "bun:test";
import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { type ChildProcess, spawn } from "node:child_process";
import { listDescendantPids } from "../../src/utils/process-lifecycle.ts";
import { assertNoLeak, snapshot } from "./leak-check.ts";

/** A small real delay for bounded kernel polling. */
function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Bounded wait for a process's exit (the OS event, never a guessed sleep). */
function onceExited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  child.once("exit", () => resolve());
  return promise;
}

/**
 * Bounded wait until `pid` is observable as a descendant of this test process.
 * A real delay is unavoidable (the sanctioned exception): a spawned kernel
 * process's arrival cannot be driven by a clock we control, so this polls the
 * kernel's own answer with a bounded deadline instead of guessing one sleep.
 */
async function waitForDescendant(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const measured = await listDescendantPids(process.pid);
    if (measured.ok && measured.pids.includes(pid)) return;
    await delay(25);
  }
  throw new Error(`child pid ${pid} was never observed as a descendant of this test process`);
}

/** Start a real long-lived child and wait until it is observable as a descendant. */
async function startSleepChild(stdio: ChildProcess["stdio"]): Promise<ChildProcess> {
  const child = spawn("sleep", ["30"], { stdio });
  assert(child.pid !== undefined, "the sleep child has a pid");
  await waitForDescendant(child.pid);
  return child;
}

/** SIGKILL a real child and await its exit, so the OS has reaped it. */
async function killAndReap(child: ChildProcess): Promise<void> {
  const exited = onceExited(child);
  child.kill("SIGKILL");
  await exited;
}

test("leak check - a killed and reaped child leaves no descriptor or process leak", async () => {
  const before = await snapshot();
  // Piped stdio on purpose: the child's pipes are real descriptors whose
  // closure the checkpoint must observe, not a claim about them.
  const child = await startSleepChild(["pipe", "pipe", "pipe"]);
  try {
    await killAndReap(child);
  } finally {
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  await assertNoLeak(before);
});

test("leak check - a surviving child fails the check and names its pid", async () => {
  const before = await snapshot();
  const child = await startSleepChild("ignore");
  try {
    const failure = await assertRejects(() => assertNoLeak(before, 300), Error);
    assertEquals(failure.name, "AssertionError", "the leak check fails with an AssertionError");
    assertStringIncludes(failure.message, `surviving descendant pid(s) ${child.pid}`);
    assertStringIncludes(failure.message, "open descriptors");
  } finally {
    await killAndReap(child);
  }
});
