// src/core/agent-process-pool.ts
//
// Shared `opencode acp` process pool + global execution-lease serialization.
//
// In shared-process mode the bot keeps one long-lived agent process per pool key:
//   - message / channel-lurk sessions: `{platform}:{channelId}`
//   - spontaneous-post sessions: the scheduler's target channel (e.g. `dm:{userId}`)
//   - self-research sessions: `self-research:{userId}`
//   - memory-maintenance sessions: `memory-maintenance:{workspaceKey}`
//
// Exactly one agent session executes at any time (single-bot-persona semantics).
// Waiting sessions sit in two FIFO lanes (interactive before maintenance, with a
// starvation guard). Each pool entry carries a generation counter and a `reclaiming`
// state so a concurrent acquire is deferred until the old process fully exits.

import { createLogger } from "@utils/logger.ts";
import { AgentConnector } from "@acp/agent-connector.ts";
import type { AgentConnectorOptions } from "@acp/types.ts";
import {
  deleteSessionJwtFile,
  issueSessionJwtFile,
  resolveSkillJwtDir,
  SKILL_JWT_TTL_SEC,
} from "@utils/skill-jwt.ts";
import { atomicWritePrivate } from "@utils/skill-secret.ts";
import type { Config } from "../types/config.ts";
import type { SessionRegistry } from "../skill-api/session-registry.ts";
import { join, resolve } from "@std/path";

const logger = createLogger("AgentProcessPool");

/** Default reclaim idle time: 30 minutes (aligns with the session idle TTL). */
const DEFAULT_RECLAIM_IDLE_MS = 30 * 60 * 1000;

/** Default queue deadline: 10 minutes. */
const DEFAULT_QUEUE_DEADLINE_MS = 10 * 60 * 1000;

/** Poll interval for child-process drain and queue-deadline checks. */
const POLL_INTERVAL_MS = 30_000;

/** Starvation guard: allow one maintenance job after every N interactive sessions. */
const MAINTENANCE_STARVE_LIMIT = 4;

/** Bounded wait for the agent's child processes to exit before clearing the pointer. */
const CHILD_DRAIN_TIMEOUT_MS = 5_000;
/** Budget for the post-timeout TERM/KILL rounds (re-enumerated each round). */
const CHILD_KILL_WINDOW_MS = 4_000;

export type SessionPriority = "interactive" | "maintenance";

export interface PoolRunOptions {
  poolKey: string;
  sessionType: string;
  /** Shell (Skill API) session id — used for the per-session JWT + pointer. */
  shellSessionId: string | null;
  /** The ACP session id (returned by the runner) for possible `session/load` recovery. */
  priority: SessionPriority;
  /** Connector options used to (lazily) spawn the pool key's process. */
  connectorOptions: AgentConnectorOptions;
  /** Session-scoped working directory (per-user workspace) for ACP `newSession.cwd`. */
  sessionCwd: string;
}

interface PoolEntry {
  poolKey: string;
  connector: AgentConnector;
  refCount: number;
  lastActivity: number;
  generation: number;
  reclaiming: boolean;
  reclaimTimer?: ReturnType<typeof setTimeout>;
  processPid?: number;
}

interface QueuedSession {
  options: PoolRunOptions;
  runner: (connector: AgentConnector, options: PoolRunOptions) => Promise<string | undefined>;
  queuedAt: number;
  /** Set by `run()` before the session is served; invoked exactly once with the ACP session id. */
  resolveResult?: (acpSessionId: string | undefined, cancelledByDeadline: boolean) => void;
}

export interface PoolRunResult {
  /** The ACP session id (for recovery) or null when no ACP session was created. */
  acpSessionId: string | null;
  /** True when the session was cancelled by the queue deadline while still queued. */
  cancelledByDeadline: boolean;
}

/**
 * Shared ACP process pool with global execution-lease serialization.
 */
export class AgentProcessPool {
  private entries: Map<string, PoolEntry> = new Map();
  private inFlight: QueuedSession | null = null;
  private interactiveQueue: QueuedSession[] = [];
  private maintenanceQueue: QueuedSession[] = [];
  private interactiveSinceMaintenance = 0;
  private queueSweeper?: ReturnType<typeof setInterval>;
  private config: Config;
  private sessionRegistry: SessionRegistry;
  private skillApiSecret: string;
  private jwtDir: string;
  private reclaimIdleMs: number;
  private queueDeadlineMs: number;
  /**
   * Factory for the pool-key agent connector. Injectable so tests can stub the
   * AgentConnector (real `connect()` would spawn the `opencode` binary).
   */
  private connectorFactory: (options: AgentConnectorOptions) => AgentConnector;
  private jwtRenewalIntervalMs: number;

  constructor(
    config: Config,
    sessionRegistry: SessionRegistry,
    skillApiSecret: string,
    connectorFactory: ((options: AgentConnectorOptions) => AgentConnector) | null = null,
    sweepIntervalMs: number = POLL_INTERVAL_MS,
    jwtRenewalIntervalMs: number = (SKILL_JWT_TTL_SEC * 1000) / 2,
  ) {
    this.config = config;
    this.sessionRegistry = sessionRegistry;
    this.skillApiSecret = skillApiSecret;
    this.connectorFactory = connectorFactory ?? ((options) => new AgentConnector(options));
    this.jwtRenewalIntervalMs = jwtRenewalIntervalMs;
    const sp = config.agent.sharedProcess;
    this.jwtDir = resolveSkillJwtDir(sp?.jwtDir);
    this.reclaimIdleMs = sp?.reclaimIdleMs ?? DEFAULT_RECLAIM_IDLE_MS;
    this.queueDeadlineMs = sp?.queueDeadlineMs ?? DEFAULT_QUEUE_DEADLINE_MS;
    this.queueSweeper = setInterval(() => {
      this.sweepQueueDeadlines();
    }, sweepIntervalMs);
  }

  /**
   * Queue a session and run it once the global lease is free.
   * The runner performs the session's ACP lifecycle on the pool key's shared
   * connector and returns the ACP session id.
   */
  async run(
    options: PoolRunOptions,
    runner: (connector: AgentConnector, options: PoolRunOptions) => Promise<string | undefined>,
  ): Promise<PoolRunResult> {
    const item: QueuedSession = { options, runner, queuedAt: Date.now() };
    // Wire the result resolver BEFORE the item is queued, so a session that
    // starts immediately (lease free) still resolves its promise.
    return await new Promise<PoolRunResult>((resolve) => {
      item.resolveResult = (acpSessionId, cancelledByDeadline) => {
        resolve({ acpSessionId: acpSessionId ?? null, cancelledByDeadline });
      };
      // Queue-activity touch (spec): a queued session is excluded from the
      // registry idle reaper while it waits — the sweeper keeps refreshing it.
      if (options.shellSessionId) {
        this.sessionRegistry.touch(options.shellSessionId);
      }
      (options.priority === "interactive" ? this.interactiveQueue : this.maintenanceQueue).push(
        item,
      );
      this.serviceQueue();
    });
  }

  /** Serve the FIFO lanes: interactive first, with the starvation guard. */
  private serviceQueue(): void {
    if (this.inFlight !== null) return;

    // Starvation guard: after MAINTENANCE_STARVE_LIMIT interactive sessions have
    // run back-to-back, a waiting maintenance job is served BEFORE the next
    // interactive one, even while the interactive lane still has work.
    let next: QueuedSession | null = null;
    while (next === null) {
      if (
        this.maintenanceQueue.length > 0 &&
        this.interactiveSinceMaintenance >= MAINTENANCE_STARVE_LIMIT
      ) {
        next = this.maintenanceQueue.shift()!;
        this.interactiveSinceMaintenance = 0;
      } else if (this.interactiveQueue.length > 0) {
        next = this.interactiveQueue.shift()!;
        this.interactiveSinceMaintenance++;
      } else if (this.maintenanceQueue.length > 0) {
        next = this.maintenanceQueue.shift()!;
        this.interactiveSinceMaintenance = 0;
      } else {
        return;
      }
      // A picked item may have aged past its deadline since the last sweep
      // (the sweeper is only periodic): cancel it instead of starting it.
      if (Date.now() - next.queuedAt >= this.queueDeadlineMs) {
        const expired = next;
        if (expired.options.shellSessionId) {
          this.sessionRegistry.remove(expired.options.shellSessionId);
        }
        expired.resolveResult?.(undefined, true);
        logger.warn(
          "Queue deadline exceeded for session {sessionId} before dispatch",
          { sessionId: expired.options.shellSessionId },
        );
        next = null;
      }
    }

    if (next === null) return;

    this.inFlight = next;
    this.executeInFlight(next).catch((error) => {
      logger.error("In-flight pool session failed: {error}", {
        poolKey: next.options.poolKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => {
      this.inFlight = null;
      this.serviceQueue();
    });
  }

  /** Run the in-flight session under the lease: acquire process, issue JWT + pointer, run, then the single release path. */
  private async executeInFlight(item: QueuedSession): Promise<void> {
    const { options } = item;
    let entry: PoolEntry | undefined;
    let jwtRenewal: ReturnType<typeof setInterval> | undefined;
    let renewalActive = false;
    const pendingRenewals = new Set<Promise<void>>();
    try {
      // Keep queued/in-flight sessions alive against the registry idle reaper.
      if (options.shellSessionId) {
        this.sessionRegistry.touch(options.shellSessionId);
      }

      entry = await this.acquireProcess(options.poolKey, options.connectorOptions);
      entry.refCount++;
      entry.lastActivity = Date.now();

      // Issue (or re-issue) the per-session JWT with a fresh `exp`, written
      // atomically (temp file, chmod 0600, rename) to {jwtDir}/{sessionId}.jwt.
      if (options.shellSessionId) {
        await this.issueSessionJwt(options);
        // Write the current-session pointer ONLY while this session holds the lease.
        await this.writeActivePointer(
          options.shellSessionId,
          this.sessionRegistry.get(options.shellSessionId)?.workspace.tmpPath,
        );
        // Spec: if the same lease outlives the JWT `exp`, re-issue with a fresh
        // `exp` within the lease. Renew at half the TTL until the release path.
        // The renewal also touches the registry session so the idle reaper does
        // not reap a long active lease that makes no skill HTTP calls.
        renewalActive = true;
        jwtRenewal = setInterval(() => {
          if (!renewalActive) return;
          this.sessionRegistry.touch(options.shellSessionId!);
          // Every renewal is tracked; a renewal slower than the interval must
          // still be awaited before the release deletes the JWT file.
          const renewal = this.issueSessionJwt(options).catch((error) => {
            logger.warn("JWT renewal failed for {sessionId}: {error}", {
              sessionId: options.shellSessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          pendingRenewals.add(renewal);
          renewal.finally(() => pendingRenewals.delete(renewal));
        }, this.jwtRenewalIntervalMs);
      }

      const acpSessionId = await item.runner(entry.connector, options);

      item.resolveResult?.(acpSessionId, false);
    } catch (error) {
      // Acquire or runner failure still resolves the `run()` promise (as a
      // deadline-cancelled run) so callers never hang.
      item.resolveResult?.(undefined, true);
      throw error;
    } finally {
      // Stop renewals and await EVERY renewal already past its await point (no
      // await between the flag clear and clearInterval), so a late or stalled
      // renewal can never resurrect the JWT file after the release deletes it.
      renewalActive = false;
      if (jwtRenewal !== undefined) clearInterval(jwtRenewal);
      if (pendingRenewals.size > 0) {
        await Promise.allSettled([...pendingRenewals]);
      }
      // Single release path, spec order: (1) wait (bounded) for the agent's tool
      // children (skill scripts) to exit — a late-starting backgrounded script must
      // still see ITS OWN session's pointer/JWT, so the clear comes AFTER the drain;
      // (2) owner-validated pointer clear; (3) JWT file deletion; (4) refcount
      // release + reclaim scheduling only after everything above, so a reclaim
      // never races the drain or kills the shared process mid-release.
      if (entry) {
        entry.lastActivity = Date.now();
        // Refresh the tracked PID: the runner may have re-spawned the connector
        // (session/load recovery), so the drain must target the CURRENT process.
        const currentPid = entry.connector.getProcessPid();
        if (currentPid !== undefined) {
          entry.processPid = currentPid;
        }
        if (entry.processPid) {
          const drained = await this.waitForChildProcesses(
            entry.processPid,
            CHILD_DRAIN_TIMEOUT_MS,
          );
          if (drained === "killed") {
            logger.info("Killed agent tool-child process tree after drain timeout", {
              pid: entry.processPid,
              timeoutMs: CHILD_DRAIN_TIMEOUT_MS,
            });
          }
        }
        if (options.shellSessionId) {
          await this.clearActivePointer(options.shellSessionId);
          await this.deleteSessionJwt(options.shellSessionId);
        }
        entry.refCount--;
        if (entry.refCount === 0) {
          this.scheduleReclaim(entry);
        }
      }
    }
  }

  /** Lazy-spawn or reuse the pool key's live process (generation-checked). */
  private async acquireProcess(
    poolKey: string,
    connectorOptions: AgentConnectorOptions,
  ): Promise<PoolEntry> {
    let entry = this.entries.get(poolKey);

    // A reclaim in progress blocks new acquires until the old process fully exits
    // (same-generation check) — this prevents two opencode processes from opening
    // the same channel-scoped data root at once.
    if (entry?.reclaiming) {
      await entry.connector.disconnect();
      // Identity check: a concurrent acquire may already have removed the
      // reclaiming entry and installed a fresh one — never evict that.
      if (this.entries.get(poolKey) === entry) {
        this.entries.delete(poolKey);
        entry = undefined;
      } else {
        entry = this.entries.get(poolKey);
      }
      if (!entry) return this.acquireProcess(poolKey, connectorOptions);
    }

    // A dead process (crash, the drain-timeout tree-kill, or an external kill)
    // leaves the entry's connector looking connected; verify liveness before
    // reusing it — re-spawn a fresh connector instead.
    if (
      entry && (!entry.connector.isConnected ||
        (entry.processPid !== undefined && !(await processAlive(entry.processPid))))
    ) {
      await entry.connector.disconnect();
      if (this.entries.get(poolKey) === entry) {
        this.entries.delete(poolKey);
        entry = undefined;
      } else {
        // A concurrent acquire already replaced it — reuse the replacement.
        entry = this.entries.get(poolKey);
      }
    }

    if (entry) {
      entry.reclaimTimer && clearTimeout(entry.reclaimTimer);
      entry.lastActivity = Date.now();
      return entry;
    }

    // Lazy spawn: create a fresh connector and connect (spawn the subprocess).
    // The connector spawns `dumb-init -- opencode acp` with cwd = the pool key's
    // channel-cwd directory, so those channel-scoped directories must exist first.
    await this.ensureSharedDirs(poolKey);
    const connector = this.connectorFactory(connectorOptions);
    await connector.connect();
    entry = {
      poolKey,
      connector,
      refCount: 0,
      lastActivity: Date.now(),
      generation: 1,
      reclaiming: false,
      processPid: connector.getProcessPid(),
    };
    this.entries.set(poolKey, entry);
    logger.info("Spawning shared agent process for pool key {poolKey}", { poolKey });
    return entry;
  }

  /** Schedule a refcount-based reclaim (re-checked under the pool lock on fire). */
  private scheduleReclaim(entry: PoolEntry): void {
    if (entry.reclaimTimer) clearTimeout(entry.reclaimTimer);
    entry.reclaimTimer = setTimeout(async () => {
      const current = this.entries.get(entry.poolKey);
      // Same-generation check: the timer may fire after the entry was replaced.
      if (!current || current.generation !== entry.generation) return;
      if (current.refCount > 0) {
        this.scheduleReclaim(current);
        return;
      }
      current.reclaiming = true;
      current.generation++;
      try {
        await current.connector.disconnect();
        // Identity check: if a concurrent acquire already replaced this entry,
        // do not evict the replacement (it is a live, leased process).
        if (this.entries.get(current.poolKey) === current) {
          this.entries.delete(current.poolKey);
        }
        logger.info("Reclaimed idle agent process for pool key {poolKey}", {
          poolKey: current.poolKey,
          idleMs: Date.now() - current.lastActivity,
        });
      } catch (error) {
        logger.error("Failed to reclaim agent process for {poolKey}: {error}", {
          poolKey: current.poolKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.reclaimIdleMs);
  }

  /**
   * Create the pool key's channel-scoped directories (process cwd, shell TMPDIR,
   * OpenCode data root) under the bot data root. Without these, the connector's
   * `dumb-init` spawn fails with "No such cwd" and OpenCode cannot write session
   * state for `session/load` recovery.
   */
  private async ensureSharedDirs(poolKey: string): Promise<void> {
    const dataRoot = this.config.workspace?.repoPath;
    if (!dataRoot) return;
    for (const sub of ["channel-cwd", "channel-tmp", "opencode-data"]) {
      // Resolve lexically so the created directory string is byte-identical to
      // the absolute paths exported into the agent process env (proposal:
      // reader and writer always agree, independent of the process cwd).
      await Deno.mkdir(resolve(join(dataRoot, sub, poolKey)), { recursive: true });
    }
  }

  /** Issue (or re-issue) the owning session's JWT at lease acquisition. */
  private async issueSessionJwt(options: PoolRunOptions): Promise<void> {
    await issueSessionJwtFile({
      jwtDir: this.jwtDir,
      secret: this.skillApiSecret,
      registry: this.sessionRegistry,
      sessionId: options.shellSessionId!,
    });
  }

  /**
   * Write the current-session pointer file (only while the session holds the
   * lease). `staging` is the session's workspace tmp root so skill scripts can
   * locate their payload staging dir without trusting the process TMPDIR
   * (which is channel-scoped in shared mode).
   */
  private async writeActivePointer(sessionId: string, staging?: string): Promise<void> {
    await atomicWritePrivate(
      join(this.jwtDir, "active.json"),
      JSON.stringify(staging ? { sessionId, staging } : { sessionId }, null, 2),
    );
  }

  /**
   * Clear the pointer only if its content still equals the releasing session's id
   * (owner validation), so a later session's pointer is never clobbered.
   */
  private async clearActivePointer(sessionId: string): Promise<void> {
    const filePath = join(this.jwtDir, "active.json");
    let current: string | undefined;
    try {
      const raw = await Deno.readTextFile(filePath);
      const parsed = JSON.parse(raw) as { sessionId?: string };
      current = parsed.sessionId;
    } catch {
      current = undefined;
    }
    if (current === sessionId) {
      await atomicWritePrivate(filePath, "");
    }
  }

  /** Delete the session's JWT file when the session ends. */
  private async deleteSessionJwt(sessionId: string): Promise<void> {
    try {
      await deleteSessionJwtFile(this.jwtDir, sessionId);
    } catch (error) {
      logger.warn("Failed to delete session JWT file for {sessionId}: {error}", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Wait (bounded) for the agent's tool processes to exit; on timeout kill ONLY
   * those tool processes (never the dumb-init wrapper or the long-lived agent).
   *
   * The dumb-init wrapper reparents orphans (tool scripts whose intermediate
   * shell exited), so the tool set is: every child of the wrapper EXCEPT the
   * agent itself (identified as the oldest child by process start time — the
   * agent is spawned before any of its tools, while orphans re-parent later),
   * plus all their descendants, plus the agent's own descendants.
   * Returns "drained" or "killed".
   */
  private async waitForChildProcesses(
    wrapperPid: number,
    timeoutMs: number,
  ): Promise<"drained" | "killed"> {
    const wrapperChildren = await listChildPids(wrapperPid);
    if (wrapperChildren.length === 0) return "drained";
    const agentPid = await oldestChildPid(wrapperChildren);
    if (agentPid === undefined) return "drained";

    const deadline = Date.now() + timeoutMs;
    let tools = await collectToolPids(wrapperPid, agentPid);
    while (tools.length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      tools = await collectToolPids(wrapperPid, agentPid);
    }
    if (tools.length === 0) return "drained";
    // Timeout: TERM the tools, then loop re-enumerating before every KILL so
    // children forked between rounds (they reparent into the wrapper) cannot
    // escape, and KILL only fires against PIDs just confirmed to exist.
    await killPids(tools, "TERM");
    const killDeadline = Date.now() + CHILD_KILL_WINDOW_MS;
    let survivors = tools;
    while (Date.now() < killDeadline) {
      await new Promise((r) => setTimeout(r, 500));
      survivors = await collectToolPids(wrapperPid, agentPid);
      if (survivors.length === 0) return "drained";
      await killPids(survivors, "KILL");
    }
    survivors = await collectToolPids(wrapperPid, agentPid);
    if (survivors.length > 0) await killPids(survivors, "KILL");
    return "killed";
  }

  /** Cancel queued sessions that exceeded the queue deadline (single release path). */
  private sweepQueueDeadlines(): void {
    const now = Date.now();
    for (const queue of [this.interactiveQueue, this.maintenanceQueue]) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const item = queue[i];
        const waitedMs = now - item.queuedAt;
        if (waitedMs >= this.queueDeadlineMs) {
          queue.splice(i, 1);
          if (item.options.shellSessionId) {
            this.sessionRegistry.remove(item.options.shellSessionId);
          }
          item.resolveResult?.(undefined, true);
          logger.warn(
            "Queue deadline exceeded for session {sessionId} after {waitedMs}ms",
            { sessionId: item.options.shellSessionId, waitedMs },
          );
        } else if (item.options.shellSessionId) {
          // Queue-activity touch (spec): still-queued sessions stay excluded
          // from the registry idle reaper while they wait for the lease.
          this.sessionRegistry.touch(item.options.shellSessionId);
        }
      }
    }
  }

  /**
   * Whether no session currently holds the execution lease. `inFlight` is nulled
   * in the `finally` block, i.e. AFTER the release path (pointer clear, JWT
   * delete, child-process drain) has completed. Tests use this to wait for
   * full release before stopping the pool (keeps Deno leak tracking clean).
   */
  isIdle(): boolean {
    return this.inFlight === null;
  }

  /** Stop the queue sweeper (called on shutdown). */
  stop(): void {
    if (this.queueSweeper) {
      clearInterval(this.queueSweeper);
      this.queueSweeper = undefined;
    }
    for (const entry of this.entries.values()) {
      if (entry.reclaimTimer) clearTimeout(entry.reclaimTimer);
    }
  }
}

/** List the direct child PIDs of a process (via `pgrep -P`); empty when none. */
async function listChildPids(pid: number): Promise<number[]> {
  try {
    const out = await new Deno.Command("pgrep", { args: ["-P", String(pid)] }).output();
    if (!out.success) return [];
    const text = new TextDecoder().decode(out.stdout);
    return text
      .trim()
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => parseInt(l.trim(), 10));
  } catch {
    return [];
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
 * own tool subtree). The agent itself is never included.
 */
async function collectToolPids(wrapperPid: number, agentPid: number): Promise<number[]> {
  const children = await listChildPids(wrapperPid);
  const tools: number[] = children.filter((p) => p !== agentPid);
  for (const child of children) {
    tools.push(...await collectDescendantPids(child));
  }
  return tools;
}

/** Whether a process is still alive (`kill -0`). */
async function processAlive(pid: number): Promise<boolean> {
  try {
    const out = await new Deno.Command("kill", { args: ["-0", String(pid)] }).output();
    return out.code === 0;
  } catch {
    return false;
  }
}

/** Send a signal to an explicit PID set (best-effort, non-fatal). */
async function killPids(pids: number[], signal: "TERM" | "KILL"): Promise<void> {
  for (const p of pids) {
    try {
      await new Deno.Command("kill", { args: [`-${signal}`, String(p)] }).output();
    } catch {
      // Process already exited — fine.
    }
  }
}

/** Recursively collect all descendant PIDs of a process (BFS over direct children). */
async function collectDescendantPids(pid: number): Promise<number[]> {
  const all: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await listChildPids(current);
    for (const child of children) {
      all.push(child);
      queue.push(child);
    }
  }
  return all;
}
