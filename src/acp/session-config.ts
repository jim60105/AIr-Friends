// src/acp/session-config.ts

import type * as acp from "@agentclientprotocol/sdk";

/** ACP config option category for model selection. */
export const MODEL_CATEGORY = "model";

/** ACP config option category that represents reasoning / thought level. */
export const THOUGHT_LEVEL_CATEGORY = "thought_level";

/**
 * Reasoning-effort tokens that have an agreed meaning (used for availability validation).
 * Exported so tests can pin consistency with `KNOWN_REASONING_EFFORTS` in the config loader.
 */
export const KNOWN_REASONING_EFFORT_TOKENS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Find a configuration option by its category from a cached option list.
 */
export function findOptionByCategory(
  options: acp.SessionConfigOption[] | null | undefined,
  category: string,
): acp.SessionConfigOption | undefined {
  if (!Array.isArray(options)) return undefined;
  return options.find((opt) => opt.category === category);
}

/**
 * Collect the available value strings for a config option, flattening both flat
 * options (`SessionConfigSelectOption`) and grouped option lists (`SessionConfigSelectGroup`).
 * Entries lacking a string `value` are skipped.
 */
export function collectOptionValues(
  option: acp.SessionConfigOption | null | undefined,
): string[] {
  const values: string[] = [];
  if (!option || typeof option !== "object" || !("options" in option)) {
    return values;
  }

  const rawOptions = option.options;
  if (!Array.isArray(rawOptions)) return values;

  for (const entry of rawOptions) {
    if (!entry || typeof entry !== "object") continue;

    if ("value" in entry && typeof entry.value === "string") {
      values.push(entry.value);
    } else if ("options" in entry && Array.isArray(entry.options)) {
      for (const nested of entry.options) {
        if (
          nested &&
          typeof nested === "object" &&
          "value" in nested &&
          typeof nested.value === "string"
        ) {
          values.push(nested.value);
        }
      }
    }
  }

  return values;
}

/**
 * Case-insensitive match returning the canonical advertised casing.
 * On case-only ties, the first advertised entry wins.
 */
export function resolveCanonicalValue(
  availableValues: readonly string[],
  requested: string,
): string | undefined {
  const target = requested.toLowerCase();
  for (const val of availableValues) {
    if (val.toLowerCase() === target) {
      return val;
    }
  }
  return undefined;
}

export type ModelSelectionResult =
  | {
    kind: "stable";
    configId: string;
    value: string;
  }
  | {
    kind: "unstable-fallback";
  }
  | {
    kind: "catalog-miss";
    advertisedValues: string[];
  };

/**
 * Resolve model selection against cached session config options.
 *
 * Rules:
 * - If NO option with category === "model" is present: return `{ kind: "unstable-fallback" }`.
 * - If a "model" option is present:
 *   - Flatten available values.
 *   - If the requested model matches an advertised value (case-insensitively):
 *     return `{ kind: "stable", configId: option.id, value: canonicalMatch }`.
 *   - Otherwise: return `{ kind: "catalog-miss", advertisedValues }`.
 *     (Note: an empty advertised list is also a catalog-miss, never an unstable-fallback).
 */
export function resolveModelSelection(
  cachedOptions: acp.SessionConfigOption[] | null | undefined,
  requestedModelId: string,
): ModelSelectionResult {
  const modelOption = findOptionByCategory(cachedOptions, MODEL_CATEGORY);
  if (!modelOption) {
    return { kind: "unstable-fallback" };
  }

  const advertisedValues = collectOptionValues(modelOption);
  const canonical = resolveCanonicalValue(advertisedValues, requestedModelId);
  if (canonical !== undefined) {
    return {
      kind: "stable",
      configId: modelOption.id,
      value: canonical,
    };
  }

  return {
    kind: "catalog-miss",
    advertisedValues,
  };
}

export type ReasoningValueResult =
  | {
    kind: "applied";
    value: string;
  }
  | {
    kind: "not-offered";
    availableValues: string[];
  };

/**
 * Resolve reasoning effort value against advertised values.
 *
 * Rules:
 * - Exact canonical case-insensitive match always wins.
 * - If requested is "none" (case-insensitive) and no exact "none" exists:
 *   - Check for advertised "off" (case-insensitive). If found, return advertised "off" with kind "applied".
 *   - If "off" is also absent:
 *     - If availableValues is non-empty, return `{ kind: "not-offered", availableValues }`.
 *     - If availableValues is empty, send trimmed requested value as-is.
 * - For other tokens:
 *   - If in KNOWN_REASONING_EFFORT_TOKENS and availableValues is non-empty:
 *     return `{ kind: "not-offered", availableValues }`.
 *   - Otherwise: passthrough trimmed token as-is.
 */
export function resolveReasoningValue(
  requested: string,
  advertisedValues: readonly string[],
): ReasoningValueResult {
  const trimmed = requested.trim();
  const canonicalMatch = resolveCanonicalValue(advertisedValues, trimmed);
  if (canonicalMatch !== undefined) {
    return { kind: "applied", value: canonicalMatch };
  }

  const lower = trimmed.toLowerCase();
  if (lower === "none") {
    const offMatch = resolveCanonicalValue(advertisedValues, "off");
    if (offMatch !== undefined) {
      return { kind: "applied", value: offMatch };
    }
    if (advertisedValues.length > 0) {
      return { kind: "not-offered", availableValues: [...advertisedValues] };
    }
    return { kind: "applied", value: trimmed };
  }

  const isKnownToken = KNOWN_REASONING_EFFORT_TOKENS.includes(lower);
  if (isKnownToken && advertisedValues.length > 0) {
    return { kind: "not-offered", availableValues: [...advertisedValues] };
  }

  return { kind: "applied", value: trimmed };
}

/**
 * Format a length-bounded string preview of advertised catalog values for error messages.
 */
export function formatAdvertisedValuesPreview(
  values: readonly string[],
  maxLength: number = 80,
  maxItems: number = 10,
): string {
  if (values.length === 0) return "[]";

  const previewItems: string[] = [];
  let currentLen = 2; // "[]"

  for (let i = 0; i < values.length; i++) {
    if (i >= maxItems) break;
    const itemStr = JSON.stringify(values[i]);
    const addedLen = previewItems.length === 0 ? itemStr.length : itemStr.length + 2;
    if (currentLen + addedLen > maxLength) break;
    previewItems.push(itemStr);
    currentLen += addedLen;
  }

  if (previewItems.length < values.length) {
    const remaining = values.length - previewItems.length;
    return `[${previewItems.join(", ")}, ... (${remaining} more)]`;
  }

  return `[${previewItems.join(", ")}]`;
}
