import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { parse as parseYaml } from "jsr:@std/yaml";
import {
  assertOwnedModelsDocument,
  assertOwnedSettingsDocument,
  deepMergeOmpSettings,
  foldCliOverlays,
  MODELS_YAML_CONTENT,
  NATIVE_YOLO_YAML_CONTENT,
  ompSettingsForMode,
  PINNED_DISABLED_PROVIDERS_CATALOG,
  PINNED_REGISTERED_SETTINGS_KEYS,
  resolveEffectiveSettings,
  RESTRICTED_ONLY_KEYS,
  RESTRICTED_YAML_CONTENT,
  SHARED_DEPLOYMENT_KEYS,
} from "../../src/acp/omp-settings.ts";
import {
  evaluateApprovalRecordAuthority,
  SettingsLayerHierarchy,
} from "../../src/acp/omp/record-evaluator.ts";

// Read fixtures
const fixturesPath = new URL("../fixtures/omp-settings/fixtures.json", import.meta.url).pathname;
const fixtures = JSON.parse(await Deno.readTextFile(fixturesPath));

// Read counterexample from P0
const p0CounterexamplePath = new URL(
  "../fixtures/omp-compatibility/approval-reset-counterexample.json",
  import.meta.url,
).pathname;
const p0Counterexample = JSON.parse(await Deno.readTextFile(p0CounterexamplePath));

Deno.test("Task 1.1 & 1.2: Composition module pureness, determinism, and no spawn/fs imports", async () => {
  // Pureness & determinism: two assemblies deep-equal
  const res1 = ompSettingsForMode("restricted");
  const res2 = ompSettingsForMode("restricted");
  assertEquals(res1, res2);

  const yolo1 = ompSettingsForMode("native-yolo");
  const yolo2 = ompSettingsForMode("native-yolo");
  assertEquals(yolo1, yolo2);

  // Grep source code for absence of Deno.Command, spawn, child_process, or Deno filesystem write calls
  const sourceText = await Deno.readTextFile(
    new URL("../../src/acp/omp-settings.ts", import.meta.url).pathname,
  );
  assertEquals(sourceText.includes("Deno.Command"), false);
  assertEquals(/\bspawn\b/.test(sourceText), false);
  assertEquals(sourceText.includes("Deno.writeTextFile"), false);
  assertEquals(sourceText.includes("Deno.writeFile"), false);
  assertEquals(sourceText.includes("Deno.readTextFile"), false);
});

Deno.test("Task 2.1: agent-config/omp/restricted.yml content matches pinned keys and catalog", async () => {
  const filePath = new URL("../../agent-config/omp/restricted.yml", import.meta.url).pathname;
  const fileContent = await Deno.readTextFile(filePath);

  // Match pure module constant
  assertEquals(fileContent, RESTRICTED_YAML_CONTENT);

  const parsed = parseYaml(fileContent) as Record<string, unknown>;

  // Validate with schema validator
  assertOwnedSettingsDocument(parsed, "restricted");

  // Assert exact keys
  assertEquals(parsed["tools"], { approvalMode: "write" });
  assertEquals(parsed["lsp"], { enabled: false });
  assertEquals(parsed["startup"], { checkUpdate: false });
  assertEquals(parsed["marketplace"], { autoUpdate: "off" });
  assertEquals(parsed["update"], { channel: "stable" });
  assertEquals(parsed["compaction"], { enabled: true });

  const disabledProviders = parsed["disabledProviders"] as string[];
  assertEquals(Array.isArray(disabledProviders), true);
  // Disabled providers must equal pinned catalog set
  assertEquals([...disabledProviders].sort(), [...PINNED_DISABLED_PROVIDERS_CATALOG].sort());
  // Must NOT contain google or openrouter
  assertEquals(disabledProviders.includes("google"), false);
  assertEquals(disabledProviders.includes("openrouter"), false);
});

Deno.test("Task 2.2: agent-config/omp/native-yolo.yml non-contamination", async () => {
  const filePath = new URL("../../agent-config/omp/native-yolo.yml", import.meta.url).pathname;
  const fileContent = await Deno.readTextFile(filePath);

  // Match pure module constant
  assertEquals(fileContent, NATIVE_YOLO_YAML_CONTENT);

  const parsed = parseYaml(fileContent) as Record<string, unknown>;

  // Validate with schema validator
  assertOwnedSettingsDocument(parsed, "native-yolo");

  // Contains tools.approvalMode: yolo
  assertEquals(parsed["tools"], { approvalMode: "yolo" });

  // NO lsp, NO disabledProviders, NO per-tool approval, NO reset
  assertEquals("lsp" in parsed, false);
  assertEquals("disabledProviders" in parsed, false);

  const toolsObj = parsed["tools"] as Record<string, unknown>;
  assertEquals("approval" in toolsObj, false);
});

Deno.test("Task 2.3: agent-config/omp/models.yml contains only X-Title header, zero model IDs, zero credentials", async () => {
  const filePath = new URL("../../agent-config/omp/models.yml", import.meta.url).pathname;
  const fileContent = await Deno.readTextFile(filePath);

  // Match pure module constant
  assertEquals(fileContent, MODELS_YAML_CONTENT);

  const parsed = parseYaml(fileContent) as Record<string, unknown>;

  // Validate with model document validator
  assertOwnedModelsDocument(parsed);

  // Assert exact structure
  assertEquals(parsed, {
    providers: {
      openrouter: {
        headers: {
          "X-Title": "AIr-Friends",
        },
      },
    },
  });

  // Zero slashes in model IDs or paths in YAML body (excluding comments)
  const unhintedBody = fileContent.split("\n").filter(l => !l.trim().startsWith("#")).join("\n");
  assertEquals(unhintedBody.includes("/"), false);
  assertEquals(fileContent.includes("sk-"), false);
  assertEquals(fileContent.includes("apiKey"), false);
});

Deno.test("Task 3.1: assertOwnedSettingsDocument rejects invalid schema keys and values", () => {
  // Invented key
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.inventedKey, "restricted"),
    Error,
    "Unregistered settings key",
  );

  // Empty mapping branch in native-yolo (lsp: {})
  assertThrows(
    () => assertOwnedSettingsDocument({
      tools: { approvalMode: "yolo" },
      compaction: { enabled: true },
      startup: { checkUpdate: false },
      marketplace: { autoUpdate: "off" },
      update: { channel: "stable" },
      lsp: {},
    }, "native-yolo"),
    Error,
    "Forbidden empty object",
  );

  // Case-mismatched enum
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.caseMismatchedEnum, "restricted"),
    Error,
    "Invalid value \"Write\" for key \"tools.approvalMode\"",
  );

  // Restricted key in YOLO (lsp.enabled)
  assertThrows(
    () => assertOwnedSettingsDocument({ tools: { approvalMode: "yolo" }, compaction: { enabled: true }, startup: { checkUpdate: false }, marketplace: { autoUpdate: "off" }, update: { channel: "stable" }, lsp: { enabled: false } }, "native-yolo"),
    Error,
    "Restricted-only key \"lsp.enabled\" is forbidden in native-yolo",
  );

  // Restricted key in YOLO (disabledProviders)
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.disabledProvidersInYolo, "native-yolo"),
    Error,
    "Restricted-only key \"disabledProviders\" is forbidden in native-yolo",
  );

  // Per-tool approval in restricted
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.perToolApprovalInRestricted, "restricted"),
    Error,
    "per-tool approval records and approval resets must not appear",
  );

  // Approval null reset
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.approvalNullReset, "restricted"),
    Error,
    "per-tool approval records and approval resets must not appear",
  );

  // Invalid models document tests
  assertThrows(
    () => assertOwnedModelsDocument(fixtures.invalidModels.containsModelId),
    Error,
    "Forbidden 'models' field",
  );
  assertThrows(
    () => assertOwnedModelsDocument(fixtures.invalidModels.containsApiKey),
    Error,
    "Forbidden 'apiKey'",
  );
  assertThrows(
    () => assertOwnedModelsDocument(fixtures.invalidModels.commandHeader),
    Error,
    "Dynamic command execution",
  );
});

Deno.test("Task 3.2: Faithful merge model reproduces P0 counterexample and keeps gate unresolved", () => {
  // Run with faithful merge model
  const lowerLayer = p0Counterexample.lowerLayer;
  const cliOverlays = p0Counterexample.cliOverlays;

  // Step 1: Fold CLI overlays
  const aggregatedCli = foldCliOverlays(cliOverlays);
  assertEquals(aggregatedCli["approval"], p0Counterexample.expectedAggregatedCliOverlay);

  // Step 2: Merge over lower layer and verify configured lookups
  const { rawMerged, configuredLookups } = resolveEffectiveSettings(lowerLayer, cliOverlays);

  // In raw merged: unknown_tool: "allow" survives from base because folded CLI overlay has only read: "allow"
  assertEquals(rawMerged["approval"], p0Counterexample.expectedEffectiveApproval);

  // Verify configured lookup behavior:
  // Lower-layer unknown_tool: "allow" survives in configuredLookups because overlay did not touch it
  const appLookups = configuredLookups["approval"] as Record<string, unknown>;
  assertEquals(appLookups["unknown_tool"], "allow");
  assertEquals(appLookups["read"], "allow");

  // Step 3: Verify with P0 record evaluator
  const p0Hierarchy: SettingsLayerHierarchy = {
    lowerLayer: p0Counterexample.lowerLayer,
    cliOverlays: p0Counterexample.cliOverlays,
  };

  const restrictedEval = evaluateApprovalRecordAuthority(
    p0Hierarchy,
    "restricted",
    { read: "allow" },
  );

  // Lower layer grant surviving! Authoritative must be FALSE
  assertEquals(restrictedEval.authoritative, false);
  assertEquals(restrictedEval.residualHostileGrants, ["unknown_tool"]);

  // YOLO evaluation with lower layer prompt/deny surviving
  const yoloHierarchy: SettingsLayerHierarchy = {
    lowerLayer: p0Counterexample.yoloLowerLayer,
    cliOverlays: p0Counterexample.yoloCliOverlays,
  };

  const yoloEval = evaluateApprovalRecordAuthority(
    yoloHierarchy,
    "yolo",
    { read: "allow" },
  );

  // Lower layer prompt/deny surviving! Authoritative must be FALSE
  assertEquals(yoloEval.authoritative, false);
  assertEquals([...yoloEval.residualPromptDeny].sort(), ["legacy_tool", "special_tool"].sort());

  // Composition contract exposes unresolved gate
  const composition = ompSettingsForMode("restricted");
  assertEquals(composition.recordResetGate.status, "unresolved");
  assertEquals(composition.recordResetGate.strategy, "reset-then-mode-null");
});

Deno.test("Task 4.1: Precedence, ordered overlay paths, absence of PI_CONFIG_FILES, and hostile layer contracts", () => {
  for (const mode of ["restricted", "native-yolo"] as const) {
    const comp = ompSettingsForMode(mode);

    // Overlay order puts mode document last
    const lastOverlay = comp.orderedOverlayPaths[comp.orderedOverlayPaths.length - 1];
    assertEquals(lastOverlay, `agent-config/omp/${mode === "restricted" ? "restricted" : "native-yolo"}.yml`);

    // PI_CONFIG_FILES must never be set/inherited
    assertEquals(comp.envPosture.forbiddenInheritance.includes("PI_CONFIG_FILES"), true);

    // Hostile layer neutralization contracts
    assertEquals(comp.envPosture.agentDirEnvVar, "PI_CODING_AGENT_DIR");
    assertEquals(
      comp.envPosture.agentDirRequirement.includes("empty deployment-owned directory"),
      true,
    );
    assertEquals(
      comp.envPosture.launchCwdRequirement.includes("preventing hostile project .omp/ discovery"),
      true,
    );
    assertEquals(
      comp.envPosture.overlayPathPlacementRequirement.includes("outside agent-writable roots"),
      true,
    );
  }
});

Deno.test("Task 4.2: Provider credentials, X-Title preservation, and HTTP-Referer non-overridability", () => {
  const comp = ompSettingsForMode("restricted");

  // Supported provider env keys reused from row 7 (GEMINI_API_KEY, OPENROUTER_API_KEY)
  assertEquals(comp.supportedProviderEnvKeys, ["GEMINI_API_KEY", "OPENROUTER_API_KEY"]);

  // X-Title: AIr-Friends in models.yml
  const models = parseYaml(comp.modelsYamlContent) as Record<string, unknown>;
  const openrouter = (models["providers"] as Record<string, unknown>)["openrouter"] as Record<string, unknown>;
  const headers = openrouter["headers"] as Record<string, unknown>;
  assertEquals(headers["X-Title"], "AIr-Friends");

  // Simulate pinned OpenRouter header application order in packages/ai/src/providers/openai-shared.ts:
  // 1. let headers = { ...model.headers }
  // 2. if (provider === "openrouter") Object.assign(headers, getOpenRouterHeaders())
  const modelHeaders = {
    ...fixtures.providerHeaderApplicationOrder.modelHeaders,
    "HTTP-Referer": "https://custom-referer.example.com", // even if custom referer was configured
  };

  const finalHeaders = { ...modelHeaders };
  Object.assign(finalHeaders, fixtures.providerHeaderApplicationOrder.openRouterBuiltInHeaders);

  // X-Title survives!
  assertEquals(finalHeaders["X-Title"], "AIr-Friends");

  // HTTP-Referer is overridden by pinned getOpenRouterHeaders()!
  assertEquals(finalHeaders["HTTP-Referer"], "https://omp.sh/");
  assertEquals(finalHeaders["X-OpenRouter-Title"], "omp");
});

Deno.test("Task 4.3: Mode non-contamination structural assertions", () => {
  const restrictedComp = ompSettingsForMode("restricted");
  const yoloComp = ompSettingsForMode("native-yolo");

  const restrictedDoc = parseYaml(restrictedComp.overlayFiles[0].content) as Record<string, unknown>;
  const yoloDoc = parseYaml(yoloComp.overlayFiles[0].content) as Record<string, unknown>;

  // YOLO document contains NO restricted keys
  for (const restrictedKey of RESTRICTED_ONLY_KEYS) {
    assertEquals(restrictedKey in yoloDoc, false);
  }

  // YOLO document contains NO tools.approval (per-tool policy)
  const yoloTools = yoloDoc["tools"] as Record<string, unknown>;
  assertEquals("approval" in yoloTools, false);

  // Restricted document contains ALL restricted keys
  assertEquals("lsp" in restrictedDoc, true);
  assertEquals("disabledProviders" in restrictedDoc, true);

  // Both documents share exactly the shared deployment keys plus approvalMode
  for (const sharedKey of SHARED_DEPLOYMENT_KEYS) {
    const parts = sharedKey.split(".");
    const topKey = parts[0];
    const subKey = parts[1];
    assertEquals(topKey in restrictedDoc, true);
    assertEquals(topKey in yoloDoc, true);
    assertEquals(
      (restrictedDoc[topKey] as Record<string, unknown>)[subKey],
      (yoloDoc[topKey] as Record<string, unknown>)[subKey],
    );
  }
});

Deno.test("Task 4.4: Compaction, update posture, and system prompt mapping", () => {
  const restrictedComp = ompSettingsForMode("restricted");
  const yoloComp = ompSettingsForMode("native-yolo");

  const rDoc = parseYaml(restrictedComp.overlayFiles[0].content) as Record<string, unknown>;
  const yDoc = parseYaml(yoloComp.overlayFiles[0].content) as Record<string, unknown>;

  // Compaction enabled in both
  assertEquals((rDoc["compaction"] as Record<string, unknown>)["enabled"], true);
  assertEquals((yDoc["compaction"] as Record<string, unknown>)["enabled"], true);

  // No invented prune or threshold keys in overlays
  assertEquals(Object.keys(rDoc["compaction"] as Record<string, unknown>), ["enabled"]);
  assertEquals(Object.keys(yDoc["compaction"] as Record<string, unknown>), ["enabled"]);

  // Update posture keys disabled / pinned
  assertEquals((rDoc["startup"] as Record<string, unknown>)["checkUpdate"], false);
  assertEquals((yDoc["startup"] as Record<string, unknown>)["checkUpdate"], false);
  assertEquals((rDoc["marketplace"] as Record<string, unknown>)["autoUpdate"], "off");
  assertEquals((yDoc["marketplace"] as Record<string, unknown>)["autoUpdate"], "off");
  assertEquals((rDoc["update"] as Record<string, unknown>)["channel"], "stable");
  assertEquals((yDoc["update"] as Record<string, unknown>)["channel"], "stable");

  // Prompt mapping
  assertEquals(
    restrictedComp.systemPromptMapping.sourcePath,
    "/app/prompts/system_prompt_override.md",
  );
  assertEquals(
    restrictedComp.systemPromptMapping.agentDirFileName,
    "SYSTEM.md",
  );
  assertEquals(
    restrictedComp.systemPromptMapping.launchFlag,
    "--system-prompt",
  );
  assertEquals(
    restrictedComp.systemPromptMapping.runtimeApplicationRequiresVerification,
    true,
  );
});
