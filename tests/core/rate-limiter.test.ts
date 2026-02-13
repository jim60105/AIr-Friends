// tests/core/rate-limiter.test.ts

import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { RateLimiter } from "@core/rate-limiter.ts";
import type { RateLimitConfig } from "../../src/types/config.ts";

function createConfig(overrides: Partial<RateLimitConfig> = {}): RateLimitConfig {
  return {
    enabled: true,
    maxRequestsPerWindow: 3,
    windowMs: 60000, // 1 minute
    cooldownMs: 30000, // 30 seconds
    ...overrides,
  };
}

Deno.test("RateLimiter - disabled always allows", () => {
  const limiter = new RateLimiter(createConfig({ enabled: false }));
  for (let i = 0; i < 100; i++) {
    assertEquals(limiter.isAllowed("discord:user1"), true);
  }
});

Deno.test("RateLimiter - allows requests within limit", () => {
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 3 }));
  assertEquals(limiter.isAllowed("discord:user1"), true);
  assertEquals(limiter.isAllowed("discord:user1"), true);
  assertEquals(limiter.isAllowed("discord:user1"), true);
});

Deno.test("RateLimiter - blocks after exceeding limit", () => {
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 2 }));
  assertEquals(limiter.isAllowed("discord:user1"), true);
  assertEquals(limiter.isAllowed("discord:user1"), true);
  assertEquals(limiter.isAllowed("discord:user1"), false);
});

Deno.test("RateLimiter - enters cooldown after exceeding", () => {
  using _time = new FakeTime();
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 1, cooldownMs: 30000 }));

  assertEquals(limiter.isAllowed("discord:user1"), true);
  // Exceeds limit, enters cooldown
  assertEquals(limiter.isAllowed("discord:user1"), false);
  // Still in cooldown
  assertEquals(limiter.isAllowed("discord:user1"), false);
});

Deno.test("RateLimiter - allows after cooldown expires", () => {
  using time = new FakeTime();
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 1, cooldownMs: 30000 }));

  assertEquals(limiter.isAllowed("discord:user1"), true);
  assertEquals(limiter.isAllowed("discord:user1"), false);

  // Advance past cooldown
  time.tick(30001);
  assertEquals(limiter.isAllowed("discord:user1"), true);
});

Deno.test("RateLimiter - sliding window expires old requests", () => {
  using time = new FakeTime();
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 2, windowMs: 60000 }));

  assertEquals(limiter.isAllowed("discord:user1"), true);
  assertEquals(limiter.isAllowed("discord:user1"), true);
  // At limit
  assertEquals(limiter.isAllowed("discord:user1"), false);

  // Advance past window so old timestamps expire, and past cooldown
  time.tick(90001);
  assertEquals(limiter.isAllowed("discord:user1"), true);
});

Deno.test("RateLimiter - independent per user", () => {
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 1 }));
  assertEquals(limiter.isAllowed("discord:user1"), true);
  assertEquals(limiter.isAllowed("discord:user1"), false);
  // Different user should be independent
  assertEquals(limiter.isAllowed("discord:user2"), true);
});

Deno.test("RateLimiter - cleanup removes expired entries", () => {
  using time = new FakeTime();
  const limiter = new RateLimiter(createConfig({ windowMs: 60000 }));

  limiter.isAllowed("discord:user1");
  time.tick(60001);
  limiter.cleanup();

  // After cleanup, getRemainingRequests should return max (fresh state)
  assertEquals(limiter.getRemainingRequests("discord:user1"), 3);
});

Deno.test("RateLimiter - reset clears user state", () => {
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 1 }));
  limiter.isAllowed("discord:user1");
  assertEquals(limiter.isAllowed("discord:user1"), false);

  limiter.reset("discord:user1");
  assertEquals(limiter.isAllowed("discord:user1"), true);
});

Deno.test("RateLimiter - getRemainingRequests returns correct count", () => {
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 3 }));
  assertEquals(limiter.getRemainingRequests("discord:user1"), 3);
  limiter.isAllowed("discord:user1");
  assertEquals(limiter.getRemainingRequests("discord:user1"), 2);
  limiter.isAllowed("discord:user1");
  assertEquals(limiter.getRemainingRequests("discord:user1"), 1);
});

Deno.test("RateLimiter - getRemainingRequests returns 0 during cooldown", () => {
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 1 }));
  limiter.isAllowed("discord:user1");
  limiter.isAllowed("discord:user1"); // triggers cooldown
  assertEquals(limiter.getRemainingRequests("discord:user1"), 0);
});

Deno.test("RateLimiter - getRemainingRequests returns Infinity when disabled", () => {
  const limiter = new RateLimiter(createConfig({ enabled: false }));
  assertEquals(limiter.getRemainingRequests("discord:user1"), Infinity);
});

Deno.test("RateLimiter - resetAll clears all state", () => {
  const limiter = new RateLimiter(createConfig({ maxRequestsPerWindow: 1 }));
  limiter.isAllowed("discord:user1");
  limiter.isAllowed("discord:user2");
  limiter.resetAll();
  assertEquals(limiter.isAllowed("discord:user1"), true);
  assertEquals(limiter.isAllowed("discord:user2"), true);
});
