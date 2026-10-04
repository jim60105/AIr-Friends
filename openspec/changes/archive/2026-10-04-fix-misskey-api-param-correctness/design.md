## Context

See proposal.md - Why. The Misskey API validator (Ajv without `additionalProperties: false`) silently ignores unknown parameters, so the `includeReplies` typo has been harmless — but it hides the intent and would break under stricter validation. All paginated endpoints used by the adapter cap `limit` at 100 server-side, while `context-handler.ts` validates only `limit >= 1`.

Current call sites of `limit` inside `src/platforms/misskey/misskey-adapter.ts`: `fetchRecentMessages()` (branches `timeline:self`, `chat:*`, `dm:*`, `note:*`), `fetchRepliesWithFallback()`, `fetchAncestorsWithFallback()`, and `searchRelatedMessages()`.

## Goals / Non-Goals

- Goals: spec-conformant parameter names; a single choke point for limit clamping; skill-level validation aligned with the API ceiling.
- Non-Goals: typed endpoint dispatch (blocked on `upgrade-misskey-js-types`); DM/thread semantics (other changes).

## Decisions

**D1: Clamp in the adapter, not in each call site.** Add one private helper in `MisskeyAdapter` (e.g. `normalizeLimit(limit: number): number` returning `Math.min(100, Math.max(1, Math.floor(limit)))`) and apply it once at the top of `fetchRecentMessages()` and in `searchRelatedMessages()`, so every downstream call (including the fallback chains) receives an already-clamped value. Alternative: clamp inside `MisskeyClient.request()` for all endpoints — rejected because `limit` is endpoint-specific vocabulary and the client wrapper is generic; a future non-paginated endpoint with a `limit`-like param would be silently mangled.

**D2: Reject out-of-range in the skill; clamp in the adapter.** The two layers intentionally differ: `fetch-context` is agent-facing, so an explicit rejection with guidance is better than silent truncation; the adapter clamp is a defensive boundary so internal callers (context assembly with `recentMessageLimit`) can never trigger server `INVALID_PARAM`. Alternatives considered: clamp-only (agent gets silently fewer messages than asked, no signal) or reject-only (internal defaults could still break under future config drift).

**D3: `Math.floor` in the clamp** keeps the adapter tolerant of non-integers even though the skill rejects them, because adapter callers are internal code, not agent input.

## Risks / Trade-offs

- [Clamping hides an upstream misconfiguration] → Debug-level log when the clamp actually changes the value.
- [`fetch-context` rejecting `limit > 100` could break an agent prompt that expects large limits] → No config default exceeds 20; the error message states the allowed range so the agent can self-correct.

## Migration Plan

Pure code fix; no data or config migration. Rollback = revert commit.

## Open Questions

（none）
