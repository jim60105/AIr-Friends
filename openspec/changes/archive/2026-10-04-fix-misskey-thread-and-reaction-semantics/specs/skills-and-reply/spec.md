## MODIFIED Requirements

### Requirement: Reaction Handling

The `react-message` skill SHALL add an emoji reaction to the message that triggered the session (`context.triggerMessageId`), even when the bot has since sent its own messages (e.g. a file message): a reaction SHALL NEVER target a message the bot itself sent. It SHALL require a non-empty `emoji` parameter and a valid `context.triggerMessageId` (the trigger message). The system SHALL track reactions per workspace:channel combination via `reactionSentMap` to prevent duplicate reactions. When the platform adapter reports the reaction as applied with a stored reaction different from the requested emoji, the skill SHALL report the stored reaction to the agent instead of echoing the requested emoji, and SHALL still mark the reaction as sent so the downgrade does not trigger retry loops.

#### Scenario: Reaction added to trigger message
- **GIVEN** a session triggered by a message
- **WHEN** `react-message` is called with `emoji = "👍"`
- **THEN** the system SHALL call `platformAdapter.addReaction()` on the trigger message

#### Scenario: Reaction after a file send still targets the trigger message
- **GIVEN** a session that delivered files via `send-file` and has a trigger message `trigger-1`
- **WHEN** `react-message` is called
- **THEN** the reaction SHALL be added to `trigger-1`
- **AND** SHALL NOT be added to the bot's own file message

#### Scenario: No trigger message for reaction
- **GIVEN** a session without a `triggerMessageId` (e.g., spontaneous post)
- **WHEN** `react-message` is called
- **THEN** the handler SHALL return an error indicating no trigger message exists

#### Scenario: Downgraded reaction reported truthfully
- **GIVEN** a Misskey note reaction whose adapter result is `success: true` with `storedReaction` different from the requested emoji
- **WHEN** the `react-message` handler builds its skill result
- **THEN** the result data SHALL report the stored reaction (not the requested emoji) and indicate the requested emoji was not applied as such
- **AND** the reaction SHALL be marked sent via `reactionSentMap`, so the session counts as responded and no missing-reply retry is triggered
