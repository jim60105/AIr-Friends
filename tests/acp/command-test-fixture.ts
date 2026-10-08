import { join } from "@std/path";
import type { CommandGateContext } from "@acp/command-path-policy.ts";

export interface CommandFixture {
  root: string;
  workspace: string;
  shared: string;
  home: string;
  dataRoot: string;
  dataHome: string;
  toolOutput: string;
  sibling: string;
  processTmp: string;
  poolHome: string;
  context: CommandGateContext;
  cleanup: () => void;
}

/** Real metadata fixtures only; no agent or content execution. */
export function createCommandFixture(): CommandFixture {
  const root = Deno.makeTempDirSync();
  const workspace = join(root, "workspaces", "123");
  const shared = join(root, "agent-workspace");
  const home = join(root, "home");
  const dataRoot = join(workspace, "tmp", "opencode-data");
  const dataHome = join(dataRoot, "sess_own");
  const toolOutput = join(dataHome, "opencode", "tool-output");
  const sibling = join(root, "workspaces", "1234");
  const processTmp = join(root, "process-tmp");
  const poolHome = join(root, "opencode-data", "pool-own");
  for (
    const path of [
      toolOutput,
      join(dataRoot, "sess_other", "opencode", "tool-output"),
      join(workspace, "tmp", "sess_own"),
      join(workspace, "subdir"),
      join(shared, "notes"),
      sibling,
      processTmp,
      join(poolHome, "opencode", "tool-output"),
      join(root, "opencode-data", "pool-other", "opencode", "tool-output"),
      join(home, ".local", "share", "opencode", "tool-output"),
    ]
  ) Deno.mkdirSync(path, { recursive: true });
  for (
    const path of [
      join(workspace, "notes.md"),
      join(workspace, "data.json"),
      join(workspace, "tmp", "scratch.txt"),
      join(workspace, "subdir", "file.txt"),
      join(sibling, "secret.md"),
      join(toolOutput, "tool_x"),
      join(root, "external.txt"),
    ]
  ) {
    Deno.writeTextFileSync(path, "fixture");
  }
  const context: CommandGateContext = {
    acpSessionId: "acp-own",
    skillSessionId: "sess_own",
    sessionCwd: workspace,
    explicitStagingPath: join(workspace, "tmp", "sess_own"),
    sessionContextGeneration: "generation-own",
    home,
  };
  return {
    root,
    workspace,
    shared,
    home,
    dataRoot,
    dataHome,
    toolOutput,
    sibling,
    processTmp,
    poolHome,
    context,
    cleanup: () => Deno.removeSync(root, { recursive: true }),
  };
}
