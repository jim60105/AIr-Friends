/**
 * Trusted-Extension `read` Replacement Sibling (row 19,
 * `control-omp-url-fetch-transport`, design D2).
 *
 * The fourth serial extension of the row-12/14b trusted tree (12 → 16 → 19,
 * before the row-22 digest cut): registers the `read` name replacement
 * through the pinned `registerTool` surface (S7). The name replacement is
 * the SELECTED supported mechanism completing the URL-read routes — session
 * construction applies registered extension tools over the registry for the
 * same name, last-extension-wins, with the natives captured beforehand and
 * reachable via same-tool `ctx.invokeTool` (S8).
 *
 * Branch discipline:
 * - URL-shaped inputs (`http(s)://`, including the native line-selector
 *   forms) are served ENTIRELY by the fetch-transport adapter — text route
 *   for pages/markdown, binary route for image/convertible/archive content
 *   types — reproducing the native URL-read observable output shape without
 *   ever invoking native `loadPage`/`fetchBinary` (routes
 *   `read.url-branch.*`, `FETCH_ROUTE_TABLE`).
 * - Internal/custom-scheme inputs (`pi-internal://` and any other
 *   `scheme://` reaching the URL branch) are rejected as 14a's
 *   alternate-route denial naming the blocked pair (network-read ×
 *   internal-uri-scheme) and are NEVER proxied.
 * - Every non-URL input delegates VERBATIM to the captured native through
 *   the supported same-tool delegation context (100% delegation; the
 *   replacement adds no second decision path — the 14b handler still gates
 *   the call before the replacement executes).
 *
 * Registration posture mirrors the enforcement sibling: the replacement is
 * RESTRICTED-SESSION-ONLY (native YOLO registers nothing — the exemption is
 * structural at the registration site, keyed on the module's own observed
 * launch identity). The attach is the synchronous attachment point on the
 * pinned surface; whether the compiled binary invokes the replacement at all
 * is design §15 USER-OWNED runtime verification — nothing here claims it,
 * and no local mock clears the P0 transport-bypass record.
 *
 * Transport facts (task 4.3, consumed only): the egress posture and the
 * validating-proxy endpoint come from the existing config/bootstrap
 * singleton values (`agent.sandbox.egressProxy`,
 * `agent.sandbox.unrestrictedEgress`, `getRunningEgressProxyUrl()`), read in
 * the agent process through `fetchEgressPolicyFromAgentEnv` over the SAME
 * facts the factory assembled. No new config/env/Helm field exists. The
 * factory's best-effort env routing stays exactly as-is and is NOT
 * enforcement: `HTTP_PROXY` presence alone never established mediation (a
 * client that ignores the vars escapes; the loopback NO_PROXY carve-out is
 * host-wide) — the pre-existing F14 residual is unchanged, documented in
 * docs/OMP_NETWORK.md. The Skill API loopback endpoint and provider
 * endpoints are fixed deployment transport facts that NEVER enter the
 * model-target decision.
 */

import { type EnforcementLaunchMode, observeLaunchMode } from "./enforcement.ts";
import { Type } from "@sinclair/typebox";
import {
  type FetchDecisionRecord,
  type FetchEgressPolicy,
  fetchEgressPolicyFromAgentEnv,
  fetchShapedRoute,
  type FetchTransportFn,
  isBinaryContentShape,
  productionFetchTransport,
  type ResolveHost,
} from "./_daemon/mod.ts";

/** The pinned `registerTool` surface seam (row-20 closure note applies). */
export interface ReadToolRegistrar {
  registerTool(tool: ReadReplacementDefinition): void;
}

/** Dependencies frozen at registration; every field injectable for tests. */
export interface ReadReplacementDeps {
  /** Consumed egress posture facts (production default: agent env read). */
  readonly policy?: FetchEgressPolicy;
  /** DNS boundary seam; production default resolves via the host runtime. */
  readonly resolveHost?: ResolveHost;
  /** Transport seam; production default is the global fetch (mocked in tests). */
  readonly fetchImpl?: FetchTransportFn;
  /** Credential-free decision-record sink. */
  readonly recordSink?: (record: FetchDecisionRecord) => void;
}

/** One parsed read selector (native selector vocabulary, adapter form). */
export type ReadSelector =
  | { readonly kind: "none" }
  | { readonly kind: "raw" }
  | { readonly kind: "tail"; readonly count: number }
  | { readonly kind: "lines"; readonly ranges: ReadonlyArray<readonly [number, number]> };

/** Classification of a `read` tool input path. */
export type ReadInputBranch =
  | { readonly kind: "url"; readonly url: string; readonly selector: ReadSelector }
  | { readonly kind: "rejected-scheme"; readonly scheme: string }
  | { readonly kind: "native" };

/**
 * `parseReadUrlTarget`-equivalent detection of the URL branch (S6): the
 * http(s) branch including line selectors, with the collapsed-scheme repair
 * the native form applies. Deliberately conservative: an input only leaves
 * the native branch when it is UNAMBIGUOUSLY a URL; anything else (relative
 * paths, `host:port` look-alikes, `skill://`-shaped native URI reads) stays
 * on the native delegation path.
 */
export function parseReadUrlBranch(readPath: string): ReadInputBranch {
  const repaired = readPath.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/(?!\/)/, "$1://");
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(repaired);
  if (!schemeMatch) return { kind: "native" };
  const scheme = schemeMatch[1].toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    // `skill://` and internal/device custom schemes reach the URL branch
    // only as the alternate-route surface 14a already denies: reject, never
    // proxy. (Plain paths have no `://` and stay on `native`.)
    return { kind: "rejected-scheme", scheme };
  }
  const { path, selector } = extractReadSelector(repaired);
  return { kind: "url", url: path, selector };
}

/**
 * Split a trailing read-selector token (`:50`, `:50-100`, `:50+150`,
 * `:5-10,20-30`, `:-60`, `:raw`, combinable `:raw:N-M`) from a URL. Only
 * tokens that follow a path segment (never the bare host of a `host:port`
 * authority) are selectors, mirroring the native trailing-slash convention.
 */
function extractReadSelector(url: string): { path: string; selector: ReadSelector } {
  const schemeLen = url.indexOf("://");
  if (schemeLen === -1) return { path: url, selector: { kind: "none" } };
  const authorityEnd = url.indexOf("/", schemeLen + 3);
  if (authorityEnd === -1) return { path: url, selector: { kind: "none" } };
  const tokens: string[] = [];
  let rest = url;
  for (;;) {
    const match = /^(.*):([^:/]+)$/.exec(rest);
    if (!match) break;
    const [, head, token] = match;
    const colonIndex = head.length + 1;
    if (colonIndex <= authorityEnd) break;
    if (!isSelectorToken(token)) break;
    tokens.unshift(token);
    rest = head;
  }
  if (tokens.length === 0) return { path: url, selector: { kind: "none" } };
  return { path: rest, selector: selectorFromTokens(tokens) };
}

function isSelectorToken(token: string): boolean {
  return /^(raw|\d+(?:[-+]\d+)?(?:,\d+(?:[-+]\d+)*)?|-\d+)$/i.test(token);
}

function selectorFromTokens(tokens: readonly string[]): ReadSelector {
  let raw = false;
  let tail: number | undefined;
  const ranges: Array<readonly [number, number]> = [];
  for (const token of tokens) {
    if (/^raw$/i.test(token)) {
      raw = true;
      continue;
    }
    if (/^-\d+$/.test(token)) {
      tail = Number.parseInt(token.slice(1), 10);
      continue;
    }
    for (const part of token.split(",")) {
      const plus = /^(\d+)\+(\d+)$/.exec(part);
      if (plus) {
        ranges.push([Number(plus[1]), Number(plus[1]) + Number(plus[2]) - 1]);
        continue;
      }
      const range = /^(\d+)-(\d+)$/.exec(part);
      if (range) {
        ranges.push([Number(range[1]), Number(range[2])]);
        continue;
      }
      const single = /^(\d+)$/.exec(part);
      if (single) {
        ranges.push([Number(single[1]), Number(single[1])]);
        continue;
      }
      return { kind: "none" };
    }
  }
  if (tail !== undefined) return { kind: "tail", count: tail };
  if (ranges.length > 0) return { kind: "lines", ranges };
  if (raw) return { kind: "raw" };
  return { kind: "none" };
}

/** Apply a parsed selector to a fetched body (native selector semantics). */
export function applyReadSelector(content: string, selector: ReadSelector): string {
  if (selector.kind === "raw" || selector.kind === "none") return content;
  // Trailing-newline normalization mirrors the repo's read-selector
  // convention (`split("\n").slice(0, -1)` on newline-terminated bodies):
  // a trailing `\n` never counts as an extra line for tail/line selectors.
  const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  if (selector.kind === "tail") {
    return lines.slice(Math.max(lines.length - selector.count, 0)).join("\n");
  }
  const picked: string[] = [];
  for (const [start, end] of selector.ranges) {
    picked.push(...lines.slice(Math.max(start - 1, 0), end));
  }
  return picked.join("\n");
}

// ---------------------------------------------------------------------------
// The replacement definition.
// ---------------------------------------------------------------------------

/**
 * The pinned source's `ToolDefinition.parameters` field is NOT optional:
 * the host validates tool input against it BEFORE `execute` runs
 * (packages/coding-agent/src/extensibility/extensions/types.ts at the pin).
 * A structurally compatible schema-builder facade (the canonical bare
 * `@sinclair/typebox` import the pinned legacy loader host-resolves) builds
 * both replacement schemas; the adapter keeps the declared vocabulary of the
 * executors' own input parsers 1:1 so the host gate and the executor can
 * never disagree, and locks each object closed (`additionalProperties:
 * false`) so the gate never admits a field the executor would silently
 * ignore. The pinned image read also emits the host shim's exact field
 * spellings.
 */

/** The native `TextContent` block (`{ type: "text", text }`). */
export interface ReadReplacementTextContent {
  readonly type: "text";
  readonly text: string;
}

/** The native `ImageContent` block: base64 STRING data + `mimeType`. */
export interface ReadReplacementImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

/** Native-shaped URL-read result the replacement returns (`AgentToolResult`). */
export interface ReadReplacementResult {
  readonly content: ReadonlyArray<ReadReplacementTextContent | ReadReplacementImageContent>;
  readonly details: {
    readonly kind: "url";
    readonly finalUrl: string;
    readonly contentType: string;
    readonly method: string;
    readonly truncated: boolean;
    readonly notes: readonly string[];
    readonly adapterCompleted: true;
    /**
     * Non-image binary payloads the native renderer has no text/inline-image
     * representation for. The native pin answers them with a text descriptor
     * (`[Binary content: <mime>, <size>] <url>`) only — never raw bytes to
     * the model — so the adapter keeps the EXACT bytes honest, base64-encoded
     * in `details` (the native `AgentToolResult.details` position), NOT in a
     * fabricated content block. `data` is base64 of the fetched bytes.
     */
    readonly binaryData?: {
      readonly encoding: "base64";
      readonly data: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly contentDisposition?: string;
    };
  };
}

/** The `read` parameter vocabulary: the native read schema is `{ path }`. */
export const READ_REPLACEMENT_PARAMETERS = Type.Object(
  { path: Type.String() },
  { additionalProperties: false },
);

/**
 * The pinned `ToolDefinition.parameters` shape the schema must satisfy: a
 * JSON-Schema object type. The concrete schemas are BUILDER objects (the
 * exported `READ_REPLACEMENT_PARAMETERS`/`SEARCH_REPLACEMENT_PARAMETERS`,
 * full `TObject` typing — the host gate and a fixture's `Value.Check`
 * consume the real builder schema, never a substitute); the definition
 * surface widens to this structural JSON-Schema view so BOTH object shapes
 * stay assignable without a second schema system.
 */
export interface NativeToolParameterSchema {
  readonly type?: string;
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  /** JSON Schema allows a boolean or a subschema here; both adapters accept
   *  the literal `false` the replacement schemas pass. */
  readonly additionalProperties?: boolean | Record<string, unknown>;
}

/** Fail-closed replacement error (bounded fields; 14b vocabulary named). */
export class ReadReplacementDenial extends Error {
  readonly blockedPair: { readonly capability: string; readonly route: string };
  constructor(blockedPair: { readonly capability: string; readonly route: string }) {
    super(
      `rejected_alternate_route: capability=${blockedPair.capability} route=${blockedPair.route} ` +
        "(the URL-fetch adapter never proxies internal/custom schemes)",
    );
    this.name = "ReadReplacementDenial";
    this.blockedPair = blockedPair;
  }
}

/** The pinned ToolDefinition-shaped replacement (execute signature per S7). */
export interface ReadReplacementDefinition {
  readonly name: "read";
  readonly label: string;
  readonly description: string;
  readonly approval: "read";
  readonly parameters: NativeToolParameterSchema;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ReadDelegationContext,
  ): Promise<ReadReplacementResult | unknown>;
}

/** The supported same-tool native delegation context (S7/S8 `invokeTool`). */
export interface ReadDelegationContext {
  invokeTool?(
    params: Record<string, unknown>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

/**
 * The pinned-source output header the native `buildUrlReadOutput` emits
 * (`URL:` / `Content-Type:` / `Method:` / `Notes:` then `---`): the
 * replacement reproduces this observable shape for adapter-served reads
 * without invoking native code paths.
 */
export function formatNativeShapedUrlRead(read: {
  finalUrl: string;
  contentType: string;
  method: string;
  notes: readonly string[];
  content: string;
}): string {
  let output = `URL: ${read.finalUrl}\n`;
  output += `Content-Type: ${read.contentType}\n`;
  output += `Method: ${read.method}\n`;
  if (read.notes.length > 0) output += `Notes: ${read.notes.join("; ")}\n`;
  output += `\n---\n\n`;
  output += read.content;
  return output;
}

/**
 * The pinned renderer's inline-serializable image set (fetch.ts
 * `SUPPORTED_INLINE_IMAGE_MIME_TYPES` at the pin): ONLY these binaries may
 * become native `ImageContent` blocks. Every other binary keeps the text
 * descriptor + `details.binaryData` representation.
 */
const SUPPORTED_INLINE_IMAGE_MIME_TYPES: Record<string, true> = {
  "image/png": true,
  "image/jpeg": true,
  "image/gif": true,
  "image/webp": true,
};

/** The pinned `formatBytes` rendering (pi-utils format.ts at the pin). */
export function formatNativeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/** The pinned non-image binary descriptor (fetch.ts `buildBinaryNotice`). */
export function buildBinaryNotice(finalUrl: string, mime: string, byteLength: number): string {
  return `[Binary content: ${mime || "application/octet-stream"}, ${
    formatNativeBytes(byteLength)
  }] ${finalUrl}`;
}

/**
 * Runtime-portable base64 (the pinned host's `Buffer.toBase64()` equivalent;
 * no new external and no `Deno.*` surface in the mirror closure). Chunked so
 * large payloads never exceed the spread-argument limit of the host runtime.
 */
export function encodeBase64(bytes: Uint8Array): string {
  const b = globalThis as { btoa?: (data: string) => string };
  if (typeof b.btoa === "function") {
    const CHUNK = 0x8000;
    let out = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return b.btoa(out);
  }
  const bun = (globalThis as { Bun?: { toBinary?: (b: Uint8Array) => ArrayBuffer } }).Bun;
  if (typeof bun?.toBinary === "function") {
    return new TextDecoder().decode(new Uint8Array(bun.toBinary(bytes)));
  }
  throw new Error("read replacement: no base64 surface available in the host runtime");
}

/**
 * Build the `read` replacement ToolDefinition over the adapter. `deps` are
 * the consumed transport facts + injected seams; with no injected
 * `resolveHost`, resolution uses the runtime's own resolver and FAILS
 * CLOSED (block) when none exists — never an unvalidated direct issue.
 */
export function createReadReplacementToolDefinition(
  deps: ReadReplacementDeps = {},
): ReadReplacementDefinition {
  const policy = deps.policy ?? fetchEgressPolicyFromAgentEnv();
  const resolveHost: ResolveHost = deps.resolveHost ?? runtimeResolveHost;
  const fetchImpl = deps.fetchImpl ?? productionFetchTransport();

  return {
    name: "read",
    label: "read",
    description:
      "Read files, URIs, and skill paths. URL reads are served through the AIr controlled " +
      "fetch transport with per-hop validation.",
    approval: "read",
    parameters: READ_REPLACEMENT_PARAMETERS,
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      void toolCallId;
      const rawPath: unknown = params["path"];
      const readPath = typeof rawPath === "string" ? rawPath : "";
      const branch = parseReadUrlBranch(readPath);
      if (branch.kind === "native") {
        // 100% verbatim delegation to the captured native (S8). The 14b
        // handler has already gated this call; the replacement adds no
        // second decision path and re-decides nothing.
        if (typeof ctx?.invokeTool !== "function") {
          throw new Error(
            "read replacement: no same-tool native delegation context — failing closed " +
              "(delegation to the captured native is the only supported non-URL path)",
          );
        }
        return ctx.invokeTool(params, signal ? { signal } : undefined);
      }
      if (branch.kind === "rejected-scheme") {
        throw new ReadReplacementDenial({
          capability: "network-read",
          route: "internal-uri-scheme",
        });
      }

      const transportDeps = { resolveHost, policy, fetchImpl, recordSink: deps.recordSink };
      const raw = branch.selector.kind === "raw";

      // One shaped read: the primary chain runs once through the adapter;
      // binary-shaped content types re-enter the adapter binary route (the
      // native URL-branch content-type branching, S6). Native
      // loadPage/fetchBinary are never invoked at all.
      const shaped = await fetchShapedRoute(branch.url, transportDeps, {
        isBinary: isBinaryContentShape,
      });
      if (shaped.route === "failed") {
        if (shaped.block) {
          throw new Error(
            `read replacement: URL read blocked (${shaped.block.reason})` +
              (shaped.block.addressClass ? ` class=${shaped.block.addressClass}` : ""),
          );
        }
        throw new Error(`read replacement: URL read refused (${shaped.reason})`);
      }
      if (shaped.route === "upstream-error") {
        throw new Error(`read replacement: upstream status ${shaped.status}`);
      }

      if (shaped.route === "binary") {
        // Valid binary representation per the pinned renderer (fetch.ts):
        // images whose MIME the host can serialize inline become a native
        // `ImageContent` block (base64 STRING + mimeType); every other
        // binary answers with the native text descriptor
        // `[Binary content: <mime>, <size>] <url>` and keeps the exact
        // bytes in `details.binaryData` — never fabricated content blocks,
        // never raw bytes smuggled into model-facing content.
        const notes = [
          `binary body served by the adapter (${shaped.bytes.byteLength} bytes)`,
          `materialized hint: ${shaped.extensionHint || "unknown"} via controlled transport`,
        ];
        const mime = shaped.contentType || "application/octet-stream";
        const details = {
          kind: "url" as const,
          finalUrl: shaped.finalUrl,
          contentType: shaped.contentType,
          method: "binary",
          truncated: false,
          notes,
          adapterCompleted: true as const,
        };
        if (SUPPORTED_INLINE_IMAGE_MIME_TYPES[shaped.contentType] === true) {
          return {
            content: [{
              type: "text" as const,
              text: formatNativeShapedUrlRead({
                finalUrl: shaped.finalUrl,
                contentType: shaped.contentType,
                method: "binary",
                notes,
                content: `Fetched image content (${mime}).`,
              }),
            }, {
              type: "image" as const,
              data: encodeBase64(shaped.bytes),
              mimeType: mime,
            }],
            details,
          };
        }
        return {
          content: [{
            type: "text" as const,
            text: formatNativeShapedUrlRead({
              finalUrl: shaped.finalUrl,
              contentType: shaped.contentType,
              method: "binary",
              notes,
              content: buildBinaryNotice(shaped.finalUrl, mime, shaped.bytes.byteLength),
            }),
          }],
          details: {
            ...details,
            binaryData: {
              encoding: "base64" as const,
              data: encodeBase64(shaped.bytes),
              mimeType: mime,
              byteLength: shaped.bytes.byteLength,
              ...(shaped.contentDisposition !== undefined
                ? { contentDisposition: shaped.contentDisposition }
                : {}),
            },
          },
        };
      }

      const content = applyReadSelector(shaped.content, branch.selector);
      const notes: string[] = raw ? ["raw body"] : [];
      if (shaped.truncated) {
        notes.push("body truncated at the adapter output bound (materialization note)");
      }
      const method = shaped.contentType === "text/markdown" ? "markdown" : "fetch";
      return {
        content: [{
          type: "text" as const,
          text: formatNativeShapedUrlRead({
            finalUrl: shaped.finalUrl,
            contentType: shaped.contentType,
            method,
            notes,
            content,
          }),
        }],
        details: {
          kind: "url" as const,
          finalUrl: shaped.finalUrl,
          contentType: shaped.contentType,
          method,
          truncated: shaped.truncated,
          notes,
          adapterCompleted: true as const,
        },
      };
    },
  };
}

/**
 * Runtime DNS seam: Deno resolver when present, else fail-closed throw.
 * Literal IPs pass through untouched — the same transport-plumbing
 * short-circuit `ssrf.ts`'s own `resolveHostAddresses` performs (literal
 * IPv4 / colon-bearing IPv6 returned as-is), NOT a rule fork: literals are
 * still classified by the shared `isDisallowedAddress` downstream, so a
 * literal metadata/private IP blocks with its true class instead of a
 * misleading `dns-unresolved`.
 */
export async function runtimeResolveHost(host: string): Promise<string[]> {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return [host];
  const deno =
    (globalThis as { Deno?: { resolveDns?: (h: string, t: "A" | "AAAA") => Promise<string[]> } })
      .Deno;
  if (!deno?.resolveDns) {
    throw new Error(`no DNS resolver surface available for host ${host}`);
  }
  const answers: string[] = [];
  try {
    answers.push(...await deno.resolveDns(host, "A"));
  } catch {
    // Lookup failed for this type; the shared fail-closed rule lives in the
    // decision core (empty answers → dns-unresolved block).
  }
  try {
    answers.push(...await deno.resolveDns(host, "AAAA"));
  } catch {
    // ditto
  }
  return answers;
}

// ---------------------------------------------------------------------------
// Load-time attach (restricted-session-only, mirrors the enforcement sibling)
// ---------------------------------------------------------------------------

/** Registration outcome record (both branches). */
export interface ReadReplacementRegistrationResult {
  readonly registered: boolean;
  readonly mode: EnforcementLaunchMode;
  readonly definition?: ReadReplacementDefinition;
}

/**
 * The restricted-process registration branch: the YOLO/unidentified branch
 * registers NOTHING (14b posture — structural exemption at the site).
 */
export function registerReadReplacement(
  mode: EnforcementLaunchMode | undefined,
  deps: ReadReplacementDeps = {},
): ReadReplacementRegistrationResult {
  if (mode !== "restricted") {
    return { registered: false, mode: mode ?? "native-yolo" };
  }
  return {
    registered: true,
    mode: "restricted",
    definition: createReadReplacementToolDefinition(deps),
  };
}

/** Load-time attach options (injection seam for verification). */
export interface ReadReplacementLoadOptions extends ReadReplacementDeps {
  readonly observedCwd?: string;
}

let loadTimeReadReplacementRegistration: ReadReplacementRegistrationResult = {
  registered: false,
  mode: "native-yolo",
};

/**
 * The synchronous load-time attach: identity branch → definition build.
 * Registration into the pinned `registerTool` surface happens through the
 * factory's synchronous attachment point; native invocation of the
 * replacement remains candidate-to-verify (design §15).
 */
export function attachReadReplacementAtLoad(
  options: ReadReplacementLoadOptions = {},
): ReadReplacementRegistrationResult {
  const mode = observeLaunchMode(options.observedCwd ?? "");
  loadTimeReadReplacementRegistration = registerReadReplacement(mode, options);
  return Object.freeze({ ...loadTimeReadReplacementRegistration });
}

/** The current load-time registration record (both branches, frozen copy). */
export function getLoadTimeReadReplacementRegistration(): ReadReplacementRegistrationResult {
  return Object.freeze({ ...loadTimeReadReplacementRegistration });
}

/**
 * The factory-side synchronous attachment point: the pinned host hands its
 * `registerTool` surface here (last-extension-wins, S8) and the restricted
 * definition is registered. Carries no readiness assertion and makes no
 * claim that the binary will ever call the tool.
 */
export function registerLoadTimeReadReplacement(registrar: ReadToolRegistrar): boolean {
  const definition = loadTimeReadReplacementRegistration.definition;
  if (!definition) return false;
  registrar.registerTool(definition);
  return true;
}
