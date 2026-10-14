// tests/acp/omp-native-registration.test.ts
//
// Behavioural suite for the restricted capability registration surface
// (`src/acp/omp/extension/native-registration.ts`).
//
// The pinned native contract is exactly two facts: `api.on("tool_call", h)`
// attaches a SYNCHRONOUS pre-dispatch handler, and `{block: true, reason}`
// stops the call before it executes. Everything asserted here is stated in
// terms of those two facts plus the restricted capability map: mapped tool
// names continue to native dispatch (return `undefined`), every other name is
// blocked with the bounded `rejected_unknown_tool` reason.
//
// The `NativeExtensionApi` fixture is a recorder, not a mock framework: it
// remembers what the module registered so the assertions below can drive the
// registered handler themselves. Nothing here claims the official binary
// evaluates the entrypoint or honours a block — that is the user-owned
// checklist.

import { assert, assertEquals } from "@std/assert";
import {
  createOmpCapabilityToolCallHandler,
  type NativeExtensionApi,
  type NativeToolCallHandler,
  registerOmpCapabilityCallback,
} from "@acp/omp/extension/native-registration.ts";

/** The restricted capability map's mapped names (exact native tool names). */
const MAPPED_TOOL_NAMES = [
  "read",
  "grep",
  "glob",
  "find",
  "todo",
  "web_search",
  "bash",
  "edit",
  "write",
  "delete",
  "move",
] as const;

/**
 * Unmatched names: never registered by the native runtime or a deployment
 * extension, plus prototype-shaped names that a non-own-property membership
 * test would wrongly admit.
 */
const UNMATCHED_TOOL_NAMES = [
  "unknown_tool",
  "skills",
  "webfetch",
  "task",
  "READ",
  "bash ",
  "",
  "toString",
  "__proto__",
  "constructor",
] as const;

const BLOCKED = { block: true, reason: "rejected_unknown_tool" } as const;

/** Records every `api.on(...)` registration so a test can drive the handler. */
interface RecordingApi {
  readonly api: NativeExtensionApi;
  readonly events: string[];
  readonly handlers: NativeToolCallHandler[];
}

function createRecordingApi(): RecordingApi {
  const events: string[] = [];
  const handlers: NativeToolCallHandler[] = [];
  const api: NativeExtensionApi = {
    on(event, handler) {
      events.push(event);
      handlers.push(handler);
    },
  };
  return { api, events, handlers };
}

/**
 * The pinned pre-dispatch discipline: a call is dispatched natively unless the
 * handler returned `{block: true}`. `dispatched` counts the operations that
 * actually executed for one native tool call.
 */
function invokeNativeToolCall(
  handler: NativeToolCallHandler,
  toolName: string,
): { readonly dispatched: number } {
  let dispatched = 0;
  const dispatch = () => {
    dispatched += 1;
  };
  const result = handler({ toolName });
  if (result?.block !== true) dispatch();
  return { dispatched };
}

Deno.test("registerOmpCapabilityCallback attaches exactly one tool_call handler", () => {
  const { api, events, handlers } = createRecordingApi();

  registerOmpCapabilityCallback(api);

  assertEquals(events, ["tool_call"]);
  assertEquals(handlers.length, 1);
  assert(typeof handlers[0] === "function");
});

Deno.test("mapped tool names continue to native dispatch", () => {
  const handler = createOmpCapabilityToolCallHandler();

  for (const toolName of MAPPED_TOOL_NAMES) {
    assertEquals(handler({ toolName }), undefined, toolName);
  }
});

Deno.test("unmatched tool names are blocked with the bounded reason", () => {
  const handler = createOmpCapabilityToolCallHandler();

  for (const toolName of UNMATCHED_TOOL_NAMES) {
    assertEquals(handler({ toolName }), BLOCKED, JSON.stringify(toolName));
  }
});

Deno.test("prototype-shaped names never match the capability map", () => {
  const handler = createOmpCapabilityToolCallHandler();

  for (const toolName of ["toString", "__proto__", "constructor"]) {
    assertEquals(handler({ toolName }), BLOCKED, toolName);
  }
});

Deno.test("a blocked call executes zero operations and a mapped call exactly one", () => {
  const handler = createOmpCapabilityToolCallHandler();
  let dispatched = 0;

  for (const toolName of UNMATCHED_TOOL_NAMES) {
    const outcome = invokeNativeToolCall(handler, toolName);
    assertEquals(outcome.dispatched, 0, toolName);
    dispatched += outcome.dispatched;
  }
  assertEquals(dispatched, 0);

  for (const toolName of MAPPED_TOOL_NAMES) {
    const outcome = invokeNativeToolCall(handler, toolName);
    assertEquals(outcome.dispatched, 1, toolName);
    dispatched += outcome.dispatched;
  }
  assertEquals(dispatched, MAPPED_TOOL_NAMES.length);
});

Deno.test("the registered callback decides exactly like the directly created handler", () => {
  const direct = createOmpCapabilityToolCallHandler();
  const { api, handlers } = createRecordingApi();
  registerOmpCapabilityCallback(api);
  const registered = handlers[0];

  for (const toolName of [...MAPPED_TOOL_NAMES, ...UNMATCHED_TOOL_NAMES]) {
    assertEquals(registered({ toolName }), direct({ toolName }), toolName);
  }
});

Deno.test("the registered callback blocks before dispatch", () => {
  const { api, handlers } = createRecordingApi();
  registerOmpCapabilityCallback(api);
  const registered = handlers[0];

  assertEquals(invokeNativeToolCall(registered, "bash").dispatched, 1);
  assertEquals(invokeNativeToolCall(registered, "__proto__").dispatched, 0);
});
