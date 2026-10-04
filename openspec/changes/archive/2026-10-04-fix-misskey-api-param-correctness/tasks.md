## 1. Parameter conformance

- [x] 1.1 In `src/platforms/misskey/misskey-adapter.ts`, replace `includeReplies: false` with `withReplies: false` in the `timeline:self` branch of `fetchRecentMessages()`, and verify by grepping that `includeReplies` no longer appears in `src/`.

## 2. Limit normalization at the adapter boundary

- [x] 2.1 Add a private `normalizeLimit(limit: number): number` helper to `MisskeyAdapter` that returns `Math.floor(limit)` clamped to `1..100` and logs at debug level when the value changes; verify with unit tests covering `0`, `-5`, `20`, `100`, `101`, `250`, and `10.5`.
- [x] 2.2 Apply the helper once at the top of `fetchRecentMessages()` and in `searchRelatedMessages()` so all downstream paginated calls (`users/notes`, `notes/mentions`, `chat/messages/user-timeline`, `notes/children`, `notes/replies`, `notes/conversation`, `notes/search`) receive an in-range limit; verify with an adapter test asserting a `limit: 250` request is issued as `100`.

## 3. Skill-level validation

- [x] 3.1 In `src/skills/context-handler.ts`, extend the `limit` check to require an integer in `1..100` with an instructive error message naming the allowed range; verify with handler tests for `limit` values `101`, `10.5`, `0`, `1`, `100`, and omitted (default `20`).
- [x] 3.2 Update the `fetch-context` skill documentation/schema text (SKILL.md or parameter description) if it advertises the old bound, and verify the documented range matches `1..100`.

## 4. Verification

- [x] 4.1 Run `deno task check` (type-check) and the Misskey adapter + context-handler unit tests; verify all pass.
