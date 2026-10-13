// src/core/template-renderer.ts

import vento from "ventojs";
import type { Environment } from "ventojs/core/environment.ts";
import { resolve } from "@std/path";
import { createLogger } from "@utils/logger.ts";
import { quoteShellArgument, skillScriptPath } from "./skills-root.ts";
import { ConfigError, ErrorCode } from "../types/errors.ts";

const logger = createLogger("TemplateRenderer");

export type { Environment };

/**
 * Trusted template helpers supplied to EVERY render's variable context.
 *
 * A template cannot derive a shell-safe recipe from a bare root string: the
 * root (or the staging directory) may contain spaces, `$`, backticks or
 * apostrophes, so the complete argument has to be quoted with the same POSIX
 * formatter the retry builder uses (`src/core/skills-root.ts`). These are pure
 * formatters with no root binding — classification and root validation stay at
 * the classified call sites, which keeps generic and dashboard renders (e.g.
 * the web-chat template) free of any skills requirement.
 */
const TRUSTED_TEMPLATE_HELPERS: Record<string, unknown> = {
  /** POSIX single-quote one complete recipe argument. */
  quoteShellArgument,
  /** Quoted absolute script path under a trusted root: `skillScript(root, name)`. */
  skillScript: skillScriptPath,
};

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
    const result = await env.run(absPath, { ...TRUSTED_TEMPLATE_HELPERS, ...variables });
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
    const result = await env.runString(templateContent, {
      ...TRUSTED_TEMPLATE_HELPERS,
      ...variables,
    });
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
