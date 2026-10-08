import type { BoundaryId, CompatibilityBlocker, LedgerEntry } from "./compatibility-contracts.ts";

/**
 * Required inventory of boundaries and subcases.
 * Every one of these keys MUST be explicitly present in a valid ledger.
 */
export const REQUIRED_INVENTORY: ReadonlyArray<{
  readonly boundary: BoundaryId;
  readonly subcase?: string;
}> = [
  { boundary: "pre_import_discovery" },
  { boundary: "policy_readiness" },
  { boundary: "record_authority" },
  { boundary: "destructive_intent" },
  { boundary: "restricted_lsp", subcase: "omp" },
  { boundary: "restricted_lsp", subcase: "opencode" },
  { boundary: "native_transport", subcase: "text_fetch" },
  { boundary: "native_transport", subcase: "binary_fetch" },
  { boundary: "native_transport", subcase: "web_search" },
  { boundary: "native_transport", subcase: "public_code_search" },
  { boundary: "critical_skills" },
] as const;

export function validateRequiredInventory(
  entries: readonly LedgerEntry[],
  blockers: CompatibilityBlocker[],
): void {
  const presentKeys = new Set(
    entries.map((e) => (e.subcase ? `${e.boundary}:${e.subcase}` : e.boundary)),
  );

  for (const item of REQUIRED_INVENTORY) {
    const key = item.subcase ? `${item.boundary}:${item.subcase}` : item.boundary;
    if (!presentKeys.has(key)) {
      blockers.push({
        boundary: item.boundary,
        subcase: item.subcase,
        status: "unresolved",
        reason: `Missing required inventory item: '${key}'`,
        evidence: `Ledger does not contain required subcase '${key}'`,
      });
    }
  }
}
