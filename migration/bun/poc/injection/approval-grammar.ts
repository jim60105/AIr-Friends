/**
 * Prototype of the exact approval grammar the Bun migration adopts (design
 * D3, source design section 4.4): a trusted script is accepted only by direct
 * execution of its canonical path or through the exact literal `bun run`
 * prefix, and every other form is denied.
 *
 * `decodeLiteralToken` and `lexicallyNormalize` are copied verbatim from
 * `src/acp/skill-inventory.ts`, which cannot be imported here (its aliased
 * imports do not resolve under Bun yet). The shell grammar itself is the
 * production one: `src/acp/command-syntax.ts` has no imports and no `Deno` use.
 */
import { realpathSync } from "node:fs";
import { sep as SEPARATOR } from "node:path";
import {
  commandWithoutFdRedirects,
  containsShellOperators,
  containsUnquotedShellExpansion,
  FD_REDIRECT_TOKEN_PATTERN,
  tokenizeShellCommand,
} from "../../../../src/acp/command-syntax.ts";
import { LITERAL_BUN_RUN } from "./attacker-dir.ts";

/** The literal prefix a `bun run` invocation must match token for token. */
const LITERAL_PREFIX: readonly string[] = LITERAL_BUN_RUN;

/**
 * Decode one tokenizer token into its literal shell value, fail-closed.
 *
 * Copied verbatim from `src/acp/skill-inventory.ts`.
 */
function decodeLiteralToken(token: string): string | undefined {
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

/**
 * Lexical (no-symlink-traversal) normalization, matching how Deno turns a
 * module argument into a URL. Copied verbatim from `src/acp/skill-inventory.ts`;
 * used only as the disagreement guard below.
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
 * Returns the canonical path of the granted script the segment approves, or
 * `undefined` when the segment is not exactly an accepted invocation.
 */
export function matchTrustedInvocation(
  segment: string,
  grants: ReadonlySet<string>,
  cwd: string,
): string | undefined {
  // 1. Shell syntax at all means the executed file is not established here.
  if (containsShellOperators(commandWithoutFdRedirects(segment))) return undefined;

  // 2. One literal token per argument; a tolerated fd redirect is not an argument.
  const tokens: string[] = [];
  for (const raw of tokenizeShellCommand(segment)) {
    if (raw.length === 0) continue;
    if (FD_REDIRECT_TOKEN_PATTERN.test(raw)) continue;
    const decoded = decodeLiteralToken(raw);
    if (decoded === undefined) return undefined;
    tokens.push(decoded);
  }
  if (tokens.length === 0) return undefined;

  // 3./4. Either the exact literal prefix followed by the spelling, or the
  // spelling directly. A slashless direct token goes through PATH, never the
  // working directory, and `bun run <name>` looks up a package script first,
  // so both forms require a slash in the spelling.
  let spelling: string;
  if (tokens[0] === LITERAL_PREFIX[0]) {
    if (tokens.length < LITERAL_PREFIX.length + 1) return undefined;
    for (let i = 0; i < LITERAL_PREFIX.length; i++) {
      if (tokens[i] !== LITERAL_PREFIX[i]) return undefined;
    }
    const script = tokens[LITERAL_PREFIX.length];
    if (script.startsWith("-")) return undefined;
    if (!script.includes("/")) return undefined;
    spelling = script;
  } else {
    spelling = tokens[0];
    if (!spelling.includes("/")) return undefined;
  }

  // 5. Canonical membership among the enumerated grants, with the
  // ambiguous-`..`-after-a-symlink guard.
  if (spelling.includes("\0")) return undefined;
  const candidate = spelling.startsWith(SEPARATOR) ? spelling : `${cwd}${SEPARATOR}${spelling}`;
  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch {
    return undefined;
  }
  if (spelling.split(SEPARATOR).includes("..") && lexicallyNormalize(candidate) !== canonical) {
    return undefined;
  }
  return grants.has(canonical) ? canonical : undefined;
}
