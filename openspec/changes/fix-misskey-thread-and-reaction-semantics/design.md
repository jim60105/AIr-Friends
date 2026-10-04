## Context

See proposal.md - Why. Today `fetchRepliesWithFallback()` tries `notes/children` then `notes/replies` and swallows every error (`catch {}`), and `addReaction()` returns `{ success: true }` immediately after `notes/reactions/create` succeeds — but Misskey's `ReactionService` can accept the call and store a fallback reaction when policy (sensitive emoji, role restrictions, `reactionAcceptance`) rejects the specific emoji. `fetchEmojis()` currently maps only `name/category/aliases/url` onto `PlatformEmoji`.

## Goals / Non-Goals

- Goals: thread history contains direct replies (product semantics per review item 4); error fidelity in the fallback chain; truthful reaction reporting; reaction-availability metadata visible to the agent.
- Non-Goals: pre-send role/`reactionAcceptance` evaluation (would require fetching bot roles + target note before every reaction — the post-send `myReaction` readback gives truth with one extra call); chat reaction changes.

## Decisions

**D1: Replies-first ordering.** `notes/replies` first, `notes/children` fallback. Review item 4 asks the product decision explicitly; the chosen semantics is "discussion thread = direct replies", matching how `buildReplyParams` threads replies. Quote renotes remain reachable via the `main` stream/mentions if ever needed. Alternative kept: children-first — rejected because it admits quote renotes into the recent-conversation context, which the review flags as unintended.

**D2: Classify fallback-eligible errors, degrade the assembly.** A helper `isEndpointUnavailableError(error)` returns true only for HTTP 404 / `NO_SUCH_ENDPOINT`-shaped failures from `MisskeyClient.request()` (misskey-js surfaces server errors as `ApiError` carrying `status` and body `error.code`). Everything else propagates out of the fetch helpers. Applies to both reply and ancestor chains; the ancestor chain's `notes/conversation` → `replyId`-walk fallback gets the same gate. Because the propagation would otherwise abort the whole `fetchRecentMessages` call — and `context-assembler` does not try-wrap the recent-messages fetch, so a propagated 429/5xx would fail the entire triggered session (violating the Error Resilience spec) — the `note:` branch wraps each helper's propagation in a warning log and assembles the thread from the parts that succeeded. Truth is preserved at helper level (no silent "endpoint missing" misclassification, no fake empty list); resilience is preserved at assembly level. Alternative: propagate all the way (rejected: changes session-level failure behavior beyond this change's scope); keep catch-all (rejected per review item 4).

**D3: Post-send verification over pre-send policy evaluation, with an explicit result contract.** After `notes/reactions/create` returns, call `notes/show` with `{ noteId, myReaction: true }` and compare the bot's stored reaction to the requested emoji. `ReactionResult` (src/types/platform.ts) gains optional `storedReaction?: string` and `verified?: boolean`; the adapter's `MisskeyNote` type gains `myReaction?: string | null`. Downgrade semantics: the POST succeeded, so `success` stays `true` — flipping it would make `reaction-handler.ts` skip `markReactionSent` and fire the missing-reply retry, causing the agent to react again despite a reaction already existing. Truth: when `storedReaction` ≠ requested, `react-message` reports the stored emoji (skills-and-reply delta), and when the readback itself fails, `verified: false` marks the outcome unconfirmed. Pre-send evaluation rejected: needs `i`-account role data caching and per-note `reactionAcceptance` fetch — a second, drift-prone reimplementation of server policy.

**D4: Metadata on `PlatformEmoji`.** Extend the shared `PlatformEmoji` shape with optional `isSensitive?: boolean`, `localOnly?: boolean`, `roleIdsThatCanBeUsedThisEmojiAsReaction?: string[]`, populated only by Misskey (Discord leaves them undefined). Availability of the optional fields keeps the Discord adapter untouched.

## Risks / Trade-offs

- [Extra `notes/show` per note reaction adds latency/rate-budget] → Reactions are at most one per session (reply-policy quota); negligible.
- [Strict error classification may misread a fork's nonstandard "no such endpoint" body] → Treat any 404 as endpoint-missing regardless of body; body-code matching only widens the eligible set on the same status.
- [`myReaction` readback races a concurrent edit] → Readback is best-effort truth at verification time; mismatch is reported, never hidden.

## Migration Plan

Code-only; no data/config migration. Rollback = revert commit.

## Open Questions

（none — the thread-semantics product decision is resolved toward direct-replies in D1, matching review item 4's recommended default.)
