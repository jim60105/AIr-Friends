/** Decision-time command containment; not protected command execution. */
import { basename, dirname, resolve } from "@std/path";
import {
  opencodeDataRoot,
  opencodeToolOutputDir,
  sessionXdgDataHome,
} from "@utils/opencode-paths.ts";
import {
  canonicalizeSessionRoots,
  type CanonicalRootInfo,
  type CanonicalSessionRoots,
  defaultMetadataReader,
  isWithinRoot,
  type MetadataReader,
  resolveFilesystemTarget,
  type RootPathResult,
  type SessionContext,
} from "./filesystem-roots.ts";
import {
  commandWithoutFdRedirects,
  containsShellOperators,
  containsUnquotedShellExpansion,
  expandKnownEnvReferences,
  FD_REDIRECT_TOKEN_PATTERN,
  type KnownEnvRuntime,
  splitCommandSegments,
  tokenizeShellCommand,
} from "./command-syntax.ts";

/**
 * Generic-command allow-list (F12 D2): the search/read and document/media/archive
 * utilities the restricted profile exposes. Because `agent-config/opencode.json` routes
 * these tools to `"ask"` (not `"allow"`), OpenCode forwards their execution to this ACP
 * gate; without an explicit allow-list they would hit default-deny and break every
 * legitimate in-workspace use. `agent-browser` is deliberately NOT here — its `file://`
 * argument is rejected by `referencesOutOfWorkspacePath` (D3) and its network behavior is
 * F14's concern. Interpreters and mutating system tools (`python`, `git`, `rm`, `mv`, `dd`,
 * `chmod`, `mkdir`, ...) are NOT here and remain default-deny.
 */
export const GENERIC_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set([
  // Plain search/read/stat primitives whose ONLY file access is via ordinary path arguments
  // (which the workspace-containment check below can see). Tools with their own file-reading
  // argument DSL, an argument/response indirection file, an embedded protocol/coder, or an
  // -exec/-delete/preprocessor code-exec facility are deliberately EXCLUDED — a lexical
  // path check cannot bound those (e.g. ImageMagick `caption:@/proc/1/environ`, `exiftool -@`
  // argfile, `ffmpeg -f lavfi -i movie=/etc/passwd`, `pandoc --lua-filter`, `7zz -o/etc`,
  // archive path traversal). Those tools are only safe under the F12 D4 bwrap confinement,
  // which contains them regardless of argv; until confinement is enabled+verified they stay
  // default-denied at this gate.
  "rg",
  "cat",
  "head",
  "tail",
  "ls",
  "find",
  "wc",
  "file",
  "tree",
  "jq",
  "pdftotext",
  "pdfinfo",
  "pdfimages",
  "pdftoppm",
]);

/**
 * Argument flags that turn an allow-listed tool into a code-execution or arbitrary-file
 * read/write primitive whose target is NOT an ordinary path token (so the workspace check
 * cannot see it). Presence of any of these rejects the whole command. Examples:
 *   `find . -exec cat {} +` / `find . -delete` / `find . -fprintf /etc/x %p`  (find)
 *   `rg --pre <cmd> pattern .`                                                  (rg preprocessor)
 */
export const DANGEROUS_GENERIC_FLAGS: ReadonlySet<string> = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprintf",
  "-fprint",
  "-fprint0",
  "-fls",
  "--pre",
  "-@",
  "--files-from",
  "-T",
  "--lua-filter",
  "--filter",
]);

export type GenericCommandRejection =
  | "shell_operator"
  | "first_token_not_allowed"
  | "dangerous_flag"
  | "path_outside_boundary";

/** Existing registered session and process inputs; no new configuration fields. */
export interface CommandGateContext extends SessionContext {
  readonly home: string;
  readonly xdgDataHome?: string;
  readonly processTmpDir?: string;
  readonly runtimeEnv?: KnownEnvRuntime;
  readonly reader?: MetadataReader;
  readonly logFailure?: (reason: string) => void;
}

export type CommandRootRole = "workspace" | "shared" | "process-tmp" | "tool-output";
export interface CommandGateRootSet {
  readonly observationRoots: CanonicalSessionRoots;
  readonly grants: readonly { role: CommandRootRole; root: CanonicalRootInfo }[];
  readonly dataRoot: CanonicalRootInfo;
  readonly dataHome: CanonicalRootInfo;
}

function failure(
  reason: "root_unavailable" | "invalid_root",
  message: string,
): RootPathResult<never> {
  return { ok: false, reason, message };
}

/** Extra roles are privately adapted to the predecessor's root identity shape. */
async function directoryRoot(
  path: string,
  reader: MetadataReader,
): Promise<RootPathResult<CanonicalRootInfo>> {
  try {
    const canonicalPath = await reader.realPath(path);
    const info = await reader.lstat(canonicalPath);
    if (!info.isDirectory) return failure("invalid_root", "Command root is not a directory");
    if (info.dev == null || info.ino == null) {
      return failure("root_unavailable", "Command root identity unavailable");
    }
    return {
      ok: true,
      value: {
        role: "workspace",
        configuredPath: resolve(path),
        canonicalPath,
        identity: { dev: info.dev, ino: info.ino },
        readOnly: false,
      },
    };
  } catch {
    return failure("root_unavailable", "Command root unavailable");
  }
}

/** Construct command-only grants; the data root never grants access. */
export async function buildCommandGateRoots(
  context: CommandGateContext,
): Promise<RootPathResult<CommandGateRootSet>> {
  const reader = context.reader ?? defaultMetadataReader;
  const session = await canonicalizeSessionRoots(context, undefined, reader);
  if (!session.ok) return session;
  const sessionRoots = session.value;
  const grants: { role: CommandRootRole; root: CanonicalRootInfo }[] = [];
  for (const root of session.value.roots) {
    if (root.role === "workspace" || root.role === "shared") {
      if (root.identity?.dev == null || root.identity?.ino == null) {
        return failure("root_unavailable", "Command root identity unavailable");
      }
      grants.push({ role: root.role, root });
    }
  }
  if (context.processTmpDir) {
    const tmp = await directoryRoot(context.processTmpDir, reader);
    if (!tmp.ok) return tmp;
    grants.push({ role: "process-tmp", root: tmp.value });
  }
  const dataHomePath = context.xdgDataHome ??
    sessionXdgDataHome(context.sessionCwd, context.skillSessionId);
  const dataRootPath = context.xdgDataHome
    ? dirname(context.xdgDataHome)
    : opencodeDataRoot(context.sessionCwd);
  // Isolation boundaries can be prospective, but must be observed through an admitted root.
  async function boundary(path: string): Promise<RootPathResult<CanonicalRootInfo>> {
    const existing = await directoryRoot(path, reader);
    if (existing.ok) return existing;
    // Missing per-spawn data directories inherit the workspace only after canonical observation.
    if (context.xdgDataHome) return existing;
    const observed = await resolveFilesystemTarget(
      {
        acpSessionId: context.acpSessionId,
        sessionContextGeneration: context.sessionContextGeneration,
        rawPath: path,
        expandedPath: path,
        normalizedPath: resolve(path),
      },
      sessionRoots,
      "file-or-new",
      undefined,
      reader,
    );
    if (!observed.ok) return observed;
    if (observed.value.targetType !== "prospective") return existing;
    return {
      ok: true,
      value: {
        role: "workspace",
        configuredPath: resolve(path),
        canonicalPath: observed.value.canonicalTarget,
        readOnly: false,
        isProspective: true,
      },
    };
  }
  const dataRoot = await boundary(dataRootPath);
  if (!dataRoot.ok) return dataRoot;
  const dataHome = await boundary(dataHomePath);
  if (!dataHome.ok) return dataHome;
  if (!isWithinRoot(dataHome.value.canonicalPath, dataRoot.value.canonicalPath)) {
    return failure("invalid_root", "Data home escapes the isolation boundary");
  }
  const tool = await directoryRoot(opencodeToolOutputDir(dataHomePath), reader);
  if (tool.ok) {
    const scope = context.xdgDataHome
      ? dataHome.value.canonicalPath
      : grants.find((grant) => grant.role === "workspace")!.root.canonicalPath;
    const poolScoped = !context.xdgDataHome ||
      (basename(dataRootPath) === "opencode-data" &&
        basename(dataRoot.value.canonicalPath) === "opencode-data");
    const isolated = !isWithinRoot(tool.value.canonicalPath, dataRoot.value.canonicalPath) ||
      isWithinRoot(tool.value.canonicalPath, dataHome.value.canonicalPath);
    if (poolScoped && isolated && isWithinRoot(tool.value.canonicalPath, scope)) {
      grants.push({ role: "tool-output", root: tool.value });
    } else context.logFailure?.("symlink_escape");
  }
  // Missing tool-output omits only that grant; workspace prospective outputs retain parity.
  return {
    ok: true,
    value: {
      grants,
      dataRoot: dataRoot.value,
      dataHome: dataHome.value,
      observationRoots: { ...session.value, roots: grants.map((grant) => grant.root) },
    },
  };
}

function expandArgument(token: string, context: CommandGateContext): string | undefined {
  if (containsUnquotedShellExpansion(token)) return undefined;
  let t = token;
  const eq = t.indexOf("=");
  if (eq !== -1 && t.startsWith("-")) t = t.substring(eq + 1);
  t = t.replace(/^["']+/, "").replace(/["']+$/, "");
  if (t.length === 0) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return undefined;
  const expanded = expandKnownEnvReferences(
    t,
    context.home,
    context.xdgDataHome ?? sessionXdgDataHome(context.sessionCwd, context.skillSessionId),
    context.runtimeEnv,
  );
  if (expanded === undefined) return undefined;
  t = expanded;
  if (
    t.startsWith("-") && (/^-{1,2}[a-zA-Z][a-zA-Z0-9-]*\//.test(t) ||
      /^-{1,2}[a-zA-Z][a-zA-Z0-9-]*\.\./.test(t) || t.includes("/../"))
  ) return undefined;
  return t;
}

async function argumentAllowed(
  token: string,
  t: string,
  context: CommandGateContext,
  roots: CommandGateRootSet,
): Promise<boolean> {
  const path = {
    acpSessionId: context.acpSessionId,
    sessionContextGeneration: context.sessionContextGeneration,
    rawPath: token,
    expandedPath: t,
    normalizedPath: resolve(context.sessionCwd, t),
  };
  const reader = context.reader ?? defaultMetadataReader;
  let observed = await resolveFilesystemTarget(
    path,
    roots.observationRoots,
    "existing-any",
    undefined,
    reader,
  );
  if (!observed.ok && observed.reason === "not_found") {
    observed = await resolveFilesystemTarget(
      path,
      roots.observationRoots,
      "file-or-new",
      undefined,
      reader,
    );
  }
  if (!observed.ok) {
    context.logFailure?.(observed.reason);
    return false;
  }
  for (const root of [...roots.grants.map((grant) => grant.root), roots.dataRoot, roots.dataHome]) {
    if (root.isProspective) continue;
    try {
      const currentPath = await reader.realPath(root.configuredPath);
      const current = await reader.lstat(currentPath);
      if (
        currentPath !== root.canonicalPath || current.dev !== root.identity?.dev ||
        current.ino !== root.identity?.ino || !current.isDirectory
      ) {
        context.logFailure?.("path_changed");
        return false;
      }
    } catch {
      context.logFailure?.("root_unavailable");
      return false;
    }
  }
  const target = observed.value.canonicalTarget;
  if (
    isWithinRoot(target, roots.dataRoot.canonicalPath) &&
    !isWithinRoot(target, roots.dataHome.canonicalPath)
  ) {
    context.logFailure?.("outside_roots");
    return false;
  }
  const admitted = observed.value.rootIdentities;
  return roots.grants.some((grant) => admitted.includes(grant.root));
}

/** Preserve first-failure structural precedence and the four public audit reasons. */
export async function genericCommandRejectionReason(
  cmd: string,
  context: CommandGateContext,
): Promise<GenericCommandRejection | null> {
  if (containsShellOperators(commandWithoutFdRedirects(cmd))) return "shell_operator";
  const tokens = tokenizeShellCommand(cmd).filter((t) => t.length > 0);
  if (tokens.length === 0 || !GENERIC_COMMAND_ALLOWLIST.has(tokens[0])) {
    return "first_token_not_allowed";
  }
  let roots: CommandGateRootSet | undefined;
  for (let i = 1; i < tokens.length; i++) {
    if (FD_REDIRECT_TOKEN_PATTERN.test(tokens[i])) continue;
    if (DANGEROUS_GENERIC_FLAGS.has(tokens[i])) return "dangerous_flag";
    const expanded = expandArgument(tokens[i], context);
    if (expanded === undefined) return "path_outside_boundary";
    if (!roots) {
      const result = await buildCommandGateRoots(context);
      if (!result.ok) {
        context.logFailure?.(result.reason);
        return "path_outside_boundary";
      }
      roots = result.value;
    }
    if (expanded !== "" && !await argumentAllowed(tokens[i], expanded, context, roots)) {
      return "path_outside_boundary";
    }
  }
  if (!roots) {
    const result = await buildCommandGateRoots(context);
    if (!result.ok) {
      context.logFailure?.(result.reason);
      return "path_outside_boundary";
    }
  }
  return null;
}

/** Every segment independently faces the same single-command policy. */
export async function multiCommandRejectionReason(
  cmd: string,
  context: CommandGateContext,
): Promise<GenericCommandRejection | null> {
  const segments = splitCommandSegments(cmd);
  if (segments.length === 0 || (segments.length === 1 && segments[0] === cmd)) {
    return genericCommandRejectionReason(cmd, context);
  }
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length > 0 && tokens.every((t) => FD_REDIRECT_TOKEN_PATTERN.test(t))) {
      return "shell_operator";
    }
    const reason = await genericCommandRejectionReason(segment, context);
    if (reason !== null) return reason;
  }
  return null;
}
