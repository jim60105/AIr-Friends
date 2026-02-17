// tests/core/model-router.test.ts

import { assertEquals } from "@std/assert";
import { resolveModel } from "@core/model-router.ts";
import type { ModelRoutingConfig } from "../../src/types/config.ts";
import type { ModelRoutingContext } from "@core/model-router.ts";

const FALLBACK_MODEL = "default-model";

Deno.test("resolveModel - should return fallback when routing is undefined", () => {
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveModel(undefined, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should return fallback when routing is disabled", () => {
  const config: ModelRoutingConfig = {
    enabled: false,
    rules: [{ match: { sessionType: "message" }, model: "other-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should return fallback when rules array is empty", () => {
  const config: ModelRoutingConfig = { enabled: true, rules: [] };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should match whitelist account rule", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { whitelist: "discord/account/123" }, model: "premium-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "123",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "premium-model");
});

Deno.test("resolveModel - should match whitelist channel rule", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { whitelist: "discord/channel/456" }, model: "channel-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    channelId: "456",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "channel-model");
});

Deno.test("resolveModel - should not match whitelist when platform differs", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { whitelist: "discord/account/123" }, model: "premium-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "misskey",
    userId: "123",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should not match whitelist when user ID differs", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { whitelist: "discord/account/123" }, model: "premium-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "999",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should match sessionType: message", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "message" }, model: "msg-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "msg-model");
});

Deno.test("resolveModel - should match sessionType: spontaneous", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "spontaneous" }, model: "sp-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "spontaneous" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "sp-model");
});

Deno.test("resolveModel - should match sessionType: self-research", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "self-research" }, model: "sr-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "self-research" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "sr-model");
});

Deno.test("resolveModel - should match sessionType: memory-maintenance", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "memory-maintenance" }, model: "mm-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "memory-maintenance" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "mm-model");
});

Deno.test("resolveModel - should not match different sessionType", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "spontaneous" }, model: "sp-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should use first matching rule when multiple rules match", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [
      { match: { whitelist: "discord/account/123" }, model: "first-model" },
      { match: { sessionType: "message" }, model: "second-model" },
    ],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "123",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "first-model");
});

Deno.test("resolveModel - should return fallback when no rules match", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [
      { match: { whitelist: "discord/account/999" }, model: "wrong-model" },
      { match: { sessionType: "spontaneous" }, model: "also-wrong" },
    ],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "123",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});
