// src/acp/client.ts

import * as acp from "@agentclientprotocol/sdk";
import { join, resolve, SEPARATOR } from "@std/path";
import type { SkillRegistry } from "@skills/registry.ts";
import type { Logger } from "@utils/logger.ts";
import type { ClientConfig, PermissionRejection } from "./types.ts";
import type { SkillContext } from "@skills/types.ts";
import type { SessionAuditWriter } from "@core/audit-logger.ts";
import { sha256Hash } from "@utils/hash.ts";
import {
  opencodeDataRoot,
  opencodeToolOutputDir,
  sessionXdgDataHome,
} from "@utils/opencode-paths.ts";

/**
 * Auto-approved skill lists for restricted (non-YOLO) mode.
 */
export interface SkillAutoApproveList {
  /** Script skill path suffixes: "skills/memory-save/scripts/memory-save.ts" */
  scriptPaths: Set<string>;
  /** Command skill prefixes: "agent-browser" */
  commandPrefixes: Set<string>;
}

/**
 * Build skill auto-approve list.
 * When configuredSkills is provided and non-empty, builds the list from config.
 * Otherwise falls back to scanning the skills directory (backward compatible).
 */
export function buildSkillAutoApproveList(
  skillsDir: string,
  configuredSkills?: string[],
): SkillAutoApproveList {
  if (configuredSkills && configuredSkills.length > 0) {
    return buildFromConfig(skillsDir, configuredSkills);
  }
  return buildFromDirectory(skillsDir);
}

/**
 * Build auto-approve list from configured skill names.
 * Scans both the built-in skills directory and ~/.agents/skills/ for external skills.
 */
function buildFromConfig(
  skillsDir: string,
  configuredSkills: string[],
): SkillAutoApproveList {
  const scriptPaths = new Set<string>();
  const commandPrefixes = new Set<string>();

  const scanDirs = [skillsDir];
  const homeSkillsDir = join(Deno.env.get("HOME") ?? "/home/deno", ".agents", "skills");
  try {
    Deno.statSync(homeSkillsDir);
    scanDirs.push(homeSkillsDir);
  } catch {
    // External skills directory doesn't exist
  }

  for (const skillName of configuredSkills) {
    let found = false;
    for (const dir of scanDirs) {
      const scriptsPath = join(dir, skillName, "scripts");
      try {
        for (const script of Deno.readDirSync(scriptsPath)) {
          if (script.isFile && script.name.endsWith(".ts")) {
            scriptPaths.add(`skills/${skillName}/scripts/${script.name}`);
            found = true;
          }
        }
      } catch {
        // No scripts dir in this scan path
      }
    }
    if (!found) {
      // Command-based skill or not yet installed
      commandPrefixes.add(skillName);
    }
  }

  return { scriptPaths, commandPrefixes };
}

/**
 * Build auto-approve list by scanning the skills directory (fallback).
 */
function buildFromDirectory(skillsDir: string): SkillAutoApproveList {
  const scriptPaths = new Set<string>();
  const commandPrefixes = new Set<string>();

  try {
    for (const entry of Deno.readDirSync(skillsDir)) {
      if (!entry.isDirectory || entry.name === "lib") continue;

      const scriptsPath = join(skillsDir, entry.name, "scripts");
      try {
        for (const script of Deno.readDirSync(scriptsPath)) {
          if (script.isFile && script.name.endsWith(".ts")) {
            scriptPaths.add(`skills/${entry.name}/scripts/${script.name}`);
          }
        }
      } catch {
        // No scripts dir — this is a command-based skill
        commandPrefixes.add(entry.name);
      }
    }
  } catch {
    // Skills directory not found — return empty lists
  }

  return { scriptPaths, commandPrefixes };
}

/**
 * Read-extension allowlist for `readTextFile` (F4). Intentionally BROADER than the
 * write allowlist (`.md`/`.txt`): the agent legitimately reads workspace memory JSONL
 * (`.jsonl`), markdown notes/prompts (`.md`), and plain text (`.txt`). Any other
 * extension (e.g. a `.json` cache/token file) is denied.
 */
export const ALLOWED_READ_EXTENSIONS = [".jsonl", ".md", ".txt"];

/**
 * Boundary-safe containment check (F4).
 *
 * Returns `true` only when the resolved candidate path equals the resolved base
 * directory OR begins with the resolved base followed by a path separator. This
 * rejects sibling-prefix escapes such as `/data/workspaces/discord/1234` matching
 * base `/data/workspaces/discord/123` — a real risk because Discord snowflake IDs
 * are variable-length, so a naive `startsWith` could leak a sibling user's files.
 */
export function isWithinDir(path: string, base: string): boolean {
  try {
    const resolvedPath = resolve(path);
    const resolvedBase = resolve(base);
    if (resolvedPath === resolvedBase) return true;
    return resolvedPath.startsWith(resolvedBase + SEPARATOR);
  } catch {
    return false;
  }
}

/**
 * Check whether a file path's extension is in the given allowlist (case-insensitive).
 */
function hasAllowedExtension(filePath: string, allowed: string[]): boolean {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filePath.length - 1) return false;
  const ext = filePath.substring(dotIndex).toLowerCase();
  return allowed.some((e) => ext === e.toLowerCase());
}

/**
 * Check if a command string contains shell operators that could enable injection.
 * Rejects commands containing: ; | & ` ( ) > < # and newlines.
 *
 * Quote-aware (F12 D2 chaining rule): the command-sequence / redirection / comment
 * operators `;` `|` `&` `>` `<` `#` and newlines are only operators OUTSIDE quotes —
 * inside single or double quotes they are literal data that cannot chain or
 * redirect (a quoted `;` is an argument, a quoted `>` is a file name). Backticks
 * and `$()`-parens are detected EVEN INSIDE double quotes (command substitution
 * executes there); only single quotes make them literal.
 *
 * Note: `$` is intentionally allowed for shell variable expansion ($HOME, ${VAR}).
 * Command substitution `$()` is still caught because `(` is rejected.
 */
export function containsShellOperators(cmd: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    // A literal newline is NEVER safe, in any quote state: unquoted it separates
    // commands, and a backslash-escaped newline (`\<newline>`) is a line
    // continuation that bash silently removes — `cat \<newline>/etc/passwd`
    // executes `cat /etc/passwd`. Checked before escape/quote handling so no
    // escape sequence can hide it.
    if (ch === "\n") return true;

    if (quote === "'") {
      if (ch === "'") quote = null;
      continue; // single-quoted text is fully literal
    }

    if (quote === '"') {
      if (ch === "\\") {
        // A backslash-escaped newline inside double quotes is also a line
        // continuation — reject before the escape skips it.
        if (cmd[i + 1] === "\n") return true;
        i++;
        continue;
      }
      if (ch === '"') {
        quote = null;
        continue;
      }
      // Backtick and `$(` execute even inside double quotes.
      if (ch === "`" || ch === "(" || ch === ")") return true;
      continue;
    }

    if (ch === "\\") {
      // A backslash-escaped newline is a line continuation (the newline is
      // silently removed) — reject before the escape skips it.
      if (cmd[i + 1] === "\n") return true;
      i++; // escaped char is literal
      continue;
    }
    if (ch === "'") {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = '"';
      continue;
    }
    if (ch === "`" || ";|&()><#".includes(ch)) return true;
  }
  return false;
}

/**
 * Quote-aware whitespace tokenizer: splits a command on space/tab boundaries that
 * appear OUTSIDE quotes, keeping each quoted string (including its quotes) as ONE
 * token. Shell-correct backslash escapes are honored inside double quotes and
 * outside quotes (`\ ` → escaped space is part of the token).
 *
 * Unlike a naive `split(/\s+/)`, this preserves quote context per token so the
 * shell-expansion scanner and the path checks can tell quoted `$`/`{`/operators
 * from unquoted ones (F12 D2 chaining rule + F12 D5).
 */
export function tokenizeShellCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let i = 0;
  const n = cmd.length;

  while (i < n) {
    const ch = cmd[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      current += ch;
      i++;
      continue;
    }

    if (quote === '"') {
      if (ch === "\\" && i + 1 < n) {
        current += ch + cmd[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') quote = null;
      current += ch;
      i++;
      continue;
    }

    if (ch === "\\") {
      if (i + 1 < n) {
        current += ch + cmd[i + 1];
        i += 2;
      } else {
        current += ch;
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Whole-token fd-to-fd redirection tolerated by the permission gates (F12 D1).
 *
 * A whitespace-delimited token that is EXACTLY `N>&M`, where `N` is one-or-more
 * decimal digits and `M` (the SOURCE descriptor) is a standard stream `1` or `2`
 * (e.g. `2>&1`, `1>&2`, `3>&1`), duplicates an already-open standard stdout/stderr
 * capture pipe and references no path on disk. Restricting the source descriptor to
 * the always-connected standard streams keeps the tolerance provably non-escaping:
 * an unchecked `1>&3`-style redirect could write into a harness-inherited high
 * descriptor the gate cannot see, so non-standard sources stay rejected.
 */
export const FD_REDIRECT_TOKEN_PATTERN = /^\d+>&[12]$/;

/**
 * Remove tolerated fd-to-fd redirection tokens from a command for the shell-operator
 * check and path-argument scan. Splits on shell TOKEN separators (space/tab only —
 * NOT newline, which is a shell command separator and must survive for the operator
 * check), drops tokens matching {@link FD_REDIRECT_TOKEN_PATTERN} in full, and rejoins
 * with single spaces.
 *
 * Only an UNQUOTED, exact, whitespace-delimited token with a standard-stream source
 * is dropped. Glued forms (`2>&1&&cat`, `2>&1;cat`), digit-prefixed filenames a shell
 * opens for writing (`2>&1/tmp/x`, `2>&1x`), file redirects (`2>/dev/null`),
 * non-standard source descriptors (`1>&3`, `9>&99`), and newline-separated second
 * commands (`2>&1\nrm victim`) all survive the filter, so their residual operator/path
 * is still detected. The real command still executes with the redirection (OpenCode
 * runs the original) — this only relaxes the permission decision.
 */
export function commandWithoutFdRedirects(cmd: string): string {
  return cmd.trim().split(/[ \t]+/)
    .filter((t) => t.length > 0 && !FD_REDIRECT_TOKEN_PATTERN.test(t))
    .join(" ");
}

/**
 * Quote-aware split of a multi-command bash invocation into its non-empty command
 * segments (F12 D2 chaining rule).
 *
 * Splits on the command-sequence operators `;`, `&&`, `||` ONLY when the operator
 * text appears OUTSIDE quotes:
 * - `'...'` single quotes are fully literal (no escapes).
 * - `"..."` double quotes honor shell-correct backslash escapes: `\` before
 *   `"` / `\` / `$` / backtick skips the next character (conservatively, any
 *   escaped character is skipped — a mis-escape can only over-reject, never
 *   under-reject, because every segment still passes the full single-command gate).
 * - `\` outside quotes escapes the next character.
 *
 * Segments are trimmed and empty ones are dropped (`; ;`, leading/trailing
 * separators). An unbalanced quote disables splitting entirely (returns `[cmd]`
 * — the single-command gate then evaluates the whole string; an unbalanced quote
 * can only cause a runtime shell error, never an escape). A command containing no
 * separator returns `[cmd]` byte-for-byte, so single-command behavior is
 * identical to today. Pipes `|`, backgrounding `&`, and newlines are NOT splitting
 * boundaries — a single `&`/`|` is left in the segment and rejected downstream.
 */
export function splitCommandSegments(cmd: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let hasSeparator = false;
  let i = 0;
  const n = cmd.length;

  while (i < n) {
    const ch = cmd[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      current += ch;
      i++;
      continue;
    }

    if (quote === '"') {
      if (ch === "\\" && i + 1 < n) {
        current += ch + cmd[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') quote = null;
      current += ch;
      i++;
      continue;
    }

    // Unquoted state.
    if (ch === "\\") {
      if (i + 1 < n) {
        current += ch + cmd[i + 1];
        i += 2;
      } else {
        current += ch;
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i++;
      continue;
    }
    if (ch === ";") {
      hasSeparator = true;
      const trimmed = current.trim();
      if (trimmed.length > 0) segments.push(trimmed);
      current = "";
      i++;
      continue;
    }
    if (ch === "&" || ch === "|") {
      if (cmd[i + 1] === ch) {
        hasSeparator = true;
        const trimmed = current.trim();
        if (trimmed.length > 0) segments.push(trimmed);
        current = "";
        i += 2;
        continue;
      }
      // Single `&` / `|` is not a splitting boundary; it survives in the segment
      // and is rejected by the shell-operator check.
      current += ch;
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (quote !== null) return [cmd]; // unbalanced quotes → splitting disabled
  const trimmed = current.trim();
  if (trimmed.length > 0) segments.push(trimmed);
  // No separator found → byte-identical single-command evaluation.
  if (!hasSeparator && segments.length <= 1 && segments[0] === cmd) return [cmd];
  return segments;
}

/** Interpreters that may precede a skill script as the launcher (e.g. `deno run <script>`). */
const ALLOWED_SCRIPT_INTERPRETERS = new Set(["deno"]);

/**
 * Legacy free-text skill argument flags (D5). A skill command carrying one of
 * these in either form (`--message x` or `--message=x`) is rejected by the gate
 * as defense-in-depth — free-text content must never reach a shell command line
 * (bash would expand `$VAR` in it). Distinct tokens such as `--message-id`,
 * `--message-file`, `--content-file`, `--query-file`, `--caption-file` do not
 * match and are unaffected.
 */
export const LEGACY_FREE_TEXT_FLAG_PATTERN = /^--(?:message|content|query|caption)(?:=|$)/;

/**
 * Determine whether a single token equals the whitelisted script path or ends with
 * `/<allowedPath>` (so an absolute/`$HOME`-anchored path to the same script matches).
 */
function tokenMatchesAllowedScript(token: string, allowedPath: string): boolean {
  return token === allowedPath || token.endsWith(`/${allowedPath}`);
}

/**
 * Resolve the invocation ENTRYPOINT token of a command.
 *
 * Skills are executed either directly via their shebang
 * (`${HOME}/.agents/skills/<name>/scripts/<name>.ts <args>`) — first token is the
 * script — or via an interpreter (`deno run <flags> <script> <args>`) — the script
 * is the first non-flag positional after the `run` subcommand.
 *
 * Returns the entrypoint token, or `undefined` if it cannot be determined.
 */
function resolveEntrypointToken(tokens: string[]): string | undefined {
  if (tokens.length === 0) return undefined;

  const first = tokens[0];
  // Direct shebang execution: the script itself is the entrypoint.
  if (!ALLOWED_SCRIPT_INTERPRETERS.has(first)) {
    return first;
  }

  // Interpreter launch (e.g. `deno run <flags...> <script> <args>`): find the first
  // non-flag positional token AFTER the `run` subcommand. Flags (leading `-`) and the
  // `run` subcommand itself are skipped; the next positional is the entrypoint.
  let sawRun = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (!sawRun) {
      if (t === "run") sawRun = true;
      // Skip interpreter-level flags/subcommands until we see `run`.
      continue;
    }
    if (t.startsWith("-")) continue; // skip `deno run` flags (e.g. --allow-net)
    return t; // first positional after `run` is the entrypoint script
  }
  return undefined;
}

/**
 * Check whether a command's INVOCATION ENTRYPOINT is an allowed skill script.
 *
 * Security (F2): the whitelisted script path is only accepted when it is the actual
 * invocation entrypoint — either the first token (direct shebang execution) or the
 * first positional after `deno run`. A whitelisted script path appearing merely as a
 * trailing ARGUMENT to some other command (e.g. `cat <secret> <script>`) is NOT approved,
 * closing the "arbitrary first token launders an allowed path" bypass.
 */
export function matchesScriptPath(cmd: string, allowedPath: string): boolean {
  if (containsShellOperators(commandWithoutFdRedirects(cmd))) return false;
  const tokens = tokenizeShellCommand(cmd).filter((t) => t.length > 0);
  // A tolerated fd-to-fd redirect token must NOT affect entrypoint resolution (it is
  // not a real argument), so it is skipped when locating the entrypoint. The first-token
  // allow-list check below still operates on the ORIGINAL token, so a redirect can never
  // masquerade as the entrypoint.
  const entrypoint = resolveEntrypointToken(
    tokens.filter((t) => !FD_REDIRECT_TOKEN_PATTERN.test(t)),
  );
  if (entrypoint === undefined) return false;
  return tokenMatchesAllowedScript(entrypoint, allowedPath);
}

/**
 * Determine whether an argument token references a path OUTSIDE the workspace.
 * Rejects absolute paths (`/etc/...`), home-anchored paths (`~/...`, `$HOME/...`),
 * and parent-traversal (`../`). Workspace-relative paths and non-path flags/values
 * are allowed. Used to keep a whitelisted command prefix from being used to read
 * sensitive files (e.g. `agent-browser /home/deno/.git-credentials`).
 */
export function referencesOutOfWorkspacePath(token: string): boolean {
  // F12 D5: an unquoted non-harness `$VAR` reference or unquoted brace token could
  // expand to an out-of-workspace path at runtime — the skill matchers reject it.
  // The harness-set variables (`$TMPDIR`, `$AGENT_WORKSPACE`, `$SESSION_ID`, `$HOME`,
  // `$XDG_DATA_HOME`) are recognized as known WITHOUT expansion, preserving the
  // `--content-file $TMPDIR/$SESSION_ID/x.md` skill payload contract.
  if (containsUnquotedShellExpansion(token)) return true;

  // Strip surrounding quotes and common `--flag=` prefixes so a quoted or flag-embedded
  // absolute path (e.g. `"/etc/passwd"`, `--file=/etc/passwd`) is still inspected.
  let t = token;
  const eq = t.indexOf("=");
  if (eq !== -1 && t.startsWith("-")) t = t.substring(eq + 1);
  t = t.replace(/^["']+/, "").replace(/["']+$/, "");

  // Reject FILESYSTEM-reaching URI schemes (e.g. `file://`, and any non-network scheme such
  // as `ftp://`/`gopher://`/`dict://`) as out-of-workspace (F12 D3). `referencesOutOfWorkspacePath`
  // was scheme-blind, so `agent-browser open file:///etc/passwd` slipped past the leading-`/`
  // check. `http(s)://` is intentionally NOT rejected here: a network URL is not a filesystem
  // path, and `agent-browser` legitimately navigates to web URLs — that egress is mediated by
  // F14, not by this filesystem gate.
  const schemeMatch = t.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return true;
  }

  if (t.startsWith("/")) return true; // absolute path
  if (t.startsWith("~")) return true; // home-anchored
  if (t.startsWith("$HOME") || t.startsWith("${HOME}")) return true;
  // Parent traversal anywhere in the token (e.g. `../`, `a/../../b`)
  if (t === ".." || t.includes("../")) return true;
  return false;
}

/**
 * Check if the first token of a command exactly matches an allowed command name,
 * AND that no subsequent argument references a path outside the workspace.
 *
 * First rejects commands with shell injection characters, then verifies the prefix
 * is the exact first whitespace-delimited token. Security (F2): even with a matching
 * prefix, an out-of-workspace path argument causes rejection so a whitelisted command
 * cannot be used to reach sensitive files outside the sandbox.
 */
export function matchesCommandPrefix(cmd: string, prefix: string): boolean {
  if (containsShellOperators(commandWithoutFdRedirects(cmd))) return false;
  const tokens = tokenizeShellCommand(cmd).filter((t) => t.length > 0);
  if (tokens[0] !== prefix) return false;
  // Reject if any argument references a path outside the workspace.
  for (let i = 1; i < tokens.length; i++) {
    if (referencesOutOfWorkspacePath(tokens[i])) return false;
  }
  return true;
}

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
const DANGEROUS_GENERIC_FLAGS: ReadonlySet<string> = new Set([
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

/**
 * Names of the harness-set environment variables the permission gates treat as
 * KNOWN (expandable / recognizable). Everything else an unquoted `$` references
 * is rejected (F12 D5) because its expansion could resolve out-of-workspace.
 */
const KNOWN_ENV_REFERENCES = new Set([
  "HOME",
  "XDG_DATA_HOME",
  "TMPDIR",
  "AGENT_WORKSPACE",
  "SESSION_ID",
]);

/**
 * Scan a single argument token for shell expansions that could resolve to an
 * out-of-workspace path at runtime (F12 D5).
 *
 * Returns `true` (reject) when the token contains:
 * - an UNQUOTED `$VAR` / `${VAR}` reference whose name is not one of the
 *   harness-set variables (e.g. `$IFS/etc/passwd`, `${OTHER}/x`) — an unquoted
 *   expansion can be word-split into an out-of-workspace path; or
 * - an UNQUOTED brace-expansion token (`{...}` — e.g. `{safe,/etc/passwd}`),
 *   which can enumerate out-of-workspace paths; or
 * - a DOUBLE-QUOTED `$VAR` / `${VAR}` reference to a non-harness variable that
 *   BEGINS the token's path content (e.g. `"$X/etc/passwd"`, `"$X"`, `"$_"`,
 *   `"$@"`, `--flag="$X"`): a quoted expansion is not word-split, but an UNSET
 *   variable expands to empty, and an empty expansion followed by a literal
 *   `/...` or `..` suffix IS an absolute / traversal path (a set variable can
 *   also carry an absolute value directly).
 *
 * Returns `false` (allow) for `$`/`{`/`}` inside single quotes (fully literal),
 * for EMBEDDED double-quoted references (`"price $X"`, `"a$X"` — a literal
 * prefix keeps the expanded result relative, and embedded `..`/`/` after a
 * literal prefix still resolves in-workspace), and for references escaped with
 * `\` (literal). Quote state is tracked with shell-correct backslash escapes
 * inside double quotes. A `--flag=` prefix is normalized away before scanning
 * so an attached-option value is judged on its own path content.
 */
export function containsUnquotedShellExpansion(token: string): boolean {
  // Normalize an attached `--flag=value` prefix (mirrors genericArgWithinWorkspace):
  // the flag itself is literal; only the value's path content matters.
  let t = token;
  const eq = t.indexOf("=");
  if (eq !== -1 && t.startsWith("-")) t = t.substring(eq + 1);

  let quote: "'" | '"' | null = null;
  let i = 0;
  const n = t.length;

  while (i < n) {
    const ch = t[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      i++;
      continue;
    }

    if (quote === '"') {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') {
        quote = null;
        i++;
        continue;
      }
      if (ch === "$") {
        const name = referenceNameAt(t, i);
        // A known harness variable is expanded and containment-checked later.
        // An unknown reference is allowed ONLY when embedded after literal text;
        // at the token start (right after the opening quote) an unset or
        // path-valued expansion can turn the whole token absolute/traversal.
        if (!KNOWN_ENV_REFERENCES.has(name)) {
          if (t[i - 1] === '"') return true;
        }
        // Skip past the reference (and its `${...}` closer when applicable).
        if (name === "") {
          i++;
          continue;
        }
        if (t[i + 1] === "{") {
          const close = t.indexOf("}", i + 2);
          i = close === -1 ? i + 1 : close + 1;
          continue;
        }
        i += name.length + 1;
        continue;
      }
      i++;
      continue;
    }

    if (ch === "\\") {
      i += 2; // escaped char is literal
      continue;
    }
    if (ch === "'") {
      quote = "'";
      i++;
      continue;
    }
    if (ch === '"') {
      quote = '"';
      i++;
      continue;
    }
    if (ch === "$") {
      if (t[i + 1] === "{") {
        const close = t.indexOf("}", i + 2);
        if (close === -1) return true; // unterminated `${...` is still a reference
        const name = t.substring(i + 2, close);
        if (!KNOWN_ENV_REFERENCES.has(name)) return true;
        i = close + 1;
        continue;
      }
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(t[j])) j++;
      const name = t.substring(i + 1, j);
      // An empty name (`$@`, `$*`, `$:` ...) or an unknown name is a reference
      // whose expansion the gate cannot bound.
      if (name === "" || !KNOWN_ENV_REFERENCES.has(name)) return true;
      i = j;
      continue;
    }
    if (ch === "{" || ch === "}") return true;
    i++;
  }
  return false;
}

/**
 * Read the variable name of a `$NAME` / `${NAME}` reference at position `i`
 * (which points at the `$`). Returns the name, or "" for non-name forms
 * (`$@`, `$*`, `$:`, an unterminated `${...`).
 */
function referenceNameAt(token: string, i: number): string {
  if (token[i + 1] === "{") {
    const close = token.indexOf("}", i + 2);
    if (close === -1) return "";
    return token.substring(i + 2, close);
  }
  let j = i + 1;
  while (j < token.length && /[A-Za-z0-9_]/.test(token[j])) j++;
  return token.substring(i + 1, j);
}

/**
 * Runtime values of the harness-set environment variables available to the agent
 * subprocess. Provided by the permission-gate caller (requestPermission) from the
 * session client config; used to expand `$TMPDIR` / `$AGENT_WORKSPACE` /
 * `$SESSION_ID` references in generic-command argument tokens before the
 * containment check.
 */
export interface KnownEnvRuntime {
  tmpDir?: string;
  agentWorkspace?: string;
  sessionId?: string;
}

/**
 * Expand harness-set environment references in a command argument token (F12 D5):
 * - leading `~` / `~/...` expand against `home`
 * - `$HOME`, `${HOME}`, `$XDG_DATA_HOME`, `${XDG_DATA_HOME}` anywhere in the token
 *   expand against `home` / `xdgDataHome`
 * - `$TMPDIR`, `${TMPDIR}`, `$AGENT_WORKSPACE`, `${AGENT_WORKSPACE}`, `$SESSION_ID`,
 *   `${SESSION_ID}` expand against the runtime values from `runtimeEnv`
 *
 * Returns the expanded token, or `undefined` when the token is home-anchored in an
 * unexpandable form (`~otheruser/...`, `~notexpanded`) or references a known
 * variable whose runtime value is unavailable (fail-closed: the gate never guesses
 * at an expansion). Expansion is applied AFTER quote stripping and `--flag=value`
 * splitting — including inside attached option values — so `-o$HOME/...` becomes
 * an attached absolute path and is subject to the attached-absolute-path
 * rejection, closing the attached-option escape hole. Unknown `$VAR` references
 * were already rejected by {@link containsUnquotedShellExpansion} before this
 * expansion runs.
 */
function expandKnownEnvReferences(
  token: string,
  home: string,
  xdgDataHome: string,
  runtimeEnv?: KnownEnvRuntime,
): string | undefined {
  if (token === "~" || token.startsWith("~/")) {
    return home + token.substring(1);
  }
  if (token.startsWith("~")) return undefined;

  const references: Array<[string, string | undefined]> = [
    ["${HOME}", home],
    ["$HOME", home],
    ["${XDG_DATA_HOME}", xdgDataHome],
    ["$XDG_DATA_HOME", xdgDataHome],
    ["${TMPDIR}", runtimeEnv?.tmpDir],
    ["$TMPDIR", runtimeEnv?.tmpDir],
    ["${AGENT_WORKSPACE}", runtimeEnv?.agentWorkspace],
    ["$AGENT_WORKSPACE", runtimeEnv?.agentWorkspace],
    ["${SESSION_ID}", runtimeEnv?.sessionId],
    ["$SESSION_ID", runtimeEnv?.sessionId],
  ];
  let expanded = token;
  for (const [ref, value] of references) {
    if (expanded.includes(ref)) {
      if (value === undefined) return undefined; // known var without runtime value → fail closed
      expanded = expanded.split(ref).join(value);
    }
  }
  return expanded;
}

/**
 * Determine whether a single command argument stays inside the allowed workspace dirs.
 *
 * The agent's cwd is the session workspace, so relative tokens (search patterns, numbers,
 * flags, relative file names) always resolve inside it and pass harmlessly. Only tokens
 * that can escape — URI schemes, home-anchored paths, absolute paths, and parent traversal
 * — are resolved and containment-checked against the allowed dirs. This is an
 * over-approximation (a non-path relative token is treated as a harmless in-workspace path),
 * which is safe because the decision only ever GRANTS in-workspace access.
 *
 * `dataRoot` is the session's OpenCode data area root (`{workspace}/tmp/opencode-data`) and
 * `xdgDataHome` is THIS session's own data home under it. Any path that resolves inside the
 * data area but outside the session's own data home is another session's data (or the shared
 * root listing) and is rejected — cross-session isolation for truncated tool outputs.
 *
 * `runtimeEnv` supplies the runtime values for the harness-set variable expansions
 * (`$TMPDIR`, `$AGENT_WORKSPACE`, `$SESSION_ID`; F12 D5).
 */
function genericArgWithinWorkspace(
  token: string,
  base: string,
  allowedDirs: string[],
  home: string,
  xdgDataHome: string,
  dataRoot: string,
  runtimeEnv?: KnownEnvRuntime,
): boolean {
  // F12 D5: an unquoted non-harness `$VAR` reference or unquoted brace token could
  // expand to an out-of-workspace path at runtime — reject before normalization so
  // quote state is still visible (quoted references stay allowed).
  if (containsUnquotedShellExpansion(token)) return false;

  let t = token;
  const eq = t.indexOf("=");
  if (eq !== -1 && t.startsWith("-")) t = t.substring(eq + 1);
  t = t.replace(/^["']+/, "").replace(/["']+$/, "");
  if (t.length === 0) return true;

  // URI schemes cannot be safely resolved into the workspace.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return false;

  // Home-anchored / harness-env tokens are expanded against the runtime values and then run
  // through the same checks as literal paths; unexpandable forms are rejected outright.
  const expanded = expandKnownEnvReferences(t, home, xdgDataHome, runtimeEnv);
  if (expanded === undefined) return false;
  t = expanded;

  // Attached-value option: a `-`-prefixed token whose glued value is absolute or
  // traversal-anchored (e.g. `-o/etc/cron.d`, `-f../sibling/file`, `-o../x`, `-oout/../x`).
  // A value starting with `..` resolves against the cwd and escapes the workspace; a value
  // starting with `/` is absolute; `/../` traverses back out. Bare flags (`-r`) and safe
  // attached values (`-n5`, `-fprogram.jq`) pass. (The `--flag=value` form is already
  // normalized above.)
  if (
    t.startsWith("-") &&
    (/^-{1,2}[a-zA-Z][a-zA-Z0-9-]*\//.test(t) ||
      /^-{1,2}[a-zA-Z][a-zA-Z0-9-]*\.\./.test(t) ||
      t.includes("/../"))
  ) {
    return false;
  }

  // Absolute or relative (incl. `../`): resolve and require containment. `resolve()`
  // normalizes traversal, so `a/../../etc` escaping the workspace is rejected here.
  const resolved = t.startsWith("/") ? resolve(t) : resolve(base, t);
  if (!allowedDirs.some((d) => isWithinDir(resolved, d))) return false;

  // Cross-session isolation (F12): inside the OpenCode data area, only this session's
  // own data home is readable. Sibling/previous sessions' data dirs are rejected even
  // though they lexically resolve inside the workspace.
  if (isWithinDir(resolved, dataRoot) && !isWithinDir(resolved, xdgDataHome)) {
    return false;
  }
  return true;
}

/**
 * Reasons a generic command can be rejected by the generic-command gate (F12 D2).
 * `isApprovedGenericCommand` returns whether the decision is `null`; `requestPermission`
 * uses the first failing command's reason for cause-specific logging and auditing.
 */
export type GenericCommandRejection =
  | "shell_operator"
  | "first_token_not_allowed"
  | "dangerous_flag"
  | "path_outside_boundary";

/**
 * Approve a generic bash command only when its first token is on {@link GENERIC_COMMAND_ALLOWLIST}
 * AND every path-like argument — read input OR write/output target — resolves inside the
 * session workspace/TMPDIR (F12 D2). `base` is the agent cwd used to resolve relative tokens;
 * `allowedDirs` are the containment boundaries (session workspace, agent workspace, session
 * tool-output dir). `home` / `xdgDataHome` / `dataRoot` are the runtime values used to expand
 * home-anchored tokens and enforce the per-session data-area boundary (defaults: the process
 * home and the session-scoped XDG data home derived from `base`).
 */
export function isApprovedGenericCommand(
  cmd: string,
  base: string,
  allowedDirs: string[],
  home: string = Deno.env.get("HOME") ?? "/home/deno",
  xdgDataHome: string = sessionXdgDataHome(base),
  dataRoot: string = opencodeDataRoot(base),
  runtimeEnv?: KnownEnvRuntime,
): boolean {
  return genericCommandRejectionReason(
    cmd,
    base,
    allowedDirs,
    home,
    xdgDataHome,
    dataRoot,
    runtimeEnv,
  ) === null;
}

/**
 * Single source of truth for the generic-command gate decision AND its reason, so the
 * decision and the rejection cause can never drift. Returns `null` when the command is
 * approved, or the FIRST reason it fails:
 *
 * - `"shell_operator"` — the command contains a shell operator other than a tolerated
 *   fd-to-fd redirection token (or a glued/digit-prefixed form that survived the filter)
 * - `"first_token_not_allowed"` — empty command or first token not on the allow-list
 * - `"dangerous_flag"` — a code-exec / arbitrary-target flag (e.g. `find -exec`) present
 * - `"path_outside_boundary"` — a path argument resolves outside the allowed directories
 *
 * A tolerated `N>&[12]` token is removed before the shell-operator check and skipped in the
 * per-token path-argument loop; the first-token allow-list check operates on the ORIGINAL
 * tokens so a redirect can never masquerade as the entrypoint.
 */
export function genericCommandRejectionReason(
  cmd: string,
  base: string,
  allowedDirs: string[],
  home: string = Deno.env.get("HOME") ?? "/home/deno",
  xdgDataHome: string = sessionXdgDataHome(base),
  dataRoot: string = opencodeDataRoot(base),
  runtimeEnv?: KnownEnvRuntime,
): GenericCommandRejection | null {
  if (containsShellOperators(commandWithoutFdRedirects(cmd))) return "shell_operator";
  const tokens = tokenizeShellCommand(cmd).filter((t) => t.length > 0);
  if (tokens.length === 0) return "first_token_not_allowed";
  if (!GENERIC_COMMAND_ALLOWLIST.has(tokens[0])) return "first_token_not_allowed";
  for (let i = 1; i < tokens.length; i++) {
    // A tolerated fd-to-fd redirect token is not a path argument (F12 D1).
    if (FD_REDIRECT_TOKEN_PATTERN.test(tokens[i])) continue;
    // A code-exec / arbitrary-target flag rejects the whole command (e.g. `find -exec`,
    // `find -delete`, `rg --pre`), independent of whether its path arguments are in-workspace.
    if (DANGEROUS_GENERIC_FLAGS.has(tokens[i])) return "dangerous_flag";
    if (
      !genericArgWithinWorkspace(
        tokens[i],
        base,
        allowedDirs,
        home,
        xdgDataHome,
        dataRoot,
        runtimeEnv,
      )
    ) {
      return "path_outside_boundary";
    }
  }
  return null;
}

/**
 * Evaluate a command that may be a `;`/`&&`/`||` multi-command invocation through
 * the generic-command gate segment by segment (F12 D2 chaining rule). Approved
 * (returns `null`) only when EVERY segment independently passes the exact
 * single-command gate it would face as its own tool call; otherwise the FIRST
 * failing segment's cause is returned.
 *
 * A segment consisting ONLY of tolerated fd-to-fd redirect tokens (e.g. the `2>&1`
 * in a glued `2>&1&&cat ...`) is an operator artifact, not a command — it SHALL be
 * rejected as `shell_operator`, never skipped. A command with no separator
 * (`splitCommandSegments` returns `[cmd]`) is evaluated byte-identically to
 * `genericCommandRejectionReason` today. Empty chains (e.g. `; ;`) fall back to
 * evaluating the raw command, which the residual operator rejects.
 */
export function multiCommandRejectionReason(
  cmd: string,
  base: string,
  allowedDirs: string[],
  home: string = Deno.env.get("HOME") ?? "/home/deno",
  xdgDataHome: string = sessionXdgDataHome(base),
  dataRoot: string = opencodeDataRoot(base),
  runtimeEnv?: KnownEnvRuntime,
): GenericCommandRejection | null {
  const segments = splitCommandSegments(cmd);
  // Single-segment (no separator): byte-identical behavior to today.
  if (segments.length === 1 && segments[0] === cmd) {
    return genericCommandRejectionReason(
      cmd,
      base,
      allowedDirs,
      home,
      xdgDataHome,
      dataRoot,
      runtimeEnv,
    );
  }
  // Empty chain (`; ;`): only the operator is present; reject via the raw command.
  if (segments.length === 0) {
    return genericCommandRejectionReason(
      cmd,
      base,
      allowedDirs,
      home,
      xdgDataHome,
      dataRoot,
      runtimeEnv,
    );
  }
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length > 0 && tokens.every((t) => FD_REDIRECT_TOKEN_PATTERN.test(t))) {
      return "shell_operator"; // operator artifact segment
    }
    const reason = genericCommandRejectionReason(
      segment,
      base,
      allowedDirs,
      home,
      xdgDataHome,
      dataRoot,
      runtimeEnv,
    );
    if (reason !== null) return reason;
  }
  return null;
}

/**
 * Classify a permission request as a scoped edit/write request.
 *
 * OpenCode v1.17.13+ (PR #34079 "enrich permission prompts") sends `kind: "edit"`
 * with `title` set to the target FILE PATH for its `write`/`edit`/`apply_patch`/
 * `patch` tools (`toToolKind()` maps all of them to `"edit"`). Older OpenCode
 * versions and other ACP agents used the permission name as `title`
 * (`"edit"`, `"edit_file"`, `"write"`, `"write_file"`). The ACP SDK `ToolKind`
 * vocabulary (`read | edit | delete | move | search | execute | think | fetch |
 * switch_mode | other`) contains no `"write"` kind, so `kind === "write"` cannot
 * occur; the legacy `title: "write"` check below covers pre-rename agents.
 */
export function isEditWriteRequest(title: string, kind: string): boolean {
  return kind === "edit" ||
    title === "edit" ||
    title === "edit_file" ||
    title === "write" ||
    title === "write_file";
}

/**
 * Maximum number of permission-rejection records kept for retry-prompt feedback.
 */
export const MAX_PERMISSION_REJECTIONS = 10;

/**
 * Maximum length of a single rejection field (`toolName`, `kind`, `commandOrPath`)
 * INCLUDING any truncation marker. Fields are sanitized at record time so
 * oversized or agent-influenced content cannot inflate the retry prompt.
 */
export const MAX_PERMISSION_REJECTION_FIELD_LENGTH = 200;

/**
 * Strip control characters and bound an agent-derived rejection field so the
 * retry-prompt diagnostic section cannot be re-injected with user-influenced
 * formatting (e.g. newlines or prompt-structure characters) or oversized content.
 * Applies to `toolName`, `kind`, and `commandOrPath` at record time.
 */
const CONTROL_CHARS_PATTERN = new RegExp(
  `[\\u0000-\\u001f\\u007f]`,
  "g",
);

export function sanitizeRejectionField(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const withoutControlChars = value.replace(CONTROL_CHARS_PATTERN, "");
  if (withoutControlChars.length <= MAX_PERMISSION_REJECTION_FIELD_LENGTH) {
    return withoutControlChars;
  }
  return `${withoutControlChars.slice(0, MAX_PERMISSION_REJECTION_FIELD_LENGTH - 1)}…`;
}

/**
 * ChatbotClient implements the ACP Client interface
 * Handles callbacks from the external OpenCode ACP Agent
 */
export class ChatbotClient implements acp.Client {
  private skillRegistry: SkillRegistry;
  private logger: Logger;
  private config: ClientConfig;
  private replyAlreadySent: boolean = false;
  private skillAutoApproveList: SkillAutoApproveList;
  private auditWriter?: SessionAuditWriter;

  /** Timestamp of the last activity received from the Agent */
  private lastActivityTimestamp: number = Date.now();
  private messageBuffer: string[] = [];
  private thoughtBuffer: string[] = [];

  /**
   * Bounded per-session record of permission denials, consumed by the missing-reply
   * retry prompt (Design Decision 2). NOT cleared in `reset()` — `reset()` runs at
   * the start of every prompt including the retry, so clearing there would wipe the
   * data the retry prompt needs. Cleared exactly once per logical session via
   * `clearPermissionRejections()` from `AgentConnector.createSession()`.
   */
  private recentPermissionRejections: PermissionRejection[] = [];

  /**
   * Optional listener invoked when the Agent sends a `config_option_update`
   * notification, so the AgentConnector can refresh its cached config options.
   */
  private configOptionsListener?: (configOptions: acp.SessionConfigOption[]) => void;

  /**
   * Optional listener invoked on every observed Agent activity (F13). Used to
   * keep the Skill API session's idle timer aligned with real agent liveness,
   * so a long, active turn is never evicted for lack of a skill call.
   */
  private activityListener?: () => void;

  constructor(
    skillRegistry: SkillRegistry,
    logger: Logger,
    config: ClientConfig,
    skillAutoApproveList?: SkillAutoApproveList,
  ) {
    this.skillRegistry = skillRegistry;
    this.logger = logger;
    this.config = config;
    this.skillAutoApproveList = skillAutoApproveList ??
      buildSkillAutoApproveList(join(Deno.cwd(), "skills"));
  }

  /**
   * Get the timestamp of the last activity from the Agent.
   * Used by AgentConnector for idle timeout detection.
   */
  getLastActivityTimestamp(): number {
    return this.lastActivityTimestamp;
  }

  /**
   * Reset the idle timeout tracker without affecting other client state.
   * Called after a successful liveness check to grant another timeout window.
   */
  touchActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Set the audit writer for permission decision auditing.
   * Called after session creation when audit writer becomes available.
   */
  setAuditWriter(writer: SessionAuditWriter): void {
    this.auditWriter = writer;
  }

  /**
   * Register a listener that receives the complete config options list whenever the
   * Agent emits a `config_option_update` notification. Used by AgentConnector to keep
   * its cached config options fresh (e.g. after a model change alters `thought_level`).
   */
  setConfigOptionsListener(
    listener: (configOptions: acp.SessionConfigOption[]) => void,
  ): void {
    this.configOptionsListener = listener;
  }

  /**
   * Register a listener invoked on every observed Agent activity (F13).
   */
  setActivityListener(listener: () => void): void {
    this.activityListener = listener;
  }

  private updateActivity(): void {
    this.lastActivityTimestamp = Date.now();
    this.activityListener?.();
  }

  /**
   * Write a permission decision to the audit log.
   * Fire-and-forget: audit failures never affect permission decisions.
   */
  private async writePermissionAudit(
    phase: "permission_approved" | "permission_denied",
    toolName: string,
    permissionKind: string,
    command: string | undefined,
    reason: string,
  ): Promise<void> {
    if (!this.auditWriter) return;
    const hashContent = this.auditWriter.getConfig().hashContent;
    const commandValue = hashContent && command ? `sha256:${await sha256Hash(command)}` : command;
    void this.auditWriter.write(phase, {
      toolName,
      permissionKind,
      command: commandValue,
      decision: phase === "permission_approved" ? "approved" : "denied",
      reason,
    });
    this.auditWriter.incrementPermissionDecisions();
  }

  /**
   * Record a permission denial for retry-prompt feedback (Design Decision 2).
   * Called on EVERY denial path in `requestPermission()` and `writeTextFile()`
   * so the retry prompt's rejection section never misses a real cause.
   *
   * All agent-derived string fields (`toolName`, `kind`, `commandOrPath`) are
   * sanitized at record time: control characters are stripped and each field is
   * bounded to MAX_PERMISSION_REJECTION_FIELD_LENGTH characters, so the retry
   * prompt's diagnostic section cannot be re-injected with agent/user-influenced
   * formatting or oversized content. `reason` is our own constant (never
   * sanitized). Synchronous and side-effect free beyond the buffer — never throws.
   */
  private recordPermissionRejection(
    toolName: string,
    kind: string,
    commandOrPath: string | undefined,
    reason: string,
  ): void {
    // toolName/kind are required fields (never undefined at call sites), so the
    // sanitizer's undefined case only applies to commandOrPath.
    this.recentPermissionRejections.push({
      toolName: sanitizeRejectionField(toolName) ?? "",
      kind: sanitizeRejectionField(kind) ?? "",
      commandOrPath: sanitizeRejectionField(commandOrPath),
      reason,
      ts: new Date().toISOString(),
    });
    if (this.recentPermissionRejections.length > MAX_PERMISSION_REJECTIONS) {
      this.recentPermissionRejections.shift();
    }
  }

  /**
   * Snapshot the session's recent permission rejections (for the retry prompt).
   * Returns a shallow copy so callers cannot mutate the buffer.
   */
  getRecentPermissionRejections(): PermissionRejection[] {
    return [...this.recentPermissionRejections];
  }

  /**
   * Clear the rejection buffer. Called once per logical session when a new ACP
   * session is created (`AgentConnector.createSession()`). MUST NOT be called from
   * `reset()` — `reset()` runs at the start of every prompt, including the retry,
   * and clearing there would wipe the records the retry prompt needs.
   */
  clearPermissionRejections(): void {
    this.recentPermissionRejections = [];
  }

  /**
   * Handle permission requests from the Agent
   * Auto-approves our registered skills and access to skills directory
   * In YOLO mode, auto-approves ALL permission requests
   */
  requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    this.updateActivity();
    this.logger.debug("Permission requested", {
      toolCall: params.toolCall,
      kind: params.toolCall.kind,
      yolo: this.config.yolo,
    });

    // Extract and log key permission details at INFO level for operational visibility
    const title = params.toolCall.title ?? "";
    const kind = params.toolCall.kind ?? "unknown";
    const rawInput = params.toolCall.rawInput as Record<string, unknown> | undefined;
    const locations = params.toolCall.locations ?? [];

    // Log external directory access requests
    if (title === "external_directory" || (kind === "other" && title.includes("directory"))) {
      const paths = locations.map((l) => l.path).filter(Boolean);
      this.logger.info(
        "Agent requested external directory access: {title}",
        {
          title,
          kind,
          paths: paths.length > 0 ? paths : undefined,
          rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
          toolCallId: params.toolCall.toolCallId,
        },
      );
    }

    // Log bash/shell command execution requests (non-skill commands)
    if (kind === "execute" || title === "bash" || title === "terminal") {
      const commands = (rawInput?.commands as string[]) ??
        (rawInput?.command ? [rawInput.command as string] : []);
      this.logger.info(
        "Agent requested command execution: {title}",
        {
          title,
          kind,
          commands,
          rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
          toolCallId: params.toolCall.toolCallId,
        },
      );
    }

    // YOLO mode: auto-approve everything
    if (this.config.yolo) {
      this.logger.info("YOLO mode: auto-approving permission for {title}", {
        kind: params.toolCall.kind,
        title: params.toolCall.title,
        rawInput: rawInput && Object.keys(rawInput).length > 0 ? rawInput : undefined,
        locations: locations.length > 0 ? locations.map((l) => l.path) : undefined,
      });

      void this.writePermissionAudit("permission_approved", title, kind, undefined, "yolo_mode");

      const allowOption = params.options.find((o) => o.kind === "allow_once") ??
        params.options[0];

      return Promise.resolve({
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      });
    }

    // Auto-approve read access to skills directories.
    // External agents need to read SKILL.md files to understand available skills.
    // OpenCode discovers skills from `~/.agents/skills` (external/installed skills) and the
    // repo-local `skills/` directory. We approve reads anchored to any of these roots using
    // boundary-safe matching so a sibling-prefix path cannot slip through.
    if (params.toolCall.kind === "read" && params.toolCall.locations) {
      const home = Deno.env.get("HOME") ?? "/home/deno";
      const skillsRoots = [
        join(home, ".agents", "skills"),
        join(Deno.cwd(), "skills"),
      ];
      const isReadingSkills = params.toolCall.locations.some((loc) =>
        loc.path !== undefined &&
        skillsRoots.some((root) => isWithinDir(loc.path!, root))
      );

      if (isReadingSkills) {
        this.logger.info("Auto-approving skills directory read: {path}", {
          path: params.toolCall.locations.map((l) => l.path).join(", "),
        });

        void this.writePermissionAudit(
          "permission_approved",
          title,
          kind,
          undefined,
          "skills_directory_access",
        );

        const allowOption = params.options.find((o) => o.kind === "allow_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        });
      }
    }

    // Auto-approve shell execution for our skill commands (whitelist-based)
    if (params.toolCall.kind === "execute") {
      const rawInput = params.toolCall.rawInput as
        | { command?: string; commands?: string[] }
        | undefined;
      const commands = rawInput?.commands ?? (rawInput?.command ? [rawInput.command] : []);

      // Defense-in-depth (D5): reject commands that smuggle free text in a legacy
      // `--message` / `--content` / `--query` / `--caption` flag (either `--flag value`
      // or `--flag=value`). Checked on the FULL original command(s) BEFORE any
      // multi-command splitting so a smuggled flag can never hide inside a chain. The
      // script-side check uses the same token pattern, so both layers agree.
      const hasLegacyFreeTextFlag = commands.some((cmd) =>
        cmd.trim().split(/\s+/).some((token) => LEGACY_FREE_TEXT_FLAG_PATTERN.test(token))
      );

      if (hasLegacyFreeTextFlag) {
        this.logger.warn(
          "Rejecting skill command with legacy free-text flag: {command}",
          { command: commands.join("; ") },
        );

        void this.writePermissionAudit(
          "permission_denied",
          title,
          kind,
          commands.join("; "),
          "rejected_skill_free_text_flag",
        );

        this.recordPermissionRejection(
          title,
          kind,
          commands.join("; "),
          "rejected_skill_free_text_flag",
        );

        const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: rejectOption.optionId,
          },
        });
      }

      // Generic-command workspace confinement (F12 D2) + segment-wise evaluation of
      // multi-command bash invocations (`;`/`&&`/`||` chains, F12 D2 chaining rule).
      // A chain is approved ONLY when EVERY segment independently passes the exact
      // gate it would face as its own tool call: the skill-whitelist matchers
      // (`matchesScriptPath` / `matchesCommandPrefix`) OR the generic gate
      // (`genericCommandRejectionReason`). This is capability-neutral — each segment
      // could already run as its own gated tool call — it only removes the forced
      // single-command round trips that cause coding models to batch and surrender.
      const allowedDirs = [this.config.workingDir];
      if (this.config.agentWorkspacePath) {
        allowedDirs.push(this.config.agentWorkspacePath);
      }
      // Session-local OpenCode tool-output boundary (F12): the agent subprocess is spawned
      // with a per-session `XDG_DATA_HOME` under the session TMPDIR, so truncated tool
      // outputs land under the session workspace. The resolved tool-output dir belongs to
      // the generic-command boundary only while it is session-local; it is appended
      // explicitly (deduped against existing allowed dirs) so the boundary stays
      // self-documenting, and any resolution outside the session workspace/TMPDIR (a
      // future change to the path helpers) fails closed — the shared home-rooted
      // tool-output dir is never within bounds. Cross-session reads inside the data area
      // are additionally rejected in `genericArgWithinWorkspace`.
      const sessionDataHome = sessionXdgDataHome(this.config.workingDir, this.config.sessionId);
      const toolOutputDir = opencodeToolOutputDir(sessionDataHome);
      const toolOutputCovered = allowedDirs.some((d) => isWithinDir(toolOutputDir, d));
      if (
        !toolOutputCovered &&
        (this.isWithinTmpDir(toolOutputDir) || isWithinDir(toolOutputDir, this.config.workingDir))
      ) {
        allowedDirs.push(toolOutputDir);
      }
      const home = Deno.env.get("HOME") ?? "/home/deno";
      const dataRoot = opencodeDataRoot(this.config.workingDir);
      // Runtime values for the harness-set variable expansions (F12 D5). These mirror
      // the subprocess environment agent-factory sets, so a `$TMPDIR`/`$AGENT_WORKSPACE`/
      // `$SESSION_ID` reference expands to the same path the shell will use.
      const runtimeEnv: KnownEnvRuntime = {
        tmpDir: resolve(this.config.workingDir, "tmp"),
        agentWorkspace: this.config.agentWorkspacePath ?? undefined,
        sessionId: this.config.sessionId ?? undefined,
      };

      // Flatten every command into its segments in order; evaluate each segment.
      const segments: string[] = [];
      for (const cmd of commands) {
        segments.push(...splitCommandSegments(cmd));
      }

      type SegmentDecision =
        | { approved: true; viaSkill: boolean }
        | { approved: false; reason: GenericCommandRejection };
      const decisions: SegmentDecision[] = segments.map((segment): SegmentDecision => {
        // A segment consisting ONLY of tolerated fd-redirect tokens is an operator
        // artifact, not a command — reject it, never skip it.
        const segmentTokens = segment.trim().split(/\s+/).filter((t) => t.length > 0);
        if (
          segmentTokens.length > 0 && segmentTokens.every((t) => FD_REDIRECT_TOKEN_PATTERN.test(t))
        ) {
          return { approved: false, reason: "shell_operator" };
        }
        // Skill-whitelist matchers (script paths then command prefixes).
        const isScript = Array.from(this.skillAutoApproveList.scriptPaths).some(
          (allowedPath) => matchesScriptPath(segment, allowedPath),
        );
        if (isScript) return { approved: true, viaSkill: true };
        const isCommand = Array.from(this.skillAutoApproveList.commandPrefixes).some(
          (prefix) => matchesCommandPrefix(segment, prefix),
        );
        if (isCommand) return { approved: true, viaSkill: true };
        // Generic-command gate.
        const reason = genericCommandRejectionReason(
          segment,
          this.config.workingDir,
          allowedDirs,
          home,
          sessionDataHome,
          dataRoot,
          runtimeEnv,
        );
        return reason === null ? { approved: true, viaSkill: false } : { approved: false, reason };
      });

      const firstRejectedIndex = decisions.findIndex((d) => !d.approved);

      if (segments.length > 0 && firstRejectedIndex === -1) {
        // Every segment of every command passed its gate.
        const allViaSkill = decisions.every((d) => d.approved && d.viaSkill);
        const auditReason = allViaSkill ? "skill_whitelist" : "generic_command_workspace_confined";
        this.logger.info(
          allViaSkill
            ? "Auto-approving skill shell execution: {command}"
            : "Auto-approving workspace-confined generic command: {command}",
          { command: commands.join("; ") },
        );

        void this.writePermissionAudit(
          "permission_approved",
          title,
          kind,
          commands.join("; "),
          auditReason,
        );

        const allowOption = params.options.find((o) => o.kind === "allow_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption.optionId,
          },
        });
      }

      // A filesystem-touching command that fails a segment's gate: report the ACTUAL
      // rejection cause of the FIRST failing segment (shell operator / first token not
      // allow-listed / dangerous flag / path outside allowed dirs / operator-artifact
      // redirect-only segment), replacing the previous hard-coded "path argument
      // outside session workspace/TMPDIR" message which misled diagnosis.
      if (segments.length > 0) {
        const failing = decisions[firstRejectedIndex];
        const reason = failing.approved ? "path_outside_boundary" : failing.reason;
        const failingSegment = segments[firstRejectedIndex];

        this.logger.warn(
          "Rejecting generic command: {reason} (command {index} of {total}: {command})",
          {
            reason,
            index: firstRejectedIndex,
            total: segments.length,
            command: failingSegment,
          },
        );

        // Single source of truth for the audit reason. The path case keeps the historical
        // `rejected_generic_command_out_of_workspace` code so existing monitoring queries
        // stay valid; the new causes get distinct codes. A string template like
        // `rejected_generic_command_{reason}` is NOT used because it would rename the
        // preserved path code.
        const auditReason = reason === "path_outside_boundary"
          ? "rejected_generic_command_out_of_workspace"
          : reason === "shell_operator"
          ? "rejected_generic_command_shell_operator"
          : reason === "first_token_not_allowed"
          ? "rejected_generic_command_first_token_not_allowed"
          : "rejected_generic_command_dangerous_flag";

        void this.writePermissionAudit(
          "permission_denied",
          title,
          kind,
          commands.join("; "),
          auditReason,
        );

        this.recordPermissionRejection(title, kind, failingSegment, auditReason);

        // Return reject immediately: falling through to default-deny would write a second,
        // contradictory `rejected_unknown` audit entry that misclassifies the cause.
        const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
          params.options[0];

        return Promise.resolve({
          outcome: {
            outcome: "selected",
            optionId: rejectOption.optionId,
          },
        });
      }
    }

    // Extract skill name from tool call (only works for ToolCall, not ToolCallUpdate)
    let skillName = "";
    // Check if this is a complete ToolCall (not just an update)
    if ("rawInput" in params.toolCall && params.toolCall.rawInput) {
      skillName = this.extractSkillName(params.toolCall as acp.ToolCall);
    }

    // Check if this is one of our registered skills
    if (skillName && this.skillRegistry.hasSkill(skillName)) {
      this.logger.info("Auto-approving registered skill: {skillName}", { skillName });

      void this.writePermissionAudit(
        "permission_approved",
        skillName,
        kind,
        undefined,
        "registered_skill",
      );

      // Find "allow_once" option, or default to first option
      const allowOption = params.options.find((o) => o.kind === "allow_once") ??
        params.options[0];

      return Promise.resolve({
        outcome: {
          outcome: "selected",
          optionId: allowOption.optionId,
        },
      });
    }

    // Scoped edit/write: allow if ALL paths are within agent workspace or TMPDIR.
    // Classify by the ACP tool `kind` (OpenCode v1.17.13+ sends `kind: "edit"` with
    // `title` = file path for its write/edit/apply_patch/patch tools) with a legacy
    // title fallback for older OpenCode versions and other ACP agents. The ACP SDK
    // ToolKind vocabulary has no `"write"` kind, so `kind === "write"` alone could
    // never match a real request (legacy `title: "write"` is still accepted below).
    if (isEditWriteRequest(title, kind)) {
      let paths = locations.map((l) => l.path).filter(Boolean) as string[];

      // When locations are empty, try extracting paths from rawInput
      if (paths.length === 0 && rawInput) {
        const extracted = this.extractPathsFromRawInput(rawInput);
        if (extracted.length > 0) {
          paths = extracted;
          this.logger.debug(
            "Extracted paths from rawInput for edit/write permission: {paths}",
            { paths },
          );
        }
      }

      const isAgentWorkspaceWrite = paths.length > 0 &&
        paths.every((p) => this.isAgentWorkspacePath(p!));

      if (isAgentWorkspaceWrite) {
        // Identify non-TMPDIR agent-workspace paths (i.e. shared workspace writes).
        const sharedWorkspacePaths = paths.filter((p) => !this.isWithinTmpDir(p!));

        // Write-gating (F3): shared agent-workspace writes require canWriteAgentWorkspace.
        // Only self-research sessions are authorized to author shared notes. TMPDIR writes
        // (per-session scratch) are exempt.
        if (sharedWorkspacePaths.length > 0 && this.config.canWriteAgentWorkspace !== true) {
          this.logger.warn(
            "Rejecting edit/write to shared agent workspace: session not authorized to write (canWriteAgentWorkspace not set)",
            { title, kind, paths: sharedWorkspacePaths },
          );

          void this.writePermissionAudit(
            "permission_denied",
            title,
            kind,
            undefined,
            "rejected_agent_workspace_write_unauthorized",
          );

          this.recordPermissionRejection(
            title,
            kind,
            sharedWorkspacePaths.join(", "),
            "rejected_agent_workspace_write_unauthorized",
          );

          const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
            params.options[0];
          return Promise.resolve({
            outcome: { outcome: "selected", optionId: rejectOption.optionId },
          });
        }

        // Check extension restrictions for non-TMPDIR agent workspace paths
        const disallowedPaths = paths.filter((p) => {
          return !this.isWithinTmpDir(p!) && !this.hasAllowedWriteExtension(p!);
        });

        if (disallowedPaths.length > 0) {
          this.logger.warn(
            "Rejecting edit/write due to disallowed file extension: {title}",
            {
              title,
              kind,
              paths: disallowedPaths,
              allowedExtensions: this.config.allowedWriteExtensions,
            },
          );

          void this.writePermissionAudit(
            "permission_denied",
            title,
            kind,
            undefined,
            "rejected_write_extension",
          );

          this.recordPermissionRejection(
            title,
            kind,
            disallowedPaths.join(", "),
            "rejected_write_extension",
          );

          // Return reject immediately: falling through would record a second,
          // contradictory `rejected_edit_write` entry (audit + rejection buffer).
          const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
            params.options[0];

          return Promise.resolve({
            outcome: {
              outcome: "selected",
              optionId: rejectOption.optionId,
            },
          });
        } else {
          this.logger.info(
            "Auto-approving edit/write to agent workspace: {title}",
            { title, kind, paths },
          );

          void this.writePermissionAudit(
            "permission_approved",
            title,
            kind,
            undefined,
            "agent_workspace_write",
          );

          const allowOption = params.options.find((o) => o.kind === "allow_once") ??
            params.options[0];

          return Promise.resolve({
            outcome: {
              outcome: "selected",
              optionId: allowOption.optionId,
            },
          });
        }
      }

      this.logger.warn("Rejecting edit/write tool in restricted mode: {title}", {
        title,
        kind,
        paths,
      });

      void this.writePermissionAudit(
        "permission_denied",
        title,
        kind,
        undefined,
        "rejected_edit_write",
      );

      this.recordPermissionRejection(title, kind, paths.join(", "), "rejected_edit_write");
    } else {
      // For unknown tool calls, reject
      this.logger.warn("Rejecting unknown tool call", {
        skillName,
        title: params.toolCall.title,
      });

      void this.writePermissionAudit(
        "permission_denied",
        title,
        kind,
        undefined,
        "rejected_unknown",
      );

      this.recordPermissionRejection(title, kind, undefined, "rejected_unknown");
    }

    const rejectOption = params.options.find((o) => o.kind === "reject_once") ??
      params.options[0];

    return Promise.resolve({
      outcome: {
        outcome: "selected",
        optionId: rejectOption.optionId,
      },
    });
  }

  /**
   * Handle session updates from the Agent
   * Logs various agent activities but doesn't send them externally
   */
  sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this.updateActivity();
    const update = params.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        this.flushThoughtBuffer();
        // Agent is generating response - log but don't send
        if (update.content.type === "text") {
          this.logger.debug("Agent message chunk: {text}", {
            text: update.content.text.substring(0, 100),
          });
          // Accumulate text chunks for complete message logging
          this.messageBuffer.push(update.content.text);
        }
        break;

      case "tool_call":
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        this.logger.info(
          "Tool call started: {title} (id: {id}, kind: {kind})",
          {
            id: update.toolCallId,
            title: update.title,
            kind: update.kind,
            status: update.status,
          },
        );
        break;

      case "tool_call_update": {
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        // Log tool call updates with full context
        const logContext: Record<string, unknown> = {
          id: update.toolCallId,
          status: update.status,
        };

        // Add error information if status is failed
        if (update.status === "failed") {
          // ACP SDK may include error details in various fields
          const updateAny = update as Record<string, unknown>;
          if (updateAny.output) {
            logContext.output = updateAny.output;
          }
          if (updateAny.error) {
            logContext.error = updateAny.error;
          }
          if (updateAny.exitCode !== undefined) {
            logContext.exitCode = updateAny.exitCode;
          }
          // Log full update object for debugging
          logContext.fullUpdate = JSON.stringify(update);
          this.logger.error("Tool call {id} failed", logContext);
        } else {
          this.logger.info("Tool call {id} updated to status {status}", logContext);
        }
        break;
      }

      case "plan":
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        this.logger.debug("Agent plan", {
          entriesCount: update.entries?.length ?? 0,
        });
        break;

      case "agent_thought_chunk":
        this.flushMessageBuffer();
        // Agent's thinking process - only log
        {
          const updateAny = update as Record<string, unknown>;
          const contentText = update.content?.type === "text" &&
              typeof update.content.text === "string"
            ? update.content.text
            : undefined;
          const directText = typeof updateAny.text === "string" ? updateAny.text : "";
          const thoughtText = contentText ?? directText;
          this.logger.debug("Agent thought: {text}", {
            text: thoughtText.substring(0, 100),
          });
          if (thoughtText.length > 0) {
            this.thoughtBuffer.push(thoughtText);
          }
        }
        break;

      case "usage_update": {
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        // Token usage information from the agent
        const usageUpdate = update as unknown as {
          sessionUpdate: "usage_update";
          used?: number;
          size?: number;
          cost?: { amount: number; currency: string };
        };
        this.logger.info("Agent usage update: tokens {used}/{size}", {
          used: usageUpdate.used,
          size: usageUpdate.size,
          cost: usageUpdate.cost,
        });
        break;
      }

      case "config_option_update": {
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        // Agent reports the complete updated config option state; propagate to the connector
        // so reasoning-effort discovery uses fresh options (e.g. after a model change).
        const configOptions = (update as unknown as {
          configOptions?: acp.SessionConfigOption[];
        }).configOptions;
        if (Array.isArray(configOptions)) {
          this.logger.debug("Config options updated ({count} options)", {
            count: configOptions.length,
          });
          this.configOptionsListener?.(configOptions);
        } else {
          // Defensive: notification shape lacked a parseable configOptions array.
          // Log so silent cache staleness is diagnosable instead of invisible.
          this.logger.warn(
            "config_option_update received without a parseable configOptions array",
          );
        }
        break;
      }

      default:
        this.flushThoughtBuffer();
        this.flushMessageBuffer();
        this.logger.debug("Session update", {
          type: (update as { sessionUpdate?: string }).sessionUpdate,
        });
    }

    return Promise.resolve();
  }

  /**
   * Handle file read requests from the Agent
   * Only allows reading files within the working directory
   */
  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    this.updateActivity();
    this.logger.debug("Read file requested", { path: params.path });

    // The path that passes validation IS the path that is read: canonicalize
    // `$TMPDIR`/`$SESSION_ID` tokens first, then validate and read the
    // expanded path (no literal `$TMPDIR` directory under the bot's cwd).
    const resolvedPath = this.resolveSessionPath(params.path);

    // Validate path is within working directory (boundary-safe)
    if (!this.isPathAllowed(resolvedPath)) {
      throw new acp.RequestError(
        -32600,
        "Access denied: path outside working directory",
      );
    }

    // Read-extension allowlist (F4): only workspace memory (`.jsonl`), markdown (`.md`),
    // and plain text (`.txt`) may be read. This blocks reads of arbitrary sensitive text
    // files (e.g. `.json` token/cache files) that could live inside an allowed directory.
    if (!hasAllowedExtension(resolvedPath, ALLOWED_READ_EXTENSIONS)) {
      this.logger.warn("Rejecting read due to disallowed file extension: {path}", {
        path: resolvedPath,
        allowedExtensions: ALLOWED_READ_EXTENSIONS,
      });
      throw new acp.RequestError(
        -32600,
        `Access denied: file extension not allowed for reads (permitted: ${
          ALLOWED_READ_EXTENSIONS.join(", ")
        })`,
      );
    }

    try {
      const content = await Deno.readTextFile(resolvedPath);
      return { content };
    } catch (error) {
      throw new acp.RequestError(
        -32600,
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Handle file write requests from the Agent
   * Only allows writing files within the working directory
   */
  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    this.updateActivity();
    this.logger.debug("Write file requested", { path: params.path });

    // The path that passes validation IS the path that is written: canonicalize
    // `$TMPDIR`/`$SESSION_ID` tokens first, then validate and write the
    // expanded path (no literal `$TMPDIR` directory under the bot's cwd).
    const resolvedPath = this.resolveSessionPath(params.path);

    // Validate path is within working directory
    if (!this.isPathAllowed(resolvedPath)) {
      this.recordPermissionRejection(
        "writeTextFile",
        "write",
        resolvedPath,
        "rejected_write_path_outside_workspace",
      );
      throw new acp.RequestError(
        -32600,
        "Access denied: path outside working directory",
      );
    }

    // Defense-in-depth: gate agent-workspace writes in restricted mode.
    // This is a SEPARATE sink from requestPermission() (an agent may call writeTextFile
    // directly), so the same F3 write-gating and F4 extension checks are enforced here too.
    if (!this.config.yolo) {
      const isSharedWorkspaceWrite = this.config.agentWorkspacePath
        ? isWithinDir(resolvedPath, this.config.agentWorkspacePath) &&
          !this.isWithinTmpDir(resolvedPath)
        : false;

      if (isSharedWorkspaceWrite) {
        // Write-gating (F3): shared agent-workspace writes require canWriteAgentWorkspace.
        if (this.config.canWriteAgentWorkspace !== true) {
          this.logger.warn(
            "Rejecting writeTextFile to shared agent workspace: session not authorized (canWriteAgentWorkspace not set)",
            { path: resolvedPath },
          );
          this.recordPermissionRejection(
            "writeTextFile",
            "write",
            resolvedPath,
            "rejected_agent_workspace_write_unauthorized",
          );
          throw new acp.RequestError(
            -32600,
            "Access denied: session not authorized to write to the shared agent workspace",
          );
        }

        if (!this.hasAllowedWriteExtension(resolvedPath)) {
          this.recordPermissionRejection(
            "writeTextFile",
            "write",
            resolvedPath,
            "rejected_write_extension",
          );
          throw new acp.RequestError(
            -32600,
            `Access denied: file extension not allowed for agent workspace writes (permitted: ${
              this.config.allowedWriteExtensions?.join(", ")
            })`,
          );
        }
      }
    }

    try {
      await Deno.writeTextFile(resolvedPath, params.content);
      return {};
    } catch (error) {
      throw new acp.RequestError(
        -32600,
        `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Extract skill name from tool call
   * Tries rawInput.skill field first, then falls back to title
   */
  private extractSkillName(toolCall: acp.ToolCall): string {
    const rawInput = toolCall.rawInput as { skill?: string } | undefined;
    return rawInput?.skill ?? toolCall.title ?? "";
  }

  /**
   * Create skill context for skill execution
   */
  private createSkillContext(): Partial<SkillContext> {
    return {
      channelId: this.config.channelId,
      userId: this.config.userId,
      // Note: workspace and platformAdapter should be added by caller
    };
  }

  /**
   * Expand the session-bound path tokens `$TMPDIR`/`${TMPDIR}`, `$SESSION_ID`/`${SESSION_ID}`,
   * and `$AGENT_WORKSPACE`/`${AGENT_WORKSPACE}` (as the agent types them into its
   * edit/write/read tools) to the resolved session TMPDIR (`{workingDir}/tmp`), the
   * session id, and the shared agent workspace path, then return the canonical path.
   * An absent session id expands to an empty string. Other `$VAR`-style tokens (e.g.
   * `$TMPDIR2`, `$OTHER`) are left verbatim and will fail containment, mirroring the
   * home-anchored expansion used for generic command arguments. The bot never executes
   * the expanded value — it only resolves and compares paths, so no injection is
   * possible (a path is data).
   */
  private resolveSessionPath(path: string): string {
    const tmpDir = resolve(this.config.workingDir, "tmp");
    const sessionId = this.config.sessionId ?? "";
    const agentWorkspace = this.config.agentWorkspacePath ?? "";
    let expanded = path;
    // ${...} exact forms first, then $NAME with a variable-name boundary so
    // `$TMPDIR2` / `$SESSION_ID2` / `$AGENT_WORKSPACE2` are NOT expanded.
    expanded = expanded.split("${TMPDIR}").join(tmpDir);
    expanded = expanded.split("${SESSION_ID}").join(sessionId);
    expanded = expanded.split("${AGENT_WORKSPACE}").join(agentWorkspace);
    expanded = expanded.replace(/\$TMPDIR(?![A-Za-z0-9_])/g, tmpDir);
    expanded = expanded.replace(/\$SESSION_ID(?![A-Za-z0-9_])/g, sessionId);
    expanded = expanded.replace(/\$AGENT_WORKSPACE(?![A-Za-z0-9_])/g, agentWorkspace);
    return resolve(expanded);
  }

  /**
   * Validate that a path is within the allowed directories
   * Allows: user workspace OR agent global workspace
   */
  private isPathAllowed(path: string): boolean {
    try {
      const expanded = this.resolveSessionPath(path);
      if (isWithinDir(expanded, this.config.workingDir)) return true;

      if (this.config.agentWorkspacePath && isWithinDir(expanded, this.config.agentWorkspacePath)) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a path is within the agent workspace or workspace TMPDIR.
   * Used to scope edit/write permissions for self-research.
   * Equivalent to agent-config/opencode.json: "edit": { "data/agent-workspace/**": "allow", "$TMPDIR/**": "allow" }
   */
  private isAgentWorkspacePath(path: string): boolean {
    try {
      const expanded = this.resolveSessionPath(path);
      // Check agent workspace path (boundary-safe)
      if (this.config.agentWorkspacePath && isWithinDir(expanded, this.config.agentWorkspacePath)) {
        return true;
      }

      // Check workspace TMPDIR
      if (this.isWithinTmpDir(expanded)) return true;

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if a path is within the workspace TMPDIR (boundary-safe).
   */
  private isWithinTmpDir(path: string): boolean {
    return isWithinDir(this.resolveSessionPath(path), resolve(this.config.workingDir, "tmp"));
  }

  /**
   * Try to extract file paths from rawInput when locations are empty.
   * Different ACP agents may include paths in various rawInput fields.
   */
  private extractPathsFromRawInput(rawInput: Record<string, unknown>): string[] {
    const paths: string[] = [];

    // Single path fields (common across agent types)
    for (const field of ["path", "file_path", "filePath", "filepath", "file", "filename"]) {
      const value = rawInput[field];
      if (typeof value === "string" && value.length > 0) {
        paths.push(value);
      }
    }

    // Array path fields
    for (const field of ["paths", "files"]) {
      const value = rawInput[field];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string" && item.length > 0) {
            paths.push(item);
          }
        }
      }
    }

    return paths;
  }

  /**
   * Check if a file path has an allowed write extension for agent workspace writes.
   * Returns true if no restrictions are configured or if the extension is in the allowed list.
   */
  private hasAllowedWriteExtension(filePath: string): boolean {
    const extensions = this.config.allowedWriteExtensions;
    if (!extensions || extensions.length === 0) return true;
    const dotIndex = filePath.lastIndexOf(".");
    if (dotIndex === -1 || dotIndex === filePath.length - 1) return false;
    const ext = filePath.substring(dotIndex).toLowerCase();
    return extensions.some((e) => ext === e.toLowerCase());
  }

  /**
   * Mark that a reply has been sent (for preventing duplicate replies)
   */
  markReplySent(): void {
    this.replyAlreadySent = true;
  }

  private flushAccumulatedBuffer(type: "message" | "thought"): void {
    const buffer = type === "message" ? this.messageBuffer : this.thoughtBuffer;
    if (buffer.length === 0) return;

    if (type === "message") {
      this.messageBuffer = [];
    } else {
      this.thoughtBuffer = [];
    }

    const completeText = buffer.join("");
    const chunkCount = buffer.length;
    const textLen = completeText.length;

    if (type === "message") {
      this.logger.info(
        "Agent complete message ({chunkCount} chunks, {length} chars): {message}",
        {
          message: completeText,
          chunkCount,
          length: textLen,
        },
      );
    } else {
      this.logger.info(
        "Agent complete thought ({chunkCount} chunks, {length} chars): {thought}",
        {
          thought: completeText,
          chunkCount,
          length: textLen,
        },
      );
    }

    if (this.auditWriter) {
      const writer = this.auditWriter;
      const hashContent = writer.getConfig().hashContent;
      const ts = new Date().toISOString();
      const phase = type === "message" ? "agent_complete_message" : "agent_complete_thought";

      if (hashContent) {
        sha256Hash(completeText)
          .then((hash) => {
            void writer.write(
              phase,
              type === "message"
                ? {
                  messageContentHash: `sha256:${hash}`,
                  messageLength: textLen,
                  chunkCount,
                }
                : {
                  thoughtContentHash: `sha256:${hash}`,
                  thoughtLength: textLen,
                  chunkCount,
                },
              ts,
            );
          })
          .catch((error) => {
            this.logger.warn("Failed to hash complete {type} for audit entry", {
              type,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      } else {
        void writer.write(
          phase,
          type === "message"
            ? {
              messageContentHash: completeText,
              messageLength: textLen,
              chunkCount,
            }
            : {
              thoughtContentHash: completeText,
              thoughtLength: textLen,
              chunkCount,
            },
          ts,
        );
      }
    }
  }

  /**
   * Flush the accumulated agent message chunks as a single complete message log entry.
   * Called when a non-chunk session update arrives or when the prompt completes.
   */
  flushMessageBuffer(): void {
    this.flushAccumulatedBuffer("message");
  }

  /**
   * Flush the accumulated agent thought chunks as a single complete thought log entry.
   * Called when a non-thought-chunk session update arrives or when the prompt completes.
   */
  flushThoughtBuffer(): void {
    this.flushAccumulatedBuffer("thought");
  }

  /**
   * Reset client state for new session
   */
  reset(): void {
    this.flushThoughtBuffer();
    this.flushMessageBuffer();
    this.replyAlreadySent = false;
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Get whether reply has been sent
   */
  hasReplySent(): boolean {
    return this.replyAlreadySent;
  }
}
