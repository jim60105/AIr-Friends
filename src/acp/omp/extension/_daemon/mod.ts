/**
 * Image-Mapped Re-Export Barrel for the Trusted Extension (row 20 D5).
 *
 * OpenSpec change `wire-omp-restricted-tool-enforcement` (row 16) owns this
 * barrel: every 14a pure-decision import the extension siblings take
 * (`enforcement.ts`, `enforcement-error.ts`) resolves THROUGH here, so the
 * extension tree's import surface stays inside the tree and the daemon-side
 * copies at `src/acp/omp/` remain the single authoring location (copy
 * direction: daemon tree → installed extension only, never reverse).
 *
 * Resolution: the specifiers below point at the committed sources in the
 * development checkout. Row 20's install-mapping (D5): the Containerfile
 * install step copies the declared pure-decision closure files verbatim from
 * these same committed sources into `/opt/air/omp/extension/_daemon/` under
 * their repo-relative basenames and installs the image-mode mapping of THIS
 * barrel beside them — the same export list with `./<basename>.ts`
 * specifiers, a pure re-export mapping and no logic duplication. Dev mode
 * therefore resolves the committed files through the specifiers below; the
 * image resolves byte-identical copies. Row 20 owns the closure-file list
 * and the digest recut; this change extends the declared list with the pure
 * modules the enforcement siblings consume (14a's four decision files plus
 * the type-only supporting modules below) — the manifest recut rides row
 * 20's install step, which has not landed yet.
 *
 * The re-exports below are the modules' OWN surfaces; this barrel contains
 * no logic, no policy, and no re-derivation.
 */

export {
  ALTERNATE_ROUTE_BLOCKING_TABLE,
  type AlternateRoutePair,
  type CompletingAuthority,
  decideMcpAdmission,
  decideRestrictedTool,
  INPUT_SHAPE_CAPABILITIES,
  type InputShape,
  type InventoryRow,
  type InventoryRowKind,
  type McpAdmissionDecision,
  type McpAdmissionRequest,
  RESTRICTED_DENIAL_VOCABULARY,
  RESTRICTED_TOOL_INVENTORY_TABLE,
  type RestrictedDenialReason,
  type RestrictedToolDecision,
  type RestrictedToolDecisionRequest,
  restrictedToolPolicyGates,
  type RouteSurface,
  SECURITY_RELEVANT_SETTING_KEYS,
} from "../../tool-inventory.ts";

export {
  evaluateToolProvenance,
  MCP_ADMISSION_MECHANISM_STATUS,
  type McpAdmissionBasis,
  type McpAdmissionMechanismRow,
  type OperatorMcpProvenance,
  type OwnedExtensionProvenance,
  type ProvenanceDecision,
  type ProvenanceEvaluationOptions,
  type ProvenanceRecord,
  type ToolOrigin,
  type UntrustedProvenance,
} from "../../tool-provenance.ts";

export {
  type ApprovalRecordInterpretation,
  type ApprovalRecordInterpretationRequest,
  interpretApprovalRecords,
  restrictedDenialWithRecordNaming,
} from "../../approval-records.ts";

export {
  type ConformanceObservationAdapter,
  decideDestructiveIntent,
  DESTRUCTIVE_CONFORMANCE_TABLE,
  type DestructiveConformanceReplay,
  type DestructiveDecision,
  type DestructiveDecisionRequest,
  replayConformanceFixtures,
} from "../../destructive-decision.ts";

// Supporting pure modules the enforcement siblings consume (type-only or
// pure-data). Row 20's closure list carries these basenames as well; the
// copy step preserves repo-relative basenames so the specifiers above and
// here resolve identically in dev and at the installed root.
export type { DestructiveIntentInput } from "../../compatibility-contracts.ts";
export type { EffectiveRecordEvaluation, SettingsLayerHierarchy } from "../../record-evaluator.ts";
export type { CanonicalTarget, RootPathResult } from "../../../filesystem-roots.ts";
export type {
  AuthorizeWriteParams,
  FilesystemAuthorizationResult,
  FilesystemDenialReason,
} from "../../../filesystem-policy.ts";
export type { ApprovalAction, ApprovalRecord } from "../../compatibility-contracts.ts";

// Row 19 (`control-omp-url-fetch-transport`) extends the declared closure
// with the URL-fetch transport adapter's pure modules. CLOSURE NOTE FOR ROW
// 22's DIGEST CUT: `src/acp/omp/fetch-transport.ts` transitively imports
// `src/utils/ssrf.ts` (the single classifier: isDisallowedAddress,
// MAX_REDIRECT_HOPS, pinValidatedUrl), so the install copy list MUST carry
// `ssrf.ts` under its repo-relative basename as well — the import is
// load-safe precisely because `Deno.resolveDns` sits only in ssrf.ts's
// NON-imported `resolveHostAddresses`; the imported surface performs no
// DNS/env/network side effect at module load.
export {
  type BinaryFetchResult,
  decideFetchHop,
  deriveFetchEgressPolicy,
  disallowedAddressClass,
  extensionHintFor,
  fetchBinaryRoute,
  type FetchBlockReason,
  type FetchDecisionDeps,
  type FetchDecisionRecord,
  fetchDecisionRecord,
  type FetchEgressConfigFacts,
  type FetchEgressPolicy,
  fetchEgressPolicyFromAgentEnv,
  type FetchHopDecision,
  type FetchHopInput,
  type FetchHopType,
  type FetchRoutePlan,
  fetchShapedRoute,
  fetchTextRoute,
  type FetchTransportDeps,
  type FetchTransportFn,
  formatFetchDecisionLog,
  isBinaryContentShape,
  issueValidatedHop,
  MAX_BINARY_BYTES,
  MAX_TEXT_OUTPUT_CHARS,
  planFetchRoute,
  productionFetchTransport,
  type ResolveHost,
  runFetchChain,
  runSecondaryFetch,
  type ShapedFetchResult,
} from "../../fetch-transport.ts";

export {
  FETCH_COMPLETING_ADAPTER_MARKER,
  FETCH_COMPLETING_MECHANISM,
  FETCH_ROUTE_CITATIONS,
  FETCH_ROUTE_TABLE,
  type FetchRouteCitation,
  type FetchRouteRow,
  type FetchRouteStatus,
  isRouteCompleted,
} from "../../fetch-routes.ts";

// Row 20 (`adapt-omp-web-search`) extends the declared closure with the
// web-search transport adapter's pure modules. CLOSURE NOTE FOR ROW 22'S
// DIGEST CUT: `src/acp/omp/search-transport.ts` imports ONLY
// `./fetch-transport.ts` (row 17's decision core, already in the closure)
// and `src/acp/omp/search-routes.ts` imports only
// `./compatibility-contracts.ts` (pin constants, type-only import of
// search-transport presence) — both already covered; the new installed
// INPUTS this row adds to the PACKAGE-MANIFEST recut are
// `search-transport.ts`, `search-routes.ts`, and
// `extension/search-replacement.ts` (plus the modified `tool-inventory.ts`,
// `extension/index.ts`, and this barrel). The imported surface performs no
// DNS/env/network side effect at module load (credentials/env are read
// only inside called functions), so the barrel stays load-safe.
export {
  buildGeminiSearchRequest,
  buildOpenRouterSearchRequest,
  type BuiltSearchRequest,
  type SearchBlockReason,
  type SearchCredentialBlock,
  type SearchCredentialBlockReason,
  credentialPresenceFromEnv,
  type SearchCredentialPresence,
  type SearchDecisionDeps,
  type SearchDecisionRecord,
  decideSearchRoute,
  ENRICHMENT_TIMEOUT_MS,
  formatSearchCount,
  formatSearchAge,
  formatSearchDecisionLog,
  formatSearchForLLM,
  formatSearchProviderFailure,
  formatSearchTruncate,
  hasRenderableSearchContent,
  isGroundingRedirectUrl,
  MAX_ENRICHMENT_SUBREQUESTS,
  MAX_ERROR_BODY_CHARS,
  MAX_SEARCH_QUERY_CHARS,
  MAX_SEARCH_RESPONSE_BYTES,
  MAX_SEARCH_RESULTS_CAP,
  parseGeminiSearchStreamText,
  parseOpenRouterSearchResponse,
  parseSearchToolInput,
  PINNED_SEARCH_ENDPOINTS,
  resolveGroundingRedirectThroughTransport,
  runSearchRoute,
  SEARCH_BACKEND_LABELS,
  searchFailureEnvelope,
  searchNoModelConfiguredEnvelope,
  searchNoSourcesFailure,
  SearchProviderFailure,
  searchSuccessEnvelope,
  selectSearchBackend,
  SUPPORTED_SEARCH_CREDENTIAL_ENV,
  type SearchRouteInput,
  type SearchRouteDecision,
  type SearchRouteResult,
  type SearchToolEnvelope,
  type SearchToolQuery,
  type SearchTransportDeps,
  type SearchUsage,
  type SearchSource,
  type SearchCitation,
  type SearchResponse,
  type SupportedSearchBackend,
} from "../../search-transport.ts";

export {
  SEARCH_COMPLETING_ADAPTER_MARKER,
  SEARCH_COMPLETING_MECHANISM,
  SEARCH_ROUTE_CITATIONS,
  SEARCH_ROUTE_TABLE,
  type SearchRouteCitation,
  type SearchRouteRow,
  type SearchRouteStatus,
  isSearchRouteCompleted,
  webSearchSeamState,
  type WebSearchSeamState,
} from "../../search-routes.ts";
