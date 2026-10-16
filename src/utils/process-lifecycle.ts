// src/utils/process-lifecycle.ts
//
// Shared bounded observation of one agent process wrapper and its tool-child
// tree. Extracted from the shared ACP process pool so that per-spawn teardown
// and pooled release answer the same question the same way: can this producer
// be declared quiescent, or must its workspace keep its cleanup protection?
//
// The dumb-init wrapper reparents orphans (tool scripts whose intermediate
// shell exited), so the tool set is: every child of the wrapper EXCEPT the
// agent itself (identified as the oldest child by process start time — the
// agent is spawned before any of its tools, while orphans re-parent later),
// plus all their descendants. The agent itself is never drained or killed.
//
// Quiescence is only reported on a POSITIVE observation: a live wrapper whose
// complete tool tree was enumerated as empty. A missing observation (the
// wrapper is gone, or any level of the enumeration failed) and a surviving
// child are uncertain teardown, never success — the caller must retain the
// workspace's cleanup protection instead of reclaiming files a tool child may
// still be reading.

import { createLogger } from "@utils/logger.ts";

const logger = createLogger("ProcessLifecycle");

/** Bounded wait for the agent's tool children to exit before clearing the pointer. */
export const CHILD_DRAIN_TIMEOUT_MS = 5_000;
/** Budget for the post-timeout TERM/KILL rounds (re-enumerated each round). */
export const CHILD_KILL_WINDOW_MS = 4_000;
/** Poll interval while waiting for tool children to exit on their own. */
const DRAIN_POLL_INTERVAL_MS = 50;
/** Poll interval for the post-timeout TERM/KILL rounds. */
const KILL_POLL_INTERVAL_MS = 500;

/** Why a producer's quiescence could not be established. */
export type ChildQuiescenceUncertainty =
  /** The wrapper PID could not be observed (process gone or unreadable). */
  | "wrapper-not-observable"
  /** A child/descendant enumeration failed; the tool set is unknown. */
  | "enumeration-failed"
  /** Tool processes were still observable after the TERM/KILL window. */
  | "survivors-remain"
  /**
   * A recovery re-spawn replaced the wrapper this producer was observed on, so
   * the discarded generation's tool children were never drained.
   */
  | "superseded-generation";

/** The conservative result of one bounded child-drain attempt. */
export type ChildQuiescenceVerdict =
  | {
    status: "quiescent";
    /** `no-child` — the live wrapper had no children; `drained` — children exited on
     * their own; `terminated` — children had to be TERM/KILLed first. */
    drained: "no-child" | "drained" | "terminated";
  }
  | { status: "uncertain"; reason: ChildQuiescenceUncertainty };

/**
 * Injectable seams for the observation primitives and their timing. Tests use
 * them to drive disappearance, enumeration failure and survivor cases
 * deterministically instead of racing real processes.
 */
export interface ChildDrainDeps {
  /** Direct child PIDs of a process, distinguishing "none" from "unknown". */
  listChildPids(pid: number): Promise<{ ok: boolean; pids: number[] }>;
  /** Whether a process is still alive. */
  processAlive(pid: number): Promise<boolean>;
  /** Send a signal to an explicit PID set (best-effort, non-fatal). */
  killPids(pids: number[], signal: "TERM" | "KILL"): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface ChildDrainOptions {
  drainTimeoutMs?: number;
  killWindowMs?: number;
  drainPollIntervalMs?: number;
  killPollIntervalMs?: number;
  /** Partial override of the observation primitives. */
  deps?: Partial<ChildDrainDeps>;
}

/** Whether a process is still alive (`kill -0`). */
export async function processAlive(pid: number): Promise<boolean> {
  try {
    const out = await new Deno.Command("kill", { args: ["-0", String(pid)] }).output();
    return out.code === 0;
  } catch {
    return false;
  }
}

/**
 * Wait (bounded) for the wrapper's tool processes to exit; on timeout kill ONLY
 * those tool processes (never the wrapper or the long-lived agent). Returns the
 * conservative quiescence verdict; never throws.
 */
export async function awaitChildQuiescence(
  wrapperPid: number,
  options: ChildDrainOptions = {},
): Promise<ChildQuiescenceVerdict> {
  const deps: ChildDrainDeps = {
    listChildPids,
    processAlive,
    killPids,
    sleep: (ms: number) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, ms);
      return promise;
    },
    ...options.deps,
  };
  const drainTimeoutMs = options.drainTimeoutMs ?? CHILD_DRAIN_TIMEOUT_MS;
  const killWindowMs = options.killWindowMs ?? CHILD_KILL_WINDOW_MS;

  // The wrapper must be observable BEFORE any snapshot is trusted: children of an
  // exited wrapper re-parent away, so an empty list would not prove absence.
  if (!(await deps.processAlive(wrapperPid))) {
    logger.debug("Wrapper {pid} could not be observed — teardown is uncertain", {
      pid: wrapperPid,
    });
    return { status: "uncertain", reason: "wrapper-not-observable" };
  }

  // An empty observation is only evidence while the wrapper it was taken from is
  // STILL observable: if the wrapper exited between the check above and the
  // enumeration, its children re-parented away and "no children" says nothing
  // about whether they finished. Re-check before trusting either empty snapshot.
  const quiescentFromEmpty = async (
    drained: "no-child" | "drained",
  ): Promise<ChildQuiescenceVerdict> => {
    if (!(await deps.processAlive(wrapperPid))) {
      logger.debug(
        "Wrapper {pid} disappeared before its empty tool observation was trusted — teardown is uncertain",
        { pid: wrapperPid },
      );
      return { status: "uncertain", reason: "wrapper-not-observable" };
    }
    return { status: "quiescent", drained };
  };

  const children = await deps.listChildPids(wrapperPid);
  if (!children.ok) {
    logger.warn("Child enumeration failed for wrapper {pid} — teardown is uncertain", {
      pid: wrapperPid,
    });
    return { status: "uncertain", reason: "enumeration-failed" };
  }
  if (children.pids.length === 0) return await quiescentFromEmpty("no-child");
  const agentPid = await oldestChildPid(children.pids);

  // Bounded wait for the tool processes to exit on their own.
  const deadline = Date.now() + drainTimeoutMs;
  let tools = await collectToolPids(wrapperPid, agentPid, deps);
  if (!tools.ok) {
    logger.warn("Tool-tree enumeration failed for wrapper {pid} — teardown is uncertain", {
      pid: wrapperPid,
    });
    return { status: "uncertain", reason: "enumeration-failed" };
  }
  while (tools.pids.length > 0 && Date.now() < deadline) {
    await deps.sleep(options.drainPollIntervalMs ?? DRAIN_POLL_INTERVAL_MS);
    if (!(await deps.processAlive(wrapperPid))) {
      return { status: "uncertain", reason: "wrapper-not-observable" };
    }
    tools = await collectToolPids(wrapperPid, agentPid, deps);
    if (!tools.ok) return { status: "uncertain", reason: "enumeration-failed" };
  }
  if (tools.pids.length === 0) return await quiescentFromEmpty("drained");

  // Timeout: TERM the tools, then loop re-enumerating before every KILL so
  // children forked between rounds (they reparent into the wrapper) cannot
  // escape, and KILL only fires against PIDs just confirmed to exist.
  await deps.killPids(tools.pids, "TERM");
  const killDeadline = Date.now() + killWindowMs;
  while (Date.now() < killDeadline) {
    await deps.sleep(options.killPollIntervalMs ?? KILL_POLL_INTERVAL_MS);
    if (!(await deps.processAlive(wrapperPid))) {
      return { status: "uncertain", reason: "wrapper-not-observable" };
    }
    const snapshot = await collectToolPids(wrapperPid, agentPid, deps);
    if (!snapshot.ok) return { status: "uncertain", reason: "enumeration-failed" };
    if (snapshot.pids.length === 0) return { status: "quiescent", drained: "terminated" };
    await deps.killPids(snapshot.pids, "KILL");
  }

  // Confirm a FINAL empty observation after termination before declaring the
  // producer quiescent: an empty snapshot is only trusted while the wrapper is
  // still observable, and only when the whole tool tree was enumerable.
  if (!(await deps.processAlive(wrapperPid))) {
    return { status: "uncertain", reason: "wrapper-not-observable" };
  }
  let final = await collectToolPids(wrapperPid, agentPid, deps);
  if (!final.ok) return { status: "uncertain", reason: "enumeration-failed" };
  if (final.pids.length === 0) return { status: "quiescent", drained: "terminated" };
  await deps.killPids(final.pids, "KILL");
  if (!(await deps.processAlive(wrapperPid))) {
    return { status: "uncertain", reason: "wrapper-not-observable" };
  }
  final = await collectToolPids(wrapperPid, agentPid, deps);
  if (!final.ok) return { status: "uncertain", reason: "enumeration-failed" };
  if (final.pids.length === 0) return { status: "quiescent", drained: "terminated" };

  logger.warn("Tool processes survived termination for wrapper {pid} — teardown is uncertain", {
    pid: wrapperPid,
    survivors: final.pids.length,
  });
  return { status: "uncertain", reason: "survivors-remain" };
}

/** List the direct child PIDs of a process (via `pgrep -P`). */
async function listChildPids(pid: number): Promise<{ ok: boolean; pids: number[] }> {
  try {
    const out = await new Deno.Command("pgrep", { args: ["-P", String(pid)] }).output();
    if (out.success) {
      const pids = new TextDecoder()
        .decode(out.stdout)
        .trim()
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => parseInt(line.trim(), 10));
      return { ok: true, pids };
    }
    // `pgrep` exits 1 when nothing matched (a positive empty observation); any
    // other exit code is an enumeration failure, not an empty child set.
    if (out.code === 1) return { ok: true, pids: [] };
    return { ok: false, pids: [] };
  } catch {
    return { ok: false, pids: [] };
  }
}

/**
 * The long-lived agent is the OLDEST direct child of the dumb-init wrapper:
 * it is spawned before any tool process, while orphaned tool processes
 * reparent into the wrapper only later. Start times come from /proc (Linux);
 * falls back to the first child when /proc is unavailable.
 */
async function oldestChildPid(pids: number[]): Promise<number | undefined> {
  let oldest: number | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const pid of pids) {
    const start = await procStartTime(pid);
    if (start !== undefined && start < best) {
      best = start;
      oldest = pid;
    }
  }
  return oldest ?? pids[0];
}

/** Process start time (`/proc/<pid>/stat` field 22, clock ticks since boot). */
async function procStartTime(pid: number): Promise<number | undefined> {
  try {
    const stat = await Deno.readTextFile(`/proc/${pid}/stat`);
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
    const fields = afterComm.split(" ");
    // fields[0] is the state (field 3); starttime is field 22 -> index 19.
    const start = Number(fields[19]);
    return Number.isFinite(start) ? start : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tool processes to drain: every child of the wrapper EXCEPT the agent (i.e.
 * reparented orphans) plus all descendants of every wrapper child (the agent's
 * own tool subtree). The agent itself is never included. `ok: false` means at
 * least one enumeration level failed, so the tool set is unknown.
 */
async function collectToolPids(
  wrapperPid: number,
  agentPid: number | undefined,
  deps: ChildDrainDeps,
): Promise<{ ok: boolean; pids: number[] }> {
  const children = await deps.listChildPids(wrapperPid);
  if (!children.ok) return { ok: false, pids: [] };

  const tools = new Set<number>();
  for (const child of children.pids) {
    if (child !== agentPid) tools.add(child);
  }
  for (const child of children.pids) {
    const descendants = await collectDescendantPids(child, deps);
    if (!descendants.ok) return { ok: false, pids: [] };
    for (const descendant of descendants.pids) tools.add(descendant);
  }
  return { ok: true, pids: [...tools].sort((a, b) => a - b) };
}

/** Recursively collect all descendant PIDs of a process (BFS over direct children). */
async function collectDescendantPids(
  pid: number,
  deps: ChildDrainDeps,
): Promise<{ ok: boolean; pids: number[] }> {
  const collected: number[] = [];
  let frontier = [pid];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const current of frontier) {
      const children = await deps.listChildPids(current);
      if (!children.ok) return { ok: false, pids: [] };
      next.push(...children.pids);
    }
    collected.push(...next);
    frontier = next;
  }
  return { ok: true, pids: collected };
}

/** Send a signal to an explicit PID set (best-effort, non-fatal). */
async function killPids(pids: number[], signal: "TERM" | "KILL"): Promise<void> {
  for (const pid of pids) {
    try {
      await new Deno.Command("kill", { args: [`-${signal}`, String(pid)] }).output();
    } catch {
      // Best effort: the process may have exited between enumeration and here.
    }
  }
}
