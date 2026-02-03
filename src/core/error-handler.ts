// src/core/error-handler.ts

import { createLogger } from "@utils/logger.ts";
import { BaseError } from "@types/errors.ts";

const logger = createLogger("ErrorHandler");

export interface ErrorHandlerOptions {
  onFatalError?: (error: Error) => void;
  enableGracefulShutdown?: boolean;
}

let isShuttingDown = false;

export function setupGlobalErrorHandler(options: ErrorHandlerOptions = {}): void {
  // Handle unhandled promise rejections
  globalThis.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    const error = event.reason;

    if (error instanceof BaseError) {
      logger.error("Unhandled promise rejection", {
        ...error.toJSON(),
        stack: error.stack,
      });
    } else {
      logger.error("Unhandled promise rejection", {
        message: error?.message ?? String(error),
        stack: error?.stack,
      });
    }
  });

  // Handle uncaught errors
  globalThis.addEventListener("error", (event) => {
    event.preventDefault();
    const error = event.error;

    logger.fatal("Uncaught error", {
      message: error?.message ?? event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: error?.stack,
    });

    if (options.onFatalError) {
      options.onFatalError(error);
    }
  });

  // Handle SIGTERM for graceful shutdown
  if (options.enableGracefulShutdown) {
    Deno.addSignalListener("SIGTERM", () => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.info("Received SIGTERM, initiating graceful shutdown");
      // Allow other modules to register their shutdown handlers
      globalThis.dispatchEvent(new CustomEvent("shutdown"));
    });

    Deno.addSignalListener("SIGINT", () => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.info("Received SIGINT, initiating graceful shutdown");
      globalThis.dispatchEvent(new CustomEvent("shutdown"));
    });
  }
}

// Helper to safely execute async operations with error logging
export async function safeExecute<T>(
  operation: () => Promise<T>,
  context: { module: string; action: string },
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const log = createLogger(context.module);

    if (error instanceof BaseError) {
      log.error(`Failed to ${context.action}`, error.toJSON());
    } else {
      log.error(`Failed to ${context.action}`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    return null;
  }
}

// Check if shutdown is in progress
export function isGracefulShutdownInProgress(): boolean {
  return isShuttingDown;
}
