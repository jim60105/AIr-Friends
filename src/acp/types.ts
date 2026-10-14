// src/acp/types.ts

import type { IdleTimeoutConfig } from "../types/config.ts";
import type { TrustedSkillsSource } from "./filesystem-policy.ts";
import type { LinuxNativeCalls } from "./filesystem-access-linux.ts";
import type { SkillsRootObservation } from "@core/skills-root.ts";

/**
 * Configuration for ACP Client
 */
export interface ClientConfig {
  /** Working directory for the session */
  workingDir: string;

  /**
   * Skill API session id of this ACP session, when one exists (skill-backed sessions).
   * Used to scope the agent's `XDG_DATA_HOME` (and the permission gate's tool-output
   * boundary) to THIS session, so concurrent sessions of the same user never share
   * OpenCode's data directory / truncated tool outputs.
   */
  sessionId?: string;

  /** Agent global workspace path */
  agentWorkspacePath?: string;

  /** Platform identifier */
  platform: string;

  /** User ID */
  userId: string;

  /** Channel ID */
  channelId: string;

  /** Whether this is a DM conversation */
  isDM: boolean;

  /** YOLO mode: auto-approve all permission requests */
  yolo?: boolean;

  /**
   * Process-level shell TMPDIR of the agent subprocess (shared-process mode:
   * channel-scoped `{dataRoot}/channel-tmp/{poolKey}`). The permission gate's
   * `$TMPDIR` expansion mirrors the real subprocess environment.
   */
  processTmpDir?: string;

  /** Skill names to auto-approve in restricted (non-YOLO) mode */
  autoApproveSkills?: string[];

  /**
   * The deployment-configured `agent.skillsDir` value the trusted-root resolver
   * is called with (`unify-skill-root-and-inventory`): the ONE skill-root input
   * for BOTH agent types — never a HOME or arbitrary cwd scan, and never a
   * per-agent alternate tree. The resolved root itself rides the
   * factory-produced `skillsRoot` observation on the AgentConfig; this field
   * carries the configured spelling it came from.
   */
  skillsDir?: string;

  /** Allowed file extensions for agent workspace writes in restricted mode */
  allowedWriteExtensions?: string[];

  /**
   * Whether this session may WRITE to the shared agent workspace (F3).
   * Only self-research sessions are authorized to author shared notes. When unset or
   * `false`, edit/write requests targeting the shared agent workspace are rejected even
   * if path/extension checks pass. Writes to the per-session TMPDIR remain allowed
   * regardless of this flag.
   */
  canWriteAgentWorkspace?: boolean;

  /**
   * Whether per-chunk agent stream DEBUG logs (`Agent thought:` /
   * `Agent message chunk:`) are emitted (mirrors `logging.agentStreamChunks`).
   * When unset or false, chunks are still buffered and flushed as the INFO
   * complete-thought/complete-message summaries — only the per-chunk noise is
   * suppressed.
   */
  logAgentStreamChunks?: boolean;

  /**
   * Process-level `XDG_DATA_HOME` of the agent subprocess (set by agent-factory).
   * In shared-process mode this is the pool-key-scoped data root
   * (`{dataRoot}/opencode-data/{poolKey}`); the permission gate uses it for the
   * tool-output boundary so truncated tool outputs stay inside the channel-scoped
   * data root, outside any user's workspace. When unset (per-spawn mode) the gate
   * falls back to the per-session workspace-scoped data home.
   */
  xdgDataHome?: string;

  /** Deployment-owned trusted skills provenance */
  trustedSkills?: TrustedSkillsSource;

  /** Optional injectable native backend calls for testing */
  nativeCalls?: LinuxNativeCalls;

  /**
   * INTERNAL connector context (`normalize-omp-destructive-acp-ingress`): the
   * configured ACP agent type of the connector that owns this client. The ACP
   * client uses it ONLY to select the OMP destructive-ingress normalizer; it is
   * never read from request metadata, so a caller cannot select the decoder.
   * Direct client fixtures that omit it keep the legacy/OpenCode decoder path.
   */
  agentType?: AgentType;
}

/**
 * Configuration for ACP Agent
 */
export interface AgentConfig {
  /** Command to execute (e.g., "opencode") */
  command: string;

  /** Arguments to pass to the command */
  args: string[];

  /** Working directory for the agent */
  cwd: string;

  /** Environment variables */
  env?: Record<string, string>;

  /**
   * Additional runtime mounts for THIS agent launch, merged with the shared
   * confinement defaults by `SandboxManager.buildSpawnOptions()`. Only the OMP
   * factory populates it, to expose the selected authored native assets
   * read-only and the selected native mode data child read-write. OpenCode
   * leaves it unset and keeps its existing mounts unchanged.
   */
  runtimeMounts?: AgentRuntimeMounts;

  /**
   * `unify-omp-skill-root-resolution` D1: the canonical physical observation of
   * the deployment trusted skill-script root for THIS config's SELECTED agent
   * type, produced once by the factory before subprocess creation. It is the
   * MANDATORY internal render input every downstream consumer shares — the
   * connector's script inventory, the bwrap read-only mount, and (identity to
   * the same resolver) prompt/retry rendering. A launch without it cannot
   * build a permission inventory; there is no HOME or `Deno.cwd()/skills`
   * fallback.
   */
  skillsRoot?: SkillsRootObservation;
}

/**
 * Optional per-launch confinement mounts, sharing the array shape the
 * confinement builder already consumes.
 */
export interface AgentRuntimeMounts {
  /**
   * Extra paths bound read-only inside the confinement. They are emitted AFTER
   * every writable bind, so a mandatory writable ancestor cannot widen them.
   */
  readOnlyPaths?: readonly string[];
  /** Extra paths bound read-write inside the confinement. */
  writableRuntimePaths?: readonly string[];
  /**
   * Paths shadowed by an empty tmpfs before the extra mounts are emitted, so a
   * mode's sibling state directories under a mandatory writable ancestor are
   * neither visible nor writable. Only paths whose parent is already bound may
   * be listed.
   */
  shadowedPaths?: readonly string[];
}

/**
 * The two native OMP approval modes a launch can select. The mode is fixed at
 * process launch (no ACP session-mode override exists for OMP) and selects the
 * authored native settings document and the mode-specific native data root.
 */
export type OmpPermissionMode = "restricted" | "native-yolo";

/**
 * Supported ACP Agent types
 */
export type AgentType = "opencode" | "omp";

/**
 * Complete set of supported ACP Agent types recognized across configuration,
 * default selection, dashboard validation, and factory dispatch.
 */
export const SUPPORTED_AGENT_TYPES: readonly AgentType[] = [
  "opencode",
  "omp",
] as const;

/**
 * Strict acceptance predicate for supported ACP agent types.
 * Acceptance at configuration/selection layer is distinct from launch availability.
 * Values differing only by case or surrounding whitespace are NOT supported.
 */
export function isSupportedAgentType(value: unknown): value is AgentType {
  return (
    typeof value === "string" &&
    (SUPPORTED_AGENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * MCP transport capabilities reported by Agent
 */
export interface MCPCapabilities {
  /** Whether the Agent supports HTTP transport for MCP servers */
  http?: boolean;
  /** Whether the Agent supports SSE transport for MCP servers */
  sse?: boolean;
}

/**
 * Prompt content capabilities (image, audio, embeddedContext)
 * Reported by Agent during initialization
 */
export interface PromptCapabilities {
  /** Agent supports ContentBlock::Image in prompt requests */
  image?: boolean;
  /** Agent supports ContentBlock::Audio in prompt requests */
  audio?: boolean;
  /** Agent supports ContentBlock::Resource (embedded context) */
  embeddedContext?: boolean;
}

/**
 * Agent capabilities reported during initialization
 */
export interface AgentCapabilities {
  /** Whether the Agent supports loading previous sessions */
  loadSession?: boolean;
  /** MCP transport capabilities */
  mcpCapabilities?: MCPCapabilities;
  /** Prompt content type capabilities */
  promptCapabilities?: PromptCapabilities;
}

/**
 * MCP Server configuration base
 */
export interface BaseMCPServerConfig {
  /** Human-readable identifier for the server */
  name: string;
}

/**
 * MCP Server using stdio transport (required support by all Agents)
 */
export interface StdioMCPServerConfig extends BaseMCPServerConfig {
  /** The absolute path to the MCP server executable */
  command: string;
  /** Command-line 引數 to pass to the server */
  args: string[];
  /** Environment 變數 to set when launching the server */
  env?: Array<{ name: string; value: string }>;
}

/**
 * MCP Server using HTTP transport (optional capability)
 */
export interface HTTPMCPServerConfig extends BaseMCPServerConfig {
  /** Must be "http" to indicate HTTP transport */
  type: "http";
  /** The URL of the MCP server */
  url: string;
  /** HTTP headers to include in requests */
  headers?: Array<{ name: string; value: string }>;
}

/**
 * MCP Server using SSE transport (optional capability, deprecated)
 */
export interface SSEMCPServerConfig extends BaseMCPServerConfig {
  /** Must be "sse" to indicate SSE transport */
  type: "sse";
  /** The URL of the SSE endpoint */
  url: string;
  /** HTTP headers to include when establishing the SSE connection */
  headers?: Array<{ name: string; value: string }>;
}

/**
 * Union type for all MCP server configurations
 */
export type MCPServerConfig =
  | StdioMCPServerConfig
  | HTTPMCPServerConfig
  | SSEMCPServerConfig;

/**
 * Retry prompt strategy for different agent types.
 * Used when an agent completes without sending a reply.
 */
export interface RetryPromptStrategy {
  /** The prompt message to send when retrying */
  retryPromptMessage: string;

  /** Maximum number of retry attempts (should be 1 to avoid infinite loops) */
  maxRetries: number;
}

/**
 * A permission denial recorded by ChatbotClient for retry-prompt feedback.
 * Collected on EVERY denial path (requestPermission + writeTextFile) so the
 * missing-reply retry prompt can tell the Agent WHY its actions were blocked.
 */
export interface PermissionRejection {
  /** Tool name as reported by the agent (e.g. "write", "bash", "send-reply") */
  toolName: string;

  /** ACP tool kind of the request (e.g. "edit", "execute") */
  kind: string;

  /** The rejected command or path (truncated at record time) */
  commandOrPath?: string;

  /** Machine-readable rejection reason (e.g. "rejected_edit_write") */
  reason: string;

  /** ISO 8601 timestamp of the rejection */
  ts: string;
}

/**
 * Options for AgentConnector
 */
export interface AgentConnectorOptions {
  agentConfig: AgentConfig;
  clientConfig: ClientConfig;
  skillRegistry: unknown; // SkillRegistry type - using unknown to avoid circular deps
  logger: unknown; // Logger type - using unknown to avoid circular deps
  idleTimeoutConfig?: IdleTimeoutConfig;
  /**
   * The SELECTED agent type for this connector — what the child process is
   * launched as, and the context reasoning-effort warnings name. It does NOT
   * select a skill root or shape the script inventory
   * (`unify-skill-root-and-inventory` D1/D2): the connector consumes the
   * factory-resolved `AgentConfig.skillsRoot` observation, which is the
   * deployment's one root for both agent types.
   */
  agentType: AgentType;
  /** Maximum time in milliseconds to wait for the ACP handshake during `connect()` (default: 30000) */
  connectTimeoutMs?: number;
}
