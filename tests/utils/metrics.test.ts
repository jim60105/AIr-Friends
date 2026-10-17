// tests/utils/metrics.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  filesSentTotal,
  messagesReceivedTotal,
  metricsRegistry,
  repliesSentTotal,
  selfResearchNoNoteTotal,
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
  assertStringIncludes(output, "airfriends_files_sent_total");
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

Deno.test("metrics - files sent counter increments per delivered file", async () => {
  filesSentTotal.labels("misskey").inc(3);
  const output = await metricsRegistry.metrics();
  assertStringIncludes(
    output,
    'airfriends_files_sent_total{platform="misskey",app="air-friends"} 3',
  );
});

Deno.test("metrics - self-research no-note counter registered and increments exactly once", async () => {
  selfResearchNoNoteTotal.reset();
  const before = (await selfResearchNoNoteTotal.get()).values[0].value;
  selfResearchNoNoteTotal.inc();
  const after = (await selfResearchNoNoteTotal.get()).values[0].value;
  assertEquals(after, before + 1);
  const output = await metricsRegistry.metrics();
  assertStringIncludes(output, "airfriends_self_research_no_note_total");
});

// --- Email platform labels (email-platform-surfaces) ---
//
// Email joins the existing platform-labelled metrics through the platform identifier
// alone. A canonical email user id (`e_<sha256>`) must never become a label value:
// that would multiply series per sender and leak private identity into the registry.

Deno.test("metrics - email sessions, messages and replies are labelled by platform only", async () => {
  messagesReceivedTotal.labels("email").inc();
  repliesSentTotal.labels("email").inc();
  sessionsTotal.labels("email", "message", "success").inc();

  const output = await metricsRegistry.metrics();
  assertStringIncludes(
    output,
    'airfriends_messages_received_total{platform="email",app="air-friends"}',
  );
  assertStringIncludes(
    output,
    'airfriends_replies_sent_total{platform="email",app="air-friends"}',
  );
  assertStringIncludes(
    output,
    'airfriends_sessions_total{platform="email",type="message",status="success",app="air-friends"}',
  );
});

Deno.test("metrics - no platform metric carries a user- or address-bearing label", async () => {
  // The rendered label sets are the contract: a cardinality-bearing label (user,
  // address, mailbox, channel) fails here instead of exploding the registry.
  const output = await metricsRegistry.metrics();
  const families = [
    "airfriends_messages_received_total",
    "airfriends_replies_sent_total",
    "airfriends_sessions_total",
  ];
  const forbidden = /(user|address|mailbox|channel)/i;

  let checked = 0;
  for (const line of output.split("\n")) {
    if (!families.some((family) => line.startsWith(`${family}{`))) continue;
    checked++;
    const labelKeys = [...line.slice(0, line.indexOf("}")).matchAll(/([A-Za-z_][A-Za-z0-9_]*)="/g)]
      .map((match) => match[1]);
    assertEquals(labelKeys.filter((key) => forbidden.test(key)), [], line);
  }
  assertEquals(checked > 0, true, "expected rendered platform-labelled samples");
});
