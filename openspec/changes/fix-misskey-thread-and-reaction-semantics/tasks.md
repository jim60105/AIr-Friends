## 1. Reply-fetch ordering and error fidelity

- [ ] 1.1 In `src/platforms/misskey/misskey-adapter.ts` `fetchRepliesWithFallback()`, swap the order: `notes/replies` first, `notes/children` as fallback; verify with an adapter test asserting `notes/replies` is called first when both endpoints succeed.
- [ ] 1.2 Add a private `isEndpointUnavailableError(error): boolean` classifying only HTTP 404 / `NO_SUCH_ENDPOINT`-class failures from the Misskey client as fallback-eligible; use it in `fetchRepliesWithFallback()` and `fetchAncestorsWithFallback()` so any other error propagates unchanged; verify with tests injecting (a) a 404 → fallback used, (b) a 429, an `INVALID_PARAM`, and a 500 → original error propagates, no second endpoint call.

## 2. Note reaction verification

- [ ] 2.1 Extend the adapter's `MisskeyNote` type with optional `myReaction?: string | null` and pass `{ noteId, myReaction: true }` where needed for readback; verify with `deno task check`.
- [ ] 2.2 In `addReaction()`'s note branch, after `notes/reactions/create` succeeds, call `notes/show` for the note and compare the bot's stored reaction to the requested emoji; on mismatch return a result reporting the stored reaction (not a false success for the requested emoji); on readback failure return a success flagged as unverified. Verify with tests for: stored == requested, stored != requested (fallback reaction), readback throws.

## 3. Emoji reaction-availability metadata

- [ ] 3.1 Add optional `isSensitive`, `localOnly`, `roleIdsThatCanBeUsedThisEmojiAsReaction` fields to `PlatformEmoji`; populate them in `fetchEmojis()` from the `emojis` response (Misskey only; Discord path unchanged). Verify with a `fetchEmojis()` test asserting a sensitive emoji and a role-restricted emoji carry their flags.
- [ ] 3.2 Surface the restriction in the emoji list text exposed to the agent (e.g. available-reaction listing annotation) so restricted emojis are not presented as universally usable; verify by inspecting the rendered listing for an instance fixture containing a restricted emoji.

## 4. Verification

- [ ] 4.1 Run `deno task check` and the Misskey adapter test suite; verify all pass and no test relies on the old catch-all fallback behavior.
