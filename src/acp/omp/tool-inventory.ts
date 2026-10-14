/**
 * Restricted native OMP capability map (one small immutable table).
 *
 * The pinned native settings express the RESTRICTED approval policy by exact
 * tool name (`tools.approval.<name>`), and the pinned native schema has no
 * wildcard default-deny key. The restricted capability extension therefore owns
 * exactly one decision: a native `tool_call` whose name maps to a permitted
 * ability continues to native dispatch (where the existing native approval and
 * shared ACP policy still decide it), and every other name is blocked BEFORE
 * dispatch with the bounded `rejected_unknown_tool` reason.
 *
 * Mapped names correspond one-to-one to the OpenCode abilities they stand for:
 * read (local/URL/skill instruction read), local search (grep/glob/find), todo,
 * web search, execute (bash), modify (edit/write) and destructive modify
 * (delete/move, where those names are registered natively or by a deployment
 * extension). There is no fabricated `skill` tool: native skill discovery and
 * `read skill://...` supply that capability.
 *
 * Membership is an OWN-property check on this frozen table, so prototype-shaped
 * names (`toString`, `constructor`, `__proto__`, ...) never match.
 */

export type OmpToolCapability =
  | "read"
  | "search"
  | "todo"
  | "network"
  | "execute"
  | "modify"
  | "destructive";

export const OMP_TOOL_CAPABILITY_MAP: Readonly<Record<string, OmpToolCapability>> = Object.freeze({
  read: "read",
  grep: "search",
  glob: "search",
  find: "search",
  todo: "todo",
  web_search: "network",
  bash: "execute",
  edit: "modify",
  write: "modify",
  delete: "destructive",
  move: "destructive",
});

export type OmpToolCapabilityDecision =
  | { readonly decision: "continue"; readonly capability: OmpToolCapability }
  | { readonly decision: "block"; readonly reason: "rejected_unknown_tool" };

/**
 * Decide one native tool name. Mapped names continue without repeating native
 * or ACP authorization; every other name is blocked with a bounded reason.
 */
export function decideOmpToolCapability(toolName: string): OmpToolCapabilityDecision {
  if (!Object.hasOwn(OMP_TOOL_CAPABILITY_MAP, toolName)) {
    return { decision: "block", reason: "rejected_unknown_tool" };
  }
  return { decision: "continue", capability: OMP_TOOL_CAPABILITY_MAP[toolName] };
}
