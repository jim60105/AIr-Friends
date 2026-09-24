## 1. Remove the prefix trigger from the Discord adapter

- [x] 1.1 In `src/platforms/discord/discord-utils.ts`, delete the "Check prefix" branch (`if (config.commandPrefix && message.content.startsWith(config.commandPrefix)) return true;`) from `shouldRespondToMessage()` and remove `commandPrefix?: string` from its config-object parameter type. Verify: guild triggering flows only through the `respondToMention` + `isBotMentioned` branch; DM branch untouched.
- [x] 1.2 In `src/platforms/discord/discord-adapter.ts` `handleMessage()`, remove the `commandPrefix: this.config.commandPrefix` property from the `shouldRespondToMessage()` call (do this BEFORE deleting the interface field so no `this.config.commandPrefix` read is left dangling). Verify: `deno check` passes with no remaining references in the adapter.
- [x] 1.3 In `src/platforms/discord/discord-config.ts`, delete the `commandPrefix?: string` field (and its doc comment) from `DiscordAdapterConfig`. Verify: `DEFAULT_DISCORD_CONFIG` never set it; `Required<DiscordAdapterConfig>` is an `as` cast over the defaults spread in the constructor, so removing the optional field cannot break it.

## 2. Remove config-example surface

- [x] 2.1 In `config.example.yaml`, delete the `commandPrefix: "!" # Optional command prefix (set empty to disable)` line from the `platforms.discord` block. Verify: the block still parses (comment alignment of neighboring keys unchanged).
- [x] 2.2 Grep the repo (`gitignore: false` for `.env*`) for `commandPrefix` / `COMMAND_PREFIX` outside `src/acp/`, `docs/SKILLS_IMPLEMENTATION.md`, the acp tests, `coverage/`, `CHANGELOG.md` history, and `openspec/changes/archive/`, confirming no remaining references to the Discord adapter's prefix (expected hits ONLY: `commandPrefixes` in `src/acp/client.ts` — the unrelated skill auto-approve concept, MUST NOT be touched — plus its tests/docs, historical CHANGELOG entries, and archived specs). Verify: the only live hits are the skill auto-approve `commandPrefixes`.

## 3. Tests

- [x] 3.1 In `tests/platforms/discord/discord-adapter.test.ts`, delete the `"shouldRespondToMessage - should respond to prefix"` test entirely (do not re-pin it). Verify: no remaining test in that file passes `commandPrefix` in the config object (other `shouldRespondToMessage` tests already pass only `{ allowDm, respondToMention }`).
- [x] 3.2 Add a regression test `"shouldRespondToMessage - should not respond to prefix-prefixed guild message even with a legacy commandPrefix config"`: mock a non-DM message with `content: "!help me"` and no bot mention, and call `shouldRespondToMessage(message as Message, "bot123", { allowDm: true, respondToMention: true, commandPrefix: "!" } as unknown as Parameters<typeof shouldRespondToMessage>[2])` — the cast keeps the stale key legal after 1.1 (excess-property checks would otherwise reject the object literal) so the test provably pins the removed branch rather than an undefined-prefix no-op; `as unknown as` also satisfies the file's existing `as any`-heavy convention. Assert `false`. Verify: `deno test tests/platforms/discord/discord-adapter.test.ts` passes; confirm that against the PRE-fix code this exact call returned `true` (prefix present ⇒ branch fired), so the test fails before 1.1 and passes after.
- [x] 3.3 Run `deno check`, `deno lint`, `deno fmt --check`, and the Discord test file; all green.

## 4. Changelog

- [x] 4.1 Under `## [Unreleased]` in `CHANGELOG.md`, add a bullet to the `### Removed` section following the existing `**BREAKING (semantics)**` precedent: record the removal of the legacy Discord `commandPrefix` (`!`) guild message trigger and note that operators must delete the `commandPrefix` key from their `config.yaml` (the key is no longer read). Verify: bullet sits under `Removed` in the Unreleased section; no version heading touched.

## 5. Spec sync

- [x] 5.1 Confirm `openspec/specs/platform-abstraction/spec.md` "Message filtering" scenario is the only main-spec text referencing Discord command-prefix matching (grep `command prefix` in `openspec/specs/`; the `commandPrefixes` hits in `acp-integration` and `agent-sandbox-hardening` specs are the unrelated skill concept). Verify: grep output shows no other live main-spec prefix-trigger wording.
- [x] 5.2 Leave archiving/sync of the delta spec to the apply/archive phase (do not hand-edit the main spec here). Verify: `openspec validate remove-discord-prefix-trigger --strict` passes for the change.
