# Design: Remove legacy Discord command-prefix trigger

## Context

`shouldRespondToMessage()` in `src/platforms/discord/discord-utils.ts` gates guild triggering with two independent OR conditions: a bot @mention, or `message.content.startsWith(config.commandPrefix)`. The prefix branch predates the current architecture (initial Discord adapter commit f71d6f3); no prefix-command handling exists anywhere — `alignSlashCommands()` deliberately clears slash commands, and a triggered prefix message simply starts a full agent session. `config.example.yaml` ships `commandPrefix: "!"`, so out-of-the-box deployments respond to any `!`-prefixed guild message from whitelisted accounts (downstream reply-policy/rate-limit gates are account-based and channel-agnostic). The Misskey adapter's equivalent `shouldRespondToMessage()` already has no prefix branch — Discord is the outlier.

## Decision 1: Delete the option — clean cutover, no deprecation shim

**Decided: remove `commandPrefix` entirely** (interface field, function param, call site, config example, spec wording).

Rationale:
- There is no prefix-command feature to preserve — the trigger starts an agent session with no command semantics, so no user-facing behavior is "kept behind a flag"; it is an unowned response bug.
- A deprecated no-op option would keep dead surface (config key, type field, docs) for zero benefit and invite re-adoption.
- Pre-release project convention: no compat layers or migrations.
- Deployments that set `commandPrefix` in their `config.yaml` need no code change: the YAML platform block is passed through into the adapter config object, and an extra key is simply untyped/ignored once the interface field is removed. Removing the line from `config.example.yaml` signals the cleanup; no runtime migration is required.

Rejected alternatives: keep the option defaulted to `""` (dead config surface, the bug was in the config example itself); make the prefix require an accompanying mention (arbitrary new behavior nobody asked for); gate prefix triggering behind a new opt-in flag (same dead-surface problem, plus policy sprawl).

## Decision 2: Scope boundary — Discord trigger site only

Touch only: the prefix branch + `commandPrefix` plumbing in `src/platforms/discord/discord-utils.ts` / `discord-config.ts` / `discord-adapter.ts`, the `config.example.yaml` line, the obsolete prefix test, and the platform-abstraction spec scenario. DM behavior (`allowDm`), mention removal, reply policy, rate limiting, and the unrelated `commandPrefixes` skill auto-approve concept in `src/acp/client.ts` are explicitly untouched — the name collision is coincidental and that subsystem stays byte-identical.

## Decision 3: Regression test replaces the deleted one

Delete `"shouldRespondToMessage - should respond to prefix"` and add a counterpart asserting a `!`-prefixed, non-mention guild message returns `false` — so the removed trigger is pinned off, not just untested.

## Risks / Trade-offs

- **Behavior removal for someone relying on `!`**: accepted — the "feature" was undocumented outside one example-config line, responds without command semantics, and its removal strictly reduces responses (fail-quiet). @mention remains the documented guild affordance.
- **Callers constructing the config object with `commandPrefix`**: only one production caller (`handleMessage`) and one test; both updated in the same change. TypeScript compilation catches stragglers.
