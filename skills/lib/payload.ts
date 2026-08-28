// Shared payload-file helpers for skill scripts.
//
// Free-text content (reply text, memory content, search queries, captions) MUST
// never appear on a shell command line: bash expands `$VAR` in double-quoted
// arguments before the script runs, corrupting content and leaking subprocess
// environment variables into external channels. Instead, the agent stages the
// text in a payload file under the session-scoped TMPDIR via the ACP filesystem
// interface (edit/write tool), and the script reads it back verbatim.

import { isAbsolute, resolve, SEPARATOR } from "jsr:@std/path@^1.0.0";
import { SKILL_SESSION_UNRESOLVED, unresolvedSessionPointerMessage } from "./client.ts";

/**
 * Error raised by the payload helpers on a contract failure.
 * Carries a stable machine-readable `code` plus a human (LLM-audience) guidance
 * message that states what went wrong, why it matters, and the correct pattern
 * with a copy-pasteable example invocation.
 */
export class PayloadError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PayloadError";
    this.code = code;
  }
}

/**
 * Legacy free-text CLI argument flags. Any token matching this pattern is
 * rejected: exact `--message` / `--content` / `--query` / `--caption` (with a
 * following whitespace-separated value) or the attached `--flag=value` form.
 * Distinct tokens such as `--message-id`, `--message-file`, `--content-file`,
 * `--query-file`, `--caption-file` do not match and are unaffected.
 */
export const LEGACY_FREE_TEXT_FLAG_PATTERN = /^--(?:message|content|query|caption)(?:=|$)/;

/**
 * Boundary-safe containment check: true when `path` equals `base` or starts with
 * `base` followed by a path separator. Rejects sibling-prefix escapes such as
 * `{base}-2` and `{base}2`.
 */
export function isWithinDir(path: string, base: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedBase = resolve(base);
  if (resolvedPath === resolvedBase) return true;
  return resolvedPath.startsWith(resolvedBase + SEPARATOR);
}

/**
 * Resolve the session staging base directory.
 *
 * The staging area is the session's own workspace tmp dir (`{workspace}/tmp/
 * {sessionId}`), which is what the prompt renders as `{{ tmpDir }}` and what
 * the ACP path boundary expands `$TMPDIR` to for the agent's edit/write tools.
 * Resolution order:
 *  1. Shared-process mode (`SKILL_SHARED_PROCESS=1`): the current-session
 *    pointer (`{SKILL_JWT_DIR}/active.json`) is the ONLY source — it carries
 *    the owning session's staging root written by the process pool at lease
 *    acquisition, plus the CURRENT session id (the process `$SESSION_ID` and
 *    hence the CLI `--session-id` may be a stale spawn-time value there). A
 *    missing, unreadable, or malformed pointer throws `SKILL_SESSION_UNRESOLVED`
 *    BEFORE any payload file is read or deleted — there is NO CLI-argument
 *    fallback, because a backgrounded/late-running pooled script could name a
 *    sibling session's id (same workspace) and read plus delete that session's
 *    staged content; the later JWT check gates the API call, not the file I/O.
 *  2. Per-spawn mode / pointer unavailable: `{cwd}/tmp/{sessionId}`, where the
 *    script's cwd is the session workspace and `sessionId` is the CLI arg
 *    (`$SESSION_ID` is authoritative there). The pointer is honored only when
 *    it names this exact session, so a stale pointer left by a crashed pool
 *    run cannot hijack the staging boundary.
 *
 * The process-level `TMPDIR` is deliberately NOT consulted: in shared-process
 * mode it is channel-scoped (`{dataRoot}/channel-tmp/{poolKey}`) and is never a
 * staging area (cross-user payloads must stay inside the owner's workspace).
 */
/**
 * Strict pointer schema: `sessionId` and `staging` must be non-empty strings
 * (numbers/objects/null are malformed), and in shared-process mode `staging`
 * must be an absolute path — the pool writes absolute staging roots, so a
 * relative value means the pointer is corrupt and must fail loud instead of
 * resolving against some script cwd.
 */
function isPointerShape(
  parsed: unknown,
  requireAbsoluteStaging: boolean,
): parsed is { sessionId: string; staging: string } {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  if (typeof o.sessionId !== "string" || o.sessionId.length === 0) return false;
  if (typeof o.staging !== "string" || o.staging.length === 0) return false;
  return !requireAbsoluteStaging || isAbsolute(o.staging);
}

export function resolvePayloadBase(cwd: string, sessionId: string): string {
  const jwtDir = Deno.env.get("SKILL_JWT_DIR");
  const shared = Deno.env.get("SKILL_SHARED_PROCESS") === "1";
  if (jwtDir) {
    let parsed: unknown;
    try {
      const raw = Deno.readTextFileSync(`${jwtDir}/active.json`);
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (isPointerShape(parsed, shared) && (shared || parsed.sessionId === sessionId)) {
      return resolve(parsed.staging, parsed.sessionId);
    }
    if (shared) {
      // Shared mode demands a VALID pointer (readable, non-empty string fields,
      // absolute staging): anything else is a hard failure before any payload
      // file is touched.
      throw new PayloadError(SKILL_SESSION_UNRESOLVED, unresolvedSessionPointerMessage(jwtDir));
    }
  } else if (shared) {
    throw new PayloadError(
      SKILL_SESSION_UNRESOLVED,
      unresolvedSessionPointerMessage(jwtDir),
    );
  }
  return sessionId ? resolve(cwd, "tmp", sessionId) : resolve(cwd, "tmp");
}

/**
 * Resolve a payload path against the script's working directory (the session
 * workspace) and require it to be inside the session staging directory.
 *
 * - The resolved path must be inside the session staging base (boundary-safe,
 *   so `{base}-2`/`{base}2` siblings are rejected).
 * - When the file exists, its REAL path (`Deno.realPath`) is re-checked for
 *   containment so a symlink escaping the staging directory (e.g. pointing at
 *   `/etc/passwd` or into another session's directory) is rejected.
 *
 * Throws {@link PayloadError} with `SKILL_PAYLOAD_OUT_OF_BOUNDS` or
 * `SKILL_PAYLOAD_NOT_FOUND`; otherwise returns the resolved real path.
 */
export function resolvePayloadPath(
  payloadPath: string,
  cwd: string,
  sessionId: string,
  options: { flagName: string; example: string; fileName: string },
): string {
  const base = resolvePayloadBase(cwd, sessionId);
  const resolved = resolve(cwd, payloadPath);

  if (!isWithinDir(resolved, base)) {
    throw new PayloadError(
      "SKILL_PAYLOAD_OUT_OF_BOUNDS",
      outOfBoundsMessage(payloadPath, base, options),
    );
  }

  let realPath: string;
  try {
    realPath = Deno.realPathSync(resolved);
  } catch {
    throw new PayloadError("SKILL_PAYLOAD_NOT_FOUND", notFoundMessage(payloadPath, options));
  }

  if (!isWithinDir(realPath, base)) {
    throw new PayloadError(
      "SKILL_PAYLOAD_OUT_OF_BOUNDS",
      outOfBoundsMessage(payloadPath, base, options),
    );
  }

  return realPath;
}

/**
 * Read the value of a payload-file argument from raw CLI arguments.
 *
 * - Any token matching {@link LEGACY_FREE_TEXT_FLAG_PATTERN} raises
 *   `SKILL_LEGACY_FLAG` (both `--flag value` and `--flag=value` forms).
 * - The payload value comes from `--<flagName>-file` (or `--<flagName>-file=…`
 *   or the configured short alias).
 * - The value is resolved via {@link resolvePayloadPath}, read verbatim as
 *   UTF-8, and the payload file is best-effort deleted after the successful
 *   read.
 * - A REQUIRED payload with no flag raises `SKILL_MISSING_PAYLOAD`; an
 *   OPTIONAL payload that is omitted returns `undefined`.
 *
 * Returns the file content (which may be an empty string).
 */
export async function readPayloadArg(
  args: string[],
  flagName: string,
  options: {
    sessionId: string;
    example: string;
    fileName: string;
    alias?: string;
    required?: boolean;
    cwd?: string;
  },
): Promise<string | undefined> {
  const fileFlag = `--${flagName}-file`;
  const required = options.required ?? true;
  const cwd = options.cwd ?? Deno.cwd();

  let value: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (LEGACY_FREE_TEXT_FLAG_PATTERN.test(token)) {
      throw new PayloadError("SKILL_LEGACY_FLAG", legacyFlagMessage(flagName, options));
    }
    if (token === fileFlag) {
      value = args[i + 1];
    } else if (token.startsWith(`${fileFlag}=`)) {
      value = token.substring(fileFlag.length + 1);
    } else if (options.alias && token === `-${options.alias}`) {
      value = args[i + 1];
    } else if (options.alias && token.startsWith(`-${options.alias}=`)) {
      value = token.substring(options.alias.length + 2);
    }
  }

  if (value === undefined) {
    if (!required) return undefined;
    throw new PayloadError("SKILL_MISSING_PAYLOAD", missingPayloadMessage(flagName, options));
  }

  const path = resolvePayloadPath(value, cwd, options.sessionId, {
    flagName,
    example: options.example,
    fileName: options.fileName,
  });

  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch {
    throw new PayloadError(
      "SKILL_PAYLOAD_NOT_FOUND",
      notFoundMessage(value, {
        flagName,
        example: options.example,
        fileName: options.fileName,
      }),
    );
  }

  // Best-effort: the payload is consumed; remove it so it cannot be re-sent or
  // confuse a later session. Failures are ignored (read-only filesystem, etc.).
  try {
    await Deno.remove(path);
  } catch {
    // Ignore deletion failures.
  }

  return content;
}

function twoStepGuidance(flagName: string, options: { fileName: string; example: string }): string {
  return (
    `1. Write the text to the session staging directory shown in your system prompt ` +
    `(\`$TMPDIR/$SESSION_ID/${options.fileName}\` in per-session mode) using your edit/write tool. ` +
    `2. Invoke the script with --${flagName}-file pointing at that file. ` +
    `Example: ${options.example}`
  );
}

function legacyFlagMessage(
  flagName: string,
  options: { fileName: string; example: string },
): string {
  return (
    `The --${flagName} argument is no longer supported: free-text content passed on the command line ` +
    `is expanded by the shell before the script runs, so a $ in your text (e.g. $0, $HOME, $API_KEY) ` +
    `is either corrupted or leaks subprocess environment variables into the message. You must NOT put ` +
    `message content on the command line. Instead, ${twoStepGuidance(flagName, options)}`
  );
}

function missingPayloadMessage(
  flagName: string,
  options: { fileName: string; example: string },
): string {
  return (
    `Missing required argument: --${flagName}-file. The ${flagName} content must be passed via a ` +
    `payload file, never on the command line. ${twoStepGuidance(flagName, options)}`
  );
}

function outOfBoundsMessage(
  value: string,
  base: string,
  options: { flagName: string; fileName: string; example: string },
): string {
  return (
    `The payload file "${value}" is outside the session staging directory ` +
    `"${base}" (\`$TMPDIR/$SESSION_ID\` in per-session mode; in shared-process mode the staging ` +
    `directory shown in your system prompt). The script only reads payload files from its own ` +
    `session's staging directory — this prevents sending the content of arbitrary files (workspace ` +
    `memory, notes, ~/.git-credentials, another session's directory, or a symlink escaping the ` +
    `staging directory). ${twoStepGuidance(options.flagName, options)}`
  );
}

function notFoundMessage(
  value: string,
  options: { flagName: string; fileName: string; example: string },
): string {
  return (
    `The payload file "${value}" does not exist or cannot be read. The script reads content from a ` +
    `file staged in $TMPDIR/$SESSION_ID/, so the file must be written FIRST with your edit/write ` +
    `tool before invoking the script. ${twoStepGuidance(options.flagName, options)}`
  );
}
