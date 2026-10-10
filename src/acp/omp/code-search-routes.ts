/**
 * Machine-readable Public-Code-Search route enumeration (row 21,
 * `adapt-omp-public-code-search`, design D1-D6).
 *
 * One row per pinned public-code-search surface: the GitHub Code Search API
 * adapter route the reserved trusted-extension `registerTool` completion
 * WOULD serve (tiered `no-supported-mechanism` with `userDecisionRequired`
 * while the supported-credential predicate is unsatisfied), the native
 * `github` tool's `search_code` external-CLI surface (`no-supported-mechanism`:
 * absent binary, gh auth store, subprocess transport outside the decision
 * core), the keyless scraping handlers (`candidate-to-verify` — NOT selected
 * as a dedicated backend; they remain validated secondary hops inside row
 * 17's completed URL-read route), and the URL-read content path
 * (`completed-by-adapter` BY rows 17/18 — recorded as reference, never
 * claimed by this change). Citations C1-C9 are the pinned-source facts
 * re-verified against OpenCode tag `v1.18.21` (tree
 * `826d9ad46a22bef0294998e08daa3c4904fea28f`) and OMP `v18.6.1` / commit
 * `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` — static reads of the pinned
 * sources, never executed native behavior.
 *
 * Parity baseline stated plainly: OpenCode REMOVED its `codesearch` tool
 * upstream before the packaging pin (commit `2481dde36d9aeb48de9fb21ffd2cdf
 * dc1d42804f1`, "chore: remove codesearch tool (#27019)", 2026-05-12), so
 * `agent-config/opencode.json`'s `codesearch: "allow"` rule binds to no
 * shipped tool id; the batch's grep_app/gh_grep external-skill premise is
 * FALSE at the pins (no such skill ships, `GREP_APP_API_TOKEN` exists
 * nowhere, and neither agent credential set carries a code-search token).
 *
 * Honesty invariants: statuses use the P0/row-17/row-18 vocabulary tiers;
 * NO row claims `supported`; NO trusted-extension tool is registered in
 * this state — the 6th serial-extension slot of the 12→13→14b→17→18 tree is
 * RESERVED by this contract, unconsumed (see `CODE_SEARCH_RESERVED_MECHANISM`).
 * The reserved completion is ALSO unconsumable by the current 14b
 * composition, which blocks every `allow-gated-pending-adapter` outcome at
 * `rejected_pending_adapter` without consulting completed-route seam state
 * (the batch ownership gap recorded in docs/OMP_NETWORK.md): a live route
 * needs the credential provisioning, the composition-side seam-state step,
 * AND the design section-15 user observation. The mock suites certify this
 * change's adapter decisions only and can never clear the P0 bypass record
 * or the premise-false D4 finding.
 *
 * Module-load discipline (installed-closure safety): imports ONLY
 * `./compatibility-contracts.ts` (pin constants) and a type-only import from
 * the transport module; zero env/DNS/network side effects at load.
 */

import { PINNED_OMP_COMMIT, PINNED_OMP_VERSION } from "./compatibility-contracts.ts";
import type { CodeSearchCredentialPresence } from "./code-search-transport.ts";

/** The OpenCode packaging pin (tree hash + removal commit), frozen data. */
export const PINNED_OPENCODE_TAG = "v1.18.21";
export const PINNED_OPENCODE_TREE = "826d9ad46a22bef0294998e08daa3c4904fea28f";
export const OPENCODE_CODESEARCH_REMOVAL_COMMIT = "2481dde36d9aeb48de9fb21ffd2cfdc1d42804f1";

/** The P0 vocabulary tiers used by this table; no row claims `supported`. */
export type CodeSearchRouteStatus =
  | "completed-by-adapter"
  | "candidate-to-verify"
  | "no-supported-mechanism";

/**
 * The reserved completion mechanism (D4), stated once for its rows: NO tool
 * is registered now; this is what a post-provisioning completion would use.
 */
export const CODE_SEARCH_RESERVED_MECHANISM =
  "RESERVED — no tool registered in this state: trusted-extension registerTool " +
  "name-addition/replacement of a code-search surface (last-extension-wins, row-17 " +
  "S7/S8), landing as the 6th serial sibling of the 12→13→14b→17→18 extension tree; " +
  "the restricted branch would be served entirely by the code-search adapter over the " +
  "row-17 controlled transport with YOLO delegation to the captured native via the " +
  "same-tool ctx.invokeTool resolver, 14b gating first, single decision path";

/** One pinned-source citation backing a route verdict. */
export interface CodeSearchRouteCitation {
  readonly id: "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9";
  readonly ompVersion: string;
  readonly ompCommit: string;
  readonly opencodeTag: string;
  readonly opencodeTree: string;
  readonly location: string;
  readonly fact: string;
}

const PIN = {
  ompVersion: PINNED_OMP_VERSION,
  ompCommit: PINNED_OMP_COMMIT,
  opencodeTag: PINNED_OPENCODE_TAG,
  opencodeTree: PINNED_OPENCODE_TREE,
} as const;

/** The frozen C1-C9 citation set (re-verified at the pins; zero drift). */
export const CODE_SEARCH_ROUTE_CITATIONS: readonly CodeSearchRouteCitation[] = Object.freeze(
  [
    {
      id: "C1",
      ...PIN,
      location: "sst/opencode tag v1.18.21 tree 826d9ad4…?recursive=1 (no " +
        "`packages/opencode/src/tool/codesearch.ts`, raw fetch 404, no path matching " +
        "`codesearch`/`code-search`) + GitHub commits API for that path",
      fact:
        "OpenCode's public-code-search tool is REMOVED upstream before the packaging pin: the " +
        "last commit touching that path is 2481dde36d9aeb48de9fb21ffd2cfdc1d42804f1 — " +
        '"chore: remove codesearch tool (#27019)", 2026-05-12T08:14:02Z. The parity baseline ' +
        "itself ships no code-search tool.",
    },
    {
      id: "C2",
      ...PIN,
      location:
        "packages/opencode/src/tool/registry.ts (tool instantiation + tools() filter, tag tree) " +
        "+ agent-config/opencode.json `permissions`",
      fact: 'The `codesearch: "allow"` rule in agent-config/opencode.json is INERT: the 1.18.21 ' +
        "registry builds tool ids from instantiated tools only and no `codesearch` id exists to " +
        "match, so the permission rule binds to no shipped tool.",
    },
    {
      id: "C3",
      ...PIN,
      location:
        "packages/opencode/src/tool/mcp-websearch.ts (EXA_URL/PARALLEL_URL keyless hosted MCP " +
        "endpoints), tool/websearch.ts, tool/registry.ts (webSearchEnabled)",
      fact: "What OpenCode retains for public code/docs access is webfetch URL reads plus the " +
        "Exa/Parallel hosted-MCP websearch (row 18's domain) — neither is a code-index search " +
        "backend.",
    },
    {
      id: "C4",
      ...PIN,
      location:
        "repo audit: skills/ tree (memory/reply/reminders/fetch-context/react/agent-browser, " +
        "no code-search skill), repo-wide search for grep_app/grep.app/gh_grep/GREP_APP_API_TOKEN " +
        "(zero hits), .env.example:74 + config.example.yaml MCP-server example comment, " +
        "src/core/git-backup-service.ts + src/core/git-credential-setup.ts (the only " +
        "GITHUB_TOKEN consumers), docs/DESIGN.md env table",
      fact:
        "The repository ships NO grep_app/gh_grep code-search skill and NO GREP_APP_API_TOKEN " +
        "anywhere; GITHUB_TOKEN's only registered consumers are git backup/credential-store " +
        "(documented independent of any agent). The batch's external-skill premise is false at " +
        "the pins.",
    },
    {
      id: "C5",
      ...PIN,
      location:
        "src/core/skill-installer.ts (installExternalSkills: npx installer, no per-skill env " +
        "plumbing) + src/acp/sandbox-manager.ts (AGENT_TYPE_ENV.opencode/omp credential sets " +
        "carry no GitHub credential; NEVER_PASS_ENV includes GITHUB_TOKEN)",
      fact:
        "External skills are a generic operator mechanism that ships nothing code-search-related " +
        "and has no per-skill token plumbing; neither agent credential set reaches a subprocess " +
        "with a GitHub credential, and NEVER_PASS_ENV removes the operator allowedEnvVars escape " +
        "hatch for GITHUB_TOKEN.",
    },
    {
      id: "C6",
      ...PIN,
      location:
        "packages/coding-agent/src/tools/builtin-names.ts (BUILTIN_TOOL_NAMES: read/bash/edit/" +
        "ast_grep/ast_edit/ask/debug/ida/eval/github/glob/grep/find/lsp/…/web_search/… — no " +
        "code-search entry) + tools/index.ts (github: GithubTool.createIf) + web/search/" +
        "provider.ts (no code-index backend in either search registry)",
      fact: "Pinned OMP has NO code-search tool and no gh_grep-style search provider; the only " +
        "public-code-search surface is the `github` tool's `search_code`, which shells out to " +
        "the external `gh` CLI.",
    },
    {
      id: "C7",
      ...PIN,
      location: "packages/coding-agent/src/tools/gh-search.ts (executeSearchCode, " +
        'buildGhApiSearchArgs("code", …), Accept: application/vnd.github.text-match+json) + ' +
        "utils/github.ts (GH_NON_INTERACTIVE_ENV = { ...process.env, … }, gh-auth-store failure " +
        'text "GitHub CLI is not authenticated. Run `gh auth login`.") + Containerfile (no `gh` ' +
        "install)",
      fact:
        "`github search_code` is credential- and transport-hostile under this deployment: gh's " +
        "own auth store (never provisioned), subprocess HTTP invisible to any fetch-level " +
        "decision core (env-proxy honoring is the documented non-enforcement best-effort), and " +
        "the image installs no `gh` binary at all.",
    },
    {
      id: "C8",
      ...PIN,
      location:
        "packages/coding-agent/src/web/scrapers/index.ts (specialHandlers: handleSearchcode, " +
        "handleSourcegraph, handleGitHub, handleGitLab, handleReadTheDocs, …) + web/scrapers/" +
        "searchcode.ts (VALID_HOSTS, /api/codesearch_I/?q=…, /api/result/<id>/) + tools/fetch.ts " +
        "(loadSpecialHandlers lazy import)",
      fact:
        "Pinned OMP's keyless code/docs scraping exists ONLY as fetch-pipeline special handlers " +
        "(model-supplied URL → provider-API secondary), not search tools — exactly the " +
        "secondary-URL class row 17 already routes through the controlled transport when the " +
        "adapter serves the read.",
    },
    {
      id: "C9",
      ...PIN,
      location: "packages/coding-agent/src/tools/gh-search.ts (SEARCH_LIMIT_DEFAULT = 10, " +
        "SEARCH_LIMIT_MAX = 50, FILE_PREVIEW_LIMIT = 50, resolveSearchLimit, " +
        "apiCodeToSearchResult, formatSearchCodeResults: { path, repository: { nameWithOwner } } " +
        "+ text-match excerpts) + utils/github.ts (GH_OUTPUT_LIMIT_BYTES 8 MiB truncation marker)",
      fact:
        "The pinned observable bounds and attribution shape for code search: limit default 10 / " +
        "max 50, per-item preview 50, repo nameWithOwner + path attribution, bounded output — " +
        "the reference the interface-parity contract documents.",
    },
  ] as const,
);

/** Machine-readable route row per design D1/D4 / tasks 3.1. */
export interface CodeSearchRouteRow {
  readonly routeId: string;
  readonly mechanism: string;
  readonly status: CodeSearchRouteStatus;
  readonly citations: readonly CodeSearchRouteCitation[];
  readonly userDecisionRequired?: true;
  readonly notes: string;
}

function citation(
  ...ids: readonly CodeSearchRouteCitation["id"][]
): readonly CodeSearchRouteCitation[] {
  return CODE_SEARCH_ROUTE_CITATIONS.filter((c) => (ids as readonly string[]).includes(c.id));
}

/**
 * The supported-credential predicate as DATA (D2): the approved credential
 * path (row 7's `AGENT_TYPE_ENV.omp` set plus its credential-store
 * equivalent) registers NO code-search credential name at these pins, so
 * the predicate is currently `null` and structurally unsatisfiable. The
 * seam marker and the tests consume THIS single source — a future row-7
 * credential-set revision registering a separate read-only code-search
 * credential flips this value and nothing else. A credential whose
 * registered purpose is another subsystem (e.g. the git-backup token) NEVER
 * satisfies the predicate, and no NEVER_PASS name is ever consulted,
 * logged, or passed.
 */
export const CODE_SEARCH_SUPPORTED_CREDENTIAL_NAME: string | null = null;

/**
 * The frozen route table. NO row is `completed-by-adapter` for a
 * code-search backend by this change: every backend-specific route tiers
 * non-supported (credential gate unpassed; gh binary/auth/transport; keyless
 * scraping refused) and the `completed-by-adapter` row is the URL-READ
 * content path completed by rows 17/18 — recorded as reference only.
 */
export const CODE_SEARCH_ROUTE_TABLE: readonly CodeSearchRouteRow[] = Object.freeze(
  [
    {
      routeId: "code_search.github-api",
      mechanism: CODE_SEARCH_RESERVED_MECHANISM,
      status: "no-supported-mechanism",
      userDecisionRequired: true,
      citations: citation("C1", "C2", "C4", "C5", "C6", "C9"),
      notes:
        "The GitHub Code Search API (`api.github.com/search/code` — what OpenCode's removed tool " +
        "and OMP's gh-search wrapper wrap) is the route the RESERVED registerTool completion " +
        "would serve over the row-17 controlled transport with the C9 interface-parity bounds. " +
        "Under the current credential set it is no-supported-mechanism: the approved path " +
        "registers no code-search credential (C4/C5), the parity baseline itself removed the tool " +
        "upstream (C1) and its permission rule is inert (C2), and consuming the git-backup " +
        "GITHUB_TOKEN would promote a NEVER_PASS repo-write-capable secret into the restricted " +
        "agent — refused by design D2, never reconsidered here. Completion needs a separate " +
        "read-only code-search credential provisioned via row 7's approved config path (user " +
        "decision), plus the 14b completed-route seam-state step and the section-15 observation.",
    },
    {
      routeId: "code_search.native.github-cli-search-code",
      mechanism: "none — the native `github` tool's search_code spawns the external `gh` binary " +
        "(subprocess transport outside the decision core)",
      status: "no-supported-mechanism",
      userDecisionRequired: true,
      citations: citation("C6", "C7"),
      notes:
        "Pinned OMP's only code-search surface: `gh api /search/code` through utils/github.ts " +
        "with gh's OWN auth store (never provisioned; GITHUB_TOKEN/GH_TOKEN are NEVER_PASS and " +
        "never reach the agent env) and subprocess HTTP invisible to the row-17 decision core " +
        "(env-proxy honoring is non-enforcement best-effort). The image installs no `gh` binary. " +
        "14a default-denies the `github` tool and this change never adds a second transport path " +
        "around the adapter.",
    },
    {
      routeId: "code_search.scraping-handlers",
      mechanism: "none — keyless scraping handlers exist but were NOT selected as a backend",
      status: "candidate-to-verify",
      userDecisionRequired: true,
      citations: citation("C8"),
      notes: "searchcode.com/Sourcegraph keyless handlers (C8) need no secret but are " +
        "operator-unconfigured arbitrary-provider scraping backends — the exact class row 18 " +
        "refused to select (DECIDED: scraper redirect-following bypass routes stay blocked; " +
        "admitting a tool over them would add arbitrary-provider config, which this change " +
        "never does). Their EXISTENCE as validated secondary hops INSIDE row 17's completed " +
        "URL-read route is separate and unchanged: a read of a public searchcode/sourcegraph/" +
        "readthedocs URL already flows through the controlled transport.",
    },
    {
      routeId: "code_search.url-read-content-path",
      mechanism:
        "row-17/row-18 completed URL-read routes (read URL-branch + special-handler secondary " +
        "hops over the controlled transport) — reference row, never claimed by this change",
      status: "completed-by-adapter",
      citations: citation("C3", "C8"),
      notes:
        "Public code/docs CONTENT remains reachable through the completed URL-read route (rows " +
        "17/18, incl. the C8 special handlers as validated secondary hops). This row RECORDS " +
        "that reference fact so the design §6/D4 parity decomposition is machine-readable; the " +
        "completion belongs to rows 17/18's tables and this change claims none of it. A " +
        "URL-read content path is not a code-index search backend.",
    },
  ] as const,
);

/** True when a code-search BACKEND route is completed by this change (never, today). */
export function isCodeSearchRouteCompleted(routeId: string): boolean {
  const row = CODE_SEARCH_ROUTE_TABLE.find((r) => r.routeId === routeId);
  return row?.status === "completed-by-adapter" && routeId !== "code_search.url-read-content-path";
}

/** The completing-adapter marker text appended additively to 14a's code-search row. */
export const CODE_SEARCH_COMPLETING_ADAPTER_MARKER =
  "COMPLETING-ADAPTER: adapt-omp-public-code-search — names this change's adapter contract " +
  "(src/acp/omp/code-search-transport.ts) and route table (src/acp/omp/code-search-routes.ts " +
  "CODE_SEARCH_ROUTE_TABLE) as the completing mechanism for the public-code-search route, " +
  "ACTIVE exactly where the route table's supported-credential predicate holds " +
  "(codeSearchSeamState). Under the current credential set that predicate is unsatisfiable " +
  "(no code-search credential is registered via the approved path), so this gate NEVER fires; " +
  "the reserved registerTool completion is additionally unconsumable by the current 14b " +
  "composition until the completed-route seam-state step lands. This marker names the " +
  "completing contract for that route only; it is NOT a plain allow, never covers the native " +
  "github search_code surface or any keyless scraping backend, and the " +
  "allow-gated-pending-adapter outcome below still fails closed at 14b " +
  "(rejected_pending_adapter).";

/** The seam state of the code-search row for a given credential presence. */
export type CodeSearchSeamState =
  | { readonly state: "adapter-completing"; readonly mechanism: "reserved-registerTool-slot" }
  | { readonly state: "pending-blocked"; readonly reason: "no-supported-credential" };

/**
 * Backend gate for the seam (D2/D6): the 14a marker is ACTIVE exactly where
 * a supported read-only code-search credential is present — which, while
 * `CODE_SEARCH_SUPPORTED_CREDENTIAL_NAME` is null, is nowhere: the state is
 * always `pending-blocked` (14b `rejected_pending_adapter` semantics
 * preserved, kind unchanged). Pure over the presence input; reads no env,
 * logs nothing.
 */
export function codeSearchSeamState(
  presence: CodeSearchCredentialPresence,
): CodeSearchSeamState {
  if (CODE_SEARCH_SUPPORTED_CREDENTIAL_NAME !== null && presence.dedicatedCodeSearchToken) {
    return { state: "adapter-completing", mechanism: "reserved-registerTool-slot" };
  }
  return { state: "pending-blocked", reason: "no-supported-credential" };
}
