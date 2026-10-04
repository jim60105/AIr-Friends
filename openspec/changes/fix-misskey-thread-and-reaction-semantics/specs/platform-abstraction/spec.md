## MODIFIED Requirements

### Requirement: Misskey Fallback Chains for Fork Compatibility

The Misskey adapter SHALL implement API fallback chains for compatibility with Misskey forks. A fallback SHALL be triggered only by endpoint-unavailable or fork-compatibility errors (e.g. HTTP 404 responses or `NO_SUCH_ENDPOINT`-class API errors); rate-limit, invalid-parameter, and transient server errors (HTTP 5xx) SHALL NOT be swallowed as "endpoint unavailable" and SHALL NOT cause silent degradation to a narrower endpoint. Such errors SHALL propagate out of the fetch helper; note-thread assembly SHALL then degrade to the thread parts it successfully fetched (logging the original error) rather than failing the entire recent-messages fetch.

#### Scenario: Reply fetching fallback

- **GIVEN** a note thread assembly on a server where both endpoints exist
- **WHEN** fetching replies
- **THEN** it SHALL call `notes/replies` (direct replies only) first and use `notes/children` only as a fallback when `notes/replies` is unavailable

#### Scenario: Reply fetching fallback on missing endpoint only

- **GIVEN** a note thread assembly where `notes/replies` returns a no-such-endpoint error
- **WHEN** fetching replies
- **THEN** it SHALL fall back to `notes/children`, and if that endpoint is also unavailable, return an empty reply list

#### Scenario: Transient errors do not trigger fallback

- **GIVEN** a note thread assembly where the first reply endpoint fails with a rate-limit, `INVALID_PARAM`, or HTTP 5xx error
- **WHEN** fetching replies
- **THEN** the fallback endpoint SHALL NOT be tried and the failure SHALL NOT be reported as an empty reply list by the helper
- **AND** the note-thread fetch SHALL still return a thread assembled from the successfully fetched parts (e.g. ancestors and the current note), with the original error recorded in a warning log
- **AND** the overall `fetchRecentMessages` call SHALL NOT fail the session for this degraded thread

#### Scenario: Ancestor fetching fallback

- **GIVEN** a note thread assembly
- **WHEN** fetching ancestor notes
- **THEN** it SHALL try `notes/conversation` first, fall back to walking the `replyId` chain via `notes/show`, and apply the same endpoint-missing-only fallback trigger

## ADDED Requirements

### Requirement: Misskey Note Reaction Verification

When the Misskey adapter adds a reaction to a note via `notes/reactions/create`, it SHALL verify the stored result by reading the note back with `notes/show` and inspecting the bot's own reaction (`myReaction`). The reaction result SHALL carry, in addition to `success`, an optional `storedReaction` (the emoji the server actually stored, present when verification ran) and an optional `verified` flag (`false` when the post-send readback itself failed). A reaction whose POST succeeded SHALL always have `success: true` — a policy downgrade is not a call failure — but when `storedReaction` differs from the requested emoji the result SHALL NOT claim the requested emoji was applied, and when `verified` is `false` the result SHALL NOT present the requested emoji as confirmed.

#### Scenario: Reaction stored as requested

- **GIVEN** a `react-message` request for a note channel with emoji `:misskey_emoji:`
- **WHEN** `notes/show` afterwards reports the bot's `myReaction` as `:misskey_emoji:`
- **THEN** the result SHALL have `success: true` and `storedReaction` `:misskey_emoji:`

#### Scenario: Server stored a fallback reaction

- **GIVEN** a `react-message` request with emoji `:restricted_emoji:` for which the server's reaction policy accepts the request but stores a different reaction
- **WHEN** `notes/show` afterwards reports the bot's `myReaction` as a different value
- **THEN** the result SHALL have `success: true` and `storedReaction` set to the actually-stored reaction, and SHALL NOT claim `:restricted_emoji:` was applied

#### Scenario: Verification readback fails

- **GIVEN** a note reaction whose POST succeeded but whose `notes/show` readback then fails
- **WHEN** the adapter returns the reaction result
- **THEN** the result SHALL have `success: true` and `verified: false`
- **AND** the result SHALL NOT present `:requested_emoji:` as a confirmed-applied reaction

### Requirement: Misskey Emoji Reaction-Availability Metadata

When fetching custom emojis, the Misskey adapter SHALL preserve the reaction-availability fields returned by the `emojis` endpoint — `isSensitive`, `localOnly`, and `roleIdsThatCanBeUsedThisEmojiAsReaction` — on its emoji representation, so downstream consumers can distinguish emojis carrying reaction restrictions from universally usable ones.

#### Scenario: Sensitive emoji flagged

- **GIVEN** an instance whose `emojis` response includes an emoji with `isSensitive: true`
- **WHEN** the adapter returns the emoji list
- **THEN** that emoji's entry SHALL carry the sensitive flag indicating it may not be usable as a reaction in all contexts

#### Scenario: Role-restricted emoji flagged

- **GIVEN** an emoji whose `roleIdsThatCanBeUsedThisEmojiAsReaction` is a non-empty array
- **WHEN** the adapter returns the emoji list
- **THEN** that emoji's entry SHALL carry the role-restriction metadata
