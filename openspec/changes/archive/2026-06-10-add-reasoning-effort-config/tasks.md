## 1. Configuration Types & Loading

- [x] 1.1 Add a shared `ReasoningEffort` string type (normalized union `"none" | "low" | "medium" | "high" | "default"` with `string` passthrough) in `src/types/config.ts`, with JSDoc.
- [x] 1.2 Add reasoning-effort fields: `reasoningEffort?: ReasoningEffort` (global) on `AgentConfig`; `reasoningEffort?: ReasoningEffort` (per-rule) on `ModelRoutingRule`; and `reasoningEffort?: ReasoningEffort` (per-section) on `SelfResearchConfig`, `MemoryMaintenanceConfig`, and `ConversationSummaryConfig`.
- [x] 1.3 In `src/core/config-loader.ts`, add a single shared normalization helper (trim, lowercase, present-but-empty → `"default"`, accept known set, else passthrough + warn). Apply it to: the global `agent.reasoningEffort` (defaulting to `"default"` when missing); each routing rule's `reasoningEffort` (inside the existing rule validation/filtering); and each section's `reasoningEffort`. Omitted per-rule/per-section fields stay `undefined`.
- [x] 1.4 Add `AGENT_REASONING_EFFORT: "agent.reasoningEffort"` to `ENV_MAPPINGS` in `src/utils/env.ts` (string type) — global default only. Ensure `MODEL_ROUTING_RULES` JSON parsing carries the per-rule `reasoningEffort` field through.

## 1a. Reasoning Effort Resolver

- [x] 1a.1 In `src/core/model-router.ts`, add `resolveReasoningEffort(routingConfig, context, fallbackEffort)` parallel to `resolveModel`: reuse `matchesRule` + first-match-wins; return the matched rule's `reasoningEffort` if set; otherwise return `fallbackEffort`. Return `fallbackEffort` when routing is disabled or no rule matches.

## 2. AgentConnector Reasoning Effort Support

- [x] 2.1 In `src/acp/agent-connector.ts`, capture `configOptions` returned by `connection.newSession(...)` in `createSession()` and store them as single-session connector state. (Keep `createSession`'s return type as `sessionId` to avoid breaking callers.)
- [x] 2.2 Reset the cached `configOptions` in `disconnect()` (alongside `capabilities`).
- [x] 2.3 Add an internal method to **refresh** the cached `configOptions` from a complete list (used by both the `config_option_update` notification path and `setSessionConfigOption` responses).
- [x] 2.4 In `src/acp/client.ts` (`ChatbotClient.sessionUpdate`), handle `config_option_update`: update `lastActivityTimestamp` and call back into the connector to refresh cached `configOptions`. Wire the connector reference into `ChatbotClient` (or expose a setter) so the client can propagate updates.
- [x] 2.5 Add `setReasoningEffort(sessionId: string, value: string): Promise<ReasoningEffortOutcome>` that: returns `skipped` when value is empty/`"default"`; re-discovers the option with `category === "thought_level"` from the **latest** cached `configOptions`; if absent, logs and returns `unsupported`; if present and the value is a known-vocabulary value NOT among the option's available values, logs a structured warning and returns `skipped_unavailable`; otherwise calls `connection.setSessionConfigOption({ sessionId, configId, value })`, refreshes the cache from the response, returns `applied`; catches any error, logs it, and returns `failed` (never throws).
- [x] 2.6 Add a helper returning whether reasoning effort is "active" (non-default) to avoid unnecessary calls/logs.

## 3. Session Orchestrator Wiring

- [x] 3.1 At each `resolveModel(...)` call site in `src/core/session-orchestrator.ts`, also call `resolveReasoningEffort(this.config.agent.modelRouting, routingContext, <sectionFallback>)`, where `<sectionFallback>` is the section→global chain for that session type: `selfResearch.reasoningEffort ?? agent.reasoningEffort` for self-research; `memoryMaintenance.reasoningEffort ?? agent.reasoningEffort` for maintenance; `conversationSummary.reasoningEffort ?? agent.reasoningEffort` for the summary path; `agent.reasoningEffort` for message / spontaneous / channel-lurk (no section). The result is always a concrete string because the global defaults to `"default"`.
- [x] 3.2 Add a private helper `applyReasoningEffort(connector, sessionId, resolvedEffort)` that calls `connector.setReasoningEffort(sessionId, resolvedEffort)` and logs the returned outcome. It SHALL always be called with the concrete resolved value from `resolveReasoningEffort()` — never `undefined`.
- [x] 3.3 Invoke `applyReasoningEffort(..., resolvedEffort)` immediately after **every** `setSessionModel(...)` call. Use grep to enumerate every `setSessionModel` call site and confirm each is paired (message, channel-lurk, spontaneous, self-research, memory-maintenance, and BOTH `setSessionModel` calls in the conversation-summary swap/restore path — the restore call reuses the same resolved effort as the original session).
- [x] 3.4 Resolve + apply reasoning effort on the dashboard / manual session path in `src/dashboard/server.ts` after its `setSessionModel(...)` call, using `agent.reasoningEffort` as the fallback (dashboard has no section value).

## 4. Audit Logging

- [x] 4.1 Include the **resolved (effective)** `reasoningEffort` value in the `session_start` audit `data` (extend the data object where `model` is recorded), defaulting to `"default"` when the chain produced no value. Update `src/types/audit.ts` if a typed field is used.
- [x] 4.2 Ensure the per-attempt outcome (`applied` / `unsupported` / `skipped` / `skipped_unavailable` / `failed`) is observable via structured logs (including `sessionId`, requested value, model, agentType, discovered `configId`, and available values where relevant).

## 5. Config Examples, Helm, and Docs

- [x] 5.1 In `config.example.yaml`, document the global `agent.reasoningEffort`, the per-rule `reasoningEffort` (on a `modelRouting.rules[]` example), and the per-section `reasoningEffort` (on `selfResearch`/`memoryMaintenance`/`conversationSummary`), explaining the resolution chain (rule → section → global), the value vocabulary, and the `"default"` meaning.
- [x] 5.2 Add `AGENT_REASONING_EFFORT` (global default) to `.env.example`, noting per-rule/per-section values come from config / `MODEL_ROUTING_RULES`.
- [x] 5.3 Add `AGENT_REASONING_EFFORT` under the `env:` section in `helm/values.yaml` (default `'default'`).
- [x] 5.4 Document the per-context reasoning effort in `AGENTS.md` (configuration reference, model-routing, and ACP integration sections), including the resolution chain and best-effort/agent-dependent behavior.

## 6. Tests

- [x] 6.1 Unit tests for config loading/normalization across all levels and `AGENT_REASONING_EFFORT` env override: global default applied when missing; normalization of global, per-rule, and per-section fields (`"  Medium  "` → `"medium"`, empty → `"default"`); omitted per-rule/per-section fields stay `undefined`; passthrough warning for unknown tokens; **env override precedence** over config file value for the global.
- [x] 6.1a Unit tests for `resolveReasoningEffort`: rule with effort wins; matched rule without effort falls through to fallback; routing disabled / no match returns fallback; first-match-wins ordering; model + effort resolved from the same matched rule.
- [x] 6.2 Unit tests for `AgentConnector.setReasoningEffort` outcomes: `skipped` on default; `unsupported` (no `thought_level` option); `applied` with correct `configId`/value when supported; `skipped_unavailable` (known value not offered) with structured warning; **passthrough token actually sent unchanged**; `failed` (error caught, not thrown) when agent rejects.
- [x] 6.3 Unit tests for `AgentConnector.createSession` capturing `configOptions` and `disconnect()` clearing them; and for the cache-refresh path.
- [x] 6.4 Unit tests for the **stale-state / refresh** cases: (a) `newSession` returns no `thought_level`, then a `config_option_update` adds it → effort is then applied; (b) model A offers `low|medium`, model B offers `none|high` → after a `config_option_update` for B, validation uses B's values, not A's; (c) `setSessionConfigOption` response refreshes the cache.
- [x] 6.5 Test for `ChatbotClient` handling `config_option_update`: refreshes connector cache and updates `lastActivityTimestamp`; non-`config_option_update` updates leave cache unchanged.
- [x] 6.6 Orchestrator tests (extend mock connectors in `tests/core/session-orchestrator*.test.ts`) asserting `setReasoningEffort` is invoked after `setSessionModel` for each session type with the **resolved** value, including: a routing-rule effort overriding the section/global; a section value used when no rule matches; **twice for the conversation-summary swap/restore path**; and the **dashboard path**.
- [x] 6.7 Audit test asserting `session_start` entry includes the resolved `reasoningEffort`.
- [x] 6.8 Test asserting every orchestrator path passes a concrete resolved value (never `undefined`) to `setReasoningEffort`, and that `MODEL_ROUTING_RULES` JSON with a non-standard per-rule `reasoningEffort` keeps the rule (not dropped).

## 7. Verification

- [x] 7.1 Run `deno fmt src/ tests/`, `deno lint src/ tests/`, `deno check src/main.ts`.
- [x] 7.2 Run `deno task test` and confirm all tests pass with coverage > 75%.
- [x] 7.3 (Optional) Run a `--dry-run` or temporary log of `configOptions` against each agent (copilot/gemini/opencode) to record which advertise `thought_level`, and note observed support in `AGENTS.md`.
