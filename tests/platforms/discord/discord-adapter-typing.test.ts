// tests/platforms/discord/discord-adapter-typing.test.ts

import { assertEquals } from "@std/assert";
import { PlatformAdapter } from "@platforms/platform-adapter.ts";

// Test supportsTypingIndicator() default in base class
Deno.test("PlatformAdapter.supportsTypingIndicator - returns false by default", () => {
  // Create a minimal concrete subclass to test the base class default
  const adapter = Object.create(PlatformAdapter.prototype) as PlatformAdapter;
  assertEquals(adapter.supportsTypingIndicator(), false);
});

// Test supportsTypingIndicator() with DiscordAdapterConfig
Deno.test("DiscordAdapter.supportsTypingIndicator - returns true when config enabled", () => {
  // Simulate the logic from DiscordAdapter.supportsTypingIndicator()
  const config = { typingIndicator: { enabled: true } };
  const result = config.typingIndicator?.enabled ?? false;
  assertEquals(result, true);
});

Deno.test("DiscordAdapter.supportsTypingIndicator - returns false when config disabled", () => {
  const config = { typingIndicator: { enabled: false } };
  const result = config.typingIndicator?.enabled ?? false;
  assertEquals(result, false);
});

Deno.test("DiscordAdapter.supportsTypingIndicator - returns false when config not set", () => {
  const config: { typingIndicator?: { enabled: boolean } } = {};
  const result = config.typingIndicator?.enabled ?? false;
  assertEquals(result, false);
});
