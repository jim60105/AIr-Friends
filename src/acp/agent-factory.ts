// src/acp/agent-factory.ts

import type { AgentConfig, AgentType, RetryPromptStrategy } from "./types.ts";
import type { Config } from "../types/config.ts";
import { SandboxManager } from "./sandbox-manager.ts";
import { getRunningEgressProxyUrl } from "@utils/egress-proxy.ts";
import { join } from "@std/path";

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
  callerToken?: string,
): AgentConfig {
  // Build the base (unfiltered) config for the agent type
  const baseConfig = buildBaseAgentConfig(
    type,
    workingDir,
    appConfig,
    yolo,
    agentWorkspacePath,
    sessionId,
    callerToken,
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
    return {
      command: spawnOpts.command,
      args: spawnOpts.args,
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
    };
  }

  return baseConfig;
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
  callerToken?: string,
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

      // Set TMPDIR to workspace-scoped tmp directory
      env["TMPDIR"] = `${workingDir}/tmp`;

      // Automatically detect and set AGENT_BROWSER_EXECUTABLE_PATH if not already set
      let browserPath = Deno.env.get("AGENT_BROWSER_EXECUTABLE_PATH");
      if (browserPath === undefined) {
        browserPath = detectPlaywrightBinarySync();
      }
      if (browserPath !== undefined) {
        env["AGENT_BROWSER_EXECUTABLE_PATH"] = browserPath;
      }

      if (sessionId) {
        env["SESSION_ID"] = sessionId;
      }

      // Per-session Skill API caller token (F13): only the owning subprocess
      // receives it, so possession of a session ID alone is not sufficient to
      // authenticate against the Skill API.
      if (callerToken) {
        env["SKILL_API_TOKEN"] = callerToken;
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
        cwd: workingDir,
        env,
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
 * Get the retry prompt strategy for a specific agent type.
 * Used when an agent completes a prompt turn without sending a reply.
 * Each agent type may need different retry prompt messages or behaviors.
 */
export function getRetryPromptStrategy(type: AgentType): RetryPromptStrategy {
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

  const defaultRetryMessage =
    `System message: You have a special turn. You must communicate with the user by using send-reply or react-message before ending the session.\n\n---\n\n${sendReplyContent}\n\n---\n\n${reactMessageContent}`;

  switch (type) {
    case "opencode":
      return {
        retryPromptMessage: defaultRetryMessage,
        maxRetries: 1,
      };

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
