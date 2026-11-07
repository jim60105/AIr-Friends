/**
 * Launch fixtures for the two real agents the migration has to prove: a fresh
 * temporary root per spawn, a loopback-only model provider, and an environment
 * that carries nothing but the paths the agent needs. The parent environment is
 * never spread, so a parent secret cannot reach an agent (see
 * `process/agent-process.ts` for the spawn boundary itself).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProcessOptions } from "../process/agent-process.ts";
import { PROVIDER_BASE_URL } from "./loopback-provider.ts";

export type AgentKind = "opencode" | "omp";

/** The agents the ACP suites drive, in the order their tests run. */
export const AGENT_KINDS: readonly AgentKind[] = ["opencode", "omp"];

const FALLBACK_PATH = "/usr/local/bin:/usr/bin:/bin";

/** Design D2: OpenCode's config names the loopback provider as an OpenAI-compatible one. */
const OPENCODE_CONFIG = {
  $schema: "https://opencode.ai/config.json",
  autoupdate: false,
  share: "disabled",
  model: "poc/poc-model",
  provider: {
    poc: {
      npm: "@ai-sdk/openai-compatible",
      name: "poc",
      options: { baseURL: PROVIDER_BASE_URL, apiKey: "poc" },
      models: {
        "poc-model": {
          name: "poc-model",
          limit: { context: 1000000000, output: 1000000000 },
        },
      },
    },
  },
} as const;

/**
 * Design D2: OMP reads its provider registry from the inherited HOME. The
 * same oversized limits as OpenCode's config keep agent-side context
 * accounting from masking transport behavior.
 */
const OMP_MODELS_YAML = `providers:
  poc-fixture:
    baseUrl: ${PROVIDER_BASE_URL}
    auth: none
    api: openai-completions
    models:
      - id: poc-fixture
        name: poc-fixture
        reasoning: false
        input:
          - text
        contextWindow: 1000000000
        maxTokens: 1000000000
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
`;

/**
 * Builds a fresh root (`home/`, `data/`, `tmp/`, `work/`, and `config/` for
 * OpenCode) and the launch options that point at it. Every call yields a new
 * root, so no test inherits another's session state.
 */
export function prepareAgent(kind: AgentKind): AgentProcessOptions & { root: string } {
  const root = mkdtempSync(join(tmpdir(), `poc-acp-${kind}-`));
  for (const directory of ["home", "data", "tmp", "work"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? FALLBACK_PATH,
    HOME: join(root, "home"),
    XDG_DATA_HOME: join(root, "data"),
    TMPDIR: join(root, "tmp"),
  };

  if (kind === "opencode") {
    const configDirectory = join(root, "config", "opencode");
    mkdirSync(configDirectory, { recursive: true });
    env.XDG_CONFIG_HOME = join(root, "config");
    writeFileSync(
      join(configDirectory, "opencode.json"),
      `${JSON.stringify(OPENCODE_CONFIG, null, 2)}\n`,
    );
  } else {
    const agentDirectory = join(root, "home", ".omp", "agent");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(join(agentDirectory, "models.yml"), OMP_MODELS_YAML);
  }

  return { command: kind, args: ["acp"], cwd: join(root, "work"), env, root };
}
