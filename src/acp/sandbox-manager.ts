// src/acp/sandbox-manager.ts

import { createLogger } from "@utils/logger.ts";
import type { SandboxConfig } from "../types/config.ts";
import { canConfineFilesystem, canIsolateNetwork } from "./sandbox-capabilities.ts";
import { buildBwrapConfinement } from "./filesystem-confinement.ts";
import {
  OMP_FOREIGN_PROVIDER_ENV_SELECTORS,
  OMP_SETTINGS_DISCOVERY_ENV_SELECTORS,
} from "./omp-settings.ts";

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
  // NOTE: This entry is the existing OpenCode tool-output scoping mechanism (the factory
  // always sets the value it passes: session-scoped under the session TMPDIR per-spawn,
  // pool-key-scoped in shared mode) and it is NOT a grant of scoped state to an OMP process.
  // PI_CODING_AGENT_DIR under the selected process's TMPDIR/omp-agent and mode-distinct state roots
  // are owned by translate-omp-owned-settings (row 8) and spawn-mode-scoped-omp-agents (row 9).
  // Do not drop, rename, or re-scope this variable here.
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
  // Gemini and OpenRouter are the supported provider credentials for OMP.
  // Other provider keys require an approved configuration change.
  omp: [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
  ],
};

/**
 * Variables that MUST NEVER reach any agent subprocess through any source when
 * environment filtering is enabled (unless explicitly in that agent type's approved set).
 */
const NEVER_PASS_ENV = new Set([
  // Platform tokens
  "DISCORD_TOKEN",
  "MISSKEY_TOKEN",
  // Dashboard credentials
  "DASHBOARD_PASSPHRASE",
  // Raw Skill API server secret
  "AGENT_SKILL_API_SECRET",
  // Unapproved provider keys (OPENCODE_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY are approved only for opencode)
  "OPENCODE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GITHUB_TOKEN",
  "COPILOT_GITHUB_TOKEN",
  "GIT_BACKUP_AUTH_PASSWORD",
  // Profile/XDG state selectors
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "OMP_PROFILE",
  "PI_PROFILE",
  "PI_CODING_AGENT_DIR",
  // Row 26: pinned settings/config-source override selector (never reaches any agent)
  "PI_CONFIG_FILES",
  // Row 26: foreign provider config selectors — never permitted in any form;
  // they could reintroduce a host settings source and are never plan-owned.
  ...OMP_FOREIGN_PROVIDER_ENV_SELECTORS,
]);

/**
 * Mandatory OMP-only settings-discovery sanitization (row 26, D2).
 *
 * Removes every inherited OMP settings-discovery selector (HOME, all XDG
 * selectors including XDG_DATA_HOME, OMP_PROFILE, PI_PROFILE, PI_CONFIG_FILES,
 * PI_CODING_AGENT_DIR) and every foreign provider config selector from an OMP
 * child environment REGARDLESS of `filterEnv` or `allowedEnvVars`. This is
 * OMP-only: OpenCode's existing HOME/XDG_DATA_HOME allowlist semantics are
 * untouched (the OpenCode branch never calls this).
 *
 * Removal is the FIRST half of the control; the OMP factory's post-filter
 * trusted assignment (`finalizeOmpSpawnEnvironment`) is the second half —
 * only the exact deployment-owned plan values may (re)appear.
 */
// Returns the SAME record it sanitized, so spawn-environment builders can chain
// the call (in-place mutators such as the factory/child filter ignore it too).
export function sanitizeOmpDiscoveryEnv(env: Record<string, string>): Record<string, string> {
  for (const selector of OMP_SETTINGS_DISCOVERY_ENV_SELECTORS) {
    delete env[selector];
  }
  for (const selector of OMP_FOREIGN_PROVIDER_ENV_SELECTORS) {
    delete env[selector];
  }
  return env;
}

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

    // Row 26 (D2): OMP settings-discovery sanitization is MANDATORY for both
    // filterEnv values and cannot be widened back by allowedEnvVars.
    if (agentType === "omp") {
      sanitizeOmpDiscoveryEnv(env);
    }

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

    const agentAllowed = AGENT_TYPE_ENV[agentType] ?? [];

    // Deduplicate and warn for operator-configured allowedEnvVars that collide with NEVER_PASS_ENV
    const warnedExclusions = new Set<string>();
    for (const configuredVar of this.config.allowedEnvVars) {
      const isForbidden = NEVER_PASS_ENV.has(configuredVar) &&
        !agentAllowed.includes(configuredVar);
      if (isForbidden && !warnedExclusions.has(configuredVar)) {
        warnedExclusions.add(configuredVar);
        logger.warn(
          "Excluding never-pass variable from sandbox allowedEnvVars: {envVar}",
          { envVar: configuredVar },
        );
      }
    }

    const filtered: Record<string, string> = {};
    for (const key of allowed) {
      if (NEVER_PASS_ENV.has(key) && !agentAllowed.includes(key)) {
        continue;
      }
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
