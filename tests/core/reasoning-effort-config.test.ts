// tests/core/reasoning-effort-config.test.ts

import { assertEquals } from "@std/assert";
import {
  KNOWN_REASONING_EFFORTS,
  loadConfig,
  normalizeReasoningEffort,
} from "@core/config-loader.ts";
import { KNOWN_REASONING_EFFORT_TOKENS } from "@acp/session-config.ts";
import fsp from "node:fs/promises";
import { test } from "bun:test";
import { makeTempDir } from "../../src/utils/fs-compat.ts";

// --- normalizeReasoningEffort (pure function) ---

test("normalizeReasoningEffort - undefined stays undefined", () => {
  assertEquals(normalizeReasoningEffort(undefined, "f"), undefined);
});

test("normalizeReasoningEffort - null stays undefined", () => {
  assertEquals(normalizeReasoningEffort(null, "f"), undefined);
});

test("normalizeReasoningEffort - trims and lowercases known value", () => {
  assertEquals(normalizeReasoningEffort("  Medium  ", "f"), "medium");
});

test("normalizeReasoningEffort - empty/whitespace becomes default", () => {
  assertEquals(normalizeReasoningEffort("", "f"), "default");
  assertEquals(normalizeReasoningEffort("   ", "f"), "default");
});

test("normalizeReasoningEffort - all known values accepted", () => {
  for (const v of ["none", "low", "medium", "high", "xhigh", "max", "default"]) {
    assertEquals(normalizeReasoningEffort(v, "f"), v);
    assertEquals(normalizeReasoningEffort(v.toUpperCase(), "f"), v);
  }
});

test("normalizeReasoningEffort - extended levels accepted without warning", () => {
  // No warning is emitted; values normalize to lowercase. (Warnings would surface
  // as unhandled log calls only in integration tests; pure-function equality is the gate here.)
  assertEquals(normalizeReasoningEffort("xhigh", "f"), "xhigh");
  assertEquals(normalizeReasoningEffort(" XHigh ", "f"), "xhigh");
  assertEquals(normalizeReasoningEffort("max", "f"), "max");
  assertEquals(normalizeReasoningEffort("  MAX  ", "f"), "max");
});

test("normalizeReasoningEffort - unknown token passthrough preserves trimmed", () => {
  assertEquals(normalizeReasoningEffort("  Ultra  ", "f"), "Ultra");
});

test("known reasoning-effort lists stay consistent (no drift)", () => {
  // KNOWN_REASONING_EFFORT_TOKENS (application gate) must equal
  // KNOWN_REASONING_EFFORTS (config normalization) minus the "default" sentinel,
  // which short-circuits earlier in setReasoningEffort().
  const expected = KNOWN_REASONING_EFFORTS.filter((v) => v !== "default");
  assertEquals([...KNOWN_REASONING_EFFORT_TOKENS].sort(), [...expected].sort());
});

test("normalizeReasoningEffort - non-string coerced to default", () => {
  assertEquals(normalizeReasoningEffort(42, "f"), "default");
});

// --- loadConfig integration ---

const baseConfig = `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;

/** Build a config where the agent block contains the given extra YAML lines (2-space indented). */
function configWithAgentExtra(agentExtra: string): string {
  return `
platforms:
  discord:
    token: "test-token"
    enabled: true
agent:
  model: "gpt-4"
  systemPromptPath: "./prompts/system_reply.md"
${agentExtra}
workspace:
  repoPath: "./data"
  workspacesDir: "workspaces"
`;
}

async function withTestConfig(
  configContent: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await makeTempDir();
  try {
    await fsp.writeFile(`${dir}/config.yaml`, configContent);
    await fsp.mkdir(`${dir}/prompts`, { recursive: true });
    await fsp.writeFile(`${dir}/prompts/system_reply.md`, "test");
    await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true });
  }
}

test("loadConfig - global reasoningEffort defaults to 'default'", async () => {
  await withTestConfig(baseConfig, async (dir) => {
    const config = await loadConfig(dir);
    assertEquals(config.agent.reasoningEffort, "default");
  });
});

test("loadConfig - global reasoningEffort normalized", async () => {
  await withTestConfig(
    configWithAgentExtra(`  reasoningEffort: "  High  "`),
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.agent.reasoningEffort, "high");
    },
  );
});

test("loadConfig - AGENT_REASONING_EFFORT env overrides global", async () => {
  await withTestConfig(
    configWithAgentExtra(`  reasoningEffort: "high"`),
    async (dir) => {
      process.env["AGENT_REASONING_EFFORT"] = "low";
      try {
        const config = await loadConfig(dir);
        assertEquals(config.agent.reasoningEffort, "low");
      } finally {
        delete process.env["AGENT_REASONING_EFFORT"];
      }
    },
  );
});

test("loadConfig - per-section reasoningEffort normalized; omitted stays undefined", async () => {
  await withTestConfig(
    baseConfig + `
selfResearch:
  enabled: false
  model: "gpt-4"
  reasoningEffort: "HIGH"
memoryMaintenance:
  enabled: false
  model: "gpt-4"
conversationSummary:
  enabled: true
  reasoningEffort: "low"
`,
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.selfResearch?.reasoningEffort, "high");
      // memoryMaintenance omitted -> undefined (falls through in resolution)
      assertEquals(config.memoryMaintenance?.reasoningEffort, undefined);
      assertEquals(config.conversationSummary?.reasoningEffort, "low");
    },
  );
});

test("loadConfig - extended levels normalized at global, section, and rule levels", async () => {
  await withTestConfig(
    configWithAgentExtra(`  reasoningEffort: "  XHigh  "
  modelRouting:
    enabled: true
    rules:
      - match: { sessionType: "message" }
        model: "m1"
        reasoningEffort: "MAX"`) + `
selfResearch:
  enabled: false
  model: "gpt-4"
  reasoningEffort: "max"
memoryMaintenance:
  enabled: false
  model: "gpt-4"
  reasoningEffort: "xhigh"`,
    async (dir) => {
      const config = await loadConfig(dir);
      // Global: mixed-case "XHigh" normalizes to lowercase (passthrough would keep "XHigh").
      assertEquals(config.agent.reasoningEffort, "xhigh");
      // Section fields.
      assertEquals(config.selfResearch?.reasoningEffort, "max");
      assertEquals(config.memoryMaintenance?.reasoningEffort, "xhigh");
      // Per-rule "MAX" normalizes to lowercase.
      const rules = config.agent.modelRouting?.rules ?? [];
      assertEquals(rules.length, 1);
      assertEquals(rules[0].reasoningEffort, "max");
    },
  );
});

test("loadConfig - per-rule reasoningEffort normalized and rule kept", async () => {
  await withTestConfig(
    configWithAgentExtra(`  modelRouting:
    enabled: true
    rules:
      - match: { sessionType: "message" }
        model: "m1"
        reasoningEffort: "  Medium  "
      - match: { sessionType: "spontaneous" }
        model: "m2"`),
    async (dir) => {
      const config = await loadConfig(dir);
      const rules = config.agent.modelRouting?.rules ?? [];
      assertEquals(rules.length, 2);
      assertEquals(rules[0].reasoningEffort, "medium");
      // omitted per-rule effort stays undefined
      assertEquals(rules[1].reasoningEffort, undefined);
    },
  );
});

test("loadConfig - non-standard per-rule reasoningEffort keeps rule (passthrough)", async () => {
  await withTestConfig(
    configWithAgentExtra(`  modelRouting:
    enabled: true
    rules:
      - match: { sessionType: "message" }
        model: "m1"
        reasoningEffort: "ultra"`),
    async (dir) => {
      const config = await loadConfig(dir);
      const rules = config.agent.modelRouting?.rules ?? [];
      assertEquals(rules.length, 1);
      assertEquals(rules[0].reasoningEffort, "ultra");
    },
  );
});

test("loadConfig - per-rule reasoningEffort survives MODEL_ROUTING_RULES JSON", async () => {
  await withTestConfig(baseConfig, async (dir) => {
    process.env["MODEL_ROUTING_ENABLED"] = "true";
    process.env["MODEL_ROUTING_RULES"] = JSON.stringify([
      { match: { sessionType: "message" }, model: "m1", reasoningEffort: "ultra" },
    ]);
    try {
      const config = await loadConfig(dir);
      const rules = config.agent.modelRouting?.rules ?? [];
      assertEquals(rules.length, 1);
      assertEquals(rules[0].reasoningEffort, "ultra");
    } finally {
      delete process.env["MODEL_ROUTING_ENABLED"];
      delete process.env["MODEL_ROUTING_RULES"];
    }
  });
});

test("loadConfig - extended levels survive MODEL_ROUTING_RULES JSON normalized lowercase", async () => {
  await withTestConfig(baseConfig, async (dir) => {
    process.env["MODEL_ROUTING_ENABLED"] = "true";
    process.env["MODEL_ROUTING_RULES"] = JSON.stringify([
      { match: { sessionType: "message" }, model: "m1", reasoningEffort: "XHigh" },
      { match: { sessionType: "spontaneous" }, model: "m2", reasoningEffort: "MAX" },
    ]);
    try {
      const config = await loadConfig(dir);
      const rules = config.agent.modelRouting?.rules ?? [];
      assertEquals(rules.length, 2);
      // Normalized to lowercase (a passthrough would preserve "XHigh"/"MAX").
      assertEquals(rules[0].reasoningEffort, "xhigh");
      assertEquals(rules[1].reasoningEffort, "max");
    } finally {
      delete process.env["MODEL_ROUTING_ENABLED"];
      delete process.env["MODEL_ROUTING_RULES"];
    }
  });
});
