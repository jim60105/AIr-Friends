## Why

The Misskey static review (`tmp/misskey-api-issue.md`) found that `dm:{userId}` recent-history reconstruction is semantically wrong on two counts: `notes/mentions` only returns notes where the *bot account* is mentioned or in `visibleUserIds`, so the bot's own specified-visibility replies to the user are missing from history; and the filter `note.userId === userId || note.replyId` admits any reply that mentions the bot, leaking other users' notes into a one-to-one DM context. Agents therefore see asymmetric, sometimes contaminated conversation context for specified-note DMs.

## What Changes

- Rewrite the `dm:{userId}` branch of `MisskeyAdapter.fetchRecentMessages()` to build bidirectional history from two sources:
  - incoming: `notes/mentions` filtered strictly to `note.userId === userId` (drop the `note.replyId` condition),
  - outgoing: the bot's own notes from `users/notes` with `withReplies: true`, filtered to `visibility === "specified"` and `visibleUserIds` containing `userId`.
- Merge, deduplicate by note ID, and sort the combined history chronologically, applying the requested limit to the merged result.
- Both source calls respect the `1..100` limit normalization introduced by `fix-misskey-api-param-correctness`.

## Capabilities

### New Capabilities

（none）

### Modified Capabilities

- `platform-abstraction`: the `dm:{userId}` scenario under "Misskey Note Channel Types" changes from "mentions filtered to the specified user" to merged incoming/outgoing bidirectional history with strict user filtering.

## Non-goals

- Migrating private conversations to the Misskey Chat API (the review lists this as an optional product-level direction, out of scope).
- Changing `chat:{userId}` behavior, which already has proper bidirectional timelines.

## Batch

- depends-on: fix-misskey-api-param-correctness

Code conflicts:
- `src/platforms/misskey/misskey-adapter.ts` `fetchRecentMessages()`: this change rewrites the `dm:` branch and adds a second `users/notes` call. `fix-misskey-api-param-correctness` must land first (it renames `includeReplies` and introduces the `normalizeLimit` helper this change's outgoing-fetch call site relies on). `fix-misskey-thread-and-reaction-semantics` touches `fetchRepliesWithFallback()` in the same file but a disjoint region; either order works after the foundation change, though queuing after it avoids rebase noise.
