// src/utils/omp-version.ts
//
// Bootstrap compatibility check for the external OMP agent (package-pinned-omp-
// runtime, design D6). Mirrors opencode-version.ts exactly: the Containerfile
// pin (OMP_VERSION=18.6.1) is the prevention, this check is deliberately an
// OBSERVABILITY measure — WARN-only on non-OK, never blocks startup, never
// throws, no download/upgrade side effect. The ACP contract shape the adapter
// consumes is pinned to v18.6.1; the constant equals the pin so any environment
// drift surfaces. Scoped divergence from OpenCode's check: bootstrap calls
// verifyOmpVersion() only when the resolved agent type is `omp`, because `omp`
// is absent-by-design on OpenCode-only installs and a permanent UNKNOWN warning
// there would train operators to ignore the marker.

import { createLogger } from "@utils/logger.ts";

/**
 * Known-good OMP version. The image-intended version is exact (the packaging
 * pin), so anything >= this version is compatible; below it the ACP contract
 * shape the adapter consumes may differ. Overridable via
 * `AGENT_OMP_MIN_VERSION`.
 */
export const KNOWN_GOOD_OMP_MIN_VERSION = "18.6.1";

/**
 * Timeout for the `omp --version` subprocess; a broken install must not
 * hang bootstrap.
 */
export const OMP_VERSION_CHECK_TIMEOUT_MS = 5000;

const logger = createLogger("OmpVersionCheck");

/**
 * The most recent `omp --version` observation for this process, recorded by
 * {@link verifyOmpVersion}. `undefined` means no probe has run; `null` means the probe was
 * undeterminable (no binary, spawn failure, timeout). The native-runtime cache preflight
 * consumes this WITHOUT inheriting the compatibility verdict: a determinable value must
 * equal the pinned cache version exactly, while `undefined`/`null` simply means the
 * preflight falls through to its own payload identity check rather than failing fatally.
 *
 * This keeps the "one probe per lifetime" property: bootstrap observes the binary once and
 * every later cache preflight reuses that observation instead of spawning again.
 */
let memoizedProbe: string | null | undefined = undefined;

/** The recorded `omp --version` observation, or `undefined` when no probe has run yet. */
export function getMemoizedOmpVersionProbe(): string | null | undefined {
  return memoizedProbe;
}

/**
 * Result of the bootstrap version check.
 * - "ok": detected version >= minimum
 * - "below_minimum": detected version parses and is below the minimum
 * - "unknown": could not detect (missing binary, timeout, unparseable output)
 */
export type OmpVersionCheckResult = "ok" | "below_minimum" | "unknown";

/**
 * Effective minimum version: `AGENT_OMP_MIN_VERSION` env override wins when
 * set and non-empty, otherwise the known-good default.
 */
export function getMinimumOmpVersion(): string {
  const override = Deno.env.get("AGENT_OMP_MIN_VERSION");
  return override && override.trim().length > 0 ? override.trim() : KNOWN_GOOD_OMP_MIN_VERSION;
}

/**
 * Parse a semver triple (`major.minor.patch`) from an arbitrary string
 * (e.g. "omp v18.6.1" or "18.6.1"). Returns null when no triple exists.
 */
export function parseOmpSemver(
  text: string,
): { major: number; minor: number; patch: number } | null {
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
export function isOmpAtLeastVersion(detected: string, minimum: string): boolean {
  const d = parseOmpSemver(detected);
  const m = parseOmpSemver(minimum);
  if (!d || !m) return false;
  if (d.major !== m.major) return d.major > m.major;
  if (d.minor !== m.minor) return d.minor > m.minor;
  return d.patch >= m.patch;
}

/**
 * Detect the installed OMP CLI version by spawning `omp --version`.
 * Returns the detected version string, or null when the subprocess fails, times
 * out, or prints nothing parseable. Never starts an ACP session and performs no
 * network I/O — only the version flag is invoked.
 *
 * The output is raced against the timeout so a process that ignores SIGTERM
 * cannot hang bootstrap: on timeout the child is SIGKILLed and null is returned
 * without waiting for its output.
 */
export async function detectOmpVersion(
  timeoutMs: number = OMP_VERSION_CHECK_TIMEOUT_MS,
  /** Binary name to spawn; injectable for tests so a missing-binary scenario can be
   * simulated without mutating the global PATH (which would race parallel tests). */
  commandName: string = "omp",
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
      if (!version || !parseOmpSemver(version)) return null;
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
 * Gating predicate for the bootstrap call site: the OMP version check runs
 * ONLY when the resolved default agent type is `omp`. `omp` is absent-by-
 * design on OpenCode-only installs, and a permanent UNKNOWN warning there
 * would train operators to ignore the marker. Bootstrap consumes this verbatim
 * (`if (shouldVerifyOmpVersion(getDefaultAgentType(config))) …`).
 */
export function shouldVerifyOmpVersion(agentType: string): boolean {
  return agentType === "omp";
}

/**
 * Verify the installed OMP CLI version against the pinned known-good version and
 * log the outcome. Never blocks startup and never throws — failures degrade to
 * a structured `UNKNOWN` warning.
 *
 * Log markers (greppable): `OMP version check: OK|BELOW_MINIMUM|UNKNOWN`.
 */
export async function verifyOmpVersion(
  options?: {
    minVersion?: string;
    timeoutMs?: number;
    /** Injectable detector for tests; defaults to spawning `omp --version`. */
    detect?: () => Promise<string | null>;
    /** Injectable logger for tests; defaults to the module logger. */
    log?: typeof logger;
  },
): Promise<OmpVersionCheckResult> {
  const log = options?.log ?? logger;
  const minimum = options?.minVersion ?? getMinimumOmpVersion();
  let detected: string | null;
  try {
    detected = await (options?.detect ??
      (() => detectOmpVersion(options?.timeoutMs)))();
  } catch {
    // Spawn failures (command not found, permission errors) degrade to UNKNOWN.
    detected = null;
  }
  memoizedProbe = detected;

  if (detected === null) {
    log.warn(
      "OMP version check: UNKNOWN — could not verify the installed omp version; " +
        "expected at least {minVersion}. An unverified binary may behave differently from " +
        "the ACP contract shape the trusted extension and adapters consume; pin the " +
        "container OMP (Containerfile OMP_VERSION) to the known-good release.",
      { minVersion: minimum },
    );
    return "unknown";
  }

  if (isOmpAtLeastVersion(detected, minimum)) {
    log.info("OMP version check: OK — detected version {version}", {
      version: detected,
      minVersion: minimum,
    });
    return "ok";
  }

  log.warn(
    "OMP version check: BELOW_MINIMUM — detected {version}, expected at least {minVersion}. " +
      "Versions below the pin may present a different ACP contract shape than the trusted " +
      "extension and adapters were authored against; pin the container OMP " +
      "(Containerfile OMP_VERSION) to the known-good release to avoid silent contract drift.",
    { version: detected, minVersion: minimum },
  );
  return "below_minimum";
}
