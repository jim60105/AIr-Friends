// src/healthcheck.ts

import type { AppContext } from "./bootstrap.ts";
import { createLogger } from "@utils/logger.ts";
import { metricsRegistry, skillReadinessGauge } from "@utils/metrics.ts";
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
 * Individual skill readiness check result
 */
export interface SkillReadinessCheck {
  name: string;
  ready: boolean;
  message?: string;
}

/**
 * Aggregated skill readiness result
 */
export interface SkillReadinessResult {
  allReady: boolean;
  checks: SkillReadinessCheck[];
}

/** Cache TTL for skill readiness checks (ms) */
const READINESS_CACHE_TTL_MS = 30_000;

/**
 * Health check server (simple HTTP endpoint)
 */
export class HealthCheckServer {
  private context: AppContext | null = null;
  private server: Deno.HttpServer | null = null;
  private startTime: Date = new Date();
  private port: number;
  private metricsConfig: MetricsConfig | null;
  private cachedReadiness: SkillReadinessResult | null = null;
  private cachedReadinessTime = 0;

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
   * Generate readiness response with skill dependency checks
   */
  private async readyResponse(): Promise<Response> {
    if (!this.context) {
      return new Response(JSON.stringify({ ready: false }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    const allConnected = this.context.platformRegistry.isAllConnected();
    const skillReadiness = await this.checkSkillReadiness();

    const ready = allConnected && skillReadiness.allReady;

    return new Response(
      JSON.stringify({
        ready,
        platforms: allConnected,
        skillReadiness: {
          allReady: skillReadiness.allReady,
          checks: skillReadiness.checks,
        },
      }),
      {
        status: ready ? 200 : 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Check skill readiness with caching to avoid spawning subprocesses on every probe
   */
  async checkSkillReadiness(): Promise<SkillReadinessResult> {
    const now = Date.now();
    if (this.cachedReadiness && (now - this.cachedReadinessTime) < READINESS_CACHE_TTL_MS) {
      return this.cachedReadiness;
    }

    const checks: SkillReadinessCheck[] = [];

    if (this.context) {
      // 1. Check skill scripts existence
      const skillNames = this.context.agentCore.getSkillRegistry().getAvailableSkills();
      const skillsDir = this.context.config.agent.skillsDir ?? "skills";
      for (const name of skillNames) {
        const scriptPath = `${skillsDir}/${name}/scripts/${name}.ts`;
        try {
          await Deno.stat(scriptPath);
          checks.push({ name: `scripts:${name}`, ready: true });
        } catch {
          checks.push({
            name: `scripts:${name}`,
            ready: false,
            message: `Script not found: ${scriptPath}`,
          });
        }
      }

      // 2. Check required binaries
      for (const bin of ["rg", "deno", "git"]) {
        try {
          const cmd = new Deno.Command(bin, {
            args: ["--version"],
            stdout: "null",
            stderr: "null",
          });
          const { success } = await cmd.output();
          if (success) {
            checks.push({ name: `binary:${bin}`, ready: true });
          } else {
            checks.push({
              name: `binary:${bin}`,
              ready: false,
              message: `${bin} exited with non-zero status`,
            });
          }
        } catch {
          checks.push({ name: `binary:${bin}`, ready: false, message: `${bin} not found in PATH` });
        }
      }

      // 3. Check Skill API Server connectivity
      if (this.context.config.skillApi?.enabled) {
        const port = this.context.config.skillApi.port;
        const host = this.context.config.skillApi.host || "localhost";
        try {
          const resp = await fetch(`http://${host}:${port}/`, {
            signal: AbortSignal.timeout(2000),
          });
          await resp.body?.cancel();
          checks.push({ name: "skill-api", ready: true });
        } catch {
          checks.push({
            name: "skill-api",
            ready: false,
            message: `Skill API not reachable at ${host}:${port}`,
          });
        }
      }

      // 4. Check workspace directory writability
      const repoPath = this.context.config.workspace.repoPath;
      try {
        const testFile = `${repoPath}/.healthcheck_write_test_${now}`;
        await Deno.writeTextFile(testFile, "");
        await Deno.remove(testFile);
        checks.push({ name: "workspace:writable", ready: true });
      } catch {
        checks.push({
          name: "workspace:writable",
          ready: false,
          message: `Workspace directory not writable: ${repoPath}`,
        });
      }
    }

    // Update Prometheus gauges
    for (const check of checks) {
      skillReadinessGauge.labels({ skill: check.name }).set(check.ready ? 1 : 0);
    }

    const result: SkillReadinessResult = {
      allReady: checks.every((c) => c.ready),
      checks,
    };

    this.cachedReadiness = result;
    this.cachedReadinessTime = now;

    return result;
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
