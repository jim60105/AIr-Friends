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
//
// `unify-omp-skill-root-resolution` D1: every returned root carries a
// canonical PHYSICAL observation (realpath) so each consumer — prompt recipes,
// script inventory, permission decisions, readiness and read-only mounts —
// shares the SAME canonical absolute spelling and a root identity an inventory
// can recheck at decision time. The selection logic below is unchanged:
// image-first OMP, validated development source, and daemon-side OpenCode
// configuration; only the OBSERVATION of the selected root was added.

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
  /**
   * Full physical-observation seam: returns the canonical observation of an
   * existing directory root, or `null` when it cannot be observed. Defaults to
   * the real filesystem (`statSync` existence + best-effort `realPathSync`
   * canonicalization); a test supplying only `directoryExists` keeps its
   * configured spelling with no recorded identity.
   */
  observeDirectory?: (path: string) => SkillsRootObservation | null;
}

/** Canonical physical observation of a validated deployment skill root. */
export interface SkillsRootObservation {
  /** The canonical ABSOLUTE root path (realpath of the validated selection). */
  readonly root: string;
  /**
   * Device/inode identity of the observed root, when the real filesystem
   * provided one. An absent identity proves nothing: consumers that must
   * recheck root identity (the script inventory) treat it as a failed
   * observation and never admit grants from it.
   */
  readonly identity?: { dev: number; ino: number };
}

/** Default physical observation: link-following existence + realpath. */
function defaultObserveDirectory(
  directoryExists: (path: string) => boolean,
): (path: string) => SkillsRootObservation | null {
  return (path: string) => {
    if (!directoryExists(path)) return null;
    // Canonicalize best-effort: an unusual host (or a test probe of a
    // synthetic path) keeps the configured spelling with NO recorded
    // identity, which identity-requiring consumers then refuse.
    try {
      const stat = Deno.statSync(path);
      // Some platforms report `null` dev/ino: no identity is then recorded,
      // which identity-requiring consumers refuse rather than trust.
      const identity = stat.dev !== null && stat.ino !== null
        ? { dev: stat.dev, ino: stat.ino }
        : undefined;
      return { root: Deno.realPathSync(path), identity };
    } catch {
      return { root: path };
    }
  };
}

/**
 * Resolve the deployment-owned ABSOLUTE skill-script root for one agent type.
 * `configuredSkillsDir` is the existing `agent.skillsDir` value (opencode
 * installed-root resolution only). Throws `ConfigError` when no validated
 * root exists — the caller's render/retry then fails explicitly instead of
 * instructing a nonexistent location.
 * The returned path is the CANONICAL physical spelling of the validated
 * selection (`observeTrustedSkillsRoot` for the identity as well).
 */
export function resolveTrustedSkillsRoot(
  agentType: AgentType | string,
  configuredSkillsDir?: string,
  options: SkillsRootOptions = {},
): string {
  return observeTrustedSkillsRoot(agentType, configuredSkillsDir, options).root;
}

/**
 * Observe the deployment-owned ABSOLUTE skill-script root (canonical path +
 * identity) for one agent type. Same selection and explicit failure posture as
 * {@link resolveTrustedSkillsRoot}.
 */
export function observeTrustedSkillsRoot(
  agentType: AgentType | string,
  configuredSkillsDir?: string,
  options: SkillsRootOptions = {},
): SkillsRootObservation {
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
  const observe = options.observeDirectory ?? defaultObserveDirectory(directoryExists);
  const validated = (path: string): SkillsRootObservation => {
    const observation = observe(path);
    if (observation === null) {
      throw new ConfigError(
        ErrorCode.CONFIG_INVALID,
        `Trusted skill-script root "${path}" failed canonical observation`,
        { agentType: String(agentType), root: path },
      );
    }
    // A filesystem-root selection can never be a trusted skill tree: it
    // contains every mandatory writable mount by construction (post-review
    // B3 — confinement would refuse it at spawn anyway; failing it HERE keeps
    // every consumer — readiness, inventory, mount — on the same posture).
    if (observation.root === "/") {
      throw new ConfigError(
        ErrorCode.CONFIG_INVALID,
        'Trusted skill-script root cannot be the filesystem root "/" — it contains every agent-writable mount and can never be a read-only skill tree',
        { agentType: String(agentType), root: path },
      );
    }
    return observation;
  };
  if (agentType === "omp") {
    // Image-first, validated dev fallback: the OFFICIAL image always installs
    // the owned root, so development hosts are the only ones reaching the
    // dev branch, and they only when the repository tree really exists.
    if (directoryExists(OMP_IMAGE_SKILLS_ROOT)) return validated(OMP_IMAGE_SKILLS_ROOT);
    if (directoryExists(DEV_SOURCE_SKILLS_ROOT)) return validated(DEV_SOURCE_SKILLS_ROOT);
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
  return validated(root);
}

// ---------------------------------------------------------------------------
// Delivery-boundary contract (`render-delivered-skill-root-contract`)
//
// The three helpers below are the CLASSIFIED render/delivery contract every
// skill-instructing path shares: validate the root a boundary is ABOUT to
// render, quote a complete recipe argument the way a POSIX shell reads it, and
// refuse to deliver a classified prompt that renders without the literal root.
// They add no second root convention, no configuration field and no process
// environment input — the value is always the selected agent's resolved root.
// ---------------------------------------------------------------------------

/**
 * Require the trusted skill-script root a CLASSIFIED boundary is about to
 * render: a nonempty ABSOLUTE path, on the same `ConfigError` failure posture
 * the resolver already uses, so an empty or relative value never renders a
 * skill-less, token-shaped or child-HOME instruction.
 *
 * Defence in depth rather than the mounted-template guard: in production the
 * value comes from {@link resolveTrustedSkillsRoot}, which already fails when
 * no validated root exists, and this re-checks exactly the string a boundary
 * hands to a renderer or to the retry builder. The scenario the spec names for
 * a *mounted* template that renders without any root at all is covered by
 * {@link assertSkillsRootDelivered}, which inspects the rendered result.
 */
export function requireTrustedSkillsRoot(
  root: string | undefined | null,
  boundary: string,
): string {
  if (typeof root !== "string" || root.length === 0) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Missing required trusted skill-script root at ${boundary}: an absent or empty root is never rendered`,
      { boundary, root: root === undefined || root === null ? String(root) : root },
    );
  }
  if (!isAbsolute(root)) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Relative trusted skill-script root "${root}" at ${boundary}: skill recipes need the ` +
        `deployment-owned ABSOLUTE root, never a working-directory-relative or child-HOME spelling`,
      { boundary, root },
    );
  }
  return root;
}

/**
 * POSIX single-quote one complete recipe argument.
 *
 * Single quotes make every character literal — spaces, `$`, backticks and
 * quotes included — so the value reaches the script byte-for-byte. An embedded
 * apostrophe is escaped as the quote-close / escaped-quote / reopen sequence
 * `'\''`, which is the only form POSIX sh accepts inside single quotes. The
 * value is the WHOLE argument (root-plus-script path, id or payload path),
 * never a prefix: quoting the root alone would leave the rest of the path
 * unquoted.
 */
export function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The complete, shell-quoted ABSOLUTE path of one bundled skill script under a
 * trusted root (`{root}/{skill}/scripts/{skill}.ts`, the layout the readiness
 * probe and the retry document reader already use).
 */
export function skillScriptPath(root: string, skill: string): string {
  return quoteShellArgument(`${root}/${skill}/scripts/${skill}.ts`);
}

/**
 * Refuse to deliver a CLASSIFIED prompt whose final text does not carry the
 * literal trusted root.
 *
 * This is the mounted-template guard the spec requires: an operator template
 * that never interpolates the root renders a rootless prompt, and the boundary
 * fails explicitly ALREADY BEFORE delivery instead of sending blank or
 * alternate-root skill instructions. Literal presence proves the root was
 * rendered; it grants no executable authorization and no read parity.
 */
export function assertSkillsRootDelivered(
  rendered: string,
  root: string,
  boundary: string,
): void {
  if (!rendered.includes(root)) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Classified prompt from ${boundary} omitted the required literal trusted skill-script root ` +
        `"${root}": refusing to deliver incomplete skill instructions`,
      { boundary, root },
    );
  }
}
