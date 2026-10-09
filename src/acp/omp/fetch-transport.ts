/**
 * Controlled URL-Fetch Transport Adapter — pure decision core (row 19,
 * `control-omp-url-fetch-transport`).
 *
 * Owns every URL-read transport decision for the restricted OMP deployment:
 * for a model-supplied URL read or a scraper-derived secondary URL, the core
 * decides `allow-direct | allow-via-proxy | block { reason }` from the URL,
 * the CONSUMED egress posture, and an injectable DNS/transport boundary.
 *
 * Rule-source discipline: `src/utils/ssrf.ts` is the SINGLE classifier. This
 * module imports `isDisallowedAddress`, `MAX_REDIRECT_HOPS`, and
 * `pinValidatedUrl` verbatim and never re-implements, forks, or softens a
 * rule; `ssrf.ts` stays read-only. Address-class labels on blocks are
 * diagnostic naming produced only AFTER the shared classifier has already
 * rejected the address — never an allow path.
 *
 * Transport facts (task 4.3): the egress posture values
 * (`agent.sandbox.egressProxy`, `agent.sandbox.unrestrictedEgress`) and the
 * running validating-proxy endpoint (`getRunningEgressProxyUrl()`) are
 * consumed, never redefined, and no new config/env/Helm field exists.
 * `fetchEgressPolicyFromAgentEnv` below is the agent-process read of those
 * existing bootstrap facts: the factory writes `HTTP_PROXY`/`HTTPS_PROXY`
 * ONLY under the enforcing posture (`egressProxy && !unrestrictedEgress`)
 * with a RUNNING proxy (`src/acp/agent-factory.ts`, best-effort env
 * assembly left untouched). This core consumes the endpoint as a ROUTING
 * fact; it is emphatically NOT an enforcement signal — `HTTP_PROXY` presence
 * alone has never established enforcement (a client that ignores the env
 * vars escapes mediation; that pre-existing F14 residual is unchanged and
 * documented in `docs/OMP_NETWORK.md`). The authoritative boundary for
 * adapted URL reads is this adapter's per-hop decision plus the validating
 * proxy, and the empty-netns/kernel-guarantee deferral stays as recorded.
 *
 * Trust separation (design §9/D5): the Skill API loopback endpoint,
 * operator-configured provider endpoints, and the proxy endpoint itself are
 * fixed deployment transport facts fixed at spawn — they are NOT inputs to
 * `decideFetchHop`, never widen the model-target decision, and the presence
 * of a trusted loopback call never authorizes a model fetch to an arbitrary
 * loopback/private target.
 *
 * D6: no YOLO-only network denial exists anywhere in this module. Both
 * postures run the identical shared rule set; the posture changes routing
 * only.
 *
 * Credential discipline (D6/D1 records): decision records and log lines
 * carry `{ host, hopIndex, decision, reason }` ONLY — no URL userinfo,
 * query, headers, credentials, or payload bytes are representable in the
 * record type.
 */

import {
  isDisallowedAddress,
  MAX_REDIRECT_HOPS,
  pinValidatedUrl,
} from "../../utils/ssrf.ts";

// The shared bound is re-exported (never copied) so consumers and tests
// consume the same constant ssrf.ts owns.
export { MAX_REDIRECT_HOPS };

// ---------------------------------------------------------------------------
// Egress posture (consumed vocabulary; never redefined).
// ---------------------------------------------------------------------------

/**
 * The consumed egress posture. `enforcing` = `egressProxy &&
 * !unrestrictedEgress` with a running validating proxy; `unrestricted` = the
 * operator's explicit unrestricted-egress opt-in; `unresolved` = the facts
 * could not be consumed (fail-closed: every hop blocks with
 * `egress-policy-unresolved`).
 */
export type FetchEgressPolicy =
  | { readonly posture: "enforcing"; readonly proxyEndpoint: string }
  | { readonly posture: "unrestricted" }
  | { readonly posture: "unresolved" };

/** The consumed config/bootstrap inputs, verbatim field names. */
export interface FetchEgressConfigFacts {
  readonly egressProxy: boolean;
  readonly unrestrictedEgress: boolean;
  /** `getRunningEgressProxyUrl()` output: set only while the proxy runs. */
  readonly runningProxyUrl: string | undefined;
}

/**
 * Derive the consumed posture from the daemon-side config values and the
 * bootstrap proxy singleton (task 4.3: existing singletons only, no new
 * field). Enforcing requires the running endpoint — a configured-but-dead
 * proxy resolves to nothing and fails closed as `unresolved`.
 */
export function deriveFetchEgressPolicy(
  facts: FetchEgressConfigFacts,
): FetchEgressPolicy {
  if (facts.egressProxy && !facts.unrestrictedEgress) {
    return facts.runningProxyUrl
      ? { posture: "enforcing", proxyEndpoint: facts.runningProxyUrl }
      : { posture: "unresolved" };
  }
  if (facts.unrestrictedEgress) {
    return { posture: "unrestricted" };
  }
  return { posture: "unresolved" };
}

const LOOPBACK_PROXY_URL =
  /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d{1,5})?$/i;

/**
 * The agent-process read of the SAME bootstrap facts: the factory writes
 * `HTTP_PROXY`/`HTTPS_PROXY` pointing at the local validating proxy ONLY
 * under the enforcing posture with a running proxy (agent-factory.ts); under
 * the unrestricted opt-in it writes none. Therefore a well-formed loopback
 * proxy URL reports `enforcing` with that endpoint; its absence reports the
 * operator-selected unrestricted posture; a malformed or non-loopback value
 * is inconsistent with every AIr-managed launch and fails closed as
 * `unresolved`.
 *
 * Honesty table (full text in docs/OMP_NETWORK.md): the presence read here
 * selects ROUTING for adapted reads; it does not gate, and never gated, the
 * native clients' mediation — a client that ignores the env vars still
 * escapes the proxy (pre-existing F14 residual), and the loopback NO_PROXY
 * carve-out stays host-wide (unchanged, documented).
 */
export function fetchEgressPolicyFromAgentEnv(
  env: Record<string, string | undefined> = defaultAgentEnv(),
): FetchEgressPolicy {
  const proxyUrl = env["HTTPS_PROXY"] ?? env["https_proxy"] ?? env["HTTP_PROXY"] ??
    env["http_proxy"];
  if (proxyUrl === undefined || proxyUrl === "") {
    return { posture: "unrestricted" };
  }
  return LOOPBACK_PROXY_URL.test(proxyUrl)
    ? { posture: "enforcing", proxyEndpoint: proxyUrl }
    : { posture: "unresolved" };
}

function defaultAgentEnv(): Record<string, string | undefined> {
  try {
    if (typeof process !== "undefined" && process.env) return process.env;
  } catch {
    // Environment unreadable: the caller's injected env seam stays the test
    // and wiring surface; production defaults fail closed via `unresolved`.
  }
  return {};
}

// ---------------------------------------------------------------------------
// Decision vocabulary.
// ---------------------------------------------------------------------------

/** Hop kinds: initial model URL, redirect target, scraper-derived secondary. */
export type FetchHopType = "initial" | "redirect" | "secondary";

/** Input shape for one hop decision. */
export interface FetchHopInput {
  readonly url: string;
  readonly hopType: FetchHopType;
  /** Redirect hops ALREADY followed when this hop is decided (0 at hop 1). */
  readonly hopsFollowed: number;
}

/**
 * Decision reason codes: `disallowed-scheme`, `url-unparseable`,
 * `dns-unresolved`, `dns-invalid-answer`, `disallowed-address` (the shared
 * classifier's rejection; `addressClass` names it diagnostically),
 * `cloud-metadata` (never exemptable), plus the adapter-only reasons
 * `hop-limit-exceeded` and `egress-policy-unresolved`.
 */
export type FetchBlockReason =
  | "disallowed-scheme"
  | "url-unparseable"
  | "dns-unresolved"
  | "dns-invalid-answer"
  | "disallowed-address"
  | "cloud-metadata"
  | "hop-limit-exceeded"
  | "egress-policy-unresolved";

export type FetchHopDecision =
  | { readonly decision: "allow-direct"; readonly record: FetchDecisionRecord }
  | {
    readonly decision: "allow-via-proxy";
    readonly proxyEndpoint: string;
    readonly record: FetchDecisionRecord;
  }
  | {
    readonly decision: "block";
    readonly reason: FetchBlockReason;
    readonly addressClass?: string;
    readonly record: FetchDecisionRecord;
  };

/**
 * The credential-free decision record: at most `{ host, hopIndex, decision,
 * reason }` (plus the diagnostic address class). No URL userinfo, query,
 * path, headers, credentials, or payload bytes are representable in this
 * type.
 */
export interface FetchDecisionRecord {
  /** `new URL(url).hostname` only — userinfo/query can never be present. */
  readonly host: string;
  readonly hopIndex: number;
  readonly decision: "allow-direct" | "allow-via-proxy" | "block";
  readonly reason?: FetchBlockReason;
  readonly addressClass?: string;
}

/** Build a decision record from a URL string, retaining ONLY the hostname. */
export function fetchDecisionRecord(
  url: string,
  hopIndex: number,
  decision: FetchDecisionRecord["decision"],
  extra: { reason?: FetchBlockReason; addressClass?: string } = {},
): FetchDecisionRecord {
  let host = "<unparseable>";
  try {
    host = new URL(url).hostname;
  } catch {
    // Unparseable input: the record names nothing derivable from the string.
  }
  return Object.freeze({
    host,
    hopIndex,
    decision,
    ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
    ...(extra.addressClass !== undefined ? { addressClass: extra.addressClass } : {}),
  });
}

/** Render one decision record as a log line. Only record fields are emitted. */
export function formatFetchDecisionLog(record: FetchDecisionRecord): string {
  const parts = [`host=${record.host}`, `hop=${record.hopIndex}`, `decision=${record.decision}`];
  if (record.reason !== undefined) parts.push(`reason=${record.reason}`);
  if (record.addressClass !== undefined) parts.push(`class=${record.addressClass}`);
  return `[air-fetch-adapter] ${parts.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Shared-rule classifier (single source: ssrf.ts).
// ---------------------------------------------------------------------------

/** Injectable DNS boundary, `resolveHostAddresses`-shaped (fail closed). */
export type ResolveHost = (host: string) => Promise<string[]>;

/** Dependencies the pure decision core is evaluated over. */
export interface FetchDecisionDeps {
  readonly resolveHost: ResolveHost;
  readonly policy: FetchEgressPolicy;
}

/** True for dotted IPv4 or colon-bearing IPv6 literals (transport sanity). */
function isIpLiteral(address: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(address) || address.includes(":");
}

/**
 * Diagnostic class label for an address the SHARED classifier has already
 * rejected. Produced only after `isDisallowedAddress` returned true, so it
 * can never admit anything; empty string means "class not named, block
 * stands". `cloud-metadata` names the never-exemptable space.
 */
export function disallowedAddressClass(addr: string): string {
  const h = addr.toLowerCase();
  const dotted = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    // Cloud-metadata space first, mirroring the authoritative set in
    // src/utils/egress-proxy.ts isMetadataAddress (never exemptable).
    if (dotted[1] in CLOUD_METADATA_IPV4) return "cloud-metadata";
    const [a, b] = dotted[1].split(".").map(Number);
    if (a === 127) return "loopback";
    if (a === 10) return "rfc1918";
    if (a === 172 && b >= 16 && b <= 31) return "rfc1918";
    if (a === 192 && b === 168) return "rfc1918";
    if (a === 169 && b === 254) return "link-local";
    if (a === 0) return "unspecified";
    if (a >= 224 && a < 240) return "multicast";
    if (a >= 240) return "reserved";
    if (a === 100 && b >= 64 && b <= 127) return "cgnat";
    return "disallowed-range";
  }
  if (h === "::1") return "loopback";
  if (h === "::" || h === "::0") return "unspecified";
  const head = h.replace(/^\[/, "").replace(/\]$/, "");
  // IPv4-mapped hex form (::ffff:a9fe:a9fe) inherits the dotted verdict.
  const mappedHex = head.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1], 16);
    const lo = Number.parseInt(mappedHex[2], 16);
    return disallowedAddressClass(
      `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`,
    );
  }
  if (head === "fd00:ec2::254" || head.startsWith("fd00:ec2:")) return "cloud-metadata";
  if (head.startsWith("fe8") || head.startsWith("fe9") || head.startsWith("fea") || head.startsWith("feb")) {
    return "link-local";
  }
  if (head.startsWith("fc") || head.startsWith("fd")) return "unique-local";
  if (head.startsWith("ff")) return "multicast";
  return "disallowed-range";
}

/** The cloud-metadata IPv4 space (mirrors egress-proxy.ts METADATA_IPV4). */
const CLOUD_METADATA_IPV4: Record<string, true> = {
  "169.254.169.254": true,
  "169.254.170.2": true,
  "100.100.100.200": true,
  "192.0.0.192": true,
};

/**
 * Decide ONE hop: URL (initial, redirect, or scraper-derived secondary)
 * against the shared rule set and the consumed posture. The redirect loop
 * lives in the executor; this function is pure over the injected boundary.
 */
export async function decideFetchHop(
  input: FetchHopInput,
  deps: FetchDecisionDeps,
): Promise<FetchHopDecision> {
  const hopIndex = input.hopsFollowed + 1;
  const blocked = (
    reason: FetchBlockReason,
    addressClass?: string,
  ): FetchHopDecision => ({
    decision: "block",
    reason,
    ...(addressClass !== undefined ? { addressClass } : {}),
    record: fetchDecisionRecord(input.url, hopIndex, "block", {
      reason,
      ...(addressClass !== undefined ? { addressClass } : {}),
    }),
  });

  // Adapter-only bound: block only when MORE than MAX_REDIRECT_HOPS (5)
  // redirects have been (or would be) followed — mirroring ssrf.ts safeFetch
  // (initial + five followed hops at most). A six-hop chain therefore issues
  // at most five followed-hop requests and blocks with `hop-limit-exceeded`
  // before the sixth followed hop is ever issued.
  if (input.hopsFollowed > MAX_REDIRECT_HOPS) {
    return blocked("hop-limit-exceeded");
  }

  // Consumed posture first: unresolved facts fail closed, never direct.
  if (deps.policy.posture === "unresolved") {
    return blocked("egress-policy-unresolved");
  }

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return blocked("url-unparseable");
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return blocked("disallowed-scheme");
  }
  const host = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "").split("%")[0];
  if (host.length === 0) {
    return blocked("url-unparseable");
  }

  let addresses: string[];
  try {
    addresses = await deps.resolveHost(host);
  } catch {
    return blocked("dns-unresolved");
  }
  if (addresses.length === 0) {
    return blocked("dns-unresolved");
  }
  // Transport sanity (not a rule fork): the classifier only speaks about IP
  // literals; a resolver answering with non-address strings fails closed.
  if (!addresses.every(isIpLiteral)) {
    return blocked("dns-invalid-answer");
  }
  for (const addr of addresses) {
    if (!isDisallowedAddress(addr)) continue;
    const addressClass = disallowedAddressClass(addr);
    if (addressClass === "cloud-metadata") {
      return blocked("cloud-metadata", addressClass);
    }
    return blocked("disallowed-address", addressClass);
  }

  const record = fetchDecisionRecord(input.url, hopIndex, "allow-direct");
  if (deps.policy.posture === "enforcing") {
    return {
      decision: "allow-via-proxy",
      proxyEndpoint: deps.policy.proxyEndpoint,
      record: Object.freeze({ ...record, decision: "allow-via-proxy" as const }),
    };
  }
  return { decision: "allow-direct", record };
}

/** Transport plan for a hop: the decision plus connect-time pinning facts. */
export interface FetchRoutePlan {
  readonly decision: Extract<FetchHopDecision, { decision: "allow-direct" | "allow-via-proxy" }>;
  /**
   * Plain-HTTP/IPv4 pinning per ssrf.ts D3 (reuse of `pinValidatedUrl`):
   * connect to the validated address with the original `Host` header so a
   * second resolution cannot swap in an internal IP. HTTPS hostname hosts are
   * left unpinned — the documented ssrf.ts open question (Deno/Bun fetch
   * cannot connect-by-IP while preserving TLS SNI/cert validation); enforcing
   * posture closes the gap at the proxy, which re-validates and pins at the
   * actual egress point.
   */
  readonly requestUrl: string;
  readonly hostHeader?: string;
}

/**
 * Plan one hop's route: decide it, then pin the validated addresses
 * (defense in depth under enforcing posture — the adapter's own validation
 * is retained in addition to the proxy's). Blocks pass through unchanged.
 */
export async function planFetchRoute(
  input: FetchHopInput,
  deps: FetchDecisionDeps,
  resolvedAddresses: readonly string[] = [],
): Promise<FetchRoutePlan | Extract<FetchHopDecision, { decision: "block" }>> {
  const decision = await decideFetchHop(input, deps);
  if (decision.decision === "block") return decision;
  const pinned = pinValidatedUrl(input.url, [...resolvedAddresses]);
  return Object.freeze({
    decision,
    requestUrl: pinned.requestUrl,
    ...(pinned.hostHeader !== undefined ? { hostHeader: pinned.hostHeader } : {}),
  });
}

// ---------------------------------------------------------------------------
// Adapter-owned manual hop loop (redirect:"manual" at every issue; the
// native `redirect:"follow"` shape is never emitted).
// ---------------------------------------------------------------------------

/** Text-route body cap, pinned-source value at 2a2c6dc `MAX_OUTPUT_CHARS`. */
export const MAX_TEXT_OUTPUT_CHARS = 500_000;
/** Binary-route byte cap, pinned-source value at 2a2c6dc `MAX_BYTES`. */
export const MAX_BINARY_BYTES = 50 * 1024 * 1024;

const IS_REDIRECT_STATUS: Record<number, true> = { 301: true, 302: true, 303: true, 307: true, 308: true };

/** Injected transport seam (tests always inject; production defaults below). */
export type FetchTransportFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Proxy-execution seam (candidate-to-verify — see notes on the policy). */
export interface FetchTransportDeps extends FetchDecisionDeps {
  readonly fetchImpl: FetchTransportFn;
  /** Records every decision the loop made, credential-free. */
  readonly recordSink?: (record: FetchDecisionRecord) => void;
}

/** Per-hop issue result after validation+pinning; never auto-follows. */
export interface HopOutcome {
  readonly response: Response;
  readonly record: FetchDecisionRecord;
}

/**
 * Validate and issue ONE hop manually. Returns the response for the caller
 * to inspect (redirect status → Location handling → next decision BEFORE
 * the next issue). `redirect: "manual"` is forced on every request; under
 * enforcing posture the request carries the consumed proxy endpoint through
 * the proxy-carrying issue seam.
 */
export async function issueValidatedHop(
  input: FetchHopInput,
  deps: FetchTransportDeps,
  resolvedAddresses: readonly string[] = [],
): Promise<HopOutcome | Extract<FetchHopDecision, { decision: "block" }>> {
  const plan = await planFetchRoute(input, deps, resolvedAddresses);
  if ("decision" in plan && plan.decision === "block") {
    deps.recordSink?.(plan.record);
    return plan;
  }
  const allow = plan.decision;
  deps.recordSink?.(allow.record);
  const headers = new Headers();
  if (plan.hostHeader !== undefined) headers.set("host", plan.hostHeader);
  const init: Record<string, unknown> = {
    redirect: "manual",
    headers,
  };
  if (allow.decision === "allow-via-proxy") {
    // Executed proxy hop: candidate-to-verify at the pinned compiled-binary
    // runtime (design §15 user checklist). The mock suite certifies the
    // DECISION and the endpoint selection, never the wire.
    init["proxy"] = allow.proxyEndpoint;
  }
  const response = await deps.fetchImpl(plan.requestUrl, init as RequestInit);
  return { response, record: allow.record };
}

/** Terminal result of a manual hop chain. */
export type FetchChainResult =
  | { readonly ok: true; readonly response: Response; readonly records: readonly FetchDecisionRecord[] }
  | {
    readonly ok: false;
    readonly block: Extract<FetchHopDecision, { decision: "block" }>;
    readonly records: readonly FetchDecisionRecord[];
  };

/**
 * The adapter-owned manual redirect chain for one initial URL: hop 1 = the
 * initial URL validated BEFORE issue; every redirect Location is re-decided
 * through the SAME rules before the next request; more than
 * `MAX_REDIRECT_HOPS` (5) followed hops blocks with `hop-limit-exceeded`
 * (the 6th redirect is never issued). Secondary URLs (markdown/feed
 * alternates, document-link retries, `.md`/llms.txt probes) re-enter with
 * the SAME decision and the SHARED hop budget — probes never multiply it.
 */
export async function runFetchChain(
  initialUrl: string,
  deps: FetchTransportDeps,
  options: { resolveHost?: ResolveHost } = {},
): Promise<FetchChainResult> {
  const resolveHost = options.resolveHost ?? deps.resolveHost;
  const records: FetchDecisionRecord[] = [];
  const sink = (record: FetchDecisionRecord) => {
    records.push(record);
    deps.recordSink?.(record);
  };
  let currentUrl = initialUrl;
  let hopsFollowed = 0;
  for (;;) {
    const input: FetchHopInput = {
      url: currentUrl,
      hopType: hopsFollowed > 0 ? "redirect" : "initial",
      hopsFollowed,
    };
    let addresses: string[] = [];
    // Resolve for classification + pinning; failures surface as blocks.
    try {
      const parsed = new URL(currentUrl);
      addresses = await resolveHost(parsed.hostname.replace(/^\[/, "").replace(/\]$/, ""));
    } catch {
      // decideFetchHop re-derives the dns-unresolved block from the same seam.
    }
    const outcome = await issueValidatedHop(input, { ...deps, recordSink: sink }, addresses);
    if ("decision" in outcome) {
      return { ok: false, block: outcome, records };
    }
    const response = outcome.response;
    if (!(response.status in IS_REDIRECT_STATUS)) {
      return { ok: true, response, records: Object.freeze([...records]) };
    }
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) {
      const block = {
        decision: "block" as const,
        reason: "url-unparseable" as const,
        record: fetchDecisionRecord(currentUrl, hopsFollowed + 1, "block", {
          reason: "url-unparseable",
        }),
      };
      sink(block.record);
      return { ok: false, block, records: Object.freeze([...records]) };
    }
    hopsFollowed += 1;
    // The NEXT hop's decision (including the hop bound) runs BEFORE issue.
    const nextUrl = new URL(location, currentUrl).toString();
    const precheck = await decideFetchHop(
      { url: nextUrl, hopType: "redirect", hopsFollowed },
      deps,
    );
    if (precheck.decision === "block") {
      sink(precheck.record);
      return { ok: false, block: precheck, records: Object.freeze([...records]) };
    }
    currentUrl = nextUrl;
  }
}

// ---------------------------------------------------------------------------
// Text / binary routes (native read shapes without native loadPage/fetchBinary)
// ---------------------------------------------------------------------------

/** Budget state carried across a primary chain and its secondary probes. */
export interface FetchHopBudget {
  /** Redirect hops already followed by the primary chain. */
  readonly hopsFollowed: number;
}

/**
 * Run ONE secondary URL (markdown/feed alternate, document-link retry,
 * `.md`/llms.txt probe — the S5 fan-out) through the SAME per-hop decision
 * as a model-supplied URL, continuing the caller's shared hop budget:
 * secondary probes NEVER reset or multiply the five-hop bound. Returns the
 * same shape as `runFetchChain` plus the budget to hand the next probe.
 */
export async function runSecondaryFetch(
  url: string,
  budget: FetchHopBudget,
  deps: FetchTransportDeps,
): Promise<FetchChainResult & { budget: FetchHopBudget }> {
  const resolveHost = deps.resolveHost;
  const records: FetchDecisionRecord[] = [];
  const sink = (record: FetchDecisionRecord) => {
    records.push(record);
    deps.recordSink?.(record);
  };
  let currentUrl = url;
  let hopsFollowed = budget.hopsFollowed;
  for (;;) {
    const input: FetchHopInput = { url: currentUrl, hopType: "secondary", hopsFollowed };
    let addresses: string[] = [];
    try {
      const parsed = new URL(currentUrl);
      addresses = await resolveHost(parsed.hostname.replace(/^\[/, "").replace(/\]$/, ""));
    } catch {
      // decideFetchHop re-derives the dns-unresolved block from the same seam.
    }
    const outcome = await issueValidatedHop(input, { ...deps, recordSink: sink }, addresses);
    if ("decision" in outcome) {
      return {
        ok: false,
        block: outcome,
        records: Object.freeze([...records]),
        budget: { hopsFollowed },
      };
    }
    const response = outcome.response;
    if (!(response.status in IS_REDIRECT_STATUS)) {
      return { ok: true, response, records: Object.freeze([...records]), budget: { hopsFollowed } };
    }
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location) {
      return {
        ok: false,
        block: {
          decision: "block" as const,
          reason: "url-unparseable" as const,
          record: fetchDecisionRecord(currentUrl, hopsFollowed + 1, "block", {
            reason: "url-unparseable",
          }),
        },
        records: Object.freeze([...records]),
        budget: { hopsFollowed },
      };
    }
    hopsFollowed += 1;
    currentUrl = new URL(location, currentUrl).toString();
  }
}

/** Chain-level fetch result with the decoded text body. */
export interface TextFetchResult {
  readonly ok: true;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly content: string;
  readonly truncated: boolean;
  readonly records: readonly FetchDecisionRecord[];
}

export interface TextFetchBlocked {
  readonly ok: false;
  readonly block: Extract<FetchHopDecision, { decision: "block" }>;
  readonly records: readonly FetchDecisionRecord[];
}

/** A validated chain whose final response is a non-2xx upstream status. */
export interface TextFetchUpstreamError {
  readonly ok: false;
  readonly failure: "upstream-error";
  readonly status: number;
  readonly records: readonly FetchDecisionRecord[];
}

/**
 * Text route: page/markdown body with the pinned-source `MAX_OUTPUT_CHARS`
 * bound and content-type sniffing. Body capped while streaming (never a
 * full unbounded read).
 */
export async function fetchTextRoute(
  url: string,
  deps: FetchTransportDeps,
): Promise<TextFetchResult | TextFetchBlocked | TextFetchUpstreamError> {
  const chain = await runFetchChain(url, deps);
  if (!chain.ok) return chain;
  const response = chain.response;
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return {
      ok: false,
      failure: "upstream-error",
      status: response.status,
      records: chain.records,
    };
  }
  const rawContentType = response.headers.get("content-type") ?? "";
  const contentType = rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const { content, truncated } = await readCappedText(response, MAX_TEXT_OUTPUT_CHARS);
  return {
    ok: true,
    finalUrl: response.url || url,
    contentType,
    content,
    truncated,
    records: chain.records,
  };
}

async function readCappedText(
  response: Response,
  cap: number,
): Promise<{ content: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { content: "", truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    chunks.push(value);
    total += value.byteLength;
    if (total > cap) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  let size = 0;
  for (const c of chunks) size += c.byteLength;
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  let content = new TextDecoder().decode(merged);
  if (content.length > cap) {
    content = content.slice(0, cap);
    truncated = true;
  }
  return { content, truncated };
}

/** Binary route result: bytes + disposition/extension hints (fetchBinary mirror). */
export interface BinaryFetchResult {
  readonly ok: true;
  readonly bytes: Uint8Array;
  readonly finalUrl: string;
  readonly contentType: string;
  readonly contentDisposition?: string;
  readonly extensionHint: string;
  readonly records: readonly FetchDecisionRecord[];
}

export interface BinaryFetchBlocked {
  readonly ok: false;
  /** `content-length-limit` refuses BEFORE the full body is read. */
  readonly reason: "chain-blocked" | "content-length-limit" | "body-limit" | "upstream-error";
  /** Present when the chain itself blocked (the hop decision stands verbatim). */
  readonly block?: Extract<FetchHopDecision, { decision: "block" }>;
  readonly records: readonly FetchDecisionRecord[];
}

/**
 * Binary route mirroring the pinned `fetchBinary` semantics: declared
 * content-length over the cap refuses before the body is read; the stream
 * is additionally capped; content-disposition/extension hints ride back.
 * A missing/undecodable content-length is treated as unknown and the
 * streaming cap carries the bound (task 5.2 pins only the declared case).
 */
export async function fetchBinaryRoute(
  url: string,
  deps: FetchTransportDeps,
  options: { maxBytes?: number } = {},
): Promise<BinaryFetchResult | BinaryFetchBlocked> {
  const maxBytes = options.maxBytes ?? MAX_BINARY_BYTES;
  const chain = await runFetchChain(url, deps);
  if (!chain.ok) {
    return { ok: false, reason: "chain-blocked", block: chain.block, records: chain.records };
  }
  const response = chain.response;
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, reason: "upstream-error", records: chain.records };
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim()
    .toLowerCase() ?? "";
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = Number.parseInt(contentLength, 10);
    if (Number.isFinite(size) && size > maxBytes) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, reason: "content-length-limit", records: chain.records };
    }
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: "body-limit", records: chain.records };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const contentDisposition = response.headers.get("content-disposition") ?? undefined;
  return {
    ok: true,
    bytes: merged,
    finalUrl: response.url || url,
    contentType,
    ...(contentDisposition !== undefined ? { contentDisposition } : {}),
    extensionHint: extensionHintFor(url, contentDisposition),
    records: chain.records,
  };
}

/** Extension hint from content-disposition filename, else the URL path. */
export function extensionHintFor(url: string, contentDisposition?: string): string {
  if (contentDisposition) {
    const match = contentDisposition.match(/filename[*]?=["']?([^"';\n]+)/i);
    if (match) {
      const name = match[1].toLowerCase();
      if (name.endsWith(".tar.gz")) return ".tar.gz";
      const ext = name.match(/(\.[^./]+)$/)?.[1] ?? "";
      if (ext) return ext;
    }
  }
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".tar.gz")) return ".tar.gz";
    return path.match(/(\.[^./]+)$/)?.[1] ?? "";
  } catch {
    return "";
  }
}

/** Chain/route refusal with no body (adapter decision or size limit). */
export interface FailedFetchResult {
  readonly ok: false;
  readonly route: "failed";
  /** Present when a per-hop decision blocked the chain. */
  readonly block?: Extract<FetchHopDecision, { decision: "block" }>;
  /** Present on route-level refusals (content-length/body limit). */
  readonly reason?: "chain-blocked" | "content-length-limit" | "body-limit" | "upstream-error";
  readonly records: readonly FetchDecisionRecord[];
}

export type ShapedFetchResult =
  | ({ readonly route: "text" } & TextFetchResult)
  | ({ readonly route: "binary" } & BinaryFetchResult)
  | FailedFetchResult
  | ({ readonly route: "upstream-error" } & TextFetchUpstreamError);

/**
 * Shape-selecting URL read mirroring the native URL-branch content-type
 * branching (S6): the primary chain runs once; a binary-shaped content type
 * (per the caller's predicate, evaluated on the sniffed type + extension
 * hint) cancels the text body and re-runs through the binary route exactly
 * as the native does `loadPage`(skip) → `fetchBinary`; text-shaped bodies
 * are read capped in place. Neither native `loadPage` nor `fetchBinary` is
 * ever invoked — each re-request re-enters the per-hop validation.
 */
export async function fetchShapedRoute(
  url: string,
  deps: FetchTransportDeps,
  options: {
    readonly isBinary?: (contentType: string, extensionHint: string) => boolean;
    readonly maxBinaryBytes?: number;
  } = {},
): Promise<ShapedFetchResult> {
  const chain = await runFetchChain(url, deps);
  if (!chain.ok) return { route: "failed", ...chain };
  const contentType = (chain.response.headers.get("content-type") ?? "").split(";")[0]?.trim()
    .toLowerCase() ?? "";
  if ((options.isBinary ?? isBinaryContentShape)(contentType, extensionHintFor(url))) {
    await chain.response.body?.cancel().catch(() => {});
    const binary = await fetchBinaryRoute(url, deps, { maxBytes: options.maxBinaryBytes });
    if (!binary.ok) {
      return {
        route: "failed",
        ok: false,
        ...(binary.block !== undefined ? { block: binary.block } : { reason: binary.reason }),
        records: binary.records,
      };
    }
    return { route: "binary", ...binary };
  }
  if (!chain.response.ok) {
    await chain.response.body?.cancel().catch(() => {});
    return {
      ok: false,
      route: "upstream-error",
      failure: "upstream-error",
      status: chain.response.status,
      records: chain.records,
    };
  }
  const { content, truncated } = await readCappedText(chain.response, MAX_TEXT_OUTPUT_CHARS);
  return {
    route: "text",
    ok: true,
    finalUrl: chain.response.url || url,
    contentType,
    content,
    truncated,
    records: chain.records,
  };
}

// ---------------------------------------------------------------------------
// Production transport seam.
// ---------------------------------------------------------------------------

/** Convertible/archive/zip MIME types the URL branch serves binary (S6). */
const BINARY_MIMES: Record<string, true> = {
  "application/pdf": true,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
  "application/epub+zip": true,
  "application/zip": true,
  "application/x-zip-compressed": true,
  "application/x-tar": true,
  "application/tar": true,
  "application/gzip": true,
  "application/x-gzip": true,
};

const BINARY_EXTENSIONS: Record<string, true> = {
  ".pdf": true,
  ".docx": true,
  ".pptx": true,
  ".xlsx": true,
  ".epub": true,
  ".zip": true,
  ".tar": true,
  ".tar.gz": true,
  ".tgz": true,
  ".gz": true,
  ".png": true,
  ".jpg": true,
  ".jpeg": true,
  ".gif": true,
  ".webp": true,
};

/** True when the URL branch takes the binary route for this shape. */
export function isBinaryContentShape(contentType: string, extensionHint: string): boolean {
  if (contentType.startsWith("image/")) return true;
  if (contentType in BINARY_MIMES) return true;
  if (
    (contentType === "" || contentType === "application/octet-stream" ||
      contentType === "binary/octet-stream") && extensionHint in BINARY_EXTENSIONS
  ) {
    return true;
  }
  return false;
}

/**
 * Production fetch transport: global fetch with the adapter-forced manual
 * redirect shape. Under enforcing posture the init already carries the
 * consumed proxy endpoint (`issueValidatedHop`); whether the pinned
 * compiled-binary runtime honors a per-request proxy option is UNVERIFIED
 * candidate-to-verify — see the section-15 checklist in docs/OMP_NETWORK.md.
 * Mock suites receive the init object verbatim and therefore certify the
 * decision and endpoint selection only, never the wire.
 */
export function productionFetchTransport(): FetchTransportFn {
  return (url, init) => fetch(url, init);
}
