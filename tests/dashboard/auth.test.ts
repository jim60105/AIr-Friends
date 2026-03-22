// tests/dashboard/auth.test.ts

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  clearSessionCookie,
  createSessionCookie,
  generateSessionToken,
  parseCookies,
  SessionTokenStore,
  validatePassphrase,
} from "../../src/dashboard/auth.ts";

// --- validatePassphrase ---

Deno.test("validatePassphrase - correct passphrase returns true", () => {
  assertEquals(validatePassphrase("my-secret", "my-secret"), true);
});

Deno.test("validatePassphrase - wrong passphrase returns false", () => {
  assertEquals(validatePassphrase("wrong", "my-secret"), false);
});

Deno.test("validatePassphrase - empty input returns false", () => {
  assertEquals(validatePassphrase("", "my-secret"), false);
});

Deno.test("validatePassphrase - different length returns false", () => {
  assertEquals(validatePassphrase("short", "a-longer-passphrase"), false);
});

Deno.test("validatePassphrase - same length wrong content returns false", () => {
  assertEquals(validatePassphrase("abcd", "efgh"), false);
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
