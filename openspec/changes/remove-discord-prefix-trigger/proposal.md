# Remove legacy Discord command-prefix trigger

## Why

In Discord guild (non-DM) channels, any message whose content starts with the configured `commandPrefix` (shipped as `"!"` in `config.example.yaml`) triggers a full agent session via `shouldRespondToMessage()` — with no @mention and no command semantics behind it. Slash commands are deliberately cleared in `alignSlashCommands()`, and there is no prefix-command feature anywhere in the codebase: the prefix branch is an unowned legacy trigger from the initial Discord adapter commit (f71d6f3). Because downstream reply-policy and rate-limit gates admit whitelisted accounts regardless of channel, `!anything` in any guild channel the bot can see starts an agent session — a surprise-response and cost/abuse surface in arbitrary public channels.

## What Changes

- **BREAKING** Remove the `commandPrefix` trigger branch from `shouldRespondToMessage()` in `src/platforms/discord/discord-utils.ts`: in guild channels the bot responds ONLY to @mentions; DM behavior (`allowDm`) is unchanged.
- Remove `commandPrefix?: string` from `DiscordAdapterConfig` in `src/platforms/discord/discord-config.ts` (it is not set in `DEFAULT_DISCORD_CONFIG`; no migration path — deployments with `commandPrefix` in their `config.yaml` must delete the key).
- Remove the `commandPrefix` property from the config-object parameter of `shouldRespondToMessage()` and from the call site in `handleMessage()` in `src/platforms/discord/discord-adapter.ts`.
- Remove the `commandPrefix: "!"` line from `config.example.yaml`.
- Delete the obsolete `"shouldRespondToMessage - should respond to prefix"` test in `tests/platforms/discord/discord-adapter.test.ts` and drop the `commandPrefix` property from the remaining call args there; add a regression test asserting a `!`-prefixed non-mention guild message does NOT trigger a response.
- Update the platform-abstraction spec's "Message filtering" scenario wording (drop "command prefix matching") via a delta spec.
- Add a `**BREAKING (semantics)**` bullet under `## [Unreleased] → ### Removed` in `CHANGELOG.md` following the project's existing breaking-removal precedent.

Explicitly NOT touched: `commandPrefixes` in `src/acp/client.ts` (skill auto-approve list — an unrelated concept sharing only the name), the reply-policy layer, the rate-limit layer, Misskey trigger behavior, and mention-removal/DM behavior.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `platform-abstraction`: "Discord Message Processing" requirement — the "Message filtering" scenario drops command-prefix matching; guild triggering becomes mention-only (`respondToMention` + `isBotMentioned`) with DM gating via `allowDm` unchanged.

## Impact

- Code: `src/platforms/discord/discord-utils.ts`, `src/platforms/discord/discord-config.ts`, `src/platforms/discord/discord-adapter.ts`
- Config: `config.example.yaml` (drop `commandPrefix` line); grep confirms no `.env.example`, `helm/`, or `src/types/config.ts` references to the Discord adapter's `commandPrefix`
- Tests: `tests/platforms/discord/discord-adapter.test.ts` (delete prefix test, add non-trigger regression test)
- Specs: `openspec/specs/platform-abstraction/spec.md` "Message filtering" scenario (only main-spec location referencing command prefix matching; the `commandPrefixes` mentions in `acp-integration`/`agent-sandbox-hardening` specs are the unrelated skill auto-approve concept and stay)
- Changelog: `CHANGELOG.md` `## [Unreleased]` `### Removed` section gets the breaking-removal entry
- No API, dependency, or database impact; behavior surface change is strictly "fewer messages trigger the bot".
