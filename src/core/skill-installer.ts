// src/core/skill-installer.ts

import { createLogger } from "@utils/logger.ts";
import type { ExternalSkillConfig } from "../types/config.ts";

const logger = createLogger("SkillInstaller");

/**
 * Build the `npx --yes --package=skills skills add` command for a single external skill.
 * Returns a plain { cmd, args } pair so the invocation can be unit-tested without spawning.
 */
export function buildSkillInstallCommand(
  skill: ExternalSkillConfig,
): { cmd: string; args: string[] } {
  return {
    cmd: "npx",
    args: [
      "--yes",
      "--package=skills",
      "skills",
      "add",
      skill.repo,
      "-a",
      "universal",
      "-s",
      skill.skill,
      "-g",
      "-y",
    ],
  };
}

/** Minimal subprocess abstraction so tests can inject a mock without spawning npx. */
export interface SkillInstallExecutor {
  run(
    cmd: string,
    args: string[],
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
}

const defaultExecutor: SkillInstallExecutor = {
  async run(cmd, args) {
    const command = new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    return await command.output();
  },
};

/**
 * Install external skills via `npx --yes --package=skills skills add` command.
 * Each skill is installed sequentially. Failures are logged but do not block startup.
 */
export async function installExternalSkills(
  skills: ExternalSkillConfig[],
  executor: SkillInstallExecutor = defaultExecutor,
): Promise<void> {
  if (skills.length === 0) return;

  logger.info("Installing {count} external skill(s)", { count: skills.length });
  const startTime = Date.now();

  for (const skill of skills) {
    try {
      logger.info("Installing skill {skill} from {repo}", {
        skill: skill.skill,
        repo: skill.repo,
      });

      const { cmd, args } = buildSkillInstallCommand(skill);
      const { code, stdout, stderr } = await executor.run(cmd, args);
      const stdoutText = new TextDecoder().decode(stdout);
      const stderrText = new TextDecoder().decode(stderr);

      if (code !== 0) {
        logger.error("Failed to install skill {skill} from {repo} (exit code {code})", {
          skill: skill.skill,
          repo: skill.repo,
          code,
          stderr: stderrText,
        });
      } else {
        logger.info("Installed skill {skill} from {repo}", {
          skill: skill.skill,
          repo: skill.repo,
          stdout: stdoutText.trim(),
        });
      }
    } catch (error) {
      logger.error("Error installing skill {skill} from {repo}: {error}", {
        skill: skill.skill,
        repo: skill.repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info("External skill installation completed in {elapsed}ms", { elapsed });
}
