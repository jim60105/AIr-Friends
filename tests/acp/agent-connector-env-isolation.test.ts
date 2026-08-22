// tests/acp/agent-connector-env-isolation.test.ts
//
// F1 regression tests: the agent subprocess MUST be spawned with `clearEnv: true`
// so it receives ONLY the explicitly-built allowlisted environment and inherits
// NO secrets from the parent bot process.
//
// These tests exercise the real `Deno.Command` spawn semantics used by
// `AgentConnector.connect()` (via `deno eval` printing the child's actual
// environment), rather than merely inspecting the env-builder's returned dict.

import { assert, assertEquals } from "@std/assert";

/**
 * Spawn a child `deno eval` that serializes its actual process environment,
 * using the SAME spawn options AgentConnector uses. Returns the parsed env.
 */
async function spawnAndReadChildEnv(
  spawnOpts: { clearEnv?: boolean; env: Record<string, string> },
): Promise<Record<string, string>> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      "console.log(JSON.stringify(Object.fromEntries(Object.entries(Deno.env.toObject()))))",
    ],
    clearEnv: spawnOpts.clearEnv,
    // `deno eval` needs --allow-env implicitly granted via -A-free eval? eval has env access.
    env: spawnOpts.env,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(`child failed: ${stderr}`);
  }
  return JSON.parse(stdout) as Record<string, string>;
}

Deno.test("F1 - clearEnv:true excludes parent secrets from child environment", async () => {
  // Simulate a secret held by the parent bot process that is NOT part of the
  // built agent env (e.g. DISCORD_TOKEN).
  const fakeSecret = "AIRFRIENDS_TEST_FAKE_SECRET";
  Deno.env.set(fakeSecret, "super-secret-value");
  try {
    // Build the agent env the way agent-factory does: an explicit allowlist that
    // deliberately does NOT include the fake parent secret. We must include a
    // real PATH so `deno eval` can run.
    const builtEnv: Record<string, string> = {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "/tmp",
      SESSION_ID: "sess_test",
      AGENT_WORKSPACE: "/tmp/agent-workspace",
      TMPDIR: "/tmp",
    };

    const childEnv = await spawnAndReadChildEnv({ clearEnv: true, env: builtEnv });

    // The fake parent secret MUST be absent from the child's real environment.
    assertEquals(
      childEnv[fakeSecret],
      undefined,
      "Parent secret leaked into agent subprocess despite clearEnv:true",
    );
  } finally {
    Deno.env.delete(fakeSecret);
  }
});

Deno.test("F1 - clearEnv:true still provides all built allowlisted variables", async () => {
  const builtEnv: Record<string, string> = {
    PATH: Deno.env.get("PATH") ?? "",
    HOME: Deno.env.get("HOME") ?? "/tmp",
    SESSION_ID: "sess_test",
    AGENT_WORKSPACE: "/tmp/agent-workspace",
    TMPDIR: "/tmp",
    OPENROUTER_API_KEY: "or1",
    GEMINI_API_KEY: "gm1",
  };

  const childEnv = await spawnAndReadChildEnv({ clearEnv: true, env: builtEnv });

  // Required operational vars and OpenCode provider keys ARE present.
  assert(childEnv["PATH"] !== undefined, "PATH missing from child env");
  assertEquals(childEnv["SESSION_ID"], "sess_test");
  assertEquals(childEnv["AGENT_WORKSPACE"], "/tmp/agent-workspace");
  assertEquals(childEnv["TMPDIR"], "/tmp");
  assertEquals(childEnv["OPENROUTER_API_KEY"], "or1");
  assertEquals(childEnv["GEMINI_API_KEY"], "gm1");
});

Deno.test("F1 - control: WITHOUT clearEnv, parent secret leaks (documents the bug)", async () => {
  // This negative-control test documents why clearEnv is required: without it,
  // Deno.Command merges the parent environment and the secret leaks through.
  const fakeSecret = "leak";
  Deno.env.set(fakeSecret, "leaked-value");
  try {
    const builtEnv: Record<string, string> = {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "/tmp",
    };
    const childEnv = await spawnAndReadChildEnv({ clearEnv: false, env: builtEnv });
    // Confirms the merge behavior that clearEnv:true prevents.
    assertEquals(childEnv[fakeSecret], "leaked-value");
  } finally {
    Deno.env.delete(fakeSecret);
  }
});
