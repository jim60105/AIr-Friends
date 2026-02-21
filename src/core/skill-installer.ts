// src/core/skill-installer.ts

import { createLogger } from "@utils/logger.ts";
import type { ExternalSkillConfig } from "../types/config.ts";

const logger = createLogger("SkillInstaller");

/**
 * Install external skills via `deno x -y skills add` command.
 * Each skill is installed sequentially. Failures are logged but do not block startup.
 */
export async function installExternalSkills(
  skills: ExternalSkillConfig[],
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

      const command = new Deno.Command("deno", {
        args: [
          "x",
          "-y",
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
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await command.output();
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
