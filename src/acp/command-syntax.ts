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
  // Normalize an attached `--flag=value` prefix (mirrors command argument normalization):
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
export function expandKnownEnvReferences(
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
