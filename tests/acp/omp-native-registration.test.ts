// tests/acp/omp-native-registration.test.ts
//
// API-shaped smoke suite for the C4 native registration
// (`wire-omp-native-extension-api`, task 2.1).
//
// The fake here has EXACTLY the pinned `ExtensionAPI` surface the adapter
// touches — `on("tool_call")`, `registerTool`, and the DIRECT
// `api.getAllTools()` roster method (with the pinned runtime's throwing
// load-time stub behaviour) — and drives the SAME `createNativeExtensionFactory` product the
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
import { decodeNativeToolCallEvent } from "@acp/omp/extension/native-events.ts";

const RESTRICTED_CWD = "/opt/air/omp-agent/restricted/cwd";
const OWN_BUNDLE_PATH = "/opt/air/omp/extension/index.js";
const OWN_BUNDLE_URL = `file://${OWN_BUNDLE_PATH}`;
const OWN_SOURCE = { path: OWN_BUNDLE_PATH, source: "extension" } as const;
// The contracted deployment-tree identity 14a's own verifier admits.
const CONTRACTED_PATH = `/opt/air/${OMP_TRUSTED_EXTENSION_PATH}`;
const CONTRACTED_SOURCE = { path: CONTRACTED_PATH, source: "extension" } as const;
/**
 * The EXACT pinned runtime tuple for an authentic builtin
 * (`session/session-tools.ts#getAllToolInfos` at the pin): src=builtin,
 * `<builtin:name>` path, `temporary` scope, `top-level` origin.
 */
function builtinTool(name: string): NativeToolInfo {
  return {
    name,
    sourceInfo: {
      path: `<builtin:${name}>`,
      source: "builtin",
      scope: "temporary",
      origin: "top-level",
    },
  };
}

const BUILTIN_BASH = builtinTool("bash");

/** RPC-host injection: `sdk` is host-owned and never a builtin. */
const HOST_SDK_BASH: NativeToolInfo = {
  name: "bash",
  sourceInfo: { path: "<sdk:bash>", source: "sdk", scope: "temporary", origin: "top-level" },
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
  /** Roster reads the adapter performed (deferral evidence). */
  readonly rosterReads: { count: number };
  /** Flip to false: the roster method throws, like the pinned load-time stub. */
  readonly state: { initialized: boolean };
  registeredTools: NativeToolInfo["name"][];
}

/** The API-shaped fake: only the pinned members, nothing more. */
function createFakeApi(initialRoster: readonly NativeToolInfo[]): FakeApiHarness {
  const handlers: Array<(event: NativeToolCallEvent) => unknown> = [];
  const registeredTools: NativeToolInfo["name"][] = [];
  const tools = [...initialRoster];
  const rosterReads = { count: 0 };
  const state = { initialized: true };
  const api: NativeExtensionApi = {
    on: (event, handler) => {
      if (event === "tool_call") handlers.push(handler);
    },
    registerTool: (tool) => {
      registeredTools.push(tool.name);
    },
    getAllTools: () => {
      if (!state.initialized) {
        // The pinned runtime's action stub: callable at load, throws until the
        // host initializes the action set.
        throw new Error("Extension runtime not initialized.");
      }
      rosterReads.count += 1;
      return tools;
    },
  };
  return { api, handlers, tools, rosterReads, state, registeredTools };
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

Deno.test("Native registration: the factory registers with a THROWING load-time roster stub and never reads the roster (task 1.1)", () => {
  const h = createFakeApi([BUILTIN_BASH]);
  // The pinned runtime's action methods throw until the host initializes
  // them: the factory must register WITHOUT consulting the roster.
  h.state.initialized = false;
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
  assertEquals(h.handlers.length, 1);
  assertEquals(h.rosterReads.count, 0, "registration must not read the live roster");
  // Initialization completes: the LATER live call observes the real
  // sourceInfo metadata and the authentic builtin reaches its authority.
  h.state.initialized = true;
  const outcome = h.handlers[0]!({ toolCallId: "d1", toolName: "bash", input: { command: "ls" } });
  assertEquals(outcome, undefined, "authentic builtin proceeds toward native approval");
  assert(h.rosterReads.count > 0, "the live observation read the initialized roster");
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
    BUILTIN_BASH,
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

Deno.test("Native provenance: an authentic builtin admits as native-builtin; SDK injection and inconsistent tuples deny (task 1.2)", () => {
  // Genuine builtin: the exact pinned runtime tuple, unique in the roster.
  const genuine = harness([{ name: "read", sourceInfo: OWN_SOURCE }, BUILTIN_BASH]);
  assertEquals(
    genuine.run({ toolCallId: "call-2", toolName: "bash", input: { command: "ls" } }).dispatched,
    true,
  );
  // SDK/RPC-host injection wearing a builtin name: host origin, denied.
  const injected = harness([{ name: "read", sourceInfo: OWN_SOURCE }, HOST_SDK_BASH]);
  assertBoundedBlock(
    injected.run({ toolCallId: "call-3", toolName: "bash", input: { command: "ls" } }),
    "rejected_tool_provenance",
  );
  assertEquals(
    injected.run({ toolCallId: "call-4", toolName: "bash", input: { command: "ls" } }).dispatched,
    false,
  );
  // A builtin-labelled entry that does not present the exact tuple for THIS
  // name is not an authentic builtin: unowned, denied, never cached-name
  // authority.
  const forgedTuples: NativeToolInfo[] = [
    {
      name: "bash",
      sourceInfo: {
        path: "<builtin:read>",
        source: "builtin",
        scope: "temporary",
        origin: "top-level",
      },
    },
    {
      name: "bash",
      sourceInfo: {
        path: "<builtin:bash>",
        source: "builtin",
        scope: "project",
        origin: "top-level",
      },
    },
    {
      name: "bash",
      sourceInfo: {
        path: "<builtin:bash>",
        source: "builtin",
        scope: "temporary",
        origin: "package",
      },
    },
    {
      name: "bash",
      sourceInfo: { path: "/opt/air/lib/bun/oh-my-pi", source: "builtin" },
    },
  ];
  for (const forged of forgedTuples) {
    const outcome = harness([{ name: "read", sourceInfo: OWN_SOURCE }, forged]).run({
      toolCallId: "call-5",
      toolName: "bash",
      input: { command: "ls" },
    });
    assertBoundedBlock(outcome, "rejected_tool_provenance");
    assert(
      outcome.reason?.includes("origin=unowned-discovery"),
      `forged tuple must read unowned: ${outcome.reason ?? ""}`,
    );
  }
});

Deno.test("Native provenance: an unrelated roster movement keeps an unchanged builtin admitted; a same-name replacement denies (task 1.3)", () => {
  const { h, run } = harness([BUILTIN_BASH]);
  assertEquals(
    run({ toolCallId: "b1", toolName: "bash", input: { command: "ls" } }).dispatched,
    true,
  );
  // An unrelated tool appears mid-session: the roster (and its epoch) moved.
  h.tools.push({ name: "mcp__operator_lookup", sourceInfo: { source: "mcp" } });
  assertEquals(
    run({ toolCallId: "b2", toolName: "bash", input: { command: "ls" } }).dispatched,
    true,
    "the fresh read still identifies the unchanged builtin tuple",
  );
  // A same-name foreign replacement takes the slot: the fresh read loses
  // builtin membership entirely ⇒ owned-path/unowned, denied.
  h.tools[0] = {
    name: "bash",
    sourceInfo: { path: "/home/attacker/tool.js", source: "extension" },
  };
  assertBoundedBlock(
    run({ toolCallId: "b3", toolName: "bash", input: { command: "ls" } }),
    "rejected_tool_provenance",
  );
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
  // No getAllTools method at all: an unavailable roster reads unowned.
  const h = createFakeApi([]);
  const methodlessApi: NativeExtensionApi = { on: h.api.on, registerTool: h.api.registerTool };
  const factory = createNativeExtensionFactory(() => ({
    observedCwd: RESTRICTED_CWD,
    resourceGeneration: () => "gen-0",
    moduleUrl: OWN_BUNDLE_URL,
    contractedRelative: OMP_TRUSTED_EXTENSION_PATH,
    replacementTools: nativeReplacementTools(),
    surfaceError: () => {},
  }));
  factory(methodlessApi);
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
// Task 4.1/4.2: production-shaped native admission through the composed
// callback — authentic local builtin search, ordinary local write/edit, the
// complete multi-root screen, and the accepted native read posture. Synthetic
// rosters throughout; nothing here demonstrates official-binary behavior.
// ---------------------------------------------------------------------------

Deno.test("Native search: authentic local builtin search proceeds; every mixed or remote root list denies as a WHOLE (task 4.1)", () => {
  const { run } = harness([builtinTool("grep"), builtinTool("glob"), builtinTool("find")]);
  // Authentic local search: local path/glob/default cwd reach the
  // native-local read approval authority.
  assertEquals(
    run({ toolCallId: "s1", toolName: "grep", input: { pattern: "rm -rf", path: "src/a.ts" } })
      .dispatched,
    true,
  );
  assertEquals(
    run({ toolCallId: "s2", toolName: "glob", input: { path: "src/**/*.ts" } }).dispatched,
    true,
  );
  assertEquals(
    run({
      toolCallId: "s3",
      toolName: "find",
      input: { query: "where", grep_keywords: ["x"], path: "src" },
    }).dispatched,
    true,
  );
  // A literal PATTERN containing URI-like text is not a root: the search
  // stays usable.
  assertEquals(
    run({
      toolCallId: "s4",
      toolName: "grep",
      input: { pattern: "https://example.com/x", path: "src" },
    }).dispatched,
    true,
  );
  // Mixed local + HTTP(S): the WHOLE call denies before scanning.
  const mixed = run({
    toolCallId: "s5",
    toolName: "grep",
    input: { pattern: "x", path: "src/a.ts;https://example.com/x" },
  });
  assertBoundedBlock(mixed, "rejected_alternate_route");
  assert(mixed.reason?.includes("capability=network-read"), mixed.reason ?? "");
  assert(mixed.reason?.includes("route=remote-url"), mixed.reason ?? "");
  // A lone HTTP(S) search root is materialization-bound native transport:
  // never a local search route.
  assertBoundedBlock(
    run({
      toolCallId: "s6",
      toolName: "grep",
      input: { pattern: "x", path: "https://example.com/x" },
    }),
    "rejected_alternate_route",
  );
  // SSH / internal-device / collapsed / glued roots deny with their route.
  for (
    const path of [
      "ssh://host/src",
      "ssh:/host/src",
      "xd://device/notes",
      "local://notes.md",
      "/repo/local://notes.md",
      "memory:12",
      "src,a.ts;ssh://host/x",
      // A scheme-SHAPED token denies for EVERY unknown scheme, not just the
      // pinned ones: the pinned search router resolves unregistered custom
      // schemes through its MCP resource fallback, so neither the known
      // (local://, xd://) nor an unknown (file:/, weird:/) spelling can be
      // proven local.
      "file:/repo/a.txt",
      "file:///repo/a.txt",
      "weird:/repo/a.txt",
    ]
  ) {
    const outcome = run({ toolCallId: "s7", toolName: "grep", input: { pattern: "x", path } });
    assertBoundedBlock(outcome, "rejected_alternate_route");
    assertEquals(outcome.dispatched, false, path);
  }
  // Colon-bearing local names stay usable exactly where they are NOT
  // scheme-shaped with a slash and their opaque prefix is not a pinned
  // internal scheme.
  for (const path of ["archive.zip:member.md", "report.pdf", "notes:2-4", "C:/repo/src"]) {
    assertEquals(
      run({ toolCallId: "s8", toolName: "grep", input: { pattern: "x", path } }).dispatched,
      true,
      path,
    );
  }
});

Deno.test("Native read/write: accepted native-local reads and ordinary write/edit; unrepresentable destructive intents still deny (tasks 4.1/4.2)", () => {
  const { run } = harness([
    builtinTool("read"),
    builtinTool("write"),
    builtinTool("edit"),
    builtinTool("apply_patch"),
  ]);
  // Direct native local read is ACCEPTED local behavior under the native
  // read approval authority — not protected ACP callback evidence.
  assertEquals(
    run({ toolCallId: "r1", toolName: "read", input: { path: "src/a.md" } }).dispatched,
    true,
  );
  // Ordinary local write/edit reach the pinned native approval path (no
  // pre-dispatch sink-route evidence gate in this change).
  assertEquals(
    run({ toolCallId: "w1", toolName: "write", input: { path: "notes.md", content: "x" } })
      .dispatched,
    true,
  );
  assertEquals(
    run({ toolCallId: "w2", toolName: "edit", input: { path: "notes.md" } }).dispatched,
    true,
  );
  // A skill:// read is the owned skill-URI route, never a device route.
  assertEquals(
    run({ toolCallId: "r2", toolName: "read", input: { path: "skill://send-reply/SKILL.md" } })
      .dispatched,
    true,
  );
  // A remote/device read root denies before dispatch.
  assertBoundedBlock(
    run({ toolCallId: "r3", toolName: "read", input: { path: "xd://device/x" } }),
    "rejected_alternate_route",
  );
  // Destructive / multi-file intents the pinned event+context cannot
  // represent still fail closed (no trusted acquired-session context here).
  const multiFile = run({
    toolCallId: "d1",
    toolName: "apply_patch",
    input: { path: "a.md", operations: [{ kind: "delete", path: "/etc/passwd" }] },
  });
  assertEquals(multiFile.blocked, true);
  assertEquals(multiFile.dispatched, false);
  assert(
    multiFile.reason?.startsWith("restricted tool call blocked: rejected_"),
    multiFile.reason ?? "",
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

// ---------------------------------------------------------------------------
// C6 (`repair-omp-owned-skill-handoff` task 2.1): the decoder must classify
// a `skill://` read as the EXISTING trusted-skills path-target route — never
// a url, never a downgrade to an arbitrary device/opaque shape — and the
// registered read must carry the pinned skill-reading capability backed by
// an owned-seam authorization over the DECLARED root (never a fallback).
// ---------------------------------------------------------------------------

Deno.test("Native C6: skill:// decodes as path-target, never url/device", () => {
  for (
    const path of [
      "skill://send-reply/SKILL.md",
      "skill:/send-reply/SKILL.md",
      "skill://nested/dir/SKILL.md",
    ]
  ) {
    const decoded = decodeNativeToolCallEvent({
      toolCallId: "c1",
      toolName: "read",
      input: { path },
    });
    assertEquals(decoded.ok, true, path);
    if (decoded.ok) {
      assertEquals(decoded.input.decodedInputShape, "path-target", path);
    }
  }
  // The http(s) shapes stay url-classified: the skill branch did not widen
  // URL decoding.
  const url = decodeNativeToolCallEvent({
    toolCallId: "c2",
    toolName: "read",
    input: { path: "https://example.com/x" },
  });
  assertEquals(url.ok && url.input.decodedInputShape, "url");
});

Deno.test("Native C6: the registered read declares readsSkillUris and denies skill URIs off-image", async () => {
  const tools = nativeReplacementTools(() => "gen-7");
  const read = tools.find((tool) => tool.name === "read");
  assert(read !== undefined);
  // The pinned capability the native host keys skill admission on.
  assertEquals(read.readsSkillUris, true);
  // The search replacement makes no skill claim.
  assertEquals(tools.find((tool) => tool.name === "search")?.readsSkillUris, undefined);
  // Off-image host (this test machine has no /opt/air/skills): the declared
  // root is not observable, so a skill URI DENIES before any delegation and
  // no fallback root is consulted — and an absent generation changes nothing
  // about that story.
  const deny = async (generation: string) => {
    const seam = nativeReplacementTools(() => generation).find((tool) => tool.name === "read");
    assert(seam?.execute !== undefined);
    try {
      await seam.execute("t1", { path: "skill://send-reply/SKILL.md" }, undefined, undefined, {
        invokeTool: () => Promise.reject(new Error("must never delegate")),
      });
      throw new Error("skill:// off-image must deny");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert(message.includes("skill_uri_denied"), message);
    }
  };
  await deny("gen-7");
  await deny("");
});
