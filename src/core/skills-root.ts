// src/core/skills-root.ts
//
// The single trusted skill-script root resolver
// (`repair-omp-owned-skill-handoff` D1): one deployment-owned ABSOLUTE root
// per agent type/deployment, supplied as the internal `skillsDir` template
// variable to every skill-instructing render and to the retry builder. There
// is exactly ONE root convention — no child-HOME fallback, no session
// directory, no second root convention:
//
// - `omp`: the installed owned root (`OMP_IMAGE_SKILLS_ROOT`, the deployment
//   declaration every owned settings overlay names; the Containerfile installs
//   the repository `skills/` tree content-faithfully there), falling back —
//   through the same image-first, validated-dev pattern every other OMP path
//   seam in `utils/omp-paths.ts` uses — to the VALIDATED development source
//   root (this repository's own `skills/` tree). The child's isolated HOME is
//   NEVER consulted: the agent-side `$HOME/.agents/skills` expression can only
//   ever name an empty sandbox directory there.
// - `opencode`: the existing installed-root resolution — `agent.skillsDir`
//   (env `AGENT_SKILLS_DIR`; container deployments set
//   `/home/deno/.agents/skills`) — relative roots resolved against the
//   daemon/deployment process working directory, never the agent child's HOME.
//
// `skillsDir` is an internal render input: no new public configuration, no
// new environment override, and no subprocess secret is introduced here.
// An unresolvable root fails EXPLICITLY — never an empty expansion, a
// token-form path, or another session's or agent type's root.

import { isAbsolute, join, resolve } from "@std/path";
import { OMP_IMAGE_SKILLS_ROOT } from "@utils/omp-paths.ts";
import { isSupportedAgentType } from "../acp/types.ts";
import type { AgentType } from "../acp/types.ts";
import { ConfigError, ErrorCode } from "../types/errors.ts";

/**
 * Development source root: the repository `skills/` tree — the declared
 * content-faithful COPY source of `OMP_IMAGE_SKILLS_ROOT` (Containerfile:
 * `COPY skills/ /opt/air/skills/`). Validated for existence before use, the
 * same posture as every other dev→image seam.
 */
export const DEV_SOURCE_SKILLS_ROOT = resolve(
  join(import.meta.dirname ?? ".", "..", "..", "skills"),
);

/** Injectable seam so tests and unusual hosts can probe without the real filesystem. */
export interface SkillsRootOptions {
  /** Existence probe for directory roots; defaults to the real filesystem. */
  directoryExists?: (path: string) => boolean;
  /** Working directory OpenCode relative roots resolve against (daemon-side, never child HOME). */
  deploymentCwd?: string;
}

/**
 * Resolve the deployment-owned ABSOLUTE skill-script root for one agent type.
 * `configuredSkillsDir` is the existing `agent.skillsDir` value (opencode
 * installed-root resolution only). Throws `ConfigError` when no validated
 * root exists — the caller's render/retry then fails explicitly instead of
 * instructing a nonexistent location.
 */
export function resolveTrustedSkillsRoot(
  agentType: AgentType | string,
  configuredSkillsDir?: string,
  options: SkillsRootOptions = {},
): string {
  if (!isSupportedAgentType(agentType)) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Unknown agent type for the trusted skill-script root: ${String(agentType)}`,
      { agentType: String(agentType) },
    );
  }
  const directoryExists = options.directoryExists ??
    ((path: string) => {
      // Existence probe only — DELIBERATELY link-following (`stat`, not
      // `lstat`): an installed root may legitimately be a mounted/symlinked
      // tree, and the render result is an INSTRUCTION string, never
      // authority. Where authority exists (the OMP skill-URI gate,
      // `owned-skills.ts`), a linked root is refused outright, so a
      // symlinked host renders a root its own gate would deny — a
      // fail-closed confusion, never an escape.
      try {
        return Deno.statSync(path).isDirectory;
      } catch {
        return false;
      }
    });
  if (agentType === "omp") {
    // Image-first, validated dev fallback: the OFFICIAL image always installs
    // the owned root, so development hosts are the only ones reaching the
    // dev branch, and they only when the repository tree really exists.
    if (directoryExists(OMP_IMAGE_SKILLS_ROOT)) return OMP_IMAGE_SKILLS_ROOT;
    if (directoryExists(DEV_SOURCE_SKILLS_ROOT)) return DEV_SOURCE_SKILLS_ROOT;
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `No trusted OMP skill-script root: neither the installed owned root ` +
        `"${OMP_IMAGE_SKILLS_ROOT}" nor the development source root ` +
        `"${DEV_SOURCE_SKILLS_ROOT}" exists — an isolated agent child HOME is never a fallback`,
      { agentType },
    );
  }
  // opencode: the existing installed-root resolution (agent.skillsDir, default
  // "skills"), relative roots anchored at the daemon-side working directory.
  const configured = configuredSkillsDir && configuredSkillsDir !== ""
    ? configuredSkillsDir
    : "skills";
  const root = isAbsolute(configured)
    ? configured
    : resolve(options.deploymentCwd ?? Deno.cwd(), configured);
  if (!directoryExists(root)) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `No trusted OpenCode skill-script root: the configured installed root ` +
        `"${root}" does not exist — the agent child HOME is never used to derive it`,
      { agentType, root },
    );
  }
  return root;
}
