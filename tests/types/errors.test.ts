// tests/types/errors.test.ts

import { assertEquals, assertInstanceOf } from "@std/assert";
import { BaseError, ConfigError, ErrorCode, PlatformError } from "@types/errors.ts";

Deno.test("ConfigError - should have correct properties", () => {
  const error = new ConfigError(
    ErrorCode.CONFIG_NOT_FOUND,
    "Config file not found",
    { path: "/path/to/config.yaml" },
  );

  assertInstanceOf(error, BaseError);
  assertEquals(error.code, ErrorCode.CONFIG_NOT_FOUND);
  assertEquals(error.message, "Config file not found");
  assertEquals(error.isRetryable, false);
  assertEquals(error.context?.path, "/path/to/config.yaml");
});

Deno.test("PlatformError - connection error should be retryable", () => {
  const error = new PlatformError(
    ErrorCode.PLATFORM_CONNECTION_FAILED,
    "Failed to connect to Discord",
  );

  assertEquals(error.isRetryable, true);
});

Deno.test("PlatformError - auth error should not be retryable", () => {
  const error = new PlatformError(
    ErrorCode.PLATFORM_AUTH_FAILED,
    "Invalid token",
  );

  assertEquals(error.isRetryable, false);
});

Deno.test("BaseError - toJSON should serialize properly", () => {
  const error = new ConfigError(
    ErrorCode.CONFIG_INVALID,
    "Invalid YAML syntax",
    { line: 42 },
  );

  const json = error.toJSON();
  assertEquals(json.name, "ConfigError");
  assertEquals(json.code, ErrorCode.CONFIG_INVALID);
  assertEquals(json.message, "Invalid YAML syntax");
  assertEquals((json.context as Record<string, unknown>).line, 42);
  assertEquals(typeof json.timestamp, "string");
});
