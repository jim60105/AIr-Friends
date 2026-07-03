## Context

The project supports multiple OpenCode providers via `agent-config/opencode.json`: OpenRouter, Gemini, and Pioneer. Pioneer is an OpenAI-compatible endpoint at `api.pioneer.ai/v1` that provides Claude and DeepSeek models. However, the same models are available through OpenRouter, which is already configured and actively used. Pioneer has zero active usage and keeping it adds unnecessary configuration surface, env-var plumbing, and documentation noise. The project is pre-release with zero users, so no migration burden exists.

The Pioneer provider touches three runtime layers:
1. **Provider config** — `agent-config/opencode.json` defines the `pioneer` provider and its models
2. **Env-var forwarding** — `agent-factory.ts` reads `PIONEER_API_KEY` from the host env and inserts it into the agent subprocess env; `sandbox-manager.ts` allowlists it through the sandbox filter
3. **Documentation & examples** — `.env.example`, `config.example.yaml`, `helm/values.yaml`, `AGENTS.md`, and several docs files reference Pioneer models or `PIONEER_API_KEY`

## Goals / Non-Goals

**Goals:**
- Remove all Pioneer provider configuration from `opencode.json`
- Remove `PIONEER_API_KEY` from env-var forwarding and sandbox allowlists
- Replace all `pioneer/*` model identifier examples with OpenRouter equivalents
- Update specs to reflect the new env-var set
- Leave no trace of Pioneer in code, tests, docs, or config

**Non-Goals:**
- Changing the OpenRouter or Gemini provider configuration
- Modifying model routing logic or session orchestration
- Altering the ACP client/agent protocol itself

## Decisions

### D1: Model replacement strategy

Replace all `pioneer/claude-opus-4-8` references with the appropriate OpenRouter model based on usage context:

| Context | Old model | New model |
|---------|-----------|-----------|
| Default / main `AGENT_MODEL` | `pioneer/claude-opus-4-8` | `openrouter/deepseek/deepseek-v4-pro` |
| Self-research `SELF_RESEARCH_MODEL` | `pioneer/claude-opus-4-8` | `openrouter/anthropic/claude-opus-4.8` |
| JSDoc/comment examples | `pioneer/claude-opus-4-8` | `openrouter/deepseek/deepseek-v4-pro` |
| Doc routing examples (self-research) | `pioneer/claude-opus-4-8` | `openrouter/anthropic/claude-opus-4.8` |

**Rationale**: DeepSeek V4 Pro is cost-effective for routine tasks; Claude Opus 4.8 via OpenRouter is reserved for heavy/research tasks. This mirrors the user's explicit request.

### D2: Pure deletion of Pioneer code — no feature flags or fallbacks

Delete the pioneer provider block, env-var forwarding code, and sandbox allowlist entry outright. No deprecation warnings, no feature flags.

**Rationale**: Pre-release project with zero users. The provider has never been relied on in production.

### D3: Changelog entry handling

Remove the Pioneer changelog entry entirely rather than adding a "Removed" entry, since the goal is to act as if Pioneer never existed.

**Rationale**: User request to act as if Pioneer was never part of the project.

### D4: Archive openspec design docs are not edited

Archived openspec change design docs (`openspec/changes/archive/`) that mention Pioneer will NOT be edited. These are historical records of past decisions and editing them would be revisionist.

**Rationale**: Archive documents serve as an audit trail. The living specs and docs will be updated, which is sufficient.

## Risks / Trade-offs

- **[Someone sets PIONEER_API_KEY]** → Harmless. The env var is ignored since no code reads it. No error, no warning.
- **[Archive docs still mention Pioneer]** → Acceptable. They are snapshots of past decisions, not active documentation.
- **[opencode.json comma hygiene]** → Removing the last provider entry (`pioneer`) requires fixing the trailing comma on the preceding `openrouter` entry. Standard JSON editing concern.
