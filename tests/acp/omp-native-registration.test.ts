// tests/acp/omp-native-registration.test.ts
//
// API-shaped smoke suite for the C4 native registration
// (`wire-omp-native-extension-api`, task 2.1).
//
// The fake here has EXACTLY the pinned `ExtensionAPI` surface the adapter
// touches — `on("tool_call")`, `registerTool`, and a `ctx.getAllTools()`
// roster — and drives the SAME `createNativeExtensionFactory` product the
// entrypoint default-exports (never `index.ts` itself: the row-12 gate
// throws at import, pinned by omp-discovery-guard.test.ts). Synthetic
// rosters throughout: nothing here demonstrates that the official binary
// evaluates the factory, invokes the callback, or honors a block — that is
// the user-owned checklist (docs/OMP_ENFORCEMENT.md §Checklist).
//
// Dispatch discipline: a callback return of `undefined` is the ONLY outcome
// under which the native call continues, so `dispatched === true` here
// means "not blocked by enforcement" — the completing authority still
// owns the call.

import { assert, assertEquals } from "@std/assert";
import {
  createNativeExtensionFactory,
  type NativeExtensionApi,
  type NativeRegistrationDeps,
  nativeReplacementTools,
  type NativeToolCallEvent,
  type NativeToolInfo,
} from "@acp/omp/extension/native-registration.ts";
import { OMP_TRUSTED_EXTENSION_PATH } from "@utils/omp-paths.ts";

const RESTRICTED_CWD = "/opt/air/omp-agent/restricted/cwd";
const OWN_BUNDLE_PATH = "/opt/air/omp/extension/index.js";
const OWN_BUNDLE_URL = `file://${OWN_BUNDLE_PATH}`;
const OWN_SOURCE = { path: OWN_BUNDLE_PATH, source: "extension" } as const;
// The contracted deployment-tree identity 14a's own verifier admits.
const CONTRACTED_PATH = `/opt/air/${OMP_TRUSTED_EXTENSION_PATH}`;
const CONTRACTED_SOURCE = { path: CONTRACTED_PATH, source: "extension" } as const;
const HOST_BASH: NativeToolInfo = {
  name: "bash",
  sourceInfo: { path: "/opt/air/lib/bun/oh-my-pi", source: "builtin" },
};

/** Synthetic trusted acquired-session canonical observation (fixture only:
 * production wires NO session context, pinned by its own test below). */
function trustedContext() {
  return {
    resolveCanonicalTargets: () => [],
    canonicalTarget: {
      acpSessionId: "s1",
      sessionContextGeneration: "g1",
      roles: ["trusted-skills"] as const,
      rootIdentities: [{
        role: "trusted-skills" as const,
        configuredPath: "/opt/air/src/acp/omp/extension",
        canonicalPath: "/opt/air/src/acp/omp/extension",
        readOnly: true,
      }],
      normalizedInput: CONTRACTED_PATH,
      canonicalTarget: CONTRACTED_PATH,
      rootRelativePath: "index.ts",
      targetType: "file" as const,
      observedSymlinks: [],
    },
  };
}

interface FakeApiHarness {
  readonly api: NativeExtensionApi;
  readonly handlers: Array<(event: NativeToolCallEvent) => unknown>;
  readonly tools: NativeToolInfo[];
  registeredTools: NativeToolInfo["name"][];
}

/** The API-shaped fake: only the pinned members, nothing more. */
function createFakeApi(initialRoster: readonly NativeToolInfo[]): FakeApiHarness {
  const handlers: Array<(event: NativeToolCallEvent) => unknown> = [];
  const registeredTools: NativeToolInfo["name"][] = [];
  const tools = [...initialRoster];
  const api: NativeExtensionApi = {
    on: (event, handler) => {
      if (event === "tool_call") handlers.push(handler);
    },
    registerTool: (tool) => {
      registeredTools.push(tool.name);
    },
    ctx: { getAllTools: () => tools },
  };
  return { api, handlers, tools, registeredTools };
}

function harness(
  roster: readonly NativeToolInfo[],
  depsOver: Partial<NativeRegistrationDeps> = {},
): {
  h: FakeApiHarness;
  run: (event: NativeToolCallEvent) => { blocked: boolean; dispatched: boolean; reason?: string };
} {
  const surfaced: string[] = [];
  const h = createFakeApi(roster);
  const factory = createNativeExtensionFactory(() => ({
    observedCwd: RESTRICTED_CWD,
    resourceGeneration: () => "gen-0",
    moduleUrl: OWN_BUNDLE_URL,
    contractedRelative: OMP_TRUSTED_EXTENSION_PATH,
    replacementTools: nativeReplacementTools(),
    surfaceError: (message: string) => surfaced.push(message),
    ...depsOver,
  }));
  factory(h.api);
  const run = (event: NativeToolCallEvent) => {
    assertEquals(h.handlers.length, 1, "exactly one tool_call callback is registered");
    const result = h.handlers[0]!(event) as
      | { block?: boolean; reason?: string }
      | undefined;
    return {
      blocked: result?.block === true,
      dispatched: result === undefined,
      ...(result?.reason !== undefined ? { reason: result.reason } : {}),
    };
  };
  return { h, run };
}

function assertBoundedBlock(outcome: { blocked: boolean; reason?: string }, code: string): void {
  assert(outcome.blocked, `expected a block carrying ${code}`);
  assert(
    outcome.reason !== undefined && outcome.reason.startsWith("restricted tool call blocked: "),
  );
  assert(outcome.reason.includes(code), `reason must carry ${code}: ${outcome.reason}`);
  // Bounded shape: no payload, path content, or model text can appear.
  assert(!outcome.reason.includes("docs/"), `reason must stay content-free: ${outcome.reason}`);
}

// ---------------------------------------------------------------------------
// Task 1.1: registration happens during factory evaluation, native-API only.
// ---------------------------------------------------------------------------

Deno.test("Native registration: restricted factory registers via api.on + api.registerTool", () => {
  const h = createFakeApi([]);
  const factory = createNativeExtensionFactory(() => ({
    observedCwd: RESTRICTED_CWD,
    resourceGeneration: () => "gen-0",
    moduleUrl: OWN_BUNDLE_URL,
    contractedRelative: OMP_TRUSTED_EXTENSION_PATH,
    replacementTools: nativeReplacementTools(),
    surfaceError: () => {},
  }));
  const result = factory(h.api);
  assertEquals(result.registered, true);
  assertEquals(result.mode, "restricted");
  assertEquals(h.handlers.length, 1);
  // The C2 controlled replacements are handed to the native registrar.
  assertEquals([...h.registeredTools].sort(), ["read", "web_search"]);
});

Deno.test("Native registration: native-YOLO and unidentified factories register NOTHING", () => {
  for (const observedCwd of ["/opt/air/omp-agent/native-yolo/cwd", "/somewhere/else"]) {
    const h = createFakeApi([{ name: "read", sourceInfo: OWN_SOURCE }]);
    const factory = createNativeExtensionFactory(() => ({
      observedCwd,
      resourceGeneration: () => "gen-0",
      moduleUrl: OWN_BUNDLE_URL,
      contractedRelative: OMP_TRUSTED_EXTENSION_PATH,
      replacementTools: nativeReplacementTools(),
      surfaceError: () => {},
    }));
    const result = factory(h.api);
    assertEquals(result.registered, false, observedCwd);
    assertEquals(h.handlers.length, 0, observedCwd);
    assertEquals(h.registeredTools.length, 0, observedCwd);
  }
});

// ---------------------------------------------------------------------------
// Task 1.2: fresh getAllTools() provenance decides every call.
// ---------------------------------------------------------------------------

Deno.test("Native provenance: owned replacement retains its actual origin and proceeds to the NAMED completing boundary", () => {
  const { run } = harness([
    { name: "read", sourceInfo: CONTRACTED_SOURCE },
    { name: "web_search", sourceInfo: CONTRACTED_SOURCE },
    HOST_BASH,
  ], { sessionContext: trustedContext() });
  const outcome = run({ toolCallId: "call-1", toolName: "read", input: { path: "docs/x.md" } });
  // proceed === continue-toward-row4, NOT authorized: the callback hands
  // the call to the named completing authority (undefined return). The
  // owned identity survives the provenance step on its ACTUAL extension
  // origin — never relabelled builtin because its name is `read`.
  assertEquals(outcome.dispatched, true);
});

Deno.test("Native provenance: production shape (no trusted session context) denies owned reads fail-closed", () => {
  // The pinned host acquires NO canonical session context into the
  // extension child today: the owned tier's REQUIRED canonical evidence
  // is absent, so every owned-name call denies re-observe — the honest
  // shipped limit, never a permission invented from a lexical path.
  const { run } = harness([{ name: "read", sourceInfo: CONTRACTED_SOURCE }]);
  const outcome = run({ toolCallId: "p1", toolName: "read", input: { path: "docs/x.md" } });
  assertBoundedBlock(outcome, "rejected_stale_observation");
  assert(outcome.reason?.includes("origin=owned-extension"), outcome.reason ?? "");
});

Deno.test("Native provenance: host-owned builtin keeps its host origin and denies before dispatch", () => {
  const { run } = harness([{ name: "read", sourceInfo: OWN_SOURCE }, HOST_BASH]);
  const outcome = run({ toolCallId: "call-2", toolName: "bash", input: { command: "ls" } });
  assertBoundedBlock(outcome, "rejected_tool_provenance");
  assertEquals(outcome.dispatched, false);
});

Deno.test("Native provenance: mid-session same-name foreign replacement denies; the stable roster never reads stale", () => {
  const { h, run } = harness([{ name: "read", sourceInfo: CONTRACTED_SOURCE }], {
    sessionContext: trustedContext(),
  });
  assertEquals(
    run({ toolCallId: "c1", toolName: "read", input: { path: "docs/x.md" } }).dispatched,
    true,
  );
  // Byte-identical repeat on the unchanged roster: live-read, never stale.
  assertEquals(
    run({ toolCallId: "c2", toolName: "read", input: { path: "docs/x.md" } }).dispatched,
    true,
  );
  // Foreign same-name extension file enters the registry: the fresh read
  // re-keys the first-sighting capture to an unowned identity — denied.
  h.tools[0] = {
    name: "read",
    sourceInfo: { path: "/home/attacker/tool.js", source: "extension" },
  };
  const outcome = run({ toolCallId: "c3", toolName: "read", input: { path: "docs/x.md" } });
  assertBoundedBlock(outcome, "rejected_tool_provenance");
});

Deno.test("Native provenance: resource-generation rotation reads stale and denies", () => {
  let generation = "gen-0";
  const { run } = harness([{ name: "read", sourceInfo: CONTRACTED_SOURCE }], {
    resourceGeneration: () => generation,
    sessionContext: trustedContext(),
  });
  assertEquals(
    run({ toolCallId: "c1", toolName: "read", input: { path: "docs/x.md" } }).dispatched,
    true,
  );
  // Row 12 rotates the session generation; the recorded half stays at the
  // first sighting ⇒ BOTH-or-NEITHER denies re-observe.
  generation = "gen-1";
  const outcome = run({ toolCallId: "c2", toolName: "read", input: { path: "docs/x.md" } });
  assertBoundedBlock(outcome, "rejected_stale_observation");
});

Deno.test("Native provenance: missing, duplicate, and unreadable rosters deny every call fail-closed", () => {
  // No sourceInfo at all.
  assertBoundedBlock(
    harness([{ name: "read" }]).run({ toolCallId: "m1", toolName: "read", input: { path: "x" } }),
    "rejected_tool_provenance",
  );
  // Duplicate names: the entry is ambiguous, so NOTHING is owned.
  assertBoundedBlock(
    harness([
      { name: "read", sourceInfo: OWN_SOURCE },
      { name: "read", sourceInfo: OWN_SOURCE },
    ]).run({ toolCallId: "m2", toolName: "read", input: { path: "x" } }),
    "rejected_tool_provenance",
  );
  // Prototype-key names must not defeat the duplicate guard through an
  // inherited Object.prototype member (`constructor`), nor silently drop
  // the count (`__proto__` bracket writes never create own properties).
  // These names are also table-foreign, so the inventory absence-deny may
  // fire first — the discriminating invariant is that the record reads
  // UNOWNED: a defeated guard would translate the first (owned-path)
  // spelling and the block would name the owned origin instead.
  for (const poisoned of ["constructor", "__proto__"]) {
    const outcome = harness([
      { name: poisoned, sourceInfo: OWN_SOURCE },
      { name: poisoned, sourceInfo: { path: "/home/attacker/tool.js", source: "extension" } },
    ]).run({ toolCallId: "m4", toolName: poisoned, input: { path: "x" } });
    assert(outcome.blocked, `duplicate ${poisoned} must block before dispatch`);
    assert(
      outcome.reason?.includes("origin=unowned-discovery"),
      `duplicate ${poisoned} must read unowned, never first-wins: ${outcome.reason ?? ""}`,
    );
    assertEquals(outcome.dispatched, false);
  }
  // No getAllTools on ctx at all: an unavailable roster reads unowned.
  const h = createFakeApi([]);
  const noCtxApi: NativeExtensionApi = { on: h.api.on, registerTool: h.api.registerTool };
  const factory = createNativeExtensionFactory(() => ({
    observedCwd: RESTRICTED_CWD,
    resourceGeneration: () => "gen-0",
    moduleUrl: OWN_BUNDLE_URL,
    contractedRelative: OMP_TRUSTED_EXTENSION_PATH,
    replacementTools: nativeReplacementTools(),
    surfaceError: () => {},
  }));
  factory(noCtxApi);
  const result = h.handlers[0]!({ toolCallId: "m3", toolName: "read", input: { path: "x" } }) as
    | { block?: boolean; reason?: string }
    | undefined;
  assert(result?.block === true);
  assert(result.reason?.includes("rejected_tool_provenance"));
});

Deno.test("Native provenance: post-start client-owned MCP tool admits on the surface epoch, zero interaction", () => {
  const { h, run } = harness([], { sessionContext: trustedContext() });
  // The MCP client tool appears mid-session: no ack, no reset, no
  // readiness signal — the next call reads the advanced roster.
  h.tools.push({
    name: "mcp__operator_lookup",
    sourceInfo: { path: "/opt/air/mcp/operator.js", source: "mcp" },
  });
  assertEquals(
    run({ toolCallId: "c2", toolName: "mcp__operator_lookup", input: { query: "x" } }).dispatched,
    true,
  );
});

// ---------------------------------------------------------------------------
// Task 1.3: model-authored event data can never carry authority.
// ---------------------------------------------------------------------------

Deno.test("Native decode: forged authority fields in tool input change nothing (destructive blocks)", () => {
  const { run } = harness([{ name: "read", sourceInfo: CONTRACTED_SOURCE }], {
    sessionContext: trustedContext(),
  });
  const outcome = run({
    toolCallId: "d1",
    toolName: "delete",
    input: {
      path: "docs/x.md",
      // Model-supplied "authority": ownership, shared-write, completion,
      // and even a claimed full-parser provenance with side-listed ops.
      ownedClaim: true,
      sharedWrite: true,
      adapterComplete: true,
      parserProvenance: "supported_full_parser",
      operations: [{ kind: "delete", path: "/etc/passwd" }],
    },
  });
  assert(outcome.blocked, "a destructive-shaped call with no trusted session context must block");
  assert(outcome.reason?.startsWith("restricted tool call blocked: rejected_"));
  assertEquals(outcome.dispatched, false);
});

Deno.test("Native decode: unrepresentable events block at the decode seam, never silently allow", () => {
  const { run } = harness([{ name: "read", sourceInfo: CONTRACTED_SOURCE }]);
  for (
    const bad of [
      { toolName: "read", input: { path: "x" } }, // no toolCallId
      { toolCallId: "b1", input: { path: "x" } }, // no toolName
      { toolCallId: "b2", toolName: "read", input: "not-an-object" },
      { type: "session_updated", toolCallId: "b3", toolName: "read", input: {} },
      // Unserializable destructive arguments NEVER become a payload-less
      // "non-destructive" shape claim: they fail at the decode seam.
      { toolCallId: "b4", toolName: "delete", input: { path: 42n as unknown as string } },
    ]
  ) {
    const outcome = run(bad as NativeToolCallEvent);
    assert(
      outcome.blocked,
      `unrepresentable event must block: ${
        JSON.stringify(bad, (_k, v) => typeof v === "bigint" ? "<bigint>" : v)
      }`,
    );
    assert(outcome.reason?.includes("rejected_enforcement_seam"));
    assert(outcome.reason?.includes("native-event-decode"));
    assertEquals(outcome.dispatched, false);
  }
});

// ---------------------------------------------------------------------------
// C5 (`admit-completed-omp-network-adapters`, task 2.1): the composed
// native-callback surface consumes route completion — completion admits ONLY
// the registered owned replacement on a completed route with a supported
// backend; absence keeps the bounded pending block with zero dispatch.
// Synthetic API-shaped fixtures throughout (same honesty rules as above).
// ---------------------------------------------------------------------------

const NO_BACKEND = { geminiKey: false, openrouterKey: false };
const GEMINI_BACKEND = { geminiKey: true, openrouterKey: false };

Deno.test("Native C5: registered owned URL read proceeds on the completed route; web_search blocks pending with no backend", () => {
  const { run } = harness([
    { name: "read", sourceInfo: CONTRACTED_SOURCE },
    { name: "web_search", sourceInfo: CONTRACTED_SOURCE },
  ], { sessionContext: trustedContext(), searchCredentialPresence: () => NO_BACKEND });
  // URL-shaped read on the registered owned replacement: the completed
  // controlled route covers it ⇒ continue (undefined return — the named
  // replacement, not native transport, owns the call).
  assertEquals(
    run({ toolCallId: "u1", toolName: "read", input: { path: "https://example.com/page" } })
      .dispatched,
    true,
  );
  // web_search with NO supported backend: the existing bounded pending
  // block, zero dispatch (nothing continues into any transport).
  const blocked = run({ toolCallId: "s1", toolName: "web_search", input: { query: "q" } });
  assertBoundedBlock(blocked, "rejected_pending_adapter");
});

Deno.test("Native C5: supported backend continues; presence read per call, mid-session change moves the next call", () => {
  let presence = NO_BACKEND;
  const { run } = harness([{ name: "web_search", sourceInfo: CONTRACTED_SOURCE }], {
    sessionContext: trustedContext(),
    searchCredentialPresence: () => presence,
  });
  assertBoundedBlock(
    run({ toolCallId: "p1", toolName: "web_search", input: { query: "q" } }),
    "rejected_pending_adapter",
  );
  presence = GEMINI_BACKEND;
  assertEquals(
    run({ toolCallId: "p2", toolName: "web_search", input: { query: "q" } }).dispatched,
    true,
    "availability appearing moves the NEXT call — never cached",
  );
  presence = NO_BACKEND;
  // Availability disappearing returns the bounded block (read fresh again).
  assertBoundedBlock(
    run({ toolCallId: "p3", toolName: "web_search", input: { query: "q" } }),
    "rejected_pending_adapter",
  );
});

Deno.test("Native C5: shadow-same-name registration never completes the URL route", () => {
  const { h, run } = harness([{ name: "read", sourceInfo: CONTRACTED_SOURCE }], {
    sessionContext: trustedContext(),
    searchCredentialPresence: () => NO_BACKEND,
  });
  assertEquals(
    run({ toolCallId: "k1", toolName: "read", input: { path: "https://example.com/a" } })
      .dispatched,
    true,
  );
  // A foreign same-name extension file takes the slot: the fresh provenance
  // read re-keys it unowned ⇒ denial BEFORE the clamp — no completion path,
  // no dispatch.
  h.tools[0] = {
    name: "read",
    sourceInfo: { path: "/home/attacker/tool.js", source: "extension" },
  };
  assertBoundedBlock(
    run({ toolCallId: "k2", toolName: "read", input: { path: "https://example.com/b" } }),
    "rejected_tool_provenance",
  );
});
