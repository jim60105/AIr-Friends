/**
 * `/proc` observations for the agent process boundary suite: process tree,
 * liveness, real environment and descriptor accounting.
 *
 * `dumb-init` forks after `spawn` returns, so a test obtains the real child
 * through `waitForChild`, never through `descendantsOf(...)[0]` directly. All
 * `/proc/<n>/stat` parsing happens after the LAST `)` so a process name that
 * contains spaces cannot shift the fields.
 */
import { readFileSync, readdirSync } from "node:fs";

interface StatFields {
  state: string;
  ppid: number;
}

const CHILD_POLL_MS = 10;

function readStat(pid: number): StatFields | null {
  let raw: string;
  try {
    raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    // The process exited between the directory scan and the read.
    return null;
  }
  const close = raw.lastIndexOf(")");
  if (close < 0) return null;
  const fields = raw.slice(close + 2).split(" ");
  const state = fields[0];
  const ppid = Number.parseInt(fields[1] ?? "", 10);
  if (state === undefined || Number.isNaN(ppid)) return null;
  return { state, ppid };
}

/** True when the PID exists and is neither a zombie nor dead. */
export function isAlive(pid: number): boolean {
  const stat = readStat(pid);
  return stat !== null && stat.state !== "Z" && stat.state !== "X";
}

/** Every live-or-zombie descendant of `pid`, breadth first. */
export function descendantsOf(pid: number): number[] {
  const children = new Map<number, number[]>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const childPid = Number(entry);
    const stat = readStat(childPid);
    if (stat === null) continue;
    const siblings = children.get(stat.ppid) ?? [];
    siblings.push(childPid);
    children.set(stat.ppid, siblings);
  }

  const descendants: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (child === pid) continue;
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

/** The child's real environment, from `/proc/<pid>/environ` split on NUL. */
export function readEnviron(pid: number): Record<string, string> {
  const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
  const environment: Record<string, string> = {};
  for (const entry of raw.split("\0")) {
    if (entry === "") continue;
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
}

/** The parent's own open descriptor count. */
export function openFdCount(): number {
  return readdirSync("/proc/self/fd").length;
}

/**
 * Polls for `dumb-init`'s child, whose PID is unknowable before the fork.
 * Resolves with the first descendant seen.
 */
export async function waitForChild(pid: number, timeoutMs: number = 2000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [child] = descendantsOf(pid);
    if (child !== undefined) return child;
    if (Date.now() >= deadline) {
      throw new Error(`no child of ${pid} appeared within ${timeoutMs} ms`);
    }
    await Bun.sleep(CHILD_POLL_MS);
  }
}
