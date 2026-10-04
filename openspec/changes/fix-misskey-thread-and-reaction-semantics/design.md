## Context

See proposal.md - Why. Today `fetchRepliesWithFallback()` tries `notes/children` then `notes/replies` and swallows every error (`catch {}`), and `addReaction()` returns `{ success: true }` immediately after `notes/reactions/create` succeeds — but Misskey's `ReactionService` can accept the call and store a fallback reaction when policy (sensitive emoji, role restrictions, `reactionAcceptance`) rejects the specific emoji. `fetchEmojis()` currently maps only `name/category/aliases/url` onto `PlatformEmoji`.

## Goals / Non-Goals

- Goals: thread history contains direct replies (product semantics per review item 4); error fidelity in the fallback chain; truthful reaction reporting; reaction-availability metadata visible to the agent.
- Non-Goals: pre-send role/`reactionAcceptance` evaluation (would require fetching bot roles + target note before every reaction — the post-send `myReaction` readback gives truth with one extra call); chat reaction changes.

## Decisions

**D1: Replies-first ordering.** `notes/replies` first, `notes/children` fallback. Review item 4 asks the product decision explicitly; the chosen semantics is "discussion thread = direct replies", matching how `buildReplyParams` threads replies. Quote renotes remain reachable via the `main` stream/mentions if ever needed. Alternative kept: children-first — rejected because it admits quote renotes into the recent-conversation context, which the review flags as unintended.

**D2: Classify fallback-eligible errors.** A helper `isEndpointUnavailableError(error)` returns true only for HTTP 404 / `NO_SUCH_ENDPOINT`-shaped failures from `MisskeyClient.request()` (misskey-js surfaces server errors as `ApiError` carrying `status` and body `error.code`). Everything else propagates. Applies to both reply and ancestor chains; the ancestor chain's `notes/conversation` → `replyId`-walk fallback gets the same gate. Alternative: catch-all (status quo) — rejected per review item 4.

**D3: Post-send verification over pre-send policy evaluation.** After `notes/reactions/create` returns, call `notes/show` and compare `myReaction` for the bot. `myReaction` on the note payload requires the `detail` flag: `notes/show` with `{ noteId, myReaction: true }` — the adapter's `MisskeyNote` type gains an optional `myReaction?: string | null`. Verification failure (network error reading back) yields `{ success: true, warning: "reaction unverified" }`-style result rather than a hard failure, since the reaction POST itself succeeded. Pre-send evaluation rejected: needs `i`-account role data caching and per-note `reactionAcceptance` fetch — a second, drift-prone reimplementation of server policy.

**D4: Metadata on `PlatformEmoji`.** Extend the shared `PlatformEmoji` shape with optional `isSensitive?: boolean`, `localOnly?: boolean`, `roleIdsThatCanBeUsedThisEmojiAsReaction?: string[]`, populated only by Misskey (Discord leaves them undefined). Availability of the optional fields keeps the Discord adapter untouched.

## Risks / Trade-offs

- [Extra `notes/show` per note reaction adds latency/rate-budget] → Reactions are at most one per session (reply-policy quota); negligible.
- [Strict error classification may misread a fork's nonstandard "no such endpoint" body] → Treat any 404 as endpoint-missing regardless of body; body-code matching only widens the eligible set on the same status.
- [`myReaction` readback races a concurrent edit] → Readback is best-effort truth at verification time; mismatch is reported, never hidden.

## Migration Plan

Code-only; no data/config migration. Rollback = revert commit.

## Open Questions

（none — the thread-semantics product decision is resolved toward direct-replies in D1, matching review item 4's recommended default.)
