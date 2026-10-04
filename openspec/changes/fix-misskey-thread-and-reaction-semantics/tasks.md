## 1. Reply-fetch ordering and error fidelity

- [ ] 1.1 In `src/platforms/misskey/misskey-adapter.ts` `fetchRepliesWithFallback()`, swap the order: `notes/replies` first, `notes/children` as fallback; verify with an adapter test asserting `notes/replies` is called first when both endpoints succeed.
- [ ] 1.2 Add a private `isEndpointUnavailableError(error): boolean` classifying only HTTP 404 / `NO_SUCH_ENDPOINT`-class failures from the Misskey client as fallback-eligible; use it in `fetchRepliesWithFallback()` and `fetchAncestorsWithFallback()` so any other error propagates out of those helpers; verify with tests injecting (a) a 404 → fallback used, (b) a 429, an `INVALID_PARAM`, and a 500 → no second endpoint call and the helper does not return a fake empty list.
- [ ] 1.3 In the `note:` branch of `fetchRecentMessages()`, catch propagated (non-endpoint-missing) helper failures, log a warning with the original error, and assemble the thread from the parts that succeeded; verify with a test where `notes/replies` throws 429 while ancestors and `notes/show` succeed → `fetchRecentMessages` returns the degraded thread and does not throw.

## 2. Note reaction verification

- [ ] 2.1 Extend `ReactionResult` in `src/types/platform.ts` with optional `storedReaction?: string` and `verified?: boolean`; extend the adapter's `MisskeyNote` type with optional `myReaction?: string | null`; verify with `deno task check`.
- [ ] 2.2 In `addReaction()`'s note branch, after `notes/reactions/create` succeeds, call `notes/show` with `{ noteId, myReaction: true }` and compare the bot's stored reaction to the requested emoji: match → `{ success: true, storedReaction }`; mismatch → `{ success: true, storedReaction: <stored> }`; readback throws → `{ success: true, verified: false }`. Verify with tests for all three outcomes.
- [ ] 2.3 In `src/skills/reaction-handler.ts`, when `result.storedReaction` differs from the requested emoji, return skill result data reporting the stored reaction and noting the requested emoji was not applied as such; still call `markReactionSent`. Verify with handler tests for: match (reports requested emoji as today), mismatch (reports stored emoji, reaction marked sent, `success: true`), `verified: false` (reports unconfirmed).

## 3. Emoji reaction-availability metadata

- [ ] 3.1 Add optional `isSensitive`, `localOnly`, `roleIdsThatCanBeUsedThisEmojiAsReaction` fields to `PlatformEmoji`; populate them in `fetchEmojis()` from the `emojis` response (Misskey only; Discord path unchanged). Verify with a `fetchEmojis()` test asserting a sensitive emoji and a role-restricted emoji carry their flags.
- [ ] 3.2 (Implementation-only; no spec delta — context-assembly budgets the emoji section without dictating per-entry rendering.) In the context assembler's available-emoji rendering, annotate entries flagged `isSensitive` or role-restricted so restricted emojis are not presented as universally usable; verify by inspecting the rendered listing for an instance fixture containing a restricted emoji and by the existing context-assembly tests staying green.

## 4. Verification

- [ ] 4.1 Run `deno task check` and the Misskey adapter test suite; verify all pass and no test relies on the old catch-all fallback behavior.
