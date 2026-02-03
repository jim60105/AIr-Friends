// src/platforms/index.ts

export { PlatformAdapter } from "./platform-adapter.ts";
export { ConnectionManager, type RetryConfig } from "./connection-manager.ts";
export {
  getPlatformRegistry,
  PlatformRegistry,
  resetPlatformRegistry,
} from "./platform-registry.ts";
