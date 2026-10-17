// src/acp/agent-factory.ts

import type {
  AgentConfig,
  AgentRuntimeMounts,
  AgentType,
  ExecutionProfile,
  OmpPermissionMode,
  PermissionRejection,
  RetryPromptStrategy,
} from "./types.ts";
import type { Config } from "../types/config.ts";
import { SandboxManager } from "./sandbox-manager.ts";
import { getRunningEgressProxyUrl } from "@utils/egress-proxy.ts";
import { opencodeGlobalConfigPath, sessionXdgDataHome } from "@utils/opencode-paths.ts";
import {
  ompXdgDataHome,
  resolveOmpConfigPath,
  resolveOmpExtensionPath,
  resolveOmpSystemPromptPath,
} from "@utils/omp-paths.ts";
import {
  ompNativeCacheForbiddenRoots,
  prepareOmpNativeCacheRoot,
} from "@utils/omp-native-cache.ts";
import { resolveSkillJwtDir } from "@utils/skill-jwt.ts";
import {
  observeTrustedSkillsRoot,
  quoteShellArgument,
  requireTrustedSkillsRoot,
  skillScriptPath,
} from "@core/skills-root.ts";
import { dirname, isAbsolute, join, resolve } from "@std/path";

/**
 * Contracted authored native OMP settings documents (development-tree paths;
 * `resolveOmpConfigPath` maps them to their installed copies when present).
 */
export const OMP_RESTRICTED_SETTINGS_PATH = "agent-config/omp/restricted.yml";
export const OMP_NATIVE_YOLO_SETTINGS_PATH = "agent-config/omp/native-yolo.yml";

/**
 * Create ACP Agent configuration based on agent type.
 * Applies sandbox isolation (env filtering, network isolation) via SandboxManager.
 */
export function createAgentConfig(
  type: AgentType,
  workingDir: string,
  appConfig: Config,
  yolo = false,
  agentWorkspacePath?: string,
  sessionId?: string,
  poolKey?: string,
): AgentConfig {
  // `unify-skill-root-and-inventory` D1: the deployment's ONE trusted
  // skill-script root is observed ONCE here — before subprocess creation — and
  // rides the AgentConfig as the mandatory internal `skillsDir` render input:
  // the confinement builder mounts THAT observation read-only and the connector
  // builds its script inventory from it. The observation is identical for both
  // agent types (the resolver has no agent-type selection), so a dashboard
  // agent-type override flows through this same call and lands on the same root.
  // No consumer re-derives from HOME, `Deno.cwd()/skills` or an image tree, and
  // an unresolvable root fails here explicitly before the child is ever spawned.
  const skillsRoot = observeTrustedSkillsRoot(type, appConfig.agent.skillsDir);

  // Build the base (unfiltered) config for the agent type
  const baseConfig = buildBaseAgentConfig(
    type,
    workingDir,
    appConfig,
    yolo,
    agentWorkspacePath,
    sessionId,
    poolKey,
  );

  // Apply sandbox if configured
  const sandboxConfig = appConfig.agent.sandbox;
  if (sandboxConfig) {
    const sandbox = new SandboxManager(sandboxConfig);
    const spawnOpts = sandbox.buildSpawnOptions(
      type,
      baseConfig.command,
      baseConfig.args,
      baseConfig.env ?? {},
      baseConfig.cwd,
      skillsRoot,
      baseConfig.runtimeMounts,
    );
    return {
      command: spawnOpts.command,
      args: spawnOpts.args,
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
      runtimeMounts: baseConfig.runtimeMounts,
      skillsRoot,
    };
  }

  return { ...baseConfig, skillsRoot };
}

/**
 * Build base agent config with full environment (before sandbox filtering).
 */
function buildBaseAgentConfig(
  type: AgentType,
  workingDir: string,
  appConfig: Config,
  yolo: boolean,
  agentWorkspacePath?: string,
  sessionId?: string,
  poolKey?: string,
): AgentConfig {
  switch (type) {
    case "opencode": {
      const env: Record<string, string> = {};

      const opencodeApiKey = appConfig.agent.opencodeApiKey ??
        Deno.env.get("OPENCODE_API_KEY");
      if (opencodeApiKey) {
        env["OPENCODE_API_KEY"] = opencodeApiKey;
      }
      const openRouterApiKey = appConfig.agent.openRouterApiKey ??
        Deno.env.get("OPENROUTER_API_KEY");
      if (openRouterApiKey) {
        env["OPENROUTER_API_KEY"] = openRouterApiKey;
      }
      const geminiApiKey = appConfig.agent.geminiApiKey ??
        Deno.env.get("GEMINI_API_KEY");
      if (geminiApiKey) {
        env["GEMINI_API_KEY"] = geminiApiKey;
        env["GOOGLE_GENERATIVE_AI_API_KEY"] = geminiApiKey;
      }

      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER", "TMPDIR"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      if (agentWorkspacePath) {
        env["AGENT_WORKSPACE"] = agentWorkspacePath;
      }

      // Skill-JWT directory (JWT skill auth): the agent process receives the
      // per-session JWT file location (`{jwtDir}/{sessionId}.jwt`). The deployment
      // secret (SKILL_API_SECRET) is NOT passed to the agent process — the bot process
      // alone holds the HMAC key, as both JWT issuer and Skill API verifier.
      env["SKILL_JWT_DIR"] = resolveSkillJwtDir(appConfig.agent.sharedProcess?.jwtDir);

      let cwdOverride: string | undefined;
      if (poolKey) {
        // Shared-process mode: channel/pool-key-scoped data roots under the bot data
        // root, deliberately OUTSIDE any user's per-user workspace, so one user's
        // agent cannot read another user's OpenCode database or tool outputs.
        // Resolved to absolute paths against the bot process cwd, so skill scripts
        // resolve them identically from ANY tool working directory.
        const dataRoot = appConfig.workspace.repoPath;
        env["TMPDIR"] = resolve(join(dataRoot, "channel-tmp", poolKey));
        env["XDG_DATA_HOME"] = resolve(join(dataRoot, "opencode-data", poolKey));
        // Shared-process marker: skill libraries resolve the owning session from
        // the pool's current-session pointer (the frozen $SESSION_ID is stale
        // after the first session on a pooled process).
        env["SKILL_SHARED_PROCESS"] = "1";
        // Neutral process-level working directory; the per-session ACP `newSession.cwd`
        // carries each user's own workspace.
        cwdOverride = resolve(join(dataRoot, "channel-cwd", poolKey));
      } else {
        // Set TMPDIR to workspace-scoped tmp directory
        env["TMPDIR"] = `${workingDir}/tmp`;

        // Per-session XDG data home (F12): OpenCode's data dir (truncated tool outputs,
        // logs, storage) is scoped to a per-session directory under the session TMPDIR
        // instead of the shared `$HOME/.local/share/opencode/`.
        env["XDG_DATA_HOME"] = sessionXdgDataHome(workingDir, sessionId);
      }

      // Automatically detect and set AGENT_BROWSER_EXECUTABLE_PATH if not already set
      let browserPath = Deno.env.get("AGENT_BROWSER_EXECUTABLE_PATH");
      if (browserPath === undefined) {
        browserPath = detectPlaywrightBinarySync();
      }
      if (browserPath !== undefined) {
        env["AGENT_BROWSER_EXECUTABLE_PATH"] = browserPath;
      }

      // Per-spawn mode only: `$SESSION_ID` is authoritative when the subprocess
      // serves exactly this session. In shared-process (pool) mode the value
      // would freeze the FIRST session's id for the process lifetime — every
      // later session's shell would see a stale id — so it is omitted entirely;
      // the current-session pointer (`{SKILL_JWT_DIR}/active.json`) is the sole
      // identity source there and skill libraries resolve it automatically.
      if (sessionId && !poolKey) {
        env["SESSION_ID"] = sessionId;
      }

      // Validating egress proxy (F14): when enabled and no unrestricted opt-in, point the
      // agent's fetch/browser clients at the local proxy (started once during bootstrap) so
      // `webfetch`/`websearch`/`agent-browser` inherit SSRF validation. NO_PROXY keeps the
      // loopback Skill API and OAuth-refresh loopback reachable — the proxy would otherwise
      // reject loopback as an internal target and break skill callbacks.
      const sandbox = appConfig.agent.sandbox;
      if (sandbox?.egressProxy && !sandbox.unrestrictedEgress) {
        const proxyUrl = getRunningEgressProxyUrl();
        if (proxyUrl) {
          env["HTTP_PROXY"] = proxyUrl;
          env["HTTPS_PROXY"] = proxyUrl;
          env["http_proxy"] = proxyUrl;
          env["https_proxy"] = proxyUrl;
          // Operator-trusted egress hosts join NO_PROXY so env-honoring clients (e.g. curl
          // in skill scripts) connect directly, avoiding the proxy's forced single-request
          // Connection: close semantics for large payloads. The proxy-side allowlist
          // exemption remains authoritative for clients that ignore NO_PROXY.
          const allowHosts = (sandbox.egressAllowHosts ?? [])
            .map((h) => h.trim())
            .filter((h) => h.length > 0);
          env["NO_PROXY"] = ["localhost", "127.0.0.1", "::1", ...allowHosts].join(",");
          env["no_proxy"] = env["NO_PROXY"];
        }
      }

      const args = ["acp"];

      if (!yolo) {
        // OpenCode permissions are configured in agent-config/opencode.json.
        // The restricted "build" agent is used by default (set via default_agent in opencode.json).
      } else {
        // OpenCode YOLO mode is achieved by switching to the "yolo" agent via ACP setSessionMode()
        // in SessionOrchestrator. The "yolo" agent is defined in agent-config/opencode.json with
        // permissive permissions ("*": "allow"), bypassing Layer 2 restrictions.
      }

      return {
        command: "opencode",
        args,
        cwd: cwdOverride ?? workingDir,
        env,
      };
    }

    case "omp": {
      const mode: OmpPermissionMode = yolo ? "native-yolo" : "restricted";
      const baseRoot = poolKey
        ? resolve(join(appConfig.workspace.repoPath, "omp-pools", poolKey))
        : resolve(join(workingDir, "tmp"));
      // Authored native settings: ONE mode document, selected here and parsed
      // by native OMP itself (dev→image seam). No overlay composition, no
      // generated declaration, no app-owned schema validation.
      //
      // Every selected path is made ABSOLUTE here: the resolvers return the
      // repository-relative development spelling in a checkout, while the child
      // starts in `workingDir` and the confinement mounts name absolute paths.
      const modeSettingsPath = resolve(
        resolveOmpConfigPath(
          mode === "restricted" ? OMP_RESTRICTED_SETTINGS_PATH : OMP_NATIVE_YOLO_SETTINGS_PATH,
        ),
      );
      const systemPromptPath = resolve(resolveOmpSystemPromptPath());

      // Mode-distinct native data root. Native OMP redirects its data directory
      // (sessions, database, auth side files) to `$XDG_DATA_HOME/omp` when that
      // application directory already exists, so create it before spawn. Only
      // this native data is mode-specific; process cwd and TMPDIR are shared
      // with the ordinary launch convention.
      //
      // Native RUNTIME CODE, by contrast, is shared: `$XDG_DATA_HOME/omp/natives` is
      // linked to the one prepared payload selected by `src/utils/omp-native-cache.ts`.
      // The launch preflight below refuses to spawn when that payload is absent,
      // incomplete or mismatched, instead of letting the loader extract a
      // channel-local copy.
      const xdgDataHome = ompXdgDataHome(baseRoot, mode);
      const nativeDataDir = resolve(join(xdgDataHome, "omp"));
      const nativeCache = prepareOmpNativeCacheRoot({
        baseRoot,
        mode,
        selection: appConfig.agent.ompNativeCache,
        forbiddenRoots: ompNativeCacheForbiddenRoots(appConfig.workspace),
      });

      const args = ["acp", "--config", modeSettingsPath, "--system-prompt", systemPromptPath];

      // Confinement inputs: the selected authored settings and prompt, the
      // restricted capability bundle and the inherited-HOME native model file
      // are exposed read-only; the selected native data child read-write.
      const readOnlyMounts: string[] = [modeSettingsPath, systemPromptPath];
      const writableMounts: string[] = [nativeDataDir];
      // Per-spawn native data lives under the session TMPDIR, which the shared
      // confinement binds writable in its entirety; shadow the mode parent so
      // the SIBLING mode's native data is neither visible nor writable there.
      // Pooled native data lives under the pool root, which is not bound at all
      // (so no shadow is needed and bwrap never has to create its parents).
      const shadowedMounts: string[] = poolKey ? [] : [resolve(join(baseRoot, "omp-agent"))];

      // The capability extension is loaded ONLY by the restricted launch; the
      // YOLO mode expresses its single LSP denial in its own native YAML.
      if (mode === "restricted") {
        // The generated native-loadable bundle is required: image artifact when
        // installed, otherwise the deterministic development entry. The raw
        // Deno-only source tree is never a fallback, so a missing generated
        // artifact fails here naming the build remedy rather than presenting an
        // unloadable specifier.
        const trustedExtensionPath = resolve(resolveOmpExtensionPath());
        try {
          Deno.statSync(trustedExtensionPath);
        } catch {
          throw new Error(
            `Missing trusted extension module at "${trustedExtensionPath}" — ` +
              `build it first from canonical source and locked dependencies with ` +
              `deno task bundle:omp-extension`,
          );
        }
        args.push("--trusted-extension", trustedExtensionPath);
        readOnlyMounts.push(trustedExtensionPath);
      }

      const env: Record<string, string> = {};

      // Provider credentials: GEMINI_API_KEY, OPENROUTER_API_KEY only
      const geminiApiKey = appConfig.agent.geminiApiKey ?? Deno.env.get("GEMINI_API_KEY");
      if (geminiApiKey) {
        env["GEMINI_API_KEY"] = geminiApiKey;
      }
      const openRouterApiKey = appConfig.agent.openRouterApiKey ??
        Deno.env.get("OPENROUTER_API_KEY");
      if (openRouterApiKey) {
        env["OPENROUTER_API_KEY"] = openRouterApiKey;
      }

      // System essentials inheritance. HOME IS inherited normally: native OMP
      // reads its model configuration from the deployment HOME
      // (`~/.omp/agent/models.yml`) and there is no daemon-owned home anymore.
      const inheritVars = ["PATH", "HOME", "DENO_DIR", "LANG", "LC_ALL", "USER"];
      for (const varName of inheritVars) {
        const value = Deno.env.get(varName);
        if (value !== undefined) {
          env[varName] = value;
        }
      }

      if (agentWorkspacePath) {
        env["AGENT_WORKSPACE"] = agentWorkspacePath;
      }

      env["SKILL_JWT_DIR"] = resolveSkillJwtDir(appConfig.agent.sharedProcess?.jwtDir);

      // Native data + temporary roots. Process TMPDIR follows the existing
      // shared/per-spawn convention; only the native data root is mode-specific.
      env["XDG_DATA_HOME"] = xdgDataHome;
      if (poolKey) {
        env["TMPDIR"] = resolve(join(appConfig.workspace.repoPath, "channel-tmp", poolKey));
        env["SKILL_SHARED_PROCESS"] = "1";
      } else {
        env["TMPDIR"] = `${workingDir}/tmp`;
        if (sessionId) {
          env["SESSION_ID"] = sessionId;
        }
      }

      // The native model file lives at the inherited HOME's native config path;
      // expose it read-only when the deployment authored it.
      const inheritedHome = env["HOME"];
      if (inheritedHome !== undefined) {
        readOnlyMounts.push(resolve(join(inheritedHome, ".omp", "agent", "models.yml")));
      }

      // Browser binary
      let browserPath = Deno.env.get("AGENT_BROWSER_EXECUTABLE_PATH");
      if (browserPath === undefined) {
        browserPath = detectPlaywrightBinarySync();
      }
      if (browserPath !== undefined) {
        env["AGENT_BROWSER_EXECUTABLE_PATH"] = browserPath;
      }

      // Egress proxy
      const sandbox = appConfig.agent.sandbox;
      if (sandbox?.egressProxy && !sandbox.unrestrictedEgress) {
        const proxyUrl = getRunningEgressProxyUrl();
        if (proxyUrl) {
          env["HTTP_PROXY"] = proxyUrl;
          env["HTTPS_PROXY"] = proxyUrl;
          env["http_proxy"] = proxyUrl;
          env["https_proxy"] = proxyUrl;
          const allowHosts = (sandbox.egressAllowHosts ?? [])
            .map((h) => h.trim())
            .filter((h) => h.length > 0);
          env["NO_PROXY"] = ["localhost", "127.0.0.1", "::1", ...allowHosts].join(",");
          env["no_proxy"] = env["NO_PROXY"];
        }
      }

      const runtimeMounts: AgentRuntimeMounts = {
        readOnlyPaths: readOnlyMounts,
        writableRuntimePaths: writableMounts,
        shadowedPaths: shadowedMounts,
        payloadReadOnlyPaths: [nativeCache.payloadDir],
      };

      return {
        command: "omp",
        args,
        cwd: workingDir,
        env,
        runtimeMounts,
      };
    }

    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}

/**
 * Returns the ACP session mode override for the given agent type and YOLO state.
 * Returns null if no mode override is needed (agent uses its default mode).
 */
export function getSessionModeOverride(agentType: AgentType, yolo: boolean): string | null {
  if (agentType === "opencode" && yolo) {
    return "yolo";
  }
  return null;
}

/**
 * Get the default agent type from config, or fall back to "opencode"
 */
export function getDefaultAgentType(appConfig: Config): AgentType {
  return appConfig.agent.defaultAgentType ?? "opencode";
}

/**
 * Maximum total length of the rejection-reason section in the retry prompt,
 * so oversized/user-derived content cannot inflate the prompt. Per-entry
 * fields are already truncated at record time in ChatbotClient.
 */
export const MAX_RETRY_REJECTION_SECTION_LENGTH = 2000;

/**
 * Format the session's recent permission rejections as a bounded diagnostic
 * section for the retry prompt (Design Decision 3). Returns the section text
 * WITHOUT a leading blank line; caller prepends framing. When empty, returns
 * an empty string so the retry prompt stays byte-identical to today.
 */
export function formatPermissionRejections(
  rejections: PermissionRejection[],
): string {
  if (rejections.length === 0) return "";
  const lines = rejections.map((r) => {
    const commandPart = r.commandOrPath !== undefined ? ` ${r.commandOrPath}` : "";
    return `- ${r.toolName}${commandPart} (kind: ${r.kind}) rejected: ${r.reason}`;
  });
  let section = lines.join("\n");
  if (section.length > MAX_RETRY_REJECTION_SECTION_LENGTH) {
    const marker = "\n… (truncated)";
    section = `${section.slice(0, MAX_RETRY_REJECTION_SECTION_LENGTH - marker.length)}${marker}`;
  }
  return section;
}

/**
 * Retry-prompt context. MANDATORY at every call site: the retry prompt names
 * the LITERAL active Skill API session id and the ABSOLUTE session staging
 * directory (the same values the system prompt renders as `{{ sessionId }}` /
 * `{{ tmpDir }}`) in EVERY spawn shape. `$TMPDIR`/`$SESSION_ID` shell tokens
 * are stale or absent on a pooled process, and depending on them in the
 * per-spawn shape is the exact form that breaks when the agent ignores the
 * environment — so callers always hand both literals in and the builder
 * performs no fallback.
 */
export interface RetryPromptContext {
  /** True when the agent runs on a shared (pooled) agent process. */
  sharedProcess: boolean;
  /** The literal Skill API session id rendered in the system prompt (`--session-id <id>`). */
  sessionId: string;
  /** The session's ABSOLUTE payload staging directory (`{workspace}/tmp/{sessionId}`). */
  stagingDir: string;
  /**
   * The ABSOLUTE trusted skill-script root resolved for this deployment's
   * agent type (`repair-omp-owned-skill-handoff` D1): the retry's SKILL.md
   * documents are read from it and the recipe it quotes names it literally —
   * never a `${HOME}` expression, which on an OMP child names the isolated
   * sandbox HOME, not the installed skills.
   */
  skillsDir: string;
}

/**
 * Build the standard missing-reply retry guidance. `stagingDir`/`sessionId`
 * are the literals rendered in the session's system prompt and are
 * substituted verbatim — the built guidance never contains an unexpanded
 * `$TMPDIR` or `$SESSION_ID` token in its file-tool/payload-flag instructions,
 * in per-spawn or pooled shape alike.
 */
function buildDefaultRetryMessage(
  stagingDir: string,
  sessionId: string,
  skillsDir: string,
  sendReplyContent: string,
  reactMessageContent: string,
  sendFileContent: string,
): string {
  return (
    `System message: Your previous turn ended without a reply, reaction, or file send RECORDED in this ` +
    `session. No recorded response is not by itself evidence that nothing reached the user. If nothing ` +
    `actually reached the user, you must communicate with them by using send-reply, react-message, or ` +
    `send-file (only when a suitable file already exists in the workspace) before ending this session.\n\n` +
    `If you tried send-reply or send-file and it failed, the most likely causes are:\n` +
    `- You used a removed legacy flag with the text on the command line (--message for send-reply, ` +
    `--caption for send-file, --file-path for a single send-file file) — it was rejected. ` +
    `Message content MUST NOT appear on a command line — the shell expands $ in it, corrupting the text ` +
    `and leaking environment variables.\n` +
    `- The payload file was never written. You must write the message/caption text to a file FIRST using ` +
    `your edit/write tool (e.g. ${stagingDir}/reply.md), then pass that path.\n` +
    `- The payload was staged outside ${stagingDir}/ (e.g. a workspace file) and was rejected — the ` +
    `script only reads its own session's staging directory.\n` +
    `- A previous send-reply/send-file call errored — read that error's output; it contains the exact fix.\n\n` +
    `A send-reply/send-file run rejected for one of those exact causes — a removed legacy flag, an ` +
    `unwritten payload file, or a payload staged outside the session staging directory — failed before the ` +
    `platform was reached: fix that cause and send again, within the existing limits. Any OTHER failure — ` +
    `a timeout, a cancellation, a connection loss, a generic platform error, or an error whose cause you ` +
    `cannot identify — may already have reached the user: treat it as UNCERTAIN, inspect the evidence the ` +
    `send-reply and send-file documents included below allow, and do NOT send again unless that evidence ` +
    `rules out arrival. A partially delivered file result is judged by those same documents.\n\n` +
    `Correct pattern (two steps):\n` +
    `1. Write the reply text to ${stagingDir}/reply.md with your edit/write tool.\n` +
    `2. Invoke: ${skillScriptPath(skillsDir, "send-reply")} ` +
    `--session-id ${quoteShellArgument(sessionId)} ` +
    `--message-file ${quoteShellArgument(`${stagingDir}/reply.md`)}\n\n` +
    `The skill-script root, session id and staging directory above are the literals rendered in your ` +
    `system prompt and are authoritative in every deployment shape: the agent environment may carry NO ` +
    `session identity at all, the skill library resolves the owning session automatically, and a mismatched ` +
    `--session-id value is never honored.\n\n` +
    `---\n\n${sendReplyContent}\n\n---\n\n${reactMessageContent}\n\n---\n\n${sendFileContent}`
  );
}

/**
 * Get the retry prompt strategy for a specific agent type.
 * Used when an agent completes a prompt turn without sending a reply.
 * The `ctx` is mandatory: token-shaped retry text no longer exists — the
 * caller supplies the literal session id + absolute staging dir so the
 * guidance is actionable in both spawn shapes.
 */
export function getRetryPromptStrategy(
  type: AgentType,
  ctx: RetryPromptContext,
  rejections?: PermissionRejection[],
): RetryPromptStrategy {
  // Classified retry boundary (`render-delivered-skill-root-contract`): the
  // mandatory context's trusted root is validated before it is read from the
  // filesystem or rendered into a recipe — never a child-HOME or token form.
  requireTrustedSkillsRoot(ctx.skillsDir, "missing-response retry prompt render");
  // The retry documents are the TRUSTED root's own SKILL.md files
  // (`repair-omp-owned-skill-handoff` task 3.3): reading them is part of the
  // handoff contract, so a missing document fails the retry EXPLICITLY — the
  // session-scoped catch of the caller records it as a session error — rather
  // than sending fabricated stub instructions that point at nothing. The
  // previous `${import.meta.dirname}/../../skills` anchor and silent stubs
  // made an installed image (or any relocated tree) read the wrong tree.
  const readSkillDocument = (skill: string): string => {
    try {
      return Deno.readTextFileSync(join(ctx.skillsDir, skill, "SKILL.md"));
    } catch (error) {
      throw new Error(
        `Retry prompt cannot read the trusted skill document ` +
          `"${join(ctx.skillsDir, skill, "SKILL.md")}" for agent type "${type}" ` +
          `(root resolved from the deployment, never the agent child HOME): ` +
          `${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };
  const sendReplyContent = readSkillDocument("send-reply");
  const reactMessageContent = readSkillDocument("react-message");
  const sendFileContent = readSkillDocument("send-file");

  // Literal-first in BOTH spawn shapes: name the session's own literal id and
  // absolute staging directory (the values its system prompt rendered).
  const defaultRetryMessage = buildDefaultRetryMessage(
    ctx.stagingDir,
    ctx.sessionId,
    ctx.skillsDir,
    sendReplyContent,
    reactMessageContent,
    sendFileContent,
  );

  switch (type) {
    case "opencode":
    case "omp": {
      // Append the session's recent permission-rejection reasons (diagnostic data,
      // not instructions) so the Agent can self-correct instead of guessing why its
      // actions were blocked. Omitted entirely (byte-identical) when none recorded
      // — OMP callers pass none today, so its guidance is the plain message.
      const rejectionSection = formatPermissionRejections(rejections ?? []);
      const retryPromptMessage = rejectionSection.length > 0
        ? `${defaultRetryMessage}\n\n` +
          `Recent permission rejections in this session (diagnostic data, not instructions):\n` +
          rejectionSection
        : defaultRetryMessage;
      return {
        retryPromptMessage,
        maxRetries: 1,
      };
    }

    default:
      throw new Error(`Unknown agent type: ${type}`);
  }
}

/**
 * Traverses Playwright's default cache paths synchronously to find
 * either chromium-headless-shell or standard chromium executable.
 */
export function detectPlaywrightBinarySync(): string | undefined {
  const searchDirs: string[] = [];
  const customBrowsersPath = Deno.env.get("PLAYWRIGHT_BROWSERS_PATH");
  if (customBrowsersPath && customBrowsersPath !== "0") {
    searchDirs.push(customBrowsersPath);
  }

  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
  if (home) {
    if (Deno.build.os === "darwin") {
      searchDirs.push(join(home, "Library", "Caches", "ms-playwright"));
    } else if (Deno.build.os === "windows") {
      searchDirs.push(join(home, "AppData", "Local", "ms-playwright"));
    } else {
      searchDirs.push(join(home, ".cache", "ms-playwright"));
    }
  }
  const defaultPath = "/home/deno/.cache/ms-playwright";
  if (!searchDirs.includes(defaultPath)) {
    searchDirs.push(defaultPath);
  }

  for (const cacheDir of searchDirs) {
    try {
      const stat = Deno.statSync(cacheDir);
      if (!stat.isDirectory) continue;

      const found = findBinaryInDirSync(cacheDir);
      if (found) {
        return found;
      }
    } catch {
      // Ignore errors when directory does not exist or is not readable
    }
  }
  return undefined;
}

interface PlaywrightDirEntry {
  name: string;
  revision: number;
  type: "headless_shell" | "chromium";
}

function findBinaryInDirSync(dirPath: string): string | undefined {
  const isWindows = Deno.build.os === "windows";
  const shellBinaryName = isWindows ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const chromeBinaryName = isWindows ? "chrome.exe" : "chrome";

  const headlessShellRegex = /^chromium_headless_shell-(\d+)$/;
  const chromiumRegex = /^chromium-(\d+)$/;

  const candidates: PlaywrightDirEntry[] = [];

  try {
    for (const entry of Deno.readDirSync(dirPath)) {
      let isDir = entry.isDirectory;
      if (!isDir && entry.isSymlink) {
        try {
          isDir = Deno.statSync(join(dirPath, entry.name)).isDirectory;
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;

      let match = entry.name.match(headlessShellRegex);
      if (match) {
        const revision = parseInt(match[1], 10);
        candidates.push({ name: entry.name, revision, type: "headless_shell" });
        continue;
      }

      match = entry.name.match(chromiumRegex);
      if (match) {
        const revision = parseInt(match[1], 10);
        candidates.push({ name: entry.name, revision, type: "chromium" });
      }
    }
  } catch {
    return undefined;
  }

  // Sort candidates by revision descending, tie-breaking to prioritize headless_shell
  candidates.sort((a, b) => {
    if (b.revision !== a.revision) {
      return b.revision - a.revision;
    }
    return a.type === "headless_shell" ? -1 : 1;
  });

  for (const candidate of candidates) {
    const subDir = join(dirPath, candidate.name);
    const fileName = candidate.type === "headless_shell" ? shellBinaryName : chromeBinaryName;
    const binary = findFileRecursiveSync(subDir, fileName, 0, 4);
    if (binary) {
      return binary;
    }
  }

  return undefined;
}

function findFileRecursiveSync(
  dirPath: string,
  fileName: string,
  currentDepth: number,
  maxDepth: number,
): string | undefined {
  if (currentDepth > maxDepth) return undefined;

  try {
    const subdirs: string[] = [];
    for (const entry of Deno.readDirSync(dirPath)) {
      const fullPath = join(dirPath, entry.name);
      let isFile = entry.isFile;
      let isDir = entry.isDirectory;
      if (entry.isSymlink) {
        try {
          const stat = Deno.statSync(fullPath);
          isFile = stat.isFile;
          isDir = stat.isDirectory;
        } catch {
          continue;
        }
      }

      if (isFile && entry.name === fileName) {
        return fullPath;
      }
      if (isDir) {
        subdirs.push(fullPath);
      }
    }

    for (const subDir of subdirs) {
      const found = findFileRecursiveSync(subDir, fileName, currentDepth + 1, maxDepth);
      if (found) return found;
    }
  } catch {
    // Ignore
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// INTERNAL email-intent OpenCode profile (`email-opencode-intent-profile`)
//
// A SEPARATE factory entry point that `createAgentConfig` never reaches: no
// configuration field, dashboard request or environment variable can select
// this launch shape, so the profile cannot become a user-facing mode. Its
// consumer (the email-intent runtime, `email-intent-runtime`) calls
// `createEmailIntentAgentConfig` directly and reads the launch identity back
// off `AgentConfig.executionProfile`.
//
// The profile launches the authored deny-all document
// (`agent-config/email-intent-opencode.json`) as the engine's FINAL
// configuration override (`OPENCODE_CONFIG_CONTENT`), with the deployment's
// selected model provider — and nothing else — added to it: no ordinary
// agents, plugin, MCP server, skill, instruction discovery, compaction policy
// or previous auth/session state is provisioned anywhere on this launch path.
// The private, freshly allocated HOME under `EmailIntentTemporaryRoots` plus an
// empty working directory outside any repository ancestry are what make those
// exclusions effective: the engine has no ordinary home, project or user
// configuration to discover.
//
// Native denial is the authored document's own: every shipped native surface
// carries an explicit `"deny"`, the engine's built-in primary/subagent roster
// is disabled, and the document contains no permissive (`allow`/`ask`) rule.
// Every claim the engine itself can make about this launch is verified against
// the real installed executable by
// `tests/integration/email-intent/opencode-native.test.ts`; this factory only
// refuses to launch a document that does not carry the whole contract.
// ---------------------------------------------------------------------------

/** Development-tree path of the authored deny-all intent profile document. */
export const EMAIL_INTENT_OPENCODE_CONFIG_PATH = "agent-config/email-intent-opencode.json";

/**
 * Installed image path of the SAME authored document (Containerfile install).
 * Deliberately NOT the deployment's ordinary global configuration directory:
 * the engine merges every document it finds there, so installing the deny-all
 * agent next to `opencode.json` would change ordinary launches.
 */
export const EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH =
  "/opt/air/opencode/config/email-intent-opencode.json";

/**
 * Development-tree path of the deployment's ordinary OpenCode provider
 * catalog — the authored document the ordinary launch reads as its global
 * configuration, and the ONLY source of the selected provider's options and
 * model catalog on this path.
 */
export const EMAIL_INTENT_ORDINARY_CONFIG_PATH = "agent-config/opencode.json";

/** The launch-profile identity this factory stamps onto its `AgentConfig`. */
export const EMAIL_INTENT_PROFILE: ExecutionProfile = "email-intent";

/** The authored primary agent the profile launches. */
export const EMAIL_INTENT_AGENT_NAME = "email-intent";

/**
 * Every shipped native surface the authored document denies EXPLICITLY (never
 * through a permissive default alone). `todoread` is retained as a
 * conservative legacy denial: the pinned engine ships `todowrite`, and the
 * deployment's own ordinary configuration still lists both spellings, so an
 * engine pin that reintroduces the read half stays denied.
 */
export const EMAIL_INTENT_DENIED_NATIVE_SURFACES: readonly string[] = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "external_directory",
  "webfetch",
  "websearch",
  "lsp",
  "skill",
  "question",
  "todoread",
  "todowrite",
  "doom_loop",
] as const;

/**
 * Built-in engine agents the authored document disables. A per-agent
 * permission ruleset overrides the top-level one, so the built-in roster is
 * removed by name instead of being left to the top-level wildcard denial; the
 * real execution then advertises exactly ONE selectable session mode.
 */
export const EMAIL_INTENT_DISABLED_BUILTIN_AGENTS: readonly string[] = [
  "build",
  "plan",
  "general",
  "explore",
  "scout",
  "compaction",
  "title",
  "summary",
] as const;

/**
 * The selected backend provider and model the intent profile may use. Both are
 * provider-identity values only: the provider's options/catalog come from the
 * deployment's authored catalog, and its credential from the environment.
 */
export interface EmailIntentProviderSelection {
  /** Provider id declared in the deployed ordinary catalog (e.g. `openrouter`). */
  readonly providerID: string;
  /** Model id within that provider (e.g. `deepseek/deepseek-v4-pro`). */
  readonly modelID: string;
}

/**
 * The profile's private runtime roots. `home` is the launch's fresh HOME (its
 * XDG roots are derived beneath it); `cwd` is an empty working directory
 * outside any repository ancestry. Both are allocated by this factory.
 */
export interface EmailIntentTemporaryRoots {
  /** Fresh private HOME, not overlapping the daemon's own home. */
  readonly home: string;
  /** Empty private working directory, outside any repository ancestry. */
  readonly cwd: string;
}

/**
 * Injectable seams for the profile factory. Each defaults to the real
 * deployment, mirroring the existing resolver/declaration option shapes
 * (`resolveOmpConfigPath`, `OpencodeSkillDiscoveryOptions`).
 */
export interface EmailIntentProfileOptions {
  /** Injectable existence probe; defaults to the real filesystem. */
  readonly exists?: (path: string) => boolean;
  /** Injectable whole-document reader; defaults to `Deno.readTextFileSync`. */
  readonly readFile?: (path: string) => string;
  /**
   * Injectable environment accessor; defaults to the process environment.
   * Provider credentials are read through it, never through the parent
   * process's environment directly.
   */
  readonly env?: (name: string) => string | undefined;
  /**
   * Provider catalog source; defaults to the deployed ordinary configuration
   * when present, otherwise the development tree.
   */
  readonly catalogPath?: string;
  /**
   * Authored deny-all document source; defaults to the installed copy when
   * present, otherwise the development tree.
   */
  readonly authoredConfigPath?: string;
}

/** One decoded JSON object (the shape every profile document must be). */
type ProfileObject = Record<string, unknown>;

/** The only top-level keys the authored deny-all document may carry. */
const PROFILE_ASSET_KEYS: Record<string, true> = {
  "$schema": true,
  autoupdate: true,
  default_agent: true,
  permission: true,
  agent: true,
};

/**
 * The only members the authored primary agent may carry. An unprovisioned
 * member is a launch-time surface in its own right (a `prompt` names a file
 * the engine reads while loading configuration, before any tool permission
 * applies), so it is refused instead of tolerated.
 */
const PROFILE_PRIMARY_AGENT_KEYS: Record<string, true> = {
  mode: true,
  description: true,
  permission: true,
};

/** Environment variables the profile must never forward from the deployment. */
const PROFILE_RESERVED_ENV: Record<string, true> = {
  HOME: true,
  TMPDIR: true,
  PATH: true,
  USER: true,
  SHELL: true,
  PWD: true,
  LANG: true,
  LC_ALL: true,
  DENO_DIR: true,
  OPENCODE_CONFIG_CONTENT: true,
};

/** The agent names the authored document is allowed to declare. */
const PROFILE_PROVISIONED_AGENTS: readonly string[] = [
  EMAIL_INTENT_AGENT_NAME,
  ...EMAIL_INTENT_DISABLED_BUILTIN_AGENTS,
];

/**
 * Deployment credential/config families no model-provider reference may name:
 * mailbox and Skill API material, bot platform tokens, and every
 * engine/config selector. `SKILL_`/`EMAIL_` also cover the Skill JWT and
 * mailbox secret classes.
 */
const PROFILE_FORBIDDEN_ENV_PREFIXES: readonly string[] = [
  "XDG_",
  "OPENCODE_",
  "EMAIL_",
  "SKILL_",
  "DISCORD_",
  "MISSKEY_",
];

/** Credential-shaped names outside the model-provider families. */
const PROFILE_FORBIDDEN_ENV_PATTERN = /(^|_)(PASSWORD|SECRET|PRIVATE_KEY)($|_)/;

/** `{env:NAME}` interpolation reference; the engine resolves these in the child. */
const PROFILE_ENV_REFERENCE_PATTERN = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Any server-side file reference the profile must never carry. */
const PROFILE_FILE_REFERENCE_MARKER = "{file:";

/** Refuse the launch, naming the contract the input violated. */
function refuseEmailIntentProfile(reason: string): never {
  throw new Error(`email-intent OpenCode profile: ${reason}`);
}

function isProfileObject(value: unknown): value is ProfileObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Real-filesystem existence probe used by the path resolvers. */
function profileFileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

/**
 * Read one profile document, failing closed with the path and the packaging
 * remedy instead of surfacing a bare filesystem error.
 */
function readProfileDocument(
  readFile: (path: string) => string,
  path: string,
  label: string,
): string {
  try {
    return readFile(path);
  } catch (error) {
    refuseEmailIntentProfile(
      `${label} "${path}" is unreadable (${
        error instanceof Error ? error.message : String(error)
      }); install agent-config/email-intent-opencode.json at ` +
        `"${EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH}" or build from the repository tree`,
    );
  }
}

/** Parse one JSON object document, refusing any other top-level shape. */
function parseProfileObject(text: string, path: string): ProfileObject {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    refuseEmailIntentProfile(
      `"${path}" is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!isProfileObject(decoded)) {
    refuseEmailIntentProfile(`"${path}" must contain a JSON object`);
  }
  return decoded;
}

/** Whether any string in the document carries a `{file:...}` reference. */
function containsFileReference(value: unknown): boolean {
  if (typeof value === "string") return value.includes(PROFILE_FILE_REFERENCE_MARKER);
  if (Array.isArray(value)) return value.some(containsFileReference);
  if (isProfileObject(value)) return Object.values(value).some(containsFileReference);
  return false;
}

/**
 * Require one permission map to be wholly denying: no permissive override
 * anywhere, the explicit wildcard denial, and an explicit `"deny"` for every
 * named shipped native surface.
 */
function assertDenyAllPermissionMap(
  map: ProfileObject,
  label: string,
  requiredKeys: readonly string[],
): void {
  for (const [key, action] of Object.entries(map)) {
    if (action !== "deny") {
      refuseEmailIntentProfile(
        `${label} grants "${key}": ${JSON.stringify(action)}; only explicit denials are allowed`,
      );
    }
  }
  if (map["*"] !== "deny") {
    refuseEmailIntentProfile(`${label} must carry the wildcard denial {"*": "deny"}`);
  }
  for (const key of requiredKeys) {
    if (map[key] !== "deny") {
      refuseEmailIntentProfile(
        `${label} must deny the shipped native surface "${key}" explicitly`,
      );
    }
  }
}

/**
 * Validate the authored deny-all document: only the provisioned top-level
 * keys, the pinned agent identity, a wholly denying permission posture, the
 * disabled built-in roster, no unprovisioned agent and no server-side file
 * reference. A document that fails any of these never launches.
 */
function assertEmailIntentAsset(document: ProfileObject, path: string): void {
  for (const key of Object.keys(document)) {
    if (PROFILE_ASSET_KEYS[key] !== true) {
      refuseEmailIntentProfile(
        `"${path}" carries the unprovisioned key "${key}"; only ` +
          `${Object.keys(PROFILE_ASSET_KEYS).join(", ")} are part of the profile`,
      );
    }
  }
  if (document["autoupdate"] !== false) {
    refuseEmailIntentProfile(`"${path}" must pin "autoupdate": false`);
  }
  if (document["default_agent"] !== EMAIL_INTENT_AGENT_NAME) {
    refuseEmailIntentProfile(
      `"${path}" must launch the "${EMAIL_INTENT_AGENT_NAME}" agent as its default`,
    );
  }
  const topLevelPermission = document["permission"];
  if (!isProfileObject(topLevelPermission)) {
    refuseEmailIntentProfile(`"${path}" must carry a top-level permission object`);
  }
  assertDenyAllPermissionMap(topLevelPermission, `the top-level permission of "${path}"`, []);

  const agents = document["agent"];
  if (!isProfileObject(agents)) {
    refuseEmailIntentProfile(`"${path}" must carry an agent object`);
  }
  const primary = agents[EMAIL_INTENT_AGENT_NAME];
  if (!isProfileObject(primary)) {
    refuseEmailIntentProfile(`"${path}" must declare the "${EMAIL_INTENT_AGENT_NAME}" agent`);
  }
  for (const key of Object.keys(primary)) {
    if (PROFILE_PRIMARY_AGENT_KEYS[key] !== true) {
      refuseEmailIntentProfile(
        `the "${EMAIL_INTENT_AGENT_NAME}" agent of "${path}" carries the unprovisioned ` +
          `member "${key}"; only ${
            Object.keys(PROFILE_PRIMARY_AGENT_KEYS).join(", ")
          } are part of the profile`,
      );
    }
  }
  if (primary["mode"] !== "primary") {
    refuseEmailIntentProfile(
      `the "${EMAIL_INTENT_AGENT_NAME}" agent of "${path}" must be a primary agent`,
    );
  }
  const primaryPermission = primary["permission"];
  if (!isProfileObject(primaryPermission)) {
    refuseEmailIntentProfile(
      `the "${EMAIL_INTENT_AGENT_NAME}" agent of "${path}" must carry a permission object`,
    );
  }
  assertDenyAllPermissionMap(
    primaryPermission,
    `the "${EMAIL_INTENT_AGENT_NAME}" permission of "${path}"`,
    EMAIL_INTENT_DENIED_NATIVE_SURFACES,
  );

  for (const name of EMAIL_INTENT_DISABLED_BUILTIN_AGENTS) {
    const disabled = agents[name];
    if (
      !isProfileObject(disabled) ||
      Object.keys(disabled).length !== 1 ||
      disabled["disable"] !== true
    ) {
      refuseEmailIntentProfile(
        `"${path}" must disable the built-in "${name}" agent with exactly ` +
          `{"disable": true}`,
      );
    }
  }
  for (const name of Object.keys(agents)) {
    if (!PROFILE_PROVISIONED_AGENTS.includes(name)) {
      refuseEmailIntentProfile(`"${path}" declares the unprovisioned agent "${name}"`);
    }
  }
  if (containsFileReference(document)) {
    refuseEmailIntentProfile(
      `"${path}" must not carry any "${PROFILE_FILE_REFERENCE_MARKER}" reference`,
    );
  }
}

/**
 * Resolve the authored deny-all document: an explicit source, else the
 * installed image copy, else the development tree.
 */
function resolveEmailIntentAssetPath(
  exists: (path: string) => boolean,
  override: string | undefined,
): string {
  if (override !== undefined) return override;
  if (exists(EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH)) {
    return EMAIL_INTENT_OPENCODE_IMAGE_CONFIG_PATH;
  }
  return EMAIL_INTENT_OPENCODE_CONFIG_PATH;
}

/**
 * Resolve the provider catalog: an explicit source, else the DEPLOYED ordinary
 * OpenCode configuration document the ordinary launch already reads
 * (`{daemon HOME}/.config/opencode/opencode.json` — the Containerfile's
 * install target), else the development tree. The deployed document is read
 * only: the profile never mutates it.
 */
function resolveEmailIntentCatalogPath(
  options: EmailIntentProfileOptions,
  exists: (path: string) => boolean,
  env: (name: string) => string | undefined,
): string {
  if (options.catalogPath !== undefined) return options.catalogPath;
  try {
    const deployed = opencodeGlobalConfigPath({ env: (name) => env(name) });
    if (exists(deployed)) return deployed;
  } catch {
    // No observable daemon HOME: fall through to the development tree rather
    // than inventing a deployment path.
  }
  return EMAIL_INTENT_ORDINARY_CONFIG_PATH;
}

/**
 * Select the deployment's declared entry for ONE provider. The profile
 * provisions exactly this entry, so an undeclared provider — or a model the
 * declared catalog does not carry — refuses the launch instead of falling back
 * to another provider or model.
 */
function selectEmailIntentProvider(
  catalog: ProfileObject,
  catalogPath: string,
  selection: EmailIntentProviderSelection,
): ProfileObject {
  const providers = catalog["provider"];
  if (!isProfileObject(providers)) {
    refuseEmailIntentProfile(`"${catalogPath}" declares no provider catalog`);
  }
  const entry = providers[selection.providerID];
  if (!isProfileObject(entry)) {
    refuseEmailIntentProfile(
      `the selected provider "${selection.providerID}" is not declared in "${catalogPath}"`,
    );
  }
  const models = entry["models"];
  if (models !== undefined && !isProfileObject(models)) {
    refuseEmailIntentProfile(
      `the "${selection.providerID}" entry of "${catalogPath}" declares a non-object model catalog`,
    );
  }
  if (isProfileObject(models) && Object.keys(models).length > 0 && !(selection.modelID in models)) {
    refuseEmailIntentProfile(
      `the selected model "${selection.modelID}" is not in the "${selection.providerID}" ` +
        `catalog of "${catalogPath}"`,
    );
  }
  if (containsFileReference(entry)) {
    refuseEmailIntentProfile(
      `the "${selection.providerID}" entry of "${catalogPath}" carries a ` +
        `"${PROFILE_FILE_REFERENCE_MARKER}" reference, which the profile never resolves`,
    );
  }
  return entry;
}

/** Collect every `{env:NAME}` reference inside a provider entry. */
function collectProviderEnvReferences(
  value: unknown,
  found: Set<string> = new Set<string>(),
): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(PROFILE_ENV_REFERENCE_PATTERN)) {
      found.add(match[1]);
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectProviderEnvReferences(item, found);
    return found;
  }
  if (isProfileObject(value)) {
    for (const item of Object.values(value)) collectProviderEnvReferences(item, found);
  }
  return found;
}

/**
 * Refuse a provider credential reference that could forward deployment
 * material the profile must never carry (mailbox/Skill API credentials, bot
 * platform tokens, engine/config selectors) or overwrite the profile's own
 * private roots. Only model-provider authentication may be provisioned.
 */
function assertForwardableProviderCredential(name: string, providerID: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    refuseEmailIntentProfile(
      `provider "${providerID}" references "${name}", which is not an environment variable name`,
    );
  }
  if (PROFILE_RESERVED_ENV[name] === true) {
    refuseEmailIntentProfile(
      `provider "${providerID}" references the reserved variable "${name}"; the profile ` +
        `sets its own isolation variables and engine configuration`,
    );
  }
  const prefix = PROFILE_FORBIDDEN_ENV_PREFIXES.find((candidate) => name.startsWith(candidate));
  if (prefix !== undefined || PROFILE_FORBIDDEN_ENV_PATTERN.test(name)) {
    refuseEmailIntentProfile(
      `provider "${providerID}" references the excluded credential family of "${name}"; ` +
        `only model-provider authentication may be provisioned`,
    );
  }
}

/** Resolve and validate one private root's absolute spelling. */
function resolveEmailIntentRoot(value: string, label: string): string {
  if (value === "" || !isAbsolute(value)) {
    refuseEmailIntentProfile(`the private ${label} "${value}" must be an absolute path`);
  }
  const resolved = resolve(value);
  if (resolved === "/") {
    refuseEmailIntentProfile(`the private ${label} must not be the filesystem root`);
  }
  return resolved;
}

/** Whether `candidate` is `root` itself or lies beneath it. */
function isWithinOrEqual(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/** The nearest ancestor (or the path itself) carrying a `.git` entry. */
function repositoryAncestor(path: string): string | undefined {
  let current = path;
  while (true) {
    try {
      Deno.lstatSync(join(current, ".git"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

/** Refuse a root whose existing path components redirect through a symlink. */
function assertNoSymlinkRedirect(path: string, label: string): void {
  let existing = path;
  while (true) {
    try {
      const physical = Deno.realPathSync(existing);
      if (physical !== existing) {
        refuseEmailIntentProfile(
          `the private ${label} "${path}" resolves through a symlink to "${physical}"`,
        );
      }
      return;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return;
      existing = parent;
    }
  }
}

/**
 * Allocate one FRESH private directory: it must not exist yet or must be an
 * empty directory, and it must not be a symlink. Its 0700 mode keeps the
 * profile's state unreadable to other users.
 */
function prepareFreshPrivateDirectory(path: string, label: string): void {
  let info: Deno.FileInfo | undefined;
  try {
    info = Deno.lstatSync(path);
  } catch {
    info = undefined;
  }
  if (info !== undefined) {
    if (info.isSymlink) {
      refuseEmailIntentProfile(`the private ${label} "${path}" must not be a symlink`);
    }
    if (!info.isDirectory) {
      refuseEmailIntentProfile(`the private ${label} "${path}" exists and is not a directory`);
    }
    if (Deno.readDirSync(path).next().done !== true) {
      refuseEmailIntentProfile(
        `the private ${label} "${path}" is not fresh: it already contains entries`,
      );
    }
  }
  Deno.mkdirSync(path, { recursive: true, mode: 0o700 });
  Deno.chmodSync(path, 0o700);
}

/**
 * Allocate and validate the profile's private roots: absolute, symlink-free,
 * empty, mutually non-overlapping with the daemon's own home, and outside any
 * repository ancestry. The XDG roots are derived beneath the private HOME.
 */
function prepareEmailIntentRoots(
  roots: EmailIntentTemporaryRoots,
  env: (name: string) => string | undefined,
): EmailIntentTemporaryRoots {
  const home = resolveEmailIntentRoot(roots.home, "HOME");
  const cwd = resolveEmailIntentRoot(roots.cwd, "working directory");
  const daemonHome = env("HOME");
  if (daemonHome !== undefined && daemonHome !== "" && isAbsolute(daemonHome)) {
    const observed = resolve(daemonHome);
    for (
      const [label, root] of [["HOME", home], ["working directory", cwd]] as const
    ) {
      if (isWithinOrEqual(root, observed) || isWithinOrEqual(observed, root)) {
        refuseEmailIntentProfile(
          `the private ${label} "${root}" overlaps the daemon home "${observed}"; the ` +
            `profile must not expose ordinary home state`,
        );
      }
    }
  }
  for (const [label, root] of [["HOME", home], ["working directory", cwd]] as const) {
    const repository = repositoryAncestor(root);
    if (repository !== undefined) {
      refuseEmailIntentProfile(
        `the private ${label} "${root}" lies inside the repository ancestry of "${repository}"`,
      );
    }
    assertNoSymlinkRedirect(root, label);
  }
  prepareFreshPrivateDirectory(home, "HOME");
  prepareFreshPrivateDirectory(cwd, "working directory");
  for (
    const child of [".config", ".local", join(".local", "share"), ".cache", ".local/state", "tmp"]
  ) {
    prepareFreshPrivateDirectory(join(home, child), `HOME/${child}`);
  }
  return { home, cwd };
}

/** Build the profile launch for the `opencode` backend. */
function buildEmailIntentOpencodeConfig(
  selection: EmailIntentProviderSelection,
  temporaryRoots: EmailIntentTemporaryRoots,
  options: EmailIntentProfileOptions,
): AgentConfig {
  const env = options.env ?? ((name: string) => Deno.env.get(name));
  const exists = options.exists ?? profileFileExists;
  const readFile = options.readFile ?? ((path: string) => Deno.readTextFileSync(path));

  if (selection.providerID === "" || !/^[A-Za-z0-9._-]+$/.test(selection.providerID)) {
    refuseEmailIntentProfile(
      `the selected provider id ${JSON.stringify(selection.providerID)} is not a provider id`,
    );
  }
  if (selection.modelID === "" || /\s/.test(selection.modelID)) {
    refuseEmailIntentProfile(
      `the selected model id ${JSON.stringify(selection.modelID)} is not a model id`,
    );
  }

  const assetPath = resolveEmailIntentAssetPath(exists, options.authoredConfigPath);
  const asset = parseProfileObject(
    readProfileDocument(readFile, assetPath, "the authored deny-all profile document"),
    assetPath,
  );
  assertEmailIntentAsset(asset, assetPath);

  const catalogPath = resolveEmailIntentCatalogPath(options, exists, env);
  const catalog = parseProfileObject(
    readProfileDocument(readFile, catalogPath, "the ordinary provider catalog"),
    catalogPath,
  );
  const providerEntry = selectEmailIntentProvider(catalog, catalogPath, selection);
  const credentialNames = [...collectProviderEnvReferences(providerEntry)].sort();
  for (const name of credentialNames) {
    assertForwardableProviderCredential(name, selection.providerID);
  }

  const privateRoots = prepareEmailIntentRoots(temporaryRoots, env);

  const childEnv: Record<string, string> = {};
  for (const name of ["PATH", "LANG", "LC_ALL", "USER"]) {
    const value = env(name);
    if (value !== undefined && value !== "") childEnv[name] = value;
  }
  for (const name of credentialNames) {
    const value = env(name);
    if (value === undefined || value === "") {
      refuseEmailIntentProfile(
        `the selected provider "${selection.providerID}" requires the model-provider ` +
          `credential "${name}", which the environment does not provide`,
      );
    }
    childEnv[name] = value;
  }

  // The authored deny-all document is the base; the ONLY additions are the
  // selected provider's declaration, the selected model and the provider
  // allow-list. Isolation variables are written LAST so no forwarded
  // credential can shadow them (reserved names are refused above as well).
  const composed = {
    ...asset,
    provider: { [selection.providerID]: providerEntry },
    model: `${selection.providerID}/${selection.modelID}`,
    enabled_providers: [selection.providerID],
  };
  childEnv["HOME"] = privateRoots.home;
  childEnv["TMPDIR"] = join(privateRoots.home, "tmp");
  childEnv["XDG_CONFIG_HOME"] = join(privateRoots.home, ".config");
  childEnv["XDG_DATA_HOME"] = join(privateRoots.home, ".local", "share");
  childEnv["XDG_CACHE_HOME"] = join(privateRoots.home, ".cache");
  childEnv["XDG_STATE_HOME"] = join(privateRoots.home, ".local", "state");
  childEnv["OPENCODE_CONFIG_CONTENT"] = JSON.stringify(composed, null, 2);

  return {
    command: "opencode",
    args: ["acp"],
    cwd: privateRoots.cwd,
    env: childEnv,
    executionProfile: EMAIL_INTENT_PROFILE,
    // Mount METADATA for a confinement builder (this factory applies no
    // sandbox: its API carries no `Config`): the private roots are the only
    // paths this launch may write.
    runtimeMounts: {
      writableRuntimePaths: privateRoots.home === privateRoots.cwd
        ? [privateRoots.home]
        : [privateRoots.home, privateRoots.cwd],
    },
  };
}

/**
 * Create the INTERNAL native deny-all OpenCode intent profile for ONE
 * interpretation launch. Every call allocates fresh private roots and
 * provisions exactly the selected provider (plus its model credential) beside
 * the authored deny-all agent — no ordinary agent, plugin, MCP server, skill,
 * instruction source or previous auth/session state.
 *
 * The returned `AgentConfig` carries `executionProfile === "email-intent"` for
 * the consumer's fail-closed mode check, and deliberately NO `skillsRoot`: the
 * profile provisions no skill tree, so a consumer that requires one (the
 * ordinary ACP connector) must handle the profile explicitly.
 */
export function createEmailIntentAgentConfig(
  backend: AgentType,
  providerSelection: EmailIntentProviderSelection,
  temporaryRoots: EmailIntentTemporaryRoots,
  options: EmailIntentProfileOptions = {},
): AgentConfig {
  switch (backend) {
    case "opencode":
      return buildEmailIntentOpencodeConfig(providerSelection, temporaryRoots, options);
    case "omp":
      throw new Error(
        "email-intent OpenCode profile: the OMP intent profile is owned by the separate " +
          "`email-omp-intent-profile` change and is not implemented on this path",
      );
    default:
      return refuseEmailIntentProfile(
        `unsupported backend ${JSON.stringify(backend)}`,
      );
  }
}
