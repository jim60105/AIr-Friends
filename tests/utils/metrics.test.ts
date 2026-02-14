// tests/utils/metrics.test.ts

import { assertStringIncludes } from "@std/assert";
import {
  messagesReceivedTotal,
  metricsRegistry,
  sessionDurationSeconds,
  sessionsTotal,
} from "../../src/utils/metrics.ts";

Deno.test("metrics registry - exports all registered metrics", async () => {
  const output = await metricsRegistry.metrics();
  assertStringIncludes(output, "airfriends_sessions_total");
  assertStringIncludes(output, "airfriends_messages_received_total");
  assertStringIncludes(output, "airfriends_session_duration_seconds");
  assertStringIncludes(output, "airfriends_active_sessions");
  assertStringIncludes(output, "airfriends_replies_sent_total");
  assertStringIncludes(output, "airfriends_memory_operations_total");
  assertStringIncludes(output, "airfriends_skill_api_calls_total");
  assertStringIncludes(output, "airfriends_rate_limit_rejections_total");
});

Deno.test("metrics - counter increments correctly", async () => {
  sessionsTotal.labels("discord", "message", "success").inc();
  const output = await metricsRegistry.metrics();
  assertStringIncludes(output, "airfriends_sessions_total{");
});

Deno.test("metrics - histogram observes correctly", async () => {
  sessionDurationSeconds.labels("discord", "message", "success").observe(5.2);
  const output = await metricsRegistry.metrics();
  assertStringIncludes(output, "airfriends_session_duration_seconds_bucket");
});

Deno.test("metrics - messages received counter", async () => {
  messagesReceivedTotal.labels("discord").inc();
  const output = await metricsRegistry.metrics();
  assertStringIncludes(output, "airfriends_messages_received_total{");
});
