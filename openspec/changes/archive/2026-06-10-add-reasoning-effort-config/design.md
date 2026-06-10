## Context

AIr-Friends is an ACP (Agent Client Protocol) Client. It spawns an external agent CLI (Copilot / Gemini / OpenCode), creates an ACP session, then configures the session model and (for OpenCode YOLO) mode before sending the prompt. Model selection is already rich: a global `agent.model`, per-section models (`selfResearch.model`, `memoryMaintenance.model`, `conversationSummary.model`), and `agent.modelRouting` rules all feed a single resolved `modelId` that is applied via `AgentConnector.setSessionModel()` (which calls the experimental `unstable_setSessionModel`).

There is currently **no** control over reasoning effort / thought level. The ACP spec defines the **Session Config Options** API (`session/set_config_option`) as the preferred, forward-compatible mechanism for session-level selectors, where reasoning effort is represented by a config option carrying `category: "thought_level"`. The installed SDK (`@agentclientprotocol/sdk@0.14.1`) already exposes `connection.setSessionConfigOption(...)`, the `SessionConfigOptionCategory` union (including `"thought_level"`), and returns `configOptions` from `newSession` / `loadSession`.

Constraints:
- Project is pre-release with **zero users**; no backward compatibility or migration is required.
- A single session error MUST NOT crash the bot (project-wide rule).
- Concrete option `id` and value tokens for `thought_level` are **agent/model-specific** — the spec deliberately leaves them undefined. Agents advertise their available values in the `configOptions` returned at session creation.
- Reasoning effort must be configurable **per context** (per routing rule and per section), resolved through the **same chain** the model uses, because different contexts need different effort levels.

## Goals / Non-Goals

**Goals:**
- Per-context reasoning effort, resolved through the model-selection chain: **routing rule → section → global**, so each context (channel, session type, section) can run at a different effort.
- A `resolveReasoningEffort()` resolver that mirrors `resolveModel()` (first-match-wins routing + section/global fallback), keeping reasoning effort and model resolution structurally parallel.
- Apply reasoning effort through the spec-preferred ACP Session Config Options API (`thought_level` category).
- Graceful, best-effort behavior: never fail a session because the agent/model lacks reasoning-effort support or rejects a value.
- Standard plumbing parity with existing knobs: config types, shared validation/normalization, env override (global default), `config.example.yaml`, `.env.example`, `helm/values.yaml`, audit visibility, and tests keeping coverage > 75%.

**Non-Goals:**
- Exposing reasoning effort selection in the web dashboard UI (the dashboard-initiated session path resolves and applies the configured value, but there is no UI selector).
- Mapping AIr-Friends values to agent-specific tokens via a hardcoded per-agent table (we rely on agent-advertised values; see Decisions).
- Adding the deprecated dedicated `set_model`/`modes` paths for reasoning. We use config options only.
- A separate env var per routing rule / per section (per-rule and per-section values come from the config file / `MODEL_ROUTING_RULES` JSON; only the global default has a dedicated env var).

## Decisions

### Decision 0: Resolve reasoning effort per-context via a chain parallel to model resolution

Reasoning effort is **resolved per session** (not a single global value) using the same precedence model uses:

1. **Routing rule** — if model routing is enabled and a rule matches, and that rule has a `reasoningEffort` set, use it.
2. **Section** — otherwise fall back to the section-specific value for the session type: `selfResearch.reasoningEffort`, `memoryMaintenance.reasoningEffort`, `conversationSummary.reasoningEffort`. (Message / spontaneous / channel-lurk / dashboard sessions have no section value and fall straight to global.)
3. **Global** — otherwise `agent.reasoningEffort` (which itself defaults to `"default"` = "do not configure").

This is implemented as `resolveReasoningEffort(routingConfig, context, fallbackEffort)` in `src/core/model-router.ts`, structurally parallel to the existing `resolveModel(routingConfig, context, fallbackModel)`:
- It reuses the **same** rule-matching (`matchesRule`) and first-match-wins ordering as `resolveModel`, so a routing rule's model and reasoning effort are resolved consistently from the same matched rule.
- It stops at the **first matching rule** (parity with `resolveModel`). If that rule sets `reasoningEffort`, it wins; if it omits `reasoningEffort`, resolution returns `fallbackEffort` and does **NOT** continue to later rules. This is the single behavioral difference from `resolveModel` (which always returns the first matching rule's `model`): a matched rule that has a model override but no `reasoningEffort` falls back immediately, letting operators route the model and the effort independently while keeping them tied to the same matched rule.
- The caller passes `fallbackEffort` using the section→global chain for the session type (e.g. for self-research, `fallbackEffort = selfResearch.reasoningEffort ?? agent.reasoningEffort`; for message/spontaneous/channel-lurk/dashboard, `fallbackEffort = agent.reasoningEffort`). Because the global defaults to `"default"`, the resolved value is always a concrete string.

- **Why**: The user requires different effort per context. Reusing `resolveModel`'s match ordering and fallback structure keeps the mental model and code symmetric, reuses matching logic, and ensures the model and its effort come from the same matched rule. The "omitted rule field falls back immediately" rule is the deliberate, documented exception.
- **Alternatives considered**:
  - *Single global value only*: rejected — explicitly not what the user wants.
  - *Independent rule set just for effort*: rejected — duplicates matching logic and could resolve model and effort from different rules, which is confusing.

### Decision 1: Use the ACP Session Config Options API with the `thought_level` category

Reasoning effort is set via `connection.setSessionConfigOption({ sessionId, configId, value })`, where `configId` is the id of the config option whose `category === "thought_level"` as advertised by the agent at session creation.

- **Why**: The spec explicitly marks Session Config Options as preferred and states the older `modes` API will be removed. `thought_level` is the spec's reserved category for reasoning level. There is no dedicated `set_reasoning` method.
- **Alternatives considered**:
  - *Dedicated method*: none exists.
  - *`_meta` on prompt/session*: non-standard and agent-specific; rejected.
  - *CLI flags per agent*: brittle, agent-specific, and would not be runtime/session-scoped; rejected.

### Decision 2: Discover the `thought_level` option from live session config state (not a creation-time snapshot)

`AgentConnector.createSession()` already calls `connection.newSession(...)`; today it returns only `sessionId` to callers and discards `configOptions`. We will treat the agent's `configOptions` as **mutable session state held on the connector** and keep it fresh from every authoritative ACP source:

1. **Capture** `configOptions` from the `newSession` result.
2. **Refresh** the cache from the **`config_option_update`** session notification (`sessionUpdate: "config_option_update"`), handled in `ChatbotClient.sessionUpdate()` and propagated to the connector. Per the spec, agents send this (with the **complete** config state) when options change — including when a model change alters the available `thought_level` options/values.
3. **Refresh** the cache from the **`SetSessionConfigOptionResponse`**, which the spec/SDK guarantees returns the **complete** updated `configOptions` list after any `set_config_option` call.

> **Important SDK constraint:** `SetSessionModelResponse` (from `unstable_setSessionModel`) carries **only `_meta`** — it does **not** return updated `configOptions`. Therefore the cache CANNOT be refreshed from the model-set response directly. Freshness after a model change relies on the agent's `config_option_update` notification (source 2). `setReasoningEffort` always re-discovers from the latest cache at call time, so any notification that arrived between model-set and reasoning-effort application is reflected.

A new method `setReasoningEffort(sessionId, value)` will:
1. Re-discover the config option with `category === "thought_level"` from the **latest** cached `configOptions` (never a stale snapshot).
2. If found, validate the value (see Decision 4), then call `setSessionConfigOption({ sessionId, configId: option.id, value })` and update the cache from its response.
3. If not found, log and return (no-op).

- **Why**: Option `id`s, available values, and even the *presence* of `thought_level` can be model-dependent. Discovering from live, refreshed state (rather than a `newSession`-time snapshot) is the only correct approach given that the model-set response does not echo config state.
- **Alternatives considered**:
  - *Snapshot at `newSession` only*: stale after a model change; can validate against wrong values or miss a newly-available option. Rejected (this was the original draft; corrected after review).
  - *Hardcode `configId: "thought_level"` and a per-agent value map*: fragile; agents may use different ids and value sets. Rejected. No `configId` fallback is attempted (see Decision 7).

### Decision 3: Value model — normalized enum with passthrough (shared by all reasoning-effort fields)

Every reasoning-effort field — global `agent.reasoningEffort`, per-rule `modelRouting.rules[].reasoningEffort`, and per-section `selfResearch`/`memoryMaintenance`/`conversationSummary.reasoningEffort` — is a string of the **same** shared `ReasoningEffort` type. We define a normalized set the operator is expected to use — `"none" | "low" | "medium" | "high"` — plus a special sentinel `"default"` (or empty/unset) meaning "do not send any reasoning-effort config; let the agent/model use its own default".

Two distinct "unset" cases:
- A **field omitted** on a routing rule or section → that level contributes nothing to resolution; the chain falls through to the next level (Decision 0). This is *not* the same as the value `"default"`.
- A field present with value `"default"` (or the **final resolved** value being `"default"`) → skip the reasoning-effort step entirely (no `set_config_option` call).

Validation/normalization (in `config-loader.ts`) uses one shared helper applied to **all** reasoning-effort fields (including inside routing-rule and section validation) and to the `AGENT_REASONING_EFFORT` env value:
- Trim surrounding whitespace.
- Treat empty / whitespace-only as `"default"` (for present-but-empty fields).
- Lowercase the trimmed token.
- If the lowercased token is in the known set (`none|low|medium|high|default`), use it.
- Otherwise keep the trimmed token as-is (passthrough) and log a warning so operators can use agent-specific tokens the spec might not standardize.
- Omitted optional fields stay `undefined` (so the resolver can distinguish "not set" from `"default"`).

- **Why**: A small normalized vocabulary is intuitive and matches common reasoning-effort tiers; passthrough avoids hard-blocking valid agent-specific values; a shared helper guarantees consistent normalization across global/per-rule/per-section. Distinguishing "omitted" from `"default"` is what makes the resolution chain work.
- **Alternatives considered**:
  - *Strict enum only*: would break agents whose values differ. Rejected.
  - *Free-form only*: loses validation/typo protection for the common case. Rejected.
  - *Treating omitted as `"default"`*: would break fallthrough (an omitted rule field would short-circuit to "do not configure" instead of deferring to section/global). Rejected.

### Decision 4: Best-effort value matching against advertised options

When applying a value, `setReasoningEffort` matches against the **latest** discovered option's `options[].value`:
- **Known-vocabulary value present** in the option's values → send it (audit `result: applied`).
- **Known-vocabulary value NOT present** (e.g. operator asked `"none"` but the model only offers `low|medium|high`) → log a **structured, diagnosable warning** (with requested value, the option's available values, model, agentType) and **skip** sending (audit `result: skipped_unavailable`). Skipping avoids a predictable agent rejection, but the structured warning + audit outcome ensure the no-op is visible, not silent.
- **Passthrough token** (operator value outside the known vocabulary) → send it as-is and catch any agent error (audit `result: failed` on error), since the operator deliberately supplied an agent-specific token.

- **Why**: Avoids predictable round-trip errors for the common case while keeping behavior fully observable, and still honors explicit operator intent for agent-specific tokens. The strictness is intentionally diagnosable rather than silent; making "skip vs. force-attempt" configurable is left as a possible future change.

### Decision 5: Apply after every `setSessionModel`, including mid-session model swaps

Reasoning effort MUST be reconciled after **every** successful `setSessionModel(...)` call, not just once per session. Each call site first resolves the effective value via `resolveReasoningEffort(...)` (Decision 0) using the session's routing context and section fallback, then applies it via a single helper (e.g., `await this.applyReasoningEffort(connector, sessionId, resolvedEffort)`) in `SessionOrchestrator` at all model-setting sites, and in `src/dashboard/server.ts` on the dashboard-initiated session path. The resolved effort is computed right next to the existing `resolveModel(...)` call so model and effort stay paired.

Concrete coverage — every place that calls `setSessionModel` is paired with a reasoning-effort reconciliation:
- message, channel-lurk, spontaneous, self-research, memory-maintenance,
- the **conversation-summary path, which sets the summary model and later restores the original model** — both `setSessionModel` calls are followed by `applyReasoningEffort` so the summary model and the restored model each get the correct reasoning level,
- the **dashboard / manual session path** in `src/dashboard/server.ts`.

It runs after model setting because changing the model can change available `thought_level` options. Because the model-set response does not echo config state (see Decision 2), `applyReasoningEffort` relies on the connector's live cache (refreshed by `config_option_update`) and always re-discovers the option at call time.

- **Why**: Guarantees the "across all model configurations" requirement and prevents the conversation-summary swap from running with the wrong reasoning level on either model.
- **Mitigation for missed sites**: the per-site code is one helper call; a grep-based task verifies every `setSessionModel` call site is paired, and orchestrator tests assert reconciliation runs for each session type and after each swap.

### Decision 6: Audit visibility — record both intent and outcome

Because the feature is best-effort and can no-op, recording only the configured *intent* would be misleading (audit would show `reasoningEffort: high` even when the agent ignored it). We therefore record both:

1. **Intent**: extend the existing `session_start` audit `data` (which already records `model`) with the **resolved (effective)** `reasoningEffort` value for that session — i.e. the output of `resolveReasoningEffort(...)` after the chain, `"default"` when the chain produced no value.
2. **Outcome**: each `applyReasoningEffort` attempt logs a structured result with `sessionId`, `requested` value, `model`, `agentType`, the discovered `configId` (if any), the option's `availableValues` (when relevant), and a `result` status — one of `applied`, `unsupported` (no `thought_level` option), `skipped` (default/unset), `skipped_unavailable` (known value not offered), or `failed` (agent rejected / threw). When an audit writer is attached, this outcome is also captured (enriching `session_start` data or via a dedicated entry).

- **Why**: Operators asking "why didn't this session use high reasoning?" need to distinguish unsupported vs. skipped vs. failed — not just see the requested value.

### Decision 7 (resolved open question): No `configId` fallback

When no advertised option has `category === "thought_level"`, the system does **not** attempt a speculative `configId: "thought_level"` request. Behavior is discovery-by-category only. This avoids sending requests the agent may reject and keeps logs honest (`unsupported`). Revisit only if a concrete target agent is found to key its option `id` as the category without tagging the category.

### Connector state invariant

`AgentConnector` is **single-session scoped** for this feature: one connector instance manages one active ACP session lifecycle (as it does today for `capabilities`). The cached `configOptions` therefore belong to the current session only and are reset on `disconnect()`. If the connector is ever extended to manage multiple concurrent sessions, the cache MUST be keyed by `sessionId`.

## Risks / Trade-offs

- **[Agent does not advertise `thought_level`]** → The step is a no-op; logged at info/debug. No session failure. Documented as expected behavior; reasoning effort simply won't take effect for that agent/model.
- **[Operator sets a value the model rejects]** → Best-effort matching skips unknown known-vocabulary values; passthrough tokens are sent and any error is caught and logged. Session continues with the model's default reasoning.
- **[`unstable_`/evolving spec surface]** → `setSessionConfigOption` is in the stable surface of the SDK (no `unstable_` prefix), unlike `unstable_setSessionModel`. Risk is low; the discovery-based approach insulates us from id/value churn.
- **[Capturing `configOptions` adds connector state]** → Stored per-connection (single-session scoped) and reset on disconnect, consistent with how `capabilities` is handled today. Low risk.
- **[Stale `configOptions` after a model change]** → The model-set response does NOT echo config state, so a `newSession`-time snapshot could be stale after `setSessionModel`. Mitigation: the cache is refreshed from `config_option_update` notifications (which agents send with the full config state when a model change alters options) and from `setSessionConfigOption` responses; `setReasoningEffort` re-discovers from the latest cache at call time. Residual risk: an agent that changes `thought_level` availability after a model change but does NOT emit `config_option_update` — in that case the worst outcome is a skipped/unsupported no-op, which is logged and audited, never a crash.
- **[Conversation-summary mid-session model swap]** → `applyReasoningEffort` is invoked after BOTH the summary-model set and the original-model restore, each re-discovering the correct option set, so neither model runs with the wrong reasoning level.
- **[Missing a session-setup site]** → Mitigated by centralizing the logic in a single helper and adding orchestrator tests that assert the helper runs for each session type and after each model swap via a mock connector; a grep-based task verifies every `setSessionModel` call site is paired.

## Migration Plan

Not applicable (pre-release, zero users). New config defaults to unset/`"default"`, which preserves current behavior (no reasoning-effort config sent). No data migration. Rollback is removal of the new knob and helper call.

## Open Questions

- *(Resolved — see Decision 7)* No `configId` fallback when no option advertises `thought_level`; discovery-by-category only.
- Exact agent support matrix (which of Copilot/Gemini/OpenCode advertise `thought_level` today) should be verified during implementation via a dry-run/log of `configOptions`; behavior is correct regardless, but docs should note observed support. (Task 7.3.)
- Whether "skip vs. force-attempt unavailable value" should become configurable — deferred to a future change.
