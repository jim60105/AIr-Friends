// tests/platforms/discord/discord-emoji-filter.test.ts

// deno-lint-ignore-file no-explicit-any

import { assertEquals } from "@std/assert";
import { isPremiumEmoji } from "@platforms/discord/discord-adapter.ts";

function createMockRole(overrides: Record<string, unknown> = {}): any {
  return {
    managed: false,
    tags: null,
    ...overrides,
  };
}

function createMockEmoji(roles: any[] = []): any {
  return {
    roles: {
      cache: new Map(roles.map((r, i) => [String(i), r])),
    },
  };
}

Deno.test("isPremiumEmoji - no role restrictions is not premium", () => {
  const emoji = createMockEmoji([]);
  assertEquals(isPremiumEmoji(emoji), false);
});

Deno.test("isPremiumEmoji - all premiumSubscriberRole tags is premium", () => {
  const emoji = createMockEmoji([
    createMockRole({ tags: { premiumSubscriberRole: true } }),
  ]);
  assertEquals(isPremiumEmoji(emoji), true);
});

Deno.test("isPremiumEmoji - managed role with integrationId is premium", () => {
  const emoji = createMockEmoji([
    createMockRole({ managed: true, tags: { integrationId: "integration123" } }),
  ]);
  assertEquals(isPremiumEmoji(emoji), true);
});

Deno.test("isPremiumEmoji - mixed subscription and normal roles is not premium", () => {
  const emoji = createMockEmoji([
    createMockRole({ tags: { premiumSubscriberRole: true } }),
    createMockRole({ managed: false, tags: null }),
  ]);
  assertEquals(isPremiumEmoji(emoji), false);
});

Deno.test("isPremiumEmoji - normal role restriction is not premium", () => {
  const emoji = createMockEmoji([
    createMockRole({ managed: false, tags: { someOtherTag: true } }),
  ]);
  assertEquals(isPremiumEmoji(emoji), false);
});

Deno.test("isPremiumEmoji - multiple subscription roles all premium", () => {
  const emoji = createMockEmoji([
    createMockRole({ tags: { premiumSubscriberRole: true } }),
    createMockRole({ managed: true, tags: { integrationId: "sub456" } }),
  ]);
  assertEquals(isPremiumEmoji(emoji), true);
});
