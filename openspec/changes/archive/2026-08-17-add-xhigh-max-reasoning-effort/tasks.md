## 1. Vocabulary & Type Updates

- [x] 1.1 Extend `KNOWN_REASONING_EFFORTS` in `src/core/config-loader.ts` with `"xhigh"` and `"max"` (keeping `"default"`; order: `none, low, medium, high, xhigh, max, default`)
- [x] 1.2 Extend `KNOWN_REASONING_EFFORT_TOKENS` in `src/acp/agent-connector.ts` with `"xhigh"` and `"max"`
- [x] 1.3 Add `"xhigh"` and `"max"` to the `ReasoningEffort` union in `src/types/config.ts` and update its JSDoc vocabulary list
- [x] 1.4 Update the `ReasoningEffort` JSDoc comment at the per-rule/per-section/global field sites if they enumerate the vocabulary

## 2. Tests

- [x] 2.1 Add normalization tests in `tests/core/reasoning-effort-config.test.ts`: `"xhigh"` / `"MAX"` (and mixed casing) at global, per-section, and per-rule levels load without the non-standard warning and normalize to lowercase
- [x] 2.2 Add a `MODEL_ROUTING_RULES` JSON integration test in `tests/core/reasoning-effort-config.test.ts`: a rule with mixed-case `"XHigh"` / `"MAX"` retains its `reasoningEffort` normalized to lowercase with no passthrough warning
- [x] 2.3 Verify existing passthrough test (`"ultra"`) still asserts passthrough semantics in `tests/core/reasoning-effort-config.test.ts`
- [x] 2.4 Add a cross-consistency unit test (e.g. in `tests/core/reasoning-effort-config.test.ts` or `tests/acp/agent-connector.test.ts`) asserting `KNOWN_REASONING_EFFORT_TOKENS` equals `KNOWN_REASONING_EFFORTS` minus `"default"`, so future drift between the two lists fails CI
- [x] 2.5 Add application-gate tests in `tests/acp/agent-connector.test.ts`: `"xhigh"` and `"max"` sent with the agent's canonical casing when offered (use fixtures with distinct casing, e.g. `XHigh` / `MAX`, and assert the exact value sent is `applied`)
- [x] 2.6 Add application-gate test in `tests/acp/agent-connector.test.ts`: `"xhigh"` / `"max"` skipped with `skipped_unavailable` when the model enumerates a non-empty available-value list that excludes them (no `setSessionConfigOption` call)
- [x] 2.7 Run `deno test tests/core/reasoning-effort-config.test.ts tests/acp/agent-connector.test.ts` and confirm all pass

## 3. Documentation

- [x] 3.1 Update the reasoning-effort vocabulary table in `AGENTS.md` to include `xhigh` / `max`
- [x] 3.2 Update the `agent.reasoningEffort` comment block in `config.example.yaml` to enumerate the full recognized vocabulary
- [x] 3.3 Update the `AGENT_REASONING_EFFORT` comment in `.env.example` and the `MODEL_ROUTING_RULES` vocabulary comment (line ~45, `none|low|medium|high|default`) to include `xhigh` / `max`
- [x] 3.4 Update the `AGENT_REASONING_EFFORT` entry comment in `helm/values.yaml` if it enumerates the vocabulary

## 4. Validation

- [x] 4.1 Run `deno fmt src/ tests/` and `deno lint src/ tests/`
- [x] 4.2 Run `deno check src/main.ts`
- [x] 4.3 Run full `deno test` suite and confirm coverage threshold is met
- [x] 4.4 Sync the delta specs to main specs (`openspec sync-specs` / apply flow) and archive the change
