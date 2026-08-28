#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
// This file is used by all skill scripts to interact with the Skill API

import { parse } from "jsr:@std/flags@^0.224.0";

/**
 * Skill API client configuration
 */
export interface SkillClientConfig {
  apiUrl: string;
  timeout: number;
}

/**
 * Default configuration
 * API URL can be overridden by --api-url flag or SKILL_API_URL env
 * Only localhost/127.0.0.1 URLs are allowed for security
 */
export function getDefaultConfig(): SkillClientConfig {
  const apiUrl = Deno.env.get("SKILL_API_URL") ?? "http://localhost:3001";

  // Validate that URL is localhost
  try {
    const url = new URL(apiUrl);
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    if (!isLocalhost) {
      throw new Error(
        `Invalid API URL: ${apiUrl}. Only localhost URLs are allowed for security.`,
      );
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid API URL format: ${apiUrl}`);
    }
    throw error;
  }

  return {
    apiUrl,
    timeout: 30_000,
  };
}

/**
 * Parse common CLI arguments
 */
export function parseBaseArgs(args: string[]): { sessionId: string; apiUrl: string } {
  const parsed = parse(args, {
    string: ["session-id", "api-url"],
    alias: { s: "session-id", a: "api-url" },
  });

  const sessionId = parsed["session-id"];
  if (!sessionId) {
    throw new Error("Missing required argument: --session-id");
  }

  const config = getDefaultConfig();
  const apiUrl = parsed["api-url"] ?? config.apiUrl;

  return { sessionId, apiUrl };
}

/**
 * True when the calling agent process runs in shared-process mode (pool-managed
 * long-lived process). The process pool's factory sets this marker alongside
 * `SKILL_JWT_DIR`; per-spawn deployments never carry it.
 */
function isSharedProcessMode(): boolean {
  return Deno.env.get("SKILL_SHARED_PROCESS") === "1";
}

/**
 * Snapshot cache of the owning session id + JWT, taken ONCE per script
 * invocation (spec: a later session's pointer/JWT must not affect an
 * in-flight backgrounded script).
 */
let owningSessionSnapshot: { jwtDir: string; sessionId: string; jwt?: string } | undefined;

/**
 * Stable machine-readable code for an unresolvable owning-session identity.
 * Raised in shared-process mode when the current-session pointer is missing,
 * unreadable, or malformed (and reused by the payload staging resolver so both
 * fail with the same code — one shared constant).
 */
export const SKILL_SESSION_UNRESOLVED = "SKILL_SESSION_UNRESOLVED";

/**
 * Instructive shared-mode failure text naming the expected absolute pointer
 * path and the "live turn" remedy. Shared by `resolveOwningSessionId()`
 * (SkillSessionUnresolvedError, prefix embedded) and `resolvePayloadBase()`
 * (PayloadError carrying the same code) so both fail with a consistent,
 * teachable message.
 */
export function unresolvedSessionPointerMessage(jwtDir: string | undefined): string {
  const pointerPath = jwtDir ? `${jwtDir}/active.json` : "the SKILL_JWT_DIR pointer location";
  return (
    `${SKILL_SESSION_UNRESOLVED}: no current-session pointer at ${pointerPath} — the session's ` +
    `execution lease may have ended, or this script ran outside an active agent turn. Skills ` +
    `must be invoked during a live turn; the owning session is resolved automatically — do not ` +
    `set SESSION_ID manually.`
  );
}

/**
 * Typed error for an unresolvable owning-session identity, carrying the stable
 * `SKILL_SESSION_UNRESOLVED` code in a machine-readable `code` field so scripts
 * surface it via `exitWithError(message, code)` uniformly with PayloadError.
 */
export class SkillSessionUnresolvedError extends Error {
  readonly code = SKILL_SESSION_UNRESOLVED;

  constructor(jwtDir: string | undefined) {
    super(unresolvedSessionPointerMessage(jwtDir));
    this.name = "SkillSessionUnresolvedError";
  }
}

/**
 * Resolve the owning shell session ID:
 * - Shared-process mode: read the `active.json` pointer (written by the pool
 *   while the session holds the execution lease). The pointer is the SOLE
 *   identity source here — the process `$SESSION_ID` is frozen at spawn time
 *   in this mode and must NOT be trusted, so a missing/unreadable/malformed
 *   pointer fails loud with `SKILL_SESSION_UNRESOLVED` instead of
 *   misattributing.
 * - Per-spawn mode: the `$SESSION_ID` env var is authoritative (a stale
 *   pointer file from a crashed run must never hijack the identity).
 * The result is snapshotted once per script invocation, so a later session
 * overwriting the pointer mid-script cannot change this script's identity.
 */
export function resolveOwningSessionId(): string {
  const jwtDir = Deno.env.get("SKILL_JWT_DIR");
  // Snapshot is keyed by the JWT dir so distinct script invocations (each with
  // its own SKILL_JWT_DIR) never observe a previous invocation's identity.
  if (jwtDir && owningSessionSnapshot?.jwtDir === jwtDir) {
    return owningSessionSnapshot.sessionId;
  }
  const shared = isSharedProcessMode();
  const readPointer = (): string | undefined => {
    if (!jwtDir) return undefined;
    try {
      const raw = Deno.readTextFileSync(`${jwtDir}/active.json`);
      const parsed = JSON.parse(raw) as { sessionId?: unknown };
      // Strict schema: a non-empty string session id, anything else is treated
      // as an unreadable/malformed pointer.
      return typeof parsed.sessionId === "string" && parsed.sessionId.length > 0
        ? parsed.sessionId
        : undefined;
    } catch {
      return undefined;
    }
  };
  let resolved: string | undefined;
  if (shared) {
    // Pointer only — no environment fallback in shared mode.
    resolved = readPointer();
  } else {
    resolved = Deno.env.get("SESSION_ID") ?? readPointer();
  }
  if (!resolved) {
    if (shared) {
      throw new SkillSessionUnresolvedError(jwtDir);
    }
    throw new Error(
      "Cannot resolve owning session: neither the active.json pointer nor $SESSION_ID is available",
    );
  }
  if (jwtDir) {
    owningSessionSnapshot = { jwtDir, sessionId: resolved };
  }
  return resolved;
}

/**
 * Read the owning session's JWT from `{SKILL_JWT_DIR}/{sessionId}.jwt`
 * (issued by the bot process at lease acquisition; deleted at session end).
 * Snapshotted once per script invocation alongside the session id.
 */
export function readSkillJwt(sessionId: string): string {
  const jwtDir = Deno.env.get("SKILL_JWT_DIR");
  if (!jwtDir) {
    throw new Error("SKILL_JWT_DIR env var is not set");
  }
  if (
    owningSessionSnapshot?.jwtDir === jwtDir &&
    owningSessionSnapshot.sessionId === sessionId &&
    owningSessionSnapshot.jwt
  ) {
    return owningSessionSnapshot.jwt;
  }
  const path = `${jwtDir}/${sessionId}.jwt`;
  let jwt: string;
  try {
    jwt = Deno.readTextFileSync(path).trim();
  } catch (cause) {
    throw new Error(
      `SKILL_JWT_UNREADABLE: no JWT file at ${path} — the owning session's lease may have ended: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
  if (!owningSessionSnapshot || owningSessionSnapshot.jwtDir !== jwtDir) {
    owningSessionSnapshot = { jwtDir, sessionId, jwt };
  } else if (owningSessionSnapshot.sessionId === sessionId) {
    owningSessionSnapshot.jwt = jwt;
  }
  return jwt;
}

/**
 * Call the Skill API
 */
export async function callSkillApi(
  apiUrl: string,
  skillName: string,
  sessionId: string,
  parameters: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const url = `${apiUrl}/api/skill/${skillName}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Present the per-session JWT (JWT skill auth). The bot process is the sole
  // HMAC-key holder (issuer + verifier); the agent process only receives the
  // short-lived per-session JWT file — never the deployment secret.
  // The request body's sessionId MUST equal the JWT `sub` (the pointer-resolved
  // owning session): under shared-process mode the `--session-id` CLI value the
  // agent passes can be the stale spawn-time `$SESSION_ID`, while the pool-issued
  // JWT belongs to the CURRENT session. The library substitutes the resolved
  // owner so the agent command line never needs extra params.
  let effectiveSessionId = sessionId;
  const jwtDir = Deno.env.get("SKILL_JWT_DIR");
  if (jwtDir) {
    // Snapshot the owning session + JWT (first call wins; later calls reuse it).
    const owningSessionId = resolveOwningSessionId();
    const jwt = readSkillJwt(owningSessionId);
    headers["Authorization"] = `Bearer ${jwt}`;
    effectiveSessionId = owningSessionId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sessionId: effectiveSessionId,
      parameters,
    }),
  });

  return await response.json();
}

/**
 * Output result to stdout (for Agent to read)
 */
export function outputResult(result: unknown): void {
  console.log(JSON.stringify(result));
}

/**
 * Output error and exit with non-zero code.
 * An optional stable error `code` (e.g. a `SKILL_*` contract code from the
 * payload helper) is included in the emitted JSON for machine readability.
 */
export function exitWithError(message: string, code?: string): never {
  const payload: { success: boolean; error: string; code?: string } = {
    success: false,
    error: message,
  };
  if (code) {
    payload.code = code;
  }
  console.error(JSON.stringify(payload));
  Deno.exit(1);
}
