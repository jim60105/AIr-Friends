// src/acp/client.ts

import * as acp from "@agentclientprotocol/sdk";
import { join, resolve } from "@std/path";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";
import type { ClientConfig } from "./types.ts";
import type { SkillContext } from "@skills/types.ts";
import type { SessionAuditWriter } from "@core/audit-logger.ts";
import { sha256Hash } from "@utils/hash.ts";

/**
 * Auto-approved skill lists for restricted (non-YOLO) mode.
 */
export interface SkillAutoApproveList {
  /** Script skill path suffixes: "skills/memory-save/scripts/memory-save.ts" */
  scriptPaths: Set<string>;
  /** Command skill prefixes: "agent-browser" */
  commandPrefixes: Set<string>;
}

/**
 * Build skill auto-approve list.
 * When configuredSkills is provided and non-empty, builds the list from config.
 * Otherwise falls back to scanning the skills directory (backward compatible).
 */
export function buildSkillAutoApproveList(
  skillsDir: string,
  configuredSkills?: string[],
): SkillAutoApproveList {
  if (configuredSkills && configuredSkills.length > 0) {
    return buildFromConfig(skillsDir, configuredSkills);
  }
  return buildFromDirectory(skillsDir);
}

/**
 * Build auto-approve list from configured skill names.
 * Scans both the built-in skills directory and ~/.agents/skills/ for external skills.
 */
function buildFromConfig(
  skillsDir: string,
  configuredSkills: string[],
): SkillAutoApproveList {
  const scriptPaths = new Set<string>();
  const commandPrefixes = new Set<string>();

  const scanDirs = [skillsDir];
  const homeSkillsDir = join(Deno.env.get("HOME") ?? "/home/deno", ".agents", "skills");
  try {
    Deno.statSync(homeSkillsDir);
    scanDirs.push(homeSkillsDir);
  } catch {
    // External skills directory doesn't exist
  }

  for (const skillName of configuredSkills) {
    let found = false;
    for (const dir of scanDirs) {
      const scriptsPath = join(dir, skillName, "scripts");
      try {
        for (const script of Deno.readDirSync(scriptsPath)) {
          if (script.isFile && script.name.endsWith(".ts")) {
            scriptPaths.add(`skills/${skillName}/scripts/${script.name}`);
            found = true;
          }
        }
      } catch {
        // No scripts dir in this scan path
      }
    }
    if (!found) {
      // Command-based skill or not yet installed
      commandPrefixes.add(skillName);
    }
  }

  return { scriptPaths, commandPrefixes };
}

/**
 * Build auto-approve list by scanning the skills directory (fallback).
 */
function buildFromDirectory(skillsDir: string): SkillAutoApproveList {
  const scriptPaths = new Set<string>();
  const commandPrefixes = new Set<string>();

  try {
    for (const entry of Deno.readDirSync(skillsDir)) {
      if (!entry.isDirectory || entry.name === "lib") continue;

      const scriptsPath = join(skillsDir, entry.name, "scripts");
      try {
        for (const script of Deno.readDirSync(scriptsPath)) {
          if (script.isFile && script.name.endsWith(".ts")) {
            scriptPaths.add(`skills/${entry.name}/scripts/${script.name}`);
          }
        }
      } catch {
        // No scripts dir — this is a command-based skill
        commandPrefixes.add(entry.name);
      }
    }
  } catch {
    // Skills directory not found — return empty lists
  }

  return { scriptPaths, commandPrefixes };
}

/**
 * Check if a command string contains shell operators that could enable injection.
 * Rejects commands containing: ; | & ` ( ) > < # and newlines.
 * Note: $ is intentionally allowed for shell variable expansion ($HOME, ${VAR}).
 * Command substitution $() is still caught because ( is rejected.
 */
export function containsShellOperators(cmd: string): boolean {
  return /[;|&`()><#\n]/.test(cmd);
}

/**
 * Check if a command contains an allowed script path as a complete token.
 * First rejects commands with shell injection characters,
 * then verifies the path appears as a whitespace-delimited token.
 */
export function matchesScriptPath(cmd: string, allowedPath: string): boolean {
  if (containsShellOperators(cmd)) return false;
  const tokens = cmd.trim().split(/\s+/);
  return tokens.some((token) => token === allowedPath || token.endsWith(`/${allowedPath}`));
}

/**
 * Check if the first token of a command exactly matches an allowed command name.
 * First rejects commands with shell injection characters,
 * then verifies the prefix is the exact first whitespace-delimited token.
 */
export function matchesCommandPrefix(cmd: string, prefix: string): boolean {
  if (containsShellOperators(cmd)) return false;
  const firstToken = cmd.trim().split(/\s+/)[0];
  return firstToken === prefix;
}

/**
 * ChatbotClient implements the ACP Client interface
 * Handles callbacks from external ACP Agents (GitHub Copilot CLI, Gemini CLI)
 */
export class ChatbotClient implements acp.Client {
  private skillRegistry: SkillRegistry;
  private logger: Logger;
  private config: ClientConfig;
  private replyAlreadySent: boolean = false;
  private skillAutoApproveList: SkillAutoApproveList;
  private auditWriter?: SessionAuditWriter;

  /** Timestamp of the last activity received from the Agent */
  private lastActivityTimestamp: number = Date.now();
  private messageBuffer: string[] = [];

  /**
   * Optional listener invoked when the Agent sends a `config_option_update`
   * notification, so the AgentConnector can refresh its cached config options.
   */
  private configOptionsListener?: (configOptions: acp.SessionConfigOption[]) => void;

  constructor(
    skillRegistry: SkillRegistry,
    logger: Logger,
    config: ClientConfig,
    skillAutoApproveList?: SkillAutoApproveList,
  ) {
    this.skillRegistry = skillRegistry;
    this.logger = logger;
    this.config = config;
    this.skillAutoApproveList = skillAutoApproveList ??
      buildSkillAutoApproveList(join(Deno.cwd(), "skills"));
  }

  /**
   * Get the timestamp of the last activity from the Agent.
   * Used by AgentConnector for idle timeout detection.
   */
  getLastActivityTimestamp(): number {
    return this.lastActivityTimestamp;
  }

  /**
   * Reset the idle timeout tracker without affecting other client state.
   * Called after a successful liveness check to grant another timeout window.
   */
  touchActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Set the audit writer for permission decision auditing.
   * Called after session creation when audit writer becomes available.
   */
  setAuditWriter(writer: SessionAuditWriter): void {
    this.auditWriter = writer;
  }

  /**
   * Register a listener that receives the complete config options list whenever the
   * Agent emits a `config_option_update` notification. Used by AgentConnector to keep
   * its cached config options fresh (e.g. after a model change alters `thought_level`).
   */
  setConfigOptionsListener(
    listener: (configOptions: acp.SessionConfigOption[]) => void,
  ): void {
    this.configOptionsListener = listener;
  }

  private updateActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Write a permission decision to the audit log.
   * Fire-and-forget: audit failures never affect permission decisions.
   */
  private async writePermissionAudit(
    phase: "permission_approved" | "permission_denied",
    toolName: string,
    permissionKind: string,
    command: string | undefined,
    reason: string,
  ): Promise<void> {
    if (!this.auditWriter) return;
    const hashContent = this.auditWriter.getConfig().hashContent;
    const commandValue = hashContent && command ? `sha256:${await sha256Hash(command)}` : command;
    void this.auditWriter.write(phase, {
      toolName,
      permissionKind,
      command: commandValue,
      decision: phase === "permission_approved" ? "approved" : "denied",
      reason,
    });
    this.auditWriter.incrementPermissionDecisions();
  }

  /**
   * Handle permission requests from the Agent
   * Auto-approves our registered skills and access to skills directory
   * In YOLO mode, auto-approves ALL permission requests
   */
  requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    this.updateActivity();
    this.logger.debug("Permission requested", {
      toolCall: params.toolCall,
      kind: params.toolCall.kind,
      yolo: this.config.yolo,
    });

    // Extract and log key permission details at INFO level for operational visibility
    const title = params.toolCall.title ?? "";
    const kind = params.toolCall.kind ?? "unknown";
    const rawInput = params.toolCall.rawInput as Record<string, unknown> | undefined;
    const locations = params.toolCall.locations ?? [];

    // Log external directory access requests
    if (title === "external_directory" || (kind === "other" && title.includes("directory"))) {
      const paths = locations.map((l) => l.path).filter(Boolean);
      this.logger.info(
        "Agent requested external directory access: {title}",
        {
          title,
          kind,
          paths: paths.length > 0 ? paths : undefined,
          rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
          toolCallId: params.toolCall.toolCallId,
        },
      );
    }

    // Log bash/shell command execution requests (non-skill commands)
    if (kind === "execute" || title === "bash" || title === "terminal") {
      const commands = (rawInput?.commands as string[]) ??
        (rawInput?.command ? [rawInput.command as string] : []);
      this.logger.info(
        "Agent requested command execution: {title}",
        {
          title,
          kind,
          commands,
          rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
          toolCallId: params.toolCall.toolCallId,
        },
      );
    }

    // YOLO mode: auto-approve everything
    if (this.config.yolo) {
      this.logger.info("YOLO mode: auto-approving permission for {title}", {
        kind: params.toolCall.kind,
        title: params.toolCall.title,
        rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
        locations: locations.length > 0 ? locations.map((l) => l.path) : undefined,
      });

      void this.writePermissionAudit("permission_approved", title, kind, undefined, "yolo_mode");

      const allowOption = params.options.find((o) => o.kind === "allow_once") ??
        params.options[0];

      return Promise.resolve({
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      });
    }

    // Auto-approve read access to skills directory
    // External agents need to read SKILL.md files to understand available skills
    if (params.toolCall.kind === "read" && params.toolCall.locations) {
      const skillsPath = "/home/deno/.copilot/skills";
      const isReadingSkills = params.toolCall.locations.some((loc) =>
        loc.path?.startsWith(skillsPath)
      );

      if (isReadingSkills) {
        this.logger.info("Auto-approving skills directory read: {path}", {
          path: params.toolCall.locations.map((l) => l.path).join(", "),
        });

        void this.writePermissionAudit(
          "permission_approved",
          title,
          kind,
          undefined,
          "skills_directory_access",
        );

        const allowOption = params.options.find((o) => o.kind === "allow_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        });
      }
    }

    // Auto-approve shell execution for our skill commands (whitelist-based)
    if (params.toolCall.kind === "execute") {
      const rawInput = params.toolCall.rawInput as
        | { command?: string; commands?: string[] }
        | undefined;
      const commands = rawInput?.commands ?? (rawInput?.command ? [rawInput.command] : []);

      // Check if all commands match our skill allow list
      const isSkillCommand = commands.length > 0 &&
        commands.every((cmd) => {
          // Check script-based skills (safe token match against allowed paths)
          const isScript = Array.from(this.skillAutoApproveList.scriptPaths).some(
            (allowedPath) => matchesScriptPath(cmd, allowedPath),
          );
          if (isScript) return true;

          // Check command-based skills (safe first-token match against allowed prefixes)
          const isCommand = Array.from(this.skillAutoApproveList.commandPrefixes).some(
            (prefix) => matchesCommandPrefix(cmd, prefix),
          );
          return isCommand;
        });

      if (isSkillCommand) {
        this.logger.info("Auto-approving skill shell execution: {command}", {
          command: commands.join("; "),
        });

        void this.writePermissionAudit(
          "permission_approved",
          title,
          kind,
          commands.join("; "),
          "skill_whitelist",
        );

        const allowOption = params.options.find((o) => o.kind === "allow_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        });
      }
    }

    // Extract skill name from tool call (only works for ToolCall, not ToolCallUpdate)
    let skillName = "";
    // Check if this is a complete ToolCall (not just an update)
    if ("rawInput" in params.toolCall && params.toolCall.rawInput) {
      skillName = this.extractSkillName(params.toolCall as acp.ToolCall);
    }

    // Check if this is one of our registered skills
    if (skillName && this.skillRegistry.hasSkill(skillName)) {
      this.logger.info("Auto-approving registered skill: {skillName}", { skillName });

      void this.writePermissionAudit(
        "permission_approved",
        skillName,
        kind,
        undefined,
        "registered_skill",
      );

      // Find "allow_once" option, or default to first option
      const allowOption = params.options.find((o) => o.kind === "allow_once") ??
        params.options[0];

      return Promise.resolve({
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      });
    }

    // Scoped edit/write: allow if ALL paths are within agent workspace or TMPDIR
    if (title === "edit" || title === "edit_file" || kind === "write" as string) {
      let paths = locations.map((l) => l.path).filter(Boolean) as string[];

      // When locations are empty, try extracting paths from rawInput
      if (paths.length === 0 && rawInput) {
        const extracted = this.extractPathsFromRawInput(rawInput);
        if (extracted.length > 0) {
          paths = extracted;
          this.logger.debug(
            "Extracted paths from rawInput for edit/write permission: {paths}",
            { paths },
          );
        }
      }

      const isAgentWorkspaceWrite = paths.length > 0 &&
        paths.every((p) => this.isAgentWorkspacePath(p!));

      if (isAgentWorkspaceWrite) {
        // Check extension restrictions for non-TMPDIR agent workspace paths
        const disallowedPaths = paths.filter((p) => {
          const resolved = resolve(p!);
          return !this.isWithinTmpDir(resolved) && !this.hasAllowedWriteExtension(p!);
        });

        if (disallowedPaths.length > 0) {
          this.logger.warn(
            "Rejecting edit/write due to disallowed file extension: {title}",
            {
              title,
              kind,
              paths: disallowedPaths,
              allowedExtensions: this.config.allowedWriteExtensions,
            },
          );

          void this.writePermissionAudit(
            "permission_denied",
            title,
            kind,
            undefined,
            "rejected_write_extension",
          );
        } else {
          this.logger.info(
            "Auto-approving edit/write to agent workspace: {title}",
            { title, kind, paths },
          );

          void this.writePermissionAudit(
            "permission_approved",
            title,
            kind,
            undefined,
            "agent_workspace_write",
          );

          const allowOption = params.options.find((o) => o.kind === "allow_once") ??
            params.options[0];

          return Promise.resolve({
            outcome: {
              outcome: "selected",
              optionId: allowOption.optionId,
            },
          });
        }
      }

      this.logger.warn("Rejecting edit/write tool in restricted mode: {title}", {
        title,
        kind,
        paths,
      });

      void this.writePermissionAudit(
        "permission_denied",
        title,
        kind,
        undefined,
        "rejected_edit_write",
      );
    } else {
      // For unknown tool calls, reject
      this.logger.warn("Rejecting unknown tool call", {
        skillName,
        title: params.toolCall.title,
      });

      void this.writePermissionAudit(
        "permission_denied",
        title,
        kind,
        undefined,
        "rejected_unknown",
      );
    }

    const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
      params.options[0];

    return Promise.resolve({
      outcome: {
        outcome: "selected",
        optionId: rejectOption.optionId,
      },
    });
  }

  /**
   * Handle session updates from the Agent
   * Logs various agent activities but doesn't send them externally
   */
  sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this.updateActivity();
    const update = params.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        // Agent is generating response - log but don't send
        if (update.content.type === "text") {
          this.logger.debug("Agent message chunk: {text}", {
            text: update.content.text.substring(0, 100),
          });
          // Accumulate text chunks for complete message logging
          this.messageBuffer.push(update.content.text);
        }
        break;

      case "tool_call":
        this.flushMessageBuffer();
        this.logger.info(
          "Tool call started: {title} (id: {id}, kind: {kind})",
          {
            id: update.toolCallId,
            title: update.title,
            kind: update.kind,
            status: update.status,
          },
        );
        break;

      case "tool_call_update": {
        this.flushMessageBuffer();
        // Log tool call updates with full context
        const logContext: Record<string, unknown> = {
          id: update.toolCallId,
          status: update.status,
        };

        // Add error information if status is failed
        if (update.status === "failed") {
          // ACP SDK may include error details in various fields
          const updateAny = update as Record<string, unknown>;
          if (updateAny.output) {
            logContext.output = updateAny.output;
          }
          if (updateAny.error) {
            logContext.error = updateAny.error;
          }
          if (updateAny.exitCode !== undefined) {
            logContext.exitCode = updateAny.exitCode;
          }
          // Log full update object for debugging
          logContext.fullUpdate = JSON.stringify(update);
          this.logger.error("Tool call {id} failed", logContext);
        } else {
          this.logger.info("Tool call {id} updated to status {status}", logContext);
        }
        break;
      }

      case "plan":
        this.flushMessageBuffer();
        this.logger.debug("Agent plan", {
          entriesCount: update.entries?.length ?? 0,
        });
        break;

      case "agent_thought_chunk":
        this.flushMessageBuffer();
        // Agent's thinking process - only log
        this.logger.debug("Agent thought", {
          hasContent: update.content?.type === "text",
          text: update.content?.type === "text" ? update.content.text.substring(0, 100) : "",
        });
        break;

      case "usage_update": {
        this.flushMessageBuffer();
        // Token usage information from the agent
        const usageUpdate = update as unknown as {
          sessionUpdate: "usage_update";
          used?: number;
          size?: number;
          cost?: { amount: number; currency: string };
        };
        this.logger.info("Agent usage update: tokens {used}/{size}", {
          used: usageUpdate.used,
          size: usageUpdate.size,
          cost: usageUpdate.cost,
        });
        break;
      }

      case "config_option_update": {
        this.flushMessageBuffer();
        // Agent reports the complete updated config option state; propagate to the connector
        // so reasoning-effort discovery uses fresh options (e.g. after a model change).
        const configOptions = (update as unknown as {
          configOptions?: acp.SessionConfigOption[];
        }).configOptions;
        if (Array.isArray(configOptions)) {
          this.logger.debug("Config options updated ({count} options)", {
            count: configOptions.length,
          });
          this.configOptionsListener?.(configOptions);
        } else {
          // Defensive: notification shape lacked a parseable configOptions array.
          // Log so silent cache staleness is diagnosable instead of invisible.
          this.logger.warn(
            "config_option_update received without a parseable configOptions array",
          );
        }
        break;
      }

      default:
        this.flushMessageBuffer();
        this.logger.debug("Session update", {
          type: (update as { sessionUpdate?: string }).sessionUpdate,
        });
    }

    return Promise.resolve();
  }

  /**
   * Handle file read requests from the Agent
   * Only allows reading files within the working directory
   */
  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    this.updateActivity();
    this.logger.debug("Read file requested", { path: params.path });

    // Validate path is within working directory
    if (!this.isPathAllowed(params.path)) {
      throw new acp.RequestError(
        -32600,
        "Access denied: path outside working directory",
      );
    }

    try {
      const content = await Deno.readTextFile(params.path);
      return { content };
    } catch (error) {
      throw new acp.RequestError(
        -32600,
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Handle file write requests from the Agent
   * Only allows writing files within the working directory
   */
  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    this.updateActivity();
    this.logger.debug("Write file requested", { path: params.path });

    // Validate path is within working directory
    if (!this.isPathAllowed(params.path)) {
      throw new acp.RequestError(
        -32600,
        "Access denied: path outside working directory",
      );
    }

    // Defense-in-depth: check extension for agent workspace writes in restricted mode
    if (!this.config.yolo) {
      const resolvedPath = resolve(params.path);
      const agentWorkspacePath = this.config.agentWorkspacePath
        ? resolve(this.config.agentWorkspacePath)
        : null;
      const tmpDir = resolve(this.config.workingDir, "tmp");

      if (
        agentWorkspacePath && resolvedPath.startsWith(agentWorkspacePath) &&
        !resolvedPath.startsWith(tmpDir)
      ) {
        if (!this.hasAllowedWriteExtension(params.path)) {
          throw new acp.RequestError(
            -32600,
            `Access denied: file extension not allowed for agent workspace writes (permitted: ${
              this.config.allowedWriteExtensions?.join(", ")
            })`,
          );
        }
      }
    }

    try {
      await Deno.writeTextFile(params.path, params.content);
      return {};
    } catch (error) {
      throw new acp.RequestError(
        -32600,
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Extract skill name from tool call
   * Tries rawInput.skill field first, then falls back to title
   */
  private extractSkillName(toolCall: acp.ToolCall): string {
    const rawInput = toolCall.rawInput as { skill?: string } | undefined;
    return rawInput?.skill ?? toolCall.title ?? "";
  }

  /**
   * Create skill context for skill execution
   */
  private createSkillContext(): Partial<SkillContext> {
    return {
      channelId: this.config.channelId,
      userId: this.config.userId,
      // Note: workspace and platformAdapter should be added by caller
    };
  }

  /**
   * Validate that a path is within the allowed directories
   * Allows: user workspace OR agent global workspace
   */
  private isPathAllowed(path: string): boolean {
    try {
      const normalizedPath = resolve(path);
      const normalizedWorkingDir = resolve(this.config.workingDir);
      if (normalizedPath.startsWith(normalizedWorkingDir)) return true;

      if (this.config.agentWorkspacePath) {
        const normalizedAgentWorkspace = resolve(this.config.agentWorkspacePath);
        if (normalizedPath.startsWith(normalizedAgentWorkspace)) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a path is within the agent workspace or workspace TMPDIR.
   * Used to scope edit/write permissions for self-research.
   * Equivalent to agent-config/opencode.json: "edit": { "data/agent-workspace/**": "allow", "$TMPDIR/**": "allow" }
   */
  private isAgentWorkspacePath(path: string): boolean {
    try {
      const normalizedPath = resolve(path);

      // Check agent workspace path
      if (this.config.agentWorkspacePath) {
        const normalizedAgentWorkspace = resolve(this.config.agentWorkspacePath);
        if (normalizedPath.startsWith(normalizedAgentWorkspace)) return true;
      }

      // Check workspace TMPDIR
      if (this.isWithinTmpDir(normalizedPath)) return true;

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a resolved path is within the workspace TMPDIR
   */
  private isWithinTmpDir(resolvedPath: string): boolean {
    try {
      const tmpDir = resolve(this.config.workingDir, "tmp");
      return resolvedPath.startsWith(tmpDir);
    } catch {
      return false;
    }
  }

  /**
   * Try to extract file paths from rawInput when locations are empty.
   * Different ACP agents may include paths in various rawInput fields.
   */
  private extractPathsFromRawInput(rawInput: Record<string, unknown>): string[] {
    const paths: string[] = [];

    // Single path fields (common across agent types)
    for (const field of ["path", "file_path", "filePath", "filepath", "file", "filename"]) {
      const value = rawInput[field];
      if (typeof value === "string" && value.length > 0) {
        paths.push(value);
      }
    }

    // Array path fields
    for (const field of ["paths", "files"]) {
      const value = rawInput[field];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.length > 0) {
            paths.push(item);
          }
        }
      }
    }

    return paths;
  }

  /**
   * Check if a file path has an allowed write extension for agent workspace writes.
   * Returns true if no restrictions are configured or if the extension is in the allowed list.
   */
  private hasAllowedWriteExtension(filePath: string): boolean {
    const extensions = this.config.allowedWriteExtensions;
    if (!extensions || extensions.length === 0) return true;
    const dotIndex = filePath.lastIndexOf(".");
    if (dotIndex === -1 || dotIndex === filePath.length - 1) return false;
    const ext = filePath.substring(dotIndex).toLowerCase();
    return extensions.some((e) => ext === e.toLowerCase());
  }

  /**
   * Mark that a reply has been sent (for preventing duplicate replies)
   */
  markReplySent(): void {
    this.replyAlreadySent = true;
  }

  /**
   * Flush the accumulated agent message chunks as a single complete message log entry.
   * Called when a non-chunk session update arrives or when the prompt completes.
   */
  flushMessageBuffer(): void {
    if (this.messageBuffer.length === 0) return;

    const completeMessage = this.messageBuffer.join("");
    const chunkCount = this.messageBuffer.length;
    this.logger.info("Agent complete message ({chunkCount} chunks, {length} chars): {message}", {
      message: completeMessage,
      chunkCount,
      length: completeMessage.length,
    });

    if (this.auditWriter) {
      const writer = this.auditWriter;
      const hashContent = writer.getConfig().hashContent;
      const msgLen = completeMessage.length;
      if (hashContent) {
        sha256Hash(completeMessage).then((hash) => {
          void writer.write("agent_complete_message", {
            messageContentHash: `sha256:${hash}`,
            messageLength: msgLen,
            chunkCount,
          });
        });
      } else {
        void writer.write("agent_complete_message", {
          messageContentHash: completeMessage,
          messageLength: msgLen,
          chunkCount,
        });
      }
    }

    this.messageBuffer = [];
  }

  /**
   * Reset client state for new session
   */
  reset(): void {
    this.flushMessageBuffer();
    this.replyAlreadySent = false;
    this.lastActivityTimestamp = Date.now();
    this.auditWriter = undefined;
  }

  /**
   * Get whether reply has been sent
   */
  hasReplySent(): boolean {
    return this.replyAlreadySent;
  }
}
