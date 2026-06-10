## Why

Modern reasoning-capable models (and the ACP agents that front them) expose a tunable "reasoning effort" / "thought level" that trades response latency and token cost against answer depth. AIr-Friends can currently pick *which* model runs (via `agent.model`, section models, and `modelRouting`), but it has no way to control *how hard that model thinks*. Different contexts need different effort levels — e.g. a high-effort routing rule for research-heavy channels, a low-effort section model for cheap memory maintenance, and a different default elsewhere. Operators therefore need reasoning effort to be configurable **per context**, resolved through the same chain as the model, not a single global value.

## What Changes

- Add a reasoning-effort knob that is resolved **per context** through the **same precedence chain as model selection**:
  1. **Per-routing-rule** `reasoningEffort` on each `agent.modelRouting.rules[]` entry.
  2. **Per-section** `reasoningEffort` on `selfResearch`, `memoryMaintenance`, and `conversationSummary`.
  3. **Global** `agent.reasoningEffort` as the final fallback default.
- Add a `resolveReasoningEffort()` resolver (parallel to `resolveModel()`, reusing the same match ordering and fallback structure) that takes the routing config + routing context + the section-specific fallback value and returns the effective reasoning effort for the session. It stops at the **first matching rule**: if that rule sets `reasoningEffort`, it wins; if it omits `reasoningEffort`, resolution falls back to section → global (it does **not** continue to later rules). This is the one behavioral difference from `resolveModel()`, which lets operators route model and effort independently while keeping them tied to the same matched rule.
- Implement reasoning-effort application via the ACP **Session Config Options** API (`session/set_config_option` with the `thought_level` category), which is the spec-preferred mechanism. The `AgentConnector` gains a method to discover the agent's `thought_level` config option from live (refreshed) session state and set its value.
- Make reasoning effort **best-effort and non-fatal**: if the connected agent/model does not advertise a `thought_level` config option (or does not support a requested value), the system logs and continues without failing the session.
- Add the standard configuration plumbing:
  - `agent.reasoningEffort` (global default), `reasoningEffort` on each routing rule, and `reasoningEffort` on the three section configs — in config types and validation (with shared normalization and a `"default"`/unset sentinel meaning "do not configure reasoning effort").
  - `AGENT_REASONING_EFFORT` environment variable override (global default) via `ENV_MAPPINGS`; per-rule and per-section values come from `MODEL_ROUTING_RULES` JSON / config file.
  - `config.example.yaml`, `.env.example`, and `helm/values.yaml` (`env:` section) entries.
- Apply the resolved reasoning effort in the session flow after each `setSessionModel` call across **all** session types (message, channel-lurk, spontaneous, self-research, memory-maintenance, conversation-summary including its mid-session model swap, and the dashboard-initiated path).
- Record the resolved reasoning-effort value (and application outcome) in the session audit log.

## Capabilities

### New Capabilities
- `reasoning-effort-control`: Per-context reasoning/thought level resolved through the model-selection chain (routing rule → section → global) and applied to ACP agent sessions via the ACP Session Config Options `thought_level` category, with best-effort graceful degradation when unsupported.

### Modified Capabilities
- `model-routing`: Routing rules gain an optional per-rule `reasoningEffort`, and a `resolveReasoningEffort()` resolver follows the same first-match-wins + section/global fallback semantics as `resolveModel()`.
- `acp-integration`: `AgentConnector` gains a reasoning-effort application capability (discovering and setting the session `thought_level` config option from live config state). The "Model and mode setting" requirement is extended to cover reasoning-effort application.
- `configuration-and-deployment`: Add the global `agent.reasoningEffort` field, per-rule and per-section `reasoningEffort` fields, the `AGENT_REASONING_EFFORT` env override, shared validation/normalization, and example/helm coverage.
- `session-audit-log`: Record the resolved (effective) reasoning-effort value in the session-start audit data.

## Impact

- **Code**:
  - `src/types/config.ts` — add a shared `ReasoningEffort` type; add `reasoningEffort` to `AgentConfig` (global), `ModelRoutingRule` (per-rule), `SelfResearchConfig`, `MemoryMaintenanceConfig`, and `ConversationSummaryConfig` (per-section).
  - `src/core/model-router.ts` — add `resolveReasoningEffort()` parallel to `resolveModel()` (first-match-wins, returns the matched rule's `reasoningEffort` if set, else the section/global fallback).
  - `src/utils/env.ts` — add `AGENT_REASONING_EFFORT` (global) to `ENV_MAPPINGS`.
  - `src/core/config-loader.ts` — default + normalize/validate all reasoning-effort fields with shared logic (including inside routing-rule validation).
  - `src/acp/agent-connector.ts` — add a method to set reasoning effort via `connection.setSessionConfigOption`, with discovery from live (refreshed) `configOptions`.
  - `src/acp/client.ts` — handle the `config_option_update` session notification to keep cached `configOptions` fresh after model changes.
  - `src/core/session-orchestrator.ts` — resolve reasoning effort via `resolveReasoningEffort()` next to each `resolveModel()` call (section fallback per session type) and apply it after each `setSessionModel`.
  - `src/dashboard/server.ts` — resolve + apply reasoning effort on the dashboard-initiated session path.
  - `src/types/audit.ts` (if needed) — extend audit data fields.
- **Config / Deployment**: `config.example.yaml`, `.env.example`, `helm/values.yaml`.
- **Docs**: `AGENTS.md` (configuration reference + model-routing section).
- **Dependencies**: None new — the installed `@agentclientprotocol/sdk@0.14.1` already exposes `setSessionConfigOption` and `SessionConfigOptionCategory` including `thought_level`.
- **Tests**: New unit tests for `resolveReasoningEffort` precedence, connector reasoning-effort logic, config loading/env override (global + per-rule + per-section), and orchestrator wiring; coverage must remain >75%.
