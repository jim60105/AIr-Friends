// src/utils/opencode-version.ts
//
// Bootstrap compatibility check for the external ACP agent (OpenCode). The ACP
// permission request shape changed in OpenCode v1.17.13 (PR #34079): edit/write
// requests now carry `kind: "edit"` with `title` = file path instead of the legacy
// permission-name titles. The permission gate accepts both shapes, so this check is
// deliberately an OBSERVABILITY measure, not a hard gate: the container version pin
// is the actual prevention, and this warning surfaces drift early (Design Decision 5).

import { createLogger } from "@utils/logger.ts";

/**
 * Known-good minimum OpenCode version. The permission gate handles both request
 * shapes, so anything >= this version (the first release with the enriched
 * permission prompt) is compatible. Overridable via `AGENT_OPENCODE_MIN_VERSION`.
 */
export const KNOWN_GOOD_OPENCODE_MIN_VERSION = "1.17.13";

/**
 * Timeout for the `opencode --version` subprocess; a broken install must not
 * hang bootstrap.
 */
export const OPENCODE_VERSION_CHECK_TIMEOUT_MS = 5000;

const logger = createLogger("OpenCodeVersionCheck");

/**
 * Result of the bootstrap version check.
 * - `"ok"`: detected version >= minimum (INFO log)
 * - `"below_minimum"`: detected version < minimum (structured WARN)
 * - `"unknown"`: version undeterminable (structured WARN)
 */
export type OpenCodeVersionCheckResult = "ok" | "below_minimum" | "unknown";

/**
 * Effective minimum version: `AGENT_OPENCODE_MIN_VERSION` env override wins when
 * set and non-empty, otherwise the known-good default.
 */
export function getMinimumOpenCodeVersion(): string {
  const override = Deno.env.get("AGENT_OPENCODE_MIN_VERSION");
  return override && override.trim().length > 0 ? override.trim() : KNOWN_GOOD_OPENCODE_MIN_VERSION;
}

/**
 * Parse a semver triple (`major.minor.patch`) from an arbitrary string
 * (e.g. "opencode v1.17.13" or "1.17.13"). Returns null when no triple exists.
 */
export function parseSemver(text: string): { major: number; minor: number; patch: number } | null {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Compare two semver strings. Returns true when `detected >= minimum`.
 * Unparseable versions return false (fail toward the warning path).
 */
export function isAtLeastVersion(detected: string, minimum: string): boolean {
  const d = parseSemver(detected);
  const m = parseSemver(minimum);
  if (!d || !m) return false;
  if (d.major !== m.major) return d.major > m.major;
  if (d.minor !== m.minor) return d.minor > m.minor;
  return d.patch >= m.patch;
}

/**
 * Detect the installed OpenCode CLI version by spawning `opencode --version`.
 * Returns the detected version string, or null when the subprocess fails, times
 * out, or prints nothing parseable. Never starts an ACP session and performs no
 * network I/O — only the version flag is invoked.
 *
 * The output is raced against the timeout so a process that ignores SIGTERM
 * cannot hang bootstrap: on timeout the child is SIGKILLed and null is returned
 * without waiting for its output.
 */
export async function detectOpenCodeVersion(
  timeoutMs: number = OPENCODE_VERSION_CHECK_TIMEOUT_MS,
  /** Binary name to spawn; injectable for tests so a missing-binary scenario can be
   * simulated without mutating the global PATH (which would race parallel tests). */
  commandName: string = "opencode",
): Promise<string | null> {
  let command: Deno.Command;
  let process: Deno.ChildProcess;
  try {
    command = new Deno.Command(commandName, {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    });
    process = command.spawn();
  } catch {
    // Command not found or spawn failed
    return null;
  }

  const output = process.output();

  // Race the subprocess output against the timeout so a SIGTERM-ignoring child
  // (or its wrapper) can never block startup. On timeout: SIGKILL as a
  // best-effort cleanup and resolve as "undetermined" immediately.
  const result = await Promise.race([
    output.then(({ code, stdout, stderr }) => {
      if (code !== 0) return null;
      const text = new TextDecoder().decode(stdout) || new TextDecoder().decode(stderr);
      const version = text.trim();
      if (!version || !parseSemver(version)) return null;
      return version;
    }),
    new Promise<string | null>((resolve) => {
      setTimeout(() => {
        try {
          process.kill("SIGKILL");
        } catch {
          // Process already exited — ignore
        }
        resolve(null);
      }, timeoutMs);
    }),
  ]);

  try {
    // Wait for the child to be reaped (best-effort; never blocks).
    await output.catch(() => {});
  } catch {
    // Ignore reaping errors
  }

  return result;
}

/**
 * Verify the installed OpenCode CLI version against the known-good minimum and log
 * the outcome. Never blocks startup and never throws — failures degrade to a
 * structured `UNKNOWN` warning.
 *
 * Log markers (greppable): `OpenCode version check: OK|BELOW_MINIMUM|UNKNOWN`.
 */
export async function verifyOpenCodeVersion(
  options?: {
    minVersion?: string;
    timeoutMs?: number;
    /** Injectable detector for tests; defaults to spawning `opencode --version`. */
    detect?: () => Promise<string | null>;
    /** Injectable logger for tests; defaults to the module logger. */
    log?: typeof logger;
  },
): Promise<OpenCodeVersionCheckResult> {
  const log = options?.log ?? logger;
  const minimum = options?.minVersion ?? getMinimumOpenCodeVersion();
  let detected: string | null;
  try {
    detected = await (options?.detect ??
      (() => detectOpenCodeVersion(options?.timeoutMs)))();
  } catch {
    // Spawn failures (command not found, permission errors) degrade to UNKNOWN.
    detected = null;
  }

  if (detected === null) {
    log.warn(
      "OpenCode version check: UNKNOWN — could not verify the installed opencode version; " +
        "expected at least {minVersion}. A below-minimum version sends the legacy ACP permission " +
        "request shape and may behave differently; the permission gate accepts both shapes.",
      { minVersion: minimum },
    );
    return "unknown";
  }

  if (isAtLeastVersion(detected, minimum)) {
    log.info("OpenCode version check: OK — detected version {version}", {
      version: detected,
      minVersion: minimum,
    });
    return "ok";
  }

  log.warn(
    "OpenCode version check: BELOW_MINIMUM — detected {version}, expected at least {minVersion}. " +
      "Versions below the minimum send the legacy ACP permission request shape; the permission " +
      "gate accepts both shapes, but pin the container OpenCode (Containerfile OPENCODE_VERSION) " +
      "to a known-good release to avoid silent contract drift.",
    { version: detected, minVersion: minimum },
  );
  return "below_minimum";
}
