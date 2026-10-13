/**
 * Generated OMP skill-root declaration (`align-omp-skill-trust-to-shared-root`
 * D3).
 *
 * The deployment resolves ONE skill root for BOTH agent types
 * (`agent.skillsDir`), so no authored mode document may hard-code a skill
 * directory. At spawn time the launch assembly writes, per mode, a declaration
 * containing EXACTLY ONE key — `skills.customDirectories` holding exactly that
 * resolved root — into `{baseRoot}/omp-overlays/{mode}-skill-root.yml`, and
 * passes it FIRST among the `--config` overlays so the authored mode document
 * stays LAST. The composed fold therefore takes the skill directory from the
 * declaration and every other pin (enablement, the seven foreign-source
 * toggles) from the authored document.
 *
 * The write contract is deliberately narrow: the declaration path must be a
 * plain regular file or absent (a planted symlink or directory refuses
 * outright), and the content is REPLACED unconditionally through a
 * same-directory rename, so a pooled state root can never keep a stale or
 * rewritten file from an earlier spawn.
 *
 * This module is pure content plus that one write; the parsed-content
 * validation belongs to `assertOwnedSettingsDocument` and the launch assembly
 * (there is no content reading by the metadata-only pre-request observer).
 */

import { basename, dirname, join, resolve } from "@std/path";

/**
 * The single-key declaration document for one resolved root. The YAML mapping
 * carries `skills.customDirectories` and nothing else. The root is serialized
 * as a QUOTED YAML scalar (JSON string escaping is a subset of YAML's
 * double-quoted style), so a legitimate resolved path containing YAML
 * significant characters — `#`, `: `, quotes, spaces — round-trips to exactly
 * the same string instead of turning into a comment or a different type.
 */
export function ompSkillRootDeclarationContent(root: string): string {
  if (root.length === 0 || root.includes("\0") || root.includes("\n")) {
    throw new Error("Skill-root declaration value is empty or malformed");
  }
  if (!root.startsWith("/")) {
    throw new Error("Skill-root declaration value must be an absolute path");
  }
  return `# Generated at spawn time by the OMP launch assembly.
# Exactly one key: the deployment-resolved skill root (skills.customDirectories).
skills:
  customDirectories:
    - ${JSON.stringify(root)}
`;
}

/**
 * Symlink-refusing, unconditionally-overwriting write of the declaration.
 *
 * Refuses (throws) when the declaration path exists as a symlink or anything
 * other than a regular file, when its directory is a link, or when its
 * directory realpath differs from the resolved spelling; otherwise it writes a
 * fresh temp file beside the target and renames it into place, so a reader
 * never observes a partial document and a planted link is replaced rather than
 * followed.
 */
export function writeOmpSkillRootDeclaration(declarationPath: string, root: string): void {
  const content = ompSkillRootDeclarationContent(root);
  if (!declarationPath.startsWith("/") || resolve(declarationPath) !== declarationPath) {
    throw new Error("Skill-root declaration path must be an absolute canonical path");
  }
  const directory = dirname(declarationPath);
  Deno.mkdirSync(directory, { recursive: true });
  const directoryInfo = Deno.lstatSync(directory);
  if (directoryInfo.isSymlink || !directoryInfo.isDirectory) {
    throw new Error("Skill-root declaration directory is a link or not a directory");
  }
  if (Deno.realPathSync(directory) !== directory) {
    throw new Error("Skill-root declaration directory is not canonical");
  }
  try {
    const existing = Deno.lstatSync(declarationPath);
    if (existing.isSymlink || !existing.isFile) {
      throw new Error("Skill-root declaration target is a link or not a regular file");
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const temporary = join(directory, `.${basename(declarationPath)}.${crypto.randomUUID()}.tmp`);
  try {
    Deno.writeTextFileSync(temporary, content, { mode: 0o644 });
    Deno.renameSync(temporary, declarationPath);
  } catch (error) {
    try {
      Deno.removeSync(temporary);
    } catch {
      // The temp file was never created or is already gone.
    }
    throw error;
  }
}
