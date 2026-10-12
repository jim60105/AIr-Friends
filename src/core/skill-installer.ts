// src/core/skill-installer.ts
//
// Explicit external-skill publication (`unify-omp-skill-root-resolution` D5).
// External installation runs at DAEMON startup, into one EXPLICIT destination:
// the resolver's OpenCode installed root (the same tree the OpenCode inventory
// scans). The third-party `skills` CLI never touches the daemon's ambient HOME
// and never becomes the trusted root: each install materializes into a PRIVATE
// temporary HOME, and only the validated requested directory is published into
// the explicit destination. Publication refuses bundled-name/`lib` collisions,
// traversal, and linked/escaping source or destination entries; an existing
// EXTERNAL entry may be refreshed. Completion is awaited by bootstrap BEFORE
// any connector inventory is constructed.

import { createLogger } from "@utils/logger.ts";
import type { ExternalSkillConfig } from "../types/config.ts";
import { collidesWithBundledContent, isValidSkillNameComponent } from "@core/bundled-skills.ts";

const logger = createLogger("SkillInstaller");

/**
 * Build the `npx --yes --package=skills skills add` command for a single external
 * skill. `--copy` materializes real files (no symlinks into an npx cache) so the
 * publication step can validate a physically self-contained tree. Returns a plain
 * { cmd, args } pair so the invocation can be unit-tested without spawning.
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
      "--copy",
    ],
  };
}

/** Minimal subprocess abstraction so tests can inject a mock without spawning npx. */
export interface SkillInstallExecutor {
  run(
    cmd: string,
    args: string[],
    options?: { env?: Record<string, string> },
  ): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }>;
}

const defaultExecutor: SkillInstallExecutor = {
  async run(cmd, args, options) {
    const command = new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
      ...(options?.env ? { env: options.env, clearEnv: true } : {}),
    });
    return await command.output();
  },
};

/** Rejection raised for an unsafe skill entry; isolated per entry by the caller. */
class SkillPublicationError extends Error {}

/**
 * Recursively copy a physically validated tree. ANY link inside the
 * materialized tree is refused — a link that pointed inside the private
 * staging tree would dangle or repoint at the published location, so an
 * external skill ships only real directories and regular files (the `--copy`
 * install posture materializes exactly that).
 */
function copyValidatedTree(source: string, target: string): void {
  const stat = Deno.lstatSync(source);
  if (stat.isSymlink) {
    throw new SkillPublicationError(
      `Materialized entry "${source}" is a symlink — publication refused`,
    );
  }
  if (stat.isDirectory) {
    Deno.mkdirSync(target, { recursive: true });
    for (const entry of Deno.readDirSync(source)) {
      copyValidatedTree(`${source}/${entry.name}`, `${target}/${entry.name}`);
    }
    return;
  }
  Deno.copyFileSync(source, target);
}

/**
 * Publish one validated materialized skill directory from the private staging
 * HOME into `destination/<skill>`:
 * - the source must exist as a real directory whose canonical path stays inside
 *   the staging tree (linked/escaping materialization refused);
 * - the name must be a single component and never collide with bundled content
 *   (`lib` or a cataloged skill) — owned content is never overwritten;
 * - an existing destination entry may be REFRESHED only when it is itself a
 *   real external directory inside the destination (never a symlink escape).
 */
function publishSkillDirectory(stagingSkillDir: string, destination: string, skill: string): void {
  if (!isValidSkillNameComponent(skill)) {
    throw new SkillPublicationError(
      `External skill name "${skill}" is not a single path component — refused`,
    );
  }
  if (collidesWithBundledContent(skill)) {
    throw new SkillPublicationError(
      `External skill "${skill}" collides with bundled/reserved content — refused`,
    );
  }
  const canonicalStaging = Deno.realPathSync(stagingSkillDir);
  const sourceStat = Deno.lstatSync(canonicalStaging);
  if (!sourceStat.isDirectory) {
    throw new SkillPublicationError(
      `Materialized skill "${skill}" at "${canonicalStaging}" is not a directory — refused`,
    );
  }
  const canonicalDestination = Deno.realPathSync(destination);
  // The private staging HOME is a fresh temporary directory OUTSIDE the
  // destination; `realPathSync` above already refuses a symlinked staging
  // spelling. Publishing a source that physically resolves INTO the
  // destination tree would be a self-publication loop — refused.
  if (
    canonicalStaging === canonicalDestination ||
    canonicalStaging.startsWith(canonicalDestination + "/")
  ) {
    throw new SkillPublicationError(
      `Materialized skill "${skill}" resolves inside the destination tree — refused`,
    );
  }
  const target = `${canonicalDestination}/${skill}`;
  try {
    const targetStat = Deno.lstatSync(target);
    if (targetStat.isSymlink) {
      throw new SkillPublicationError(
        `Destination entry "${target}" is a symlink — refusing to publish through it`,
      );
    }
    if (!targetStat.isDirectory) {
      throw new SkillPublicationError(
        `Destination entry "${target}" is not a directory — refusing to overwrite it`,
      );
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      if (error instanceof SkillPublicationError) throw error;
      // Unreadable destination observation: refuse rather than overwrite blind.
      throw new SkillPublicationError(
        `Destination entry "${target}" could not be observed (${
          error instanceof Error ? error.message : String(error)
        }) — refusing to publish blind`,
      );
    }
  }
  // Refresh semantics: replace the existing external entry atomically enough
  // for daemon-startup serialization (remove, then copy a validated tree).
  try {
    Deno.removeSync(target, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  copyValidatedTree(canonicalStaging, target);
}

/**
 * Install external skills via `npx --yes --package=skills skills add ... --copy`
 * into the EXPLICIT `destination` root (the resolver's OpenCode installed root).
 *
 * Each skill runs sequentially against a PRIVATE temporary HOME (never the
 * daemon's ambient HOME) and publishes only `<stagingHome>/.agents/skills/<skill>`
 * into `destination/<skill>`. Failures are logged and isolated per entry; the
 * staging directory is always removed. Returns once every entry has either been
 * published or failed — awaited by bootstrap before any inventory exists.
 */
export async function installExternalSkills(
  destination: string,
  skills: ExternalSkillConfig[],
  executor: SkillInstallExecutor = defaultExecutor,
): Promise<void> {
  if (skills.length === 0) return;

  logger.info("Installing {count} external skill(s) into {destination}", {
    count: skills.length,
    destination,
  });
  const startTime = Date.now();

  for (const skill of skills) {
    let stagingHome: string | undefined;
    try {
      logger.info("Installing skill {skill} from {repo}", {
        skill: skill.skill,
        repo: skill.repo,
      });

      // Name safety BEFORE spawning: an unsafe configured name must never even
      // reach the installer CLI or select a staging path component.
      if (!isValidSkillNameComponent(skill.skill)) {
        throw new SkillPublicationError(
          `External skill name "${skill.skill}" is not a single path component — skipped`,
        );
      }
      if (collidesWithBundledContent(skill.skill)) {
        throw new SkillPublicationError(
          `External skill "${skill.skill}" collides with bundled/reserved content — skipped`,
        );
      }

      // PRIVATE staging HOME: the CLI writes its `-g` universal target under
      // `${HOME}/.agents/skills`, so HOME points into a throwaway directory.
      stagingHome = await Deno.makeTempDir({ prefix: "air-skill-stage-" });
      const { cmd, args } = buildSkillInstallCommand(skill);
      const { code, stdout, stderr } = await executor.run(cmd, args, {
        env: { HOME: stagingHome, PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
      });
      const stdoutText = new TextDecoder().decode(stdout);
      const stderrText = new TextDecoder().decode(stderr);

      if (code !== 0) {
        logger.error("Failed to install skill {skill} from {repo} (exit code {code})", {
          skill: skill.skill,
          repo: skill.repo,
          code,
          stderr: stderrText,
        });
        continue;
      }

      const stagingSkillDir = `${stagingHome}/.agents/skills/${skill.skill}`;
      try {
        Deno.statSync(stagingSkillDir);
      } catch {
        throw new SkillPublicationError(
          `installer produced no materialized directory for "${skill.skill}" under the private HOME`,
        );
      }
      await Deno.mkdir(destination, { recursive: true });
      publishSkillDirectory(stagingSkillDir, destination, skill.skill);
      logger.info("Published skill {skill} from {repo} to {destination}", {
        skill: skill.skill,
        repo: skill.repo,
        destination: `${destination}/${skill.skill}`,
        stdout: stdoutText.trim(),
      });
    } catch (error) {
      logger.error("Error installing skill {skill} from {repo}: {error}", {
        skill: skill.skill,
        repo: skill.repo,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (stagingHome) {
        try {
          await Deno.remove(stagingHome, { recursive: true });
        } catch {
          // Best-effort staging cleanup; the daemon never trusts leftovers.
        }
      }
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info("External skill installation completed in {elapsed}ms", { elapsed });
}
