## Why

Maintaining three ACP agent integrations (GitHub Copilot CLI, Gemini CLI, OpenCode CLI) triples the surface area for agent-specific launch flags, authentication tokens, container binaries, permission-enforcement layers, and tests — while only OpenCode is actually needed. Consolidating on OpenCode as the single supported ACP agent removes dead configuration paths, shrinks the container image, and collapses the security and test matrix to one well-understood agent. The project is pre-release with zero users, so no migration path is required.

## What Changes

- **BREAKING** OpenCode becomes the **only** supported ACP agent type. `AgentType` is narrowed to `"opencode"`.
- Remove the `copilot` and `gemini` branches from agent configuration, sandbox env filtering, retry-strategy selection, and the dashboard chat agent-type validation.
- `getDefaultAgentType()` returns `"opencode"`; `defaultAgentType` config accepts only `"opencode"`.
- Remove Copilot/Gemini authentication config and env: `agent.copilotGithubToken` / `COPILOT_GITHUB_TOKEN`, `agent.githubToken` (agent-scoped) / the `GITHUB_TOKEN → agent.githubToken` mapping, and reframe `agent.geminiApiKey` / `GEMINI_API_KEY` as the OpenCode **Gemini provider** key only (not a CLI agent credential).
- Remove Copilot/Gemini container plumbing from `Containerfile`: the `copilot-unpacker` stage, the `@google/gemini-cli` npm install, the `.gemini/` directory setup, and the Gemini settings/policies COPY steps.
- Delete Copilot/Gemini agent-config assets: `agent-config/gemini-settings.json`, `agent-config/gemini-policies/`, and the `GEMINI_SYSTEM_MD` prompt-override wiring specific to Gemini CLI.
- Remove `@google/gemini-cli` from `deno.lock` (and any Deno cache/prewarm referencing it).
- Update all documentation (`README.md`, `AGENTS.md`, `docs/DESIGN.md`, `docs/AGENT_PERMISSIONS.md`, `docs/CONTAINER_TOOLS.md`, `docs/SKILLS_IMPLEMENTATION.md`, `docs/DEVELOPMENT.md`, `config.example.yaml`, `.env.example`, `helm/values.yaml`) and tests to describe OpenCode as the sole agent, written as if Copilot/Gemini were never supported (no "removed"/"deprecated" framing).

## Capabilities

### New Capabilities
<!-- None. This change removes and narrows existing behavior only. -->

### Modified Capabilities
- `acp-integration`: Supported agent types narrowed to `opencode` only; Copilot/Gemini agent-configuration, sandbox agent-type env, default-agent, YOLO-mode-switch, and retry-strategy scenarios collapse to OpenCode.
- `configuration-and-deployment`: Container build stages, bundled binaries, agent-config assets, and agent-authentication configuration reduced to OpenCode only.
- `session-audit-log`: `session_start` audit example uses `agentType: "opencode"`.
- `web-dashboard-chat`: Chat connect agent-type validation accepts only `opencode`.
- `prompt-template-system`: The `agentType` template variable documents `"opencode"` as the only value.

## Impact

- **Code**: `src/acp/agent-factory.ts`, `src/acp/sandbox-manager.ts`, `src/acp/types.ts`, `src/acp/client.ts`, `src/types/config.ts`, `src/types/template.ts`, `src/types/context.ts`, `src/utils/env.ts`, `src/dashboard/server.ts`, `src/core/agent-core.ts`.
- **Config/assets**: `Containerfile`, `deno.lock`, `agent-config/gemini-settings.json`, `agent-config/gemini-policies/`, `agent-config/opencode.json` (drop the stale `.copilot/skills` external-directory allow entry), `config.example.yaml`, `.env.example`, `helm/values.yaml`, `prompts/system_prompt_override.md` (Gemini-specific override note).
- **Docs**: `README.md`, `AGENTS.md`, `docs/DESIGN.md`, `docs/AGENT_PERMISSIONS.md`, `docs/CONTAINER_TOOLS.md`, `docs/SKILLS_IMPLEMENTATION.md`, `docs/DEVELOPMENT.md`.
- **Tests**: `tests/acp/agent-factory.test.ts`, `tests/acp/sandbox-manager.test.ts`, `tests/acp/gemini-config.test.ts` (delete), `tests/acp/agent-connector-env-isolation.test.ts`, `tests/utils/env.test.ts`, `tests/fixtures/config.test.yaml`, `tests/core/*` fixtures using `defaultAgentType: "copilot"`, `tests/dashboard/server.test.ts`.
- **Dependencies**: Drops `@google/gemini-cli` npm dependency and the Copilot CLI binary download.
