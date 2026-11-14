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
import fs from "node:fs";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { isNotFoundError, makeTempDir } from "../utils/fs-compat.ts";

const logger = createLogger("SkillInstaller");

/** Output ceiling for one installer run; the CLI prints a short progress log at most. */
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Run a command through `node:child_process.execFile`. A supplied `env` REPLACES the
 * parent environment; without one the child inherits it. An absent binary rejects, and a
 * signal-terminated child reports `-1` rather than reading as success.
 */
function runCommand(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ code: number; success: boolean; stdout: Uint8Array; stderr: Uint8Array }> {
  const pending = Promise.withResolvers<{
    code: number;
    success: boolean;
    stdout: Uint8Array;
    stderr: Uint8Array;
  }>();
  execFile(command, args, {
    ...(env ? { env } : {}),
    encoding: "buffer",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
  }, (error, stdout, stderr) => {
    if (error === null) {
      pending.resolve({
        code: 0,
        success: true,
        stdout: new Uint8Array(stdout),
        stderr: new Uint8Array(stderr),
      });
      return;
    }
    if (typeof error.code === "string") {
      pending.reject(error);
      return;
    }
    pending.resolve({
      code: typeof error.code === "number" ? error.code : -1,
      success: false,
      stdout: new Uint8Array(
        typeof error.stdout === "string" ? Buffer.from(error.stdout) : error.stdout ?? stdout,
      ),
      stderr: new Uint8Array(
        typeof error.stderr === "string" ? Buffer.from(error.stderr) : error.stderr ?? stderr,
      ),
    });
  });
  return pending.promise;
}

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

/**
 * Build the EXACT environment for one installer run: the private staging HOME, the
 * daemon's PATH, and a Git configuration override that activates no submodule.
 *
 * `skills` >= 1.8.1 runs `git submodule update --init --recursive` after every clone and
 * offers no opt-out. A source repository whose submodule is large (hundreds of megabytes of
 * unrelated content) then blocks daemon startup for as long as that download takes. An
 * exclude-only `submodule.active` pathspec matches no submodule, so the CLI's submodule
 * step becomes a no-op and only the source repository itself is fetched. A skill that
 * lives inside a submodule is therefore not installable, which also keeps the installer
 * from fetching repositories the operator never listed.
 */
export function buildSkillInstallEnv(stagingHome: string): Record<string, string> {
  return {
    HOME: stagingHome,
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "submodule.active",
    GIT_CONFIG_VALUE_0: ":(exclude)*",
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
    return await runCommand(cmd, args, options?.env);
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
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new SkillPublicationError(
      `Materialized entry "${source}" is a symlink — publication refused`,
    );
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyValidatedTree(`${source}/${entry.name}`, `${target}/${entry.name}`);
    }
    return;
  }
  fs.copyFileSync(source, target);
}

/**
 * Assert every directory ANCESTOR of the materialized path inside the private
 * staging HOME is a real directory, not a symlink (post-duck B5):
 * `realPathSync` FOLLOWS an ancestor link, so `<stagingHome>/.agents` being a
 * link to a foreign tree would otherwise publish that foreign tree's regular
 * contents. `realPathSync(<path>) === <path>` proves the full chain from the
 * (freshly created, non-linked) temp root down to the path is link-free,
 * because the canonical spelling can only equal the literal spelling when
 * nothing on the route was rewritten.
 */
function assertStagingChainLinkFree(stagingHome: string, skill: string): void {
  const canonicalHome = fs.realpathSync(stagingHome);
  const stagingSkillDir = `${stagingHome}/.agents/skills/${skill}`;
  const expected = `${canonicalHome}/.agents/skills/${skill}`;
  let canonical: string;
  try {
    canonical = fs.realpathSync(stagingSkillDir);
  } catch (error) {
    throw new SkillPublicationError(
      `Materialized skill path "${stagingSkillDir}" could not be observed (${
        error instanceof Error ? error.message : String(error)
      }) — publication refused`,
    );
  }
  if (canonical !== expected) {
    throw new SkillPublicationError(
      `Materialized skill path resolves to "${canonical}" outside the exact private staging chain ` +
        `"${expected}" (linked .agents/skills ancestor or linked entry) — publication refused`,
    );
  }
}

/**
 * Pass 1 of publication (post-duck B4): walk the ENTIRE materialized tree and
 * refuse any link BEFORE the destination is touched, so a rejection at
 * `scripts/evil.ts` can never leave a half-published grant or destroy a
 * previously installed entry.
 */
function validateMaterializedTree(source: string): void {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new SkillPublicationError(
      `Materialized entry "${source}" is a symlink — publication refused`,
    );
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      validateMaterializedTree(`${source}/${entry.name}`);
    }
  }
}

/**
 * Publish one validated materialized skill directory from the private staging
 * HOME into `destination/<skill>`:
 * - the source must exist as a real directory whose canonical path stays inside
 *   the EXACT private staging chain — the requested path and the `.agents`,
 *   `.agents/skills` ancestors must all be link-free real directories
 *   (post-duck B5: `realPathSync` follows ancestor links, so the chain is
 *   proven by canonical-equals-literal, not by following);
 * - the name must be a single component and never collide with bundled content
 *   (`lib` or a cataloged skill) — owned content is never overwritten;
 * - an existing destination entry may be REFRESHED only when it is itself a
 *   real external directory inside the destination (never a symlink escape),
 *   and a FAILED publication restores it (post-duck B4: the tree is fully
 *   validated before the destination is touched, the previous entry is moved
 *   aside and renamed back on any copy failure, and no partial content is
 *   ever left at the final path).
 */
function publishSkillDirectory(
  stagingHome: string,
  destination: string,
  skill: string,
): void {
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
  // B5: the whole private staging chain down to the requested directory must
  // be link-free BEFORE anything is observed through it.
  assertStagingChainLinkFree(stagingHome, skill);
  const canonicalStaging = `${fs.realpathSync(stagingHome)}/.agents/skills/${skill}`;
  const sourceStat = fs.lstatSync(canonicalStaging);
  if (!sourceStat.isDirectory()) {
    throw new SkillPublicationError(
      `Materialized skill "${skill}" at "${canonicalStaging}" is not a directory — refused`,
    );
  }
  const canonicalDestination = fs.realpathSync(destination);
  // Publishing a source that physically resolves INTO the destination tree
  // would be a self-publication loop — refused.
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
    const targetStat = fs.lstatSync(target);
    if (targetStat.isSymbolicLink()) {
      throw new SkillPublicationError(
        `Destination entry "${target}" is a symlink — refusing to publish through it`,
      );
    }
    if (!targetStat.isDirectory()) {
      throw new SkillPublicationError(
        `Destination entry "${target}" is not a directory — refusing to overwrite it`,
      );
    }
  } catch (error) {
    if (!(isNotFoundError(error))) {
      if (error instanceof SkillPublicationError) throw error;
      // Unreadable destination observation: refuse rather than overwrite blind.
      throw new SkillPublicationError(
        `Destination entry "${target}" could not be observed (${
          error instanceof Error ? error.message : String(error)
        }) — refusing to publish blind`,
      );
    }
  }
  // B4: FULL validation before the destination is touched at all.
  validateMaterializedTree(canonicalStaging);
  // Refresh semantics with failure preservation: move the previous external
  // entry aside (same filesystem, atomic rename), copy the fully validated
  // tree to the final path, and on ANY failure remove the partial output and
  // restore the previous entry — a failed skill publishes nothing.
  const backup = `${target}.air-refresh-${crypto.randomUUID()}`;
  let hadPrevious = false;
  try {
    fs.renameSync(target, backup);
    hadPrevious = true;
  } catch (error) {
    if (!(isNotFoundError(error))) throw error;
  }
  try {
    copyValidatedTree(canonicalStaging, target);
  } catch (error) {
    try {
      fs.rmSync(target, { recursive: true });
    } catch {
      // Best-effort removal of the partial output; the restore below still runs.
    }
    if (hadPrevious) {
      try {
        fs.renameSync(backup, target);
      } catch {
        logger.error(`Failed to restore previous external skill entry at "${target}"`, {});
      }
    }
    throw error;
  }
  if (hadPrevious) {
    try {
      fs.rmSync(backup, { recursive: true });
    } catch {
      // Best-effort: a leftover backup is outside the published entry.
    }
  }
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
      stagingHome = await makeTempDir({ prefix: "air-skill-stage-" });
      const { cmd, args } = buildSkillInstallCommand(skill);
      const { code, stdout, stderr } = await executor.run(cmd, args, {
        env: buildSkillInstallEnv(stagingHome),
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
        fs.statSync(stagingSkillDir);
      } catch {
        throw new SkillPublicationError(
          `installer produced no materialized directory for "${skill.skill}" under the private HOME`,
        );
      }
      await fsp.mkdir(destination, { recursive: true });
      publishSkillDirectory(stagingHome, destination, skill.skill);
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
          await fsp.rm(stagingHome, { recursive: true });
        } catch {
          // Best-effort staging cleanup; the daemon never trusts leftovers.
        }
      }
    }
  }

  const elapsed = Date.now() - startTime;
  logger.info("External skill installation completed in {elapsed}ms", { elapsed });
}
