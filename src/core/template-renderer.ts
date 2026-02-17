// src/core/template-renderer.ts

import vento from "ventojs";
import type { Environment } from "ventojs/core/environment.ts";
import { resolve } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import { ConfigError, ErrorCode } from "../types/errors.ts";

const logger = createLogger("TemplateRenderer");

export type { Environment };

/**
 * Initialize Vento environment with project-specific configuration
 */
export function createTemplateEngine(promptsDir: string): Environment {
  const env = vento({
    includes: resolve(promptsDir),
    autoescape: false,
    autoDataVarname: true,
    dataVarname: "it",
  });

  return env;
}

/**
 * Render a template file with given variables.
 * The templatePath is resolved to an absolute path before rendering.
 */
export async function renderTemplate(
  env: Environment,
  templatePath: string,
  variables: Record<string, unknown>,
): Promise<string> {
  const absPath = resolve(templatePath);
  try {
    const result = await env.run(absPath, variables);
    return result.content.trim();
  } catch (error) {
    logger.error("Failed to render template {templatePath}", {
      templatePath: absPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Failed to render template: ${error instanceof Error ? error.message : String(error)}`,
      { templatePath: absPath },
    );
  }
}

/**
 * Render a template string directly (for inline templates)
 */
export async function renderTemplateString(
  env: Environment,
  templateContent: string,
  variables: Record<string, unknown>,
): Promise<string> {
  try {
    const result = await env.runString(templateContent, variables);
    return result.content.trim();
  } catch (error) {
    logger.error("Failed to render template string", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `Failed to render template string: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
