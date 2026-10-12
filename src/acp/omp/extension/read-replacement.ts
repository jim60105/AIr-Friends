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

import type { EnforcementLaunchMode } from "./enforcement.ts";
import * as nodeDns from "node:dns/promises";
import { resolveHostAnswers } from "../../../utils/ssrf.ts";
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
  /**
   * Owned skill-URI authorization seam (`repair-omp-owned-skill-handoff`
   * D3). ABSENT means NO skill authority exists — the `skill://` branch then
   * fails closed; the replacement never improvises a resolver or a root.
   */
  readonly skillUriAuthorization?: SkillUriAuthorization;
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
  | { readonly kind: "skill-uri"; readonly uri: string }
  | { readonly kind: "rejected-scheme"; readonly scheme: string }
  | { readonly kind: "native" };

/**
 * `parseReadUrlTarget`-equivalent detection of the URL branch (S6): the
 * http(s) branch including line selectors, with the collapsed-scheme repair
 * the native form applies. Deliberately conservative: an input only leaves
 * the native branch when it is UNAMBIGUOUSLY a URL; anything else (relative
 * paths, `host:port` look-alikes) stays on the native delegation path.
 * `skill://` is the ONE non-HTTP scheme given a distinct branch
 * (`repair-omp-owned-skill-handoff` D3): the owned-skill URI the replacement
 * authorizes against the declared owned source before delegating; every
 * OTHER scheme keeps 14a's alternate-route denial verbatim.
 */
export function parseReadUrlBranch(readPath: string): ReadInputBranch {
  const repaired = readPath.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/(?!\/)/, "$1://");
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(repaired);
  if (!schemeMatch) return { kind: "native" };
  const scheme = schemeMatch[1].toLowerCase();
  if (scheme === "skill") {
    return { kind: "skill-uri", uri: repaired };
  }
  if (scheme !== "http" && scheme !== "https") {
    // Internal/device custom schemes reach the URL branch
    // only as the alternate-route surface 14a already denies: reject, never
    // proxy. (Plain paths have no `://` and stay on `native`.)
    return { kind: "rejected-scheme", scheme };
  }
  const { path, selector } = extractReadSelector(repaired);
  return { kind: "url", url: path, selector };
}

// ---------------------------------------------------------------------------
// Owned skill URI authorization (`repair-omp-owned-skill-handoff` D3).
// ---------------------------------------------------------------------------

/**
 * The injectable skill-URI authorization seam. A resolution names the
 * CANONICAL owned instruction path the current process has verified as
 * belonging to the declared deployment-owned skill source RIGHT NOW; a
 * denial is bounded (reason only, never payload). Production wires the
 * declared-root resolver; tests inject fixed outcomes.
 */
export interface SkillUriAuthorization {
  authorize(uri: string): { readonly ok: true; readonly canonicalPath: string } | {
    readonly ok: false;
    readonly reason: string;
  };
}

/** Metadata-only filesystem observation the production resolver consumes. */
export interface SkillUriSourceReader {
  lstat(
    path: string,
  ): Pick<Deno.FileInfo, "isDirectory" | "isFile" | "isSymlink" | "mode" | "uid" | "nlink">;
  realPath(path: string): string;
}

/**
 * The bounded denial thrown when a `skill://` read is not authorized. The
 * reason names the failing check; the URI is echoed only in its sanitized
 * (no query/fragment) form, mirroring the adapter's credential-free posture.
 */
export class SkillUriDenial extends Error {
  constructor(uri: string, reason: string) {
    super(`skill_uri_denied: ${reason} (uri=${uri.replace(/[?#].*$/, "")})`);
    this.name = "SkillUriDenial";
  }
}

/** The node:fs metadata surface the bun-host reader consumes (named contract). */
interface SkillUriNodeFs {
  lstatSync(path: string): {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
    mode: number;
    uid: number;
    nlink: number;
  };
  realpathSync(path: string): string;
}

/** Host require bridge for the pinned bun runtime (same shape as owned-skills). */
function requireSkillUriNodeFs(): SkillUriNodeFs | undefined {
  const require = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof require !== "function") return undefined;
  // The host `require` is untyped by nature; the interface above IS the
  // checked boundary every field access goes through.
  return require("node:fs") as SkillUriNodeFs;
}

/** The runtime-portable metadata reader (mirror of owned-skills.ts posture). */
function skillUriDefaultReader(): SkillUriSourceReader {
  return {
    lstat: (path) => {
      if (typeof Deno !== "undefined") return Deno.lstatSync(path);
      const fs = requireSkillUriNodeFs();
      if (!fs) throw new Error("skill-URI metadata backend unavailable");
      const info = fs.lstatSync(path);
      return {
        isDirectory: info.isDirectory(),
        isFile: info.isFile(),
        isSymlink: info.isSymbolicLink(),
        mode: info.mode,
        uid: info.uid,
        nlink: info.nlink,
      };
    },
    realPath: (path) => {
      if (typeof Deno !== "undefined") return Deno.realPathSync(path);
      const fs = requireSkillUriNodeFs();
      if (!fs) throw new Error("skill-URI metadata backend unavailable");
      return fs.realpathSync(path);
    },
  };
}

/**
 * The production resolver: authorize a `skill://` URI against the DECLARED
 * canonical deployment-owned skill source only — the constant
 * `OMP_IMAGE_SKILLS_ROOT` the settings contract freezes as the single owned
 * root (never a model-named root, workspace, HOME, or CWD candidate). Every
 * check is re-observed per call (the freshness posture shared with the
 * enforcement observer — a stale generation is a MOVED identity, and a moved
 * identity fails the identity/containment checks at this instant):
 * - shape: `skill://<relative-instruction-path>`; the authority carries no
 *   host component, and `..`/`.`/absolute segments never resolve;
 * - source: the declared root exists as a real, link-free directory whose
 *   realpath IS the constant (a replaced/symlinked identity is denied —
 *   off-image hosts have NO declared source and deny with no fallback root),
 *   and it is neither agent-writable nor group/other-writable;
 * - target: canonicalizes INSIDE the owned source (no traversal out), is an
 *   existing regular file, link-free through every component, and carries no
 *   agent-writable or aliased (hard-linked) identity, while every directory
 *   component between the root and the target is likewise link-free and
 *   non-writable — the same ladder `owned-skills.ts` observes at
 *   registration, re-taken at read time;
 * - generation: the caller's live resource-generation observation must be
 *   present (the extension's load-time discovery generation) — an extension
 *   that never established its generation mints no skill authority.
 * A name alone NEVER authorizes anything: foreign same-name skills are
 * unreachable because only the declared root is consulted, network-adapter
 * completion grants nothing here, and what native delegation receives is the
 * ORIGINAL URI, unchanged — the canonical path never re-enters the input.
 */
export function createOwnedSkillUriAuthorization(deps: {
  /** The declared canonical owned source (production: the constant). */
  readonly ownedRoot: string;
  /** Live resource-generation observation; absent/empty ⇒ no authority. */
  readonly resourceGeneration: () => string;
  readonly reader?: SkillUriSourceReader;
  readonly pathModule?: {
    readonly isAbsolute: (p: string) => boolean;
    readonly join: (...parts: string[]) => string;
    readonly dirname: (p: string) => string;
    readonly sep: string;
  };
}): SkillUriAuthorization {
  // Runtime-portable metadata observation (the owned-skills.ts mirror): the
  // bundle loads under Deno AND the pinned bun host, so each call picks the
  // present runtime's own surface — never a `Deno.*` reference that would
  // ReferenceError under the other host.
  const reader = deps.reader ?? skillUriDefaultReader();
  const pathModule = deps.pathModule ?? {
    isAbsolute: (p) => p.startsWith("/"),
    join: (...parts) => parts.join("/").replace(/\/{2,}/g, "/"),
    dirname: (p) => {
      const cut = p.lastIndexOf("/");
      return cut <= 0 ? "/" : p.slice(0, cut);
    },
    sep: "/",
  };
  return {
    authorize(uri: string) {
      if (deps.resourceGeneration() === "") {
        return { ok: false, reason: "no live resource generation — skill authority unavailable" };
      }
      // Shape: strict `skill://` + safe relative instruction path.
      if (!/^skill:\/\/[^?#]+$/.test(uri)) {
        return { ok: false, reason: "uri is not a skill instruction reference" };
      }
      const relative = uri.slice("skill://".length);
      if (
        pathModule.isAbsolute(relative) ||
        relative.split("/").some((segment) =>
          segment === "" || segment === "." ||
          segment === ".."
        )
      ) {
        return { ok: false, reason: "uri path is not a safe relative instruction path" };
      }
      // Source: the declared root's CURRENT identity (never a candidate list).
      let rootReal: string;
      try {
        const rootInfo = reader.lstat(deps.ownedRoot);
        if (rootInfo.isSymlink || !rootInfo.isDirectory) {
          return { ok: false, reason: "declared skill source is not a plain directory" };
        }
        if (rootInfo.uid !== 0 && ((rootInfo.mode ?? 0o777) & 0o222) !== 0) {
          return { ok: false, reason: "declared skill source is agent-writable" };
        }
        if (((rootInfo.mode ?? 0o777) & 0o022) !== 0) {
          return { ok: false, reason: "declared skill source is group/other-writable" };
        }
        rootReal = reader.realPath(deps.ownedRoot);
      } catch {
        return { ok: false, reason: "declared skill source is not observable (no fallback root)" };
      }
      if (rootReal !== deps.ownedRoot) {
        return { ok: false, reason: "declared skill source identity replaced" };
      }
      // Target: inside the source, link-free ladder, regular file.
      const candidate = pathModule.join(rootReal, relative);
      let targetReal: string;
      try {
        const info = reader.lstat(candidate);
        if (info.isSymlink || !info.isFile) {
          return { ok: false, reason: "target is not a regular owned file" };
        }
        if (info.uid !== 0 && ((info.mode ?? 0o777) & 0o222) !== 0) {
          return { ok: false, reason: "target is agent-writable" };
        }
        if (((info.mode ?? 0o777) & 0o022) !== 0) {
          return { ok: false, reason: "target is group/other-writable" };
        }
        if (info.nlink !== 1) {
          return { ok: false, reason: "target is aliased (hard-linked)" };
        }
        targetReal = reader.realPath(candidate);
      } catch {
        return { ok: false, reason: "target is not observable under the owned source" };
      }
      // Containment: the REAL target stays inside the declared root (catches
      // every traversal/aliased-device attempt regardless of spelling), and
      // no component of the candidate path is a link.
      if (targetReal !== candidate || !targetReal.startsWith(`${rootReal}${pathModule.sep}`)) {
        return { ok: false, reason: "target escapes or aliases the declared owned source" };
      }
      // Ladder: every DIRECTORY component between the target and the declared
      // root (root inclusive) is link-free, a real directory, and carries no
      // group/other- or agent-writability — a planted instruction file needs
      // a writable ancestor, and one is refused here, not just at the leaf.
      let component = pathModule.dirname(candidate);
      for (;;) {
        try {
          const info = reader.lstat(component);
          if (info.isSymlink) {
            return { ok: false, reason: "linked path component under the owned source" };
          }
          if (!info.isDirectory) {
            return { ok: false, reason: "path component is not a directory" };
          }
          if (info.uid !== 0 && ((info.mode ?? 0o777) & 0o222) !== 0) {
            return { ok: false, reason: "path component is agent-writable" };
          }
          if (((info.mode ?? 0o777) & 0o022) !== 0) {
            return { ok: false, reason: "path component is group/other-writable" };
          }
        } catch {
          return { ok: false, reason: "path component not observable" };
        }
        if (component === rootReal) break;
        const parent = pathModule.dirname(component);
        if (parent === component) {
          return { ok: false, reason: "target does not chain to the declared source" };
        }
        component = parent;
      }
      return { ok: true, canonicalPath: targetReal };
    },
  };
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
  /**
   * The pinned native skill-reading capability declaration: the host grants
   * skill-URI reads to a registered tool only when its definition asks for
   * them. The owned-skill branch below authorizes every such read BEFORE
   * same-tool native delegation; nothing about this flag admits a URI on its
   * own.
   */
  readonly readsSkillUris: true;
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
 * `btoa` is present on every host runtime that can load this closure (Deno,
 * Bun, Node); anything without it fails closed rather than emitting bytes
 * labelled base64 that were never base64-encoded.
 */
export function encodeBase64(bytes: Uint8Array): string {
  const b = globalThis as { btoa?: (data: string) => string };
  if (typeof b.btoa !== "function") {
    throw new Error("read replacement: no base64 surface available in the host runtime");
  }
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return b.btoa(out);
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
    readsSkillUris: true,
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      void toolCallId;
      const rawPath: unknown = params["path"];
      // Shape is the host gate's job (`parameters` declares a required
      // string, so a non-string never reaches execute through the host);
      // this executor-side coercion stays as the independent second layer,
      // keeping pre-gate executor behavior byte-for-byte unchanged.
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
      if (branch.kind === "skill-uri") {
        // Owned-skill URI: authorize FIRST, delegate once on success. An
        // unwired seam fails closed (no resolver improvisation); a denial
        // never reaches the native tool; an authorized read hands the
        // ORIGINAL URI verbatim to the captured native through the same
        // supported same-tool context — native instruction handling and
        // bookkeeping stay native, and the canonical owned path is evidence
        // of authorization only, never a rewritten argument.
        const authorization = deps.skillUriAuthorization;
        if (!authorization) {
          throw new SkillUriDenial(branch.uri, "no skill-URI authorization is wired");
        }
        const resolution = authorization.authorize(branch.uri);
        if (!resolution.ok) {
          throw new SkillUriDenial(branch.uri, resolution.reason);
        }
        if (typeof ctx?.invokeTool !== "function") {
          throw new Error(
            "read replacement: no same-tool native delegation context — failing closed " +
              "(authorized skill reads delegate to the captured native skill reader)",
          );
        }
        return ctx.invokeTool(params, signal ? { signal } : undefined);
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
 * Runtime DNS seam: the runtime-compatible Node DNS interface
 * (`node:dns/promises`), available in the pinned native (Bun-embedded)
 * runtime and the Deno daemon alike
 * (`package-bun-compatible-omp-extension` D4) — the absence of a Deno
 * global never disables otherwise supported public-host resolution, and no
 * Deno polyfill exists here. Literal IPs pass through untouched — the same
 * transport-plumbing short-circuit `ssrf.ts`'s own `resolveHostAddresses`
 * performs (literal IPv4 / colon-bearing IPv6 returned as-is), NOT a rule
 * fork: literals are still classified by the shared `isDisallowedAddress`
 * downstream, so a literal metadata/private IP blocks with its true class
 * instead of a misleading `dns-unresolved`.
 *
 * Both families are collected; a no-record/failed response in ONE family
 * never discards the other family's valid answers, and records are
 * deduplicated. An empty answer set is NOT fabricated into success: the
 * shared decision core (which receives these answers through the existing
 * transport seam) blocks `dns-unresolved` fail-closed, and the same
 * existing SSRF classifier evaluates every resulting hop. The A/AAAA
 * collection rule itself is `ssrf.ts`'s exported `resolveHostAnswers`
 * (single shared seam, never forked here), driven through the injectable
 * `node:dns/promises` face the DNS fixtures exercise.
 */
export async function runtimeResolveHost(host: string): Promise<string[]> {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) return [host];
  // The shared collection rule (both families, per-family failure tolerated,
  // deduplicated) lives in ssrf.ts; the fail-closed empty-answer rule stays
  // in the decision core (empty answers → dns-unresolved block).
  return await resolveHostAnswers(host, nodeDns);
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

// C4 (`wire-omp-native-extension-api`) removed the load-time attach, the
// module-global registration record, and the factory-side attachment
// point: the restricted definitions reach the pinned `registerTool`
// surface ONLY through the native-API adapter (`./native-registration.ts`
// → the default factory), never through a private slot or a returned
// field. Native invocation of the replacement remains candidate-to-verify
// (design §15).
