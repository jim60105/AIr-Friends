/**
 * ACP transport suite: the pinned real `opencode` and `omp` executables are the
 * agent side of the ACP connection, with a Bun parent driving the proof-of-concept
 * spawn boundary (migration design section 8 step 2, criteria ACP-01, 02, 03, 09
 * and 10). The model provider is a scripted loopback server, so a run contacts no
 * model provider and needs no credentials. Every title starts with the criterion
 * ID the gate matches.
 */
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AgentKind } from "../acp/agents.ts";
import { type AcpRun, startRun } from "../acp/driver.ts";
import {
  type LoopbackProvider,
  printableText,
  type ProviderScript,
  startLoopbackProvider,
} from "../acp/loopback-provider.ts";
import { descendantsOf, isAlive, readEnviron, waitForChild } from "../process/proc-tree.ts";

const MIB = 1024 * 1024;
const LARGE_OUTPUT_BYTES = 16 * MIB;
const LARGE_OUTPUT_CHUNK_BYTES = 262144;
const LARGE_PROMPT_BYTES = MIB;
const SMALL_REPLY_BYTES = 16;
const ENVIRON_RETRY_MS = 1000;

/** The pinned agents, in the order of the gate's criterion suffixes. */
const AGENTS: readonly (readonly [AgentKind, string])[] = [["opencode", "OC"], ["omp", "OMP"]];

/** Parent-only secrets that must never reach an agent process. */
const SENTINELS: Readonly<Record<string, string>> = {
  AIR_POC_SECRET_TOKEN: "poc-sentinel-air-token",
  DISCORD_TOKEN: "poc-sentinel-discord-token",
  OPENROUTER_API_KEY: "poc-sentinel-openrouter-key",
  SKILL_API_SECRET: "poc-sentinel-skill-secret",
};

let provider: LoopbackProvider | null = null;
let run: AcpRun | null = null;
/** PIDs a test proved alive after teardown; killed here. */
const survivors = new Set<number>();

afterEach(async () => {
  for (const name of Object.keys(SENTINELS)) delete process.env[name];
  const current = run;
  run = null;
  if (current !== null) await current.stop();
  provider?.stop();
  provider = null;
  for (const pid of survivors) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Best effort: the PID was already reaped.
    }
  }
  survivors.clear();
});

/**
 * Starts the provider with the test's script, then the agent, then waits for
 * `dumb-init`'s fork. The script is installed before the spawn so a pin that
 * asks the provider anything during the handshake cannot hang on the default.
 */
async function start(
  kind: AgentKind,
  script: ProviderScript,
): Promise<{ provider: LoopbackProvider; run: AcpRun }> {
  const startedProvider = startLoopbackProvider(kind);
  startedProvider.setScript(script);
  provider = startedProvider;
  const startedRun = await startRun(kind);
  run = startedRun;
  await waitForChild(startedRun.handle.pid);
  return { provider: startedProvider, run: startedRun };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Reads a descendant's environment, retrying briefly: `/proc/<pid>/environ` can
 * read empty in the window between `fork` and a completed `execve`.
 */
async function waitForEnviron(pid: number): Promise<Record<string, string>> {
  const deadline = Date.now() + ENVIRON_RETRY_MS;
  for (;;) {
    let environment: Record<string, string> = {};
    let failure: unknown;
    try {
      environment = readEnviron(pid);
    } catch (error) {
      failure = error;
    }
    if (Object.keys(environment).length > 0) return environment;
    if (Date.now() >= deadline) {
      if (failure !== undefined) throw failure;
      return environment;
    }
    await Bun.sleep(5);
  }
}

async function acp01(kind: AgentKind): Promise<void> {
  const text = printableText(1024, 7);
  const started = await start(kind, { kind: "text", text, chunkBytes: 64 });
  const response = await started.run.promptOrCrash("poc handshake");
  expect(response.stopReason).toBe("end_turn");
  expect(started.run.text()).toBe(text);
}

async function acp02(kind: AgentKind): Promise<void> {
  const text = printableText(LARGE_OUTPUT_BYTES, 0);
  const started = await start(kind, {
    kind: "text",
    text,
    chunkBytes: LARGE_OUTPUT_CHUNK_BYTES,
  });
  const response = await started.run.promptOrCrash("poc large output");
  expect(response.stopReason).toBe("end_turn");
  const received = started.run.text();
  expect(Buffer.byteLength(received, "utf8")).toBe(LARGE_OUTPUT_BYTES);
  expect(sha256(received)).toBe(sha256(text));
}

async function acp03(kind: AgentKind): Promise<void> {
  const prompt = printableText(LARGE_PROMPT_BYTES, 23);
  const started = await start(kind, {
    kind: "text",
    text: printableText(SMALL_REPLY_BYTES, 5),
    chunkBytes: SMALL_REPLY_BYTES,
  });
  const response = await started.run.promptOrCrash(prompt);
  expect(response.stopReason).toBe("end_turn");
  const delivered = started.provider.requests().some((request) =>
    request.path === "/v1/chat/completions" && request.body.includes(prompt)
  );
  expect(delivered).toBe(true);
}

async function acp09(kind: AgentKind): Promise<void> {
  for (const [name, value] of Object.entries(SENTINELS)) process.env[name] = value;
  // No prompt is sent here; a benign script only keeps an early handshake
  // request from stalling.
  const started = await start(kind, {
    kind: "text",
    text: printableText(SMALL_REPLY_BYTES, 0),
    chunkBytes: SMALL_REPLY_BYTES,
  });

  const tree = descendantsOf(started.run.handle.pid);
  expect(tree.length).toBeGreaterThan(0);
  for (const pid of tree) {
    const environment = await waitForEnviron(pid);
    for (const name of Object.keys(SENTINELS)) {
      expect(Object.hasOwn(environment, name)).toBe(false);
    }
    const values = Object.values(environment);
    for (const value of Object.values(SENTINELS)) {
      expect(values.includes(value)).toBe(false);
    }
    expect(environment.PATH).toBe(started.run.env.PATH);
    expect(environment.HOME).toBe(started.run.env.HOME);
  }
}

async function acp10(kind: AgentKind): Promise<void> {
  const started = await start(kind, {
    kind: "text",
    text: printableText(64, 3),
    chunkBytes: 64,
  });
  const response = await started.run.promptOrCrash("poc teardown");
  expect(response.stopReason).toBe("end_turn");

  const descendants = descendantsOf(started.run.handle.pid);
  expect(descendants.length).toBeGreaterThan(0);
  const recorded = [started.run.handle.pid, ...descendants];
  await started.run.stop();

  const alive = recorded.filter((pid) => isAlive(pid));
  for (const pid of alive) survivors.add(pid);
  expect(alive).toEqual([]);
}

/** Criterion suffix, title description and body; ACP-01 stays first for both agents. */
const CASES: readonly (readonly [string, string, (kind: AgentKind) => Promise<void>])[] = [
  ["01", "handshake, session and prompt end with end_turn and the scripted text", acp01],
  ["02", "16 MiB of agent output arrives byte-identical by SHA-256", acp02],
  ["03", "a 1 MiB prompt reaches the provider intact", acp03],
  ["09", "the agent tree holds PATH and HOME and no parent sentinel", acp09],
  ["10", "SIGTERM teardown leaves no process of the agent tree alive", acp10],
];

for (const [id, description, body] of CASES) {
  for (const [kind, tag] of AGENTS) {
    test(`ACP-${id}-${tag}: ${description}`, () => body(kind));
  }
}
