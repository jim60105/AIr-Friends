## Context

AIr-Friends acts as an ACP Client that spawns an external CLI agent as a subprocess. The codebase currently branches across three agent types (`copilot`, `gemini`, `opencode`) in `createAgentConfig()`, `SandboxManager`, `getRetryPromptStrategy()`, `getSessionModeOverride()`, and the dashboard chat endpoint. Each agent carries its own authentication tokens, launch flags, container binaries, and config assets (Copilot `--deny-tool` flags, Gemini `settings.json` + Policy Engine TOML, `GEMINI_SYSTEM_MD` prompt override).

In practice only OpenCode is used. OpenCode is the pre-configured default in the container, has a mature restricted/YOLO permission model in `agent-config/opencode.json`, and supports multiple upstream providers (Pioneer, OpenRouter, and a Gemini provider) through a single `opencode acp` invocation. The project is pre-release with zero users, so behavior can be narrowed without any migration or backward-compatibility layer.

An important subtlety: `GEMINI_API_KEY` has two distinct historical roles — (1) the Gemini CLI agent credential, and (2) the API key for OpenCode's **Gemini provider**. Only role (1) is being removed. Role (2) stays because OpenCode can still route to Gemini models via its provider config (`agent-config/opencode.json` references `{env:GEMINI_API_KEY}`).

## Goals / Non-Goals

**Goals:**

- Make `opencode` the single `AgentType` throughout code, config, container, docs, and tests.
- Remove all Copilot- and Gemini-CLI-specific code branches, tokens, flags, container stages, config assets, and dependencies.
- Preserve OpenCode's Gemini/OpenRouter/Pioneer provider support (including `GEMINI_API_KEY` as a provider key).
- Present the codebase and docs as if only OpenCode was ever supported — no "removed"/"deprecated"/"formerly" framing in code or documentation.

**Non-Goals:**

- Changing OpenCode's restricted/YOLO permission model or `opencode.json` permission rules (beyond removing the stale `.copilot/skills` external-directory allow entry).
- Altering the git-backup/git-credential flow, which uses `GITHUB_TOKEN` independently of any agent. (`GITHUB_TOKEN` as a Copilot agent credential is removed; `GITHUB_TOKEN` for git backup remains.)
- Rewriting historical archived OpenSpec changes under `openspec/changes/archive/` (immutable history) or the `CHANGELOG.md` (append-only release history).

## Decisions

### Decision: Narrow `AgentType` to a single literal `"opencode"`

Change `type AgentType = "copilot" | "gemini" | "opencode"` to `type AgentType = "opencode"` in `src/acp/types.ts`. This makes the type system enforce the removal: every remaining reference to `"copilot"`/`"gemini"` becomes a compile error, giving a checklist of edit sites via `deno check`.

- **Alternative considered**: Keep the union and validate at runtime. Rejected — leaves dead branches and weakens the type guarantee.

Downstream:
- `createAgentConfig()` drops the `copilot` and `gemini` `case` blocks; the `switch` collapses to the `opencode` path (kept as a guarded function that throws for any non-opencode input to satisfy the `default` branch and future-proofing).
- `getRetryPromptStrategy()` collapses to a single OpenCode strategy (`maxRetries: 1`).
- `getSessionModeOverride()` keeps only the OpenCode YOLO switch logic.
- `getDefaultAgentType()` returns `"opencode"`.

### Decision: `GEMINI_API_KEY` reframed as OpenCode Gemini-provider key, not removed

Keep `agent.geminiApiKey` / `GEMINI_API_KEY` in `ENV_MAPPINGS`, `SandboxManager` `AGENT_TYPE_ENV.opencode`, and the OpenCode branch of `createAgentConfig()`. Remove it from any Gemini-CLI agent context. Documentation describes it purely as "OpenCode Gemini provider API key".

- **Alternative considered**: Remove `GEMINI_API_KEY` entirely. Rejected — it would break OpenCode's Gemini provider routing, which is a legitimate supported provider.

### Decision: Remove Copilot/Gemini authentication config surface

- Remove `agent.copilotGithubToken` and `COPILOT_GITHUB_TOKEN` (config field + `ENV_MAPPINGS` + `SandboxManager`).
- Remove the agent-scoped `agent.githubToken` field and the `GITHUB_TOKEN → agent.githubToken` `ENV_MAPPINGS` entry, since its only consumer was the Copilot agent branch. `GITHUB_TOKEN` continues to be read directly from the environment by the git-backup/git-credential subsystem (`src/core/git-backup-service.ts`, `src/core/git-credential-setup.ts`), which is independent of agent config.
- Remove `GEMINI_SYSTEM_MD` wiring (Gemini-CLI-only). OpenCode's system prompt is supplied via `opencode.json` (`{file:/app/prompts/system_prompt_override.md}`), so `prompts/system_prompt_override.md` is retained and its role documented as the OpenCode override.

### Decision: Container reduced to OpenCode-only

Remove from `Containerfile`: the `copilot-unpacker` stage, the `COPY ... copilot` step, the `npm install -g @google/gemini-cli` step, the `.gemini/` directory `install -d` lines, and the Gemini settings/policies `COPY` steps. Update the `# Set HOME environment variable for copilot skills discovery` comment to reference agent skills discovery generically. Delete `agent-config/gemini-settings.json` and `agent-config/gemini-policies/`. Drop `@google/gemini-cli` from `deno.lock`.

### Decision: Documentation rewritten as OpenCode-only from origin

`README.md`, `AGENTS.md`, `docs/DESIGN.md`, `config.example.yaml`, `.env.example`, and `helm/values.yaml` are edited so OpenCode is the only agent ever described. No transitional language. Multi-agent tables (retry strategy, supported agents, agent selection) collapse to single OpenCode rows or are removed where they add no value. `AGENT_MODEL` / `SELF_RESEARCH_MODEL` example values that use `github-copilot/...` are changed to OpenCode-provider model identifiers (e.g. `pioneer/claude-opus-4-8`).

### Decision: Tests updated in place; delete Gemini-only test file

- Delete `tests/acp/gemini-config.test.ts` (tests deleted assets).
- Update `tests/acp/agent-factory.test.ts`, `tests/acp/sandbox-manager.test.ts`, `tests/acp/agent-connector-env-isolation.test.ts`, `tests/utils/env.test.ts`, `tests/dashboard/server.test.ts`, and `tests/core/*` fixtures to use `opencode` exclusively and drop Copilot/Gemini assertions.
- Keep coverage ≥ 75%; the removed branches also remove their test burden, so net coverage should hold.

## Risks / Trade-offs

- **[Losing user optionality — can no longer pick Copilot/Gemini CLI]** → Accepted: pre-release, OpenCode is the intended agent and covers Gemini via its provider. Reversible from git history if ever needed.
- **[Accidentally removing `GEMINI_API_KEY` provider support while removing the Gemini CLI]** → Mitigation: explicit decision to retain it in the OpenCode env path, sandbox allowlist, and `ENV_MAPPINGS`; a sandbox test asserts `GEMINI_API_KEY` passes through for `opencode`.
- **[Breaking git backup by conflating `GITHUB_TOKEN` roles]** → Mitigation: only the `GITHUB_TOKEN → agent.githubToken` mapping and Copilot consumption are removed; git-backup/credential code reads `GITHUB_TOKEN` from env directly and is untouched. Verified via existing git-backup tests.
- **[`deno.lock` edit drift]** → Mitigation: regenerate the lock via `deno cache --lock=deno.lock src/main.ts` (or `deno install`) after removing the dependency rather than hand-editing, then confirm no `@google/gemini-cli` entries remain.
- **[Stale references left behind]** → Mitigation: after edits, grep the whole tree (excluding `openspec/changes/archive/` and `CHANGELOG.md`) for `copilot`/`gemini`/`COPILOT`/`GEMINI` and confirm every remaining hit is either the retained OpenCode Gemini-provider key or the `jim60105/copilot-prompt` external-skill repo example (a third-party repo name, not the Copilot agent).

## Migration Plan

No runtime migration required (zero users, pre-release). Deployment steps:

1. Apply code, type, config, container, and doc edits.
2. Regenerate `deno.lock`.
3. Run `deno fmt`, `deno lint`, `deno check src/main.ts`, `deno test` and confirm coverage ≥ 75%.
4. Build the container to confirm the reduced `Containerfile` produces a working OpenCode-only image.

Rollback: revert the change commit; no data or schema changes are involved.

## Open Questions

- None. `jim60105/copilot-prompt` in `externalSkills` examples is a third-party skill repository name (not the Copilot CLI agent) and is intentionally retained.
