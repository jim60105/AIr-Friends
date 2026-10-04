## Why

Two Misskey API semantics gaps from the static review (`tmp/misskey-api-issue.md`): (1) `note:{noteId}` threads prefer `notes/children`, which on Misskey 2026.10.0 also returns quote renote — broader than "replies" — and the fallback chain catches *all* errors as "endpoint missing", so rate limits, `INVALID_PARAM`, or transient server errors silently degrade to the narrower endpoint or to an empty reply list; (2) `fetchEmojis()` discards reaction-availability metadata (`isSensitive`, `localOnly`, `roleIdsThatCanBeUsedThisEmojiAsReaction`), so a note reaction the server downgrades to a fallback reaction is still reported to the agent as the requested emoji — the API call itself succeeds.

## What Changes

- Reorder the reply-fetch preference for `note:{noteId}` threads: `notes/replies` (direct replies only) first, `notes/children` retained as the fork-compatibility fallback.
- Narrow the fallback trigger: fall through to the next strategy only on endpoint-unavailable/compatibility errors (e.g. HTTP 404 / `NO_SUCH_ENDPOINT`-class failures); rate-limit, `INVALID_PARAM`, and transient (5xx) errors are no longer swallowed as "endpoint missing" and propagate out of the fetch helpers. To preserve the existing Error Resilience contract (history fetch failures must not crash sessions), note-thread assembly degrades to the parts it successfully fetched and logs the original error, rather than failing the whole `fetchRecentMessages` call.
- Extend `ReactionResult` with optional `storedReaction` and `verified` fields; verify note reactions after `notes/reactions/create` by reading back `myReaction` via `notes/show`. A policy-downgraded reaction stays `success: true` (the POST succeeded) but carries the stored emoji; the `react-message` skill then reports the stored reaction to the agent instead of echoing the requested emoji, still marking the reaction sent so no retry loop fires. Chat-message reactions (`chat/messages/react`) are unchanged.
- Preserve reaction-availability metadata from the `emojis` endpoint on `PlatformEmoji` so restricted emojis are distinguishable; annotating the agent-facing emoji listing itself is implementation-only (the `context-assembly` spec budgets the emoji section but does not dictate per-entry rendering).

## Capabilities

### New Capabilities

（none）

### Modified Capabilities

- `platform-abstraction`: the "Misskey Fallback Chains for Fork Compatibility" requirement changes (replies-first preference, fallback only on endpoint-missing/compat errors); the note-reaction path gains post-send verification semantics, and the emoji listing carries availability metadata.
- `skills-and-reply`: the "Reaction Handling" requirement changes so `react-message` reports the adapter-verified stored reaction instead of echoing the requested emoji.

## Non-goals

- Migrating private conversations to the Misskey Chat API.
- Full server-side availability pre-filtering by cross-checking the bot's roles and the note's `reactionAcceptance` before sending (heavier model; post-send `myReaction` verification is chosen instead — see design).
- The `misskey-js` upgrade and `as any` removal (`upgrade-misskey-js-types`).

## Batch

- depends-on: fix-misskey-api-param-correctness

Code conflicts:
- `src/platforms/misskey/misskey-adapter.ts`: this change edits `fetchRepliesWithFallback()` and `addReaction()`/`fetchEmojis()` — regions disjoint from `fix-misskey-dm-history`'s `dm:` branch of `fetchRecentMessages()`. Both depend on `fix-misskey-api-param-correctness` (limit clamping flows through `fetchRepliesWithFallback`); queue after it. Either order relative to `fix-misskey-dm-history` is safe.
- `upgrade-misskey-js-types` also touches `fetchEmojis()` typing after this change adds metadata fields; queue the upgrade last.
