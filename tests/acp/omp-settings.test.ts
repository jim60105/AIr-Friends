import { assertEquals, assertThrows } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { createAgentConfig } from "../../src/acp/agent-factory.ts";
import type { Config } from "../../src/types/config.ts";
import {
  assertOwnedModelsDocument,
  assertOwnedSettingsDocument,
  foldCliOverlays,
  MODELS_YAML_CONTENT,
  NATIVE_YOLO_YAML_CONTENT,
  ompSettingsForMode,
  PINNED_DISABLED_PROVIDERS_CATALOG,
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
  assertEquals(parsed["tools"], {
    approvalMode: "write",
    approval: { read: "allow", grep: "allow", glob: "allow", find: "allow" },
  });
  // Owned native local search posture (row 29): the supported activation pins
  // and the restricted-only defense-in-depth fetch disable. `find.enabled:
  // auto` is pinned verbatim so the judge/model-dependent availability stays
  // unchanged.
  assertEquals(parsed["grep"], { enabled: true });
  assertEquals(parsed["glob"], { enabled: true });
  assertEquals(parsed["find"], { enabled: "auto" });
  assertEquals(parsed["fetch"], { enabled: false });
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

  // Decision 5 (row 25): the shared deployment pin lands in YOLO too.
  assertEquals(parsed["lsp"], { enabled: false });
  // NO disabledProviders, NO per-tool approval, NO reset
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
  const unhintedBody = fileContent.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
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
    () =>
      assertOwnedSettingsDocument({
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
    'Invalid value "Write" for key "tools.approvalMode"',
  );

  // Restricted key in YOLO (disabledProviders)
  assertThrows(
    () =>
      assertOwnedSettingsDocument(fixtures.invalidOverlays.disabledProvidersInYolo, "native-yolo"),
    Error,
    'Restricted-only key "disabledProviders" is forbidden in native-yolo',
  );

  // An UNLISTED per-tool approval entry cannot enter an owned overlay: the
  // pinned entry-name set is closed, so no OMP-only execution surface (`bash`
  // here, or `eval`/`task`/`lsp`/…) can be allow-listed through this branch.
  assertThrows(
    () =>
      assertOwnedSettingsDocument(
        fixtures.invalidOverlays.unlistedApprovalEntryInRestricted,
        "restricted",
      ),
    Error,
    'Unsupported "tools.approval" entry "bash"',
  );

  // An unlisted approval VALUE rejects (the pinned vocabulary is closed).
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.unlistedApprovalValue, "restricted"),
    Error,
    'Invalid value "maybe" for key "tools.approval.read"',
  );

  // The approval branch and the native fetch-materialization pin are
  // restricted-only: neither can ride into the native-YOLO document.
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.approvalInYolo, "native-yolo"),
    Error,
    'Restricted-only key "tools.approval" is forbidden in native-yolo',
  );
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.fetchInYolo, "native-yolo"),
    Error,
    'Restricted-only key "fetch.enabled" is forbidden in native-yolo',
  );

  // An approval NULL reset is not an owned record.
  assertThrows(
    () => assertOwnedSettingsDocument(fixtures.invalidOverlays.approvalNullReset, "restricted"),
    Error,
    'Invalid type for key "tools.approval"',
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

Deno.test("Task 29-3.1: the owned read/search posture is validated exactly, not merely typed", () => {
  const restricted = parseYaml(RESTRICTED_YAML_CONTENT) as Record<string, unknown>;
  // The composed owned document passes as-is.
  assertOwnedSettingsDocument(restricted, "restricted");
  const withTools = (tools: unknown) => ({ ...restricted, tools });
  // The pinned entry set is EXACT: a missing entry rejects.
  assertThrows(
    () =>
      assertOwnedSettingsDocument(
        withTools({ approvalMode: "write", approval: { read: "allow" } }),
        "restricted",
      ),
    Error,
    "EXACTLY the pinned tools.approval entries",
  );
  // A relaxed value for a pinned entry rejects.
  assertThrows(
    () =>
      assertOwnedSettingsDocument(
        withTools({
          approvalMode: "write",
          approval: { read: "prompt", grep: "allow", glob: "allow", find: "allow" },
        }),
        "restricted",
      ),
    Error,
    'Restricted mode requires explicit tools.approval.read: "allow"',
  );
  // An activation pin cannot be relaxed alongside its approval entry.
  assertThrows(
    () => assertOwnedSettingsDocument({ ...restricted, grep: { enabled: false } }, "restricted"),
    Error,
    "Restricted mode requires explicit grep.enabled: true",
  );
  assertThrows(
    () => assertOwnedSettingsDocument({ ...restricted, find: { enabled: "off" } }, "restricted"),
    Error,
    'Restricted mode requires explicit find.enabled: "auto"',
  );
  // The defense-in-depth native fetch disable is required in restricted mode.
  const withoutFetch = { ...restricted } as Record<string, unknown>;
  delete withoutFetch["fetch"];
  assertThrows(
    () => assertOwnedSettingsDocument(withoutFetch, "restricted"),
    Error,
    "Restricted mode requires explicit fetch.enabled: false",
  );
  // `auto` is pinned VERBATIM: the native `find` availability stays
  // judge/model-dependent, with no judge/model/backend configured here.
  assertEquals((restricted["find"] as Record<string, unknown>)["enabled"], "auto");
});

Deno.test("Task 29-3.2: the owned approval record cannot nullify lower-layer survivors (residual owned by the discovery-path control)", () => {
  // The owned read/search entries win for their exact keys...
  const { configuredLookups } = resolveEffectiveSettings(
    { approval: { unknown_tool: "allow", read: "deny" } },
    [{ approval: { read: "allow", grep: "allow", glob: "allow", find: "allow" } }],
  );
  const approval = configuredLookups["approval"] as Record<string, unknown>;
  assertEquals(approval["read"], "allow");
  assertEquals(approval["grep"], "allow");
  assertEquals(approval["glob"], "allow");
  assertEquals(approval["find"], "allow");
  // ...but a lower-layer entry for ANOTHER name SURVIVES: an approval record
  // is a posture, never a merge reset. That residual is contained by the
  // settings-discovery-path control (DISCOVERY, not the record) plus the
  // execution-time default-deny decision that denies any name the restricted
  // inventory does not carry.
  assertEquals(approval["unknown_tool"], "allow");
  assertEquals(
    ompSettingsForMode("restricted").recordResetGate.applicationDisposition.control,
    "settings-discovery-path-control",
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
    assertEquals(
      lastOverlay,
      `agent-config/omp/${mode === "restricted" ? "restricted" : "native-yolo"}.yml`,
    );

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
  const openrouter = (models["providers"] as Record<string, unknown>)["openrouter"] as Record<
    string,
    unknown
  >;
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

  const restrictedDoc = parseYaml(restrictedComp.overlayFiles[0].content) as Record<
    string,
    unknown
  >;
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

  // Decision 5 (row 25): `lsp.enabled` is no longer restricted-only — BOTH
  // documents carry the identical shared deployment pin, and YOLO still
  // carries zero restricted content (the loops above keep disabledProviders
  // and per-tool approval out).
  assertEquals((restrictedDoc["lsp"] as Record<string, unknown>)["enabled"], false);
  assertEquals((yoloDoc["lsp"] as Record<string, unknown>)["enabled"], false);
  assertEquals("disabledProviders" in yoloDoc, false);

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

// -----------------------------------------------------------------------------
// Row 25 (`pin-omp-yolo-lsp-settings`, decision 5): the LSP disable moved from
// the restricted-only key set into the shared deployment key set. BOTH mode
// documents must pin boolean `lsp.enabled: false`; missing/true/non-boolean/
// unknown-`lsp.*` documents reject in EVERY mode. Parsed real assets are
// compared against the emitted composition, and the validator is exercised on
// the actual rejection paths. Carrier wiring only: nothing here certifies
// native language-server suppression or implicit-startup behavior (user-owned,
// UNVERIFIED — decision-register §1a decision 5).
// -----------------------------------------------------------------------------

Deno.test("Task 25-2.1: decision-5 LSP pin — parsed assets match emitted composition and validate in both modes", async () => {
  for (
    const [mode, assetPath, constant] of [
      ["restricted", "../../agent-config/omp/restricted.yml", RESTRICTED_YAML_CONTENT],
      ["native-yolo", "../../agent-config/omp/native-yolo.yml", NATIVE_YOLO_YAML_CONTENT],
    ] as const
  ) {
    const fileContent = await Deno.readTextFile(new URL(assetPath, import.meta.url).pathname);

    // Real asset bytes equal the pure composition constant (assembly-time pin).
    assertEquals(fileContent, constant, `${mode}: asset drifted from composition constant`);

    // Parsed real asset equals the emitted composition document.
    const parsedAsset = parseYaml(fileContent) as Record<string, unknown>;
    const emitted = parseYaml(ompSettingsForMode(mode).overlayFiles[0].content) as Record<
      string,
      unknown
    >;
    assertEquals(parsedAsset, emitted, `${mode}: parsed asset drifted from emitted composition`);

    // Both validate, and both carry the shared pin.
    assertOwnedSettingsDocument(parsedAsset, mode);
    assertEquals((parsedAsset["lsp"] as Record<string, unknown>)["enabled"], false);
  }
});

Deno.test("Task 25-2.1: decision-5 LSP pin — missing/true/string/unknown/empty LSP rejects in BOTH modes", () => {
  for (const mode of ["restricted", "native-yolo"] as const) {
    // One fresh parse of the mode's shipped document; each case below fully
    // replaces the `lsp` branch before asserting, so sequential mutation is
    // order-independent per case.
    const baseline = structuredClone(
      parseYaml(
        mode === "restricted" ? RESTRICTED_YAML_CONTENT : NATIVE_YOLO_YAML_CONTENT,
      ) as Record<string, unknown>,
    );

    // Baseline (with the pin) validates.
    assertOwnedSettingsDocument(baseline, mode);

    // Missing: the shared-key loop rejects.
    delete baseline["lsp"];
    assertThrows(
      () => assertOwnedSettingsDocument(baseline, mode),
      Error,
      `Required shared deployment key "lsp.enabled" missing from ${mode} document`,
    );

    // Enabled (true): the decision-5 false pin rejects.
    baseline["lsp"] = { enabled: true };
    assertThrows(
      () => assertOwnedSettingsDocument(baseline, mode),
      Error,
      "Decision 5 requires the shared deployment pin lsp.enabled: false",
    );

    // Non-boolean string value: registered boolean-type check rejects.
    baseline["lsp"] = { enabled: "false" };
    assertThrows(
      () => assertOwnedSettingsDocument(baseline, mode),
      Error,
      'Invalid type for key "lsp.enabled": expected boolean, got string',
    );

    // Unknown lsp.* key: unregistered-key rejection (decision 5 permits ONLY
    // the registered lsp.enabled pin, never an arbitrary LSP setting).
    baseline["lsp"] = { enabled: false, server: "pyright" };
    assertThrows(
      () => assertOwnedSettingsDocument(baseline, mode),
      Error,
      'Unregistered settings key "lsp.server"',
    );

    // Empty lsp mapping branch stays forbidden.
    baseline["lsp"] = {};
    assertThrows(
      () => assertOwnedSettingsDocument(baseline, mode),
      Error,
      'Forbidden empty object at path "lsp"',
    );
  }
});

Deno.test("Task 25-2.2: row-17 carrier interface consumed verbatim — native YOLO keeps approval posture with no restricted policy", () => {
  // This test CONSUMES the row-17 launch result (factory flags) and the landed
  // OpenCode permission maps without editing them: it asserts the carrier
  // interface stays intact alongside the row-25 settings pin. It makes NO
  // native-implicit-suppression claim — that remains user-owned UNVERIFIED.
  const config = {
    discord: { token: "", channelIds: [] },
    agent: {
      defaultAgentType: "omp",
      model: "openrouter/auto",
      systemPromptPath: "./test.md",
      tokenLimit: 20000,
      geminiApiKey: "gm_test_key",
      openRouterApiKey: "or_test_key",
    },
    workspace: { repoPath: "./test-repo" },
  } as unknown as Config;

  for (const yolo of [false, true]) {
    const assembled = createAgentConfig("omp", "/tmp/ws", config, yolo);
    assertEquals(
      assembled.args.filter((arg) => arg === "--no-lsp").length,
      1,
      `row-17 carrier: --no-lsp exactly once (yolo=${yolo})`,
    );
  }

  const yoloAssembled = createAgentConfig("omp", "/tmp/ws", config, true);
  assertEquals(yoloAssembled.args.includes("agent-config/omp/native-yolo.yml"), true);
  assertEquals(yoloAssembled.args.some((arg) => arg.includes("restricted")), false);

  // Native YOLO approval posture plus the row-25 pin, with ZERO restricted
  // per-tool approval, approval-record reset or provider-disable content.
  const yoloDoc = parseYaml(NATIVE_YOLO_YAML_CONTENT) as Record<string, unknown>;
  assertEquals(yoloDoc["tools"], { approvalMode: "yolo" });
  assertEquals((yoloDoc["lsp"] as Record<string, unknown>)["enabled"], false);
  assertEquals("disabledProviders" in yoloDoc, false);
  assertEquals("approval" in (yoloDoc["tools"] as Record<string, unknown>), false);

  // Restricted-only provider clamp stays absent from the YOLO composition.
  const yoloComp = ompSettingsForMode("native-yolo");
  for (const file of yoloComp.overlayFiles) {
    assertEquals(file.content.includes("disabledProviders"), false);
    assertEquals(file.content.includes("approval:"), false);
  }

  // OpenCode carrier interface (owned by row 17; consumed, never edited):
  // the shipped map denies lsp per agent for build and yolo, no global clamp.
  const openCode = JSON.parse(
    Deno.readTextFileSync(new URL("../../agent-config/opencode.json", import.meta.url).pathname),
  ) as { agent?: Record<string, { permission?: Record<string, unknown> }> };
  assertEquals(openCode.agent?.["build"]?.permission?.["lsp"], "deny");
  assertEquals(openCode.agent?.["yolo"]?.permission?.["lsp"], "deny");
  assertEquals("lsp" in openCode, false, "no global clamp — row-17 ownership preserved");
});
