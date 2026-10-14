/**
 * Child-process driver for the real pinned-native OMP probe
 * (`verify-omp-confined-native-runtime`).
 *
 * The probe must observe the PRODUCTION FACTORY and the NATIVE START in one
 * interval. The factory runs in the Deno process (it is not a subprocess), so
 * wrapping only the spawned command would leave factory filesystem operations unobserved.
 * This driver performs the shipped `createAgentConfig` construction AND the
 * whole real `AgentConnector` lifecycle inside one child process, which the
 * probe runs under `strace -f`: both the factory's own syscalls and every native
 * descendant are then observed by a single trace, and the production argv itself
 * is never wrapped.
 *
 * Contract: reads one JSON params file, writes one JSON result file, prints
 * nothing parseable on stdout (module loggers own stdout/stderr), and exits
 * non-zero on failure so the probe reports a real error rather than absence.
 */

import { createAgentConfig } from "../../src/acp/agent-factory.ts";
import { AgentConnector } from "../../src/acp/agent-connector.ts";
import { MemoryStore } from "../../src/core/memory-store.ts";
import { WorkspaceManager } from "../../src/core/workspace-manager.ts";
import { SkillRegistry } from "../../src/skills/registry.ts";
import { Logger, LogLevel } from "../../src/utils/logger.ts";
import type { AgentType } from "../../src/acp/types.ts";
import type { Config } from "../../src/types/config.ts";

/** Everything the driver needs: the real config plus the scenario identity. */
export interface DriverParams {
  readonly config: Config;
  readonly mode: "restricted" | "native-yolo";
  readonly workspace: string;
  readonly agentType: AgentType;
  readonly sessionId: string;
  /** The fixture's ACTUAL advertised selector (`provider/modelId`). */
  readonly fixtureModelSelector: string;
  /** A model id the fixture does not advertise (the catalog-miss control). */
  readonly unadvertisedModelId: string;
  readonly resultPath: string;
}

/** The driver's single result record. */
export interface DriverResult {
  readonly sessionId: string;
  readonly resumed: boolean;
  readonly catalogMissMessage: string;
  readonly dataRoot: string;
  readonly settingsPath: string;
  /** The read-only authored inputs the launch actually selected. */
  readonly authoredPaths: readonly string[];
}

/**
 * Boundary validation of the params file this driver is handed.
 *
 * Every field the driver itself reads is checked here with `typeof`; the nested
 * `config` is the probe's own factory configuration object (`probeConfig()`),
 * consumed verbatim by the shipped factory, which fails loudly on anything it
 * cannot use — so it is asserted once at this boundary rather than re-guarded.
 */
function asDriverParams(value: unknown): DriverParams | null {
  if (typeof value !== "object" || value === null) return null;
  const params = value as Record<string, unknown>;
  const { config, mode, workspace, agentType, sessionId, fixtureModelSelector } = params;
  const { unadvertisedModelId, resultPath } = params;
  if (typeof config !== "object" || config === null) return null;
  if (mode !== "restricted" && mode !== "native-yolo") return null;
  if (agentType !== "omp" && agentType !== "opencode") return null;
  const strings = [workspace, sessionId, fixtureModelSelector, unadvertisedModelId, resultPath];
  if (strings.some((field) => typeof field !== "string" || field === "")) return null;

  // Named unchecked cast at the boundary: the shape of `config` is the probe's
  // own factory configuration, and every consumer here (createAgentConfig and
  // the connector) fails loudly on a malformed value.
  const factoryConfig = config as Config;
  return {
    config: factoryConfig,
    mode,
    workspace: workspace as string,
    agentType,
    sessionId: sessionId as string,
    fixtureModelSelector: fixtureModelSelector as string,
    unadvertisedModelId: unadvertisedModelId as string,
    resultPath: resultPath as string,
  };
}

async function run(params: DriverParams): Promise<DriverResult> {
  const skillRegistry = new SkillRegistry(
    new MemoryStore(new WorkspaceManager(params.config.workspace), {}),
  );
  const agentConfig = createAgentConfig(
    params.agentType,
    params.workspace,
    params.config,
    params.mode === "native-yolo",
    undefined,
    params.sessionId,
  );
  const connector = new AgentConnector({
    agentConfig,
    clientConfig: {
      workingDir: params.workspace,
      platform: "discord",
      userId: "user",
      channelId: "channel",
      isDM: false,
      yolo: params.mode === "native-yolo",
    },
    skillRegistry,
    logger: new Logger("omp-native-lifecycle-driver", { level: LogLevel.FATAL }),
    agentType: params.agentType,
  });

  try {
    await connector.connect();
    const sessionId = await connector.createSession([], params.workspace);

    // Negative control: an unadvertised id must be rejected, which also captures
    // the REAL advertised catalog in the rejection message.
    let catalogMissMessage = "";
    try {
      await connector.setSessionModel(sessionId, params.unadvertisedModelId);
    } catch (error) {
      catalogMissMessage = error instanceof Error ? error.message : String(error);
    }

    // Positive selection of the fixture model from that same advertised catalog.
    await connector.setSessionModel(sessionId, params.fixtureModelSelector);
    await connector.cancel(sessionId);

    // Respawn + `session/load`, with no OMP ownership or gate payload supplied.
    const resumed = await connector.reconnectAndResumeSession(sessionId, params.workspace, []);

    const settingsIndex = agentConfig.args.indexOf("--config");
    const flagValue = (flag: string): string | undefined => {
      const index = agentConfig.args.indexOf(flag);
      return index === -1 ? undefined : agentConfig.args[index + 1];
    };
    const home = agentConfig.env?.["HOME"];
    const authoredPaths = [
      flagValue("--config"),
      flagValue("--system-prompt"),
      flagValue("--trusted-extension"),
      home === undefined ? undefined : `${home}/.omp/agent/models.yml`,
    ].filter((path): path is string => path !== undefined);
    return {
      sessionId,
      resumed,
      catalogMissMessage,
      dataRoot: agentConfig.env?.["XDG_DATA_HOME"] ?? "",
      settingsPath: settingsIndex === -1 ? "" : agentConfig.args[settingsIndex + 1],
      authoredPaths,
    };
  } finally {
    await connector.disconnect();
  }
}

if (import.meta.main) {
  const paramsPath = Deno.args[0];
  if (paramsPath === undefined) {
    console.error("usage: omp-native-lifecycle-driver.ts <params.json>");
    Deno.exit(2);
  }
  const params = asDriverParams(JSON.parse(await Deno.readTextFile(paramsPath)));
  if (params === null) {
    console.error("invalid driver params");
    Deno.exit(2);
  }
  try {
    const result = await run(params);
    await Deno.writeTextFile(params.resultPath, JSON.stringify(result));
  } catch (error) {
    console.error(`driver failed: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}
