## 1. Remove Pioneer Provider Configuration

- [x] 1.1 Remove the `pioneer` provider block (lines 18–45) from `agent-config/opencode.json` and remove the trailing comma from the preceding `openrouter` entry's closing brace (it becomes the last entry; JSON forbids trailing commas)

## 2. Remove Pioneer Env-Var Plumbing

- [x] 2.1 Remove `PIONEER_API_KEY` forwarding block (lines 71–76) from `src/acp/agent-factory.ts`
- [x] 2.2 Remove `"PIONEER_API_KEY"` from the `AGENT_TYPE_ENV.opencode` array in `src/acp/sandbox-manager.ts` (line 38)

## 3. Update Model Identifier Examples in Source

- [x] 3.1 Replace `"pioneer/claude-opus-4-8"` with `"openrouter/deepseek/deepseek-v4-pro"` in the JSDoc comment in `src/types/template.ts` (line 66)

## 4. Remove Pioneer Tests

- [x] 4.1 Remove the entire `PIONEER_API_KEY` forwarding test (lines 229–253) from `tests/acp/agent-factory.test.ts`
- [x] 4.2 Remove `PIONEER_API_KEY` test data and assertions (lines 57, 64, 72, 77) from `tests/acp/sandbox-manager.test.ts`

## 5. Update Configuration Examples

- [x] 5.1 Update `.env.example`: set `AGENT_MODEL` to `openrouter/deepseek/deepseek-v4-pro`, set `SELF_RESEARCH_MODEL` to `openrouter/anthropic/claude-opus-4.8`, remove `PIONEER_API_KEY` lines (66–67)
- [x] 5.2 Update `config.example.yaml`: set `agent.model` to `openrouter/deepseek/deepseek-v4-pro`, remove Pioneer API key comment (line 62)
- [x] 5.3 Update `helm/values.yaml`: set `AGENT_MODEL` to `openrouter/deepseek/deepseek-v4-pro`, set `SELF_RESEARCH_MODEL` to `openrouter/anthropic/claude-opus-4.8`, remove `PIONEER_API_KEY` lines (83–84)

## 6. Update Documentation

- [x] 6.1 Update `AGENTS.md`: remove "Pioneer provider" from supported providers list (line 581), replace `pioneer/claude-opus-4-8` model example with `openrouter/deepseek/deepseek-v4-pro` (line 1252)
- [x] 6.2 Remove Pioneer changelog entry from `CHANGELOG.md` (line 14)
- [x] 6.3 Update `docs/AGENT_PERMISSIONS.md`: remove `PIONEER_API_KEY` from the provider keys table (line 265)
- [x] 6.4 Update `docs/DESIGN.md`: remove the `PIONEER_API_KEY` row from the env var table (line 594)
- [x] 6.5 Update `docs/DEVELOPMENT.md`: replace `pioneer/claude-opus-4-8` model routing example (line 453) with `openrouter/anthropic/claude-opus-4.8`, remove "Pioneer provider" from the provider list (line 569)

## 7. Update Specs

- [x] 7.1 Update `openspec/specs/acp-integration/spec.md`: remove `PIONEER_API_KEY` from the env-var list in Scenario "OpenCode agent configuration" (line 211) and Scenario "Agent-specific environment variables" (line 272)

## 8. Verification

- [x] 8.1 Validate `agent-config/opencode.json` is valid JSON (e.g., `python3 -m json.tool < agent-config/opencode.json > /dev/null`)
- [x] 8.2 Run `deno task test` to confirm all tests pass
- [x] 8.3 Run `deno check src/main.ts` to confirm type safety
- [x] 8.4 Run `deno fmt src/ tests/` and `deno lint src/ tests/` for formatting and linting
- [x] 8.5 Run case-insensitive grep for "pioneer" across the repo (excluding `openspec/changes/archive/` and `tmp/`) to confirm zero remaining references
