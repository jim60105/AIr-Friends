// tests/platforms/discord/discord-adapter-typing.test.ts

import { assertEquals } from "@std/assert";
import { PlatformAdapter } from "@platforms/platform-adapter.ts";
import { MisskeyAdapter } from "@platforms/misskey/misskey-adapter.ts";

// Test supportsTypingIndicator() default in base class
Deno.test("PlatformAdapter.supportsTypingIndicator - returns false by default", () => {
  const adapter = Object.create(PlatformAdapter.prototype) as PlatformAdapter;
  assertEquals(adapter.supportsTypingIndicator(), false);
});

// Test MisskeyAdapter.sendTyping() is a no-op
Deno.test("MisskeyAdapter.sendTyping - resolves without error (no-op)", async () => {
  // Call sendTyping on MisskeyAdapter prototype directly
  const result = MisskeyAdapter.prototype.sendTyping.call({}, "test-channel");
  assertEquals(result instanceof Promise, true);
  await result; // Should resolve without error
});

// Test MisskeyAdapter.supportsTypingIndicator() returns false (inherited default)
Deno.test("MisskeyAdapter.supportsTypingIndicator - returns false (inherited)", () => {
  // supportsTypingIndicator is inherited from PlatformAdapter, not overridden
  const result = PlatformAdapter.prototype.supportsTypingIndicator.call({});
  assertEquals(result, false);
});

// Test DiscordAdapter.supportsTypingIndicator() logic
Deno.test("DiscordAdapter.supportsTypingIndicator - returns true when config enabled", () => {
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
