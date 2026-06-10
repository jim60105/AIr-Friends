// tests/core/reasoning-effort-config.test.ts

import { assertEquals } from "@std/assert";
import { loadConfig, normalizeReasoningEffort } from "@core/config-loader.ts";

// --- normalizeReasoningEffort (pure function) ---

Deno.test("normalizeReasoningEffort - undefined stays undefined", () => {
  assertEquals(normalizeReasoningEffort(undefined, "f"), undefined);
});

Deno.test("normalizeReasoningEffort - null stays undefined", () => {
  assertEquals(normalizeReasoningEffort(null, "f"), undefined);
});

Deno.test("normalizeReasoningEffort - trims and lowercases known value", () => {
  assertEquals(normalizeReasoningEffort("  Medium  ", "f"), "medium");
});

Deno.test("normalizeReasoningEffort - empty/whitespace becomes default", () => {
  assertEquals(normalizeReasoningEffort("", "f"), "default");
  assertEquals(normalizeReasoningEffort("   ", "f"), "default");
});

Deno.test("normalizeReasoningEffort - all known values accepted", () => {
  for (const v of ["none", "low", "medium", "high", "default"]) {
    assertEquals(normalizeReasoningEffort(v, "f"), v);
    assertEquals(normalizeReasoningEffort(v.toUpperCase(), "f"), v);
  }
});

Deno.test("normalizeReasoningEffort - unknown token passthrough preserves trimmed", () => {
  assertEquals(normalizeReasoningEffort("  Ultra  ", "f"), "Ultra");
});

Deno.test("normalizeReasoningEffort - non-string coerced to default", () => {
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
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/config.yaml`, configContent);
    await Deno.mkdir(`${dir}/prompts`, { recursive: true });
    await Deno.writeTextFile(`${dir}/prompts/system_reply.md`, "test");
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("loadConfig - global reasoningEffort defaults to 'default'", async () => {
  await withTestConfig(baseConfig, async (dir) => {
    const config = await loadConfig(dir);
    assertEquals(config.agent.reasoningEffort, "default");
  });
});

Deno.test("loadConfig - global reasoningEffort normalized", async () => {
  await withTestConfig(
    configWithAgentExtra(`  reasoningEffort: "  High  "`),
    async (dir) => {
      const config = await loadConfig(dir);
      assertEquals(config.agent.reasoningEffort, "high");
    },
  );
});

Deno.test("loadConfig - AGENT_REASONING_EFFORT env overrides global", async () => {
  await withTestConfig(
    configWithAgentExtra(`  reasoningEffort: "high"`),
    async (dir) => {
      Deno.env.set("AGENT_REASONING_EFFORT", "low");
      try {
        const config = await loadConfig(dir);
        assertEquals(config.agent.reasoningEffort, "low");
      } finally {
        Deno.env.delete("AGENT_REASONING_EFFORT");
      }
    },
  );
});

Deno.test("loadConfig - per-section reasoningEffort normalized; omitted stays undefined", async () => {
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

Deno.test("loadConfig - per-rule reasoningEffort normalized and rule kept", async () => {
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

Deno.test("loadConfig - non-standard per-rule reasoningEffort keeps rule (passthrough)", async () => {
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

Deno.test("loadConfig - per-rule reasoningEffort survives MODEL_ROUTING_RULES JSON", async () => {
  await withTestConfig(baseConfig, async (dir) => {
    Deno.env.set("MODEL_ROUTING_ENABLED", "true");
    Deno.env.set(
      "MODEL_ROUTING_RULES",
      JSON.stringify([
        { match: { sessionType: "message" }, model: "m1", reasoningEffort: "ultra" },
      ]),
    );
    try {
      const config = await loadConfig(dir);
      const rules = config.agent.modelRouting?.rules ?? [];
      assertEquals(rules.length, 1);
      assertEquals(rules[0].reasoningEffort, "ultra");
    } finally {
      Deno.env.delete("MODEL_ROUTING_ENABLED");
      Deno.env.delete("MODEL_ROUTING_RULES");
    }
  });
});
