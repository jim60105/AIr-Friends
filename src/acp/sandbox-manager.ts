// src/acp/sandbox-manager.ts

import { createLogger } from "@utils/logger.ts";
import type { SandboxConfig } from "../types/config.ts";
import { canConfineFilesystem, canIsolateNetwork } from "./sandbox-capabilities.ts";
import { buildBwrapConfinement } from "./filesystem-confinement.ts";

const logger = createLogger("SandboxManager");

// Agent subprocess allowed base environment variables
const BASE_ALLOWED_ENV = [
  // System essentials
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  // Deno related
  "DENO_DIR",
  "DENO_NO_UPDATE_CHECK",
  // Skill API communication
  "SKILL_API_PORT",
  "SESSION_ID",
  // Per-session Skill API JWT file directory (JWT skill auth). The deployment
  // SKILL_API_SECRET is deliberately NOT allowlisted into the agent env — the bot
  // process is the only holder of the HMAC key.
  "SKILL_JWT_DIR",
  // Shared-process mode marker: skill libraries must prefer the pool's
  // current-session pointer over the spawn-frozen $SESSION_ID.
  "SKILL_SHARED_PROCESS",
  // Agent workspace
  "AGENT_WORKSPACE",
  // Workspace-scoped temp directory
  "TMPDIR",
  // Per-session XDG data home (F12): OpenCode's data dir is scoped under the session
  // TMPDIR so truncated tool outputs stay inside the session workspace.
  "XDG_DATA_HOME",
  // Browser automation
  "AGENT_BROWSER_EXECUTABLE_PATH",
  // Validating egress proxy (F14): the agent's fetch/browser clients are pointed at the proxy
  // via these vars. In the default posture this env-var routing is a BEST-EFFORT convenience
  // layer, NOT a hard boundary — a client that ignores HTTP_PROXY, or a target matched by
  // NO_PROXY (loopback), escapes it. The authoritative boundary (a network namespace whose only
  // egress is the proxy) is deferred because an empty netns severs the loopback Skill API; see
  // the F14 design. NO_PROXY keeps the loopback Skill API reachable (the proxy rejects loopback).
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];

// Agent-type-specific authentication environment variables.
// GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY are the OpenCode Gemini provider keys.
const AGENT_TYPE_ENV: Record<string, string[]> = {
  opencode: [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENCODE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
  ],
};

export interface SpawnOptions {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export class SandboxManager {
  constructor(private readonly config: SandboxConfig) {}

  /**
   * Build complete sandboxed spawn options.
   *
   * Applies (1) env filtering, (2) the egress posture (F14), and (3) filesystem confinement
   * (F12 D4). Both confinement and full network isolation depend on runtime namespace
   * privileges; when a required mechanism is unavailable the method throws (fail closed)
   * rather than spawning the agent unconfined or with open egress.
   */
  buildSpawnOptions(
    agentType: string,
    originalCommand: string,
    originalArgs: string[],
    baseEnv: Record<string, string>,
    cwd: string,
  ): SpawnOptions {
    const env = this.config.filterEnv ? this.buildFilteredEnv(agentType, baseEnv) : baseEnv;

    // Egress posture (F14). Throws if nothing is configured (never silently open).
    const wantsNetworkIsolation = this.resolveWantsNetworkIsolation();
    if (wantsNetworkIsolation && !canIsolateNetwork()) {
      throw new Error(
        "Agent network isolation is required but could not be established in this runtime " +
          "(unprivileged user/network namespaces appear disabled). Enable unprivileged user " +
          "namespaces, configure agent.sandbox.egressProxy, or set agent.sandbox.unrestrictedEgress.",
      );
    }

    let command = originalCommand;
    let args = originalArgs;

    // Filesystem confinement (F12 D4). When enabled it also carries the network-namespace
    // unshare (via `shareNet: false`) when full isolation is requested, so we do not stack a
    // separate `unshare` wrapper on top of bwrap.
    if (this.config.filesystemConfinement) {
      if (!canConfineFilesystem()) {
        throw new Error(
          "Agent filesystem confinement (agent.sandbox.filesystemConfinement) is required but " +
            "bwrap could not establish a mount namespace in this runtime. Enable unprivileged " +
            "user namespaces / install bubblewrap, or set filesystemConfinement: false to accept the risk.",
        );
      }
      const tmpDir = env["TMPDIR"] ?? `${cwd}/tmp`;
      const agentWorkspace = env["AGENT_WORKSPACE"];
      logger.info("Confining agent filesystem via bwrap (shareNet={shareNet})", {
        shareNet: !wantsNetworkIsolation,
      });
      ({ command, args } = buildBwrapConfinement(
        {
          sessionWorkspace: cwd,
          tmpDir,
          agentWorkspace,
          shareNet: !wantsNetworkIsolation,
        },
        command,
        args,
      ));
    } else if (wantsNetworkIsolation) {
      // No filesystem confinement, but full network isolation requested: wrap with unshare.
      ({ command, args } = this.wrapWithNetworkIsolation(command, args));
    }

    return { command, args, env, cwd };
  }

  /**
   * Resolve whether the agent should run under FULL network-namespace isolation.
   *
   * Priority: an explicit unrestricted-egress opt-in and the validating proxy both keep the
   * shared network (so the loopback Skill API and the proxy stay reachable); only an explicit
   * `networkIsolation` (without those) selects a full empty network namespace. When none of
   * the three is configured the posture is undefined — rather than defaulting to open egress
   * we FAIL CLOSED, per F14 D2.
   */
  private resolveWantsNetworkIsolation(): boolean {
    if (this.config.unrestrictedEgress) return false;
    if (this.config.egressProxy) return false;
    if (this.config.networkIsolation) return true;
    throw new Error(
      "No agent egress posture configured: enable agent.sandbox.egressProxy (recommended), " +
        "agent.sandbox.networkIsolation, or explicitly opt into agent.sandbox.unrestrictedEgress. " +
        "Refusing to grant the agent unmediated open egress by default.",
    );
  }

  /**
   * Filter env vars to only allowed ones.
   */
  private buildFilteredEnv(
    agentType: string,
    baseEnv: Record<string, string>,
  ): Record<string, string> {
    const allowed = new Set([
      ...BASE_ALLOWED_ENV,
      ...(AGENT_TYPE_ENV[agentType] ?? []),
      ...this.config.allowedEnvVars,
    ]);

    const filtered: Record<string, string> = {};
    for (const key of allowed) {
      if (key in baseEnv) {
        filtered[key] = baseEnv[key];
      }
    }
    return filtered;
  }

  /**
   * Wrap command with a network namespace for full isolation.
   *
   * Uses the userns-first incantation (`unshare --user --map-root --net`) because a bare
   * `unshare --net` requires CAP_SYS_ADMIN in the current user namespace and FAILS in a
   * non-root container; creating a user namespace first (permitted for unprivileged
   * processes) grants the capability inside it. Capability is confirmed by a functional
   * probe (see sandbox-capabilities.ts) before this is called.
   */
  private wrapWithNetworkIsolation(
    command: string,
    args: string[],
  ): { command: string; args: string[] } {
    logger.info("Wrapping agent command with unshare --user --map-root --net");
    return {
      command: "unshare",
      args: ["--user", "--map-root", "--net", command, ...args],
    };
  }
}
