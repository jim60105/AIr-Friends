/**
 * Official native `ExtensionAPI` registration for the restricted capability
 * callback.
 *
 * Pinned native contract (OMP v18.6.1 /
 * 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60, `extensibility/extensions/types.ts`):
 * `api.on("tool_call", handler)` registers a SYNCHRONOUS pre-dispatch handler
 * that receives `event.toolName` and may return `{block: true, reason}` to stop
 * the call before it executes. Nothing else is needed: the factory's return
 * value registers nothing, and no registry surface (`getAllTools`,
 * `registerTool`), session acquisition, replacement tool or schema facade is
 * consumed.
 *
 * The restricted launch is the ONLY launch that loads this module, so the
 * callback is attached unconditionally; the native-YOLO mode's single LSP
 * denial is native exact-name YAML policy and never reaches this code.
 */

import { decideOmpToolCapability } from "../tool-inventory.ts";

/** The pinned `tool_call` event shape this extension consumes. */
export interface NativeToolCallEvent {
  readonly toolName: string;
}

/** The pinned `tool_call` result shape: `{block: true, reason}` blocks dispatch. */
export interface NativeToolCallEventResult {
  readonly block?: boolean;
  readonly reason?: string;
}

export type NativeToolCallHandler = (
  event: NativeToolCallEvent,
) => NativeToolCallEventResult | undefined;

/** The pinned `ExtensionAPI` structural subset this extension touches. */
export interface NativeExtensionApi {
  on(event: "tool_call", handler: NativeToolCallHandler): void;
}

/**
 * The capability callback: mapped names continue to native dispatch (no
 * repeated native or ACP authorization), every unmatched name is blocked before
 * execution with the bounded unknown-tool reason.
 */
export function createOmpCapabilityToolCallHandler(): NativeToolCallHandler {
  return (event) => {
    const decision = decideOmpToolCapability(event.toolName);
    if (decision.decision === "continue") return undefined;
    return { block: true, reason: decision.reason };
  };
}

/** Attach the capability callback through the official pre-dispatch API. */
export function registerOmpCapabilityCallback(api: NativeExtensionApi): void {
  api.on("tool_call", createOmpCapabilityToolCallHandler());
}
