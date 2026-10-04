## Why

Two Misskey API semantics gaps from the static review (`tmp/misskey-api-issue.md`): (1) `note:{noteId}` threads prefer `notes/children`, which on Misskey 2026.10.0 also returns quote renote — broader than "replies" — and the fallback chain catches *all* errors as "endpoint missing", so rate limits, `INVALID_PARAM`, or transient server errors silently degrade to the narrower endpoint or to an empty reply list; (2) `fetchEmojis()` discards reaction-availability metadata (`isSensitive`, `localOnly`, `roleIdsThatCanBeUsedThisEmojiAsReaction`), so a note reaction the server downgrades to a fallback reaction is still reported to the agent as the requested emoji — the API call itself succeeds.

## What Changes

- Reorder the reply-fetch preference for `note:{noteId}` threads: `notes/replies` (direct replies only) first, `notes/children` retained as the fork-compatibility fallback.
- Narrow the fallback trigger: fall through to the next strategy only on endpoint-unavailable/compatibility errors (e.g. HTTP 404 / `NO_SUCH_ENDPOINT`-class failures); rate-limit, `INVALID_PARAM`, and transient (5xx) errors propagate with their original failure information instead of silently degrading.
- Preserve reaction-availability metadata from the `emojis` endpoint on `PlatformEmoji` and verify note reactions after `notes/reactions/create` by reading back `myReaction` via `notes/show`, reporting the reaction the server actually stored rather than blindly echoing the requested emoji. Chat-message reactions (`chat/messages/react`) are unchanged.

## Capabilities

### New Capabilities

（none）

### Modified Capabilities

- `platform-abstraction`: the "Misskey Fallback Chains for Fork Compatibility" requirement changes (replies-first preference, fallback only on endpoint-missing/compat errors); the note-reaction path gains post-send verification semantics, and the emoji listing carries availability metadata.

## Non-goals

- Migrating private conversations to the Misskey Chat API.
- Full server-side availability pre-filtering by cross-checking the bot's roles and the note's `reactionAcceptance` before sending (heavier model; post-send `myReaction` verification is chosen instead — see design).
- The `misskey-js` upgrade and `as any` removal (`upgrade-misskey-js-types`).

## Batch

- depends-on: fix-misskey-api-param-correctness

Code conflicts:
- `src/platforms/misskey/misskey-adapter.ts`: this change edits `fetchRepliesWithFallback()` and `addReaction()`/`fetchEmojis()` — regions disjoint from `fix-misskey-dm-history`'s `dm:` branch of `fetchRecentMessages()`. Both depend on `fix-misskey-api-param-correctness` (limit clamping flows through `fetchRepliesWithFallback`); queue after it. Either order relative to `fix-misskey-dm-history` is safe.
- `upgrade-misskey-js-types` also touches `fetchEmojis()` typing after this change adds metadata fields; queue the upgrade last.
