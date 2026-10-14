/**
 * Test-only native OMP extension fixture (`document-omp-parity-and-consumer-regressions` 1.2).
 *
 * This is a native DEFAULT EXTENSION FACTORY (module itself is not a function, so
 * the pinned loader's `getExtensionFactory()` selects `module.default`). It is
 * loaded ONLY by test launches, as an additional `--trusted-extension
 * <absolute-file>` — documented as repeatable, absolute-path, discovery-bypassing
 * file loading (`docs/extension-loading.md`).
 *
 * It exists to give the restricted/YOLO native-dispatch evidence an
 * EXPOSURE/POSITIVE CONTROL for unmatched tools:
 *
 * - `parity_unknown_direct` — `loadMode: "essential"`, so the native roster keeps
 *   it top-level and the model can call it directly.
 * - `parity_unknown_mounted` — `loadMode: "discoverable"`, so the native `xd://`
 *   transport mounts it as a device the model reaches through
 *   `write { path: "xd://parity_unknown_mounted", content: "<JSON args>" }`.
 *
 * Both are registered with `defaultInactive: false` (active without an explicit
 * `--tools` listing) and `approval: "write"`, and both own a BENIGN EFFECTFUL
 * side effect: writing a distinct marker file under `ctx.cwd/tmp` through
 * `node:fs/promises`. That side effect is the observable that separates
 * "the tool was exposed and really dispatched" from "the tool was never
 * available, so a block proved nothing":
 *
 * - Restricted launch: the shipped capability extension blocks every unmatched
 *   name with `rejected_unknown_tool` before dispatch, so BOTH routes report the
 *   block and NEITHER marker may exist.
 * - Native-YOLO launch: no capability extension is loaded, so both routes
 *   execute and BOTH markers must exist.
 *
 * A fixture that silently failed to register (or registered inactive tools)
 * would make the restricted "blocked" result indistinguishable from an
 * unavailable-tool error, which is exactly the confusion the YOLO positive
 * control removes.
 *
 * The empty legacy TypeBox schema below describes ONLY these two test tools. It
 * is not an upstream schema mirror, not a production dependency, and nothing
 * asserts its bytes against a native tool.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The fixture's own contract, exported so the in-process contract test and the
 * native legs share one source of truth for the names, markers and load modes.
 */
export const PARITY_UNKNOWN_TOOLS = Object.freeze({
  direct: Object.freeze({
    name: "parity_unknown_direct",
    marker: "parity-unknown-direct.marker",
    loadMode: "essential",
  }),
  mounted: Object.freeze({
    name: "parity_unknown_mounted",
    marker: "parity-unknown-mounted.marker",
    loadMode: "discoverable",
  }),
  /** Marker directory, relative to the session working directory (`ctx.cwd`). */
  markerDirectory: "tmp",
});

/** The marker path one fixture tool writes for a given session working directory. */
export function parityMarkerPath(cwd, marker) {
  return join(cwd, PARITY_UNKNOWN_TOOLS.markerDirectory, marker);
}

/**
 * Empty legacy TypeBox object schema: no properties, no required names, closed
 * to additional properties. `Symbol.for("TypeBox.Kind")` is the cross-realm
 * brand the pinned native validator reads for legacy TypeBox schemas.
 */
function emptyObjectSchema() {
  return {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
    [Symbol.for("TypeBox.Kind")]: "Object",
  };
}

/** Register one marker-writing fixture tool on the native extension API. */
function registerMarkerTool(api, tool, label) {
  api.registerTool({
    name: tool.name,
    label,
    description: `Test-only fixture tool (${label}). Writes ${tool.marker} under the session ` +
      `working directory's ${PARITY_UNKNOWN_TOOLS.markerDirectory}/ directory and returns text.`,
    parameters: emptyObjectSchema(),
    loadMode: tool.loadMode,
    defaultInactive: false,
    approval: "write",
    /**
     * Pinned `ToolDefinition.execute` signature
     * (`extensibility/extensions/types.ts`):
     * `execute(toolCallId, params, signal, onUpdate, ctx)` where `ctx.cwd` is the
     * session working directory.
     */
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const directory = join(ctx.cwd, PARITY_UNKNOWN_TOOLS.markerDirectory);
      const markerPath = parityMarkerPath(ctx.cwd, tool.marker);
      await mkdir(directory, { recursive: true });
      await writeFile(
        markerPath,
        `${tool.name} executed (toolCallId=${toolCallId}, params=${JSON.stringify(params)})\n`,
        "utf8",
      );
      return { content: [{ type: "text", text: `${tool.name} wrote ${markerPath}` }] };
    },
  });
}

/** The native default extension factory. */
export default function unknownToolsFactory(api) {
  registerMarkerTool(api, PARITY_UNKNOWN_TOOLS.direct, "Parity unknown direct");
  registerMarkerTool(api, PARITY_UNKNOWN_TOOLS.mounted, "Parity unknown mounted");
}
