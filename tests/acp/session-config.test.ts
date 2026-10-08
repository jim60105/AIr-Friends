// tests/acp/session-config.test.ts

import { assertEquals } from "@std/assert";
import type * as acp from "@agentclientprotocol/sdk";
import {
  collectOptionValues,
  findOptionByCategory,
  formatAdvertisedValuesPreview,
  resolveCanonicalValue,
  resolveModelSelection,
  resolveReasoningValue,
} from "@acp/session-config.ts";

Deno.test("findOptionByCategory - returns option matching category or undefined", () => {
  const options: acp.SessionConfigOption[] = [
    {
      id: "model_cfg",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "gpt-4o",
      options: [],
    },
  ];
  assertEquals(findOptionByCategory(options, "model")?.id, "model_cfg");
  assertEquals(findOptionByCategory(options, "thought_level"), undefined);
  assertEquals(findOptionByCategory(null, "model"), undefined);
});

Deno.test("collectOptionValues - flat and grouped catalogs flatten identically", () => {
  const flatOption: acp.SessionConfigOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gpt-4o",
    options: [
      { value: "gpt-4o", name: "GPT-4o" },
      { value: "claude-sonnet", name: "Claude Sonnet" },
    ],
  };

  const groupedOption: acp.SessionConfigOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "gpt-4o",
    options: [
      {
        group: "openai",
        name: "OpenAI",
        options: [{ value: "gpt-4o", name: "GPT-4o" }],
      },
      {
        group: "anthropic",
        name: "Anthropic",
        options: [{ value: "claude-sonnet", name: "Claude Sonnet" }],
      },
    ],
  };

  const expected = ["gpt-4o", "claude-sonnet"];
  assertEquals(collectOptionValues(flatOption), expected);
  assertEquals(collectOptionValues(groupedOption), expected);
});

Deno.test("collectOptionValues - skips entries lacking string value", () => {
  const mixedOption: acp.SessionConfigOption = {
    id: "opt_flat",
    name: "Opt Flat",
    category: "model",
    type: "select",
    currentValue: "",
    options: [
      { name: "No value" } as unknown as acp.SessionConfigSelectOption,
      { value: 123 as unknown as string, name: "Num value" },
      { value: "valid-1", name: "Valid 1" },
    ],
  };

  const mixedGroupOption: acp.SessionConfigOption = {
    id: "opt",
    name: "Opt",
    category: "model",
    type: "select",
    currentValue: "",
    options: [
      {
        group: "grp",
        name: "Group",
        options: [
          { name: "No value in group" } as unknown as acp.SessionConfigSelectOption,
          { value: "valid-2", name: "Valid 2" },
        ],
      },
    ],
  };

  assertEquals(collectOptionValues(mixedOption), ["valid-1"]);
  assertEquals(collectOptionValues(mixedGroupOption), ["valid-2"]);
});

Deno.test("resolveCanonicalValue - case-insensitive match returns advertised casing", () => {
  const values = ["gpt-4o", "Claude-3-5-Sonnet", "gemini-1.5-pro"];
  assertEquals(resolveCanonicalValue(values, "GPT-4O"), "gpt-4o");
  assertEquals(resolveCanonicalValue(values, "claude-3-5-sonnet"), "Claude-3-5-Sonnet");
  assertEquals(resolveCanonicalValue(values, "GEMINI-1.5-PRO"), "gemini-1.5-pro");
  assertEquals(resolveCanonicalValue(values, "unknown-model"), undefined);
});

Deno.test("resolveCanonicalValue - case-only ties pick the first advertised entry", () => {
  const values = ["Model-A", "model-a", "MODEL-A"];
  assertEquals(resolveCanonicalValue(values, "MODEL-A"), "Model-A");
  assertEquals(resolveCanonicalValue(values, "model-a"), "Model-A");
});

Deno.test("resolveModelSelection - no model option returns unstable-fallback even when other categories exist", () => {
  const options: acp.SessionConfigOption[] = [
    {
      id: "thought_level",
      name: "Thought Level",
      category: "thought_level",
      type: "select",
      currentValue: "high",
      options: [{ value: "high", name: "High" }],
    },
  ];

  assertEquals(resolveModelSelection(options, "any-model"), {
    kind: "unstable-fallback",
  });
  assertEquals(resolveModelSelection(null, "any-model"), {
    kind: "unstable-fallback",
  });
  assertEquals(resolveModelSelection([], "any-model"), {
    kind: "unstable-fallback",
  });
});

Deno.test("resolveModelSelection - model option with empty value list is catalog-miss for any request", () => {
  const options: acp.SessionConfigOption[] = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "",
      options: [],
    },
  ];

  assertEquals(resolveModelSelection(options, "gpt-4o"), {
    kind: "catalog-miss",
    advertisedValues: [],
  });
});

Deno.test("resolveModelSelection - model found returns stable with canonical value and configId", () => {
  const options: acp.SessionConfigOption[] = [
    {
      id: "cfg_model_select",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "gpt-4o",
      options: [
        { value: "provider/Model-X", name: "Model X" },
      ],
    },
  ];

  assertEquals(resolveModelSelection(options, "provider/model-x"), {
    kind: "stable",
    configId: "cfg_model_select",
    value: "provider/Model-X",
  });
});

Deno.test("resolveModelSelection - model absent returns catalog-miss with all advertised values", () => {
  const options: acp.SessionConfigOption[] = [
    {
      id: "cfg_model_select",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "gpt-4o",
      options: [
        { value: "m1", name: "M1" },
        { value: "m2", name: "M2" },
      ],
    },
  ];

  assertEquals(resolveModelSelection(options, "m3"), {
    kind: "catalog-miss",
    advertisedValues: ["m1", "m2"],
  });
});

Deno.test("resolveReasoningValue - exact hit, none->off alias, none with neither, exact none beating off", () => {
  // Exact hit
  assertEquals(resolveReasoningValue("high", ["low", "High"]), {
    kind: "applied",
    value: "High",
  });

  // none -> off alias when no exact none exists
  assertEquals(resolveReasoningValue("none", ["low", "Off"]), {
    kind: "applied",
    value: "Off",
  });

  // none with neither none nor off
  assertEquals(resolveReasoningValue("none", ["low", "medium"]), {
    kind: "not-offered",
    availableValues: ["low", "medium"],
  });

  // exact none beating advertised off
  assertEquals(resolveReasoningValue("none", ["Off", "None"]), {
    kind: "applied",
    value: "None",
  });
});

Deno.test("resolveReasoningValue - off-requested never reverse-aliased", () => {
  assertEquals(resolveReasoningValue("off", ["none", "low"]), {
    kind: "applied",
    value: "off",
  });
});

Deno.test("resolveReasoningValue - low-requested never aliased and reported not-offered if absent", () => {
  assertEquals(resolveReasoningValue("low", ["off", "high"]), {
    kind: "not-offered",
    availableValues: ["off", "high"],
  });
});

Deno.test("resolveReasoningValue - passthrough token sent as-is, nullish/empty option lists", () => {
  // Passthrough token (unknown token) with available values
  assertEquals(resolveReasoningValue("ultra", ["low", "high"]), {
    kind: "applied",
    value: "ultra",
  });

  // Empty list -> passthrough even for known tokens
  assertEquals(resolveReasoningValue("none", []), {
    kind: "applied",
    value: "none",
  });
  assertEquals(resolveReasoningValue("high", []), {
    kind: "applied",
    value: "high",
  });
});

Deno.test("formatAdvertisedValuesPreview - length and count bounds", () => {
  assertEquals(formatAdvertisedValuesPreview([]), "[]");
  assertEquals(formatAdvertisedValuesPreview(["a", "b"]), '["a", "b"]');

  // Many items
  const many = Array.from({ length: 20 }, (_, i) => `model-${i}`);
  const preview = formatAdvertisedValuesPreview(many, 80, 5);
  assertEquals(preview.includes("more"), true);
  assertEquals(preview.startsWith("["), true);
});
