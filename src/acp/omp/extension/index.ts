/**
 * Trusted Extension Module Entrypoint.
 *
 * Pinned development-tree location: src/acp/omp/extension/index.ts
 * Contracted by OMP_TRUSTED_EXTENSION_PATH in src/utils/omp-paths.ts.
 *
 * Implements the official OMP trusted extension factory.
 * Executes the pre-import discovery bootstrap sequence at module load time.
 * Throws a fatal initialization error if pre-import exclusion blockers exist.
 *
 * C4 (`wire-omp-native-extension-api`) replaced the row-16 factory-return/
 * private-slot convention: the pinned loader AWAITS the default export and
 * DISCARDS its return value, so enforcement lives ONLY in the native API
 * registrations the factory makes synchronously during its own evaluation —
 * `api.on("tool_call", ...)` before execution and `api.registerTool(...)`
 * for the C2 `read`/`web_search` name replacements. The registration branch
 * is still gated on the module's OWN observed launch identity (row 9's
 * mode-distinct launch cwd `{baseRoot}/omp-agent/{mode}/cwd`): a
 * native-YOLO or otherwise unidentified process registers nothing at all,
 * so the exemption stays structural at the registration site and no mode
 * check exists inside the decision path.
 * Because the pinned pre-import-exclusion verdicts are unresolved (row 12),
 * this entrypoint fail-closes BEFORE the registrations: the factory exists
 * only when the gate passes. The accepted absence-of-handler residual risk
 * is unchanged (design §15) — whether the official binary ever evaluates
 * this factory or invokes the registered callback remains user-owned
 * runtime verification, never something this module claims, and no
 * readiness handshake exists or is asserted here.
 */

import { bootstrapDiscoveryGuard } from "./bootstrap.ts";
import { formatDiscoverySessionError } from "../discovery-guard.ts";
import { createNativeExtensionFactory, nativeReplacementTools } from "./native-registration.ts";
import { OMP_TRUSTED_EXTENSION_PATH } from "../../../utils/omp-paths.ts";

// Execute load-time pre-import discovery bootstrap sequence immediately upon import
export const loadTimeDiscoveryDecision = bootstrapDiscoveryGuard();

// If any blocker is present at module load, fail initialization closed
if (loadTimeDiscoveryDecision.blockers.length > 0) {
  throw new Error(formatDiscoverySessionError(loadTimeDiscoveryDecision));
}

function safeCwd(): string {
  try {
    if (typeof Deno !== "undefined" && Deno.cwd) return Deno.cwd();
    if (typeof process !== "undefined" && process.cwd) return process.cwd();
  } catch {
    // Permission restricted: the launch identity simply stays unobserved.
  }
  return "";
}

/**
 * Default extension factory complying with the pinned native extension
 * contract: the loader evaluates it with the native `ExtensionAPI` and the
 * registrations happen SYNCHRONOUSLY inside this call — no returned object
 * carries a handler or a registrar anymore, because the loader discards
 * the return value entirely. The native-YOLO branch registers nothing
 * (structural exemption). The return value is a plain status record for
 * API-shaped consumers/tests, never an attachment point.
 * The factory object itself is the shared `createNativeExtensionFactory`
 * product, so API-shaped fixtures exercise the SAME function the pinned
 * loader would evaluate (fixtures name their injected identity honestly).
 */
export default createNativeExtensionFactory(() => ({
  observedCwd: safeCwd(),
  resourceGeneration: () => loadTimeDiscoveryDecision.resourceGeneration,
  // The pinned host offers NO trusted session-context acquisition into
  // the extension child today: production wires no session context, so
  // destructive-shaped calls fail closed on absent canonical
  // observations — never on model-supplied ones.
  moduleUrl: import.meta.url,
  contractedRelative: OMP_TRUSTED_EXTENSION_PATH,
  replacementTools: nativeReplacementTools(),
}));
