## 1. Core Types & Agent Factory

- [x] 1.1 Narrow `AgentType` in `src/acp/types.ts` to `"opencode"` and update the `AgentConfig.command` example comment to reference `opencode` only
- [x] 1.2 In `src/acp/agent-factory.ts`, remove the `copilot` and `gemini` `case` blocks from `buildBaseAgentConfig()`; keep only the `opencode` branch plus the `default` throw
- [x] 1.3 In `src/acp/agent-factory.ts`, change `getDefaultAgentType()` to return `"opencode"` and update its doc comment
- [x] 1.4 In `src/acp/agent-factory.ts`, collapse `getRetryPromptStrategy()` to a single `opencode` strategy (`maxRetries: 1`) plus a `default` throw
- [x] 1.5 Confirm `getSessionModeOverride()` remains correct with the narrowed type (OpenCode YOLO → `"yolo"`, else `null`)

## 2. Sandbox, Client & Env Mappings

- [x] 2.1 In `src/acp/sandbox-manager.ts`, remove the `copilot` and `gemini` entries from `AGENT_TYPE_ENV`, keeping the `opencode` entry (retains `GEMINI_API_KEY` as the OpenCode Gemini-provider key)
- [x] 2.2 In `src/acp/client.ts`, update the class/method doc comment that references "GitHub Copilot CLI, Gemini CLI" to describe the OpenCode agent generically
- [x] 2.3 In `src/utils/env.ts`, remove `COPILOT_GITHUB_TOKEN` and the `GITHUB_TOKEN → agent.githubToken` mapping; keep `GEMINI_API_KEY → agent.geminiApiKey`
- [x] 2.4 Verify git-backup/git-credential code (`src/core/git-backup-service.ts`, `src/core/git-credential-setup.ts`) still reads `GITHUB_TOKEN` from the environment directly and is unaffected

## 3. Config Types & Dashboard

- [x] 3.1 In `src/types/config.ts`, remove `copilotGithubToken` and the agent-scoped `githubToken` fields; narrow `defaultAgentType` to `"opencode"`; update the `geminiApiKey` doc comment to "OpenCode Gemini provider API key"
- [x] 3.2 In `src/types/template.ts` and `src/types/context.ts`, update the `agentType` doc comment examples to `"opencode"` only
- [x] 3.3 In `src/dashboard/server.ts`, validate `body.agentType` as a raw string against `"opencode"` BEFORE narrowing to `AgentType` (remove/relocate the unsafe `as AgentType` cast so it does not mask invalid input), returning HTTP 400 for anything other than `"opencode"`
- [x] 3.4 In `src/core/agent-core.ts`, confirm `config.agent.defaultAgentType` usage compiles with the narrowed type

## 4. Container & Agent-Config Assets

- [x] 4.1 In `Containerfile`, remove the `copilot-unpacker` stage, the `COPY ... copilot` step, the `npm install -g @google/gemini-cli` step, the `.gemini/` `install -d` lines, and the Gemini settings/policies `COPY` steps; generalize the `# ... copilot skills discovery` comment
- [x] 4.2 Delete `agent-config/gemini-settings.json` and the `agent-config/gemini-policies/` directory
- [x] 4.3 In `agent-config/opencode.json`, remove the stale `/home/deno/.copilot/skills/**` entry from `external_directory`
- [x] 4.4 Remove `@google/gemini-cli` from `deno.lock` by regenerating the lock (`deno cache --lock=deno.lock src/main.ts`); confirm no `@google/gemini-cli` entries remain

## 5. Configuration Examples & Helm

- [x] 5.1 In `config.example.yaml`, remove `githubToken`, `copilotGithubToken`, and the Copilot/Gemini `defaultAgentType` options; reframe `geminiApiKey` as OpenCode Gemini provider; set example `defaultAgentType` to `opencode`
- [x] 5.2 In `.env.example`, remove `COPILOT_GITHUB_TOKEN`, the `GitHub Token for Copilot` block, and the Gemini CLI framing of `GEMINI_API_KEY` (keep it as OpenCode provider key); change `AGENT_MODEL` and `SELF_RESEARCH_MODEL` examples to OpenCode-provider model identifiers; update the `AGENT_DEFAULT_TYPE` comment to `opencode`
- [x] 5.3 In `helm/values.yaml`, mirror the same changes (`COPILOT_GITHUB_TOKEN`, Copilot token comments, model example values, agent-type comment)

## 6. Documentation

- [x] 6.1 Update `README.md` architecture diagram and binaries list to reference OpenCode only
- [x] 6.2 Update `AGENTS.md` (project overview, architecture diagram, supported agents, agent selection, retry table, YOLO wording, env-var tables, file-layout `agent-config/` listing) to describe OpenCode as the sole agent with no removal/deprecation framing
- [x] 6.3 Update `docs/DESIGN.md` (env-var table, supported agents, Containerfile description, deno cache command) to OpenCode only
- [x] 6.4 Rewrite `docs/AGENT_PERMISSIONS.md` to describe only the OpenCode permission model (remove the Copilot and Gemini per-agent sections, the Gemini Policy Engine / settings.json content, the Copilot `--available-tools`/`--deny-tool` sections, the multi-agent comparison table, and the `.copilot/skills` path references), presenting OpenCode as the only agent
- [x] 6.5 Update `docs/CONTAINER_TOOLS.md` to drop the `copilot` and `@google/gemini-cli`/`gemini` binary rows and the `@google/gemini-cli` mention in the nodejs/npm row
- [x] 6.6 Update `docs/SKILLS_IMPLEMENTATION.md` (intro sentence and architecture diagram) to reference OpenCode CLI only
- [x] 6.7 Update `docs/DEVELOPMENT.md` (prerequisites, env-var tables, model-routing example values, provider notes, `agentType` variable table, `AGENT_DEFAULT_TYPE` comment) to OpenCode only; keep `GEMINI_API_KEY` framed as an OpenCode provider key
- [x] 6.8 In `prompts/system_prompt_override.md` context (referenced by `opencode.json`), confirm it is retained and documented as the OpenCode system-prompt override

## 7. Tests

- [x] 7.1 Delete `tests/acp/gemini-config.test.ts`
- [x] 7.2 Update `tests/acp/agent-factory.test.ts` to remove Copilot/Gemini cases and keep OpenCode config, default-type, and env-inheritance assertions
- [x] 7.3 Update `tests/acp/sandbox-manager.test.ts` to use `opencode` and assert `GEMINI_API_KEY`/`OPENROUTER_API_KEY`/`OPENCODE_API_KEY`/`GOOGLE_GENERATIVE_AI_API_KEY`/`PIONEER_API_KEY` pass-through; remove Copilot/Gemini-specific assertions
- [x] 7.4 Update `tests/acp/agent-connector-env-isolation.test.ts` to drop Copilot/Gemini-specific env expectations
- [x] 7.5 Update `tests/utils/env.test.ts` to use `opencode` for `AGENT_DEFAULT_TYPE`/`defaultAgentType`
- [x] 7.6 Update `tests/dashboard/server.test.ts` to use `opencode` in chat-connect bodies and adjust the invalid-agent-type expectation
- [x] 7.7 Update `tests/core/*` fixtures using `defaultAgentType: "copilot"` (agent-core, session-orchestrator idle-timeout/dry-run/reminder, audit-logger) to `"opencode"`
- [x] 7.8 Update `tests/fixtures/config.test.yaml` (`acp.agent.type: copilot` → `opencode`; drop the Copilot-only `githubToken`) and grep all `tests/**/*.yaml|*.yml` fixtures for residual `copilot`/`gemini`

## 8. Verification

- [x] 8.1 Run `deno fmt src/ tests/`, `deno lint src/ tests/`, and `deno check src/main.ts`
- [x] 8.2 Run `deno test` and confirm all tests pass with coverage ≥ 75%
- [x] 8.3 Verify OpenCode Gemini-provider support is intact: build an OpenCode `AgentConfig` with `GEMINI_API_KEY` set and assert the child env still contains `GEMINI_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY`, and that `SandboxManager` filtering (agent type `opencode`) passes both through
- [x] 8.4 Grep the whole tree — all non-archived `.ts`/`.md`/`.yaml`/`.yml`/`.json` sources, excluding `openspec/changes/archive/` and `CHANGELOG.md` — for `copilot`/`Copilot`/`COPILOT`/`gemini`/`Gemini`/`GEMINI`; confirm each remaining hit is one of the intentional residuals: (a) `GEMINI_API_KEY` / `agent.geminiApiKey` as the OpenCode Gemini-provider key, (b) OpenCode `gemini` provider section name in `opencode.json`, (c) `jim60105/copilot-prompt` third-party skill-repo example, (d) Gemini model identifiers in model-routing examples (e.g. `openrouter/google/gemini-2.5-pro`)
- [x] 8.5 Build the container to confirm the OpenCode-only `Containerfile` produces a working image
