/**
 * Machine-readable URL-read route enumeration (row 19,
 * `control-omp-url-fetch-transport`, design D3).
 *
 * One row per pinned URL-read route: which routes the trusted extension's
 * `registerTool` name-replacement of `read` completes through the controlled
 * transport (`completed-by-adapter`), which native seams exist but were NOT
 * selected (`partial-seam-not-selected`), and which stay blocked for any
 * caller outside the replacement (`blocked-pending-adapter`, each carrying
 * `userDecisionRequired`). Citations are the S1-S9 pinned-source facts
 * re-verified at commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`
 * (v18.6.1) with file + symbol locations frozen this session — static reads
 * of the pinned source, never executed native behavior.
 *
 * Honesty invariants: statuses use the P0 vocabulary tiers; NO row claims
 * `supported` for native-binary behavior; the mock acceptance suites
 * certify this change's adapter decisions only and can never clear the P0
 * bypass record (S3/S4) or prove the compiled binary invokes the
 * replacement (design §15 user checklist, unverified).
 */

import { PINNED_OMP_COMMIT, PINNED_OMP_VERSION } from "./compatibility-contracts.ts";

/** The P0 vocabulary tiers used by this table; no row claims `supported`. */
export type FetchRouteStatus =
  | "completed-by-adapter"
  | "partial-seam-not-selected"
  | "blocked-pending-adapter";

/** The selected supported mechanism (D2), stated once for its rows. */
export const FETCH_COMPLETING_MECHANISM =
  "trusted-extension registerTool name-replacement of `read` (last-extension-wins, S7/S8): " +
  "URL-shaped inputs served entirely by the fetch-transport adapter; non-URL inputs delegated " +
  "verbatim to the captured native via the same-tool ctx.invokeTool resolver (S8)";

/** One pinned source citation backing a route verdict. */
export interface FetchRouteCitation {
  readonly id: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";
  readonly ompVersion: string;
  readonly ompCommit: string;
  readonly location: string;
  readonly fact: string;
}

const PIN = { ompVersion: PINNED_OMP_VERSION, ompCommit: PINNED_OMP_COMMIT } as const;

/** The frozen S1-S9 citation set (re-verified at the pin; zero drift). */
export const FETCH_ROUTE_CITATIONS: readonly FetchRouteCitation[] = Object.freeze(
  [
    {
      id: "S1",
      ...PIN,
      location: "packages/coding-agent/src/tools/index.ts (ToolSession.fetch, field + doc comment)",
      fact:
        'ToolSession carries an optional `fetch?: FetchImpl` documented as "injected into the ' +
        'URL read pipeline (tests, proxies). Defaults to global fetch."',
    },
    {
      id: "S2",
      ...PIN,
      location:
        "packages/coding-agent/src/tools/fetch.ts (renderUrl signature forwards session.fetch; " +
        "renderHtmlToText `const fetchImpl = fetchOverride ?? fetch`)",
      fact: "The URL-read pipeline accepts the override ONLY in enrichment: renderUrl forwards " +
        "session.fetch solely into renderHtmlToText, whose fetchImpl covers the reader-provider " +
        "enrichment runners (native/trafilatura/lynx/parallel/firecrawl/jina).",
    },
    {
      id: "S3",
      ...PIN,
      location: "packages/coding-agent/src/web/scrapers/types.ts (loadPage)",
      fact: "The primary page fetch bypasses the override: loadPage calls global fetch with " +
        'redirect: "follow".',
    },
    {
      id: "S4",
      ...PIN,
      location: "packages/coding-agent/src/web/scrapers/utils.ts (fetchBinary)",
      fact: "The binary fetch bypasses it too: fetchBinary calls global fetch with redirect: " +
        '"follow".',
    },
    {
      id: "S5",
      ...PIN,
      location:
        "packages/coding-agent/src/tools/fetch.ts (tryMdSuffix, tryLlmEndpoints, markdown/feed " +
        "alternates, doc-link retry — all via loadPage/fetchBinary)",
      fact: "Secondary scraper URLs (markdown alternate, feed alternate, document-link retry, " +
        "llms.txt/.md probes) are fetched through loadPage/fetchBinary and inherit the S3/S4 " +
        "automatic-redirect bypass.",
    },
    {
      id: "S6",
      ...PIN,
      location:
        'packages/coding-agent/src/tools/read.ts (ReadTool name = "read"; parseReadUrlTarget → ' +
        "fetchReadUrl/executeReadUrl) + packages/coding-agent/src/tools/fetch.ts (fetchReadUrl, " +
        "materializeReadUrlToFile, executeReadUrl)",
      fact: "The model's URL read enters via the read tool's URL branch: parseReadUrlTarget " +
        "matches dispatch to executeReadUrl → fetchReadUrl → renderUrl; the file-shaped consumer " +
        "is materializeReadUrlToFile.",
    },
    {
      id: "S7",
      ...PIN,
      location: "packages/coding-agent/src/extensibility/extensions/types.ts (registerTool(tool: " +
        "ToolDefinition); ToolDefinition.execute; ctx.invokeTool on the delegation context)",
      fact:
        "The extension API exposes registerTool(tool: ToolDefinition); ToolDefinition carries " +
        "name, parameters, execute(...), onSession, and the native-delegation context.",
    },
    {
      id: "S8",
      ...PIN,
      location:
        "packages/coding-agent/src/sdk.ts (nativeToolsByName captured before the extension-tools-" +
        "over-registry loop; setNativeToolResolver) + extensibility/extensions/runner.ts " +
        "(getRegisteredTool, documented last-extension-wins)",
      fact: "Session construction captures the native built-ins BEFORE applying registered " +
        "extension tools over the registry (toolRegistry.set(tool.name, tool)), natives retained " +
        "in nativeToolsByName; getRegisteredTool is last-extension-wins and setNativeToolResolver " +
        "exposes the unwrapped native to same-tool ctx.invokeTool.",
    },
    {
      id: "S9",
      ...PIN,
      location: "packages/coding-agent/src/main.ts (createAcpSessionFactory; no fetch-transport " +
        "injection) + packages/coding-agent/src/sdk.ts (toolSession literal sets no fetch field)",
      fact: "No ACP-bootstrapped injection point populates ToolSession.fetch at the pin: the ACP " +
        "entry path contains no fetch-transport injection and the constructed toolSession literal " +
        "does not set fetch.",
    },
  ] as const,
);

/** Machine-readable route row per design D3 / tasks 3.1. */
export interface FetchRouteRow {
  readonly routeId: string;
  readonly mechanism: string;
  readonly status: FetchRouteStatus;
  readonly citations: readonly FetchRouteCitation[];
  /** Present on every blocked/pending row: never silently native. */
  readonly userDecisionRequired?: true;
  readonly notes: string;
}

const citation = (...ids: FetchRouteCitation["id"][]): FetchRouteCitation[] =>
  FETCH_ROUTE_CITATIONS.filter((c) => ids.includes(c.id));

const replacementMechanism = FETCH_COMPLETING_MECHANISM;

/**
 * The frozen route table. `completed-by-adapter` covers EXACTLY the read
 * URL-branch routes (text, binary, secondary hops, materialization
 * consumers); every search-provider subrequest route and every direct native
 * loadPage/fetchBinary route stays blocked with
 * `userDecisionRequired`. No mock result clears any blocked row.
 */
export const FETCH_ROUTE_TABLE: readonly FetchRouteRow[] = Object.freeze(
  [
    {
      routeId: "read.url-branch.text",
      mechanism: replacementMechanism,
      status: "completed-by-adapter",
      citations: citation("S6", "S7", "S8"),
      notes: "Page/markdown reads served by the adapter text route (manual per-hop validation, " +
        "MAX_OUTPUT_CHARS bound); native loadPage never invoked on this path. Mock-only " +
        "certification; native invocation stays on the section-15 checklist.",
    },
    {
      routeId: "read.url-branch.binary",
      mechanism: replacementMechanism,
      status: "completed-by-adapter",
      citations: citation("S6", "S7", "S8"),
      notes: "Image/convertible/archive reads served by the adapter binary route (content-length " +
        "pre-check + streaming cap + disposition/extension hints mirroring native fetchBinary " +
        "semantics); native fetchBinary never invoked on this path.",
    },
    {
      routeId: "read.url-branch.secondary-hops",
      mechanism: replacementMechanism,
      status: "completed-by-adapter",
      citations: citation("S5", "S6", "S7", "S8"),
      notes: "Scraper-derived secondary URLs (markdown/feed alternates, document-link retries, " +
        ".md/llms.txt probes) re-enter the SAME per-hop decision with the shared hop budget, " +
        "replacing the S5 loadPage/fetchBinary inheritance of automatic redirect following.",
    },
    {
      routeId: "read.url-branch.materialization-consumers",
      mechanism: replacementMechanism,
      status: "completed-by-adapter",
      citations: citation("S6", "S7", "S8"),
      notes: "File-shaped consumers of the URL branch (fetchReadUrl ensureArtifact / " +
        "materializeReadUrlToFile-equivalent) are served from adapter-fetched bodies; the " +
        "replacement asserts no new sink behavior — writes land on the unchanged row-4 sinks.",
    },
    {
      routeId: "enrichment.reader-providers",
      mechanism:
        "native ToolSession.fetch/fetchOverride seam (exists per S1/S2, enrichment reach only)",
      status: "partial-seam-not-selected",
      citations: citation("S1", "S2", "S9"),
      notes: "The seam exists but no supported ACP-bootstrapped injection point sets it (S9), so " +
        "it cannot complete URL reads on its own and is NOT the selected mechanism; reach is " +
        "reader-provider enrichment only. Promotion to a supported route requires a P0 revision.",
    },
    {
      routeId: "native.loadPage.direct",
      mechanism: 'none — global fetch with redirect: "follow" (P0-recorded bypass)',
      status: "blocked-pending-adapter",
      citations: citation("S3"),
      userDecisionRequired: true,
      notes: "For any caller outside the replacement, the primary page load keeps the P0 bypass " +
        "record permanently; this change's mocks can never clear it. Inside the replacement the " +
        "function is not invoked at all.",
    },
    {
      routeId: "native.fetchBinary.direct",
      mechanism: 'none — global fetch with redirect: "follow" (P0-recorded bypass)',
      status: "blocked-pending-adapter",
      citations: citation("S4"),
      userDecisionRequired: true,
      notes: "fetchBinary stays blocked permanently for callers outside the replacement " +
        "(DECIDED disposition); inside the replacement it is replaced by the adapter binary route.",
    },
    {
      routeId: "search-provider.subrequests",
      mechanism: "none — provider subrequests outside the replaced read tool",
      status: "blocked-pending-adapter",
      citations: citation("S2", "S5"),
      userDecisionRequired: true,
      notes: "Owned by the batch's row 20 (adapt-omp-web-search); for any caller outside the " +
        "replacement this row keeps the 14a allow-gated-pending-adapter outcome and the 14b " +
        "rejected_pending_adapter block permanently — the search adapter completes only the " +
        "registered owned web_search replacement's routes (row 20's table), never native " +
        "global-fetch provider traffic reaching this route.",
    },
  ] as const,
);

/** True when the route is completed by this change's adapter. */
export function isRouteCompleted(routeId: string): boolean {
  return FETCH_ROUTE_TABLE.find((row) => row.routeId === routeId)?.status ===
    "completed-by-adapter";
}

// ---------------------------------------------------------------------------
// Typed completion decision (C5 `admit-completed-omp-network-adapters` D1).
// ---------------------------------------------------------------------------

/** The controlled replacement tool name completing the URL branch (C2/C4). */
export const READ_URL_REPLACEMENT_TOOL = "read" as const;

/**
 * The completed read URL-branch route set. The seam decision consumes the
 * ROUTE SET: whether one call lands on the text or binary entry route is
 * content-decided inside the replacement, and every secondary hop re-enters
 * the same per-hop decision — hop-granular attribution lives in the
 * replacement's decision records, never in an admission result.
 */
export const READ_URL_COMPLETED_ROUTES: readonly string[] = Object.freeze([
  "read.url-branch.text",
  "read.url-branch.binary",
  "read.url-branch.secondary-hops",
  "read.url-branch.materialization-consumers",
]);

/** Inputs the route owner needs for the typed completion decision. */
export interface FetchReplacementAdmissionInput {
  /** The EXACT call tool name (route scope is name- plus provenance-keyed). */
  readonly toolName: string;
  /**
   * Fresh observation that a replacement is registered for this name AND its
   * recorded origin is the owned extension (14a provenance admission already
   * ran; this is the registration evidence, never a name-only claim).
   */
  readonly registeredOwnedReplacement: boolean;
}

/** Bounded typed completion verdict — a boundary record, never an allow. */
export type FetchReplacementAdmission =
  | {
    readonly admit: true;
    readonly routeIds: readonly string[];
    readonly mechanism: typeof FETCH_COMPLETING_MECHANISM;
  }
  | {
    readonly admit: false;
    readonly reason:
      | "replacement-name-mismatch"
      | "replacement-not-registered"
      | "route-not-completed";
  };

/**
 * C5's typed URL-read completion decision over this route owner's data, for
 * 14b's composition seam AFTER 14a's inventory and provenance admission. It
 * authorizes NOTHING itself: admitting means the completed controlled route
 * set covers this call's name, so the existing enforcement outcome may
 * PROCEED TO the named registered replacement; execution and every per-hop
 * transport decision stay inside that replacement. Absent or foreign names
 * keep the caller's bounded pending-adapter block.
 */
export function admitReadUrlReplacement(
  input: FetchReplacementAdmissionInput,
): FetchReplacementAdmission {
  if (input.toolName !== READ_URL_REPLACEMENT_TOOL) {
    return { admit: false, reason: "replacement-name-mismatch" };
  }
  if (!input.registeredOwnedReplacement) {
    return { admit: false, reason: "replacement-not-registered" };
  }
  // The EXACT completed routes, consumed from this table (design D1): a
  // route that stopped being `completed-by-adapter` never admits.
  const completed = READ_URL_COMPLETED_ROUTES.filter(isRouteCompleted);
  if (completed.length === 0) {
    return { admit: false, reason: "route-not-completed" };
  }
  return { admit: true, routeIds: completed, mechanism: FETCH_COMPLETING_MECHANISM };
}

/** The completing-adapter marker text appended to 14a's URL-read row. */
export const FETCH_COMPLETING_ADAPTER_MARKER =
  "COMPLETING-ADAPTER: control-omp-url-fetch-transport — read URL-branch routes (text, binary, " +
  "secondary hops, materialization consumers) completed via src/acp/omp/fetch-routes.ts " +
  "FETCH_ROUTE_TABLE. This marker names the completing adapter for those routes only; it is NOT " +
  "a plain allow, never covers the webfetch tool surface or search routes, and the " +
  "allow-gated-pending-adapter outcome below still fails closed at 14b with the bounded pending " +
  "reason whenever the registered owned replacement or a completed controlled route is absent.";
