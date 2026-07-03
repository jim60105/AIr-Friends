## Why

The Pioneer AI provider is no longer used. All model access is routed through OpenRouter, which already supports the same models (DeepSeek, Claude). Keeping Pioneer adds dead configuration, unnecessary env-var plumbing, and confusing documentation for a provider with zero active usage. The project is pre-release with zero users, so no migration or backward compatibility is needed.

## What Changes

- **BREAKING** Remove the `pioneer` provider block from `agent-config/opencode.json`
- **BREAKING** Remove `PIONEER_API_KEY` env-var forwarding from `agent-factory.ts` and `sandbox-manager.ts`
- Remove all Pioneer references from documentation (`AGENTS.md`, `docs/DESIGN.md`, `docs/DEVELOPMENT.md`, `docs/AGENT_PERMISSIONS.md`)
- Remove `PIONEER_API_KEY` from `.env.example` and `helm/values.yaml`
- Update all model identifier examples from `pioneer/claude-opus-4-8` to OpenRouter equivalents:
  - Main/default model: `openrouter/deepseek/deepseek-v4-pro`
  - Self-research/heavy task model: `openrouter/anthropic/claude-opus-4.8`
- Remove Pioneer-specific test cases from `agent-factory.test.ts` and `sandbox-manager.test.ts`
- Update `openspec/specs/acp-integration/spec.md` to remove `PIONEER_API_KEY` from env-var scenarios
- Remove Pioneer changelog entry from `CHANGELOG.md`

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `acp-integration`: Remove `PIONEER_API_KEY` from the env-var forwarding and sandbox allowlist requirements. OpenCode agent configuration scenarios no longer reference Pioneer.

## Impact

- **Configuration**: `agent-config/opencode.json` loses the `pioneer` provider and its `pioneer/auto` model. Users referencing `pioneer/*` models must switch to `openrouter/*` equivalents.
- **Environment**: `PIONEER_API_KEY` is no longer recognized or forwarded. No runtime error if still set — it is simply ignored.
- **Tests**: Pioneer-specific test cases are removed. No new tests needed — existing OpenRouter and Gemini provider tests cover the remaining env-var forwarding logic.
- **Documentation**: All docs, examples, and Helm values use OpenRouter model identifiers exclusively.
