// src/shutdown.ts

import type { AppContext } from "./bootstrap.ts";
import { createLogger } from "@utils/logger.ts";

const logger = createLogger("Shutdown");

/**
 * Graceful shutdown handler
 */
export class ShutdownHandler {
  private context: AppContext | null = null;
  private isShuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  /**
   * Set the application context
   */
  setContext(context: AppContext): void {
    this.context = context;
  }

  /**
   * Register signal handlers
   */
  registerSignalHandlers(): void {
    const handler = () => {
      this.shutdown();
    };

    Deno.addSignalListener("SIGTERM", handler);
    Deno.addSignalListener("SIGINT", handler);

    logger.info("Signal handlers registered");
  }

  /**
   * Perform graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.info("Shutdown already in progress");
      return this.shutdownPromise!;
    }

    this.isShuttingDown = true;
    logger.info("Starting graceful shutdown");

    this.shutdownPromise = this.performShutdown();
    await this.shutdownPromise;
  }

  /**
   * Internal shutdown logic
   */
  private async performShutdown(): Promise<void> {
    if (!this.context) {
      logger.warn("No context to shutdown");
      Deno.exit(0);
      return;
    }

    const { platformRegistry, agentCore, healthCheckServer } = this.context;

    try {
      // Stop health check server first
      if (healthCheckServer) {
        logger.info("Stopping health check server");
        await healthCheckServer.stop();
      }

      // Stop spontaneous scheduler before disconnecting platforms
      if (this.context.spontaneousScheduler) {
        logger.info("Stopping spontaneous scheduler");
        this.context.spontaneousScheduler.stop();
      }

      // Stop self-research scheduler
      if (this.context.selfResearchScheduler) {
        logger.info("Stopping self-research scheduler");
        this.context.selfResearchScheduler.stop();
      }

      if (this.context.memoryMaintenanceScheduler) {
        logger.info("Stopping memory maintenance scheduler");
        this.context.memoryMaintenanceScheduler.stop();
      }

      // Stop reminder scheduler
      if (this.context.reminderScheduler) {
        logger.info("Stopping reminder scheduler");
        this.context.reminderScheduler.stop();
      }

      // Stop git backup scheduler and perform final backup
      if (this.context.gitBackupScheduler) {
        logger.info("Stopping git backup scheduler");
        this.context.gitBackupScheduler.stop();
      }

      if (this.context.gitBackupService) {
        logger.info("Performing final git backup before shutdown");
        try {
          await this.context.gitBackupService.performBackup();
        } catch (error) {
          logger.error("Final git backup failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Shutdown agent core (stops skill API server, session registry)
      logger.info("Shutting down agent core");
      await agentCore.shutdown();

      // Disconnect all platforms
      logger.info("Disconnecting platforms");
      await platformRegistry.disconnectAll();

      logger.info("Graceful shutdown completed");
      Deno.exit(0);
    } catch (error) {
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
      Deno.exit(1);
    }
  }

  /**
   * Check if shutdown is in progress
   */
  isShutdownInProgress(): boolean {
    return this.isShuttingDown;
  }
}

// Global shutdown handler instance
export const shutdownHandler = new ShutdownHandler();
