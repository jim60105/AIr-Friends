// tests/helpers/leak-check.ts
//
// Real file-descriptor and descendant-process measurement for the agent
// integration suites. Deno's `sanitizeOps`/`sanitizeResources`/`sanitizeExit`
// options have no Bun equivalent, so these suites measure the kernel directly
// instead: the test process's own descriptor table and its live descendant
// tree, read at the start of a test and compared again once that test's
// teardown has finished.

import fs from "node:fs";
import { assert } from "@std/assert";
import { listDescendantPids } from "../../src/utils/process-lifecycle.ts";

/** The measurement a later {@link assertNoLeak} compares against. */
export interface LeakSnapshot {
  /** Open descriptors of the test process when the snapshot was taken. */
  fds: number;
  /** Live descendants of the test process when the snapshot was taken. */
  descendants: number[];
}

/** Default grace for teardown to finish closing descriptors and reaping processes. */
export const LEAK_GRACE_MS = 2000;

/** Poll interval while waiting for the descriptors and the process tree to settle. */
const LEAK_POLL_INTERVAL_MS = 100;

/**
 * Take the measurement {@link assertNoLeak} compares against. It must be called
 * at the start of a test, so descriptors and descendants the test itself
 * creates are part of the comparison, while everything already open at that
 * point (module imports, the test runner) is the baseline.
 */
export async function snapshot(): Promise<LeakSnapshot> {
  const descendants = await listDescendantPids(process.pid);
  // A baseline built from a failed enumeration would be a guess, and a guess
  // cannot decide a leak: fail here instead, where the cause is unambiguous.
  assert(descendants.ok, "descendant enumeration must succeed to form a leak baseline");
  // The kernel's own view of this process's open descriptors.
  return { fds: fs.readdirSync("/proc/self/fd").length, descendants: descendants.pids };
}

/** The assertion message: it names every surviving PID and the descriptor delta. */
function leakReport(before: LeakSnapshot, survivors: number[] | undefined, fds: number): string {
  const processes = survivors === undefined
    ? "the descendant enumeration could not be read"
    : survivors.length === 0
    ? "no surviving descendant"
    : `surviving descendant pid(s) ${survivors.join(", ")}`;
  return `integration teardown leaked: ${processes}; open descriptors ${fds} (baseline ${before.fds})`;
}

/**
 * Assert that the test process has no descendant process and no more open
 * descriptors than `before` measured, polling every 100 ms for up to `graceMs`
 * so a process still being reaped or a descriptor still closing is not read as
 * a leak. An unreadable descendant enumeration is NOT an empty tree: it stays a
 * failure until the deadline, exactly like a surviving process.
 *
 * The poll is the sanctioned real-delay exception: the state it observes is the
 * kernel's own (a reaped PID, a closed descriptor), which no fake clock can
 * produce, so it polls a bounded deadline instead of guessing one sleep.
 */
export async function assertNoLeak(before: LeakSnapshot, graceMs = LEAK_GRACE_MS): Promise<void> {
  const deadline = Date.now() + graceMs;
  for (;;) {
    const measured = await listDescendantPids(process.pid);
    const fds = fs.readdirSync("/proc/self/fd").length;
    if (measured.ok && measured.pids.length === 0 && fds <= before.fds) return;
    if (Date.now() >= deadline) {
      assert(false, leakReport(before, measured.ok ? measured.pids : undefined, fds));
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, LEAK_POLL_INTERVAL_MS);
    await promise;
  }
}

/**
 * Run one test's teardown to completion and THEN the leak check, so shutdown
 * always happens and the measurement always runs — the guarantee Deno's
 * sanitizers gave even when a test threw. The first failure is the one thrown,
 * so a teardown assertion is never replaced by a downstream leak report (and a
 * leak is still reported when teardown itself succeeded).
 */
export async function teardownWithLeakCheck(
  before: LeakSnapshot,
  teardown: () => Promise<void>,
  graceMs = LEAK_GRACE_MS,
): Promise<void> {
  let teardownError: unknown;
  try {
    await teardown();
  } catch (error) {
    teardownError = error;
  }
  try {
    await assertNoLeak(before, graceMs);
  } catch (error) {
    if (teardownError === undefined) throw error;
  }
  if (teardownError !== undefined) throw teardownError;
}
