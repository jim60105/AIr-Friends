// tests/platforms/email/email-identity.test.ts

import { assertEquals, assertThrows } from "@std/assert";
import { EMAIL_WHITELIST_PATTERN, normalizeEmailMailbox } from "@platforms/email/email-identity.ts";

Deno.test("normalizeEmailMailbox - canonical and distinct addresses", () => {
  const norm1 = normalizeEmailMailbox("User+tag@EXAMPLE.COM");
  const norm2 = normalizeEmailMailbox("User+tag@example.com");
  assertEquals(norm1.canonicalAddress, "User+tag@example.com");
  assertEquals(norm2.canonicalAddress, "User+tag@example.com");
  assertEquals(norm1.userId, norm2.userId);

  // user+tag@example.com (lowercase local-part) is distinct from User+tag@example.com
  const normLower = normalizeEmailMailbox("user+tag@example.com");
  assertEquals(normLower.canonicalAddress, "user+tag@example.com");
  assertEquals(normLower.userId !== norm1.userId, true);

  // User@example.com (without alias) is distinct
  const normNoTag = normalizeEmailMailbox("User@example.com");
  assertEquals(normNoTag.canonicalAddress, "User@example.com");
  assertEquals(normNoTag.userId !== norm1.userId, true);
});

Deno.test("normalizeEmailMailbox - parses angle-addr format", () => {
  const norm = normalizeEmailMailbox("Ada Lovelace <ada.lovelace+ai@EXAMPLE.ORG>");
  assertEquals(norm.canonicalAddress, "ada.lovelace+ai@example.org");
  assertEquals(norm.userId.startsWith("e_"), true);
  assertEquals(norm.userId.length, 66); // "e_" + 64 hex chars
});

Deno.test("normalizeEmailMailbox - handles IDNA punycode domain", () => {
  const norm = normalizeEmailMailbox("user@MÜNCHEN.DE");
  assertEquals(norm.canonicalAddress, "user@xn--mnchen-3ya.de");
});

Deno.test("normalizeEmailMailbox - preserves dots and aliases distinctly", () => {
  const normDots1 = normalizeEmailMailbox("first.last@example.com");
  const normDots2 = normalizeEmailMailbox("firstlast@example.com");
  assertEquals(normDots1.canonicalAddress, "first.last@example.com");
  assertEquals(normDots2.canonicalAddress, "firstlast@example.com");
  assertEquals(normDots1.userId !== normDots2.userId, true);
});

Deno.test("normalizeEmailMailbox - rejects invalid and ambiguous inputs", () => {
  // Empty
  assertThrows(() => normalizeEmailMailbox(""), Error, "empty");

  // Multiple addresses
  assertThrows(() => normalizeEmailMailbox("a@example.com, b@example.com"), Error);
  assertThrows(() => normalizeEmailMailbox("a@example.com; b@example.com"), Error);
  assertThrows(() => normalizeEmailMailbox("a@example.com\nb@example.com"), Error);

  // Path characters
  assertThrows(() => normalizeEmailMailbox("../user@example.com"), Error);
  assertThrows(() => normalizeEmailMailbox("user/sub@example.com"), Error);
  assertThrows(() => normalizeEmailMailbox("user\\sub@example.com"), Error);

  // Multiple '@' characters
  assertThrows(() => normalizeEmailMailbox("user@host@example.com"), Error);

  // Port, query, fragment in domain
  assertThrows(() => normalizeEmailMailbox("user@example.com:443"), Error);
  assertThrows(() => normalizeEmailMailbox("user@example.com?query=1"), Error);
  assertThrows(() => normalizeEmailMailbox("user@example.com#fragment"), Error);
  // Malformed angle brackets
  assertThrows(() => normalizeEmailMailbox("<user@example.com"), Error);
  assertThrows(() => normalizeEmailMailbox("user@example.com>"), Error);
  assertThrows(() => normalizeEmailMailbox("Name <a@b.com> extra"), Error);
});

Deno.test("EMAIL_WHITELIST_PATTERN - matches email account channels", () => {
  assertEquals(
    EMAIL_WHITELIST_PATTERN.test(
      "email/account/e_b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514",
    ),
    true,
  );
  assertEquals(EMAIL_WHITELIST_PATTERN.test("email/account/user@example.com"), true);
  assertEquals(EMAIL_WHITELIST_PATTERN.test("email/channel/123"), false);
  assertEquals(EMAIL_WHITELIST_PATTERN.test("discord/account/123"), false);
});
