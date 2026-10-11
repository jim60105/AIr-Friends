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
 *    - Purpose: decision 5 shared deployment pin — `lsp.enabled: false` in BOTH mode overlays
 *      (restricted since row 8; native-YOLO added by row 25 `pin-omp-yolo-lsp-settings`) beneath
 *      the row-17 both-mode `--no-lsp` carrier. Deployment posture only: native server
 *      suppression and implicit startup remain user-owned and UNVERIFIED.
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

import { PINNED_OMP_COMMIT, PINNED_OMP_VERSION } from "./omp/compatibility-contracts.ts";
import {
  OMP_IMAGE_SKILLS_ROOT,
  ompAgentDir,
  ompLaunchCwd,
  ompOwnedHome,
  ompProcessTmpDir,
  ompXdgDataHome,
} from "../utils/omp-paths.ts";
import { isAbsolute, resolve } from "@std/path";

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
  "skills.enabled": {
    path: "skills.enabled",
    type: "boolean",
    description: "Pinned extensibility/settings.ts global skill enablement",
  },
  "skills.customDirectories": {
    path: "skills.customDirectories",
    type: "string[]",
    description: "Pinned complete-replacement owned skill root array",
  },
  ...Object.fromEntries([
    "enableCodexUser",
    "enableClaudeUser",
    "enableClaudeProject",
    "enablePiUser",
    "enablePiProject",
    "enableAgentsUser",
    "enableAgentsProject",
  ].map((key) => [`skills.${key}`, {
    path: `skills.${key}`,
    type: "boolean" as const,
    description: "Pinned extensibility/settings.ts ambient source toggle",
  }])),
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
    description:
      "Complete-replacement array of disabled model and discovery provider ids (docs/settings.md)",
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
 * (`lsp.enabled` moved to SHARED_DEPLOYMENT_KEYS with decision 5 / row 25: the LSP
 * disable is now required in BOTH mode documents, not a restricted-only clamp.)
 */
export const RESTRICTED_ONLY_KEYS: readonly string[] = [
  "disabledProviders",
] as const;

/**
 * Keys shared between both restricted and native-yolo deployment configurations.
 * `lsp.enabled` joined this set with decision 5 (row 25): both documents must pin
 * boolean false. This is a deployment pin, never a restricted YOLO tool policy.
 */
export const SHARED_DEPLOYMENT_KEYS: readonly string[] = [
  ...Object.keys(PINNED_REGISTERED_SETTINGS_KEYS).filter((key) => key.startsWith("skills.")),
  "lsp.enabled",
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
  readonly agentDirRequirement:
    "Must reside under the selected process state root (empty deployment-owned directory)";
  readonly launchCwdRequirement:
    "Deployment-owned working directory preventing hostile project .omp/ discovery";
  readonly forbiddenInheritance: readonly string[];
  readonly overlayPathPlacementRequirement:
    "Owned overlay paths must reside outside agent-writable roots";
  /**
   * Row 26 (decision 3): the selectors whose inherited values are removed from
   * every OMP child MANDATORILY (regardless of filterEnv/allowedEnvVars); the
   * only permitted post-sanitization values are the exact deployment-owned
   * assignments of the settings-source plan (HOME, PI_CODING_AGENT_DIR,
   * XDG_DATA_HOME). OpenCode's HOME/XDG_DATA_HOME semantics are unaffected.
   */
  readonly mandatoryDiscoverySanitization: readonly string[];
  /**
   * Foreign provider config selectors that are never permitted in any form
   * (never allowlisted, never assigned): they cannot reintroduce a host source.
   */
  readonly foreignProviderSelectors: readonly string[];
  /**
   * HOME is EXPLICITLY assigned to the owned plan HOME: an unset HOME alone is
   * insufficient because the native homedir fallback can return the daemon home.
   */
  readonly homeAssignmentRequirement:
    "HOME explicitly assigned to the owned plan HOME; never inherited, never unset";
}

export interface RecordResetGateContract {
  readonly status: "unresolved";
  readonly strategy: "reset-then-mode-null";
  readonly reason: string;
  readonly residualEvidence: string;
  readonly operativeSecurityBoundary: string;
  /**
   * Decision 3 (DECIDED 2026-10-09): the application disposition that governs
   * whether this gate blocks session setup. The pinned native `unresolved` /
   * `incompatible` verdict above is UNCHANGED; the disposition selects
   * settings-discovery-path control instead of a native reset verdict.
   */
  readonly applicationDisposition: Decision3ApplicationDisposition;
}

/**
 * Decision 3 (docs/superpowers/specs/2026-10-06-omp-proposal-batch-index.md §3)
 * recorded as an application disposition SEPARATE from the pinned native reset
 * verdict. `isolate-omp-settings-discovery` (row 26) carries it: control moves
 * to settings discovery paths — only the owned `--config` overlays are visible
 * (HOME, XDG and project settings sources are filtered out, so no hostile lower
 * layer exists to inherit from) and restricted runtime default-deny remains the
 * second boundary. This is a deployment-owned disposition, NOT a supported-
 * mechanism claim: the pinned binary still does not provide the reset barrier.
 */
export interface Decision3ApplicationDisposition {
  readonly decision: 3;
  readonly status: "DECIDED (2026-10-09)";
  readonly control: "settings-discovery-path-control";
  readonly mechanism: string;
  readonly secondBoundary: string;
  readonly nativeVerdictUnchanged: "unresolved/incompatible (recorded verbatim)";
  readonly residualRisks: readonly string[];
}

/**
 * A single pinned forbidden settings-discovery source (bounded path table row).
 * `layer` records which settings layer the source feeds at the pinned revision.
 */
export interface PinnedSettingsSource {
  readonly id: string;
  readonly layer: "global" | "project" | "foreign-global" | "foreign-project";
  /** Path relative to the layer anchor (`{home}`, `{agentDir}`, `{cwd}`). */
  readonly relativePath: string;
  /** Exact pinned source symbols documenting the source (no new disable key). */
  readonly sourceSymbols: readonly string[];
}

/**
 * The bounded pinned settings-source inventory (D1). This is an enumerated path
 * table traced at OMP v18.6.1 / 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60, not a
 * general filesystem scan, and none of its rows is a newly fabricated disable key.
 */
export const PINNED_FORBIDDEN_SETTINGS_SOURCES: readonly PinnedSettingsSource[] = Object.freeze(
  [
    {
      id: "native-global-config-yml",
      layer: "global",
      relativePath: "config.yml",
      sourceSymbols: [
        "config/settings.ts (global agent-dir config.yml read)",
        "docs/settings.md (global settings discovery)",
      ],
    },
    {
      id: "native-compat-config-yaml",
      layer: "global",
      relativePath: "config.yaml",
      sourceSymbols: [
        "config/settings.ts (compatibility config.yaml read)",
        "docs/settings.md (compat naming)",
      ],
    },
    {
      id: "native-legacy-settings-json",
      layer: "global",
      relativePath: "settings.json",
      sourceSymbols: [
        "config/settings.ts (legacy settings.json read)",
        "docs/settings.md (legacy naming)",
      ],
    },
    {
      id: "native-project-config-yml",
      layer: "project",
      relativePath: ".omp/config.yml",
      sourceSymbols: [
        "config/settings.ts (project layer discovered from actual cwd)",
        "docs/settings.md (project .omp/config.yml)",
      ],
    },
    {
      id: "native-project-legacy-settings-json",
      layer: "project",
      relativePath: ".omp/settings.json",
      sourceSymbols: [
        "config/settings.ts (project legacy settings.json)",
        "docs/settings.md (legacy naming)",
      ],
    },
    // Foreign discovery providers with a `settingsCapability` provider at the
    // pinned commit (user level = {home}/{userBase}, project level =
    // {cwd}/{projectDir}). Their selectors (CLAUDE_CONFIG_DIR etc.) are never
    // passed to a child, so user-level discovery resolves under the owned HOME;
    // both levels stay on the table fail-safe. The observer additionally walks
    // bounded ancestors of the ACTUAL session cwd per design D3 (the pinned
    // providers resolve project paths at cwd only; the ancestor walk is the
    // deployment posture the design records, never a claim about native
    // traversal).
    {
      id: "foreign-claude-settings",
      layer: "foreign-global",
      relativePath: ".claude/settings.json",
      sourceSymbols: [
        "discovery/claude.ts (loadSettings user level; resolveClaudePaths honors CLAUDE_CONFIG_DIR)",
      ],
    },
    {
      id: "foreign-claude-project-settings",
      layer: "foreign-project",
      relativePath: ".claude/settings.json",
      sourceSymbols: ["discovery/claude.ts (loadSettings project level via getProjectClaude)"],
    },
    {
      id: "foreign-codex-config-toml",
      layer: "foreign-global",
      relativePath: ".codex/config.toml",
      sourceSymbols: ["discovery/codex.ts (loadSettings user level via getUserCodexDir)"],
    },
    {
      id: "foreign-codex-project-config-toml",
      layer: "foreign-project",
      relativePath: ".codex/config.toml",
      sourceSymbols: ["discovery/codex.ts (loadSettings project level via getProjectCodexDir)"],
    },
    {
      id: "foreign-cursor-settings",
      layer: "foreign-global",
      relativePath: ".cursor/settings.json",
      sourceSymbols: ["discovery/cursor.ts (loadSettings user level)"],
    },
    {
      id: "foreign-cursor-project-settings",
      layer: "foreign-project",
      relativePath: ".cursor/settings.json",
      sourceSymbols: ["discovery/cursor.ts (loadSettings project level)"],
    },
    {
      id: "foreign-gemini-settings",
      layer: "foreign-global",
      relativePath: ".gemini/settings.json",
      sourceSymbols: ["discovery/gemini.ts (loadSettings user level)"],
    },
    {
      id: "foreign-gemini-project-settings",
      layer: "foreign-project",
      relativePath: ".gemini/settings.json",
      sourceSymbols: ["discovery/gemini.ts (loadSettings project level)"],
    },
    {
      id: "foreign-opencode-user-json",
      layer: "foreign-global",
      relativePath: ".config/opencode/opencode.json",
      sourceSymbols: ["discovery/opencode.ts (getConfigSources user level)"],
    },
    {
      id: "foreign-opencode-user-jsonc",
      layer: "foreign-global",
      relativePath: ".config/opencode/opencode.jsonc",
      sourceSymbols: ["discovery/opencode.ts (getConfigSources user level)"],
    },
    {
      id: "foreign-opencode-project-root-json",
      layer: "foreign-project",
      relativePath: "opencode.json",
      sourceSymbols: ["discovery/opencode.ts (getConfigSources project-root level)"],
    },
    {
      id: "foreign-opencode-project-root-jsonc",
      layer: "foreign-project",
      relativePath: "opencode.jsonc",
      sourceSymbols: ["discovery/opencode.ts (getConfigSources project-root level)"],
    },
    {
      id: "foreign-opencode-project-dir-json",
      layer: "foreign-project",
      relativePath: ".opencode/opencode.json",
      sourceSymbols: ["discovery/opencode.ts (getConfigSources .opencode dir level)"],
    },
    {
      id: "foreign-opencode-project-dir-jsonc",
      layer: "foreign-project",
      relativePath: ".opencode/opencode.jsonc",
      sourceSymbols: ["discovery/opencode.ts (getConfigSources .opencode dir level)"],
    },
  ] as const,
);

/**
 * The exact environment selectors the pinned inventory records as settings-source
 * selectors. Every one of them is removed from an OMP child unconditionally
 * (mandatory sanitization) and may only reappear with its exact deployment-owned
 * value assigned by the source plan (HOME, PI_CODING_AGENT_DIR, XDG_DATA_HOME).
 * The list is OMP-only: OpenCode's existing HOME/XDG_DATA_HOME semantics never
 * consult it.
 */
export const OMP_SETTINGS_DISCOVERY_ENV_SELECTORS: readonly string[] = Object.freeze(
  [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "OMP_PROFILE",
    "PI_PROFILE",
    "PI_CONFIG_FILES",
    "PI_CODING_AGENT_DIR",
  ] as const,
);

/**
 * Foreign provider config selectors that must never enter an OMP child (they
 * cannot reintroduce a host source). Never allowlisted, never assigned.
 */
export const OMP_FOREIGN_PROVIDER_ENV_SELECTORS: readonly string[] = Object.freeze(
  [
    "CLAUDE_CONFIG_DIR",
    "CURSOR_CONFIG_DIR",
    "CODEX_HOME",
    "GEMINI_CONFIG_DIR",
  ] as const,
);

/**
 * Typed owned settings-source plan (row 26 D1): one deployment-owned plan
 * consumed by the OMP factory, the mandatory final child-environment
 * sanitization, and the pre-native-request settings observer.
 */
export interface OmpSettingsSourcePlan {
  /** Exact validated declaration, never a native name/provider authority. */
  readonly ownedSkillRoots: readonly string[];
  readonly mode: OmpPermissionMode;
  /** Mode-scoped process state namespace root (existing row-9/10 namespace). */
  readonly baseRoot: string;
  /** Deployment-owned HOME generated beneath the mode namespace. */
  readonly ownedHome: string;
  /** Exact PI_CODING_AGENT_DIR under the mode namespace. */
  readonly agentDir: string;
  /** Neutral deployment-owned process launch cwd. */
  readonly launchCwd: string;
  /** Owned mode-scoped XDG_DATA_HOME (retains OpenCode-semantics independence). */
  readonly xdgDataHome: string;
  /** Owned mode-scoped TMPDIR (distinct from payload staging). */
  readonly tmpDir: string;
  /** Exact owned `--config` overlay paths, mode document last. */
  readonly allowedOverlayPaths: readonly string[];
  /** Selector variables removed from any OMP child regardless of filtering. */
  readonly forbiddenSelectors: readonly string[];
  /** Bounded forbidden lower-layer source table. */
  readonly forbiddenSources: readonly PinnedSettingsSource[];
  /**
   * Distinctness invariant: owned HOME/agent roots must never coincide with
   * canonical payload staging.
   */
  readonly payloadStagingIndependent: true;
}

export interface OmpSourcePlanInput {
  /** Validated actual overlay declaration; omitted pure callers use image assets. */
  readonly ownedSkillRoots?: readonly string[];
  /** Absolute, deployment-owned base root for the mode namespace. */
  readonly baseRoot: string;
  /** Resolved owned `--config` overlay paths (mode document last). */
  readonly allowedOverlayPaths: readonly string[];
}

/**
 * Build the typed owned settings-source plan for a mode over the existing
 * mode-scoped state roots. Pure path composition (no filesystem I/O): owned
 * HOME/agent/cwd/xdg/tmp paths are derived with the canonical omp-paths
 * primitives and stay distinct from the `{workspace}/tmp/{sessionId}` payload
 * staging by construction (they live under `{baseRoot}/omp-agent/{mode}`).
 */
export function ompSettingsSourcePlan(
  mode: OmpPermissionMode,
  input: OmpSourcePlanInput,
): OmpSettingsSourcePlan {
  if (input.baseRoot.length === 0 || input.baseRoot.includes("\0")) {
    throw new Error("Settings source plan baseRoot is empty or malformed");
  }
  const baseRoot = resolve(input.baseRoot);
  if (!isAbsolute(baseRoot)) {
    throw new Error("Settings source plan baseRoot must resolve to an absolute path");
  }
  // Canonical row-9/10 mode-scoped primitives: the plan's roots are EXACTLY the
  // roots the factory already spawns with, so the observer and the launch can
  // never drift onto different formulas.
  const ownedHome = ompOwnedHome(baseRoot, mode);
  const agentDir = ompAgentDir(baseRoot, mode);
  const launchCwd = ompLaunchCwd(baseRoot, mode);
  const xdgDataHome = ompXdgDataHome(baseRoot, mode);
  const tmpDir = ompProcessTmpDir(baseRoot, mode);
  const overlays = [...input.allowedOverlayPaths];
  // D1: the plan declares exactly the single contracted deployment-owned
  // root — never a workspace, config, model, or CWD-relative selector.
  const skillRoots = input.ownedSkillRoots ?? [OMP_IMAGE_SKILLS_ROOT];
  if (skillRoots.length !== 1 || skillRoots[0] !== OMP_IMAGE_SKILLS_ROOT) {
    throw new Error("Settings source plan requires exactly the deployment-owned skill root");
  }
  if (overlays.length === 0) {
    throw new Error("Settings source plan requires at least one owned overlay");
  }
  for (const overlay of overlays) {
    if (overlay.length === 0 || overlay.includes("\0") || !isAbsolute(resolve(overlay))) {
      throw new Error(`Settings source plan owned overlay "${overlay}" is not absolute`);
    }
  }
  return Object.freeze({
    mode,
    baseRoot,
    ownedHome,
    agentDir,
    launchCwd,
    xdgDataHome,
    tmpDir,
    ownedSkillRoots: Object.freeze([...skillRoots]),
    allowedOverlayPaths: Object.freeze(overlays),
    forbiddenSelectors: OMP_SETTINGS_DISCOVERY_ENV_SELECTORS,
    forbiddenSources: PINNED_FORBIDDEN_SETTINGS_SOURCES,
    payloadStagingIndependent: true as const,
  });
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
  /**
   * Row 26: the deployment-owned settings-source plan for this composition,
   * present exactly when the caller supplied the plan input (the factory's
   * launch assembly). Pure callers keep the pre-row-26 shape with `null`.
   */
  readonly sourcePlan: OmpSettingsSourcePlan | null;
}

/**
 * Pure, deterministic string content of agent-config/omp/restricted.yml
 */
export const RESTRICTED_YAML_CONTENT =
  `# Pinned deployment-owned OMP configuration overlay for restricted mode.
# Pinned to official OMP v18.6.1 / 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
tools:
  approvalMode: write
lsp:
  enabled: false
skills:
  enabled: true
  customDirectories:
    - /opt/air/skills
  enableCodexUser: false
  enableClaudeUser: false
  enableClaudeProject: false
  enablePiUser: false
  enablePiProject: false
  enableAgentsUser: false
  enableAgentsProject: false
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
export const NATIVE_YOLO_YAML_CONTENT =
  `# Pinned deployment-owned OMP configuration overlay for native-yolo mode.
# Pinned to official OMP v18.6.1 / 2a2c6dcbbb558c0f8145f67f28b3370984f2bf60.
tools:
  approvalMode: yolo
lsp:
  enabled: false
skills:
  enabled: true
  customDirectories:
    - /opt/air/skills
  enableCodexUser: false
  enableClaudeUser: false
  enableClaudeProject: false
  enablePiUser: false
  enablePiProject: false
  enableAgentsUser: false
  enableAgentsProject: false
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
 * - Missing/disabled-off LSP posture: BOTH modes require the decision-5 shared
 *   deployment pin `lsp.enabled: false` (boolean only; a true value, a
 *   non-boolean value, an omission or an unregistered `lsp.*` key all reject)
 */
export function assertOwnedSettingsDocument(
  doc: Record<string, unknown>,
  mode: OmpPermissionMode,
  expectedSkillRoots: readonly string[] = [OMP_IMAGE_SKILLS_ROOT],
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
    if (
      !path.includes(".") && typeof value === "object" && value !== null && !Array.isArray(value)
    ) {
      if (!allowedTopLevels.has(path)) {
        throw new Error(`Unregistered namespace "${path}" at pinned OMP ${PINNED_OMP_VERSION}`);
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
      // `lsp.enabled` is no longer restricted-only (decision 5 / row 25): the
      // shared pin is required in YOLO too. An unregistered `lsp.*` key reaches
      // the generic Unregistered-settings-key rejection above instead.
      if (RESTRICTED_ONLY_KEYS.includes(path)) {
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
          `Invalid value "${value}" for key "${path}": must be one of [${
            spec.allowedValues.join(", ")
          }]`,
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
        `Restricted mode requires explicit tools.approvalMode: "write", got "${
          allPaths["tools.approvalMode"]
        }"`,
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
        `Native-yolo mode requires explicit tools.approvalMode: "yolo", got "${
          allPaths["tools.approvalMode"]
        }"`,
      );
    }
    if ("disabledProviders" in allPaths) {
      throw new Error("disabledProviders is forbidden in native-yolo mode");
    }
  }

  // 4. Shared deployment key presence
  const skillRoots = allPaths["skills.customDirectories"];
  if (
    !Array.isArray(skillRoots) || expectedSkillRoots.length !== 1 ||
    skillRoots.length !== expectedSkillRoots.length ||
    skillRoots.some((root, index) =>
      typeof root !== "string" || !isAbsolute(root) || root.includes("\0") ||
      root !== expectedSkillRoots[index]
    )
  ) {
    throw new Error("skills.customDirectories must exactly declare the deployment-owned roots");
  }
  for (const key of Object.keys(PINNED_REGISTERED_SETTINGS_KEYS)) {
    if (key === "skills.enabled" && allPaths[key] !== true) {
      throw new Error("skills.enabled must remain true");
    }
    if (key.startsWith("skills.enable") && key !== "skills.enabled" && allPaths[key] !== false) {
      throw new Error(`${key} must be false`);
    }
  }
  for (const sharedKey of SHARED_DEPLOYMENT_KEYS) {
    if (!(sharedKey in allPaths)) {
      throw new Error(
        `Required shared deployment key "${sharedKey}" missing from ${mode} document`,
      );
    }
    if (sharedKey === "startup.checkUpdate" && allPaths[sharedKey] !== false) {
      throw new Error("startup.checkUpdate must be false");
    }
    if (sharedKey === "lsp.enabled" && allPaths[sharedKey] !== false) {
      throw new Error(
        `Decision 5 requires the shared deployment pin lsp.enabled: false in ${mode} mode, got ${
          String(allPaths[sharedKey])
        }`,
      );
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
      throw new Error(
        `Unexpected provider "${providerId}" in models.yml; only supported custom provider headers are permitted`,
      );
    }

    if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
      throw new Error(`Provider config for "${providerId}" must be an object`);
    }

    const cfg = providerConfig as Record<string, unknown>;

    // Prohibit models, modelOverrides, apiKey, baseUrl, etc.
    if ("models" in cfg) {
      throw new Error(
        `Forbidden 'models' field in models.yml for provider "${providerId}": no model IDs may be hardcoded`,
      );
    }
    if ("modelOverrides" in cfg) {
      throw new Error(
        `Forbidden 'modelOverrides' field in models.yml for provider "${providerId}"`,
      );
    }
    if ("apiKey" in cfg) {
      throw new Error(
        `Forbidden 'apiKey' in models.yml: credentials must be passed via environment, not asset files`,
      );
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
 *
 * Row 26 adds the optional `plan` input: when the launch assembly supplies the
 * deployment-owned base root and the RESOLVED owned overlay paths, the
 * composition carries the typed settings-source plan (`sourcePlan`) consumed by
 * the mandatory environment sanitization and the pre-native-request observer.
 * Pure content callers (docs/tests) may omit it and keep the pre-row-26 shape.
 */
export function ompSettingsForMode(
  mode: OmpPermissionMode,
  plan?: OmpSourcePlanInput,
): OmpModeSettingsComposition {
  const modeAssetPath = mode === "restricted"
    ? "agent-config/omp/restricted.yml"
    : "agent-config/omp/native-yolo.yml";

  const modeContent = mode === "restricted" ? RESTRICTED_YAML_CONTENT : NATIVE_YOLO_YAML_CONTENT;

  // Assembly-time self validation of emitted documents
  if (mode === "restricted") {
    if (
      !modeContent.includes("approvalMode: write") ||
      !modeContent.includes("lsp:\n  enabled: false")
    ) {
      throw new Error("Assembly validation failed for restricted settings overlay");
    }
  } else {
    if (
      !modeContent.includes("approvalMode: yolo") ||
      !modeContent.includes("lsp:\n  enabled: false") ||
      modeContent.includes("disabledProviders:")
    ) {
      throw new Error(
        "Assembly validation failed: native-yolo overlay lost the decision-5 LSP pin or gained a restricted-only key",
      );
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
    overlayPathPlacementRequirement: "Owned overlay paths must reside outside agent-writable roots",
    mandatoryDiscoverySanitization: OMP_SETTINGS_DISCOVERY_ENV_SELECTORS,
    foreignProviderSelectors: OMP_FOREIGN_PROVIDER_ENV_SELECTORS,
    homeAssignmentRequirement:
      "HOME explicitly assigned to the owned plan HOME; never inherited, never unset",
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
    applicationDisposition: {
      decision: 3,
      status: "DECIDED (2026-10-09)",
      control: "settings-discovery-path-control",
      mechanism:
        "Only the owned --config overlays are visible: inherited HOME/XDG/profile/config selectors are mandatorily sanitized, the child receives a deployment-owned HOME and exact PI_CODING_AGENT_DIR, and lower global/project/legacy/foreign settings sources are verified absent (or rejected fail-closed) before every native session request, so no hostile lower layer exists to inherit from.",
      secondBoundary:
        "Restricted execution-time runtime default-deny (row 14) remains the second boundary; YOLO receives no restricted tool policy.",
      nativeVerdictUnchanged: "unresolved/incompatible (recorded verbatim)",
      residualRisks: [
        "The pinned binary still provides no deep-merge reset barrier; this disposition controls WHICH layers exist, not how merge behaves.",
        "Native autonomous settings reload and undetectable mid-process host mutation remain user-owned runtime evidence and deployment-control responsibility; the preflight is a snapshot decision, not a race-free watcher.",
        "A populated reused agent directory is rejected, never migrated or merged; the deployment owner must remove hostile settings before launch.",
      ],
    },
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
    sourcePlan: plan === undefined ? null : ompSettingsSourcePlan(mode, {
      baseRoot: plan.baseRoot,
      ownedSkillRoots: plan.ownedSkillRoots,
      allowedOverlayPaths: plan.allowedOverlayPaths.length > 0
        ? plan.allowedOverlayPaths
        : orderedOverlayPaths,
    }),
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
