// src/healthcheck.ts

import type { AppContext } from "./bootstrap.ts";
import { createLogger } from "@utils/logger.ts";
import { metricsRegistry } from "@utils/metrics.ts";
import type { MetricsConfig } from "./types/config.ts";

const logger = createLogger("HealthCheck");

/**
 * Health check status
 */
export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: Date;
  uptime: number;
  checks: {
    name: string;
    status: "pass" | "warn" | "fail";
    message?: string;
  }[];
}

/**
 * Health check server (simple HTTP endpoint)
 */
export class HealthCheckServer {
  private context: AppContext | null = null;
  private server: Deno.HttpServer | null = null;
  private startTime: Date = new Date();
  private port: number;
  private metricsConfig: MetricsConfig | null;

  constructor(port: number = 8080, metricsConfig?: MetricsConfig) {
    this.port = port;
    this.metricsConfig = metricsConfig ?? null;
  }

  /**
   * Set application context
   */
  setContext(context: AppContext): void {
    this.context = context;
  }

  /**
   * Start the health check server
   */
  start(): void {
    this.server = Deno.serve(
      { port: this.port },
      (request) => this.handleRequest(request),
    );

    logger.info("Health check server started", { port: this.port });
  }

  /**
   * Stop the health check server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      this.server = null;
      logger.info("Health check server stopped");
    }
  }

  /**
   * Handle incoming requests
   */
  private handleRequest(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);

    // Check metrics path (configurable, default "/metrics")
    if (
      this.metricsConfig?.enabled &&
      url.pathname === this.metricsConfig.path
    ) {
      return this.metricsResponse();
    }

    switch (url.pathname) {
      case "/health":
      case "/healthz":
        return this.healthResponse();
      case "/ready":
      case "/readyz":
        return this.readyResponse();
      default:
        return new Response("Not Found", { status: 404 });
    }
  }

  /**
   * Generate metrics response (Prometheus exposition format)
   */
  private async metricsResponse(): Promise<Response> {
    try {
      const metrics = await metricsRegistry.metrics();
      return new Response(metrics, {
        status: 200,
        headers: { "Content-Type": metricsRegistry.contentType },
      });
    } catch (error) {
      logger.error("Failed to generate metrics", { error: String(error) });
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  /**
   * Generate health response
   */
  private healthResponse(): Response {
    const status = this.checkHealth();
    const httpStatus = status.status === "healthy" ? 200 : status.status === "degraded" ? 200 : 503;

    return new Response(JSON.stringify(status, null, 2), {
      status: httpStatus,
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * Generate readiness response
   */
  private readyResponse(): Response {
    if (!this.context) {
      return new Response(JSON.stringify({ ready: false }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const allConnected = this.context.platformRegistry.isAllConnected();

    return new Response(
      JSON.stringify({ ready: allConnected }),
      {
        status: allConnected ? 200 : 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Check overall health
   */
  private checkHealth(): HealthStatus {
    const checks: HealthStatus["checks"] = [];

    // Check platforms
    if (this.context) {
      const platformStatus = this.context.platformRegistry.getStatus();
      for (const [platform, status] of platformStatus) {
        checks.push({
          name: `platform:${platform}`,
          status: status.state === "connected"
            ? "pass"
            : status.state === "reconnecting"
            ? "warn"
            : "fail",
          message: status.lastError,
        });
      }
    }

    // Determine overall status
    const hasFailure = checks.some((c) => c.status === "fail");
    const hasWarning = checks.some((c) => c.status === "warn");

    const status: HealthStatus["status"] = hasFailure
      ? "unhealthy"
      : hasWarning
      ? "degraded"
      : "healthy";

    return {
      status,
      timestamp: new Date(),
      uptime: Date.now() - this.startTime.getTime(),
      checks,
    };
  }
}
