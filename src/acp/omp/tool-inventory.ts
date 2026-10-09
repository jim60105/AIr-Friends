/**
 * Restricted Tool-Inventory Default-Deny Decision (pure).
 *
 * Implements OpenSpec change `define-omp-restricted-tool-decisions` (row 14a).
 * Pinned to official OMP v18.6.1 / commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
 *
 * Every decision here is a PURE function of (tool name, recorded provenance,
 * decoded input shape): no IO, no clock, no settings read, no registry access.
 * The trusted-extension `tool_call` handler wiring that consults these decisions
 * per call, decodes native arguments into `InputShape`, and observes the live
 * registry epoch is owned by 14b (`wire-omp-restricted-tool-enforcement`); the
 * generic-command path lexical→canonical hardening of the `bash` completing
 * authority is owned by 14c (`harden-acp-command-path-gate`).
 *
 * `allow` NEVER means "authorized": it names the predecessor decision that
 * completes authorization (row 4 sink policy, the existing common command
 * policy, row 5 all-target pass, or MCP client ownership). An unlisted name is
 * denied structurally (deny-by-absence), never by audit completeness.
 *
 * These modules are consulted ONLY in restricted mode: native-YOLO OMP sessions
 * receive none of these clamps (design D6) and OpenCode flows are untouched.
 */

import {
  AUDITED_PINNED_LEDGER,
  PINNED_OMP_COMMIT,
  PINNED_OMP_VERSION,
} from "./compatibility-contracts.ts";
import { ompSettingsForMode } from "../omp-settings.ts";
import {
  evaluateToolProvenance,
  type ProvenanceDecision,
  type ProvenanceRecord,
} from "./tool-provenance.ts";

/** Recorded origin of a tool; names are never sufficient (design D3). */
export type ToolOrigin =
  | "owned-extension"
  | "operator-mcp"
  | "host"
  | "workspace"
  | "unowned-discovery";

/**
 * Per-tool argument classification decoded from the pinned schema upstream of
 * this decision. Decoding rules are 14b's contract; this module ships shape
 * semantics only, and a mis-decode toward `opaque` can only ever narrow the
 * decision, never compose an allow for write/delete-shaped payloads.
 */
export type InputShape =
  | "path-target"
  | "command"
  | "url"
  | "query"
  | "todo"
  | "config-write"
  | "device-route"
  | "opaque";

/** Route surface a capability is reached through (design D4). */
export type RouteSurface =
  | "ordinary-tool"
  | "internal-uri-scheme"
  | "config-device"
  | "debug-device"
  | "ast-device"
  | "ssh-device"
  | "lsp-adjacent";

/** Bounded machine-readable deny vocabulary for restricted tool decisions. */
export type RestrictedDenialReason =
  | "rejected_tool_inventory"
  | "rejected_tool_provenance"
  | "rejected_alternate_route"
  | "rejected_approval_record_survivor"
  | "rejected_destructive_incomplete"
  | "rejected_destructive_binding";

/** The closed set of deny reasons; every deny path yields exactly one of these. */
export const RESTRICTED_DENIAL_VOCABULARY: readonly RestrictedDenialReason[] = [
  "rejected_tool_inventory",
  "rejected_tool_provenance",
  "rejected_alternate_route",
  "rejected_approval_record_survivor",
  "rejected_destructive_incomplete",
  "rejected_destructive_binding",
] as const;

/** Which predecessor decision completes an allow outcome. */
export type CompletingAuthority =
  | "row4-filesystem-read-boundary"
  | "row4-filesystem-write-sink"
  | "existing-common-command-policy"
  | "row5-destructive-all-target-policy"
  | "mcp-client-ownership"
  | "in-session-todo-state-only";

/**
 * Outcomes of the restricted inventory decision. `allow` never means
 * "authorized"; each non-deny outcome names the completing authority (design D1).
 * `allow-gated-pending-adapter` is deliberately distinct from `allow`: rows
 * 17–19 complete those transport routes; until then 14b fails them closed rather
 * than letting native unadapted transport run (capability parity preserved,
 * never deny-parity).
 */
export type RestrictedToolDecision =
  | {
    readonly outcome: "allow-gated";
    readonly completingAuthority: CompletingAuthority;
    readonly tableRowId: string;
  }
  | {
    readonly outcome: "allow-gated-pending-adapter";
    readonly completingAuthority: "rows-17-19-transport-adapter";
    readonly tableRowId: string;
    readonly pendingAdapter: true;
  }
  | {
    readonly outcome: "routed-filesystem-sink";
    readonly completingAuthority: "row4-filesystem-write-sink";
    readonly tableRowId: string;
  }
  | {
    readonly outcome: "routed-destructive";
    readonly completingAuthority: "row5-destructive-all-target-policy";
    readonly tableRowId: string;
  }
  | {
    readonly outcome: "routed-provenance";
    readonly completingAuthority: "mcp-client-ownership";
    readonly tableRowId: string;
    readonly provenance: ProvenanceDecision;
  }
  | {
    readonly outcome: "in-session-state-only";
    readonly completingAuthority: "in-session-todo-state-only";
    readonly filesystemMutationRoute: false;
    readonly tableRowId: string;
  }
  | {
    readonly outcome: "deny";
    readonly reason: RestrictedDenialReason;
    readonly tableRowId?: string;
    /** Present on stale-provenance denials: fresh observation demanded. */
    readonly pending?: "re-observe";
    /** Present on alternate-route denials: the blocked capability+route pair. */
    readonly blockedPair?: {
      readonly capability: string;
      readonly route: RouteSurface;
    };
    /** Present on inventory denials: structural default-deny, never audit-derived. */
    readonly denyByAbsence?: true;
  };

/** Row classification in the machine-readable inventory table. */
export type InventoryRowKind =
  | "allow-gated"
  | "allow-gated-pending-adapter"
  | "routed-filesystem-sink"
  | "routed-destructive"
  | "routed-provenance"
  | "in-session-state-only"
  | "default-deny";

export interface InventoryRow {
  readonly id: string;
  /** Ordinary tool names matched by this row; empty for the origin-keyed MCP row. */
  readonly toolNames: readonly string[];
  /** Origin class this row keys on instead of names (operator MCP only). */
  readonly origin?: ToolOrigin;
  readonly kind: InventoryRowKind;
  readonly completingAuthority?:
    | CompletingAuthority
    | "rows-17-19-transport-adapter";
  readonly designCitation: string;
  readonly notes: string;
}

const D6 = "design §6 (restricted capability and authorization matrix)";

/**
 * The machine-readable restricted inventory table over the COMPLETE pinned
 * OMP v18.6.1 tool inventory and its implicit side-effect surfaces — not the
 * historical handoff YAML list. Every named OMP-only execution surface outside
 * the approved capability set is an explicit default-deny row; any surface the
 * audit cannot enumerate still lands in default-deny structurally through
 * `decideRestrictedTool` (deny-by-absence is structural, so audit omissions
 * fail closed rather than open).
 */
export const RESTRICTED_TOOL_INVENTORY_TABLE: readonly InventoryRow[] = Object.freeze(
  [
    {
      id: "read-class",
      toolNames: ["read", "list", "glob", "grep", "search", "find"],
      kind: "allow-gated",
      completingAuthority: "row4-filesystem-read-boundary",
      designCitation: D6,
      notes:
        "Gated to the existing row-4 session boundaries plus authorized shared/read-only roots and the trusted-skills read root. Pinned note: some native search implementations do not automatically invoke ACP callbacks, so the decision binds at the handler (14b), never by assumed callback coverage. The URL branch of native `read` decodes to the `url` shape and lands on `url-read`.",
    },
    {
      id: "url-read",
      toolNames: [],
      kind: "allow-gated-pending-adapter",
      completingAuthority: "rows-17-19-transport-adapter",
      designCitation: `${D6}; URL branch of native read`,
      notes:
        "URL-read parity preserved (never deny-parity); rows 17–19 complete the controlled transport. Distinct from plain allow until their adapter lands.",
    },
    {
      id: "web-fetch",
      toolNames: ["webfetch"],
      kind: "allow-gated-pending-adapter",
      completingAuthority: "rows-17-19-transport-adapter",
      designCitation: D6,
      notes:
        "Preserve URL-reading capability with controlled transport and per-hop validation (rows 17–19). `allow-gated-pending-adapter` is not a plain allow and never will be conflated with one.",
    },
    {
      id: "web-search",
      toolNames: ["websearch"],
      kind: "allow-gated-pending-adapter",
      completingAuthority: "rows-17-19-transport-adapter",
      designCitation: D6,
      notes:
        "Live search preserved through supported configured provider credentials and controlled transport (row 18).",
    },
    {
      id: "code-search",
      toolNames: ["codesearch"],
      kind: "allow-gated-pending-adapter",
      completingAuthority: "rows-17-19-transport-adapter",
      designCitation: D6,
      notes:
        "Public code/documentation search preserved (row 19) without adding LSP or arbitrary execution. Local text search stays on the read-class row.",
    },
    {
      id: "write-edit-ordinary",
      toolNames: ["write", "edit"],
      kind: "routed-filesystem-sink",
      completingAuthority: "row4-filesystem-write-sink",
      designCitation: D6,
      notes:
        "Ordinary write/edit routes to the row-4 restricted sinks via the row-8 sink contract. Implicit side effects keyed by D4 instead: a write/edit whose decoded shape is `config-write` or `device-route` never reaches this row.",
    },
    {
      id: "bash",
      toolNames: ["bash"],
      kind: "allow-gated",
      completingAuthority: "existing-common-command-policy",
      designCitation: D6,
      notes:
        "Gated to the EXISTING common command policy (lexical path gate unchanged; 14c owns its lexical→canonical hardening). The extra native ACP bash permission path stays active (design §7).",
    },
    {
      id: "todo-state",
      toolNames: ["todoread", "todowrite", "todo_write", "todo_read", "todo_update"],
      kind: "in-session-state-only",
      completingAuthority: "in-session-todo-state-only",
      designCitation: D6,
      notes:
        "In-session planning state only. A todo-shaped write never opens a filesystem mutation route; this outcome carries `filesystemMutationRoute: false` structurally.",
    },
    {
      id: "delete-move-patch",
      toolNames: ["delete", "move", "apply_patch"],
      kind: "routed-destructive",
      completingAuthority: "row5-destructive-all-target-policy",
      designCitation: D6,
      notes:
        "Routes to the shared destructive decision (row 5 all-target policy). Multi-file patch and first-operation-only native shapes fail closed per the DECIDED ACP-mediated destructive boundary.",
    },
    {
      id: "operator-mcp",
      toolNames: [],
      origin: "operator-mcp",
      kind: "routed-provenance",
      completingAuthority: "mcp-client-ownership",
      designCitation: `${D6}; design D2/D7`,
      notes:
        "Operator/client-owned MCP tools are admitted through the provenance decision (ownership + live-epoch freshness + alternate-route screening), never by name. MCP is never host-owned. This row is origin-keyed, so MCP tool names are table members by origin class, keeping 'unknown tool ⇒ deny' structural for every non-MCP name.",
    },
    {
      id: "trusted-skills",
      toolNames: ["skill"],
      kind: "allow-gated",
      completingAuthority: "row4-filesystem-read-boundary",
      designCitation: `${D6}; design §7 (critical skill canonical ownership)`,
      notes:
        "Owned critical skills remain discoverable and readable through the row-4 trusted-skills read root with row-12 provenance; workspace content cannot shadow a critical skill. `skill://`-style reads decode to `path-target` against the trusted-skills root.",
    },
    // --- Explicit default-deny rows: named OMP-only execution surfaces outside
    // the approved capability set (design §6), enumerated rather than inferred. ---
    {
      id: "deny-eval",
      toolNames: ["eval"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Persistent code-evaluation surface; no unrestricted native execution route.",
    },
    {
      id: "deny-task",
      toolNames: ["task", "agent", "subagent"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Task/subagent orchestration surface.",
    },
    {
      id: "deny-computer",
      toolNames: ["computer"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Machine-interaction surface; no approved capability.",
    },
    {
      id: "deny-browser",
      toolNames: ["browser"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Native browser surface (Puppeteer route); browser automation stays skill-mediated.",
    },
    {
      id: "deny-async-job",
      toolNames: ["job", "async", "spawn", "background"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Background/async execution surfaces; no new unrestricted execution route.",
    },
    {
      id: "deny-launch",
      toolNames: ["launch"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Process-launch surface; execution stays on the gated `bash` row.",
    },
    {
      id: "deny-debug",
      toolNames: ["debug"],
      kind: "default-deny",
      designCitation: D6,
      notes: "DAP debugger surface; hidden debug route never admitted by read/write allows.",
    },
    {
      id: "deny-ast",
      toolNames: ["ast_edit", "ast_grep"],
      kind: "default-deny",
      designCitation: D6,
      notes: "AST mutation/grep devices; denied regardless of ordinary edit/read status.",
    },
    {
      id: "deny-lsp",
      toolNames: ["lsp"],
      kind: "default-deny",
      designCitation: `${D6}; design §6 LSP row`,
      notes:
        "LSP tool denies at the restricted decision layer. This deny is NOT disablement evidence — row 15 owns native disablement incl. implicit startup.",
    },
    {
      id: "deny-lsp-config",
      toolNames: ["lsp_config", "lsp-referenced-config"],
      kind: "default-deny",
      designCitation: D6,
      notes:
        "LSP-referenced configuration surface; separate tool-name identities so no name-match alias re-admits the `lsp` deny.",
    },
    {
      id: "deny-ssh",
      toolNames: ["ssh"],
      kind: "default-deny",
      designCitation: D6,
      notes: "SSH device route; remote execution never reachable from restricted sessions.",
    },
    {
      id: "deny-irc",
      toolNames: ["irc"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Inter-agent prose surface; outside the approved capability set.",
    },
    {
      id: "deny-recipe",
      toolNames: ["recipe"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Recipe execution surface; outside the approved capability set.",
    },
    {
      id: "deny-question",
      toolNames: ["question"],
      kind: "default-deny",
      designCitation: `${D6}; design §7`,
      notes:
        "Generic human elicitation is explicitly absent; a non-interactive system must not route questions anywhere.",
    },
    {
      id: "deny-doom-loop",
      toolNames: ["doom_loop"],
      kind: "default-deny",
      designCitation: D6,
      notes: "Native loop-protection control surface; not an agent-invocable capability.",
    },
    {
      id: "deny-external-directory",
      toolNames: ["external_directory"],
      kind: "default-deny",
      designCitation: D6,
      notes:
        "External-directory grants are bounded row-4 root membership, never an agent tool route; reaching outside roots through any device route denies on the D4 pair table.",
    },
    {
      id: "deny-internal-devices",
      toolNames: ["xd", "artifact", "agent-device", "history-device", "proc-device"],
      kind: "default-deny",
      designCitation: D6,
      notes:
        "Named internal device URI schemes (`xd://`-class) are OMP-only execution surfaces; the shape-keyed D4 pair table blocks their implicit routes independently of this name row.",
    },
    {
      id: "deny-config-write",
      toolNames: ["config_write", "settings_write"],
      kind: "default-deny",
      designCitation: `${D6}; design §7 (Authoritative settings)`,
      notes:
        "Configuration-write devices (approval posture, security-relevant settings) deny by name, and the shape-keyed D4 route screening denies any config-write-shaped payload regardless of the presenting tool's ordinary route.",
    },
  ] as const satisfies readonly InventoryRow[],
);

/**
 * Security-relevant settings keys a `config-write` shape must never touch from a
 * restricted session (design §7: inventory and constrain security-relevant keys).
 * Exported as data: config-write shapes deny unconditionally through route
 * screening, so this list can never be the cause of an under-detection; it names
 * the posture keys the DECIDED settings-discovery-path control protects.
 */
export const SECURITY_RELEVANT_SETTING_KEYS: readonly string[] = Object.freeze(
  [
    "tools.approval",
    "tools.approvalMode",
    "permission",
    "lsp.enabled",
    "startup.checkUpdate",
    "marketplace.autoUpdate",
    "update.channel",
    "autoupdate",
    "disabledProviders",
    "mcp",
    "mcpServers",
    "trusted-extension",
    "skills",
    "customTools",
    "plugins",
  ] as const,
);

/** One (capability, route-surface) blocking pair (design D4). */
export interface AlternateRoutePair {
  readonly capability: string;
  readonly route: RouteSurface;
  readonly designCitation: string;
  readonly notes: string;
}

/**
 * Alternate-execution-entrypoint blocking table. Keys on (capability, route)
 * derived from the DECODED INPUT SHAPE ONLY — never the tool name — so a renamed
 * carrier of the same pair produces the identical pair-named denial, and a gate
 * or sink status on the capability's ordinary tool never excuses the route.
 */
export const ALTERNATE_ROUTE_BLOCKING_TABLE: readonly AlternateRoutePair[] = Object.freeze(
  [
    {
      capability: "execution",
      route: "internal-uri-scheme",
      designCitation: `${D6}; §6 audit line (execution through xd://)`,
      notes: "Execution through an internal device URI scheme while `bash` is separately gated.",
    },
    {
      capability: "execution",
      route: "debug-device",
      designCitation: D6,
      notes: "Execution via DAP debugger device while `read`/`write` are allowed.",
    },
    {
      capability: "filesystem-write",
      route: "internal-uri-scheme",
      designCitation: D6,
      notes: "A `write` reaching an internal scheme is not the sink route.",
    },
    {
      capability: "filesystem-write",
      route: "config-device",
      designCitation: `${D6}; design §7`,
      notes: "A config write flipping approval posture while `write` is sink-routed.",
    },
    {
      capability: "filesystem-write",
      route: "debug-device",
      designCitation: D6,
      notes: "Hidden mutation through a debug device merely because `write` is allowed.",
    },
    {
      capability: "filesystem-write",
      route: "ast-device",
      designCitation: D6,
      notes: "AST-mutation device while ordinary edit is sink-routed.",
    },
    {
      capability: "filesystem-write",
      route: "ssh-device",
      designCitation: D6,
      notes: "Remote mutation via SSH device.",
    },
    {
      capability: "filesystem-write",
      route: "lsp-adjacent",
      designCitation: D6,
      notes: "LSP-adjacent rename/code-action mutation while read is allowed.",
    },
    {
      capability: "filesystem-read",
      route: "internal-uri-scheme",
      designCitation: D6,
      notes: "A `read` of an internal device URI is not the read-class route.",
    },
    {
      capability: "filesystem-read",
      route: "debug-device",
      designCitation: D6,
      notes: "Debugger-mediated memory/file reads.",
    },
    {
      capability: "filesystem-read",
      route: "ssh-device",
      designCitation: D6,
      notes: "Remote reads via SSH device.",
    },
    {
      capability: "approval-posture",
      route: "config-device",
      designCitation: `${D6}; design §7`,
      notes: "Config write targeting approval posture / security-relevant settings.",
    },
    {
      capability: "command-execution",
      route: "ssh-device",
      designCitation: D6,
      notes: "Command execution on a remote host via SSH device route.",
    },
    {
      capability: "command-execution",
      route: "ast-device",
      designCitation: D6,
      notes: "AST rewrite as an execution carrier.",
    },
    {
      capability: "destructive-mutation",
      route: "ast-device",
      designCitation: D6,
      notes: "Destructive intent via AST-mutation device instead of the row-5 route.",
    },
    {
      capability: "destructive-mutation",
      route: "lsp-adjacent",
      designCitation: D6,
      notes: "Destructive intent via LSP-adjacent refactoring route.",
    },
    {
      capability: "session-todo",
      route: "config-device",
      designCitation: D6,
      notes: "Todo-shaped payload written through a config device instead of session state.",
    },
    {
      capability: "network-read",
      route: "internal-uri-scheme",
      designCitation: D6,
      notes: "URL-read shaped payload routed through an internal device scheme.",
    },
  ] as const satisfies readonly AlternateRoutePair[],
);

/**
 * Capability implied by a decoded input shape (design D4: route detection is
 * input-shape classification, so the block is data, not pattern-matching folklore).
 */
export const INPUT_SHAPE_CAPABILITIES: Readonly<Record<InputShape, string>> = Object.freeze(
  {
    "path-target": "filesystem",
    command: "command-execution",
    url: "network-read",
    query: "search",
    todo: "session-todo",
    "config-write": "approval-posture",
    "device-route": "device-execution",
    opaque: "opaque",
  } as const,
);

/**
 * Classify the route surface a call presents from its decoded input shape ONLY
 * (rename-invariant). Ordinary shapes stay on `ordinary-tool`; device-route and
 * config-write shapes present non-ordinary routes for capability screening.
 * Shapes whose device character depends on the decoded carrier (debug, AST,
 * SSH, LSP-adjacent) decode upstream into `device-route` or `config-write`
 * with an explicit `decodedCapability`; the pair table still enumerates every
 * design-§6 route for the screening below and for consumer-visible docs.
 */
export function classifyRouteSurface(inputShape: InputShape): RouteSurface {
  switch (inputShape) {
    case "device-route":
      return "internal-uri-scheme";
    case "config-write":
      return "config-device";
    default:
      return "ordinary-tool";
  }
}

/** Request to the restricted inventory decision. */
export interface RestrictedToolDecisionRequest {
  readonly toolName: string;
  readonly provenance: ProvenanceRecord;
  readonly inputShape: InputShape;
  /**
   * Device identity carried by a `device-route`/`config-write` shape when the
   * decoder can name it ("debug-device", "ast-device", "ssh-device",
   * "lsp-adjacent"); absent ⇒ the generic internal-scheme surface is assumed.
   */
  readonly deviceSurface?: RouteSurface;
  /**
   * Capability the decoded shape carries, when richer than the shape default
   * (e.g. a device-route payload that is clearly a read). Must be one of the
   * capabilities named by `ALTERNATE_ROUTE_BLOCKING_TABLE`; anything else is
   * screened fail-closed against the generic blocked-route rule below.
   */
  readonly decodedCapability?: string;
}

/**
 * The pure restricted tool-inventory entry decision.
 *
 * Composition order (each stage is terminal for that call):
 *  1. Alternate-route screening — keyed on (capability implied by the decoded
 *     shape, route surface) BEFORE name lookup, so an off-table alias carrying
 *     a blocked pair still denies with the pair-named reason (rename-invariant).
 *     Both possible outcomes here deny or continue; no allow path opens.
 *  2. Structural default-deny for any name absent from the table (deny-by-
 *     absence). Operator-MCP-origin calls match the origin-keyed MCP row and
 *     continue; every other unlisted name denies.
 *  3. Provenance admission (name-match structurally insufficient).
 *  4. The table row's outcome, which only names the completing authority.
 */
export function decideRestrictedTool(
  request: RestrictedToolDecisionRequest,
): RestrictedToolDecision {
  const { toolName, provenance, inputShape } = request;

  // Stage 1: (capability, route) pair screening from the decoded shape only.
  const route: RouteSurface = request.deviceSurface ?? classifyRouteSurface(inputShape);
  if (route !== "ordinary-tool") {
    const capability = request.decodedCapability ??
      INPUT_SHAPE_CAPABILITIES[inputShape] ??
      "opaque";
    const pair = ALTERNATE_ROUTE_BLOCKING_TABLE.find((entry) =>
      entry.route === route && entry.capability === capability
    );
    if (pair) {
      return {
        outcome: "deny",
        reason: "rejected_alternate_route",
        blockedPair: { capability: pair.capability, route: pair.route },
      };
    }
    // A non-ordinary route whose exact pair is unenumerated is still a blocked
    // route (fail-closed superset): deny naming the presented pair.
    return {
      outcome: "deny",
      reason: "rejected_alternate_route",
      blockedPair: { capability, route },
    };
  }

  // Stage 2: structural default-deny by name (deny-by-absence).
  const nameRow = RESTRICTED_TOOL_INVENTORY_TABLE.find((row) => row.toolNames.includes(toolName));
  // A named OMP-only execution surface denies by name for EVERY origin:
  // no provenance — owned-extension or client-owned MCP — rescues a named
  // execution surface, and an MCP tool merely wearing the name is not a
  // client capability of the approved set.
  if (nameRow && nameRow.kind === "default-deny") {
    return { outcome: "deny", reason: "rejected_tool_inventory", tableRowId: nameRow.id };
  }
  let row: InventoryRow;
  if (provenance.origin === "operator-mcp") {
    row = RESTRICTED_TOOL_INVENTORY_TABLE.find((entry) => entry.id === "operator-mcp")!;
  } else if (nameRow) {
    row = nameRow;
  } else {
    return {
      outcome: "deny",
      reason: "rejected_tool_inventory",
      tableRowId: `default-deny-by-absence:${toolName}`,
      denyByAbsence: true,
    };
  }

  // Stage 3: recorded provenance must be authoritative (names never decide).
  const provenanceDecision = evaluateToolProvenance(toolName, provenance, {
    nameOnAllowTable: true,
  });
  if (!provenanceDecision.admit) {
    return {
      outcome: "deny",
      reason: "rejected_tool_provenance",
      tableRowId: row.id,
      ...(provenanceDecision.pending === "re-observe" ? { pending: "re-observe" as const } : {}),
    };
  }

  // Stage 4: implicit-side-effect re-rows keyed by decoded shape (design D2/
  // D4): a todo-shaped write/edit is session state, never a filesystem
  // mutation route (destructive-named tools never downgrade to session state);
  // the native `read` URL branch lands on the pending-adapter URL row.
  if (inputShape === "todo" && row.id === "write-edit-ordinary") {
    row = RESTRICTED_TOOL_INVENTORY_TABLE.find((entry) => entry.id === "todo-state")!;
  }
  if (inputShape === "url" && row.id === "read-class") {
    row = RESTRICTED_TOOL_INVENTORY_TABLE.find((entry) => entry.id === "url-read")!;
  }

  switch (row.kind) {
    case "allow-gated":
      return {
        outcome: "allow-gated",
        completingAuthority: row.completingAuthority as CompletingAuthority,
        tableRowId: row.id,
      };
    case "allow-gated-pending-adapter":
      return {
        outcome: "allow-gated-pending-adapter",
        completingAuthority: "rows-17-19-transport-adapter",
        tableRowId: row.id,
        pendingAdapter: true,
      };
    case "routed-filesystem-sink":
      return {
        outcome: "routed-filesystem-sink",
        completingAuthority: "row4-filesystem-write-sink",
        tableRowId: row.id,
      };
    case "routed-destructive":
      return {
        outcome: "routed-destructive",
        completingAuthority: "row5-destructive-all-target-policy",
        tableRowId: row.id,
      };
    case "routed-provenance":
      return {
        outcome: "routed-provenance",
        completingAuthority: "mcp-client-ownership",
        tableRowId: row.id,
        provenance: provenanceDecision,
      };
    case "in-session-state-only":
      return {
        outcome: "in-session-state-only",
        completingAuthority: "in-session-todo-state-only",
        filesystemMutationRoute: false,
        tableRowId: row.id,
      };
    case "default-deny":
      return { outcome: "deny", reason: "rejected_tool_inventory", tableRowId: row.id };
  }
}

/** MCP admission request (design D7). */
export interface McpAdmissionRequest {
  readonly toolName: string;
  readonly provenance: ProvenanceRecord;
  readonly inputShape: InputShape;
  readonly deviceSurface?: RouteSurface;
  readonly decodedCapability?: string;
}

export type McpAdmissionDecision =
  | {
    readonly admit: true;
    readonly gatedBy: "mcp-client-ownership";
    readonly basisStatus: "needs-mechanism-audit";
  }
  | {
    readonly admit: false;
    readonly reason: RestrictedDenialReason;
    readonly pending?: "re-observe";
    readonly blockedPair?: { capability: string; route: RouteSurface };
  };

/**
 * MCP admission decision: client ownership + live-epoch freshness +
 * alternate-route screening, with no generic human elicitation anywhere.
 */
export function decideMcpAdmission(request: McpAdmissionRequest): McpAdmissionDecision {
  const route: RouteSurface = request.deviceSurface ?? classifyRouteSurface(request.inputShape);
  if (route !== "ordinary-tool") {
    return {
      admit: false,
      reason: "rejected_alternate_route",
      blockedPair: {
        capability: request.decodedCapability ??
          INPUT_SHAPE_CAPABILITIES[request.inputShape] ?? "opaque",
        route,
      },
    };
  }
  const provenance = evaluateToolProvenance(request.toolName, request.provenance, {
    nameOnAllowTable: true,
  });
  if (!provenance.admit) {
    return {
      admit: false,
      reason: "rejected_tool_provenance",
      ...(provenance.pending === "re-observe" ? { pending: "re-observe" as const } : {}),
    };
  }
  return { admit: true, gatedBy: "mcp-client-ownership", basisStatus: "needs-mechanism-audit" };
}

// -----------------------------------------------------------------------------
// Honesty gates as named data (design D8).
//
// Every restated token is SOURCED, never retyped: the P0 ledger statuses and
// evidence text come from `AUDITED_PINNED_LEDGER`, the row-8 record-reset gate
// text comes from `ompSettingsForMode`, and the DECIDED user dispositions are
// cited verbatim from the decision register
// (docs/superpowers/specs/2026-10-06-omp-proposal-batch-index.md §3 rows
// 'Authoritative approval-record reset', 'Complete destructive-intent
// decoding', and 'MCP admission mechanism basis'). A test asserts equality
// against the source modules so a restatement can never drift or relabel.
// -----------------------------------------------------------------------------

const ledgerRecordAuthority = AUDITED_PINNED_LEDGER.find((entry) =>
  entry.boundary === "record_authority"
)!;
const ledgerDestructiveIntent = AUDITED_PINNED_LEDGER.find((entry) =>
  entry.boundary === "destructive_intent"
)!;
const row8Restricted = ompSettingsForMode("restricted");

/** Source-attributed restatement of one preserved P0 verdict. */
export interface PreservedVerdict {
  readonly boundary: "record_authority" | "destructive_intent";
  /** Verbatim status from the pinned ledger entry (quoted, never retyped). */
  readonly pinnedLedgerStatus: string;
  /** Verbatim ledger notes (quoted, never retyped). */
  readonly pinnedLedgerNotes: string;
  /** Verbatim ledger source citation (quoted, never retyped). */
  readonly pinnedLedgerSourceCitation: string;
  /**
   * The decision-register label. The register names the record-reset verdict
   * INCOMPATIBLE and the destructive-decoding verdict UNRESOLVED; the pinned
   * ledger itself records `incompatible` for both boundaries — the label and
   * the ledger status are DIFFERENT tokens from DIFFERENT sources and are kept
   * apart here so neither can relabel the other.
   */
  readonly registerVerdict: "INCOMPATIBLE" | "UNRESOLVED";
  readonly registerSource: string;
  /** Verbatim DECIDED user disposition from the decision register. */
  readonly userDisposition: "DECIDED";
  readonly dispositionText: string;
  readonly dispositionSource: string;
}

export const PRESERVED_PINNED_VERDICTS: readonly PreservedVerdict[] = Object.freeze(
  [
    {
      boundary: "record_authority",
      pinnedLedgerStatus: ledgerRecordAuthority.status,
      pinnedLedgerNotes: ledgerRecordAuthority.notes ?? "",
      pinnedLedgerSourceCitation: ledgerRecordAuthority.sourceCitation,
      registerVerdict: "INCOMPATIBLE",
      registerSource:
        "docs/superpowers/specs/2026-10-06-omp-proposal-batch-index.md §3 consolidated decision sheet row 'Authoritative approval-record reset'",
      userDisposition: "DECIDED",
      dispositionText:
        "settings discovery paths are controlled instead of the reset overlay: only the owned --config overlays are visible, with HOME, XDG and project settings sources filtered out, so no hostile lower layer exists to inherit from. Restricted runtime default-deny remains the second boundary.",
      dispositionSource:
        "docs/superpowers/specs/2026-10-06-omp-proposal-batch-index.md §3 consolidated decision sheet row 'Authoritative approval-record reset' (user decision, 2026-10-09)",
    },
    {
      boundary: "destructive_intent",
      pinnedLedgerStatus: ledgerDestructiveIntent.status,
      pinnedLedgerNotes: ledgerDestructiveIntent.notes ?? "",
      pinnedLedgerSourceCitation: ledgerDestructiveIntent.sourceCitation,
      registerVerdict: "UNRESOLVED",
      registerSource:
        "docs/superpowers/specs/2026-10-06-omp-proposal-batch-index.md §3 consolidated decision sheet row 'Complete destructive-intent decoding'",
      userDisposition: "DECIDED",
      dispositionText:
        "keep the ACP-mediated destructive path with complete location lists; deny native shapes (multi-file patches and first-operation-only lists) fail-closed.",
      dispositionSource:
        "docs/superpowers/specs/2026-10-06-omp-proposal-batch-index.md §3 consolidated decision sheet row 'Complete destructive-intent decoding' (user decision, 2026-10-09)",
    },
  ] as const satisfies readonly PreservedVerdict[],
);

/**
 * The honesty gate table: preserved pinned verdicts, the MCP ledger gap, and
 * the restricted-only consultation posture. Passing decision-table tests can
 * never clear any entry here; unit and mock evidence validates decision logic
 * only, never native enforcement, record reset, or complete destructive
 * decoding.
 */
export interface RestrictedToolPolicyGates {
  readonly pinned: {
    readonly ompVersion: string;
    readonly ompCommit: string;
  };
  readonly verdicts: readonly PreservedVerdict[];
  /** Verbatim row-8 record-reset gate (sourced, never retyped). */
  readonly row8RecordResetGate: {
    readonly status: "unresolved";
    readonly strategy: "reset-then-mode-null";
    readonly reason: string;
    readonly residualEvidence: string;
    readonly operativeSecurityBoundary: string;
  };
  readonly mcpLedgerGap: {
    readonly hasMcpBoundaryRow: false;
    readonly basisStatus: "needs-mechanism-audit";
    readonly candidateStatus: "candidate-to-verify";
    readonly citation: string;
  };
  readonly consultationPosture: {
    readonly restrictedOnly: true;
    readonly yoloExempt: true;
    readonly yoloExemptionNote: string;
    readonly opencodeUnchanged: true;
    readonly elicitation: "explicitly-absent";
    readonly pendingUserDecisionRequired: false;
  };
}

export const restrictedToolPolicyGates: RestrictedToolPolicyGates = Object.freeze(
  {
    pinned: {
      ompVersion: PINNED_OMP_VERSION,
      ompCommit: PINNED_OMP_COMMIT,
    },
    verdicts: PRESERVED_PINNED_VERDICTS,
    row8RecordResetGate: {
      status: row8Restricted.recordResetGate.status,
      strategy: row8Restricted.recordResetGate.strategy,
      reason: row8Restricted.recordResetGate.reason,
      residualEvidence: row8Restricted.recordResetGate.residualEvidence,
      operativeSecurityBoundary: row8Restricted.recordResetGate.operativeSecurityBoundary,
    },
    mcpLedgerGap: {
      hasMcpBoundaryRow: false,
      basisStatus: "needs-mechanism-audit",
      candidateStatus: "candidate-to-verify",
      citation:
        "The pinned AUDITED_PINNED_LEDGER (establish-omp-compatibility-contracts) has no MCP boundary row; this change may not fabricate one. The native-side MCP admission mechanism basis is needs-mechanism-audit and any candidate identity path is candidate-to-verify — never supported — regardless of local test outcomes.",
    },
    consultationPosture: {
      restrictedOnly: true,
      yoloExempt: true,
      yoloExemptionNote:
        "Native-YOLO OMP sessions receive none of these clamps (design D6); restricted LSP disablement for both modes is owned separately (row 15). These modules have no YOLO consumer.",
      opencodeUnchanged: true,
      elicitation: "explicitly-absent",
      pendingUserDecisionRequired: false,
    },
  } as const,
);
