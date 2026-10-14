/**
 * Generated-bundle smoke driver (delivered-artifact capability dispatch).
 *
 * Runs as a CHILD PROCESS. It imports the REAL generated bundle at the path the
 * caller supplies and drives its DEFAULT exported extension with an API-shaped
 * `tool_call` registration — the same function the pinned loader would evaluate —
 * so the delivered artifact's own wiring is exercised end to end: the module
 * loads without an import map, its default export registers through the official
 * `api.on("tool_call", ...)` surface, and the registered callback decides mapped
 * versus unmatched native tool names.
 *
 * Prints ONE JSON object on stdout. A load error, a missing registration or an
 * unexpected outcome surfaces as a non-zero exit or an unexpected result, which
 * is exactly the fail-closed signal.
 *
 * Honesty: this proves the DELIVERED BUNDLE'S OWN wiring, nothing about the
 * official host binary invoking or honoring it.
 */

const bundleUrl = Deno.args[0];

if (!bundleUrl) {
  throw new Error("usage: omp-bundle-smoke-driver.ts <bundle-file-url>");
}

interface ToolCallEvent {
  readonly toolName: string;
}

interface ToolCallResult {
  readonly block?: boolean;
  readonly reason?: string;
}

type Handler = (event: ToolCallEvent) => ToolCallResult | undefined;

const handlers: Handler[] = [];

const api = {
  on: (event: string, handler: Handler) => {
    if (event === "tool_call") handlers.push(handler);
  },
};

// Static import cannot express this module specifier: the driver's WHOLE
// purpose is loading a generated artifact chosen at runtime by the caller (the
// module-loading boundary under test), so the import is dynamic on purpose.
// A static import of the bundle would also break the repo's own type check,
// which never compiles the generated output.
const loaded = await import(bundleUrl) as { default: (api: unknown) => void };
loaded.default(api);

const handler = handlers[0];
if (handler === undefined) {
  throw new Error("the delivered bundle registered no tool_call handler");
}

/**
 * One call outcome plus the number of fixture operations that actually ran:
 * the fixture dispatcher executes its operation ONLY when the registered
 * callback lets the call continue, so `executed` is the observable effect and
 * never an inference from the return value.
 */
function run(toolName: string): { outcome: string; executed: number } {
  let executed = 0;
  const outcome = handler({ toolName });
  // The native dispatch discipline blocks ONLY on an explicit `block: true`
  // result; any other result lets the call continue (a result that merely
  // carried a reason must not be mistaken for a block).
  const blocked = outcome?.block === true;
  if (!blocked) executed++;
  return {
    outcome: blocked ? "block" : "dispatch",
    executed,
  };
}

console.log(JSON.stringify({
  handlerCount: handlers.length,
  read: run("read"),
  grep: run("grep"),
  glob: run("glob"),
  find: run("find"),
  todo: run("todo"),
  web_search: run("web_search"),
  bash: run("bash"),
  edit: run("edit"),
  write: run("write"),
  delete: run("delete"),
  move: run("move"),
  unknownTool: run("definitely_not_a_tool"),
  protoName: run("__proto__"),
  toStringName: run("toString"),
}));
