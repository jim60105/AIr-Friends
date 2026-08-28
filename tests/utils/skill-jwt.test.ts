// tests/utils/skill-jwt.test.ts
// Unit tests for per-session Skill API JWT (HS256) creation and verification.

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { isAbsolute, resolve } from "@std/path";
import {
  createSkillJwt,
  DEFAULT_SKILL_JWT_DIR,
  parseJwtExp,
  resolveSkillJwtDir,
  verifySkillJwt,
} from "../../src/utils/skill-jwt.ts";

const SECRET = "test-deployment-secret-0123456789abcdef0123456789abcdef";
const EXPECTED = {
  sessionId: "sess_abc123",
  channelId: "discord/ch1",
  callerToken: "caller-tok-xyz",
};

Deno.test("createSkillJwt - produces a 3-segment HS256 token with iat/exp", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = await createSkillJwt(SECRET, {
    sub: EXPECTED.sessionId,
    channel: EXPECTED.channelId,
    jti: EXPECTED.callerToken,
  }, nowSec);

  const segments = jwt.split(".");
  assertEquals(segments.length, 3);

  // Header decodes to {"alg":"HS256"}.
  const headerJson = atob(segments[0].replace(/-/g, "+").replace(/_/g, "/"));
  const header = JSON.parse(headerJson);
  assertEquals(header.alg, "HS256");

  // exp is now + 30 minutes.
  const exp = parseJwtExp(jwt);
  assertEquals(exp, nowSec + 30 * 60);
});

Deno.test("verifySkillJwt - valid token passes all four checks", async () => {
  const jwt = await createSkillJwt(SECRET, {
    sub: EXPECTED.sessionId,
    channel: EXPECTED.channelId,
    jti: EXPECTED.callerToken,
  });
  const result = await verifySkillJwt(jwt, SECRET, EXPECTED);
  assertEquals(result.valid, true);
});

Deno.test("verifySkillJwt - rejects a token signed with a different secret", async () => {
  const jwt = await createSkillJwt("other-deployment-secret-0123456789abcdef0123456789ab", {
    sub: EXPECTED.sessionId,
    channel: EXPECTED.channelId,
    jti: EXPECTED.callerToken,
  });
  const result = await verifySkillJwt(jwt, SECRET, EXPECTED);
  assert(!result.valid);
  if (!result.valid) {
    assertEquals(result.reason, "bad_signature");
  }
});

Deno.test("verifySkillJwt - rejects sub mismatch", async () => {
  const jwt = await createSkillJwt(SECRET, {
    sub: "sess_other",
    channel: EXPECTED.channelId,
    jti: EXPECTED.callerToken,
  });
  const result = await verifySkillJwt(jwt, SECRET, EXPECTED);
  assert(!result.valid);
  if (!result.valid) {
    assertEquals(result.reason, "sub_mismatch");
  }
});

Deno.test("verifySkillJwt - rejects channel mismatch", async () => {
  const jwt = await createSkillJwt(SECRET, {
    sub: EXPECTED.sessionId,
    channel: "discord/ch2",
    jti: EXPECTED.callerToken,
  });
  const result = await verifySkillJwt(jwt, SECRET, EXPECTED);
  assert(!result.valid);
  if (!result.valid) {
    assertEquals(result.reason, "channel_mismatch");
  }
});

Deno.test("verifySkillJwt - rejects jti mismatch", async () => {
  const jwt = await createSkillJwt(SECRET, {
    sub: EXPECTED.sessionId,
    channel: EXPECTED.channelId,
    jti: "wrong-caller-token",
  });
  const result = await verifySkillJwt(jwt, SECRET, EXPECTED);
  assert(!result.valid);
  if (!result.valid) {
    assertEquals(result.reason, "jti_mismatch");
  }
});

Deno.test("verifySkillJwt - rejects expired token", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  // Issue a token that expires in the past.
  const jwt = await createSkillJwt(SECRET, {
    sub: EXPECTED.sessionId,
    channel: EXPECTED.channelId,
    jti: EXPECTED.callerToken,
  }, nowSec - 31 * 60); // iat in the past -> exp = nowSec - 60 (already passed)
  const result = await verifySkillJwt(jwt, SECRET, EXPECTED);
  assert(!result.valid);
  if (!result.valid) {
    assertEquals(result.reason, "expired");
  }
});

Deno.test("verifySkillJwt - rejects malformed token", async () => {
  const result = await verifySkillJwt("not-a-jwt", SECRET, EXPECTED);
  assert(!result.valid);
  if (!result.valid) {
    assertEquals(result.reason, "malformed");
  }
});

Deno.test("verifySkillJwt - tampered signature is rejected", async () => {
  const jwt = await createSkillJwt(SECRET, {
    sub: EXPECTED.sessionId,
    channel: EXPECTED.channelId,
    jti: EXPECTED.callerToken,
  });
  const segments = jwt.split(".");
  const tampered = segments[0] + "." + segments[1] + "." + segments[2].slice(0, -2) + "aa";
  assertNotEquals(tampered, jwt);
  const result = await verifySkillJwt(tampered, SECRET, EXPECTED);
  assert(!result.valid);
  if (!result.valid) {
    assertEquals(result.reason, "bad_signature");
  }
});

Deno.test("parseJwtExp - returns exp of a valid token", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const jwt = await createSkillJwt(SECRET, {
    sub: EXPECTED.sessionId,
    channel: EXPECTED.channelId,
    jti: EXPECTED.callerToken,
  }, nowSec);
  assertEquals(parseJwtExp(jwt), nowSec + 30 * 60);
  assertEquals(parseJwtExp("garbage"), undefined);
});

Deno.test("createSkillJwt - throws on a secret shorter than 32 bytes", async () => {
  let threw = false;
  try {
    await createSkillJwt("short-secret", {
      sub: EXPECTED.sessionId,
      channel: EXPECTED.channelId,
      jti: EXPECTED.callerToken,
    });
  } catch {
    threw = true;
  }
  assert(threw, "expected createSkillJwt to reject a short secret");
});

Deno.test("verifySkillJwt - rejects verification against an empty/short secret", async () => {
  const jwt = await createSkillJwt(SECRET, {
    sub: EXPECTED.sessionId,
    channel: EXPECTED.channelId,
    jti: EXPECTED.callerToken,
  });
  const result = await verifySkillJwt(jwt, "", EXPECTED);
  assert(!result.valid);
  const result2 = await verifySkillJwt(jwt, "short", EXPECTED);
  assert(!result2.valid);
});

Deno.test("verifySkillJwt - rejects a correctly-signed token without a finite exp", async () => {
  // Craft header/payload with no `exp`, sign it correctly with HMAC-SHA256.
  const b64 = (data: string | Uint8Array): string => {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const headerB64 = b64(JSON.stringify({ alg: "HS256" }));
  const payloadB64 = b64(
    JSON.stringify({
      sub: EXPECTED.sessionId,
      channel: EXPECTED.channelId,
      jti: EXPECTED.callerToken,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  const token = `${headerB64}.${payloadB64}.${b64(new Uint8Array(sig))}`;

  const result = await verifySkillJwt(token, SECRET, EXPECTED);
  assert(!result.valid);
  if (!result.valid) {
    assertEquals(result.reason, "malformed");
  }
});

Deno.test("resolveSkillJwtDir - resolves the default to an absolute path", () => {
  const dir = resolveSkillJwtDir();
  assertEquals(dir, resolve(DEFAULT_SKILL_JWT_DIR));
  assertEquals(isAbsolute(dir), true);
});

Deno.test("resolveSkillJwtDir - resolves a relative config value against the process cwd", () => {
  const dir = resolveSkillJwtDir("data/skill-jwt");
  assertEquals(dir, resolve("data/skill-jwt"));
  assertEquals(isAbsolute(dir), true);
});

Deno.test("resolveSkillJwtDir - keeps an absolute config value unchanged", () => {
  assertEquals(resolveSkillJwtDir("/tmp/absolute-jwt-dir"), "/tmp/absolute-jwt-dir");
});

Deno.test("resolveSkillJwtDir - blank values fall back to the default, never the bot cwd", () => {
  const expected = resolve(DEFAULT_SKILL_JWT_DIR);
  assertEquals(resolveSkillJwtDir(""), expected);
  assertEquals(resolveSkillJwtDir("   "), expected);
  // The bot process cwd must NOT be used as the JWT directory.
  assertNotEquals(resolveSkillJwtDir(""), Deno.cwd());
});
