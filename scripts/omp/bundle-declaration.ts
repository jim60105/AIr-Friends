// scripts/omp/bundle-declaration.ts — build-owned deployment-module declaration
// embedding (`bind-omp-owned-module-evidence` task 4.1), factored out of
// bundle-extension.ts so packaging tests exercise the exact production
// transformation on synthetic bundle text (deterministic, zero network).
//
// The generated bundle must carry a TRUSTED declaration of the exact
// development artifact it was cut from: its canonical source checkout's
// `build/omp-extension/index.js`. The declaration comes from the build input
// (the realpath of the source root the bundler was invoked with), NEVER from a
// process cwd, an output target, a model input or an arbitrary loaded-module
// parent. Embedding it is a deterministic text substitution of ONE literal the
// source carries; a bundle without exactly one occurrence fails the build, so
// a source change that drops the declaration cannot silently ship an artifact
// whose runtime identity is a placeholder.

import { OMP_CANONICAL_SOURCE_ROOT_PLACEHOLDER } from "../../src/acp/omp/deployment-module.ts";
import { NATIVE_BUILTIN_PREFIXES } from "./bundle-audit.ts";

/**
 * The exact QUOTED literal the emitted bundle must carry once: the source
 * declares the placeholder as a string value, and the quotes make the match
 * insensitive to comments or prose that merely mention the token.
 */
export const CANONICAL_SOURCE_ROOT_LITERAL = `"${OMP_CANONICAL_SOURCE_ROOT_PLACEHOLDER}"`;

/**
 * Substitute the canonical source checkout root into the emitted bundle text.
 * Fails (throws) when the bundle does not carry exactly one placeholder, or
 * when the supplied root is not an absolute canonical path — packaging fails
 * before an artifact with a placeholder or a relative root can be installed.
 */
export function embedDeploymentDeclarations(
  emitted: string,
  canonicalSourceRoot: string,
): string {
  const occurrences = emitted.split(CANONICAL_SOURCE_ROOT_LITERAL).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `generated bundle must carry EXACTLY ONE deployment-declaration placeholder ` +
        `(${CANONICAL_SOURCE_ROOT_LITERAL}); found ${occurrences}`,
    );
  }
  if (!canonicalSourceRoot.startsWith("/") || canonicalSourceRoot.endsWith("/")) {
    throw new Error(
      `canonical source root must be an absolute path without a trailing separator, ` +
        `got '${canonicalSourceRoot}'`,
    );
  }
  return emitted.replace(CANONICAL_SOURCE_ROOT_LITERAL, JSON.stringify(canonicalSourceRoot));
}

/**
 * The declared dependency closure must COVER the emitted edges: every external
 * edge the bundle actually carries has to be in the declaration's permitted
 * closure (or a documented native builtin, whose policy the emitted-edge audit
 * already governs). A closure that under-declares what ships is a packaging
 * failure, so the declaration can never drift from the artifact.
 */
export function declarationCoverageProblems(
  emittedEdges: readonly string[],
  declaredClosure: readonly string[],
): string[] {
  const declared: Record<string, true> = Object.fromEntries(
    declaredClosure.map((edge): [string, true] => [edge, true]),
  );
  const isNativeBuiltin = (edge: string): boolean =>
    NATIVE_BUILTIN_PREFIXES.some((prefix) => edge.startsWith(prefix));
  return [...new Set(emittedEdges)]
    .filter((edge) => declared[edge] !== true && !isNativeBuiltin(edge))
    .map((edge) => `emitted edge '${edge}' is not in the declared dependency closure`);
}
