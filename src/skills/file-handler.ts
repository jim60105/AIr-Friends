// src/skills/file-handler.ts

import { resolve } from "jsr:@std/path@^1/resolve";
import { createLogger } from "@utils/logger.ts";
import { ErrorCode, SkillError } from "../types/errors.ts";
import { filesSentTotal } from "@utils/metrics.ts";
import type { SkillContext, SkillHandler, SkillResult } from "./types.ts";
import type { SendFilePayload } from "../types/platform.ts";
import type { SendFileSkillConfig } from "../types/config.ts";
import { stripXmlTags, unescapeNewlines } from "./reply-handler.ts";

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
    const filePaths = parameters.filePaths;
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return {
        success: false,
        error: "Missing or invalid parameter: filePaths (must be a non-empty array)",
      };
    }
    if (filePaths.some((p) => typeof p !== "string" || p.trim() === "")) {
      return {
        success: false,
        error: "Invalid 'filePaths' parameter: every path must be a non-empty string",
      };
    }
    const caption = typeof parameters.caption === "string" ? parameters.caption : undefined;

    // 3. Batch count limit BEFORE reading any file bytes
    const maxFiles = this.config.maxFilesPerInvocation ?? 10;
    if (filePaths.length > maxFiles) {
      return {
        success: false,
        error:
          `Too many files: ${filePaths.length} exceeds the per-invocation limit of ${maxFiles}`,
      };
    }

    // 4. Preflight validation (all-or-nothing): every path is checked
    //    (traversal, boundary incl. symlink escape, extension) and stat'ed
    //    BEFORE any bytes are read.
    const validated: Array<{ filePath: string; fullPath: string }> = [];
    let totalBytes = 0;
    for (const filePath of filePaths) {
      // Path security validation (lexical)
      this.validateFilePath(filePath, context);

      // Extension whitelist check
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

      // Stat the file for size checks (no bytes read yet)
      const fullPath = resolve(context.workspace.path, filePath);
      let size: number;
      try {
        size = (await Deno.stat(fullPath)).size;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to stat file {filePath}", { filePath: fullPath, error: msg });
        return { success: false, error: `Failed to read file: ${msg}` };
      }

      // Per-file size limit
      const fileSizeMb = size / (1024 * 1024);
      const maxSizeMb = this.config.maxFileSizeMb ?? 25;
      if (maxSizeMb > 0 && fileSizeMb > maxSizeMb) {
        return {
          success: false,
          error: `File size ${fileSizeMb.toFixed(2)} MB exceeds limit of ${maxSizeMb} MB`,
        };
      }

      // Symlink-escape check: Deno.stat/readFile follow symlinks, so the REAL
      // path of the file must also be inside the workspace/agent-workspace
      // boundary — a workspace symlink pointing outside must not be sent.
      this.validateRealPath(fullPath, context);

      totalBytes += size;
      validated.push({ filePath, fullPath });
    }

    // 5. Aggregate batch size limit BEFORE reading any file bytes
    const maxTotalMb = this.config.maxTotalSizeMb ?? 50;
    const totalSizeMb = totalBytes / (1024 * 1024);
    if (maxTotalMb > 0 && totalSizeMb > maxTotalMb) {
      return {
        success: false,
        error: `Total file size ${
          totalSizeMb.toFixed(2)
        } MB exceeds batch limit of ${maxTotalMb} MB`,
      };
    }

    // 6. Read all files (still before any platform call — preflight all-or-nothing)
    const files: SendFilePayload[] = [];
    for (const { filePath, fullPath } of validated) {
      try {
        const fileContent = await Deno.readFile(fullPath);
        files.push({
          content: fileContent,
          fileName: filePath.split("/").pop() ?? filePath,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to read file {filePath}", { filePath: fullPath, error: msg });
        return { success: false, error: `Failed to read file: ${msg}` };
      }
    }

    // 7. Caption content pipeline — identical to send-reply (strip XML tags,
    //    then unescape literal \n) so captions render like reply messages.
    const comment = caption !== undefined ? unescapeNewlines(stripXmlTags(caption)) : undefined;

    // 8. Send files via platform adapter
    const result = await context.platformAdapter.sendFile(
      context.channelId,
      files,
      {
        replyToMessageId: context.replyToMessageId,
        comment,
      },
    );

    // Delivered file count: full success delivers the whole batch; a partial
    // failure (Misskey chat sends one message per file) delivers one file per
    // reported message ID.
    const deliveredCount = result.success ? files.length : (result.messageIds?.length ?? 0);

    if (deliveredCount === 0) {
      return { success: false, error: result.error ?? "Failed to send files" };
    }

    // 9. Update metrics (once per delivered file). Session response state
    //    (fileSent) is marked by the Skill API server per session.
    filesSentTotal.labels(context.workspace.components.platform).inc(deliveredCount);

    logger.info("Files sent via skill: {fileNames} ({deliveredCount} delivered)", {
      workspaceKey: context.workspace.key,
      channelId: context.channelId,
      fileNames: files.map((f) => f.fileName).join(", "),
      deliveredCount,
      messageIds: result.messageIds?.join(","),
    });

    if (!result.success) {
      // Partial delivery: report the platform error alongside the delivered IDs
      // so the agent sees what reached the platform.
      return {
        success: false,
        error: result.error ?? "Failed to send files (partial delivery)",
        data: {
          messageIds: result.messageIds,
          messageId: result.messageId,
          filesCount: deliveredCount,
        },
      };
    }

    return {
      success: true,
      data: {
        messageIds: result.messageIds,
        messageId: result.messageId ?? result.messageIds?.[result.messageIds.length - 1],
        filesCount: deliveredCount,
        nextAction: "You have done your job. EXIT IMMEDIATELY",
      },
    };
  };

  /**
   * Check that the REAL path of a file (after symlink resolution) is inside the
   * workspace or agent-workspace boundary. Lexical prefix checks are not enough:
   * Deno.stat/readFile follow symlinks, so a workspace symlink pointing outside
   * (e.g. `workspace/leak.pdf -> /etc/passwd`) must be rejected.
   */
  private validateRealPath(fullPath: string, context: SkillContext): void {
    let realPath: string;
    try {
      realPath = Deno.realPathSync(fullPath);
    } catch {
      // File existence is validated by the earlier stat; a realPath failure here
      // (e.g. a broken symlink) is treated as an out-of-bounds/read failure.
      throw new SkillError(
        ErrorCode.SKILL_INVALID_PARAMS,
        "File path must be within workspace or agent-workspace boundary",
      );
    }

    const isWithin = (base: string): boolean => {
      let realBase: string;
      try {
        realBase = Deno.realPathSync(base);
      } catch {
        return false;
      }
      return realPath === realBase || realPath.startsWith(realBase + "/");
    };

    if (
      !isWithin(context.workspace.path) &&
      !(context.agentWorkspacePath && isWithin(context.agentWorkspacePath))
    ) {
      throw new SkillError(
        ErrorCode.SKILL_INVALID_PARAMS,
        "File path must be within workspace or agent-workspace boundary",
      );
    }
  }

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
