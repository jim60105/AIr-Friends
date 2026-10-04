## Context

See proposal.md - Why. Constraint from Misskey semantics: a note the bot sends with `visibility: "specified"` and `visibleUserIds: [otherUser]` appears in *that user's* mention/visible queries but not in the bot's own `notes/mentions`, because the bot is the author, not a recipient. The only reliable way to enumerate the bot's own replies to a given user is the bot's own note timeline (`users/notes` with `withReplies: true`, since DM replies are themselves replies) filtered client-side on `visibility === "specified" && visibleUserIds.includes(userId)`.

## Goals / Non-Goals

- Goals: symmetric recent history for `dm:` channels; strict per-user filtering; deterministic merged ordering.
- Non-Goals: unbounded pagination (the merged fetch takes at most `limit` from each source, consistent with existing single-source behavior); Chat-API migration.

## Decisions

**D1: Two bounded queries, merge client-side.** Fetch up to `limit` from `notes/mentions` and up to `limit` from `users/notes`, merge, dedupe by note ID, sort by `createdAt`, keep the most recent `limit` (matching the `note:` branch's `slice(-limit)` convention). Alternative — paginate `users/notes` until `limit` matching outgoing notes are found — rejected: unbounded request amplification for marginal completeness; both sources skew newest-first anyway.

**D2: Client-side visibility filter, not a `users/notes` visibility parameter.** `users/notes` has no server filter for "specified notes visible to user X", so filtering on the response fields (`visibility`, `visibleUserIds`) is the only correct option on official Misskey. Requires the response to include `visibleUserIds`; the adapter already receives full note objects for DM-relevant notes (endpoint returns `Note` with these fields populated for authenticated self-queries).

**D3: Reuse `noteToPlatformMessage(note, this.botId!)` for both sources** — it already marks the bot's own notes with `isBot: true` via the botId argument, so merged history renders correctly without new mapping code.

## Risks / Trade-offs

- [Recent history may be truncated unevenly if one side dominates the mention/timeline queries] → Acceptable: same `limit`-window trade-off already exists for single-source channels; documented in task tests.
- [`visibleUserIds` absent on some forks → outgoing side silently empty] → Merge degrades to current incoming-only behavior plus the fixed filter, which is still an improvement; no crash.
- [Outgoing filter may also include the bot's specified-visibility notes to that user that are not replies] → Intended per the review's recommendation (doc item 3): any specified note visible to the peer belongs in the shared context.

## Migration Plan

Code-only change inside `fetchRecentMessages()`; no data migration. Rollback = revert commit.

## Open Questions

（none）
