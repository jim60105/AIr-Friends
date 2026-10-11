// src/acp/agent-factory.ts

import type { AgentConfig, AgentType, PermissionRejection, RetryPromptStrategy } from "./types.ts";
import type { Config } from "../types/config.ts";
import { SandboxManager } from "./sandbox-manager.ts";
import { getRunningEgressProxyUrl } from "@utils/egress-proxy.ts";
import { sessionXdgDataHome } from "@utils/opencode-paths.ts";
import {
  ompAgentDir,
  ompLaunchCwd,
  ompOwnedHome,
  ompProcessTmpDir,
  ompXdgDataHome,
  resolveOmpConfigPath,
  resolveOmpSystemPromptPath,
  resolveOmpTrustedExtensionPath,
} from "@utils/omp-paths.ts";
import {
  OMP_FOREIGN_PROVIDER_ENV_SELECTORS,
  type OmpPermissionMode,
  ompSettingsForMode,
  type OmpSettingsSourcePlan,
  ompSettingsSourcePlan,
} from "./omp-settings.ts";
import { sanitizeOmpDiscoveryEnv } from "./sandbox-manager.ts";
import { createLogger } from "@utils/logger.ts";
import { resolveSkillJwtDir } from "@utils/skill-jwt.ts";
import { join, resolve } from "@std/path";

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
    );
    if (type === "omp" && baseConfig.settingsSourcePlan) {
      // Belt-and-braces: mandatory sanitization runs inside buildSpawnOptions;
      // finalization then (re)assigns the plan values and verifies the FINAL
      // spawn environment so later sandbox assembly cannot drop or overwrite
      // a trusted value (row 26, D2).
      sanitizeOmpDiscoveryEnv(spawnOpts.env);
      finalizeOmpSpawnEnvironment(spawnOpts.env, baseConfig.settingsSourcePlan);
    }
    return {
      command: spawnOpts.command,
      args: spawnOpts.args,
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
      settingsSourcePlan: baseConfig.settingsSourcePlan,
    };
  }

  if (type === "omp" && baseConfig.settingsSourcePlan) {
    // Unsandboxed route still gets the mandatory sanitization + trusted plan
    // assignment and the plan verification (D2 is mandatory, not filterEnv-
    // conditional; the sandbox branch simply performs it earlier).
    const env = baseConfig.env ?? {};
    sanitizeOmpDiscoveryEnv(env);
    finalizeOmpSpawnEnvironment(env, baseConfig.settingsSourcePlan);
    baseConfig.env = env;
  }
  return baseConfig;
}

/**
 * Row 26 (D2): trusted post-filter environment finalization for OMP children.
 *
 * Runs AFTER ordinary sandbox filtering (and after the mandatory
 * `sanitizeOmpDiscoveryEnv` removal inside `SandboxManager`), and assigns the
 * deployment-owned settings-discovery selectors EXCLUSIVELY from the typed
 * settings-source plan — never from operator passthrough or workspace data.
 * It then verifies the final spawn environment against the plan so a later
 * sandbox-assembly bug cannot drop or overwrite a trusted value:
 *
 * - `HOME` = plan.ownedHome (explicitly assigned; unset HOME would let the
 *   native homedir fallback return the daemon home)
 * - `PI_CODING_AGENT_DIR` = plan.agentDir
 * - `XDG_DATA_HOME` = plan.xdgDataHome
 * - `TMPDIR` = plan.tmpDir
 *
 * Every other forbidden selector must be ABSENT (e.g. an assembly that forgot
 * the sanitization step). Throws with a bounded, content-free reason.
 */
export function finalizeOmpSpawnEnvironment(
  env: Record<string, string>,
  plan: OmpSettingsSourcePlan,
): void {
  // Trusted assignment: plan values verbatim, overwriting anything inherited.
  env["HOME"] = plan.ownedHome;
  env["PI_CODING_AGENT_DIR"] = plan.agentDir;
  env["XDG_DATA_HOME"] = plan.xdgDataHome;
  env["TMPDIR"] = plan.tmpDir;

  // Observation: the final spawn environment must match the plan.
  const expected: Readonly<Record<string, string>> = {
    "HOME": plan.ownedHome,
    "PI_CODING_AGENT_DIR": plan.agentDir,
    "XDG_DATA_HOME": plan.xdgDataHome,
    "TMPDIR": plan.tmpDir,
  };
  for (const [selector, planValue] of Object.entries(expected)) {
    if (env[selector] !== planValue) {
      throw new Error(
        `OMP spawn environment violates the settings-source plan: ${selector} is not the deployment-owned value`,
      );
    }
  }
  for (const selector of plan.forbiddenSelectors) {
    if (selector in expected) continue;
    if (selector in env) {
      throw new Error(
        `OMP spawn environment violates the settings-source plan: ${selector} survived sanitization`,
      );
    }
  }
  // Foreign provider selectors are never plan-owned and never permitted in any
  // form: an assembly that skipped sanitization must fail closed on them too.
  for (const selector of OMP_FOREIGN_PROVIDER_ENV_SELECTORS) {
    if (selector in env) {
      throw new Error(
        `OMP spawn environment violates the settings-source plan: ${selector} survived sanitization`,
      );
    }
  }
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
      // Row 26: the launch composes its settings-source plan over the SAME
      // mode-scoped base root it spawns with (single formula), below, once the
      // overlay paths are resolved.
      const settings = ompSettingsForMode(mode);

      // Observability: warn on unresolved record reset gate
      if (settings.recordResetGate.status === "unresolved") {
        const log = createLogger("AgentFactory");
        log.warn("OMP record-reset gate is unresolved; relying on execution-time default-deny", {
          mode,
          operativeBoundary: settings.recordResetGate.operativeSecurityBoundary,
        });
      }

      // Disjointness check: native-yolo launch must not contain restricted-only overlays
      if (mode === "native-yolo") {
        const restrictedPaths = new Set(ompSettingsForMode("restricted").orderedOverlayPaths);
        for (const overlayPath of settings.orderedOverlayPaths) {
          if (restrictedPaths.has(overlayPath)) {
            throw new Error(
              `Contamination detected: restricted overlay "${overlayPath}" present in native-yolo launch`,
            );
          }
        }
      }

      // Fail-closed checks on required assets: trusted extension module and overlay files
      // Row-20 dev→image seam (src/utils/omp-paths.ts): the launch assembly
      // consumes the resolver output VERBATIM — image path when the owned
      // /opt/air/omp tree exists, byte-identical dev path otherwise. No
      // second path convention; the fail-closed checks and their errors stay
      // row 9's.
      const trustedExtensionPath = resolveOmpTrustedExtensionPath();
      try {
        Deno.statSync(trustedExtensionPath);
      } catch {
        throw new Error(`Missing trusted extension module at "${trustedExtensionPath}"`);
      }
      const resolvedOverlayPaths = settings.orderedOverlayPaths.map((overlayPath) =>
        resolveOmpConfigPath(overlayPath)
      );
      for (const overlayPath of resolvedOverlayPaths) {
        try {
          Deno.statSync(overlayPath);
        } catch {
          throw new Error(`Missing owned overlay configuration file at "${overlayPath}"`);
        }
      }

      // Argument assembly: acp, --no-extensions, --no-lsp, ordered overlays, --trusted-extension, --system-prompt
      // Decision 5 (docs/OMP_COMPATIBILITY.md §1a): `--no-lsp` is carried unconditionally in BOTH
      // modes — restricted (which also keeps the row-8 `restricted.yml` lsp.enabled: false pin) and
      // native-YOLO (whose mandatory settings pin arrives later with row 25
      // `pin-omp-yolo-lsp-settings`; this flag is the row-17 carrier, independent of it). The flag
      // appears exactly once per launch and no restricted tool policy crosses into YOLO.
      const args = ["acp", "--no-extensions", "--no-lsp"];
      for (const overlayPath of resolvedOverlayPaths) {
        args.push("--config", overlayPath);
      }
      args.push("--trusted-extension", trustedExtensionPath);
      args.push("--system-prompt", resolveOmpSystemPromptPath());

      // Row 26: the FINAL settings-source plan carries the RESOLVED owned
      // overlay paths (dev→image seam), mode document last.
      const sourcePlan = ompSettingsSourcePlan(mode, {
        baseRoot,
        allowedOverlayPaths: resolvedOverlayPaths.map((overlayPath) => resolve(overlayPath)),
      });

      // Base root resolution and mode-distinct state roots
      // (baseRoot composed above, ahead of the settings-plan construction.)

      const agentDir = ompAgentDir(baseRoot, mode);
      const procTmpDir = ompProcessTmpDir(baseRoot, mode);
      const launchCwd = ompLaunchCwd(baseRoot, mode);
      const xdgData = ompXdgDataHome(baseRoot, mode);
      // Row 26: deployment-owned HOME replacing the daemon HOME.
      const ownedHome = ompOwnedHome(baseRoot, mode);

      // Ensure state directories exist
      Deno.mkdirSync(agentDir, { recursive: true });
      Deno.mkdirSync(procTmpDir, { recursive: true });
      Deno.mkdirSync(launchCwd, { recursive: true });
      Deno.mkdirSync(xdgData, { recursive: true });
      Deno.mkdirSync(ownedHome, { recursive: true });

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

      // System essentials inheritance. Row 26: HOME is deliberately NOT
      // inherited here — the settings-source plan owns the child HOME and
      // `finalizeOmpSpawnEnvironment` assigns it after ordinary filtering;
      // inheriting the daemon HOME would only hand sanitization more work.
      const inheritVars = ["PATH", "DENO_DIR", "LANG", "LC_ALL", "USER"];
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

      // State & temporary roots
      env["PI_CODING_AGENT_DIR"] = agentDir;
      env["TMPDIR"] = procTmpDir;
      env["XDG_DATA_HOME"] = xdgData;

      if (poolKey) {
        env["SKILL_SHARED_PROCESS"] = "1";
      } else if (sessionId) {
        env["SESSION_ID"] = sessionId;
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

      return {
        command: "omp",
        args,
        cwd: launchCwd,
        env,
        settingsSourcePlan: sourcePlan,
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
  sendReplyContent: string,
  reactMessageContent: string,
  sendFileContent: string,
): string {
  return (
    `System message: Your previous turn ended without sending a reply, reaction, or file to the user. ` +
    `You must communicate with the user by using send-reply, react-message, or send-file (only when a ` +
    `suitable file already exists in the workspace) before ending this session.\n\n` +
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
    `Correct pattern (two steps):\n` +
    `1. Write the reply text to ${stagingDir}/reply.md with your edit/write tool.\n` +
    `2. Invoke: \${HOME}/.agents/skills/send-reply/scripts/send-reply.ts --session-id "${sessionId}" ` +
    `--message-file "${stagingDir}/reply.md"\n\n` +
    `The session id and staging directory above are the literals rendered in your system prompt and ` +
    `are authoritative in every deployment shape: the agent environment may carry NO session identity ` +
    `at all, the skill library resolves the owning session automatically, and a mismatched ` +
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
  const skillsDir = `${import.meta.dirname}/../../skills`;

  let sendReplyContent: string;
  try {
    sendReplyContent = Deno.readTextFileSync(`${skillsDir}/send-reply/SKILL.md`);
  } catch {
    sendReplyContent = "# Send Reply Skill\n\nUse send-reply to send a message to the user.";
  }

  let reactMessageContent: string;
  try {
    reactMessageContent = Deno.readTextFileSync(`${skillsDir}/react-message/SKILL.md`);
  } catch {
    reactMessageContent =
      "# React Message Skill\n\nUse react-message to add an emoji reaction to the trigger message.";
  }

  let sendFileContent: string;
  try {
    sendFileContent = Deno.readTextFileSync(`${skillsDir}/send-file/SKILL.md`);
  } catch {
    sendFileContent = "# Send File Skill\n\nUse send-file to send a file from the workspace.";
  }

  // Literal-first in BOTH spawn shapes: name the session's own literal id and
  // absolute staging directory (the values its system prompt rendered).
  const defaultRetryMessage = buildDefaultRetryMessage(
    ctx.stagingDir,
    ctx.sessionId,
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
