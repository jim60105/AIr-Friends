## Why

A static review of AIr-Friends' Misskey API usage against Misskey 2026.10.0 (`tmp/misskey-api-issue.md`) found two request-parameter defects: the `users/notes` call passes a nonexistent `includeReplies` parameter (the spec field is `withReplies`), and the `limit` value flows unbounded from the `fetch-context` skill into every Misskey endpoint, whose official maximum is 100. The first is silently ignored today only because Misskey's validator permits unknown properties and `withReplies` defaults to `false`; the second makes `fetch-context` calls with `limit > 100` fail with `INVALID_PARAM`.

## What Changes

- Rename the `users/notes` request parameter `includeReplies: false` to the spec name `withReplies: false` in the Misskey adapter's `timeline:self` history fetch (observable behavior is unchanged; the request now conforms to the endpoint schema).
- Normalize every outbound `limit` at the Misskey adapter boundary to the Misskey-permitted range `1..100` before it is sent to `users/notes`, `notes/mentions`, `notes/children`, `notes/replies`, `notes/conversation`, `notes/search`, and `chat/messages/user-timeline`.
- Reject out-of-range `limit` in the `fetch-context` skill validation: `limit` must be an integer in `1..100` (previously only `limit >= 1` was checked), so the skill layer reports invalid values instead of letting the platform layer absorb `INVALID_PARAM` errors.

## Capabilities

### New Capabilities

（none）

### Modified Capabilities

- `platform-abstraction`: adds a requirement that Misskey REST requests use spec-conformant parameter names and clamp `limit` to `1..100` at the adapter boundary.
- `skills-and-reply`: adds a requirement bounding the `fetch-context` `limit` parameter to `1..100`.

## Non-goals

- Changing which endpoints are called or their conversation semantics (`dm:` history, `note:` thread composition) — covered by other changes.
- Removing the `as any` casts in `MisskeyClient.request()` — requires the `misskey-js` upgrade and is covered by `upgrade-misskey-js-types`.

## Batch

- depends-on: (none — this is the foundation change)

Code conflicts:
- `src/platforms/misskey/misskey-adapter.ts` `fetchRecentMessages()`: `fix-misskey-dm-history` rewrites the `dm:` branch (adds a `users/notes` call using `withReplies: true` and relies on this change's limit normalization); `fix-misskey-thread-and-reaction-semantics` edits `fetchRepliesWithFallback()` in the same file. Queue this change first.
- `src/skills/context-handler.ts` `limit` validation: no other batch member touches this file.
