/**
 * Trusted Extension Module Entrypoint (pre-dispatch capability admission).
 *
 * Pinned development-tree location: src/acp/omp/extension/index.ts
 * Contracted by OMP_TRUSTED_EXTENSION_PATH in src/utils/omp-paths.ts.
 *
 * The pinned native loader evaluates the default export with its own
 * `ExtensionAPI` and discards the return value, so the capability handler is
 * attached SYNCHRONOUSLY through `api.on("tool_call", ...)` during this
 * evaluation and lives nowhere else. TWO launches load this ONE generated
 * module — every ordinary restricted launch (the restricted capability
 * callback, unchanged) and the INTERNAL email-intent profile
 * (`email-omp-intent-profile`, the deny-all callback) — and the launch decides
 * which one `../native-registration.ts` attaches. Native-YOLO expresses its
 * single LSP denial in its own native YAML and loads no extension.
 *
 * There is no module-load bootstrap, discovery guard, cwd/mode inference,
 * registry observation, replacement tool registration or readiness handshake.
 */

import { registerOmpCapabilityCallback } from "./native-registration.ts";

export default registerOmpCapabilityCallback;
