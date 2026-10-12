// src/acp/skill-inventory.ts
//
// Root-exact skill script auto-approve inventory (`unify-omp-skill-root-resolution`
// D3). One EXPLICIT deployment-resolved absolute root (the output of
// `resolveTrustedSkillsRoot` for the SELECTED agent — never a HOME scan, never a
// `Deno.cwd()/skills` constructor default) is observed once at construction and
// rechecked at every decision:
//
// - `scripts` records CANONICAL ABSOLUTE regular-file paths plus their
//   dev/ino identity and the root observation they were enumerated under. A
//   suffix spelling is never authority: approval requires the invocation's
//   actual entrypoint to physically resolve to one exact enumerated file.
// - OpenCode discovers installed entries by scanning the root; OMP admits ONLY
//   the deployment-controlled bundled catalog names (`BUNDLED_SKILLS`) within
//   the root, under both empty and explicitly configured approval lists, so a
//   shared development root can never expand OMP eligibility.
// - A configured name filters observed entries inside the root and contributes
//   NOTHING for a missing/inaccessible skill: the old absent-skill → command-
//   prefix promotion is removed. Only an OBSERVED command-based skill (a real
//   skill directory with SKILL.md and no `scripts` directory) keeps its exact
//   command prefix; a `scripts`-directory observation ERROR is never
//   reinterpreted as a command-based skill.
// - Decision time locates the entrypoint through the shared shell parser,
//   decodes only balanced literal quoting, and — for a relative spelling —
//   anchors it PHYSICALLY at the requesting registered session cwd (no lexical
//   `..` collapsing before physical observation, no PATH search for a slashless
//   direct command). Missing registration, failed observation, a replaced root
//   identity, or a replaced script identity all deny.

import { SEPARATOR } from "@std/path";
import {
  BUNDLED_SKILLS,
  isValidSkillNameComponent,
  RESERVED_SKILL_ENTRIES,
} from "@core/bundled-skills.ts";
import type { SkillsRootObservation } from "@core/skills-root.ts";
import {
  commandWithoutFdRedirects,
  containsShellOperators,
  containsUnquotedShellExpansion,
  FD_REDIRECT_TOKEN_PATTERN,
  tokenizeShellCommand,
} from "./command-syntax.ts";

/** A single enumerated canonical script grant with its observed identity. */
export interface SkillScriptEntry {
  /** Canonical absolute regular-file path (realpath). */
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
}

/** Auto-approved skill lists for restricted (non-YOLO) mode. */
export interface SkillAutoApproveList {
  /** The observed root this inventory was built from (canonical + identity). */
  readonly root: SkillsRootObservation & { canonicalPath: string };
  /** Canonical absolute script grants, each carrying its observed identity. */
  readonly scripts: readonly SkillScriptEntry[];
  /** Command skill prefixes from OBSERVED command-based skills: "agent-browser". */
  readonly commandPrefixes: ReadonlySet<string>;
}

/** Injectable filesystem seam; defaults to the real filesystem. */
export interface SkillInventoryFs {
  lstat(path: string): Deno.FileInfo;
  readDir(path: string): Deno.DirEntry[];
  realPath(path: string): string;
}

const realFs: SkillInventoryFs = {
  lstat: (path) => Deno.lstatSync(path),
  readDir: (path) => [...Deno.readDirSync(path)],
  realPath: (path) => Deno.realPathSync(path),
};

export interface BuildSkillAutoApproveListInput {
  /** The selected agent type; decides scan vs bundled-catalog enumeration. */
  agentType: "opencode" | "omp";
  /**
   * The resolver's observation for the selected agent (`observeTrustedSkillsRoot`).
   * An observation without a recorded identity cannot anchor identity-stable
   * grants and fails construction explicitly — never a silently uncheckable
   * inventory.
   */
  rootObservation: SkillsRootObservation;
  /** When nonempty, filters the eligible skill NAMES observed inside the root. */
  configuredSkills?: readonly string[];
  /** Filesystem seam for tests. */
  fs?: SkillInventoryFs;
}

/**
 * Build the root-exact auto-approve inventory.
 *
 * `configuredSkills` semantics: empty/absent → OpenCode scans the root, OMP
 * enumerates the bundled catalog names within the root. Nonempty → observed
 * configured names within the root are admitted, and for OMP the intersection
 * with the bundled catalog (a configured name never expands OMP beyond the
 * catalog). Names that are not single components contribute nothing.
 */
export function buildSkillAutoApproveList(
  input: BuildSkillAutoApproveListInput,
): SkillAutoApproveList {
  const fs = input.fs ?? realFs;
  const canonicalPath = input.rootObservation.root;
  const identity = input.rootObservation.identity;
  if (!identity) {
    throw new Error(
      `Skill inventory requires a canonical root observation with a recorded identity for "${canonicalPath}" ` +
        `(an unobserved root cannot anchor decision-time identity rechecks)`,
    );
  }

  // The root must be physically present, a real directory, and still the same
  // physical tree the resolver canonicalized.
  const rootStat = fs.lstat(canonicalPath);
  if (!rootStat.isDirectory || fs.realPath(canonicalPath) !== canonicalPath) {
    throw new Error(`Skill inventory root "${canonicalPath}" is not a canonical directory`);
  }

  const configured = input.configuredSkills ?? [];
  const configuredSet = new Set(configured.filter(isValidSkillNameComponent));
  const explicitFilter = configured.length > 0;

  // Candidate skill names: OpenCode observes the directory; OMP inspects ONLY
  // the deployment-controlled catalog names inside the root.
  const candidateNames: string[] = [];
  if (input.agentType === "omp") {
    for (const name of BUNDLED_SKILLS) {
      if (explicitFilter && !configuredSet.has(name)) continue;
      candidateNames.push(name);
    }
  } else {
    const observed: string[] = [];
    for (const entry of fs.readDir(canonicalPath)) {
      if (!entry.isDirectory) continue;
      if (RESERVED_SKILL_ENTRIES.includes(entry.name)) continue;
      observed.push(entry.name);
    }
    for (const name of observed) {
      if (explicitFilter && !configuredSet.has(name)) continue;
      candidateNames.push(name);
    }
  }

  const scripts: SkillScriptEntry[] = [];
  const commandPrefixes = new Set<string>();
  for (const name of candidateNames) {
    if (!isValidSkillNameComponent(name)) continue;
    const skillDir = `${canonicalPath}${SEPARATOR}${name}`;
    let skillIsRealDirectory = false;
    try {
      const stat = fs.lstat(skillDir);
      skillIsRealDirectory = stat.isDirectory && fs.realPath(skillDir) === skillDir;
    } catch {
      skillIsRealDirectory = false;
    }
    if (!skillIsRealDirectory) {
      // Missing/inaccessible skill directory: NO grant of any kind. The old
      // promotion of an absent skill to a command prefix is removed.
      continue;
    }
    let hasSkillDocument = false;
    try {
      hasSkillDocument = fs.lstat(`${skillDir}${SEPARATOR}SKILL.md`).isFile;
    } catch {
      hasSkillDocument = false;
    }
    const scriptsDir = `${skillDir}${SEPARATOR}scripts`;
    let scriptsEntries: Deno.DirEntry[] | null;
    let scriptsDirAbsent = false;
    try {
      scriptsEntries = fs.readDir(scriptsDir);
    } catch {
      scriptsEntries = null;
      // ABSENT (nothing exists at the path — Deno.errors.NotFound ONLY) is a
      // command-based skill shape; a path that EXISTS but fails enumeration,
      // or whose metadata cannot be OBSERVED at all (permission/IO errors —
      // post-duck N1: an unobservable path is not proof of absence), never
      // grants a command prefix.
      try {
        fs.lstat(scriptsDir);
        scriptsDirAbsent = false;
      } catch (error) {
        scriptsDirAbsent = error instanceof Deno.errors.NotFound;
      }
    }
    if (scriptsEntries === null) {
      // No scripts-directory observation. Only an ACTUAL command-based skill —
      // an observed SKILL.md document with an ABSENT scripts directory — may
      // keep a command prefix; an error reading the scripts directory of a
      // script skill is never reinterpreted as one.
      if (hasSkillDocument && scriptsDirAbsent) commandPrefixes.add(name);
      continue;
    }
    for (const script of scriptsEntries) {
      if (!script.isFile || !script.name.endsWith(".ts")) continue;
      const scriptPath = `${scriptsDir}${SEPARATOR}${script.name}`;
      try {
        const stat = fs.lstat(scriptPath);
        if (!stat.isFile) continue;
        const canonical = fs.realPath(scriptPath);
        // Reject linked/escaping scripts: the canonical file must remain the
        // exact spelling enumerated under the root.
        if (canonical !== scriptPath) continue;
        if (!isUnderRoot(canonical, canonicalPath)) continue;
        if (stat.dev === null || stat.ino === null) continue;
        scripts.push({ canonicalPath: canonical, dev: stat.dev, ino: stat.ino });
      } catch {
        // Unreadable observation: never a grant.
        continue;
      }
    }
  }

  return Object.freeze({
    root: { ...input.rootObservation, canonicalPath },
    scripts: Object.freeze(scripts),
    commandPrefixes,
  });
}

/** Boundary-safe physical containment (exact equality or separator-prefixed). */
export function isUnderRoot(path: string, root: string): boolean {
  if (path === root) return true;
  return path.startsWith(root + SEPARATOR);
}

// ---------------------------------------------------------------------------
// Decision-time entrypoint matching
// ---------------------------------------------------------------------------

/** Interpreters that may precede a skill script as the launcher. */
const ALLOWED_SCRIPT_INTERPRETERS = new Set(["deno"]);

/**
 * Flags the `deno [flags] run [flags] <script>` grammar may carry without
 * ever introducing or affecting an executable module (post-duck B2: skipping
 * every dash token allowed `--preload <trusted> <evil>` to launder the
 * trusted token as the "entrypoint" while Deno executes the preload module
 * and an unapproved main). ONLY these value-less / value-inconsequential
 * permission-and-noise flags are skipped; anything else — `--preload`/
 * `--import`, `--import-map`, `--inspect`, `--v8-flags`, `--config`, `--env`,
 * `--` and any unknown flag — denies fail-closed rather than guessing arity.
 */
const DENO_RUN_SAFE_FLAGS =
  /^(-A|--allow-all|--allow-(net|read|write|env|run|ffi|hrtime|sys|import)(=\S+)?|--no-check|-r|--quiet|-q|--no-lock)$/;

/**
 * Locate the invocation ENTRYPOINT and its class.
 *
 * Direct shebang execution: the first token is the entrypoint — but ONLY when
 * it is not a known interpreter. Interpreter launch requires the supported
 * grammar `deno [flags...] run [flags...] <script> <args...>`: the FIRST
 * non-flag token after `deno` must be exactly the `run` subcommand (so
 * `deno task run <script>` — where `run` merely launches a workspace task and
 * the path is its ARGUMENT — is never an interpreter entrypoint), and the
 * entrypoint is the first positional after `run`. Flags after `run` are
 * restricted to {@link DENO_RUN_SAFE_FLAGS}: a flag that can introduce an
 * executable module or take an arity-guessable value aborts the match.
 */
function resolveScriptEntrypoint(
  tokens: string[],
): { token: string; viaInterpreter: boolean } | undefined {
  if (tokens.length === 0) return undefined;
  const first = decodeLiteralToken(tokens[0]);
  if (first === undefined) return undefined;
  if (!ALLOWED_SCRIPT_INTERPRETERS.has(first)) {
    return { token: first, viaInterpreter: false };
  }
  // Interpreter route: `deno ... run ...`
  let position = 1;
  while (position < tokens.length) {
    const token = decodeLiteralToken(tokens[position]);
    if (token === undefined) return undefined;
    if (token.startsWith("-")) {
      if (!DENO_RUN_SAFE_FLAGS.test(token)) return undefined;
      position++;
      continue;
    }
    // The first positional after `deno` MUST be the `run` subcommand.
    if (token !== "run") return undefined;
    position++;
    break;
  }
  if (position >= tokens.length) return undefined;
  while (position < tokens.length) {
    const token = decodeLiteralToken(tokens[position]);
    if (token === undefined) return undefined;
    if (token.startsWith("-")) {
      if (!DENO_RUN_SAFE_FLAGS.test(token)) return undefined;
      position++;
      continue;
    }
    return { token, viaInterpreter: true };
  }
  return undefined;
}

/**
 * Decode one tokenizer token into its literal shell value, fail-closed.
 *
 * The shared tokenizer preserves quote context, so a token may carry quotes
 * and backslash escapes. Supported forms: a bare unquoted token with no
 * backslash or `$` (nothing expandable); or ONE balanced whole-token quoted
 * value (`'...'` or `"..."`) whose interior carries no further quote of that
 * kind (single) and no expansions (`$`/backtick, double). Composite, partially
 * quoted, escaped-quote, or expandable entrypoints (where the literal file
 * name the shell would exec cannot be established) return `undefined` — the
 * matcher denies rather than guessing a pathname.
 */
export function decodeLiteralToken(token: string): string | undefined {
  if (token.length === 0) return undefined;
  const first = token[0];
  const last = token[token.length - 1];
  const isQuoted = (token.length >= 2) &&
    ((first === "'" && last === "'") || (first === '"' && last === '"'));
  if (isQuoted) {
    const inner = token.slice(1, -1);
    if (first === "'") {
      // Single quotes are literal: any inner single quote means the token was
      // composite (`'a'b'c'`), not one balanced literal.
      if (inner.includes("'")) return undefined;
      return inner;
    }
    // Double quotes: escapes are decoded; an unescaped inner `"` or any `$`/
    // backtick expansion means the literal value is not establishable.
    let decoded = "";
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "\\") {
        const next = inner[i + 1];
        if (next === undefined) return undefined;
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          // `\"`, `\\` decode to the literal; `\$`/`` \` `` suppress expansion
          // and also decode literally for exec-path purposes.
          decoded += next;
          i++;
          continue;
        }
        // Shell keeps other `\X` sequences verbatim inside double quotes.
        decoded += ch + next;
        i++;
        continue;
      }
      if (ch === '"') return undefined;
      if (ch === "$" || ch === "`") return undefined;
      decoded += ch;
    }
    return decoded;
  }
  // Unquoted: quotes/backslashes/expansions composite the token.
  if (token.includes("'") || token.includes('"') || token.includes("\\")) return undefined;
  if (containsUnquotedShellExpansion(token)) return undefined;
  return token;
}

/** Decision-time inputs for one script-entrypoint evaluation. */
export interface ScriptEntrypointDecisionContext {
  /**
   * The requesting REGISTERED session cwd, or `undefined` when the session has
   * no registered gate context. A relative entrypoint without it is denied —
   * never resolved against the daemon cwd or any fallback tree.
   */
  sessionCwd: string | undefined;
  /** Filesystem seam for tests; defaults to the real filesystem. */
  fs?: SkillInventoryFs;
}

/**
 * Lexical (no-symlink-traversal) normalization, matching how Deno turns a
 * module argument into a URL (`deno_path_util::normalize_path` collapses
 * `.`/`..` components WITHOUT resolving symlinks). Used ONLY as a disagreement
 * guard for spellings containing a `..` component (post-duck B1): when a `..`
 * follows a symlinked directory, the kernel traversal the matcher observes and
 * the loader's lexical target DIFFER (`W/jump/../scripts/x.ts` physically
 * reaches the root grant while Deno lexically lands on `W/scripts/x.ts` — a
 * planted file). Such ambiguous spellings deny; ordinary `..` spellings on
 * symlink-free paths still approve because lexical and physical agree.
 */
function lexicallyNormalize(path: string): string {
  const absolute = path.startsWith(SEPARATOR);
  const out: string[] = [];
  for (const part of path.split(SEPARATOR)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      // Absolute paths cannot ascend above `/`; relative ones are already
      // anchored at a cwd, so a leading `..` there is also a no-op.
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(part);
  }
  return (absolute ? SEPARATOR : "") + out.join(SEPARATOR);
}

/**
 * Whether a command segment's ENTRYPOINT is exactly one of the inventory's
 * enumerated canonical scripts under the still-intact observed root.
 *
 * Physical, not lexical: a relative spelling is anchored at the registered
 * session cwd by RAW component concatenation and handed to `realPath`, so a
 * symlink-free `..` spelling resolves exactly as the loader would. Exception
 * (post-duck B1): when the spelling contains a `..`, lexical and physical
 * resolution must AGREE — an ambiguous `link/../…` spelling whose loader-side
 * lexical target differs from the kernel traversal denies. A slashless
 * direct-exec token is PATH-resolved by the shell — never cwd — so it can
 * never name a script grant here; a slashless positional after a genuine
 * `deno run` IS cwd-relative to Deno and remains eligible.
 */
export function matchesScriptEntrypoint(
  segment: string,
  list: SkillAutoApproveList,
  ctx: ScriptEntrypointDecisionContext,
): boolean {
  const fs = ctx.fs ?? realFs;
  if (containsShellOperators(commandWithoutFdRedirects(segment))) return false;
  const tokens = tokenizeShellCommand(segment).filter((t) => t.length > 0);
  // A tolerated fd-to-fd redirect token is an operator artifact, never an
  // argument — skip it when locating the entrypoint, exactly as before.
  const entrypoint = resolveScriptEntrypoint(
    tokens.filter((t) => !FD_REDIRECT_TOKEN_PATTERN.test(t)),
  );
  if (entrypoint === undefined) return false;

  const spelling = entrypoint.token;
  if (spelling.includes("\0")) return false;

  // Direct execution of a slashless token goes through the shell's PATH, not
  // the session cwd: only an explicit pathname can name a script grant.
  if (!entrypoint.viaInterpreter && !spelling.startsWith("/") && !spelling.includes("/")) {
    return false;
  }

  let candidate: string;
  if (spelling.startsWith("/")) {
    candidate = spelling;
  } else {
    // Relative: physical anchoring at the registered session cwd only.
    if (ctx.sessionCwd === undefined) return false;
    candidate = ctx.sessionCwd.endsWith(SEPARATOR)
      ? ctx.sessionCwd + spelling
      : ctx.sessionCwd + SEPARATOR + spelling;
  }

  // Physically observe the spelled path exactly as written (kernel traversal).
  let canonical: string;
  try {
    canonical = fs.realPath(candidate);
  } catch {
    return false;
  }

  // Ambiguity guard (B1): a `..` spelling whose lexical normalization differs
  // from the physical traversal crosses a symlinked directory — the interpreter
  // would lexically load a DIFFERENT file than the one observed here. Deny.
  if (spelling.split(SEPARATOR).includes("..") && lexicallyNormalize(candidate) !== canonical) {
    return false;
  }

  // Exact canonical membership among the enumerated grants.
  const entry = list.scripts.find((script) => script.canonicalPath === canonical);
  if (entry === undefined) return false;

  // Decision-time root/target observation: a replaced root identity, a root
  // that ceased to be its canonical directory, or a replaced script body all
  // deny without any suffix/home/cwd retry.
  try {
    const rootStat = fs.lstat(list.root.canonicalPath);
    if (!rootStat.isDirectory) return false;
    if (rootStat.dev !== list.root.identity?.dev || rootStat.ino !== list.root.identity?.ino) {
      return false;
    }
    if (fs.realPath(list.root.canonicalPath) !== list.root.canonicalPath) return false;
    const stat = fs.lstat(entry.canonicalPath);
    if (!stat.isFile) return false;
    if (stat.dev !== entry.dev || stat.ino !== entry.ino) return false;
    if (fs.realPath(entry.canonicalPath) !== entry.canonicalPath) return false;
  } catch {
    return false;
  }
  return isUnderRoot(canonical, list.root.canonicalPath);
}
