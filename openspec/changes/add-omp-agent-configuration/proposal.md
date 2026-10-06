## Why

The approved OMP integration makes `omp` a second officially configured ACP agent type while OpenCode remains the default, but the current configuration surface recognizes only `"opencode"` (`AgentType = "opencode"`, `defaultAgentType?: "opencode"`, loader does not validate the value, and every example/env surface says opencode-only). Operators cannot select OMP at deployment level, an invalid type silently survives as a string until a late `createAgentConfig()` throw, and the sandbox credential allowlist has no OMP entry, so a future OMP launch would receive an undefined credential set. Design §12 also mandates that agent-type defaulting and unknown-type rejection stay consistent across loader/env/examples and that all three configuration documents synchronize in the implementing change.

## What Changes

- Widen the deployment-level agent type to `"opencode" | "omp"` across the config type, `ENV_MAPPINGS` consumption (`AGENT_DEFAULT_TYPE` already maps to `agent.defaultAgentType`; its documented value domain gains `omp`), `getDefaultAgentType()` (omitted => `"opencode"`, unchanged), and every parser/validator surface so one shared supported-set predicate decides acceptance everywhere.
- Validate `agent.defaultAgentType` during `loadConfig()`: omitted remains `"opencode"`; `opencode` and `omp` are accepted; any other value (including wrong casing/whitespace after trimming, non-string, or an empty-string env-expansion artifact) fails the load with a `ConfigError` (`ErrorCode.CONFIG_INVALID`) naming the field and valid values — no silent passthrough to a late factory throw.
- Credential selection for the supported providers: add an `omp` entry to the sandbox agent-type environment set containing ONLY the supported provider credentials — `GEMINI_API_KEY` and `OPENROUTER_API_KEY` (Gemini is the provider OMP itself names `google`; provider/model ID translation stays in row 8) — plus the approved shared base/passthrough allowlist (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, `LANG`, `LC_ALL`, `DENO_DIR`, `DENO_NO_UPDATE_CHECK`, `SKILL_API_PORT`, `SESSION_ID` per-spawn-only, `SKILL_JWT_DIR`, `SKILL_SHARED_PROCESS`, `AGENT_WORKSPACE`, `TMPDIR`, `XDG_DATA_HOME`, `AGENT_BROWSER_EXECUTABLE_PATH`, `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` and lowercase forms). The filter NEVER passes: platform tokens (`DISCORD_TOKEN`, `MISSKEY_TOKEN`), dashboard credentials (`DASHBOARD_PASSPHRASE`), the raw Skill API server secret (`AGENT_SKILL_API_SECRET`), unapproved provider keys (`OPENCODE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GITHUB_TOKEN`, `COPILOT_GITHUB_TOKEN`, git-backup `GIT_BACKUP_AUTH_PASSWORD`, and any other provider secret), or profile/XDG state selectors (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OMP_PROFILE`/`PI_PROFILE`, `PI_CODING_AGENT_DIR`) — neither implicitly nor via operator-configured `allowedEnvVars`, which cannot widen the credential or selector categories (an allowlist entry naming one is rejected with a bounded warning and excluded).
- `XDG_DATA_HOME` caveat, stated as a dependency, not pre-empted: the existing base allowlist includes `XDG_DATA_HOME` because the factory sets it per session/pool for OpenCode tool-output scoping, and the filter passes the value it finds in the base env. Design §5 requires that OMP never inherit profile/XDG selectors that redirect scoped state; giving OMP a correctly scoped process-state root (`PI_CODING_AGENT_DIR` under the selected process's `TMPDIR/omp-agent`, mode-distinct roots) is owned by `translate-omp-owned-settings` (row 8) and `spawn-mode-scoped-omp-agents` (row 9). This change makes no launch decision about it and must not be read as approving an inherited selector for OMP state.
- Synchronize all three configuration documents in this change per the batch contract: `config.example.yaml`, `.env.example`, and `helm/values.yaml` describe `defaultAgentType`/`AGENT_DEFAULT_TYPE` as `opencode` (default) or `omp`, with unknown values rejected at startup. Dashboard chat `agentType` validation consumes the same supported-type predicate (unknown still HTTP 400).
- Explicit non-goals: OMP launch commands, factory `omp` spawn branch, owned settings files/overlays, trusted-module paths, `PI_CODING_AGENT_DIR`/process-state assignment, and pool/process/state identity — owned by `translate-omp-owned-settings` (row 8) and `spawn-mode-scoped-omp-agents` (row 9), with pools by `isolate-omp-process-pools-by-mode` (row 10). Until row 9 lands, `createAgentConfig()` intentionally has no `omp` launch branch: config acceptance never implied launch support, and the factory keeps failing an `omp` request clearly. No P0 contract redefinition.

## Capabilities

### New Capabilities

None; reuse the existing ACP integration, configuration, and dashboard-chat capabilities.

### Modified Capabilities

- `acp-integration`: Supported agent types become `"opencode" | "omp"` with OpenCode as the omitted default and unknown types rejected; sandbox environment filtering gains the OMP supported-provider credential set and an explicit never-pass category boundary for platform/dashboard/Skill-API-secret/unapproved-provider/profile-XDG selectors, including `allowedEnvVars` unable to widen it.
- `configuration-and-deployment`: `agent.defaultAgentType`/`AGENT_DEFAULT_TYPE` is validated at load (omitted => `opencode`, unknown => `ConfigError`), and `config.example.yaml`, `.env.example` and `helm/values.yaml` must all describe the `opencode|omp` domain in the same change that changes the parser.
- `web-dashboard-chat`: the chat-connect `agentType` parameter is validated against the shared supported-type set (unknown remains HTTP 400); the per-request parameter's valid values track the deployment-level supported types rather than a second hard-coded value.

## Impact

Eventual implementation owns: `src/acp/types.ts` (`AgentType = "opencode" | "omp"` plus a shared `SUPPORTED_AGENT_TYPES`/`isSupportedAgentType` predicate), `src/types/config.ts` (`defaultAgentType?: AgentType`), `src/core/config-loader.ts` (load-time validation via the shared predicate, `ConfigError` on unknown), `src/utils/env.ts` (doc alignment; the `AGENT_DEFAULT_TYPE` mapping is unchanged), `src/acp/sandbox-manager.ts` (`omp` credential entry; deny-category enforcement over implicit base and `allowedEnvVars`), `src/acp/agent-factory.ts` (`getDefaultAgentType` unchanged in behavior; no `omp` launch branch), `src/dashboard/server.ts` (validation via the shared predicate), `config.example.yaml`, `.env.example`, `helm/values.yaml`, `AGENTS.md`/`docs/DESIGN.md`/`docs/DEVELOPMENT.md` agent-type tables, one `CHANGELOG.md` entry, and consumer-visible unit tests (`tests/utils/env.test.ts`, `tests/core/config-loader.test.ts`, `tests/acp/sandbox-manager.test.ts`, `tests/acp/agent-factory.test.ts`, `tests/dashboard/server.test.ts`) covering type parsing/default/unknown and credential-filter allow/deny decisions.

No new configuration or environment FIELD is introduced — `AGENT_DEFAULT_TYPE`/`defaultAgentType` already exist and only their accepted value domain widens — but the batch contract still assigns the three-document synchronization to this change, and it is performed here. `Containerfile`, `agent-config/`, `helm/templates/`, the P0 contract module, and every launch/settings/pool mechanism are untouched.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Predecessor consumption, predicate/type widening across types/config-loader/env | 1.25 |
| Load-time `defaultAgentType` validation (omitted/valid/unknown/empty-expansion) with `ConfigError` | 0.75 |
| Sandbox manager `omp` credential set + never-pass deny categories + `allowedEnvVars` guard | 1.75 |
| Consumer-visible unit tests (parsing/default/unknown/credential-filter decisions, dashboard predicate) | 1.75 |
| Config-doc synchronization (config.example.yaml/.env.example/helm/values.yaml) + AGENTS/docs tables + changelog | 0.75 |
| Applicable focused type/unit checks and OpenSpec verification, no live agents | 0.50 |
| Contingency for edge-case/review fixes | 1.25 |
| **Total hard ceiling** | **8.00** |

Core is 6.75 hours plus 1.25 contingency. No launch, settings-overlay, trusted-module, pool, or packaging work is hidden in this allocation; those are owned by rows 8/9/10 and would exceed this change if attempted.

## Batch:

depends-on: establish-omp-compatibility-contracts

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| establish-omp-compatibility-contracts | Application gate | P0 records native-interface verdicts; a recorded incompatibility blocks application of OMP-facing behavior, not proposal generation or local mock/unit work. Consume P0 evidence; do not edit its artifacts or redefine its contracts. The credential-set decision here needs no new P0 mechanism — Gemini/OpenRouter keys already exist for OpenCode. |
| translate-omp-owned-settings (row 8) | Required successor, same-module follow-on | Row 8 owns owned settings overlays, provider/application headers, and the security-relevant setting/env selector filtering ABOVE this change's subprocess-credential filter, including how OMP's own state/config selectors are neutralized. This change must not pre-empt the `XDG_DATA_HOME`/`PI_CODING_AGENT_DIR` scoped-state decision (design §5); row 8/9 resolve it. Row 8 may extend the sandbox-manager deny list but must not re-parse the agent type. |
| spawn-mode-scoped-omp-agents (row 9) | Required successor, same-file shared | Row 9 owns the `agent-factory.ts` `omp` launch branch, `PI_CODING_AGENT_DIR`/process `TMPDIR` scoping, and trusted-module paths. It consumes this change's `SUPPORTED_AGENT_TYPES` predicate and `omp` credential key set; it must not fork a second supported-type list or a second credential allowlist. Serialize `agent-factory.ts`/`sandbox-manager.ts` edits after this change. |
| isolate-omp-process-pools-by-mode (row 10) | Downstream consumer | Pool identity gains agent type + mode; acquires agent types only through this change's predicate. No shared files with this change. |
| adapt-omp-web-search (row 18) | Downstream consumer | Uses the supported provider credentials this change passes (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`); must not add a new provider secret merely for search — any new credential category needs its own approved config change. |
| modernize-acp-session-config (row 6) | Independent sibling | Touches `agent-connector.ts` config-option paths only; this change never touches the connector. |
| canonicalize-acp-filesystem-roots / secure-acp-filesystem-access / enforce-acp-filesystem-authorization / normalize-acp-destructive-targets (rows 2–5) | Independent siblings | Same P0 predecessor only; they own `client.ts`/filesystem paths, not config parsing or env filtering. |
| finish-omp-mocked-skill-handoff (row 22) | Final regression/docs | Must NOT re-defer or restate the three-document synchronization done here; final docs pass extends (never rewrites) the agent-type tables written here. |
- Shared-file conflict: `src/core/config-loader.ts` is edited only here among completed/scheduled rows (rows 2–6 touch none of config-loader/env/sandbox-manager); `src/acp/agent-factory.ts` and `src/acp/sandbox-manager.ts` are shared with rows 8/9 — apply this change before them and extend, never replace, the predicate/credential-set. `config.example.yaml`, `.env.example`, `helm/values.yaml` are touched ONLY by this change within the batch (no other row introduces config/env fields); `CHANGELOG.md` requires serial integration as usual.
- Spec-conflict: MODIFIED requirements here replace the `acp-integration` "Supported Agent Types" and "SandboxManager Environment Filtering" blocks and the `web-dashboard-chat` connection block; downstream rows must preserve the widened type/never-pass categories and apply their deltas serially.

Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
