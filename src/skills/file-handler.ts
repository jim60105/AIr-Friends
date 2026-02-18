// src/skills/file-handler.ts

import { resolve } from "jsr:@std/path@^1/resolve";
import { createLogger } from "@utils/logger.ts";
import { ErrorCode, SkillError } from "../types/errors.ts";
import { filesSentTotal } from "@utils/metrics.ts";
import type { SkillContext, SkillHandler, SkillResult } from "./types.ts";
import type { SendFileSkillConfig } from "../types/config.ts";

const logger = createLogger("FileHandler");

export class FileHandler {
  constructor(private readonly config: SendFileSkillConfig) {}

  handleSendFile: SkillHandler = async (
    parameters: Record<string, unknown>,
    context: SkillContext,
  ): Promise<SkillResult> => {
    // 1. Check if skill is enabled
    if (!this.config.enabled) {
      return { success: false, error: "send-file skill is disabled" };
    }

    // 2. Validate parameters
    const filePath = parameters.filePath;
    if (typeof filePath !== "string" || filePath.trim() === "") {
      return { success: false, error: "Missing or invalid parameter: filePath" };
    }
    const caption = typeof parameters.caption === "string" ? parameters.caption : undefined;

    // 3. Path security validation
    this.validateFilePath(filePath, context);

    // 4. Resolve full path (filePath is relative to workspace)
    const fullPath = resolve(context.workspace.path, filePath);

    // 5. Read file and check size
    let fileContent: Uint8Array;
    try {
      fileContent = await Deno.readFile(fullPath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to read file {filePath}", { filePath: fullPath, error: msg });
      return { success: false, error: `Failed to read file: ${msg}` };
    }

    const fileSizeMb = fileContent.byteLength / (1024 * 1024);
    const maxSizeMb = this.config.maxFileSizeMb ?? 25;
    if (maxSizeMb > 0 && fileSizeMb > maxSizeMb) {
      return {
        success: false,
        error: `File size ${fileSizeMb.toFixed(2)} MB exceeds limit of ${maxSizeMb} MB`,
      };
    }

    // 6. Extension whitelist check
    if (this.config.allowedExtensions && this.config.allowedExtensions.length > 0) {
      const ext = "." + filePath.split(".").pop()?.toLowerCase();
      if (!this.config.allowedExtensions.includes(ext)) {
        return {
          success: false,
          error: `File extension "${ext}" is not allowed. Allowed: ${
            this.config.allowedExtensions.join(", ")
          }`,
        };
      }
    }

    // 7. Send file via platform adapter
    const fileName = filePath.split("/").pop() ?? filePath;
    const result = await context.platformAdapter.sendFile(
      context.channelId,
      fileContent,
      fileName,
      {
        replyToMessageId: context.replyToMessageId,
        comment: caption,
      },
    );

    if (!result.success) {
      return { success: false, error: result.error ?? "Failed to send file" };
    }

    // 8. Update metrics
    filesSentTotal.labels(context.workspace.components.platform).inc();

    logger.info("File sent via skill: {fileName} ({fileSizeMb} MB)", {
      workspaceKey: context.workspace.key,
      channelId: context.channelId,
      fileName,
      fileSizeMb: fileSizeMb.toFixed(2),
      messageId: result.messageId,
    });

    return {
      success: true,
      data: { messageId: result.messageId },
    };
  };

  private validateFilePath(filePath: string, context: SkillContext): void {
    if (filePath.includes("..")) {
      throw new SkillError(ErrorCode.SKILL_INVALID_PARAMS, "Path traversal not allowed");
    }

    const resolved = resolve(context.workspace.path, filePath);
    const workspacePrefix = resolve(context.workspace.path) + "/";
    const inWorkspace = resolved.startsWith(workspacePrefix);

    let inAgentWorkspace = false;
    if (context.agentWorkspacePath) {
      const agentPrefix = resolve(context.agentWorkspacePath) + "/";
      inAgentWorkspace = resolved.startsWith(agentPrefix);
    }

    if (!inWorkspace && !inAgentWorkspace) {
      throw new SkillError(
        ErrorCode.SKILL_INVALID_PARAMS,
        "File path must be within workspace or agent-workspace boundary",
      );
    }
  }
}
