// tests/types/events.test.ts

import { assertEquals } from "@std/assert";
import { isValidPlatform, VALID_PLATFORMS } from "../../src/types/events.ts";

Deno.test("isValidPlatform - returns true for valid platforms", () => {
  assertEquals(isValidPlatform("discord"), true);
  assertEquals(isValidPlatform("misskey"), true);
});

Deno.test("isValidPlatform - returns false for invalid platforms", () => {
  assertEquals(isValidPlatform("slack"), false);
  assertEquals(isValidPlatform(""), false);
  assertEquals(isValidPlatform("Discord"), false);
});

Deno.test("VALID_PLATFORMS - contains expected platforms", () => {
  assertEquals(VALID_PLATFORMS.includes("discord"), true);
  assertEquals(VALID_PLATFORMS.includes("misskey"), true);
  assertEquals(VALID_PLATFORMS.length, 2);
});
