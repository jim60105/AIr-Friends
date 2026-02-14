// src/utils/metrics.ts

import client from "prom-client";

// Use a dedicated registry (not the global default) for testability
export const metricsRegistry = new client.Registry();

// Set default labels
metricsRegistry.setDefaultLabels({ app: "air-friends" });

// --- Counters ---

/** Total sessions processed */
export const sessionsTotal = new client.Counter({
  name: "airfriends_sessions_total",
  help: "Total number of agent sessions processed",
  labelNames: ["platform", "type", "status"] as const,
  registers: [metricsRegistry],
});

/** Total messages received from platforms */
export const messagesReceivedTotal = new client.Counter({
  name: "airfriends_messages_received_total",
  help: "Total messages received from platforms",
  labelNames: ["platform"] as const,
  registers: [metricsRegistry],
});

/** Total replies sent */
export const repliesSentTotal = new client.Counter({
  name: "airfriends_replies_sent_total",
  help: "Total replies sent to platforms",
  labelNames: ["platform"] as const,
  registers: [metricsRegistry],
});

/** Memory operations count */
export const memoryOperationsTotal = new client.Counter({
  name: "airfriends_memory_operations_total",
  help: "Total memory operations",
  labelNames: ["operation", "visibility"] as const,
  registers: [metricsRegistry],
});

/** Skill API calls count */
export const skillApiCallsTotal = new client.Counter({
  name: "airfriends_skill_api_calls_total",
  help: "Total skill API calls",
  labelNames: ["skill", "status"] as const,
  registers: [metricsRegistry],
});

/** Rate limit rejections */
export const rateLimitRejectionsTotal = new client.Counter({
  name: "airfriends_rate_limit_rejections_total",
  help: "Total requests rejected by rate limiter",
  labelNames: ["platform"] as const,
  registers: [metricsRegistry],
});

// --- Histograms ---

/** Session duration (from start to reply sent or failure) */
export const sessionDurationSeconds = new client.Histogram({
  name: "airfriends_session_duration_seconds",
  help: "Duration of agent sessions in seconds",
  labelNames: ["platform", "type", "status"] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [metricsRegistry],
});

// --- Gauges ---

/** Currently active sessions */
export const activeSessionsGauge = new client.Gauge({
  name: "airfriends_active_sessions",
  help: "Number of currently active agent sessions",
  registers: [metricsRegistry],
});
