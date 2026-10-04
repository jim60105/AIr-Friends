## 1. DM history rewrite

- [x] 1.1 In `src/platforms/misskey/misskey-adapter.ts` `fetchRecentMessages()`, rewrite the `dm:{userId}` branch: keep `notes/mentions` but filter strictly `note.userId === userId` (remove the `|| note.replyId` condition), and add a second `users/notes` call with `userId: this.botId`, `withReplies: true`, and the normalized limit. Verify by reading the diff: no `replyId` condition remains in the `dm:` branch.
- [x] 1.2 Filter the `users/notes` results client-side to `visibility === "specified"` and `visibleUserIds?.includes(userId)`. Verify with an adapter unit test using a stubbed client that returns mixed notes (specified to target user, specified to another user, public, follows-only).
- [x] 1.3 Merge incoming and outgoing notes, deduplicate by note ID, sort ascending by `createdAt`, and return the most recent `limit` entries mapped through `noteToPlatformMessage`. Verify with a unit test covering interleaved timestamps, a note present in both sources, and total count > limit.

## 2. Regression coverage

- [x] 2.1 Add a unit test asserting a `notes/mentions` note from a third user that mentions the bot (has `replyId`) is excluded from `dm:{userId}` history.
- [x] 2.2 Add a unit test asserting the bot's own specified-visibility reply to the target user IS present in merged history with `isBot: true`.

## 3. Verification

- [x] 3.1 Run `deno task check` and the Misskey adapter test suite; verify all pass.
