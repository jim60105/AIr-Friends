// src/utils/skill-jwt.ts
//
// Per-session signed JWT (HS256) for Skill API authentication.
//
// The JWT is a standard 3-segment token: base64url(header).base64url(payload).base64url(signature),
// where header is `{"alg":"HS256"}` and the payload carries `{ sub, channel, jti, iat, exp }`.
// The HMAC-SHA256 signature is computed over `headerB64 + "." + payloadB64` using the deployment
// secret, which only the bot process holds (JWT issuer + Skill API verifier).

import {
  atomicWritePrivate,
  isValidSkillSecret,
  MIN_SKILL_SECRET_BYTES,
} from "@utils/skill-secret.ts";

const JWT_HEADER = { alg: "HS256" };

/** JWT lifetime, aligned to the 30-minute session idle TTL. */
export const SKILL_JWT_TTL_SEC = 30 * 60;

export interface SkillJwtPayload {
  /** Owning session ID (the session that must present this token). */
  sub: string;
  /** Channel ID the session belongs to. */
  channel: string;
  /** The session's per-session caller token (unguessable element). */
  jti: string;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiration (unix seconds). */
  exp: number;
}

export interface SkillJwtVerifyExpectation {
  sessionId: string;
  channelId: string;
  callerToken: string;
}

export type SkillJwtVerifyResult =
  | { valid: true }
  | {
    valid: false;
    reason:
      | "malformed"
      | "bad_signature"
      | "sub_mismatch"
      | "channel_mismatch"
      | "jti_mismatch"
      | "expired";
    detail?: string;
  };

function base64UrlEncode(data: string | Uint8Array): string {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (const byte of input) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(b64: string): Uint8Array {
  const b64padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return base64UrlEncode(new Uint8Array(sig));
}

/** Constant-time string comparison (avoids a length/content timing oracle). */
function constantTimeEqual(a: string, b: string): boolean {
  const encA = new TextEncoder().encode(a);
  const encB = new TextEncoder().encode(b);
  const len = Math.min(encA.byteLength, encB.byteLength);
  let diff = encA.byteLength === encB.byteLength ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= encA[i] ^ encB[i];
  }
  return diff === 0;
}

/**
 * Build a signed 3-segment HS256 JWT for the owning session.
 * `exp` should be aligned to the session idle TTL (30 minutes) so a queued
 * session never presents an expired JWT.
 */
export async function createSkillJwt(
  secret: string,
  payload: Omit<SkillJwtPayload, "iat" | "exp">,
  nowSec?: number,
): Promise<string> {
  if (!isValidSkillSecret(secret)) {
    throw new Error(`Skill API secret must be at least ${MIN_SKILL_SECRET_BYTES} bytes`);
  }
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const fullPayload: SkillJwtPayload = {
    ...payload,
    iat: now,
    // Default TTL: 30 minutes (session idle TTL).
    exp: now + SKILL_JWT_TTL_SEC,
  };
  const headerB64 = base64UrlEncode(JSON.stringify(JWT_HEADER));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = await hmacSha256(secret, `${headerB64}.${payloadB64}`);
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify a presented Skill API JWT against the deployment secret and the
 * expected session identity. Runs the four checks:
 *  1. HMAC-SHA256 signature matches (constant-time).
 *  2. `sub` equals the request's `sessionId`.
 *  3. `channel` equals the session's registered channel ID.
 *  4. `jti` equals the session's stored caller token AND `exp` has not passed.
 */
export async function verifySkillJwt(
  token: string,
  secret: string,
  expected: SkillJwtVerifyExpectation,
): Promise<SkillJwtVerifyResult> {
  const segments = token.split(".");
  if (segments.length !== 3) {
    return { valid: false, reason: "malformed", detail: "not a 3-segment token" };
  }
  // Defensive: refuse to verify against an invalid (empty/short) deployment
  // secret — never fall back to a known empty HMAC key.
  if (!isValidSkillSecret(secret)) {
    return { valid: false, reason: "malformed", detail: "invalid deployment secret" };
  }
  const [headerB64, payloadB64, sigB64] = segments;

  // Check 1: signature.
  const expectedSig = await hmacSha256(secret, `${headerB64}.${payloadB64}`);
  if (!constantTimeEqual(sigB64, expectedSig)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: SkillJwtPayload;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    payload = JSON.parse(payloadJson) as SkillJwtPayload;
  } catch {
    return { valid: false, reason: "malformed", detail: "undecodable payload" };
  }

  // Check 2: sub == sessionId.
  if (payload.sub !== expected.sessionId) {
    return {
      valid: false,
      reason: "sub_mismatch",
      detail: `sub=${payload.sub} sessionId=${expected.sessionId}`,
    };
  }

  // Check 3: channel == session.channelId.
  if (payload.channel !== expected.channelId) {
    return {
      valid: false,
      reason: "channel_mismatch",
      detail: `channel=${payload.channel} channelId=${expected.channelId}`,
    };
  }

  // Check 4a: exp not passed (checked before jti so an expired token always
  // surfaces as 401/expired regardless of other claim state).
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return { valid: false, reason: "malformed", detail: "missing or non-numeric exp" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec >= payload.exp) {
    return { valid: false, reason: "expired", detail: `exp=${payload.exp} now=${nowSec}` };
  }

  // Check 4b: jti == callerToken.
  if (payload.jti !== expected.callerToken) {
    return {
      valid: false,
      reason: "jti_mismatch",
      detail: `jti does not equal the session's caller token`,
    };
  }

  return { valid: true };
}

/**
 * Parse the `exp` claim of a JWT payload (for renewal checks).
 * Returns undefined when the token is malformed or lacks `exp`.
 */
export function parseJwtExp(token: string): number | undefined {
  const segments = token.split(".");
  if (segments.length !== 3) return undefined;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlDecode(segments[1]));
    const payload = JSON.parse(payloadJson) as SkillJwtPayload;
    return typeof payload.exp === "number" ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Structural view of the session registry for the JWT file helpers, so this
 * module does not need to import the registry class.
 */
export interface SkillJwtIssuerRegistry {
  get(sessionId: string): { channelId: string } | undefined;
  getCallerToken(sessionId: string): string | undefined;
}

/**
 * Issue (or re-issue) the owning session's JWT file at
 * `{jwtDir}/{sessionId}.jwt`, with secure file hygiene (atomic, mode 0600,
 * symlink-safe). Shared by the process pool (shared-process mode) and the
 * session orchestrator (per-spawn mode). Returns false when the session is
 * no longer registered (nothing written).
 */
export async function issueSessionJwtFile(params: {
  jwtDir: string;
  secret: string;
  registry: SkillJwtIssuerRegistry;
  sessionId: string;
}): Promise<boolean> {
  const { jwtDir, secret, registry, sessionId } = params;
  const session = registry.get(sessionId);
  if (!session) return false;
  const callerToken = registry.getCallerToken(sessionId) ?? "";
  const jwt = await createSkillJwt(secret, {
    sub: sessionId,
    channel: session.channelId,
    jti: callerToken,
  });
  await atomicWritePrivate(`${jwtDir}/${sessionId}.jwt`, jwt + "\n");
  return true;
}

/** Delete the session's JWT file (idempotent; missing file is fine). */
export async function deleteSessionJwtFile(jwtDir: string, sessionId: string): Promise<void> {
  try {
    await Deno.remove(`${jwtDir}/${sessionId}.jwt`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}
