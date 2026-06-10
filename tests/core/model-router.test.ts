// tests/core/model-router.test.ts

import { assertEquals } from "@std/assert";
import { resolveModel, resolveReasoningEffort } from "@core/model-router.ts";
import type { ModelRoutingConfig } from "../../src/types/config.ts";
import type { ModelRoutingContext } from "@core/model-router.ts";

const FALLBACK_MODEL = "default-model";
const FALLBACK_EFFORT = "default";

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
    rules: [{ match: { channel: "discord/account/12345678901234567" }, model: "premium-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "premium-model");
});

Deno.test("resolveModel - should match whitelist channel rule", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { channel: "discord/channel/45678901234567890" }, model: "channel-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    channelId: "45678901234567890",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "channel-model");
});

Deno.test("resolveModel - should not match whitelist when platform differs", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { channel: "discord/account/12345678901234567" }, model: "premium-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "misskey",
    userId: "12345678901234567",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should not match whitelist when user ID differs", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { channel: "discord/account/12345678901234567" }, model: "premium-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "99900000000000001",
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
      { match: { channel: "discord/account/12345678901234567" }, model: "first-model" },
      { match: { sessionType: "message" }, model: "second-model" },
    ],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "first-model");
});

Deno.test("resolveModel - should return fallback when no rules match", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [
      { match: { channel: "discord/account/99900000000000000" }, model: "wrong-model" },
      { match: { sessionType: "spontaneous" }, model: "also-wrong" },
    ],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

// --- contentKeywords tests ---

Deno.test("resolveModel - should match when message contains keyword (case-insensitive)", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { contentKeywords: ["研究"] }, model: "research-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    messageContent: "我想做研究",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "research-model");
});

Deno.test("resolveModel - should match when message contains any keyword (OR logic)", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { contentKeywords: ["研究", "research", "paper"] }, model: "research-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    messageContent: "I want to read a paper",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "research-model");
});

Deno.test("resolveModel - should not match when message contains no keywords", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { contentKeywords: ["研究", "research"] }, model: "research-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    messageContent: "hello world",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should not match contentKeywords for non-message session types", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { contentKeywords: ["研究"] }, model: "research-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "spontaneous",
    messageContent: "研究",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should not match contentKeywords when messageContent is undefined", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { contentKeywords: ["研究"] }, model: "research-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - contentKeywords case-insensitive match", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { contentKeywords: ["Research"] }, model: "research-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    messageContent: "I want to do RESEARCH",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "research-model");
});

// --- AND combination tests ---

Deno.test("resolveModel - should match when whitelist AND contentKeywords both match", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{
      match: { channel: "discord/account/12345678901234567", contentKeywords: ["研究"] },
      model: "combo-model",
    }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
    messageContent: "我想做研究",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "combo-model");
});

Deno.test("resolveModel - should not match when whitelist matches but contentKeywords does not", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{
      match: { channel: "discord/account/12345678901234567", contentKeywords: ["研究"] },
      model: "combo-model",
    }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
    messageContent: "hello",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should not match when contentKeywords matches but whitelist does not", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{
      match: { channel: "discord/account/99900000000000000", contentKeywords: ["研究"] },
      model: "combo-model",
    }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
    messageContent: "研究",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should match when whitelist AND sessionType both match", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{
      match: { channel: "discord/account/12345678901234567", sessionType: "message" },
      model: "combo-model",
    }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "combo-model");
});

Deno.test("resolveModel - should match when all three conditions match", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{
      match: {
        channel: "discord/account/12345678901234567",
        sessionType: "message",
        contentKeywords: ["研究"],
      },
      model: "triple-model",
    }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
    messageContent: "我想做研究",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "triple-model");
});

Deno.test("resolveModel - should not match when one of three conditions fails", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{
      match: {
        channel: "discord/account/12345678901234567",
        sessionType: "message",
        contentKeywords: ["研究"],
      },
      model: "triple-model",
    }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
    messageContent: "hello",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

Deno.test("resolveModel - should not match when match object has no conditions", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: {}, model: "empty-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), FALLBACK_MODEL);
});

// --- Backward compatibility ---

Deno.test("resolveModel - backward compat: single whitelist condition still works", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { channel: "discord/account/12345678901234567" }, model: "premium-model" }],
  };
  const context: ModelRoutingContext = {
    sessionType: "message",
    platform: "discord",
    userId: "12345678901234567",
  };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "premium-model");
});

Deno.test("resolveModel - backward compat: single sessionType condition still works", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "spontaneous" }, model: "sp-model" }],
  };
  const context: ModelRoutingContext = { sessionType: "spontaneous" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "sp-model");
});

// --- resolveReasoningEffort tests ---

Deno.test("resolveReasoningEffort - returns fallback when routing undefined", () => {
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveReasoningEffort(undefined, context, FALLBACK_EFFORT), "default");
});

Deno.test("resolveReasoningEffort - returns fallback when routing disabled", () => {
  const config: ModelRoutingConfig = {
    enabled: false,
    rules: [{ match: { sessionType: "message" }, model: "m", reasoningEffort: "high" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveReasoningEffort(config, context, FALLBACK_EFFORT), "default");
});

Deno.test("resolveReasoningEffort - matched rule with effort wins", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "message" }, model: "m", reasoningEffort: "high" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveReasoningEffort(config, context, "low"), "high");
});

Deno.test("resolveReasoningEffort - matched rule without effort falls back", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "message" }, model: "m" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveReasoningEffort(config, context, "low"), "low");
});

Deno.test("resolveReasoningEffort - no rule matches returns fallback", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "spontaneous" }, model: "m", reasoningEffort: "high" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveReasoningEffort(config, context, "medium"), "medium");
});

Deno.test("resolveReasoningEffort - first matching rule wins even if later rule has effort", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [
      { match: { sessionType: "message" }, model: "m1" }, // matches, no effort
      { match: { sessionType: "message" }, model: "m2", reasoningEffort: "high" },
    ],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  // Stops at first matching rule (no effort) -> fallback, does NOT reach rule 2.
  assertEquals(resolveReasoningEffort(config, context, "low"), "low");
});

Deno.test("resolveReasoningEffort - model and effort resolved from same matched rule", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "message" }, model: "routed-model", reasoningEffort: "high" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveModel(config, context, FALLBACK_MODEL), "routed-model");
  assertEquals(resolveReasoningEffort(config, context, FALLBACK_EFFORT), "high");
});

Deno.test("resolveReasoningEffort - empty-string effort on rule treated as fallback", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "message" }, model: "m", reasoningEffort: "" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  assertEquals(resolveReasoningEffort(config, context, "medium"), "medium");
});

Deno.test("resolveReasoningEffort - explicit 'default' on matched rule terminates chain", () => {
  const config: ModelRoutingConfig = {
    enabled: true,
    rules: [{ match: { sessionType: "message" }, model: "m", reasoningEffort: "default" }],
  };
  const context: ModelRoutingContext = { sessionType: "message" };
  // Explicit "default" is a concrete value -> returned (terminates), not fallthrough.
  assertEquals(resolveReasoningEffort(config, context, "high"), "default");
});
