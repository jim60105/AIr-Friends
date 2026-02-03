// tests/utils/logger.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { Logger, LogLevel } from "@utils/logger.ts";

Deno.test("Logger - should output JSON format", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.DEBUG });
    logger.info("Test message");

    assertEquals(logs.length, 1);
    const entry = JSON.parse(logs[0]);
    assertEquals(entry.level, "INFO");
    assertEquals(entry.module, "TestModule");
    assertEquals(entry.message, "Test message");
    assertEquals(typeof entry.timestamp, "string");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - should respect log level", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.WARN });
    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");

    assertEquals(logs.length, 1);
    assertStringIncludes(logs[0], "WARN");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - should sanitize sensitive data", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.DEBUG });
    logger.info("Connection info", {
      token: "secret-token-value",
      host: "example.com",
    });

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.context.token, "[REDACTED]");
    assertEquals(entry.context.host, "example.com");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - should create child logger with module path", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const parent = new Logger("Parent", { level: LogLevel.DEBUG });
    const child = parent.child("Child");
    child.info("Child message");

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.module, "Parent:Child");
  } finally {
    console.log = originalLog;
  }
});
