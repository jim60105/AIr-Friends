/**
 * Generated-bundle smoke driver (`bind-omp-owned-module-evidence` task 3.2).
 *
 * Runs as a CHILD PROCESS with the restricted launch identity supplied by the
 * caller (cwd = the mode-scoped launch cwd, owned HOME / PI_CODING_AGENT_DIR,
 * no API keys in the environment). It imports the REAL generated bundle at its
 * declared development path and drives the DEFAULT exported factory with an
 * API-shaped roster — the same function the pinned loader would evaluate — so
 * the delivered artifact's `import.meta.url`, its embedded deployment
 * declaration, the production metadata reader and the default registration
 * wiring are all exercised together. No session context, no injected module
 * evidence and no fixture declaration participate.
 *
 * Prints ONE JSON object on stdout. Anything else (a load-time discovery
 * blocker, a missing declaration, a failed acceptance) surfaces as a non-zero
 * exit or an unexpected result, which is exactly the fail-closed signal.
 *
 * Honesty: this proves the DELIVERED BUNDLE'S OWN wiring, nothing about the
 * official host binary invoking or honoring it.
 */

const bundleUrl = Deno.args[0];
const declaredArtifactPath = Deno.args[1];

if (!bundleUrl || !declaredArtifactPath) {
  throw new Error("usage: omp-bundle-smoke-driver.ts <bundle-file-url> <declared-artifact-path>");
}

interface ToolCallEvent {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

interface ToolCallResult {
  readonly block?: boolean;
  readonly reason?: string;
}

type Handler = (event: ToolCallEvent) => ToolCallResult | undefined;

const handlers: Handler[] = [];
const registeredTools: string[] = [];
const ownedSource = { path: declaredArtifactPath, source: "extension" };

/** The live roster the driver mutates: real pinned sourceInfo shapes. */
const roster: Array<{ name: string; sourceInfo: Record<string, string> }> = [
  { name: "read", sourceInfo: { ...ownedSource } },
  { name: "web_search", sourceInfo: { ...ownedSource } },
  {
    name: "bash",
    sourceInfo: {
      path: "<builtin:bash>",
      source: "builtin",
      scope: "temporary",
      origin: "top-level",
    },
  },
];

const api = {
  on: (event: string, handler: Handler) => {
    if (event === "tool_call") handlers.push(handler);
  },
  registerTool: (tool: { name: string }) => {
    registeredTools.push(tool.name);
  },
  getAllTools: () => roster,
};

// Static import cannot express this module specifier: the driver's WHOLE
// purpose is loading a generated artifact chosen at runtime by the caller (the
// module-loading boundary under test), so the import is dynamic on purpose.
// A static import of the bundle would also break the repo's own type check,
// which never compiles the generated output.
const loaded = await import(bundleUrl) as {
  default: (api: unknown) => { registered: boolean; mode: string };
  loadTimeDiscoveryDecision: { blockers: unknown[]; trustedRoots: readonly string[] };
};
const result = loaded.default(api);
const handler = handlers[0]!;

/** One call outcome: `dispatch` = the native call continues; else the block. */
function run(event: ToolCallEvent): string {
  const outcome = handler(event);
  return outcome === undefined ? "dispatch" : `block:${outcome.reason ?? ""}`;
}

console.log(JSON.stringify({
  registered: result.registered,
  mode: result.mode,
  registeredTools: [...registeredTools].sort(),
  loadBlockers: loaded.loadTimeDiscoveryDecision.blockers.length,
  trustedRoots: loaded.loadTimeDiscoveryDecision.trustedRoots,
  localRead: run({ toolCallId: "s1", toolName: "read", input: { path: "notes.md" } }),
  urlRead: run({
    toolCallId: "s2",
    toolName: "read",
    input: { path: "https://example.com/page" },
  }),
  webSearchNoBackend: run({
    toolCallId: "s3",
    toolName: "web_search",
    input: { query: "air friends" },
  }),
  authenticBuiltin: run({ toolCallId: "s4", toolName: "bash", input: { command: "ls" } }),
  foreignSameName: (() => {
    roster[0] = {
      name: "read",
      sourceInfo: { path: "/home/attacker/own.js", source: "extension" },
    };
    return run({ toolCallId: "s5", toolName: "read", input: { path: "notes.md" } });
  })(),
}));
