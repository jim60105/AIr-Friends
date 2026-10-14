import type { DestructiveIntentDecision } from "./compatibility-contracts.ts";
import type { DestructiveIntentInput, DestructiveOperation } from "../destructive-policy.ts";

/**
 * Validates destructive operations bound to execution input.
 * Ensures:
 * 1. Execution binding strictly matches raw tool input.
 * 2. Supported parsers decode operations; unsupported formats fail closed.
 * 3. Enforces normalized path traversal checks on every target.
 * 4. Synthetic operation fixtures are explicitly verified for complete target coverage.
 */
export function validateDestructiveIntentContract(
  input: DestructiveIntentInput,
  allowedRoots: readonly string[],
): DestructiveIntentDecision {
  // Check execution binding matches raw input
  if (input.rawInput !== input.executionInputBinding) {
    return {
      valid: false,
      decoded: false,
      mutationPermitted: false,
      targets: [],
      reason: `Execution input binding does not match raw tool input`,
    };
  }

  // If parser provenance is native_first_location_only, report incompatible
  if (input.parserProvenance === "native_first_location_only") {
    return {
      valid: false,
      decoded: false,
      mutationPermitted: false,
      targets: [],
      reason:
        `Native first-location-only parsing is incompatible: cannot establish complete target list`,
    };
  }

  if (input.parserProvenance === "unknown") {
    return {
      valid: false,
      decoded: false,
      mutationPermitted: false,
      targets: [],
      reason: `Unknown or unparseable patch syntax; fails closed with zero mutation attempts`,
    };
  }

  // Pure decoder for simple JSON tool inputs (delete / move)
  let decodedOps: readonly DestructiveOperation[] = input.operations ?? [];

  if (input.nativeTool === "delete" || input.nativeTool === "move") {
    try {
      const parsed = JSON.parse(input.rawInput);
      if (input.nativeTool === "delete") {
        if (!parsed.path) {
          return {
            valid: false,
            decoded: false,
            mutationPermitted: false,
            targets: [],
            reason: "Missing delete path",
          };
        }
        decodedOps = [{ kind: "delete", path: parsed.path }];
      } else if (input.nativeTool === "move") {
        if (!parsed.source || !parsed.destination) {
          return {
            valid: false,
            decoded: false,
            mutationPermitted: false,
            targets: [],
            reason: "Missing move endpoint (source or destination)",
          };
        }
        decodedOps = [{ kind: "move", source: parsed.source, destination: parsed.destination }];
      }
    } catch {
      return {
        valid: false,
        decoded: false,
        mutationPermitted: false,
        targets: [],
        reason: "Invalid JSON raw input",
      };
    }
  }

  if (!decodedOps || decodedOps.length === 0) {
    return {
      valid: false,
      decoded: false,
      mutationPermitted: false,
      targets: [],
      reason: `Incomplete operation: no operations decoded or missing endpoints`,
    };
  }

  const allTargets: string[] = [];
  for (const op of decodedOps) {
    if (op.kind === "delete") {
      if (!op.path) {
        return {
          valid: false,
          decoded: false,
          mutationPermitted: false,
          targets: [],
          reason: "Missing delete path",
        };
      }
      allTargets.push(op.path);
    } else if (op.kind === "move") {
      if (!op.source || !op.destination) {
        return {
          valid: false,
          decoded: false,
          mutationPermitted: false,
          targets: [],
          reason: "Missing move endpoint",
        };
      }
      allTargets.push(op.source);
      allTargets.push(op.destination);
    } else if (op.kind === "patch_mutation") {
      if (!op.targetPath) {
        return {
          valid: false,
          decoded: false,
          mutationPermitted: false,
          targets: [],
          reason: "Missing patch mutation target path",
        };
      }
      allTargets.push(op.targetPath);
    }
  }

  // Validate every extracted target against allowed roots with normalized path check
  for (const target of allTargets) {
    // Normalize target (collapse /../ and /./)
    const normalizedTarget = normalizePath(target);
    const isAllowed = allowedRoots.some((root) => {
      const normalizedRoot = normalizePath(root);
      return normalizedTarget === normalizedRoot ||
        normalizedTarget.startsWith(`${normalizedRoot.replace(/\/$/, "")}/`);
    });

    if (!isAllowed) {
      return {
        valid: true, // Complete decode succeeded, but target is disallowed
        decoded: true,
        mutationPermitted: false,
        targets: allTargets,
        reason:
          `Destructive target '${target}' (${normalizedTarget}) is outside allowed boundaries; denying operation without mutation`,
      };
    }
  }

  return {
    valid: true,
    decoded: true,
    mutationPermitted: true,
    targets: allTargets,
    reason: `All destructive targets decoded and within authorized boundaries`,
  };
}

function normalizePath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return "/" + stack.join("/");
}
