## MODIFIED Requirements

### Requirement: Misskey Fallback Chains for Fork Compatibility

The Misskey adapter SHALL implement API fallback chains for compatibility with Misskey forks. A fallback SHALL be triggered only by endpoint-unavailable or fork-compatibility errors (e.g. HTTP 404 responses or `NO_SUCH_ENDPOINT`-class API errors); rate-limit, invalid-parameter, and transient server errors (HTTP 5xx) SHALL propagate to the caller with their original failure information and SHALL NOT cause silent degradation to a narrower endpoint or an empty result.

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
- **THEN** the failure SHALL propagate to the caller instead of silently trying the fallback endpoint or returning empty

#### Scenario: Ancestor fetching fallback

- **GIVEN** a note thread assembly
- **WHEN** fetching ancestor notes
- **THEN** it SHALL try `notes/conversation` first, fall back to walking the `replyId` chain via `notes/show`, and apply the same endpoint-missing-only fallback trigger

## ADDED Requirements

### Requirement: Misskey Note Reaction Verification

When the Misskey adapter adds a reaction to a note via `notes/reactions/create`, it SHALL verify the stored result by reading the note back with `notes/show` and inspecting the bot's own reaction (`myReaction`). The adapter SHALL report the emoji the server actually stored; when the stored reaction differs from the requested emoji, the result SHALL NOT falsely report the requested emoji as applied. If verification itself fails, the adapter SHALL report the reaction as unverified rather than as a confirmed success for the requested emoji.

#### Scenario: Reaction stored as requested

- **GIVEN** a `react-message` request for a note channel with emoji `:misskey_emoji:`
- **WHEN** `notes/show` afterwards reports the bot's `myReaction` as `:misskey_emoji:`
- **THEN** the result SHALL be a success reporting `:misskey_emoji:`

#### Scenario: Server stored a fallback reaction

- **GIVEN** a `react-message` request with emoji `:restricted_emoji:` for which the server's reaction policy accepts the request but stores a different reaction
- **WHEN** `notes/show` afterwards reports the bot's `myReaction` as a different value
- **THEN** the result SHALL report the actually-stored reaction and SHALL NOT claim `:restricted_emoji:` was applied

### Requirement: Misskey Emoji Reaction-Availability Metadata

When fetching custom emojis, the Misskey adapter SHALL preserve the reaction-availability fields returned by the `emojis` endpoint — `isSensitive`, `localOnly`, and `roleIdsThatCanBeUsedThisEmojiAsReaction` — on its emoji representation, and the exposed available-reaction list SHALL mark emojis carrying availability restrictions so the agent is not told every custom emoji is universally usable as a reaction.

#### Scenario: Sensitive emoji flagged

- **GIVEN** an instance whose `emojis` response includes an emoji with `isSensitive: true`
- **WHEN** the adapter returns the emoji list
- **THEN** that emoji's entry SHALL carry the sensitive flag indicating it may not be usable as a reaction in all contexts

#### Scenario: Role-restricted emoji flagged

- **GIVEN** an emoji whose `roleIdsThatCanBeUsedThisEmojiAsReaction` is a non-empty array
- **WHEN** the adapter returns the emoji list
- **THEN** that emoji's entry SHALL carry the role-restriction metadata
