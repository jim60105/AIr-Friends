/**
 * OMP Owned Settings Pure Composition, Schema Validation & Merge Evaluation Module.
 *
 * Pinned to official OMP v18.6.1 / commit 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
 *
 * Registration sites and value domains traced at pinned revision:
 *
 * 1. `tools.approvalMode`:
 *    - Pin & Symbol: `v18.6.1` / `packages/coding-agent/src/tools/settings.ts` (`cfgToolsApprovalMode`), `docs/approval-mode.md`
 *    - Type & Domain: string enum: `"always-ask" | "write" | "yolo"` (schema default: `"yolo"`)
 *    - Purpose: auto-approves read+workspace-write tiers only in `write` mode; exec-tier calls remain on the ACP permission gate.
 *
 * 2. `lsp.enabled`:
 *    - Pin & Symbol: `v18.6.1` / `docs/settings.md` §Shell/eval/LSP (`lsp.enabled`), default `true`
 *    - Type & Domain: boolean (`true | false`)
 *    - Purpose: pins LSP disabled in restricted overlay; row 15 owns the disable implementation & implicit startup proof.
 *
 * 3. `startup.checkUpdate`:
 *    - Pin & Symbol: `v18.6.1` / `packages/coding-agent/src/modes/settings.ts:1028` (`cfgStartupCheckUpdate`), `main.ts:233-244` (`checkForNewVersion()`)
 *    - Type & Domain: boolean (`true | false`), default `true`
 *    - Purpose: disables startup version check and notification probes.
 *
 * 4. `marketplace.autoUpdate`:
 *    - Pin & Symbol: `v18.6.1` / `packages/coding-agent/src/modes/settings.ts:1057` (`cfgMarketplaceAutoUpdate`)
 *    - Type & Domain: string enum: `"off" | "notify" | "auto"`
 *    - Purpose: disables marketplace/plugin auto-updates.
 *
 * 5. `update.channel`:
 *    - Pin & Symbol: `v18.6.1` / `packages/coding-agent/src/modes/settings.ts:1040` (`update.channel`)
 *    - Type & Domain: string enum: `"stable" | "canary"` (or string identifier)
 *    - Purpose: locks the update channel to stable so accidental/deliberate updates cannot pull canary builds.
 *
 * 6. `disabledProviders`:
 *    - Pin & Symbol: `v18.6.1` / `docs/settings.md`, `docs/providers.md`
 *    - Type & Domain: string[] (array replaces wholesale across layers)
 *    - Purpose: complete-replacement array eliminating provider backends outside approved set (keeps google, openrouter).
 *
 * 7. `compaction.enabled`:
 *    - Pin & Symbol: `v18.6.1` / `docs/settings.md` (`compaction.enabled`), default `true`
 *    - Type & Domain: boolean (`true | false`)
 *    - Purpose: maintains native automatic conversation compaction; native uses methodOrder/thresholds, no "prune" setting exists.
 *
 * 8. Custom-provider `headers`:
 *    - Pin & Symbol: `v18.6.1` / `docs/models.md` (custom provider schema: `providers.<name>.headers`)
 *    - Applied in `packages/ai/src/providers/openai-shared.ts:228` (`let headers = { ...model.headers }`)
 *    - Domain: Record<string, string>
 *    - Value: `headers: { "X-Title": "AIr-Friends" }` for `providers.openrouter`.
 *
 * 9. Custom-prompt route:
 *    - Pin & Symbol: `v18.6.1` / `docs/system-prompt-customization.md` (`--system-prompt <path>`, `<agent dir>/SYSTEM.md`)
 *    - Purpose: replaces default instruction block while retaining generated context/skills/footer.
 *
 * 10. OpenRouter header application:
 *    - Pin & Symbol: `v18.6.1` / `packages/ai/src/providers/openai-shared.ts:229-231` + `packages/ai/src/utils/openrouter-headers.ts`
 *    - Logic: `Object.assign(headers, getOpenRouterHeaders())` assigns `HTTP-Referer: https://omp.sh/` and `X-OpenRouter-Title: omp`
 *      AFTER model/config headers, so `HTTP-Referer` is non-overridable via content configuration.
 *
 * NO subprocess execution, NO filesystem writes, NO pool/LSP implementation.
 */

import {
  PINNED_OMP_COMMIT,
  PINNED_OMP_VERSION,
} from "./omp/compatibility-contracts.ts";

export type OmpPermissionMode = "restricted" | "native-yolo";

/**
 * Pinned registered settings keys and their allowed value specifications.
 */
export interface RegisteredKeySpec {
  readonly path: string;
  readonly type: "string" | "boolean" | "string[]";
  readonly allowedValues?: readonly string[];
  readonly description: string;
}

/**
 * Pinned registered configuration keys at v18.6.1 / 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
 */
export const PINNED_REGISTERED_SETTINGS_KEYS: Readonly<Record<string, RegisteredKeySpec>> = {
  "tools.approvalMode": {
    path: "tools.approvalMode",
    type: "string",
    allowedValues: ["always-ask", "write", "yolo"],
    description: "Approval mode for tool executions (packages/coding-agent/src/tools/settings.ts)",
  },
  "lsp.enabled": {
    path: "lsp.enabled",
    type: "boolean",
    description: "LSP server enablement toggle (docs/settings.md)",
  },
  "startup.checkUpdate": {
    path: "startup.checkUpdate",
    type: "boolean",
    description: "Startup version check probe toggle (modes/settings.ts:1028)",
  },
  "marketplace.autoUpdate": {
    path: "marketplace.autoUpdate",
    type: "string",
    allowedValues: ["off", "notify", "auto"],
    description: "Marketplace plugins auto-update posture (modes/settings.ts:1057)",
  },
  "update.channel": {
    path: "update.channel",
    type: "string",
    allowedValues: ["stable", "canary"],
    description: "Release update channel pin (modes/settings.ts:1040)",
  },
  "compaction.enabled": {
    path: "compaction.enabled",
    type: "boolean",
    description: "Conversation history compaction toggle (docs/settings.md)",
  },
  "disabledProviders": {
    path: "disabledProviders",
    type: "string[]",
    description: "Complete-replacement array of disabled model and discovery provider ids (docs/settings.md)",
  },
};

/**
 * Pinned catalog of provider IDs known to OMP v18.6.1 minus google & openrouter.
 */
export const PINNED_DISABLED_PROVIDERS_CATALOG: readonly string[] = ([
  "abliteration",
  "aimlapi",
  "amazon-bedrock",
  "aiand",
  "alibaba-coding-plan",
  "alibaba-token-plan",
  "anthropic",
  "apple",
  "azure",
  "cursor",
  "baseten",
  "bedrock-mantle",
  "cerebras",
  "charm-hyper",
  "cline-pass",
  "cloudflare-ai-gateway",
  "commandcode",
  "coreweave",
  "deepinfra",
  "deepseek",
  "devin",
  "factory-droid",
  "firepass",
  "fireworks",
  "github-copilot",
  "gitlab-duo",
  "gitlab-duo-agent",
  "gmi-cloud",
  "google-antigravity",
  "google-gemini-cli",
  "google-vertex",
  "groq",
  "helmcode",
  "huggingface",
  "kilo",
  "kimi-code",
  "llama.cpp",
  "litellm",
  "lm-studio",
  "local",
  "meta",
  "minimax",
  "minimax-code",
  "minimax-code-cn",
  "mistral",
  "moonshot",
  "muse-code",
  "nanogpt",
  "novita",
  "nvidia",
  "ollama",
  "ollama-cloud",
  "opencode-go",
  "opencode-zen",
  "openai",
  "openai-codex",
  "qianfan",
  "qwen-portal",
  "sakana",
  "siliconflow",
  "siliconflow-cn",
  "singularityapi-dev",
  "singularityapi-tech",
  "snowflake",
  "stepfun",
  "synthetic",
  "together",
  "typesafe",
  "umans",
  "venice",
  "vercel-ai-gateway",
  "vllm",
  "wafer-serverless",
  "web",
  "xai",
  "xai-oauth",
  "xiaomi",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-sgp",
  "yolo-auto",
  "zai",
  "zenmux",
  "zhipu-coding-plan",
] as const).slice().sort();

/**
 * Keys permitted strictly in restricted mode and PROHIBITED in native-yolo mode.
 */
export const RESTRICTED_ONLY_KEYS: readonly string[] = [
  "lsp.enabled",
  "disabledProviders",
] as const;

/**
 * Keys shared between both restricted and native-yolo deployment configurations.
 */
export const SHARED_DEPLOYMENT_KEYS: readonly string[] = [
  "startup.checkUpdate",
  "marketplace.autoUpdate",
  "update.channel",
  "compaction.enabled",
] as const;

export interface OverlayFileAsset {
  readonly path: string;
  readonly content: string;
}

export interface SystemPromptAssetMapping {
  /** The source override file path in AIr-Friends */
  readonly sourcePath: string;
  /** The discovered path under the deployment-owned agent directory */
  readonly agentDirFileName: string;
  /** The explicit launch flag target contract passed to OMP */
  readonly launchFlag: string;
  /** Verification caveat status */
  readonly runtimeApplicationRequiresVerification: boolean;
}

export interface EnvironmentPostureContracts {
  readonly agentDirEnvVar: "PI_CODING_AGENT_DIR";
  readonly agentDirRequirement: "Must reside under the selected process state root (empty deployment-owned directory)";
  readonly launchCwdRequirement: "Deployment-owned working directory preventing hostile project .omp/ discovery";
  readonly forbiddenInheritance: readonly string[];
  readonly overlayPathPlacementRequirement: "Owned overlay paths must reside outside agent-writable roots";
}

export interface RecordResetGateContract {
  readonly status: "unresolved";
  readonly strategy: "reset-then-mode-null";
  readonly reason: string;
  readonly residualEvidence: string;
  readonly operativeSecurityBoundary: string;
}

export interface OmpModeSettingsComposition {
  readonly mode: OmpPermissionMode;
  readonly overlayFiles: readonly OverlayFileAsset[];
  readonly orderedOverlayPaths: readonly string[];
  readonly modelsYamlContent: string;
  readonly systemPromptMapping: SystemPromptAssetMapping;
  readonly supportedProviderEnvKeys: readonly string[];
  readonly envPosture: EnvironmentPostureContracts;
  readonly recordResetGate: RecordResetGateContract;
}

/**
 * Pure, deterministic string content of agent-config/omp/restricted.yml
 */
export const RESTRICTED_YAML_CONTENT = `# Pinned deployment-owned OMP configuration overlay for restricted mode.
# Pinned to official OMP v18.6.1 / 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
tools:
  approvalMode: write
lsp:
  enabled: false
startup:
  checkUpdate: false
marketplace:
  autoUpdate: off
update:
  channel: stable
compaction:
  enabled: true
disabledProviders:
  - abliteration
  - aimlapi
  - aiand
  - alibaba-coding-plan
  - alibaba-token-plan
  - amazon-bedrock
  - anthropic
  - apple
  - azure
  - baseten
  - bedrock-mantle
  - cerebras
  - charm-hyper
  - cline-pass
  - cloudflare-ai-gateway
  - commandcode
  - coreweave
  - cursor
  - deepinfra
  - deepseek
  - devin
  - factory-droid
  - firepass
  - fireworks
  - github-copilot
  - gitlab-duo
  - gitlab-duo-agent
  - gmi-cloud
  - google-antigravity
  - google-gemini-cli
  - google-vertex
  - groq
  - helmcode
  - huggingface
  - kilo
  - kimi-code
  - llama.cpp
  - litellm
  - lm-studio
  - local
  - meta
  - minimax
  - minimax-code
  - minimax-code-cn
  - mistral
  - moonshot
  - muse-code
  - nanogpt
  - novita
  - nvidia
  - ollama
  - ollama-cloud
  - opencode-go
  - opencode-zen
  - openai
  - openai-codex
  - qianfan
  - qwen-portal
  - sakana
  - siliconflow
  - siliconflow-cn
  - singularityapi-dev
  - singularityapi-tech
  - snowflake
  - stepfun
  - synthetic
  - together
  - typesafe
  - umans
  - venice
  - vercel-ai-gateway
  - vllm
  - wafer-serverless
  - web
  - xai
  - xai-oauth
  - xiaomi
  - xiaomi-token-plan-ams
  - xiaomi-token-plan-cn
  - xiaomi-token-plan-sgp
  - yolo-auto
  - zai
  - zenmux
  - zhipu-coding-plan
`;

/**
 * Pure, deterministic string content of agent-config/omp/native-yolo.yml
 */
export const NATIVE_YOLO_YAML_CONTENT = `# Pinned deployment-owned OMP configuration overlay for native-yolo mode.
# Pinned to official OMP v18.6.1 / 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
tools:
  approvalMode: yolo
startup:
  checkUpdate: false
marketplace:
  autoUpdate: off
update:
  channel: stable
compaction:
  enabled: true
`;

/**
 * Pure, deterministic string content of agent-config/omp/models.yml
 */
export const MODELS_YAML_CONTENT = `# Pinned deployment-owned OMP custom provider model assets.
# Pinned to official OMP v18.6.1 / 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
# Schema per docs/models.md: custom provider level headers.
# Zero hardcoded model IDs; zero credential literals.
providers:
  openrouter:
    headers:
      X-Title: AIr-Friends
`;

/**
 * Validates a parsed owned settings document against the pinned v18.6.1 schema.
 * Validates both leaf values and intermediate mappings. Rejects:
 * - Keys not registered at v18.6.1
 * - Values outside registered enum/type
 * - Restricted-only keys present in native-yolo mode
 * - Mode mismatch in tools.approvalMode
 * - Per-tool tools.approval policy records (owned by row 14)
 * - Empty or unexpected object branches
 */
export function assertOwnedSettingsDocument(
  doc: Record<string, unknown>,
  mode: OmpPermissionMode,
): void {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Settings document must be an object");
  }

  // Walk and inspect every path (including intermediate and empty objects)
  const allPaths: Record<string, unknown> = {};

  function inspectTree(prefix: string, obj: Record<string, unknown>) {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;

      // Check against disallowed tools.approval* records
      if (fullPath === "tools.approval" || fullPath.startsWith("tools.approval.")) {
        throw new Error(
          `Disallowed key "${fullPath}": per-tool approval records and approval resets must not appear in owned settings overlays (owned by row 14)`,
        );
      }

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        // Intermediate mapping node: check if empty
        const childKeys = Object.keys(value as Record<string, unknown>);
        if (childKeys.length === 0) {
          throw new Error(
            `Forbidden empty object at path "${fullPath}": empty mapping branches are disallowed`,
          );
        }
        allPaths[fullPath] = value;
        inspectTree(fullPath, value as Record<string, unknown>);
      } else {
        allPaths[fullPath] = value;
      }
    }
  }

  inspectTree("", doc);

  const allowedTopLevels = new Set(
    Object.keys(PINNED_REGISTERED_SETTINGS_KEYS).map((k) => k.split(".")[0]),
  );

  // Validate every path
  for (const [path, value] of Object.entries(allPaths)) {
    // If it's a top-level object container (e.g. "tools", "lsp", "startup", "marketplace", "update", "compaction")
    if (!path.includes(".") && typeof value === "object" && value !== null && !Array.isArray(value)) {
      if (!allowedTopLevels.has(path)) {
        throw new Error(`Unregistered namespace "${path}" at pinned OMP ${PINNED_OMP_VERSION}`);
      }
      if (mode === "native-yolo" && path === "lsp") {
        // Continue to let child keys report their restricted error or reject if empty
      }
      continue;
    }

    const spec = PINNED_REGISTERED_SETTINGS_KEYS[path];
    if (!spec) {
      throw new Error(
        `Unregistered settings key "${path}" at pinned OMP ${PINNED_OMP_VERSION} (${PINNED_OMP_COMMIT}). ` +
          `Keys falling back to schema defaults are not permitted as protection.`,
      );
    }

    // Check mode restrictions
    if (mode === "native-yolo") {
      if (RESTRICTED_ONLY_KEYS.includes(path) || path.startsWith("lsp")) {
        throw new Error(
          `Restricted-only key "${path}" is forbidden in native-yolo settings document (mode non-contamination D6)`,
        );
      }
    }

    // Check type and allowed values
    if (spec.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(
          `Invalid type for key "${path}": expected boolean, got ${typeof value}`,
        );
      }
    } else if (spec.type === "string") {
      if (typeof value !== "string") {
        throw new Error(
          `Invalid type for key "${path}": expected string, got ${typeof value}`,
        );
      }
      if (spec.allowedValues && !spec.allowedValues.includes(value)) {
        throw new Error(
          `Invalid value "${value}" for key "${path}": must be one of [${spec.allowedValues.join(", ")}]`,
        );
      }
    } else if (spec.type === "string[]") {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        throw new Error(
          `Invalid type for key "${path}": expected string array`,
        );
      }
    }
  }

  // 3. Required mode-specific key assertions
  if (mode === "restricted") {
    if (allPaths["tools.approvalMode"] !== "write") {
      throw new Error(
        `Restricted mode requires explicit tools.approvalMode: "write", got "${allPaths["tools.approvalMode"]}"`,
      );
    }
    if (allPaths["lsp.enabled"] !== false) {
      throw new Error(
        `Restricted mode requires lsp.enabled: false`,
      );
    }
    const dp = allPaths["disabledProviders"];
    if (!Array.isArray(dp) || dp.length !== PINNED_DISABLED_PROVIDERS_CATALOG.length) {
      throw new Error(
        `Restricted mode requires complete disabledProviders array`,
      );
    }
  } else if (mode === "native-yolo") {
    if (allPaths["tools.approvalMode"] !== "yolo") {
      throw new Error(
        `Native-yolo mode requires explicit tools.approvalMode: "yolo", got "${allPaths["tools.approvalMode"]}"`,
      );
    }
    if ("disabledProviders" in allPaths) {
      throw new Error("disabledProviders is forbidden in native-yolo mode");
    }
    if ("lsp" in allPaths || "lsp.enabled" in allPaths) {
      throw new Error("lsp settings are forbidden in native-yolo mode");
    }
  }

  // 4. Shared deployment key presence
  for (const sharedKey of SHARED_DEPLOYMENT_KEYS) {
    if (!(sharedKey in allPaths)) {
      throw new Error(
        `Required shared deployment key "${sharedKey}" missing from ${mode} document`,
      );
    }
    if (sharedKey === "startup.checkUpdate" && allPaths[sharedKey] !== false) {
      throw new Error("startup.checkUpdate must be false");
    }
  }
}

/**
 * Validates the structure and content of `models.yml`.
 * Ensures:
 * - Only supported provider ids (openrouter) are declared
 * - Custom provider header schema (headers.X-Title) matches
 * - Zero model IDs and zero credentials/secrets are baked in
 */
export function assertOwnedModelsDocument(doc: Record<string, unknown>): void {
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid models document: root must be an object");
  }

  const providers = doc["providers"];
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    throw new Error("Invalid models document: missing 'providers' object");
  }

  const allowedProviders = ["openrouter"];
  for (const [providerId, providerConfig] of Object.entries(providers as Record<string, unknown>)) {
    if (!allowedProviders.includes(providerId)) {
      throw new Error(`Unexpected provider "${providerId}" in models.yml; only supported custom provider headers are permitted`);
    }

    if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
      throw new Error(`Provider config for "${providerId}" must be an object`);
    }

    const cfg = providerConfig as Record<string, unknown>;

    // Prohibit models, modelOverrides, apiKey, baseUrl, etc.
    if ("models" in cfg) {
      throw new Error(`Forbidden 'models' field in models.yml for provider "${providerId}": no model IDs may be hardcoded`);
    }
    if ("modelOverrides" in cfg) {
      throw new Error(`Forbidden 'modelOverrides' field in models.yml for provider "${providerId}"`);
    }
    if ("apiKey" in cfg) {
      throw new Error(`Forbidden 'apiKey' in models.yml: credentials must be passed via environment, not asset files`);
    }

    const headers = cfg["headers"];
    if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
      throw new Error(`Provider "${providerId}" must define a 'headers' object`);
    }

    const h = headers as Record<string, unknown>;

    // Check for command resolution or other headers first
    for (const [headerName, headerVal] of Object.entries(h)) {
      if (typeof headerVal === "string" && headerVal.startsWith("!")) {
        throw new Error(`Dynamic command execution in header "${headerName}" is prohibited`);
      }
    }

    if (h["X-Title"] !== "AIr-Friends") {
      throw new Error(`Provider "${providerId}" headers must contain X-Title: "AIr-Friends"`);
    }
  }
}

/**
 * Pure typed composition returning deployment-owned OMP configuration and asset metadata.
 * Does not read the filesystem or start any child processes.
 */
export function ompSettingsForMode(
  mode: OmpPermissionMode,
): OmpModeSettingsComposition {
  const modeAssetPath = mode === "restricted"
    ? "agent-config/omp/restricted.yml"
    : "agent-config/omp/native-yolo.yml";

  const modeContent = mode === "restricted"
    ? RESTRICTED_YAML_CONTENT
    : NATIVE_YOLO_YAML_CONTENT;

  // Assembly-time self validation of emitted documents
  if (mode === "restricted") {
    if (!modeContent.includes("approvalMode: write") || !modeContent.includes("lsp:\n  enabled: false")) {
      throw new Error("Assembly validation failed for restricted settings overlay");
    }
  } else {
    if (
      !modeContent.includes("approvalMode: yolo") ||
      modeContent.includes("lsp:") ||
      modeContent.includes("disabledProviders:")
    ) {
      throw new Error("Assembly validation failed: non-contamination violated in native-yolo overlay");
    }
  }

  // Ordered overlay paths: shared first (if any), mode document LAST among deployment overlays
  const orderedOverlayPaths = [
    modeAssetPath,
  ];

  const overlayFiles: OverlayFileAsset[] = [
    {
      path: modeAssetPath,
      content: modeContent,
    },
  ];

  const systemPromptMapping: SystemPromptAssetMapping = {
    sourcePath: "/app/prompts/system_prompt_override.md",
    agentDirFileName: "SYSTEM.md",
    launchFlag: "--system-prompt",
    runtimeApplicationRequiresVerification: true,
  };

  const supportedProviderEnvKeys = [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
  ];

  const envPosture: EnvironmentPostureContracts = {
    agentDirEnvVar: "PI_CODING_AGENT_DIR",
    agentDirRequirement:
      "Must reside under the selected process state root (empty deployment-owned directory)",
    launchCwdRequirement:
      "Deployment-owned working directory preventing hostile project .omp/ discovery",
    forbiddenInheritance: [
      "OMP_PROFILE",
      "PI_PROFILE",
      "PI_CONFIG_FILES",
      "XDG_CONFIG_HOME",
    ],
    overlayPathPlacementRequirement:
      "Owned overlay paths must reside outside agent-writable roots",
  };

  const recordResetGate: RecordResetGateContract = {
    status: "unresolved",
    strategy: "reset-then-mode-null",
    reason:
      "Official OMP Settings.#readConfigOverlays folds all CLI overlays into one mapping before #mergeOwnLayers deep-merges over global/project layers; #deepMerge preserves base-only keys and configured null behaves as unset, so lower-layer approval records survive into the process.",
    residualEvidence:
      "Tests reproduce lower-only unknown_tool: allow surviving in restricted mode and lower-only prompt/deny surviving in YOLO mode.",
    operativeSecurityBoundary:
      "Restricted execution-time default-deny (row 14) is the operative security boundary while record reset remains an unresolved gate.",
  };

  return {
    mode,
    overlayFiles,
    orderedOverlayPaths,
    modelsYamlContent: MODELS_YAML_CONTENT,
    systemPromptMapping,
    supportedProviderEnvKeys,
    envPosture,
    recordResetGate,
  };
}

/**
 * Faithful pinned implementation of OMP `#deepMerge` (packages/coding-agent/src/config/settings.ts:3684-3709).
 * Upstream algorithm:
 * 1. Iterate Object.keys(overrides): if object/object, recurse; else set result[key] = override.
 * 2. Iterate Object.keys(base): if !Object.hasOwn(result, key), set result[key] = base[key].
 * Higher-layer keys are emitted first, followed by base-only keys.
 * 1. CLI overlays are folded in `#readConfigOverlays`.
 * 2. Folded CLI overlay is merged over lower layers (global, then project) via `#deepMerge`.
 * 3. Base-only keys survive; null in an overlay counts as unset during settings resolution.
 */
export function deepMergeOmpSettings(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(overrides)) {
    const overrideVal = overrides[key];
    const baseVal = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : undefined;

    if (overrideVal === undefined) continue;

    if (
      typeof overrideVal === "object" &&
      overrideVal !== null &&
      !Array.isArray(overrideVal) &&
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMergeOmpSettings(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else {
      result[key] = overrideVal;
    }
  }

  for (const key of Object.keys(base)) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = base[key];
    }
  }

  return result;
}

/**
 * Faithful simulation of Settings.#readConfigOverlays (packages/coding-agent/src/config/settings.ts:2326-2335):
 * Sequentially folds CLI overlays using #deepMerge into one mapping without special casing.
 */
export function foldCliOverlays(
  overlays: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  let aggregated: Record<string, unknown> = {};
  for (const overlay of overlays) {
    aggregated = deepMergeOmpSettings(aggregated, overlay);
  }
  return aggregated;
}

/**
 * Faithful simulation of Settings.#mergeOwnLayers (packages/coding-agent/src/config/settings.ts:3666-3671)
 * and settings lookup resolution (configuredValue / rawValue: null resolves to unset / default).
 *
 * Returns { rawMerged, configuredLookups } where rawMerged is the literal merged data structure,
 * and configuredLookups reflects setting lookup where null is unset (undefined).
 */
export function resolveEffectiveSettings(
  lowerLayer: Record<string, unknown>,
  cliOverlays: ReadonlyArray<Record<string, unknown>>,
): {
  rawMerged: Record<string, unknown>;
  configuredLookups: Record<string, unknown>;
} {
  const folded = foldCliOverlays(cliOverlays);
  const rawMerged = deepMergeOmpSettings(lowerLayer, folded);

  // Upstream configuredValue(merged, setting): if value === undefined || value === null, returns undefined.
  // It does NOT restore lower-layer values that were explicitly overwritten by null in rawMerged.
  const configuredLookups: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(rawMerged)) {
    if (v === null) {
      configuredLookups[k] = undefined;
    } else if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      const sub: Record<string, unknown> = {};
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        sub[sk] = sv === null ? undefined : sv;
      }
      configuredLookups[k] = sub;
    } else {
      configuredLookups[k] = v;
    }
  }

  return { rawMerged, configuredLookups };
}
