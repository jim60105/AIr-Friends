// src/platforms/platform-registry.ts

import { createLogger } from "@utils/logger.ts";
import type { PlatformAdapter } from "./platform-adapter.ts";
import { ConnectionManager } from "./connection-manager.ts";
import type { NormalizedEvent, Platform } from "../types/events.ts";
import type { ConnectionStatus, EventHandler } from "../types/platform.ts";

const logger = createLogger("PlatformRegistry");

/**
 * Registry for managing multiple platform adapters
 */
export class PlatformRegistry {
  private readonly adapters = new Map<Platform, PlatformAdapter>();
  private readonly connectionManagers = new Map<Platform, ConnectionManager>();
  private readonly globalEventHandlers: EventHandler[] = [];

  /**
   * Register a platform adapter
   */
  register(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(`Platform ${adapter.platform} is already registered`);
    }

    this.adapters.set(adapter.platform, adapter);

    // Create connection manager for the adapter
    const connectionManager = new ConnectionManager(adapter);
    this.connectionManagers.set(adapter.platform, connectionManager);

    // Forward events to global handlers
    adapter.onEvent(async (event) => {
      await this.handleEvent(event);
    });

    logger.info("Platform registered", {
      platform: adapter.platform,
      capabilities: adapter.capabilities,
    });
  }

  /**
   * Get a registered adapter by platform
   */
  getAdapter(platform: Platform): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  /**
   * Get all registered adapters
   */
  getAllAdapters(): PlatformAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Register a global event handler (receives events from all platforms)
   */
  onEvent(handler: EventHandler): void {
    this.globalEventHandlers.push(handler);
  }

  /**
   * Handle an event from any platform
   */
  private async handleEvent(event: NormalizedEvent): Promise<void> {
    for (const handler of this.globalEventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        logger.error("Global event handler error", {
          platform: event.platform,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Connect all registered platforms
   */
  async connectAll(): Promise<void> {
    logger.info("Connecting all platforms", {
      platforms: Array.from(this.adapters.keys()),
    });

    const connectPromises: Promise<void>[] = [];

    for (const [platform, manager] of this.connectionManagers) {
      connectPromises.push(
        manager.connectWithRetry().catch((error) => {
          logger.error("Failed to connect platform", {
            platform,
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      );
    }

    await Promise.all(connectPromises);

    logger.info("All platforms connection initiated");
  }

  /**
   * Disconnect all platforms gracefully
   */
  async disconnectAll(): Promise<void> {
    logger.info("Disconnecting all platforms");

    const disconnectPromises: Promise<void>[] = [];

    for (const manager of this.connectionManagers.values()) {
      disconnectPromises.push(manager.disconnect());
    }

    await Promise.all(disconnectPromises);

    logger.info("All platforms disconnected");
  }

  /**
   * Get connection status for all platforms
   */
  getStatus(): Map<Platform, ConnectionStatus> {
    const status = new Map<Platform, ConnectionStatus>();

    for (const [platform, adapter] of this.adapters) {
      status.set(platform, adapter.getConnectionStatus());
    }

    return status;
  }

  /**
   * Check if all platforms are connected
   */
  isAllConnected(): boolean {
    for (const adapter of this.adapters.values()) {
      const status = adapter.getConnectionStatus();
      if (status.state !== "connected") {
        return false;
      }
    }
    return true;
  }
}

// Singleton instance
let registry: PlatformRegistry | null = null;

/**
 * Get or create the platform registry singleton
 */
export function getPlatformRegistry(): PlatformRegistry {
  if (!registry) {
    registry = new PlatformRegistry();
  }
  return registry;
}

/**
 * Reset the registry (for testing)
 */
export function resetPlatformRegistry(): void {
  registry = null;
}
