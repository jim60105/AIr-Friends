// src/utils/opencode-paths.ts
//
// Single source of truth for the session-scoped OpenCode data directory (F12).
// OpenCode computes its data dir from xdg-basedir semantics (`$XDG_DATA_HOME/opencode`,
// else `~/.local/share/opencode`); the truncated tool-output directory is hard-coded to
// `{dataDir}/tool-output` and is NOT configurable. By scoping `XDG_DATA_HOME` to a
// directory under the session TMPDIR we keep truncated tool outputs inside the session
// workspace, so (a) the agent can read its own tool-output files through the generic
// gate and (b) the shared, home-rooted data dir is never written or granted.
//
// The data-dir helpers are pure and derive everything from the session workspace path
// alone, so the subprocess environment (agent-factory) and the permission gate
// (client.ts) always agree without reading the parent process's `XDG_DATA_HOME`.
//
// This module also owns the GENERATED OpenCode skill-discovery declaration
// (`generate-opencode-skill-discovery-declaration`): the deployed global
// configuration path plus the inspect-then-write that names the deployment's ONE
// resolved skill root to the agent, described in its own section at the end of
// the file.

import { basename, dirname, isAbsolute, join, resolve } from "@std/path";
import { ConfigError, ErrorCode } from "../types/errors.ts";
import {
  jsonInsertMember,
  jsonMember,
  jsonMemberIndent,
  jsonReplaceSpan,
  jsonScalarValue,
  type JsonSourceNode,
  type JsonSourceObject,
  parseJsonSource,
} from "./json-source.ts";

/**
 * Root of the session-scoped OpenCode data area: a directory under the session TMPDIR,
 * derived deterministically from the session workspace path alone.
 */
export function opencodeDataRoot(workingDir: string): string {
  return join(workingDir, "tmp", "opencode-data");
}

/**
 * Session-specific `XDG_DATA_HOME` for the agent subprocess. When a session id exists
 * the data home is scoped to that session (`{root}/{sessionId}`) so concurrent sessions
 * of the same user never share truncated tool outputs; without one it falls back to the
 * workspace-level root (used by internal system sessions with dedicated workspaces).
 */
export function sessionXdgDataHome(workingDir: string, sessionId?: string): string {
  return sessionId ? join(opencodeDataRoot(workingDir), sessionId) : opencodeDataRoot(workingDir);
}

/**
 * OpenCode's truncated tool-output directory under a given XDG data home
 * (`{xdgDataHome}/opencode/tool-output`), matching OpenCode's hard-coded layout.
 */
export function opencodeToolOutputDir(xdgDataHome: string): string {
  return join(xdgDataHome, "opencode", "tool-output");
}

// ---------------------------------------------------------------------------
// GENERATED OpenCode skill-discovery declaration
// (`generate-opencode-skill-discovery-declaration`)
//
// OpenCode discovers skills only from what its own configuration declares, so
// the deployment's ONE resolved skill root (`agent.skillsDir` /
// `AGENT_SKILLS_DIR`, the value `src/core/skills-root.ts` resolves for every
// other consumer) is written into the deployed OpenCode global configuration:
// the skill discovery path list, and one `external_directory` allowance under
// that root alone. Nothing else in that document changes — every other
// setting, including the `deno run *` / `*.ts*` routing that sends script
// executions to the ACP approval gate, keeps its bytes exactly.
//
// The section below is the PURE document half plus the one filesystem step.
// The root is always an INPUT: this module never resolves, defaults or derives
// a root, and never writes a second one.
// ---------------------------------------------------------------------------

/**
 * Injectable seams for the declaration step. Each defaults to the real
 * deployment: the process environment, the daemon user's own home, the real
 * filesystem.
 */
export interface OpencodeSkillDiscoveryOptions {
  /** Environment accessor (`HOME`); defaults to the process environment. */
  readonly env?: (name: string) => string | undefined;
  /**
   * The daemon user's OBSERVED home directory: what a `~/` entry in the
   * document is resolved against, and what the over-broad-root refusal is
   * bounded by. Defaults to the process `HOME`.
   */
  readonly home?: string;
  /** Whole-document reader; `undefined` means the target does not exist. */
  readonly readFile?: (path: string) => string | undefined;
  /** Whole-document writer. */
  readonly writeFile?: (path: string, content: string) => void;
}

/**
 * The daemon user's observed home, canonicalized. An unset, empty or relative
 * `HOME` yields `undefined` rather than a guessed directory: no `~/` entry can
 * then be resolved and no home-scoped allowance can be bounded, so the
 * declaration cannot be placed at all.
 */
export function opencodeDaemonHome(
  options: OpencodeSkillDiscoveryOptions = {},
): string | undefined {
  const env = options.env ?? ((name: string) => Deno.env.get(name));
  const home = options.home ?? env("HOME");
  if (home === undefined || home === "" || !isAbsolute(home)) return undefined;
  return resolve(home);
}

/**
 * The deployed OpenCode GLOBAL configuration document the AGENT reads: the
 * file an operator mount shadows (documented in `docs/DEVELOPMENT.md`).
 *
 * The home-based resolution is the agent subprocess's own, not a preference:
 * that process is spawned with `clearEnv: true` and an explicit allow-list
 * (`src/acp/agent-factory.ts`, `src/acp/sandbox-manager.ts`) that conveys
 * `HOME` but NEVER a config-directory selector — `OPENCODE_CONFIG_DIR` is not
 * in the list at all and `XDG_CONFIG_HOME` is in `NEVER_PASS_ENV`. So the
 * document the agent reads is `{its HOME}/.config/opencode/opencode.json`
 * whatever the daemon's own selectors say, and a declaration written anywhere
 * else would be silently ineffective — the exact asymmetry this change
 * removes. `HOME` is inherited verbatim, so the daemon's observed home IS the
 * agent's home on this launch path.
 */
export function opencodeGlobalConfigPath(options: OpencodeSkillDiscoveryOptions = {}): string {
  const home = opencodeDaemonHome(options);
  if (home === undefined) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      "No absolute HOME is observable in the daemon environment — the OpenCode agent subprocess " +
        "inherits HOME and no config-directory selector, so the global configuration document " +
        "the skill-discovery declaration must be written into cannot be determined",
    );
  }
  return join(home, ".config", "opencode", "opencode.json");
}

/**
 * Refuse a resolved root that must never become an `external_directory`
 * allowance: the daemon user's home directory, or an ancestor of it. An
 * allowance bounded to the home — or above it — would let the agent read
 * unrelated home content (credentials, other configuration) far beyond a skill
 * tree, so the declaration refuses instead of narrowing that silently. The
 * filesystem root is always such an ancestor and is refused for the same
 * reason, even when no home is observable.
 */
export function assertOpencodeSkillRootIsDeclarable(root: string, home?: string): void {
  if (root === "" || !isAbsolute(root) || resolve(root) !== root) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `The resolved skill root "${root}" is not an absolute canonical path — the OpenCode ` +
        "skill-discovery declaration writes the resolved path verbatim and never a spelling " +
        "that a session's own working directory could re-resolve",
      { root },
    );
  }
  const homeScoped = home !== undefined && (home === root || home.startsWith(`${root}/`));
  if (root === "/" || homeScoped) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `The resolved skill root "${root}" is the daemon user's home directory or an ancestor of ` +
        "it — refusing to declare a home-scoped external-directory allowance" +
        (home !== undefined ? ` (daemon home "${home}")` : ""),
      home !== undefined ? { root, home } : { root },
    );
  }
}

/**
 * The canonical directory one declaration ENTRY names, or `undefined` when the
 * entry can never name the resolved root: a `~user` or `${HOME}` form the
 * pinned engine does not expand, or a relative entry, which the loader
 * resolves against the SESSION's working directory rather than the
 * configuration file's own directory.
 *
 * The two expanded spellings are the home-anchored ones the pinned pattern
 * engine documents (`~` and `$HOME`, never `${HOME}`), and they are accepted
 * only in an already-canonical form: that engine turns a pattern into a
 * regular expression WITHOUT normalizing `..` or `.` segments, so a spelling
 * such as `/srv/other/../skills/**` matches no real path and must never be
 * mistaken for the resolved root.
 */
function declaredDirectory(entry: string, home: string | undefined): string | undefined {
  if (entry === "~" || entry === "$HOME") return home;
  if (entry.startsWith("~/") || entry.startsWith("$HOME/")) {
    if (home === undefined) return undefined;
    const expanded = join(home, entry.slice(entry.indexOf("/") + 1));
    return expanded === resolve(expanded) ? expanded : undefined;
  }
  if (entry.startsWith("~")) return undefined;
  if (!isAbsolute(entry)) return undefined;
  return entry === resolve(entry) ? entry : undefined;
}

/** Parse the deployed document, requiring a JSON object at the top level. */
function requireDocumentObject(source: string): JsonSourceObject {
  const document = parseJsonSource(source);
  if (document.kind !== "object") {
    throw new Error("the deployed OpenCode configuration is not a JSON object");
  }
  return document;
}

/** A named member required to hold an object whenever the key is present. */
function objectMember(object: JsonSourceObject, key: string): JsonSourceObject | undefined {
  const member = jsonMember(object, key);
  if (member === undefined) return undefined;
  if (member.value.kind !== "object") throw new Error(`"${key}" is not a JSON object`);
  return member.value;
}

/** The decoded entries of a string array; any other shape fails explicitly. */
function requireStringArray(node: JsonSourceNode, label: string): string[] {
  if (node.kind !== "array") throw new Error(`${label} is not an array`);
  return node.items.map((item) => {
    if (item.kind !== "scalar" || typeof jsonScalarValue(item) !== "string") {
      throw new Error(`${label} contains a non-string entry`);
    }
    return jsonScalarValue(item) as string;
  });
}

/** The canonical directory an allowance KEY covers (`{directory}/**`), if any. */
function allowanceDirectory(key: string, home: string | undefined): string | undefined {
  if (!key.endsWith("/**")) return undefined;
  return declaredDirectory(key.slice(0, -3), home);
}

/**
 * The `agent.build.permission.external_directory` object when the document
 * carries one. Every level of that chain must be an object: a chain the
 * declaration cannot extend is never overwritten, it fails explicitly.
 */
function externalDirectoryObject(document: JsonSourceObject): JsonSourceObject | undefined {
  const agent = objectMember(document, "agent");
  if (agent === undefined) return undefined;
  const build = objectMember(agent, "build");
  if (build === undefined) return undefined;
  const permission = objectMember(build, "permission");
  if (permission === undefined) return undefined;
  return objectMember(permission, "external_directory");
}

/**
 * Whether one `skills.paths` VALUE names exactly the resolved root. Both the
 * inspection and the update use this one predicate, so a list the inspection
 * accepts is never rewritten by the update.
 */
function isSkillDiscoveryPathList(
  node: JsonSourceNode,
  root: string,
  home: string | undefined,
): boolean {
  if (node.kind !== "array") return false;
  const entries = requireStringArray(node, '"skills.paths"');
  return entries.length === 1 && declaredDirectory(entries[0]!, home) === root;
}

/** Whether the document's discovery path list names exactly the resolved root. */
function declaresSkillDiscoveryPath(
  document: JsonSourceObject,
  root: string,
  home: string | undefined,
): boolean {
  const skills = objectMember(document, "skills");
  if (skills === undefined) return false;
  const paths = jsonMember(skills, "paths");
  return paths !== undefined && isSkillDiscoveryPathList(paths.value, root, home);
}

/** Whether the allowance for the resolved root is an `allow`. */
function declaresExternalDirectoryAllowance(
  document: JsonSourceObject,
  root: string,
  home: string | undefined,
): boolean {
  const externalDirectory = externalDirectoryObject(document);
  if (externalDirectory === undefined) return false;
  return externalDirectory.members.some((member) => {
    if (allowanceDirectory(member.key, home) !== root) return false;
    return member.value.kind === "scalar" && jsonScalarValue(member.value) === "allow";
  });
}

/** The verdict of one inspection of a deployed configuration document. */
export interface OpencodeSkillDiscoveryVerdict {
  /** True when the document already carries BOTH declaration entries. */
  readonly declared: boolean;
  /** What the document still lacks (empty when it is already complete). */
  readonly detail: string;
}

/**
 * Decide whether the deployed document already declares the resolved root — in
 * any spelling that resolves to it, `~/…` included — and already allows
 * external-directory reads under that root. The comparison key set is BOTH
 * entries: a document that names the root but omits (or denies) the allowance
 * is INCOMPLETE, so the caller rewrites it rather than skipping it.
 */
export function inspectOpencodeSkillDiscoveryDeclaration(
  source: string,
  root: string,
  home?: string,
): OpencodeSkillDiscoveryVerdict {
  const document = requireDocumentObject(source);
  if (!declaresSkillDiscoveryPath(document, root, home)) {
    return { declared: false, detail: `the skill discovery path list is not exactly "${root}"` };
  }
  if (!declaresExternalDirectoryAllowance(document, root, home)) {
    return { declared: false, detail: `external_directory does not allow reads under "${root}"` };
  }
  return { declared: true, detail: "" };
}

/**
 * The declaration document written when NO deployed configuration exists:
 * exactly the declaration entries and nothing else, so no pre-existing key can
 * be overridden for any other source. The root is serialized as a JSON string,
 * so a legitimate resolved path containing quotes, backslashes or spaces
 * round-trips to exactly the same string.
 */
export function renderOpencodeSkillDiscoveryDeclaration(root: string): string {
  return `{
  "skills": {
    "paths": [
      ${JSON.stringify(root)}
    ]
  },
  "agent": {
    "build": {
      "permission": {
        "external_directory": {
          ${JSON.stringify(`${root}/**`)}: "allow"
        }
      }
    }
  }
}
`;
}

/**
 * The remaining chain as ONE JSON member text, one indentation level per step,
 * so a missing `agent.build.permission.external_directory` chain is inserted
 * with a single splice at the deepest existing level and no other key is added
 * anywhere.
 */
function chainMemberText(
  memberIndent: string,
  keys: readonly string[],
  leaf: string,
): string {
  const [head, ...rest] = keys;
  const inner = `${memberIndent}  `;
  if (rest.length === 0) return `${JSON.stringify(head)}: {\n${inner}${leaf}\n${memberIndent}}`;
  return `${JSON.stringify(head)}: {\n${inner}${
    chainMemberText(inner, rest, leaf)
  }\n${memberIndent}}`;
}

/** Insert the missing chain (carrying the allowance) as one member of `parent`. */
function insertChain(
  source: string,
  parent: JsonSourceObject,
  keys: readonly string[],
  allowance: string,
): string {
  const indent = jsonMemberIndent(source, parent);
  return jsonInsertMember(source, parent, chainMemberText(indent, keys, allowance));
}

/**
 * Set the skill discovery path list to exactly the resolved root. A list that
 * already names it keeps its bytes; a missing `skills` or `skills.paths` is
 * inserted as that one list. The list is never merged with another entry: the
 * declaration introduces no second root.
 */
function withSkillDiscoveryPath(
  source: string,
  root: string,
  home: string | undefined,
): string {
  const document = requireDocumentObject(source);
  const skills = objectMember(document, "skills");
  if (skills === undefined) {
    const indent = jsonMemberIndent(source, document);
    const list = `[\n${indent}    ${JSON.stringify(root)}\n${indent}  ]`;
    return jsonInsertMember(
      source,
      document,
      `"skills": {\n${indent}  "paths": ${list}\n${indent}}`,
    );
  }
  const paths = jsonMember(skills, "paths");
  if (paths !== undefined && isSkillDiscoveryPathList(paths.value, root, home)) return source;
  if (paths !== undefined) {
    return jsonReplaceSpan(
      source,
      paths.value.start,
      paths.value.end,
      `[${JSON.stringify(root)}]`,
    );
  }
  return jsonInsertMember(source, skills, `"paths": [${JSON.stringify(root)}]`);
}

/**
 * Ensure the ONE `external_directory` allowance for the resolved root: an
 * existing entry covering that root whose value is not `allow` is set to
 * `allow`, an absent entry is inserted, and a missing chain above it is
 * created — each as one splice. Every other permission entry, including the
 * `deny` default and the unrelated allowances, keeps its bytes.
 */
function withExternalDirectoryAllowance(
  source: string,
  root: string,
  home: string | undefined,
): string {
  const document = requireDocumentObject(source);
  const allowance = `${JSON.stringify(`${root}/**`)}: "allow"`;
  const agent = objectMember(document, "agent");
  if (agent === undefined) {
    return insertChain(
      source,
      document,
      ["agent", "build", "permission", "external_directory"],
      allowance,
    );
  }
  const build = objectMember(agent, "build");
  if (build === undefined) {
    return insertChain(source, agent, ["build", "permission", "external_directory"], allowance);
  }
  const permission = objectMember(build, "permission");
  if (permission === undefined) {
    return insertChain(
      source,
      build,
      ["permission", "external_directory"],
      allowance,
    );
  }
  const externalDirectory = objectMember(permission, "external_directory");
  if (externalDirectory === undefined) {
    return insertChain(source, permission, ["external_directory"], allowance);
  }
  const covering = externalDirectory.members.find((member) =>
    allowanceDirectory(member.key, home) === root
  );
  if (covering !== undefined) {
    return jsonReplaceSpan(source, covering.value.start, covering.value.end, `"allow"`);
  }
  return jsonInsertMember(source, externalDirectory, allowance);
}

/**
 * Splice the declaration into an existing document: the discovery path list
 * becomes exactly the resolved root, and the allowance under that root is
 * ensured. Both steps are source-preserving text splices, so every other byte
 * of the document — the `deno run *` / `*.ts*` routing to the approval gate,
 * the remaining allowances and every unrelated setting — is copied verbatim.
 */
export function applyOpencodeSkillDiscoveryDeclaration(
  source: string,
  root: string,
  home?: string,
): string {
  return withExternalDirectoryAllowance(
    withSkillDiscoveryPath(source, root, home),
    root,
    home,
  );
}

/** The outcome of one declaration step. */
export interface OpencodeSkillDiscoveryResult {
  /** The deployed configuration document the declaration is carried by. */
  readonly path: string;
  /** The resolved skill root the declaration names. */
  readonly root: string;
  /** What the step did with the document. */
  readonly action: "unchanged" | "created" | "updated";
}

/**
 * Replace the deployed document through a same-directory temporary file and a
 * rename, so a reader never observes a partial document. The deployed file's
 * own mode is preserved (the image ships it group-writable), the temporary
 * file is removed when the write or the rename fails, and a planted link or a
 * non-regular file at the target refuses outright rather than being followed.
 */
function writeOpencodeDocument(path: string, content: string): void {
  const directory = dirname(path);
  Deno.mkdirSync(directory, { recursive: true });
  let mode = 0o644;
  try {
    const info = Deno.lstatSync(path);
    if (info.isSymlink || !info.isFile) {
      throw new Error("the existing target is a symbolic link or not a regular file");
    }
    // A platform that reports no mode keeps the created-file default.
    if (info.mode !== null) mode = info.mode & 0o777;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  const temporary = join(directory, `.${basename(path)}.${crypto.randomUUID()}.tmp`);
  try {
    Deno.writeTextFileSync(temporary, content, { mode });
    // `mode` is subject to the process umask at creation, so the observed mode
    // is reasserted explicitly.
    Deno.chmodSync(temporary, mode);
    Deno.renameSync(temporary, path);
  } catch (error) {
    try {
      Deno.removeSync(temporary);
    } catch {
      // The temporary file was never created or is already gone.
    }
    throw error;
  }
}

/**
 * Write the document, failing explicitly — with the file and the resolved root
 * — when it cannot be written. This is the posture that keeps a contradicting
 * read-only operator mount from starting an agent whose discovery disagrees
 * with the root the daemon tells it to execute from.
 */
function writeOpencodeSkillDiscoveryDocument(
  path: string,
  content: string,
  root: string,
  options: OpencodeSkillDiscoveryOptions,
): void {
  try {
    (options.writeFile ?? writeOpencodeDocument)(path, content);
  } catch (error) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `The deployed OpenCode configuration "${path}" must declare the resolved skill root ` +
        `"${root}" but could not be written: ` +
        (error instanceof Error ? error.message : String(error)),
      { path, root },
    );
  }
}

/**
 * Declare the resolved skill root in the deployed OpenCode global
 * configuration, so the agent that must discover and read the
 * runtime-installed external skills follows the deployment's ONE configured
 * root instead of only the implicit home convention.
 *
 * Inspect-then-write: a document that already carries BOTH declaration entries
 * is left byte-identical and nothing is written; an absent document is created
 * (with its parent directory) carrying exactly the declaration entries; any
 * other document is updated in place. The root is an INPUT — this function
 * never resolves, defaults or derives one.
 *
 * Everything that makes the declaration impossible to state truthfully fails
 * explicitly, naming the document and the resolved root: an unwritable or
 * unreadable target, a document whose declaration places hold shapes the
 * declaration cannot extend, and a resolved root that is the daemon user's home
 * directory or an ancestor of it. An agent session is never started with a
 * discovery declaration that contradicts the resolved root.
 */
export function ensureOpencodeSkillDiscoveryDeclaration(
  root: string,
  options: OpencodeSkillDiscoveryOptions = {},
): OpencodeSkillDiscoveryResult {
  const home = opencodeDaemonHome(options);
  assertOpencodeSkillRootIsDeclarable(root, home);
  const path = opencodeGlobalConfigPath(options);
  const readFile = options.readFile ??
    ((target: string) => {
      try {
        return Deno.readTextFileSync(target);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
      }
    });
  let existing: string | undefined;
  try {
    existing = readFile(path);
  } catch (error) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `The deployed OpenCode configuration "${path}" could not be read for the skill-discovery ` +
        `declaration of the resolved root "${root}": ` +
        (error instanceof Error ? error.message : String(error)),
      { path, root },
    );
  }
  if (existing === undefined) {
    const content = renderOpencodeSkillDiscoveryDeclaration(root);
    writeOpencodeSkillDiscoveryDocument(path, content, root, options);
    return { path, root, action: "created" };
  }
  let updated: string | undefined;
  try {
    const verdict = inspectOpencodeSkillDiscoveryDeclaration(existing, root, home);
    if (!verdict.declared) updated = applyOpencodeSkillDiscoveryDeclaration(existing, root, home);
  } catch (error) {
    throw new ConfigError(
      ErrorCode.CONFIG_INVALID,
      `The deployed OpenCode configuration "${path}" cannot carry the skill-discovery ` +
        `declaration of the resolved root "${root}": ` +
        (error instanceof Error ? error.message : String(error)),
      { path, root },
    );
  }
  if (updated === undefined) return { path, root, action: "unchanged" };
  writeOpencodeSkillDiscoveryDocument(path, updated, root, options);
  return { path, root, action: "updated" };
}
