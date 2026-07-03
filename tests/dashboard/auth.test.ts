// tests/dashboard/auth.test.ts

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  canonicalizeHost,
  clearSessionCookie,
  createSessionCookie,
  generateSessionToken,
  LoginRateLimiter,
  parseCookies,
  SessionTokenStore,
  validatePassphrase,
} from "../../src/dashboard/auth.ts";

// --- validatePassphrase ---

Deno.test("validatePassphrase - correct passphrase returns true", async () => {
  assertEquals(await validatePassphrase("my-secret", "my-secret"), true);
});

Deno.test("validatePassphrase - wrong passphrase returns false", async () => {
  assertEquals(await validatePassphrase("wrong", "my-secret"), false);
});

Deno.test("validatePassphrase - empty input returns false", async () => {
  assertEquals(await validatePassphrase("", "my-secret"), false);
});

Deno.test("validatePassphrase - different length returns false", async () => {
  assertEquals(await validatePassphrase("short", "a-longer-passphrase"), false);
});

Deno.test("validatePassphrase - same length wrong content returns false", async () => {
  assertEquals(await validatePassphrase("abcd", "efgh"), false);
});

// --- generateSessionToken ---

Deno.test("generateSessionToken - returns non-empty string", () => {
  const token = generateSessionToken();
  assertEquals(typeof token, "string");
  assertNotEquals(token, "");
});

Deno.test("generateSessionToken - returns unique values", () => {
  const t1 = generateSessionToken();
  const t2 = generateSessionToken();
  assertNotEquals(t1, t2);
});

Deno.test("generateSessionToken - returns UUID format", () => {
  const token = generateSessionToken();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assertEquals(uuidRegex.test(token), true);
});

// --- parseCookies ---

Deno.test("parseCookies - parses single cookie", () => {
  const result = parseCookies("session=abc123");
  assertEquals(result, { session: "abc123" });
});

Deno.test("parseCookies - parses multiple cookies", () => {
  const result = parseCookies("a=1; b=2; c=3");
  assertEquals(result, { a: "1", b: "2", c: "3" });
});

Deno.test("parseCookies - empty string returns empty object", () => {
  assertEquals(parseCookies(""), {});
});

Deno.test("parseCookies - handles cookie with = in value", () => {
  const result = parseCookies("token=abc=def");
  assertEquals(result, { token: "abc=def" });
});

// --- SessionTokenStore ---

Deno.test("SessionTokenStore - add and has", () => {
  const store = new SessionTokenStore();
  store.add("tok1");
  assertEquals(store.has("tok1"), true);
  assertEquals(store.has("tok2"), false);
});

Deno.test("SessionTokenStore - remove invalidates token", () => {
  const store = new SessionTokenStore();
  store.add("tok1");
  store.remove("tok1");
  assertEquals(store.has("tok1"), false);
});

Deno.test("SessionTokenStore - size tracks count", () => {
  const store = new SessionTokenStore();
  assertEquals(store.size, 0);
  store.add("a");
  store.add("b");
  assertEquals(store.size, 2);
  store.remove("a");
  assertEquals(store.size, 1);
});

// --- createSessionCookie ---

Deno.test("createSessionCookie - includes HttpOnly", () => {
  const cookie = createSessionCookie("tok123");
  assertEquals(cookie.includes("HttpOnly"), true);
});

Deno.test("createSessionCookie - includes SameSite=Strict", () => {
  const cookie = createSessionCookie("tok123");
  assertEquals(cookie.includes("SameSite=Strict"), true);
});

Deno.test("createSessionCookie - includes Path=/", () => {
  const cookie = createSessionCookie("tok123");
  assertEquals(cookie.includes("Path=/"), true);
});

Deno.test("createSessionCookie - includes token value", () => {
  const cookie = createSessionCookie("tok123");
  assertEquals(cookie.includes("dashboard_session=tok123"), true);
});

// --- clearSessionCookie ---

Deno.test("clearSessionCookie - sets Max-Age=0", () => {
  const cookie = clearSessionCookie();
  assertEquals(cookie.includes("Max-Age=0"), true);
});

Deno.test("clearSessionCookie - includes HttpOnly and SameSite=Strict", () => {
  const cookie = clearSessionCookie();
  assertEquals(cookie.includes("HttpOnly"), true);
  assertEquals(cookie.includes("SameSite=Strict"), true);
});

// --- LoginRateLimiter ---

Deno.test("LoginRateLimiter - allows requests within limit", () => {
  const limiter = new LoginRateLimiter(5, 60000);
  for (let i = 0; i < 4; i++) {
    limiter.recordAttempt("1.2.3.4");
  }
  assertEquals(limiter.isAllowed("1.2.3.4"), true);
});

Deno.test("LoginRateLimiter - blocks after exceeding limit", () => {
  const limiter = new LoginRateLimiter(5, 60000);
  for (let i = 0; i < 6; i++) {
    limiter.recordAttempt("1.2.3.4");
  }
  assertEquals(limiter.isAllowed("1.2.3.4"), false);
});

Deno.test("LoginRateLimiter - isolates per IP", () => {
  const limiter = new LoginRateLimiter(2, 60000);
  for (let i = 0; i < 3; i++) {
    limiter.recordAttempt("1.1.1.1");
  }
  assertEquals(limiter.isAllowed("1.1.1.1"), false);
  assertEquals(limiter.isAllowed("2.2.2.2"), true);
});

// --- F5: global backoff caps total attempts across rotating keys ---

Deno.test("LoginRateLimiter - global backoff caps attempts across many keys", () => {
  // Per-key limit is high, but the global cap (3) blocks all keys once exceeded,
  // modeling an attacker rotating the source IP to dodge per-IP limits.
  const limiter = new LoginRateLimiter(1000, 60000, 3, 60000);
  for (let i = 0; i < 3; i++) {
    assertEquals(limiter.isAllowed(`10.0.0.${i}`), true);
    limiter.recordAttempt(`10.0.0.${i}`);
  }
  // Global cap reached: a brand-new key is now blocked.
  assertEquals(limiter.isAllowed("10.0.0.99"), false);
});

// --- F5: canonicalizeHost ---

Deno.test("canonicalizeHost - strips IPv4 port", () => {
  assertEquals(canonicalizeHost("1.2.3.4:5678"), "1.2.3.4");
});

Deno.test("canonicalizeHost - strips brackets and port from IPv6", () => {
  assertEquals(canonicalizeHost("[::1]:8080"), "::1");
  assertEquals(canonicalizeHost("[fe80::1]"), "fe80::1");
});

Deno.test("canonicalizeHost - preserves bare IPv6 and lowercases", () => {
  assertEquals(canonicalizeHost("FE80::ABCD"), "fe80::abcd");
  assertEquals(canonicalizeHost("::1"), "::1");
});

Deno.test("canonicalizeHost - lowercases hostname and strips port", () => {
  assertEquals(canonicalizeHost("Proxy.Example.COM:443"), "proxy.example.com");
});

// --- SessionTokenStore expiration ---

Deno.test("SessionTokenStore - token expires after max age", async () => {
  const store = new SessionTokenStore(100, 50); // 100ms max, 50ms idle
  store.add("tok1");
  assertEquals(store.has("tok1"), true);
  await new Promise((r) => setTimeout(r, 150));
  assertEquals(store.has("tok1"), false);
});

Deno.test("SessionTokenStore - token expires after idle timeout", async () => {
  const store = new SessionTokenStore(10000, 100); // 10s max, 100ms idle
  store.add("tok1");
  assertEquals(store.has("tok1"), true);
  await new Promise((r) => setTimeout(r, 150));
  assertEquals(store.has("tok1"), false);
});

Deno.test("SessionTokenStore - active usage extends idle timeout", async () => {
  const store = new SessionTokenStore(10000, 200); // 10s max, 200ms idle
  store.add("tok1");
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(store.has("tok1"), true); // Access resets idle
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(store.has("tok1"), true); // Still valid
});

// --- createSessionCookie options ---

Deno.test("createSessionCookie - includes Max-Age when provided", () => {
  const cookie = createSessionCookie("tok123", { maxAgeSeconds: 86400 });
  assertEquals(cookie.includes("Max-Age=86400"), true);
});

Deno.test("createSessionCookie - includes Secure flag when set", () => {
  const cookie = createSessionCookie("tok123", { secure: true });
  assertEquals(cookie.includes("Secure"), true);
});

Deno.test("createSessionCookie - no Secure flag by default", () => {
  const cookie = createSessionCookie("tok123");
  assertEquals(cookie.includes("Secure"), false);
});
