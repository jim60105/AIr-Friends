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
import type { AgentConnectorOptions, AgentType } from "@acp/types.ts";
import {
  ompNativeCacheForbiddenRoots,
  prepareOmpNativeCacheRoot,
} from "@utils/omp-native-cache.ts";
import {
  deleteSessionJwtFile,
  issueSessionJwtFile,
  resolveSkillJwtDir,
  SKILL_JWT_TTL_SEC,
} from "@utils/skill-jwt.ts";
import { atomicWritePrivate } from "@utils/skill-secret.ts";
import {
  awaitChildQuiescence,
  CHILD_DRAIN_TIMEOUT_MS,
  type ChildQuiescenceVerdict,
  processAlive,
} from "@utils/process-lifecycle.ts";
import type { Config } from "../types/config.ts";
import type { SessionRegistry } from "../skill-api/session-registry.ts";
import type { WorkspaceTmpUnreclaimableSink } from "./workspace-manager.ts";
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

export type SessionPriority = "interactive" | "maintenance";

/** Permission mode for OMP pool process scoping ("restricted" | "native-yolo"). */
export type PoolPermissionMode = "restricted" | "native-yolo";

/**
 * Compute the pool entry key for process map lookups.
 * For OpenCode, returns `poolKey` verbatim.
 * For OMP, returns `${poolKey}:${permissionMode}`.
 */
export function poolEntryKey(
  poolKey: string,
  agentType: AgentType,
  permissionMode: PoolPermissionMode,
): string {
  if (agentType === "omp") {
    return `${poolKey}:${permissionMode}`;
  }
  return poolKey;
}

export interface PoolRunOptions {
  poolKey: string;
  /** Deployment agent type ("opencode" | "omp"). Consumed explicitly; never inferred. */
  agentType: AgentType;
  /** Resolved permission mode ("restricted" | "native-yolo"). Consumed explicitly; never inferred. */
  permissionMode: PoolPermissionMode;
  sessionType: string;
  /** Shell (Skill API) session id — used for the per-session JWT + pointer. */
  shellSessionId: string | null;
  /** Internal ownership identity, independent of external Skill API availability. */
  registrySessionId?: string;
  /** The ACP session id (returned by the runner) for possible `session/load` recovery. */
  priority: SessionPriority;
  /** Connector options used to (lazily) spawn the pool key's process. */
  connectorOptions: AgentConnectorOptions;
  /** Session-scoped working directory (per-user workspace) for ACP `newSession.cwd`. */
  sessionCwd: string;
  /**
   * Absolute owning workspace root. The pool marks its `tmp/` directory
   * unreclaimable for this bot lifetime when pooled producer quiescence cannot
   * be confirmed, so cleanup never races a surviving tool child.
   */
  workspacePath?: string;
}

interface PoolEntry {
  entryKey: string;
  poolKey: string;
  agentType: AgentType;
  permissionMode: PoolPermissionMode;
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
  /**
   * Workspace temporary-use owner (the workspace manager). Used ONLY to retain a
   * workspace's cleanup protection when pooled producer quiescence is uncertain.
   */
  private tmpOwnership: WorkspaceTmpUnreclaimableSink | null;

  constructor(
    config: Config,
    sessionRegistry: SessionRegistry,
    skillApiSecret: string,
    connectorFactory: ((options: AgentConnectorOptions) => AgentConnector) | null = null,
    sweepIntervalMs: number = POLL_INTERVAL_MS,
    jwtRenewalIntervalMs: number = (SKILL_JWT_TTL_SEC * 1000) / 2,
    tmpOwnership: WorkspaceTmpUnreclaimableSink | null = null,
  ) {
    this.config = config;
    this.sessionRegistry = sessionRegistry;
    this.skillApiSecret = skillApiSecret;
    this.connectorFactory = connectorFactory ?? ((options) => new AgentConnector(options));
    this.jwtRenewalIntervalMs = jwtRenewalIntervalMs;
    this.tmpOwnership = tmpOwnership;
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
      if (options.registrySessionId ?? options.shellSessionId) {
        this.sessionRegistry.touch((options.registrySessionId ?? options.shellSessionId)!);
      }
      (options.priority === "interactive" ? this.interactiveQueue : this.maintenanceQueue).push(
        item,
      );
      this.serviceQueue();
    });
  }

  /** Serve the FIFO lanes: interactive first, with the starvation guard. */
  private serviceQueue(): void {
    // Global execution-lease serialization guarantee:
    // Splitting process pools by permission mode preserves single-lease execution.
    // The single `inFlight` slot covers all entries regardless of agentType or
    // permissionMode. Interactive vs maintenance lanes, starvation guard, and
    // release lifecycle remain strictly serialized (verified by preservation tests).
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
        if (expired.options.registrySessionId ?? expired.options.shellSessionId) {
          this.sessionRegistry.remove(
            (expired.options.registrySessionId ?? expired.options.shellSessionId)!,
          );
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
    let ownershipHeartbeat: ReturnType<typeof setInterval> | undefined;
    let renewalActive = false;
    const pendingRenewals = new Set<Promise<void>>();
    let settled = false;
    let runnerResult: string | undefined;
    let primaryError: unknown;
    // Explicit failure flags: a runner that rejects with `undefined` is still a
    // failure, so the error VALUE must never double as the classification.
    let primaryFailed = false;
    let releaseError: unknown;
    let releaseFailed = false;
    // The caller-visible result settles exactly once, and only after the whole
    // release path (child drain + pointer/JWT release) completed: a caller
    // awaiting `run()` must never begin workspace cleanup while a tool child of
    // this very session still uses a staged file.
    const settle = (acpSessionId: string | undefined, cancelledByDeadline: boolean) => {
      if (settled) return;
      settled = true;
      item.resolveResult?.(acpSessionId, cancelledByDeadline);
    };
    try {
      // Keep queued/in-flight sessions alive against the registry idle reaper.
      if (options.registrySessionId ?? options.shellSessionId) {
        this.sessionRegistry.touch((options.registrySessionId ?? options.shellSessionId)!);
      }

      const entryKey = poolEntryKey(options.poolKey, options.agentType, options.permissionMode);
      entry = await this.acquireProcess(entryKey, options);
      entry.refCount++;
      entry.lastActivity = Date.now();
      if (options.registrySessionId && !options.shellSessionId) {
        ownershipHeartbeat = setInterval(
          () => this.sessionRegistry.touch(options.registrySessionId!),
          this.jwtRenewalIntervalMs,
        );
      }

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

      runnerResult = await item.runner(entry.connector, options);
    } catch (error) {
      // Acquire or runner failure still settles the `run()` promise (as a
      // deadline-cancelled run) in the finally block below, so callers never
      // hang and the release path is never skipped.
      primaryFailed = true;
      primaryError = error;
    } finally {
      // Stop renewals and await EVERY renewal already past its await point (no
      // await between the flag clear and clearInterval), so a late or stalled
      // renewal can never resurrect the JWT file after the release deletes it.
      renewalActive = false;
      if (ownershipHeartbeat !== undefined) clearInterval(ownershipHeartbeat);
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
      //
      // Every step is exception-safe: a failing pointer clear can no longer skip
      // the JWT deletion, the refcount release or the public settlement, and the
      // FIRST error (an acquire/runner failure) stays the reported primary one.
      try {
        if (entry) await this.releaseEntry(entry, options);
      } catch (error) {
        releaseFailed = true;
        releaseError = error;
      } finally {
        if (entry) {
          entry.refCount--;
          if (entry.refCount === 0) {
            this.scheduleReclaim(entry);
          }
        }
        settle(runnerResult, primaryFailed);
      }
    }
    // Reported OUTSIDE the finally block: the public classification is already
    // delivered, and the first error stays the one the caller observes.
    if (primaryFailed) {
      if (releaseFailed) {
        logger.error("Pool release path failed after a failed session: {error}", {
          poolKey: options.poolKey,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      }
      throw primaryError;
    }
    if (releaseFailed) throw releaseError;
  }

  /**
   * Wait (bounded) for the lease's tool children, then clear the pointer and the
   * JWT file. Retains the workspace's cleanup protection for this bot lifetime
   * whenever producer quiescence cannot be confirmed (design D2).
   */
  private async releaseEntry(entry: PoolEntry, options: PoolRunOptions): Promise<void> {
    entry.lastActivity = Date.now();
    // Refresh the tracked PID: the runner may have re-spawned the connector
    // (session/load recovery), so the drain must target the CURRENT process.
    const spawnPid = entry.processPid;
    const currentPid = entry.connector.getProcessPid();
    if (currentPid !== undefined) {
      entry.processPid = currentPid;
    }

    let verdict: ChildQuiescenceVerdict = { status: "quiescent", drained: "no-child" };
    if (currentPid === undefined && spawnPid !== undefined) {
      // The wrapper this lease was spawned on is gone without an observed drain.
      verdict = { status: "uncertain", reason: "wrapper-not-observable" };
    } else if (currentPid !== undefined) {
      verdict = await this.awaitProducerQuiescence(currentPid);
      if (verdict.status === "quiescent" && spawnPid !== undefined && spawnPid !== currentPid) {
        // A recovery re-spawn replaced the wrapper: the discarded generation's
        // tool children were never drained, so the workspace stays protected.
        verdict = { status: "uncertain", reason: "superseded-generation" };
      }
      if (verdict.status === "quiescent" && verdict.drained === "terminated") {
        logger.info("Killed agent tool-child process tree after drain timeout", {
          pid: currentPid,
          timeoutMs: CHILD_DRAIN_TIMEOUT_MS,
        });
      }
    }
    if (verdict.status === "uncertain" && options.workspacePath) {
      this.markWorkspaceTmpUncertain(options.workspacePath, verdict.reason);
    }

    if (options.shellSessionId) {
      // The pointer clear and the JWT deletion are independent release steps:
      // a failing pointer write must never leave the session's credential file
      // behind. The FIRST failure is reported, and `deleteSessionJwt` already
      // swallows its own errors (bounded warning), so this cannot mask it.
      let releaseFailure: unknown;
      let releaseFailed = false;
      try {
        await this.clearActivePointer(options.shellSessionId);
      } catch (error) {
        releaseFailed = true;
        releaseFailure = error;
      }
      await this.deleteSessionJwt(options.shellSessionId);
      if (releaseFailed) throw releaseFailure;
    }
  }

  /**
   * Confirm that a pooled producer's tool children stopped using the workspace.
   * Overridable so a test can hold the drain open and observe what the caller
   * can and cannot see while it runs (design D2).
   */
  protected awaitProducerQuiescence(wrapperPid: number): Promise<ChildQuiescenceVerdict> {
    return awaitChildQuiescence(wrapperPid, { drainTimeoutMs: CHILD_DRAIN_TIMEOUT_MS });
  }

  /**
   * Retain one workspace's cleanup protection for this bot lifetime because a
   * pooled producer's quiescence could not be confirmed (design D2).
   */
  private markWorkspaceTmpUncertain(workspacePath: string, reason: string): void {
    this.tmpOwnership?.markTmpUseUncertain(join(workspacePath, "tmp"), reason);
  }

  /** Lazy-spawn or reuse the pool key's live process (generation-checked). */
  private async acquireProcess(
    entryKey: string,
    options: PoolRunOptions,
  ): Promise<PoolEntry> {
    let entry = this.entries.get(entryKey);

    // A reclaim in progress blocks new acquires until the old process fully exits
    // (same-generation check) — this prevents two opencode processes from opening
    // the same channel-scoped data root at once.
    if (entry?.reclaiming) {
      await entry.connector.disconnect();
      // Identity check: a concurrent acquire may already have removed the
      // reclaiming entry and installed a fresh one — never evict that.
      if (this.entries.get(entryKey) === entry) {
        this.entries.delete(entryKey);
        entry = undefined;
      } else {
        entry = this.entries.get(entryKey);
      }
      if (!entry) return this.acquireProcess(entryKey, options);
    }

    // A dead process (crash, the drain-timeout tree-kill, or an external kill)
    // leaves the entry's connector looking connected; verify liveness before
    // reusing it — re-spawn a fresh connector instead.
    if (
      entry && (!entry.connector.isConnected ||
        (entry.processPid !== undefined && !(await processAlive(entry.processPid))))
    ) {
      await entry.connector.disconnect();
      if (this.entries.get(entryKey) === entry) {
        this.entries.delete(entryKey);
        entry = undefined;
      } else {
        // A concurrent acquire already replaced it — reuse the replacement.
        entry = this.entries.get(entryKey);
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
    await this.ensureSharedDirs(
      entryKey,
      options.agentType,
      options.poolKey,
      options.permissionMode,
    );
    const connector = this.connectorFactory(options.connectorOptions);
    try {
      await connector.connect();
    } catch (error) {
      // A failed connect can still have spawned a wrapper generation whose tool
      // children were never confirmed stopped. Retain the owning workspace's
      // cleanup protection before the acquisition error propagates, so the
      // caller's release can never reclaim files a survivor may hold.
      await this.releaseFailedSpawn(connector, options);
      throw error;
    }
    entry = {
      entryKey,
      poolKey: options.poolKey,
      agentType: options.agentType,
      permissionMode: options.permissionMode,
      connector,
      refCount: 0,
      lastActivity: Date.now(),
      generation: 1,
      reclaiming: false,
      processPid: connector.getProcessPid(),
    };
    this.entries.set(entryKey, entry);
    logger.info("Spawning shared agent process for pool entry {entryKey}", {
      entryKey,
      poolKey: options.poolKey,
      agentType: options.agentType,
      permissionMode: options.permissionMode,
    });
    return entry;
  }

  /**
   * Best-effort teardown of a producer whose acquisition failed. A connector
   * that never spawned needs no retained protection; a generation that actually
   * started and was never drained keeps its workspace protected for this bot
   * lifetime. The original connect failure stays the reported error.
   */
  private async releaseFailedSpawn(
    connector: AgentConnector,
    options: PoolRunOptions,
  ): Promise<void> {
    const evidence = connector.getProcessEvidence();
    if (evidence.generations > 0 && options.workspacePath) {
      // The connector's own initialization-failure cleanup is best-effort and
      // cannot establish tool-child quiescence (killing the wrapper does not
      // reap a SIGKILLed generation's orphaned tools).
      this.markWorkspaceTmpUncertain(options.workspacePath, "connect-failed");
    }
    try {
      await connector.disconnect();
    } catch {
      // Best effort: the acquisition error stays primary.
    }
  }

  /** Schedule a refcount-based reclaim (re-checked under the pool lock on fire). */
  private scheduleReclaim(entry: PoolEntry): void {
    if (entry.reclaimTimer) clearTimeout(entry.reclaimTimer);
    entry.reclaimTimer = setTimeout(async () => {
      const current = this.entries.get(entry.entryKey);
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
        if (this.entries.get(current.entryKey) === current) {
          this.entries.delete(current.entryKey);
        }
        logger.info("Reclaimed idle agent process for pool entry {entryKey}", {
          entryKey: current.entryKey,
          poolKey: current.poolKey,
          idleMs: Date.now() - current.lastActivity,
        });
      } catch (error) {
        logger.error("Failed to reclaim agent process for {entryKey}: {error}", {
          entryKey: current.entryKey,
          poolKey: current.poolKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.reclaimIdleMs);
  }

  /**
   * Create shared directories under the bot data root.
   * For OpenCode: creates channel-cwd, channel-tmp, and opencode-data for poolKey (byte-identical to before).
   * For OMP: ensures mode-distinct state roots exist under omp-pools/{poolKey}/{mode}.
   */
  private async ensureSharedDirs(
    _entryKey: string,
    agentType: AgentType,
    poolKey: string,
    permissionMode: PoolPermissionMode,
  ): Promise<void> {
    const dataRoot = this.config.workspace?.repoPath;
    if (!dataRoot) return;
    if (agentType === "omp") {
      const baseRoot = resolve(join(dataRoot, "omp-pools", poolKey));
      // Native OMP redirects its data directory to `$XDG_DATA_HOME/omp`, so the
      // application child (not just its parent) must exist before spawn, and its
      // reserved `natives` entry must be linked to the ONE shared prepared native
      // payload. The SAME helper the per-spawn factory path uses performs both, so
      // the pooled shape can never fall back to a channel-local extraction. The
      // factory normally already prepared this root; the call is idempotent.
      prepareOmpNativeCacheRoot({
        baseRoot,
        mode: permissionMode,
        selection: this.config.agent?.ompNativeCache,
        forbiddenRoots: ompNativeCacheForbiddenRoots(this.config.workspace),
      });
      // Pooled OMP processes share the pooled TMPDIR convention with OpenCode.
      await Deno.mkdir(resolve(join(dataRoot, "channel-tmp", poolKey)), { recursive: true });
      return;
    }
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

  /** Cancel queued sessions that exceeded the queue deadline (single release path). */
  private sweepQueueDeadlines(): void {
    const now = Date.now();
    for (const queue of [this.interactiveQueue, this.maintenanceQueue]) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const item = queue[i];
        const waitedMs = now - item.queuedAt;
        if (waitedMs >= this.queueDeadlineMs) {
          queue.splice(i, 1);
          if (item.options.registrySessionId ?? item.options.shellSessionId) {
            this.sessionRegistry.remove(
              (item.options.registrySessionId ?? item.options.shellSessionId)!,
            );
          }
          item.resolveResult?.(undefined, true);
          logger.warn(
            "Queue deadline exceeded for session {sessionId} after {waitedMs}ms",
            { sessionId: item.options.shellSessionId, waitedMs },
          );
        } else if (item.options.registrySessionId ?? item.options.shellSessionId) {
          // Queue-activity touch (spec): still-queued sessions stay excluded
          // from the registry idle reaper while they wait for the lease.
          this.sessionRegistry.touch(
            (item.options.registrySessionId ?? item.options.shellSessionId)!,
          );
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
