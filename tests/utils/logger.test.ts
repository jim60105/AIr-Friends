// tests/utils/logger.test.ts

import { assertEquals, assertStringIncludes } from "@std/assert";
import { Logger, LogLevel } from "@utils/logger.ts";
import type { LogEntry } from "../../src/types/logger.ts";

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

Deno.test("Logger - sends log entries to GELF transport when configured", () => {
  const sentEntries: LogEntry[] = [];
  const mockTransport = {
    send(entry: LogEntry) {
      sentEntries.push(entry);
    },
  };

  const originalLog = console.log;
  console.log = () => {};

  try {
    const logger = new Logger("TestModule", {
      level: LogLevel.DEBUG,
      gelfTransport: mockTransport,
    });

    logger.info("Hello GELF", { key: "value" });

    assertEquals(sentEntries.length, 1);
    assertEquals(sentEntries[0].message, "Hello GELF");
    assertEquals(sentEntries[0].module, "TestModule");
    assertEquals(sentEntries[0].level, "INFO");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - child logger inherits GELF transport", () => {
  const sentEntries: LogEntry[] = [];
  const mockTransport = {
    send(entry: LogEntry) {
      sentEntries.push(entry);
    },
  };

  const originalLog = console.log;
  console.log = () => {};

  try {
    const parent = new Logger("Parent", {
      level: LogLevel.DEBUG,
      gelfTransport: mockTransport,
    });
    const child = parent.child("Child");

    child.warn("Child message");

    assertEquals(sentEntries.length, 1);
    assertEquals(sentEntries[0].module, "Parent:Child");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - does not send to GELF when level is below threshold", () => {
  const sentEntries: LogEntry[] = [];
  const mockTransport = {
    send(entry: LogEntry) {
      sentEntries.push(entry);
    },
  };

  const originalLog = console.log;
  console.log = () => {};

  try {
    const logger = new Logger("TestModule", {
      level: LogLevel.WARN,
      gelfTransport: mockTransport,
    });

    logger.debug("Should not be sent");
    logger.info("Should not be sent either");
    logger.warn("This should be sent");

    assertEquals(sentEntries.length, 1);
    assertEquals(sentEntries[0].level, "WARN");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - renders message template with context values", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.DEBUG });
    logger.info("Session {sessionId} created", { sessionId: "ses_123" });

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.message, "Session ses_123 created");
    assertEquals(entry.messageTemplate, "Session {sessionId} created");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - preserves unmatched placeholders", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.DEBUG });
    logger.info("User {userId} on {platform}", { userId: "abc" });

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.message, "User abc on {platform}");
    assertEquals(entry.messageTemplate, "User {userId} on {platform}");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - handles escaped braces", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.DEBUG });
    logger.info("Use {{braces}} for {name}", { name: "test" });

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.message, "Use {braces} for test");
    assertEquals(entry.messageTemplate, "Use {{braces}} for {name}");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - no messageTemplate when no placeholders", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.DEBUG });
    logger.info("Simple message", { key: "val" });

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.message, "Simple message");
    assertEquals(entry.messageTemplate, undefined);
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - handles object values in template", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.DEBUG });
    logger.info("Cost: {cost}", { cost: { amount: 0.13, currency: "USD" } });

    const entry = JSON.parse(logs[0]);
    assertStringIncludes(entry.message, '{"amount":0.13,"currency":"USD"}');
    assertEquals(entry.messageTemplate, "Cost: {cost}");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - handles null/undefined values in template", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const logger = new Logger("TestModule", { level: LogLevel.DEBUG });
    logger.info("Value: {val}", { val: null });

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.message, "Value: ");
    assertEquals(entry.messageTemplate, "Value: {val}");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - sends messageTemplate to GELF transport", () => {
  const sentEntries: LogEntry[] = [];
  const mockTransport = {
    send(entry: LogEntry) {
      sentEntries.push(entry);
    },
  };

  const originalLog = console.log;
  console.log = () => {};

  try {
    const logger = new Logger("TestModule", {
      level: LogLevel.DEBUG,
      gelfTransport: mockTransport,
    });

    logger.info("Session {sessionId} model set to {modelId}", {
      sessionId: "ses_abc",
      modelId: "gpt-4",
    });

    assertEquals(sentEntries.length, 1);
    assertEquals(sentEntries[0].message, "Session ses_abc model set to gpt-4");
    assertEquals(
      sentEntries[0].messageTemplate,
      "Session {sessionId} model set to {modelId}",
    );
  } finally {
    console.log = originalLog;
  }
});

// withContext() tests

Deno.test("Logger - withContext() adds default context to all log calls", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const base = new Logger("TestModule", { level: LogLevel.DEBUG });
    const tracked = base.withContext({ sessionId: "sess_123" });
    tracked.info("test message");

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.context.sessionId, "sess_123");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - withContext() merges with call-site context", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const tracked = new Logger("TestModule", { level: LogLevel.DEBUG })
      .withContext({ sessionId: "sess_123" });
    tracked.info("test", { userId: "user_456" });

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.context.sessionId, "sess_123");
    assertEquals(entry.context.userId, "user_456");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - withContext() call-site context takes precedence", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const tracked = new Logger("TestModule", { level: LogLevel.DEBUG })
      .withContext({ sessionId: "default" });
    tracked.info("test", { sessionId: "override" });

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.context.sessionId, "override");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - withContext() chained calls merge all fields", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const tracked = new Logger("TestModule", { level: LogLevel.DEBUG })
      .withContext({ a: 1 })
      .withContext({ b: 2 });
    tracked.info("test");

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.context.a, 1);
    assertEquals(entry.context.b, 2);
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - child() inherits defaultContext", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const tracked = new Logger("Parent", { level: LogLevel.DEBUG })
      .withContext({ sessionId: "sess_123" });
    const child = tracked.child("Sub");
    child.info("child message");

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.module, "Parent:Sub");
    assertEquals(entry.context.sessionId, "sess_123");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - withContext() works with message templates", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const tracked = new Logger("TestModule", { level: LogLevel.DEBUG })
      .withContext({ sessionId: "sess_123" });
    tracked.info("Session {sessionId} started");

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.message, "Session sess_123 started");
    assertEquals(entry.messageTemplate, "Session {sessionId} started");
  } finally {
    console.log = originalLog;
  }
});

Deno.test("Logger - empty defaultContext does not affect existing behavior", () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (msg: string) => logs.push(msg);

  try {
    const base = new Logger("TestModule", { level: LogLevel.DEBUG });
    base.info("test");

    const entry = JSON.parse(logs[0]);
    assertEquals(entry.context, undefined);
  } finally {
    console.log = originalLog;
  }
});
