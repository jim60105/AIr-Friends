## Why

The normalized reasoning-effort vocabulary only covers `"none" | "low" | "medium" | "high"`. Models with
stronger thinking budgets advertise additional levels (e.g. `xhigh`, `max`); configuring them today emits
a misleading "non-standard reasoning effort value (passthrough)" warning at load, and treats them as
agent-specific passthrough tokens at apply time. This is a false alarm for a value class the operator
intends to use as a first-class standard level.

## What Changes

- Extend the shared normalized reasoning-effort vocabulary with two new levels: `"xhigh"` and `"max"`.
- `KNOWN_REASONING_EFFORTS` (config normalization) gains `"xhigh"` and `"max"` so these values load
  silently as standard levels — no more passthrough warning.
- `KNOWN_REASONING_EFFORT_TOKENS` (application gate) gains `"xhigh"` and `"max"` so they follow the
  known-vocabulary path at apply time: canonical-casing match against the agent's advertised
  `thought_level` values when offered; structured `skipped_unavailable` skip (with warning) when the
  model does not offer them — instead of being sent blindly as passthrough tokens.
- The `ReasoningEffort` TypeScript union in `src/types/config.ts` gains both values.
- Tests updated for normalization (config) and application-gate (ACP connector) behavior.
- Documentation updated: `AGENTS.md` vocabulary table, `config.example.yaml` / `.env.example` /
  `helm/values.yaml` comments where the vocabulary is enumerated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reasoning-effort-control`: The shared normalized vocabulary expands to include `"xhigh"` and `"max"`;
  the application gate's known-token behavior now covers the new levels.
- `configuration-and-deployment`: The config-normalization requirement's recognized-value list gains
  `"xhigh"` and `"max"`.

## Impact

- `src/core/config-loader.ts` — `KNOWN_REASONING_EFFORTS` constant (vocabulary list).
- `src/acp/agent-connector.ts` — `KNOWN_REASONING_EFFORT_TOKENS` constant (application gate list).
- `src/types/config.ts` — `ReasoningEffort` type union.
- Tests: `tests/core/reasoning-effort-config.test.ts`, `tests/acp/agent-connector.test.ts`.
- Docs: `AGENTS.md`, `config.example.yaml`, `.env.example` (both the `AGENT_REASONING_EFFORT` and
  `MODEL_ROUTING_RULES` comment blocks), `helm/values.yaml`.
- `src/dashboard/server.ts` uses `agent.reasoningEffort ?? "default"` without enumerating the
  vocabulary — no change needed there.
- No API, dependency, or schema-breaking changes. No migration needed (project unreleased, 0 users).
