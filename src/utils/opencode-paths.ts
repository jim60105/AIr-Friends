// src/utils/opencode-paths.ts
//
// Single source of truth for the session-scoped OpenCode data directory (F12).
// OpenCode computes its data dir from xdg-basedir semantics (`$XDG_DATA_HOME/opencode`,
// else `~/.local/share/opencode`); the truncated tool-output directory is hard-coded to
// `{dataDir}/tool-output` and is NOT configurable. By scoping `XDG_DATA_HOME` to a
// directory under the session TMPDIR we keep truncated tool outputs inside the session
// workspace, so (a) the agent can read its own tool-output files through the generic
// gate and (b) the shared, home-rooted data dir is never written or granted.
//
// The data-dir helpers are pure and derive everything from the session workspace path
// alone, so the subprocess environment (agent-factory) and the permission gate
// (client.ts) always agree without reading the parent process's `XDG_DATA_HOME`.
//
// This module also owns the GENERATED OpenCode skill-discovery declaration
// (`generate-opencode-skill-discovery-declaration`): the deployed global
// configuration path plus the inspect-then-write that names the deployment's ONE
// resolved skill root to the agent, described in its own section at the end of
// the file.

import { isAbsolute, join, resolve } from "@std/path";
import { ConfigError, ErrorCode } from "../types/errors.ts";

/**
 * Root of the session-scoped OpenCode data area: a directory under the session TMPDIR,
 * derived deterministically from the session workspace path alone.
 */
export function opencodeDataRoot(workingDir: string): string {
  return join(workingDir, "tmp", "opencode-data");
}

/**
 * Session-specific `XDG_DATA_HOME` for the agent subprocess. When a session id exists
 * the data home is scoped to that session (`{root}/{sessionId}`) so concurrent sessions
 * of the same user never share truncated tool outputs; without one it falls back to the
 * workspace-level root (used by internal system sessions with dedicated workspaces).
 */
export function sessionXdgDataHome(workingDir: string, sessionId?: string): string {
  return sessionId ? join(opencodeDataRoot(workingDir), sessionId) : opencodeDataRoot(workingDir);
}

/**
 * OpenCode's truncated tool-output directory under a given XDG data home
 * (`{xdgDataHome}/opencode/tool-output`), matching OpenCode's hard-coded layout.
 */
export function opencodeToolOutputDir(xdgDataHome: string): string {
  return join(xdgDataHome, "opencode", "tool-output");
}

// ---------------------------------------------------------------------------
// GENERATED OpenCode skill-discovery declaration
// (`generate-opencode-skill-discovery-declaration`)
//
// OpenCode discovers skills only from what its own configuration declares, so
// the deployment's ONE resolved skill root (`agent.skillsDir` /
// `AGENT_SKILLS_DIR`, the value `src/core/skills-root.ts` resolves for every
// other consumer) is written into the deployed OpenCode global configuration:
// the skill discovery path list, and one `external_directory` allowance under
// that root alone. Nothing else in that document changes — every other
// setting, including the `deno run *` / `*.ts*` routing that sends script
// executions to the ACP approval gate, keeps its bytes exactly.
//
// The section below is the PURE document half plus the one filesystem step.
// The root is always an INPUT: this module never resolves, defaults or derives
// a root, and never writes a second one.
// ---------------------------------------------------------------------------

/**
 * Injectable seams for the declaration step. Each defaults to the real
 * deployment: the process environment, the daemon user's own home, the real
 * filesystem.
 */
export interface OpencodeSkillDiscoveryOptions {
  /** Environment accessor; defaults to the process environment. */
  readonly env?: (name: string) => string | undefined;
  /**
   * The daemon user's OBSERVED home directory: what a `~/` entry in the
   * document is resolved against, and what the over-broad-root refusal is
   * bounded by. Defaults to the process `HOME`.
   */
  readonly home?: string;
  /** Whole-document reader; `undefined` means the target does not exist. */
  readonly readFile?: (path: string) => string | undefined;
  /** Whole-document writer. */
  readonly writeFile?: (path: string, content: string) => void;
}

/**
 * The daemon user's observed home, canonicalized. An unset, empty or relative
 * `HOME` yields `undefined`: no `~/` entry can then be resolved and no
 * home-scoped allowance can be bounded, so the refusal below stays vacuous
 * rather than bounding against a guessed directory.
 */
export function opencodeDaemonHome(
  options: OpencodeSkillDiscoveryOptions = {},
): string | undefined {
  const env = options.env ?? ((name: string) => Deno.env.get(name));
  const home = options.home ?? env("HOME");
  if (home === undefined || home === "" || !isAbsolute(home)) return undefined;
  return resolve(home);
}

/**
 * The deployed OpenCode GLOBAL configuration document — the file the pinned
 * runtime reads from its global config directory, and the file an operator
 * mount shadows (documented in `docs/DEVELOPMENT.md`).
 *
 * Resolution follows the runtime's own order: `OPENCODE_CONFIG_DIR` (refused
 * when it is not absolute — a relative value would resolve against each
 * session's cwd, so the declaration could not be placed where the agent
 * reads); else `$XDG_CONFIG_HOME/opencode` (a relative `XDG_CONFIG_HOME` is
 * ignored, as the XDG base-directory specification requires); else
 * `{daemon home}/.config/opencode`.
 */
export function opencodeGlobalConfigPath(options: OpencodeSkillDiscoveryOptions = {}): string {
  const env = options.env ?? ((name: string) => Deno.env.get(name));
  const configuredDir = env("OPENCODE_CONFIG_DIR");
  if (configuredDir !== undefined && configuredDir !== "") {
    if (!isAbsolute(configuredDir)) {
      throw new ConfigError(
        ErrorCode.CONFIG_INVALID,
        `OPENCODE_CONFIG_DIR "${configuredDir}" is not an absolute path — the deployed OpenCode ` +
          "configuration the skill-discovery declaration must be written into cannot be determined",
        { opencodeConfigDir: configuredDir },
      );
    }
    return join(configuredDir, "opencode.json");
  }
  const xdgConfigHome = env("XDG_CONFIG_HOME");
  if (xdgConfigHome !== undefined && xdgConfigHome !== "" && isAbsolute(xdgConfigHome)) {
    return join(xdgConfigHome, "opencode", "opencode.json");
  }
  const home = opencodeDaemonHome(options);
  if (home === undefined) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      "Neither OPENCODE_CONFIG_DIR nor XDG_CONFIG_HOME nor an absolute HOME is set — the " +
        "deployed OpenCode configuration the skill-discovery declaration must be written into " +
        "cannot be determined",
    );
  }
  return join(home, ".config", "opencode", "opencode.json");
}
