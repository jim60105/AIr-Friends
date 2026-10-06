## Why

`AgentConnector.setSessionModel()` always uses the UNSTABLE `unstable_setSessionModel()` ACP method even when the Agent advertises the stable `category: "model"` Session Config Option, and `setReasoningEffort()` skips a requested `none` whenever the Agent advertises only `off`. A catalog-advertising agent (notably native OMP, whose provider/model IDs must match its own catalog) therefore gets an unstable call instead of the canonical advertised value, a missed model request can silently succeed on an API the catalog already rejected, and a legitimate `none`/`off` alias is lost. Design §10 requires stable-first canonical model selection with an explicit catalog-miss error, cache currency from every source including the `session/load` response, and preserved best-effort reasoning semantics.

## What Changes

- Make model selection stable-first in `AgentConnector.setSessionModel()`: when the session's latest cached config options advertise a `category: "model"` option, flatten its supported option groups, match the requested model ID case-insensitively, and send the canonical advertised value through `session/set_config_option` (reusing the existing connector config-options cache and `setSessionConfigOption` call surface). The `sessionModelIds` record stores the canonical advertised value actually sent.
- **BREAKING (intentional, design §10):** an advertised `category: "model"` catalog that does not contain the requested model is an explicit error thrown from `setSessionModel()` — never a silent fall back to `unstable_setSessionModel()` after a catalog miss, and never a rewritten or invented model ID. Only the ABSENCE of a stable `model`-category option permits the existing unstable-model fallback path unchanged, so OpenCode deployments that do not advertise the stable option behave exactly as today.
- Keep the config-options cache authoritative: refresh it from `newSession`/`set_config_option` responses and `config_option_update` notifications (already required) and additionally from the `session/load` response, so the post-recovery cache is canonical rather than empty.
- Reasoning: prefer the existing canonical exact (case-insensitive) match; additionally map a requested `none` to the advertised `off` value only when the catalog has no exact `none` match (and still no exact `off`, send neither); `default` remains a no-op; unsupported/unavailable reasoning values keep the existing best-effort, non-fatal outcome semantics (`applied`/`unsupported`/`skipped`/`skipped_unavailable`/`failed`) unchanged.
- Recovery: `reconnectAndResumeSession()` consumes the `session/load` response's `configOptions` to restore the session's canonical cache, then reapplies the session's previously set model through the same stable-first logic (explicit error on post-load catalog miss propagates to the existing per-session failure handling) and, when the caller supplies the resolved reasoning effort, reapplies it best-effort via the existing outcome-preserving path. Reconnecting a session whose model is genuinely no longer loadable fails isolated to that session.
- Extract the pure decision logic (catalog flattening, canonical value resolution for model and reasoning values, none→off alias rule) into a small shared module so orchestrator, pool-recovery (rows 10/11) and dashboard consumers share one convention without duplicating matching rules.

## Capabilities

### New Capabilities

None; reuse the existing ACP integration and reasoning-effort capabilities.

### Modified Capabilities

- `acp-integration`: Add stable-first canonical model selection with grouped-catalog flattening, explicit catalog-miss error, unstable fallback gated on stable-option absence, and load-response cache restoration with model/reasoning reapplication on recovery.
- `reasoning-effort-control`: Amend best-effort application so `none` maps to an advertised `off` only when no exact `none` exists; exact canonical match retains priority and all outcome/best-effort semantics are otherwise preserved.

## Impact

Eventual implementation owns amendments to `src/acp/agent-connector.ts` (`setSessionModel`, `setReasoningEffort`, `reconnectAndResumeSession`, cache-refresh wiring), a new pure helper module `src/acp/session-config.ts` (catalog flatten/canonical resolution shared by the connector and later pool-recovery consumers), unit/mock tests in `tests/acp/session-config.test.ts` and `tests/acp/agent-connector.test.ts` (mock ACP connection/fixtures: flat and grouped model catalogs, mixed casing, catalog miss, stable-option absence, none/off/none-and-off thought_level catalogs, load response with and without `configOptions`), an updated AGENTS.md session-model/reasoning-effort section, and one `CHANGELOG.md` entry. Callers (`src/core/session-orchestrator.ts`, `src/dashboard/server.ts`) keep their call signatures; the catalog-miss error surfaces through their existing per-session error handling without orchestrator edits in this change.

No new configuration or environment field is introduced, so `config.example.yaml`, `.env.example` and `helm/values.yaml` remain intentionally unchanged. No ACP SDK upgrade, compatibility shim, migration, or OpenCode default-behavior change: agents that never advertise a `category: "model"` option follow the identical unstable path as today.

Non-goals owned elsewhere: process-pool mode-scoped acquisition and pool/process/state identity (`isolate-omp-process-pools-by-mode`); original-mode/namespace verification, restored gate-context and readiness-gated reconnect wiring for all session types (`restore-mode-owned-acp-sessions` — it consumes this change's cache restoration and reapplication logic); agent type parsing and provider/model selector filtering (`add-omp-agent-configuration`); owned settings overlays (`translate-omp-owned-settings`); factory/launch changes (spawn slice owns factory); the P0 compatibility contracts themselves (`establish-omp-compatibility-contracts` — consumed, not redefined). Combined cross-feature mocked lifecycle regression lands in `cover-omp-mocked-acp-lifecycle`; no native OMP runtime is exercised here.

## Workday Budget

| Eventual implementation activity | Hours |
| --- | ---: |
| Predecessor consumption and boundary confirmation | 0.25 |
| Pure session-config resolution module (flatten, canonical match, none→off alias, catalog-miss verdict) | 1.25 |
| `setSessionModel` stable-first cutover + cache refresh from set responses | 1.25 |
| `setReasoningEffort` exact-match preference + none→off alias, outcomes preserved | 0.75 |
| Load-response cache restoration + model/reasoning reapplication in reconnect | 1.50 |
| Consumer-visible unit/mock tests (mock connection, flat/grouped/mixed-case catalogs, miss, absence, aliases, load) | 1.75 |
| AGENTS.md section update and changelog (no config synchronization needed) | 0.25 |
| Applicable focused type/unit checks and OpenSpec verification, no live agents | 0.50 |
| Contingency for edge-case/review fixes | 0.50 |
| **Total hard ceiling** | **8.00** |

Core is 7.50 hours plus 0.50 hour contingency. No factory, pool, orchestrator-flow, packaging or live-agent work is hidden in this allocation.

## Batch:

depends-on: establish-omp-compatibility-contracts

| Change | Relationship | Code/spec conflict notes |
| --- | --- | --- |
| establish-omp-compatibility-contracts | Application gate | P0 records whether native catalog/model mechanisms are supported at the pin; a recorded incompatibility blocks application, not proposal generation or local mock testing. Consume P0 evidence; do not edit its artifacts or redefine its contracts. |
| isolate-omp-process-pools-by-mode (row 10) | Same-file shared | Both edit `src/acp/agent-connector.ts`. This change owns `setSessionModel`/`setReasoningEffort`/config-options cache and reconnect config restoration; row 10 owns acquisition/mode resolution and pool identity. Serialize connector edits (apply this change first); row 10 must call this change's resolution helpers, never fork them. |
| restore-mode-owned-acp-sessions (row 11) | Required logic owner + same-file shared | Row 11's "model/reasoning through canonical load cache logic" IS this change's load-response restoration and stable-first reapplication; row 11 wires it into same-mode reconnect/load for all session types and gate-context restoration in `agent-connector.ts`/orchestrator. Apply this change first; row 11 extends, not duplicates, `reconnectAndResumeSession` config restoration. |
| add-omp-agent-configuration (row 7) | Independent | Model values resolved by routing/config parsing arrive already as strings; selector filtering is theirs. No shared files. |
| canonicalize-acp-filesystem-roots / secure-acp-filesystem-access / enforce-acp-filesystem-authorization / normalize-acp-destructive-targets (rows 2–5) | Independent siblings | Same P0 predecessor only; no shared files — this change touches connector/reconnect config paths, not `client.ts` permission or filesystem paths. |
| spawn-mode-scoped-omp-agents (row 9) | Independent | Owns `agent-factory.ts`; this change never touches the factory. |
| cover-omp-mocked-acp-lifecycle / finish-omp-mocked-skill-handoff (rows 21–22) | Final regression/docs | Combined lifecycle mocks may reuse this change's mock-catalog fixtures for model/reasoning steps; keep per-path unit cases here without duplicate assertions; final docs pass extends the AGENTS.md section written here. |

Individual rubber-duck review is intentionally skipped under the batch update; the parent reviews all completed proposals together.
